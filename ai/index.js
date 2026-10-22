const { normalizeAttachments, buildUserContent, sanitizeContentParts } = require("./attachments");
const { formatCatalog, searchCatalog, slimProducts } = require("./catalog");
const { completeChat } = require("./client");
const { runLoop } = require("./loop");
const { systemPrompt } = require("./prompt");
const { loadTools, toolSchemas } = require("./registry");

const HANDOFF_RE = /whatsapp|ватсап|вацап|мессенджер|напишите динаре|написать динаре|передам вас|связаться с динарой|telegram\s*:|телеграм\s*:/i;

function swapMessengerLinks(text, pattern, official) {
  if (!official) return text;
  return text.replace(pattern, (url) => {
    const tail = url.match(/[.,;:!?]+$/)?.[0] || "";
    return official + tail;
  });
}

function ensureContactLinks(reply, contacts) {
  let text = String(reply || "").trim();
  if (!text) return text;
  const wa = String(contacts?.whatsapp || "");
  const tg = String(contacts?.telegram || "");
  text = swapMessengerLinks(text, /https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^\s<>"')\]]+/gi, wa);
  text = swapMessengerLinks(text, /https?:\/\/(?:t\.me|telegram\.me)\/[^\s<>"')\]]+/gi, tg);
  if (!HANDOFF_RE.test(text)) return text;
  const lines = [];
  if (wa && !text.includes(wa)) lines.push(`WhatsApp: ${wa}`);
  if (tg && !text.includes(tg)) lines.push(`Telegram: ${tg}`);
  if (!lines.length) return text;
  return `${text}\n\n${lines.join("\n")}`;
}

function fold(value) {
  return String(value || "").toLowerCase().replace(/ё/g, "е");
}

function mentionedCards(reply, cards) {
  const text = fold(reply);
  return (Array.isArray(cards) ? cards : []).filter((card) => {
    const title = fold(card?.title).replace(/\s+/g, " ").trim();
    return title.length >= 3 && text.includes(title);
  });
}

const MONEY_RE = /(\d{1,3}(?:[ \u00a0.]\d{3})+|\d{1,9})(?:\s*(?:тыс\.?|тысяч[аи]?))?\s*(₸|₽|\$|тенге|тг\b|руб(?:\.|лей|ля|ль)?)/gi;

function currencyOf(token) {
  const s = String(token || "").toLowerCase();
  if (s.includes("$") || s.includes("usd") || s.includes("долл")) return "usd";
  if (s.includes("₽") || s.includes("руб")) return "rub";
  return "kzt";
}

function amountDigits(num, full) {
  let digits = String(num || "").replace(/\D/g, "");
  if (!digits) return "";
  if (/тыс/i.test(full) && digits.length <= 3) digits = String(Number(digits) * 1000);
  return digits;
}

class CatalogReadError extends Error {
  constructor(fn, cause) {
    super(`${fn}: ${cause?.message || cause || "сбой каталога"}`);
    this.name = "CatalogReadError";
    this.fn = fn;
  }
}

function logCatalogFailure(fn, err) {
  console.error(`AI-чат: ${fn}: ${err?.message || err}`);
}

function priceRows(products, priceOf) {
  const rows = [];
  try {
    for (const product of Array.isArray(products) ? products : []) {
      if (!product || !String(product.title || "").trim()) continue;
      const price = String(priceOf(product) || "").trim();
      const digits = price.replace(/\D/g, "");
      rows.push({
        title: fold(product.title).replace(/\s+/g, " ").trim(),
        price: price || "по каталогу",
        digits,
        currency: digits ? currencyOf(price) : "",
      });
    }
    return rows;
  } catch (err) {
    if (err?.name !== "CatalogReadError") logCatalogFailure("priceRows", err);
    throw err;
  }
}

function priceKey(digits, currency) {
  return digits ? `${digits}:${currency}` : "";
}

function matchesRow(row, digits, currency) {
  return Boolean(row?.digits) && priceKey(row.digits, row.currency) === priceKey(digits, currency);
}

function findTitles(text, rows) {
  const folded = fold(text);
  const ranked = rows.filter((row) => row.title.length >= 3).sort((a, b) => b.title.length - a.title.length);
  const taken = [];
  const found = [];
  for (const row of ranked) {
    let from = 0;
    while (from < folded.length) {
      const at = folded.indexOf(row.title, from);
      if (at < 0) break;
      const end = at + row.title.length;
      if (!taken.some((span) => at < span.end && end > span.start)) {
        taken.push({ start: at, end });
        found.push({ start: at, end, row });
      }
      from = end;
    }
  }
  found.sort((a, b) => a.start - b.start);
  return found;
}

function findMoney(text) {
  const found = [];
  const re = new RegExp(MONEY_RE.source, "gi");
  let match = re.exec(text);
  while (match) {
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      full: match[0],
      num: match[1],
      cur: match[2],
    });
    if (!match[0].length) re.lastIndex += 1;
    match = re.exec(text);
  }
  return found;
}

function moneyReplacement(item, owners, rows) {
  const digits = amountDigits(item.num, item.full);
  const currency = currencyOf(item.cur);
  if (!digits) return item.full;
  if (owners.length === 1) return matchesRow(owners[0].row, digits, currency) ? item.full : owners[0].row.price;
  if (owners.length > 1) {
    return owners.every((owner) => matchesRow(owner.row, digits, currency)) ? item.full : "по каталогу";
  }
  return rows.some((row) => matchesRow(row, digits, currency)) ? item.full : "по каталогу";
}

function recordPriceChange(changes, from, to) {
  if (from !== to) {
    changes.push({
      from: String(from).replace(/\s+/g, " ").trim().slice(0, 80),
      to: String(to).replace(/\s+/g, " ").trim().slice(0, 80),
    });
  }
  return to;
}

function logPriceChanges(changes) {
  if (!changes.length) return;
  const sample = changes.slice(0, 8).map((item) => `«${item.from}» → «${item.to}»`).join("; ");
  console.error(`AI-чат: заменено цен: ${changes.length}. ${sample}`);
}

function correctPrices(reply, products, priceOf) {
  const text = String(reply || "");
  const rows = priceRows(products, priceOf);
  const changes = [];
  if (fold(text).length !== text.length) {
    const mentioned = rows.filter((row) => row.title.length >= 3 && fold(text).includes(row.title));
    const owners = mentioned.length === 1 ? [{ row: mentioned[0] }] : mentioned.map((row) => ({ row }));
    const next = text.replace(MONEY_RE, (full, num, cur) => recordPriceChange(
      changes,
      full,
      moneyReplacement({ full, num, cur }, owners, rows)
    ));
    logPriceChanges(changes);
    return next;
  }
  const titles = findTitles(text, rows);
  const money = findMoney(text);
  if (!money.length) return text;
  let out = "";
  let cursor = 0;
  for (let index = 0; index < money.length; index += 1) {
    const item = money[index];
    const prevEnd = index === 0 ? 0 : money[index - 1].end;
    const nextStart = index + 1 < money.length ? money[index + 1].start : text.length;
    const before = titles.filter((title) => title.end <= item.start && title.end > prevEnd);
    const after = titles.filter((title) => title.start >= item.end && title.start < nextStart);
    const replacement = moneyReplacement(item, before.length ? before : after, rows);
    out += text.slice(cursor, item.start);
    out += recordPriceChange(changes, item.full, replacement);
    cursor = item.end;
  }
  logPriceChanges(changes);
  return out + text.slice(cursor);
}

function createAi(deps) {
  const tools = loadTools();
  const schemas = toolSchemas(tools);
  const timeoutMs = Number(deps.timeoutMs) || 45000;
  let cache = { mtimeMs: null, products: [] };

  function loadProducts() {
    let mtimeMs = null;
    if (typeof deps.productsMtime === "function") {
      try {
        mtimeMs = deps.productsMtime();
      } catch (err) {
        logCatalogFailure("productsMtime", err);
        throw new CatalogReadError("productsMtime", err);
      }
      if (typeof mtimeMs === "number" && mtimeMs === cache.mtimeMs) return cache.products;
    }
    let products = [];
    try {
      products = deps.readProducts() || [];
    } catch (err) {
      logCatalogFailure("readProducts", err);
      throw new CatalogReadError("readProducts", err);
    }
    const slim = slimProducts(products);
    if (typeof mtimeMs === "number") cache = { mtimeMs, products: slim };
    return slim;
  }

  function priceOf(product) {
    try {
      return String(deps.priceText(product) || "").trim();
    } catch (err) {
      logCatalogFailure("priceOf", err);
      throw new CatalogReadError("priceOf", err);
    }
  }

  const ctx = {
    searchCatalog(query) {
      return searchCatalog(loadProducts(), query, priceOf);
    },
    contacts() {
      const phone = String(deps.waPhone || "").replace(/\D/g, "");
      const tg = String(deps.tgUser || "").replace(/^@/, "").replace(/[^\w]/g, "");
      return {
        whatsapp: phone ? `https://wa.me/${phone}` : "",
        telegram: tg ? `https://t.me/${tg}` : "",
      };
    },
  };

  const client = {
    complete(options) {
      const hasImage = (options.messages || []).some(
        (message) => Array.isArray(message?.content) && message.content.some((part) => part?.type === "image_url")
      );
      const reasoningModel = /^(gpt-5|o\d)/i.test(String(deps.model || ""));
      return completeChat({
        baseUrl: deps.baseUrl,
        apiKey: deps.apiKey,
        model: deps.model,
        reasoningEffort: deps.reasoningEffort || (hasImage && reasoningModel ? "low" : ""),
        maxCompletionTokens: hasImage ? 6000 : 2000,
        messages: options.messages,
        tools: options.tools,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      });
    },
  };

  return {
    async reply({ message, history, attachments, signal }) {
      if (!deps.apiKey) return { status: 503, body: { error: "AI не настроен", fallback: true, source: "fallback" } };

      const text = String(message || "").trim().slice(0, 2000);
      const files = normalizeAttachments(attachments);
      if (!text && !files.length) return { status: 400, body: { error: "Пустое сообщение" } };

      const prior = (Array.isArray(history) ? history : [])
        .slice(-12)
        .map((item) => {
          if (!item || (item.role !== "user" && item.role !== "assistant")) return null;
          if (typeof item.content === "string" && item.content.trim()) {
            return { role: item.role, content: item.content.slice(0, 4500) };
          }
          if (item.role !== "user") return null;
          const content = sanitizeContentParts(item.content);
          return content ? { role: "user", content } : null;
        })
        .filter(Boolean);

      const prompt = (includeContacts) =>
        systemPrompt({
          chatName: deps.chatName,
          catalog: formatCatalog(loadProducts(), priceOf),
          waPhone: deps.waPhone,
          tgUser: deps.tgUser,
          includeContacts,
        });

      if (signal?.aborted) return { status: 499, body: { error: "Соединение закрыто" } };

      try {
        loadProducts();
        const outcome = await runLoop({
          client,
          prompt,
          tools,
          schemas,
          ctx,
          history: [...prior, { role: "user", content: buildUserContent(text, files) }],
          timeoutMs,
          signal,
        });
        const reply = correctPrices(
          ensureContactLinks(outcome.reply, ctx.contacts()),
          loadProducts(),
          priceOf
        );
        if (!reply) {
          console.error(`AI-чат: пустой ответ модели (finish_reason: ${outcome.finishReason || "?"})`);
          return { status: 502, body: { error: "AI временно недоступен", fallback: false, source: "error" } };
        }
        const cards = mentionedCards(reply, outcome.cards);
        const body = { reply, name: deps.chatName, source: "model" };
        if (cards.length) body.cards = cards;
        return { status: 200, body };
      } catch (err) {
        if (err?.name === "ClientClosed" || signal?.aborted) {
          return { status: 499, body: { error: "Соединение закрыто", fallback: false, source: "error" } };
        }
        if (err?.name === "CatalogReadError") {
          return {
            status: 503,
            body: { error: "Каталог временно недоступен", fallback: false, source: "error" },
          };
        }
        const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
        if (err?.name === "AiHttpError") {
          console.error(`AI-чат: ошибка API (${err.status}): ${err.message}`);
        } else {
          console.error(timedOut ? `AI-чат: нет ответа за ${timeoutMs} мс` : `AI-чат: сеть: ${err.message}`);
        }
        return {
          status: timedOut ? 504 : 502,
          body: { error: "AI временно недоступен", fallback: false, source: "error" },
        };
      }
    },
  };
}

module.exports = { createAi, ensureContactLinks, mentionedCards, correctPrices };

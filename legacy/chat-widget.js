/*!
 * Чат-виджет: AI-консультант Асель
 */
(function () {
  // v2: в истории хранится только текст, HTML собирается при отрисовке.
  const CHAT_KEY = "dinara_ai_chat_v2";
  const API_TIMEOUT_MS = 60000;
  const CONFIG_TIMEOUT_MS = 5000;
  try {
    sessionStorage.removeItem("dinara_ai_chat");
  } catch {
    /* ignore */
  }
  let WA_LINK = `https://wa.me/${typeof WA_PHONE !== "undefined" ? WA_PHONE : "77003096823"}`;
  let TG_LINK = `https://t.me/${typeof TG_USER !== "undefined" ? TG_USER : "TDS_dinara"}`;
  let CHAT_NAME = "Асель";
  let API_READY = false;
  const API_BASE = location.protocol === "file:" ? "http://localhost:3000" : "";

  const ICONS = {
    chat: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5.2 18.6 4 21.2c-.3.6.3 1.2.9 1l3.2-1.2A8.8 8.8 0 1 0 5.2 18.6Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8.2 11.1h7.4M8.2 14.2h4.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    send: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.2 12.1 19 5.4c.7-.3 1.4.4 1.1 1.1L13.9 20c-.3.7-1.3.6-1.5-.1l-1.6-6.2L4.3 13.3c-.8-.2-.8-1.3-.1-1.2Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
    minimize: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9.5 6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  };

  function htmlEscape(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function fetchWithTimeout(url, options, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  function normalize(str) {
    return String(str)
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^\p{L}\p{N}\s+]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasAny(q, words) {
    return words.some((word) => q.includes(word));
  }

  function catalog() {
    try {
      return typeof loadProducts === "function" ? loadProducts() : [];
    } catch {
      return [];
    }
  }

  function productPrice(product) {
    if (typeof displayPrice === "function") return displayPrice(product);
    return product.price || "";
  }

  const STOP_WORDS = new Set([
    "для", "про", "или", "как", "что", "это", "мне", "нам", "вам", "нужен", "нужна",
    "нужно", "хочу", "есть", "под", "при", "без", "the", "and", "ролик", "ролики",
    "видео", "сколько", "стоит", "можно", "какой", "какие", "какая",
  ]);

  function findProducts(query) {
    const q = normalize(query);
    const stems = q
      .split(" ")
      .filter((t) => t.length > 3 && !STOP_WORDS.has(t))
      .map((t) => t.slice(0, Math.max(4, t.length - 2)));
    if (!stems.length) return [];
    return catalog()
      .map((product) => {
        const words = normalize(`${product.title} ${product.description || ""}`).split(" ");
        const score = stems.reduce(
          (sum, stem) => sum + (words.some((w) => w.startsWith(stem)) ? 2 : 0),
          0
        );
        return { product, score };
      })
      .filter((row) => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((row) => row.product);
  }

  function formatCatalogList() {
    const items = catalog();
    if (!items.length) {
      return "Сейчас в каталоге нет готовых пакетов — Динара подберёт формат лично.";
    }
    return items
      .map((p) => `• ${p.title} — ${productPrice(p)}`)
      .join("\n");
  }

  function catalogMatches(stems) {
    return catalog()
      .filter((product) => {
        const words = normalize(`${product.title} ${product.description || ""}`).split(" ");
        return stems.some((stem) => words.some((word) => word.startsWith(stem)));
      })
      .slice(0, 3);
  }

  function topicReply(intro, question, stems) {
    const cards = catalogMatches(stems);
    if (!cards.length) return { text: `${intro}\n\n${question}` };
    return { text: `${intro} Подходящее из каталога — ниже.\n\n${question}`, cards };
  }

  function greetingText() {
    return `Здравствуйте! Я ${CHAT_NAME}, консультант Динары. Расскажите, какой ролик нужен — подскажу формат.`;
  }

  function handoffText(hint) {
    const lead = hint || "Могу передать вас Динаре — она уточнит детали и смету.";
    return `${lead}\n\nWhatsApp: ${WA_LINK}\nTelegram: ${TG_LINK}`;
  }

  async function loadSiteConfig() {
    try {
      const res = await fetchWithTimeout(
        `${API_BASE}/api/config`,
        { cache: "no-store" },
        CONFIG_TIMEOUT_MS
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.waPhone) WA_LINK = `https://wa.me/${data.waPhone}`;
      if (data.tgUser) TG_LINK = `https://t.me/${data.tgUser}`;
      if (data.chatName) CHAT_NAME = data.chatName;
      API_READY = Boolean(data.aiReady);
    } catch {
      API_READY = false;
    }
  }

  function historyForApi(messages) {
    return messages
      .filter((m) => m.role === "user" || m.role === "bot")
      .slice(-10)
      .map((m) => {
        const files = m.role === "user" ? (m.attachments || []).map((a) => a.name) : [];
        const content = [m.text, files.length ? `[Вложения: ${files.join(", ")}]` : ""]
          .filter(Boolean)
          .join("\n");
        return { role: m.role === "bot" ? "assistant" : "user", content };
      })
      .filter((m) => m.content);
  }

  async function askApi(message, messages, attachments) {
    const res = await fetchWithTimeout(
      `${API_BASE}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history: historyForApi(messages),
          attachments: (attachments || []).map((a) => ({
            name: a.name,
            mime: a.mime,
            kind: a.kind,
            dataUrl: a.kind === "image" ? a.dataUrl : undefined,
            text: a.kind === "text" ? a.text : undefined,
          })),
        }),
      },
      API_TIMEOUT_MS
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || typeof data.reply !== "string" || !data.reply.trim()) {
      const err = new Error(data.error || "Ошибка чата");
      err.status = res.status;
      err.fallback = res.ok || Boolean(data.fallback);
      throw err;
    }
    return { text: data.reply };
  }

  function replyWithAttachments(raw, attachments) {
    const files = attachments || [];
    if (!files.length) return replyTo(raw);

    const names = files.map((f) => f.name).join(", ");
    const textFile = files.find((f) => f.kind === "text" && f.text);
    const hasImage = files.some((f) => f.kind === "image");

    if (hasImage && !textFile) {
      return {
        text:
          `Получила изображение (${names}), но сейчас не могу его подробно разобрать.\n\n` +
          (raw ? replyTo(raw).text : "Опишите словами, что на фото и какой ролик хотите — подскажу формат."),
      };
    }

    if (textFile) {
      const snippet = textFile.text.replace(/\s+/g, " ").trim().slice(0, 420);
      return {
        text:
          `Просмотрела файл «${textFile.name}». Кратко: ${snippet}${
            textFile.text.length > 420 ? "…" : ""
          }\n\n` +
          (raw
            ? `По вашему вопросу: ${replyTo(raw).text}`
            : "Чем помочь дальше — выбрать формат под этот бриф?"),
      };
    }

    return {
      text:
        `Получила файл (${names}).\n\n` +
        (raw
          ? replyTo(raw).text
          : "Кратко опишите, что внутри или какая задача — подскажу формат."),
    };
  }

  function replyTo(raw) {
    const text = String(raw || "").trim();
    const q = normalize(text);
    const products = findProducts(text);

    if (
      hasAny(q, [
        "whatsapp",
        "ватсап",
        "вацап",
        "телеграм",
        "telegram",
        "контакт",
        "телефон",
        "номер",
        "связ",
        "человек",
        "оператор",
        "менеджер",
        "поговори",
        "созвон",
        "напиши дина",
        "свяжи",
      ])
    ) {
      return {
        text: handoffText(
          "Конечно. Напишите Динаре в мессенджер — коротко опишите задачу и желаемый формат."
        ),
      };
    }

    if (hasAny(q, ["заказ", "заказать", "оплат", "корзин", "купить", "оформить", "бриф", "смет"])) {
      return {
        text:
          "Заказать можно через каталог: «Заказать» или корзина откроют WhatsApp или Telegram с готовым текстом.\n\n" +
          "Если формат ещё не выбран — опишите задачу здесь, подскажу что ближе. А когда будете готовы, передам Динаре.",
      };
    }

    if (
      hasAny(q, [
        "дети", "детей", "детям", "детьми", "детск", "ребен", "малыш", "школьн",
        "праздник", "день рожден", "мульт", "сказк",
      ])
    ) {
      return topicReply(
        "Для детского праздника Динара делает ролик, где ребёнок становится героем: день рождения, супергерой или сказка.",
        "Сколько лет ребёнку и какая идея? Подскажу, какой формат лучше.",
        ["детск", "дети", "детей", "мульт", "поздрав", "ребен", "праздн"]
      );
    }

    if (hasAny(q, ["подрост", "тикток", "tiktok", "стиль"])) {
      return topicReply(
        "Подростковый формат — про стиль и характер, без «мультиков».",
        "Какая тема и куда выложите — TikTok, Instagram?",
        ["подрост", "трансформ", "тикток", "reels", "рилс"]
      );
    }

    if (hasAny(q, ["бизнес", "гастро", "ресторан", "кафе", "бренд", "реклам", "продукт", "коммерч"])) {
      return topicReply(
        "Для бизнеса и гастро Динара собирает ролик, после которого хочется зайти и заказать — без тяжёлой съёмки.",
        "Что продвигаете — кафе, продукт, услугу?",
        ["бизнес", "гастро", "реклам", "презентац", "бренд"]
      );
    }

    if (hasAny(q, ["скетч", "сериал", "мини сери", "персонаж"])) {
      return topicReply(
        "Скетчи и мини-сериалы — короткие сценки с персонажем «как клиент»: сомнения, выбор, «брать или нет». Хорошо заходят серией.",
        "Нужен один ролик или сразу мини-серия?",
        ["скетч", "сериал"]
      );
    }

    if (
      hasAny(q, ["цен", "сколько", "стоит", "каталог", "тариф", "прайс"]) ||
      (products.length && hasAny(q, ["reel", "рилс", "stor", "стор", "монтаж", "обучающ"]))
    ) {
      if (products.length === 1) {
        const p = products[0];
        return {
          text: `«${p.title}» в каталоге — ${productPrice(p)}. ${
            p.description || "Могу рассказать, чем этот формат отличается от других."
          }\n\nПод вашу задачу нужен именно этот пакет или что-то индивидуальное?`,
          cards: products,
        };
      }
      if (products.length > 1) {
        return {
          text: "Нашла близкие позиции в каталоге. Могу коротко сравнить — какой формат вам ближе по задаче?",
          cards: products,
        };
      }
      return {
        text:
          "Ориентиры по готовым пакетам:\n\n" +
          formatCatalogList() +
          "\n\nИндивидуальная смета зависит от объёма. Расскажите задачу — подскажу, с чего начать.",
      };
    }

    if (hasAny(q, ["услуг", "направлен", "что дела", "формат", "работае", "предлага"])) {
      return {
        text:
          "Динара чаще всего делает:\n\n" +
          "• ролики для бизнеса и гастро\n" +
          "• скетчи и мини-сериалы\n" +
          "• детские праздничные истории\n" +
          "• подростковый контент для соцсетей\n\n" +
          "Что ближе вашей задаче?",
      };
    }

    if (hasAny(q, ["привет", "здравств", "добрый", "доброе", "hi", "hello", "хай"])) {
      return {
        text: `Здравствуйте! Я ${CHAT_NAME}. Чем помочь — выбрать формат, сориентировать по каталогу или разобрать вашу задачу?`,
      };
    }

    if (hasAny(q, ["кто ты", "о себе", "кто вы", "кто такая"])) {
      return {
        text: `Я ${CHAT_NAME}, AI-консультант на сайте Динары. Помогаю выбрать формат AI-видео. Если понадобится личный разговор — тогда уже передам Динаре.`,
      };
    }

    if (hasAny(q, ["спасибо", "благодар", "отлично", "супер", "класс"])) {
      return {
        text: "Пожалуйста. Если появятся ещё вопросы по формату — пишите сюда.",
      };
    }

    if (products.length) {
      const lead =
        products.length === 1
          ? `Похоже, вам близко «${products[0].title}».`
          : "Похоже, из каталога вам подойдёт вот это:";
      return {
        text: `${lead}\n\nМогу рассказать подробнее или помочь сравнить с другими форматами.`,
        cards: products,
      };
    }

    return {
      text:
        "Расскажите чуть конкретнее: для кого ролик, куда выложите и есть ли срок? Подскажу подходящий формат.",
    };
  }

  function loadHistory() {
    try {
      const raw = sessionStorage.getItem(CHAT_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveHistory(messages) {
    try {
      sessionStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      try {
        const lighter = messages.slice(-20).map((m) => ({
          ...m,
          attachments: (m.attachments || []).map(({ thumb, ...rest }) => rest),
        }));
        sessionStorage.setItem(CHAT_KEY, JSON.stringify(lighter));
      } catch {
        /* ignore */
      }
    }
  }

  function slimCard(product) {
    return {
      title: String(product.title || ""),
      description: String(product.description || "").slice(0, 110),
      price: productPrice(product),
    };
  }

  function cardHtml(card) {
    const desc = htmlEscape(card.description || "");
    return `
      <article class="ai-chat__card">
        <strong>${htmlEscape(card.title)}</strong>
        <span>${htmlEscape(card.price)}</span>
        ${desc ? `<em>${desc}</em>` : ""}
      </article>`;
  }

  function attachmentsHtml(list) {
    if (!list || !list.length) return "";
    return `<div class="ai-chat__msg-files">${list
      .map((a) => {
        if (a.kind === "image" && /^data:image\/jpeg;base64,/.test(a.thumb || "")) {
          return `<span class="ai-chat__msg-thumb"><img src="${htmlEscape(a.thumb)}" alt="${htmlEscape(a.name)}" /></span>`;
        }
        return `<span class="ai-chat__msg-file">${htmlEscape(a.name)}</span>`;
      })
      .join("")}</div>`;
  }

  function bubbleHtml(msg) {
    const role = msg.role === "user" ? "user" : "bot";
    const cards =
      role === "bot" && msg.cards?.length
        ? `<div class="ai-chat__cards">${msg.cards.map(cardHtml).join("")}</div>`
        : "";
    const files = role === "user" ? attachmentsHtml(msg.attachments) : "";
    return `<div class="ai-chat__bubble ai-chat__bubble--${role}">${files}${textToHtml(msg.text)}${cards}</div>`;
  }

  function typingHtml() {
    return `<div class="ai-chat__bubble ai-chat__bubble--bot" data-typing><span class="ai-chat__typing" aria-label="${htmlEscape(CHAT_NAME)} печатает"><i></i><i></i><i></i></span></div>`;
  }

  // Ответ модели — недоверенный текст: всё экранируется, ссылками становятся только http(s)-адреса.
  const LINK_RE =
    /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s()<>"]+)\)|(https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]»'])/g;

  function linkHtml(url, label) {
    return `<a href="${htmlEscape(url)}" target="_blank" rel="noopener noreferrer">${htmlEscape(label)}</a>`;
  }

  function inlineHtml(text) {
    return htmlEscape(text).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  }

  function textToHtml(text) {
    const src = String(text || "").replace(/^#{1,6}\s+/gm, "");
    let out = "";
    let last = 0;
    for (const match of src.matchAll(LINK_RE)) {
      out += inlineHtml(src.slice(last, match.index));
      out += match[2] ? linkHtml(match[2], match[1]) : linkHtml(match[3], match[3]);
      last = match.index + match[0].length;
    }
    out += inlineHtml(src.slice(last));
    return out.replace(/\n/g, "<br />");
  }

  async function mount() {
    if (document.getElementById("ai-chat")) return;
    await loadSiteConfig();

    const avatarLetter = (CHAT_NAME || "А").charAt(0).toUpperCase();
    const root = document.createElement("div");
    root.className = "ai-chat";
    root.id = "ai-chat";
    root.innerHTML = `
      <div class="ai-chat__panel" id="ai-chat-panel" hidden role="dialog" aria-labelledby="ai-chat-title">
        <div class="ai-chat__resize ai-chat__resize--h" id="ai-chat-resize-h" role="separator" aria-orientation="horizontal" aria-label="Изменить высоту чата" tabindex="0"></div>
        <div class="ai-chat__resize ai-chat__resize--w" id="ai-chat-resize-w" role="separator" aria-orientation="vertical" aria-label="Изменить ширину чата" tabindex="0"></div>
        <div class="ai-chat__resize ai-chat__resize--corner" id="ai-chat-resize-corner" aria-label="Изменить размер чата"></div>
        <div class="ai-chat__head">
          <span class="ai-chat__avatar" aria-hidden="true">${htmlEscape(avatarLetter)}</span>
          <div class="ai-chat__who">
            <p class="ai-chat__name" id="ai-chat-title">${htmlEscape(CHAT_NAME)}</p>
            <p class="ai-chat__status">AI-консультант · онлайн</p>
          </div>
          <div class="ai-chat__head-actions">
            <button type="button" class="ai-chat__size-btn ai-chat__minimize" id="ai-chat-minimize" aria-label="Свернуть чат" title="Свернуть">${ICONS.minimize}</button>
          </div>
        </div>
        <div class="ai-chat__log" id="ai-chat-log" role="log" aria-live="polite"></div>
        <div class="ai-chat__attach-list" id="ai-chat-attach-list" hidden></div>
        <form class="ai-chat__form" id="ai-chat-form">
          <input
            type="file"
            id="ai-chat-file"
            hidden
            multiple
            accept="image/*,.txt,.md,.csv,.json,.pdf,.doc,.docx,text/plain,text/markdown,text/csv,application/json,application/pdf"
          />
          <button type="button" class="ai-chat__attach-btn" id="ai-chat-attach-btn" aria-label="Прикрепить файл или изображение" title="Файл или фото">+</button>
          <input class="ai-chat__input" id="ai-chat-input" type="text" maxlength="500" autocomplete="off" placeholder="Напишите ${htmlEscape(CHAT_NAME)}…" />
          <button class="ai-chat__send" type="submit" aria-label="Отправить">${ICONS.send}</button>
        </form>
      </div>
      <button type="button" class="ai-chat__fab" id="ai-chat-open" aria-label="Открыть чат с ${htmlEscape(CHAT_NAME)}" aria-expanded="false" aria-controls="ai-chat-panel">
        <span class="ai-chat__fab-pulse" aria-hidden="true"></span>
        <span class="ai-chat__fab-icon">${ICONS.chat}</span>
      </button>
    `;
    document.body.appendChild(root);

    const panel = document.getElementById("ai-chat-panel");
    const log = document.getElementById("ai-chat-log");
    const form = document.getElementById("ai-chat-form");
    const input = document.getElementById("ai-chat-input");
    const sendBtn = form.querySelector(".ai-chat__send");
    const openBtn = document.getElementById("ai-chat-open");
    const resizeH = document.getElementById("ai-chat-resize-h");
    const resizeW = document.getElementById("ai-chat-resize-w");
    const resizeCorner = document.getElementById("ai-chat-resize-corner");
    const attachBtn = document.getElementById("ai-chat-attach-btn");
    const fileInput = document.getElementById("ai-chat-file");
    const attachList = document.getElementById("ai-chat-attach-list");

    const MAX_ATTACH = 4;
    const MAX_TEXT_FILE_BYTES = 4 * 1024 * 1024;
    const MAX_IMAGE_SOURCE_BYTES = 25 * 1024 * 1024;
    const MAX_FILE_TEXT = 20000;
    // Фото ужимаются перед отправкой: иначе несколько снимков с телефона не пролезают в запрос
    // и зря тратят токены.
    const IMAGE_MAX_SIDE = 1600;
    const THUMB_MAX_SIDE = 200;
    let pendingFiles = [];
    let addingFiles = false;

    function isImageFile(file) {
      return /^image\//i.test(file.type) && !/heic|heif/i.test(file.type);
    }

    function isHeicFile(file) {
      return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || "");
    }

    function isTextFile(file) {
      if (/^text\//i.test(file.type)) return true;
      return /\.(txt|md|csv|json|log)$/i.test(file.name || "");
    }

    function loadImage(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve(img);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("Не удалось открыть изображение"));
        };
        img.src = url;
      });
    }

    function imageToJpeg(img, maxSide, quality) {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      if (!width || !height) throw new Error("Пустое изображение");
      const scale = Math.min(1, maxSide / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", quality);
    }

    function readAsText(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
        reader.readAsText(file);
      });
    }

    function renderPending() {
      if (!attachList) return;
      if (!pendingFiles.length) {
        attachList.hidden = true;
        attachList.innerHTML = "";
        return;
      }
      attachList.hidden = false;
      attachList.innerHTML = pendingFiles
        .map((f, i) => {
          if (f.kind === "image" && f.thumb) {
            return `<div class="ai-chat__pending ai-chat__pending--img"><img src="${htmlEscape(f.thumb)}" alt="" /><button type="button" data-remove="${i}" aria-label="Убрать">×</button></div>`;
          }
          return `<div class="ai-chat__pending"><span>${htmlEscape(f.name)}</span><button type="button" data-remove="${i}" aria-label="Убрать">×</button></div>`;
        })
        .join("");
    }

    async function addFiles(fileList) {
      const files = Array.from(fileList || []);
      addingFiles = true;
      try {
        for (const file of files) {
          if (pendingFiles.length >= MAX_ATTACH) {
            alert(`Можно прикрепить максимум ${MAX_ATTACH} файла.`);
            break;
          }
          if (isHeicFile(file)) {
            alert(`«${file.name}»: формат HEIC не поддерживается. Сохраните фото как JPG или PNG.`);
            continue;
          }
          try {
            if (isImageFile(file)) {
              if (file.size > MAX_IMAGE_SOURCE_BYTES) {
                alert(`«${file.name}» слишком большой. Максимум 25 МБ.`);
                continue;
              }
              const img = await loadImage(file);
              pendingFiles.push({
                name: file.name,
                mime: "image/jpeg",
                kind: "image",
                dataUrl: imageToJpeg(img, IMAGE_MAX_SIDE, 0.85),
                thumb: imageToJpeg(img, THUMB_MAX_SIDE, 0.7),
              });
            } else if (isTextFile(file)) {
              if (file.size > MAX_TEXT_FILE_BYTES) {
                alert(`«${file.name}» слишком большой. Максимум 4 МБ.`);
                continue;
              }
              const text = await readAsText(file);
              pendingFiles.push({
                name: file.name,
                mime: file.type || "text/plain",
                kind: "text",
                text: text.slice(0, MAX_FILE_TEXT),
              });
            } else {
              pendingFiles.push({
                name: file.name,
                mime: file.type || "application/octet-stream",
                kind: "file",
              });
            }
          } catch {
            alert(`Не удалось добавить «${file.name}».`);
          }
          renderPending();
        }
      } finally {
        addingFiles = false;
        renderPending();
      }
    }

    attachBtn?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", () => {
      addFiles(fileInput.files);
      fileInput.value = "";
    });
    attachList?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove]");
      if (!btn) return;
      pendingFiles.splice(Number(btn.dataset.remove), 1);
      renderPending();
    });

    const HEIGHT_KEY = "dinara_ai_chat_height";
    const WIDTH_KEY = "dinara_ai_chat_width";
    const MIN_HEIGHT = 280;
    const MIN_WIDTH = 280;
    const STEP_H = 56;
    const STEP_W = 40;

    function maxHeight() {
      return Math.max(MIN_HEIGHT, window.innerHeight - 88);
    }

    function maxWidth() {
      return Math.max(MIN_WIDTH, Math.min(640, window.innerWidth - 24));
    }

    function clampHeight(value) {
      return Math.min(maxHeight(), Math.max(MIN_HEIGHT, Math.round(value)));
    }

    function clampWidth(value) {
      return Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(value)));
    }

    function applyHeight(value, save) {
      const next = clampHeight(value);
      panel.style.height = `${next}px`;
      panel.style.maxHeight = `${maxHeight()}px`;
      if (save) {
        try {
          localStorage.setItem(HEIGHT_KEY, String(next));
        } catch {
          /* ignore */
        }
      }
      return next;
    }

    function applyWidth(value, save) {
      const next = clampWidth(value);
      panel.style.width = `${next}px`;
      panel.style.maxWidth = `${maxWidth()}px`;
      if (save) {
        try {
          localStorage.setItem(WIDTH_KEY, String(next));
        } catch {
          /* ignore */
        }
      }
      return next;
    }

    function currentHeight() {
      return panel.getBoundingClientRect().height || MIN_HEIGHT;
    }

    function currentWidth() {
      return panel.getBoundingClientRect().width || MIN_WIDTH;
    }

    function restoreSize() {
      let savedH = 0;
      let savedW = 0;
      try {
        savedH = Number(localStorage.getItem(HEIGHT_KEY)) || 0;
        savedW = Number(localStorage.getItem(WIDTH_KEY)) || 0;
      } catch {
        /* ignore */
      }
      applyHeight(savedH || Math.min(560, window.innerHeight * 0.72), false);
      applyWidth(savedW || Math.min(380, window.innerWidth - 24), false);
    }

    restoreSize();

    let resizeState = null;

    function onResizeMove(e) {
      if (!resizeState) return;
      if (e.cancelable) e.preventDefault();
      const point = e.touches ? e.touches[0] : e;
      if (resizeState.axis === "h" || resizeState.axis === "both") {
        applyHeight(resizeState.startHeight + (resizeState.startY - point.clientY), false);
      }
      if (resizeState.axis === "w" || resizeState.axis === "both") {
        applyWidth(resizeState.startWidth + (resizeState.startX - point.clientX), false);
      }
    }

    function onResizeEnd() {
      if (!resizeState) return;
      panel.classList.remove("is-resizing", "is-resizing-h", "is-resizing-w");
      applyHeight(currentHeight(), true);
      applyWidth(currentWidth(), true);
      resizeState = null;
      window.removeEventListener("pointermove", onResizeMove);
      window.removeEventListener("pointerup", onResizeEnd);
      window.removeEventListener("touchmove", onResizeMove);
      window.removeEventListener("touchend", onResizeEnd);
    }

    function startResize(axis, clientX, clientY) {
      resizeState = {
        axis,
        startX: clientX,
        startY: clientY,
        startHeight: currentHeight(),
        startWidth: currentWidth(),
      };
      panel.classList.add("is-resizing");
      if (axis === "h" || axis === "both") panel.classList.add("is-resizing-h");
      if (axis === "w" || axis === "both") panel.classList.add("is-resizing-w");
      window.addEventListener("pointermove", onResizeMove);
      window.addEventListener("pointerup", onResizeEnd);
      window.addEventListener("touchmove", onResizeMove, { passive: false });
      window.addEventListener("touchend", onResizeEnd);
    }

    function bindResizeHandle(el, axis) {
      el?.addEventListener("pointerdown", (e) => {
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        startResize(axis, e.clientX, e.clientY);
      });
    }

    bindResizeHandle(resizeH, "h");
    bindResizeHandle(resizeW, "w");
    bindResizeHandle(resizeCorner, "both");

    resizeH?.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        applyHeight(currentHeight() + STEP_H, true);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        applyHeight(currentHeight() - STEP_H, true);
      }
    });

    resizeW?.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        applyWidth(currentWidth() + STEP_W, true);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        applyWidth(currentWidth() - STEP_W, true);
      }
    });

    window.addEventListener("resize", () => {
      if (!panel.hidden) {
        applyHeight(currentHeight(), true);
        applyWidth(currentWidth(), true);
      }
    });

    const heroActions = document.querySelector(".hero__actions");
    if (heroActions) {
      root.classList.add("ai-chat--hero");
      heroActions.appendChild(openBtn);
    }

    let messages = loadHistory();
    let busy = false;

    function redraw() {
      log.innerHTML = messages.map(bubbleHtml).join("");
      log.scrollTop = log.scrollHeight;
    }

    function openChat() {
      panel.hidden = false;
      root.classList.add("is-open");
      openBtn.classList.add("is-open");
      openBtn.setAttribute("aria-expanded", "true");
      if (!messages.length) {
        messages.push({ role: "bot", text: greetingText() });
        saveHistory(messages);
      }
      redraw();
      setTimeout(() => input.focus(), 50);
    }

    function closeChat() {
      panel.hidden = true;
      root.classList.remove("is-open");
      openBtn.classList.remove("is-open");
      openBtn.setAttribute("aria-expanded", "false");
      openBtn.focus();
    }

    function pushUser(text, attachments) {
      const files = attachments || [];
      messages.push({
        role: "user",
        text,
        attachments: files.map((a) => ({
          name: a.name,
          mime: a.mime,
          kind: a.kind,
          thumb: a.kind === "image" ? a.thumb : undefined,
        })),
      });
      saveHistory(messages);
      redraw();
    }

    function pushBot(reply) {
      messages.push({
        role: "bot",
        text: String(reply?.text || ""),
        cards: (reply?.cards || []).map(slimCard),
      });
      saveHistory(messages);
      redraw();
    }

    function setBusy(value) {
      busy = value;
      sendBtn.disabled = value;
    }

    function errorReply(err, value, files) {
      if (err?.status === 413) {
        return { text: "Вложения получились слишком большими. Отправьте их по одному или уменьшите файл." };
      }
      if (err?.status === 429) {
        return { text: "Слишком много сообщений подряд. Подождите минуту и напишите снова." };
      }
      if (err?.fallback !== false) return replyWithAttachments(value, files);
      return {
        text: "Сейчас не удалось ответить. Попробуйте ещё раз чуть позже — или спросите про формат здесь.",
      };
    }

    async function ask(value, files) {
      setBusy(true);
      pushUser(value, files);
      log.insertAdjacentHTML("beforeend", typingHtml());
      log.scrollTop = log.scrollHeight;

      let reply;
      try {
        if (API_READY) {
          reply = await askApi(value, messages.slice(0, -1), files);
        } else {
          const delay = Math.min(1100, 420 + value.length * 8);
          await new Promise((resolve) => setTimeout(resolve, delay));
          reply = replyWithAttachments(value, files);
        }
      } catch (err) {
        reply = errorReply(err, value, files);
      } finally {
        log.querySelector("[data-typing]")?.remove();
        pushBot(reply || errorReply(null, value, files));
        setBusy(false);
      }
    }

    openBtn.addEventListener("click", () => {
      if (panel.hidden) openChat();
      else closeChat();
    });

    function trapWheel(e) {
      if (panel.hidden) return;
      e.preventDefault();
      e.stopPropagation();
      log.scrollTop += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    }

    panel.addEventListener("wheel", trapWheel, { passive: false });
    root.addEventListener("wheel", trapWheel, { passive: false });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      // Пока ждём ответ или обрабатываем фото, текст и вложения остаются в форме, а не теряются.
      if (busy || addingFiles) return;
      const value = input.value.trim();
      const files = pendingFiles.slice();
      if (!value && !files.length) return;
      input.value = "";
      pendingFiles = [];
      renderPending();
      ask(value, files);
    });

    document.getElementById("ai-chat-minimize")?.addEventListener("click", closeChat);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !panel.hidden) closeChat();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();

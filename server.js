/**
 * Локальный сервер без npm-зависимостей: статика + /api/chat (ядро ai/) + /api/config + /api/orders + /api/catalog.pdf.
 * Каталог, заказы, клиенты и сессии админки — в SQLite (DATA_DIR/DB_FILENAME, модуль db.js).
 * Запуск: start.cmd (или `node server.js`)
 */
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { createAi } = require("./ai");
const store = require("./db");
const { renderCatalogPdf } = require("./pdf/catalog");
const { renderInvoicePdf, invoiceNumber } = require("./pdf/invoice");
const { formatMoney, productAmount, productCurrency, productPriceText, phoneKey, priceOrderItems, stockShortage, clientIp: resolveClientIp } = require("./orderPrice");

const ROOT = __dirname;

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv(path.join(ROOT, ".env"));

function envText(name) {
  return String(process.env[name] ?? "").trim();
}

function failStartup(message) {
  console.error(message);
  process.exit(1);
}

const REQUIRED_ENV = ["PORT", "OPENAI_API_KEY", "WA_PHONE", "TG_USER", "SESSION_SECRET", "DATA_DIR"];
const missingEnv = REQUIRED_ENV.filter((name) => !envText(name));
if (missingEnv.length) {
  console.error("Сервер не запущен. Не заданы обязательные переменные:");
  for (const name of missingEnv) console.error(`- ${name}`);
  console.error("Добавьте их в окружение или в файл .env и запустите сервер снова.");
  process.exit(1);
}

function envInt(name, fallback) {
  const raw = envText(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    failStartup(`Переменная ${name} должна быть целым числом больше нуля.`);
  }
  return value;
}

const PORT = envInt("PORT");
if (!PORT || PORT > 65535) failStartup("Переменная PORT должна быть целым числом от 1 до 65535.");
// По умолчанию сайт открыт только с этого компьютера; в Docker задайте HOST=0.0.0.0.
const HOST = envText("HOST") || "127.0.0.1";
const OPENAI_API_KEY = envText("OPENAI_API_KEY");
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(
  /\/$/,
  ""
);
const OPENAI_MODEL = envText("OPENAI_MODEL") || "gpt-4o-mini";
// Только для reasoning-моделей (gpt-5*, o*): low / medium / high. Для gpt-4o-mini оставьте пустым.
const OPENAI_REASONING_EFFORT = envText("OPENAI_REASONING_EFFORT");
const OPENAI_TIMEOUT_MS = envInt("OPENAI_TIMEOUT_MS", 45000);
const CHAT_LIMIT_PER_MINUTE = envInt("CHAT_LIMIT_PER_MINUTE", 12);
const CHAT_LIMIT_PER_DAY = envInt("CHAT_LIMIT_PER_DAY", 300);
const CHAT_GLOBAL_PER_MINUTE = envInt("CHAT_GLOBAL_PER_MINUTE", 30);
const CHAT_GLOBAL_PER_DAY = envInt("CHAT_GLOBAL_PER_DAY", 800);
const CHAT_MAX_INFLIGHT = envInt("CHAT_MAX_INFLIGHT", 4);
const WA_PHONE = envText("WA_PHONE");
const TG_USER = envText("TG_USER");
const ADMIN_PASS = envText("ADMIN_PASSWORD") || envText("ADMIN_PASS");
// Этот пароль был записан в публичном admin.js — его знает любой, кто открывал файл.
const LEAKED_ADMIN_PASSES = new Set(["dinara2026"]);
const CHAT_NAME = envText("CHAT_NAME") || "Асель";
const DATA_DIR = path.resolve(ROOT, envText("DATA_DIR"));
const DB_FILENAME = envText("DB_FILENAME") || "dinara.sqlite";
if (path.basename(DB_FILENAME) !== DB_FILENAME) {
  failStartup("DB_FILENAME должен быть именем файла, без пути.");
}
const CHROME_PATH = envText("CHROME_PATH");
const PDF_TIMEOUT_MS = envInt("PDF_TIMEOUT_MS", 30000);
process.env.CHROME_PATH = CHROME_PATH;
process.env.PDF_TIMEOUT_MS = String(PDF_TIMEOUT_MS);
const LOG_LEVELS = new Set(["error", "info", "debug"]);
const LOG_LEVEL = (envText("LOG_LEVEL") || "info").toLowerCase();
if (!LOG_LEVELS.has(LOG_LEVEL)) failStartup("LOG_LEVEL должен быть error, info или debug.");
const ENABLE_DEMO_RESET = /^(1|true|yes)$/i.test(envText("ENABLE_DEMO_RESET"));
const SESSION_SECRET = envText("SESSION_SECRET");
const ORDER_LIMIT_PER_10_MIN = Number(process.env.ORDER_LIMIT_PER_10_MIN) || 5;
const ORDER_LIMIT_PER_DAY = Number(process.env.ORDER_LIMIT_PER_DAY) || 20;
// Включать для прокси на другом компьютере. Прокси на этой же машине (127.0.0.1, nginx, ngrok)
// учитывается сам: иначе все посетители выглядели бы как один адрес и делили лимиты заказов и входа.
const TRUST_PROXY = /^(1|true|yes)$/i.test((process.env.TRUST_PROXY || "").trim());
const LOGIN_MAX_FAILS = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN_SESSION_MS = 7 * DAY_MS;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_SMALL_BODY_BYTES = 64 * 1024;
const MAX_PRODUCTS_BYTES = 30 * 1024 * 1024;
const MAX_PRODUCTS = 200;
const UPLOADS_DIR = path.join(ROOT, "uploads");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const PRIVATE_FILES = new Set([
  "server.js",
  "db.js",
  "package.json",
  "package-lock.json",
  "start.cmd",
  "products.json",
  "orders.json",
  "clients.json",
  "dinara.sqlite",
]);
// .json и .sqlite — данные (заказы, клиенты, каталог и их копии), .bak/.tmp — служебные копии.
const PRIVATE_EXT = new Set([
  ".log",
  ".cmd",
  ".vbs",
  ".json",
  ".bak",
  ".tmp",
  ".sqlite",
  ".sqlite-wal",
  ".sqlite-shm",
]);

// Каталог, промпт и вызов модели живут в ai/. Здесь только чтение каталога из SQLite.
const ai = createAi({
  apiKey: OPENAI_API_KEY,
  baseUrl: OPENAI_BASE_URL,
  model: OPENAI_MODEL,
  reasoningEffort: OPENAI_REASONING_EFFORT,
  timeoutMs: OPENAI_TIMEOUT_MS,
  chatName: CHAT_NAME,
  waPhone: WA_PHONE,
  tgUser: TG_USER,
  readProducts: () => readProductsFile() || [],
  productsMtime: () => productsVersion(),
  priceText: productPriceText,
});

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function logEvent(level, message, extra = {}) {
  const rank = { error: 0, info: 1, debug: 2 };
  if ((rank[level] ?? 1) > rank[LOG_LEVEL]) return;
  const entry = {
    time: new Date().toISOString(),
    level,
    route: extra.route || "",
    status: extra.status ?? "",
    message: String(message || ""),
    stack: extra.stack || "",
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else console.log(line);
}

function sendFile(res, filePath, headers, route) {
  res.writeHead(200, headers);
  const stream = fs.createReadStream(filePath);
  stream.on("error", (err) => {
    logEvent("error", err.message || "Не удалось отдать файл", {
      route: route || "static",
      status: 500,
      stack: err.stack || "",
    });
    res.destroy();
  });
  stream.pipe(res);
}

function readJsonBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    // При превышении лимита дочитываем тело вхолостую, чтобы клиент успел получить ответ 413,
    // а не оборванное соединение. Совсем огромные тела всё же рвём.
    req.on("data", (chunk) => {
      size += chunk.length;
      if (tooLarge) {
        if (size > limit * 4) req.destroy();
        return;
      }
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        reject(Object.assign(new Error("Слишком большой запрос"), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) return;
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("Некорректный JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function createLimiter(bucket, rules) {
  const longest = Math.max(...rules.map((rule) => rule.windowMs));
  const hitsOf = (key, now) => store.rateHits(bucket, key, now - longest);

  return {
    limited(key) {
      return Boolean(this.scope(key));
    },
    scope(key) {
      const now = Date.now();
      const list = hitsOf(key, now);
      let found = null;
      for (const rule of rules) {
        if (list.filter((t) => now - t < rule.windowMs).length >= rule.max) {
          found = rule.windowMs >= DAY_MS ? "day" : "minute";
        }
      }
      return found;
    },
    claim(key) {
      return store.claimRateHit(bucket, key, rules);
    },
    hit(key) {
      const now = Date.now();
      store.addRateHit(bucket, key, now);
      return now;
    },
    refund(key, stamp) {
      if (stamp == null) return;
      store.refundRateHit(bucket, key, stamp);
    },
    reset(key) {
      store.clearRateHits(bucket, key);
    },
  };
}

const chatLimiter = createLimiter("chat", [
  { windowMs: 60_000, max: CHAT_LIMIT_PER_MINUTE },
  { windowMs: DAY_MS, max: CHAT_LIMIT_PER_DAY },
]);
const globalChatLimiter = createLimiter("chat-all", [
  { windowMs: 60_000, max: CHAT_GLOBAL_PER_MINUTE },
  { windowMs: DAY_MS, max: CHAT_GLOBAL_PER_DAY },
]);
let chatInFlight = 0;
const orderLimiter = createLimiter("order", [
  { windowMs: 10 * 60_000, max: ORDER_LIMIT_PER_10_MIN },
  { windowMs: DAY_MS, max: ORDER_LIMIT_PER_DAY },
]);
const loginLimiter = createLimiter("login", [{ windowMs: LOGIN_LOCK_MS, max: LOGIN_MAX_FAILS }]);

function clientIp(req) {
  return resolveClientIp(req.socket?.remoteAddress, req.headers["x-forwarded-for"], TRUST_PROXY);
}

function chatLimitBody(scope) {
  if (scope === "day") {
    return { error: "На сегодня сообщений уже много. Напишите завтра.", scope: "day" };
  }
  if (scope === "busy") {
    return { error: "Сейчас много запросов. Попробуйте через несколько секунд.", scope: "busy" };
  }
  return { error: "Слишком много сообщений. Подождите минуту.", scope: "minute" };
}

function refundChat(ip, stamps) {
  if (!stamps) return;
  chatLimiter.refund(ip, stamps.ip);
  globalChatLimiter.refund("all", stamps.global);
}

async function handleChat(req, res) {
  const ip = clientIp(req);
  if (chatInFlight >= CHAT_MAX_INFLIGHT) {
    req.resume();
    sendJson(res, 429, chatLimitBody("busy"));
    return;
  }
  chatInFlight += 1;
  let reserved;
  try {
    reserved = store.immediate(() => {
      const own = chatLimiter.claim(ip);
      if (own.scope) return { scope: own.scope, stamps: null };
      const global = globalChatLimiter.claim("all");
      if (global.scope) {
        chatLimiter.refund(ip, own.stamp);
        return { scope: global.scope, stamps: null };
      }
      return { scope: null, stamps: { ip: own.stamp, global: global.stamp } };
    });
  } catch (err) {
    chatInFlight -= 1;
    throw err;
  }
  if (reserved.scope) {
    chatInFlight -= 1;
    req.resume();
    sendJson(res, 429, chatLimitBody(reserved.scope));
    return;
  }
  const stamps = reserved.stamps;
  const ac = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) ac.abort();
  };
  res.on("close", onClose);
  let started = false;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    refundChat(ip, stamps);
  };
  try {
    const body = await readJsonBody(req);
    const text = String(body?.message || "").trim();
    const files = Array.isArray(body?.attachments) ? body.attachments : [];
    if (!text && !files.length) {
      release();
      if (!res.writableEnded) sendJson(res, 400, { error: "Пустое сообщение" });
      return;
    }
    if (ac.signal.aborted || res.writableEnded) {
      release();
      return;
    }
    started = true;
    const outcome = await ai.reply({
      message: body?.message,
      history: body?.history,
      attachments: body?.attachments,
      signal: ac.signal,
    });
    if (outcome.status === 400 || outcome.status === 502 || outcome.status === 503 || outcome.status === 504) release();
    if (ac.signal.aborted || res.writableEnded) return;
    sendJson(res, outcome.status, outcome.body);
  } catch (err) {
    if (!started || err?.status === 400 || err?.status === 413) release();
    throw err;
  } finally {
    chatInFlight -= 1;
    res.removeListener("close", onClose);
  }
}

function readProductsFile() {
  return store.readProducts();
}

function withAvailability(products) {
  const balances = store.stockBalances();
  return products.map((product) => {
    if (product.kind === "service" || !balances.has(product.id)) return product;
    return { ...product, available: balances.get(product.id) };
  });
}

function productsVersion() {
  return store.productsVersion();
}

function writeProductsFile(products) {
  store.replaceProducts(products);
}

// Origin: null не пускаем: его шлют не только страницы file://, но и iframe с sandbox на любом сайте.
// Страницы file:// products-data.js сам переводит на http://localhost:3000.
function apiCors(req, res) {
  const origin = req.headers.origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || "")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token");
  }
}

const PRODUCT_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const DATA_MEDIA_RE = /^data:(image\/(?:jpeg|png|webp|gif)|video\/mp4);base64,[A-Za-z0-9+/=]+$/;
const MEDIA_EXT = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
};
const UPLOAD_NAME_RE = /^[a-f0-9]{32}\.(jpg|png|webp|gif|mp4)$/;

function isAllowedMedia(src) {
  if (!src) return true;
  if (DATA_MEDIA_RE.test(src)) return true;
  if (/^uploads\/[a-f0-9]{32}\.(jpg|png|webp|gif|mp4)$/.test(src)) return true;
  if (/^[\w-]+\.(jpe?g|png|webp|gif|mp4|webm)$/i.test(src)) return true;
  try {
    const url = new URL(src);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeProducts(raw) {
  if (raw.length > MAX_PRODUCTS) return { error: `Слишком много товаров (максимум ${MAX_PRODUCTS})` };
  const ids = new Set();
  const products = [];
  for (const [index, item] of raw.entries()) {
    const id = String(item?.id || "");
    if (!PRODUCT_ID_RE.test(id) || ids.has(id)) {
      return { error: `Товар №${index + 1}: некорректный или повторяющийся id` };
    }
    ids.add(id);
    const title = String(item.title || "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!title) return { error: `Товар №${index + 1}: пустое название` };
    const amount = String(productAmount(item));
    if (amount.length > 9) return { error: `«${title}»: цена должна быть целым числом до 9 цифр` };
    const currency = productCurrency(item);
    const image = String(item.image || "").trim();
    if (!isAllowedMedia(image)) return { error: `«${title}»: недопустимая ссылка на фото или видео` };
    products.push({
      id,
      title,
      description: String(item.description || "").trim().slice(0, 500),
      amount,
      currency,
      kind: item.kind === "service" ? "service" : "product",
      price: formatMoney(amount, currency),
      image,
    });
  }
  return { products };
}

// Фото и видео храним файлами в uploads/, а в базе только путь:
// иначе каждый посетитель скачивал бы все медиа разом при каждом открытии сайта.
function storeProductMedia(products) {
  let changed = false;
  for (const product of products) {
    const match = /^data:([\w/]+);base64,/.exec(product.image || "");
    if (!match || !MEDIA_EXT[match[1]]) continue;
    const buffer = Buffer.from(product.image.slice(match[0].length), "base64");
    const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 32);
    const name = `${hash}.${MEDIA_EXT[match[1]]}`;
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    const file = path.join(UPLOADS_DIR, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, buffer);
    product.image = `uploads/${name}`;
    changed = true;
  }
  return changed;
}

function productImagesIn(file) {
  try {
    const list = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(list) ? list.map((product) => String(product?.image || "")) : [];
  } catch {
    return [];
  }
}

function backupProductImages() {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) files.push(full);
    }
  };
  walk(path.join(DATA_DIR, "backups"));
  const legacyBackups = path.join(ROOT, "backups");
  if (path.resolve(legacyBackups) !== path.resolve(path.join(DATA_DIR, "backups"))) walk(legacyBackups);
  return files.flatMap(productImagesIn);
}

// Фото, на которые ссылаются старые JSON-копии в backups/, не удаляем:
// иначе каталог, восстановленный из копии, остался бы без картинок.
function removeUnusedUploads(products) {
  let names;
  try {
    names = fs.readdirSync(UPLOADS_DIR);
  } catch {
    return;
  }
  const used = new Set(
    [...products.map((product) => String(product?.image || "")), ...backupProductImages()].map((src) =>
      src.replace(/^uploads\//, "")
    )
  );
  names
    .filter((name) => UPLOAD_NAME_RE.test(name) && !used.has(name))
    .forEach((name) => fs.rmSync(path.join(UPLOADS_DIR, name), { force: true }));
}

function migrateProductsMedia() {
  try {
    const products = readProductsFile();
    if (products && storeProductMedia(products)) {
      writeProductsFile(products);
      console.log("Фото каталога перенесены из базы в папку uploads/");
    }
  } catch (err) {
    console.error("Не удалось перенести фото каталога:", err.message);
  }
}

async function handleProductsPut(req, res) {
  // Проверяем доступ до чтения тела, чтобы посторонний не мог гонять десятки мегабайт.
  if (!isAdminRequest(req)) {
    req.resume();
    sendJson(res, 401, { error: "Нужно войти в админку" });
    return;
  }
  const body = await readJsonBody(req, MAX_PRODUCTS_BYTES);
  if (!Array.isArray(body?.products)) {
    sendJson(res, 400, { error: "Нужен массив products" });
    return;
  }
  const result = normalizeProducts(body.products);
  if (result.error) {
    sendJson(res, 400, { error: result.error });
    return;
  }
  const saved = store.transaction(() => {
    const version = productsVersion();
    if (Number(body.version) !== version) return { conflict: true, version };
    storeProductMedia(result.products);
    writeProductsFile(result.products);
    return { conflict: false, products: result.products, version: productsVersion() };
  });
  if (saved.conflict) {
    sendJson(res, 409, {
      error: "Каталог уже изменили в другой вкладке или на другом устройстве. Список обновлён — повторите изменение.",
      version: saved.version,
    });
    return;
  }
  removeUnusedUploads(saved.products);
  sendJson(res, 200, { ok: true, products: withAvailability(saved.products), version: saved.version });
}

function readOrdersFile() {
  return store.readOrders();
}

function readClientsFile() {
  return store.readClients();
}

function writeClientsFile(clients) {
  store.replaceClients(clients);
}

function syncClientsFromOrders(orders) {
  const previousList = readClientsFile();
  const clients = buildClients(orders, previousList);
  if (JSON.stringify(clients) !== JSON.stringify(previousList)) writeClientsFile(clients);
  return clients;
}

function buildClients(orders, previousList) {
  const previous = new Map(previousList.map((client) => [client.phoneKey, client]));
  const seen = new Map();
  const chronological = orders
    .slice()
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  chronological.forEach((order, index) => {
    const key = phoneKey(order.phone);
    if (!key) return;
    let client = seen.get(key);
    if (!client) {
      const saved = previous.get(key);
      client = {
        id: saved?.id || `c${Date.now().toString(36)}${index}`,
        phoneKey: key,
        name: String(order.name || "").trim(),
        phone: String(order.phone || "").trim(),
        createdAt: saved?.createdAt || order.createdAt,
        updatedAt: order.createdAt,
        lastOrderAt: order.createdAt,
        orderCount: 0,
        cancelledCount: 0,
        channels: [],
        names: Array.isArray(saved?.names) ? saved.names.map(String) : [],
        comment: String(saved?.comment || "").slice(0, 500),
      };
      seen.set(key, client);
    }
    if (order.status === "cancelled") client.cancelledCount += 1;
    else client.orderCount += 1;
    // В карточке — имя из последнего заказа, прежние варианты («жанна» → «дана») не теряем.
    const orderName = String(order.name || "").trim();
    const lower = orderName.toLocaleLowerCase("ru");
    if (orderName && !client.names.some((item) => item.toLocaleLowerCase("ru") === lower)) {
      client.names.push(orderName);
    }
    client.name = String(order.name || client.name).trim();
    client.phone = String(order.phone || client.phone).trim();
    client.updatedAt = order.createdAt;
    client.lastOrderAt = order.createdAt;
    if (order.channel && !client.channels.includes(order.channel)) client.channels.push(order.channel);
  });

  const clients = [...seen.values()];
  // Клиент без заказов остаётся, пока о нём есть заметка, — иначе удаление заказа стирало бы комментарий.
  for (const saved of previousList) {
    if (!saved?.phoneKey || seen.has(saved.phoneKey) || !String(saved.comment || "").trim()) continue;
    seen.set(saved.phoneKey, saved);
    clients.push({ ...saved, orderCount: 0, cancelledCount: 0 });
  }
  clients.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return clients;
}

function publicClient(client) {
  return {
    id: client.id,
    name: client.name,
    phone: client.phone,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    lastOrderAt: client.lastOrderAt,
    orderCount: client.orderCount,
    cancelledCount: Number(client.cancelledCount) || 0,
    channels: client.channels,
    otherNames: (Array.isArray(client.names) ? client.names : []).filter(
      (item) => item.toLocaleLowerCase("ru") !== String(client.name || "").toLocaleLowerCase("ru")
    ),
    comment: String(client.comment || ""),
  };
}

async function handleClientComment(req, res, id) {
  if (!isAdminRequest(req)) {
    req.resume();
    sendJson(res, 401, { error: "Нужно войти в админку" });
    return;
  }
  const body = await readJsonBody(req, MAX_SMALL_BODY_BYTES);
  const comment = String(body?.comment || "").trim().slice(0, 500);
  const saved = store.transaction(() => {
    const clients = syncClientsFromOrders(readOrdersFile());
    const client = clients.find((item) => item.id === id);
    if (!client) return null;
    client.comment = comment;
    writeClientsFile(clients);
    return publicClient(client);
  });
  if (!saved) {
    sendJson(res, 404, { error: "Клиент не найден" });
    return;
  }
  sendJson(res, 200, { ok: true, client: saved });
}

function handleClientDelete(req, res, id) {
  if (!isAdminRequest(req)) {
    req.resume();
    sendJson(res, 401, { error: "Нужно войти в админку" });
    return;
  }
  const removed = store.transaction(() => {
    const orders = readOrdersFile();
    const clients = buildClients(orders, readClientsFile());
    const client = clients.find((item) => item.id === id);
    if (!client) return null;
    const key = client.phoneKey;
    const removedOrderIds = orders.filter((order) => phoneKey(order.phone) === key).map((order) => order.id);
    for (const orderId of removedOrderIds) store.deleteOrder(orderId);
    const nextClients = clients.filter((item) => item.phoneKey !== key);
    writeClientsFile(nextClients);
    return removedOrderIds;
  });
  if (!removed) {
    sendJson(res, 404, { error: "Клиент не найден" });
    return;
  }
  sendJson(res, 200, { ok: true, removedOrderIds: removed });
}

function handleClientsList(req, res) {
  if (!isAdminRequest(req)) {
    req.resume();
    sendJson(res, 401, { error: "Нужно войти в админку" });
    return;
  }
  const clients = syncClientsFromOrders(readOrdersFile()).map(publicClient);
  sendJson(res, 200, { clients });
}

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function adminPassProblem() {
  if (!ADMIN_PASS) return "Пароль админки не задан. Впишите ADMIN_PASSWORD в файл .env и перезапустите сервер.";
  if (LEAKED_ADMIN_PASSES.has(ADMIN_PASS)) {
    return "Этот пароль раньше был виден в коде сайта. Впишите новый ADMIN_PASSWORD в файл .env и перезапустите сервер.";
  }
  return "";
}

const ADMIN_COOKIE = "dinara_admin";

function readCookie(req, name) {
  const header = String(req.headers.cookie || "");
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
}

function adminTokenFromRequest(req) {
  return readCookie(req, ADMIN_COOKIE) || String(req.headers["x-admin-token"] || "");
}

function requestIsHttps(req) {
  if (req.socket?.encrypted) return true;
  // Заголовок учитываем только за своим прокси. Иначе посетитель может прислать его сам,
  // и браузер выбросит cookie входа на обычном http://localhost.
  if (!TRUST_PROXY) return false;
  const forwarded = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  return /^https$/i.test(forwarded);
}

function adminCookie(token, req, clear) {
  const parts = [
    `${ADMIN_COOKIE}=${clear ? "" : encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${clear ? 0 : Math.floor(ADMIN_SESSION_MS / 1000)}`,
  ];
  if (requestIsHttps(req)) parts.push("Secure");
  return parts.join("; ");
}

function isAdminRequest(req) {
  return Boolean(store.sessionExpires(adminTokenFromRequest(req)));
}

async function handleAdminLogin(req, res) {
  const ip = clientIp(req);
  if (loginLimiter.limited(ip)) {
    req.resume();
    sendJson(res, 429, { ok: false, error: "Слишком много неверных попыток. Подождите 15 минут." });
    return;
  }
  const body = await readJsonBody(req, MAX_SMALL_BODY_BYTES);
  const problem = adminPassProblem();
  if (problem) {
    sendJson(res, 503, { ok: false, error: problem });
    return;
  }
  const pass = String(body?.password || "");
  if (!pass || !safeEqual(pass, ADMIN_PASS)) {
    const claim = loginLimiter.claim(ip);
    sendJson(res, claim.scope ? 429 : 401, {
      ok: false,
      error: claim.scope ? "Слишком много неверных попыток. Подождите 15 минут." : "Неверный пароль",
    });
    return;
  }
  loginLimiter.reset(ip);
  const token = crypto.randomBytes(32).toString("hex");
  store.saveSession(token, Date.now() + ADMIN_SESSION_MS);
  res.setHeader("Set-Cookie", adminCookie(token, req, false));
  sendJson(res, 200, { ok: true });
}

function handleAdminSession(req, res) {
  req.resume();
  if (!isAdminRequest(req)) {
    sendJson(res, 401, { ok: false });
    return;
  }
  sendJson(res, 200, { ok: true });
}

function handleAdminLogout(req, res) {
  store.deleteSession(adminTokenFromRequest(req));
  res.setHeader("Set-Cookie", adminCookie("", req, true));
  req.resume();
  sendJson(res, 200, { ok: true });
}

setInterval(() => {
  try {
    store.purgeSessions(Date.now());
  } catch (err) {
    logEvent("error", err.message || "Не удалось очистить сессии", {
      route: "purgeSessions",
      status: 500,
      stack: err.stack || "",
    });
  }
}, 60 * 60 * 1000).unref();

const ORDER_STATUSES = new Set(["new", "progress", "done", "cancelled"]);

function publicOrder(order) {
  return {
    id: order.id,
    number: order.number,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt || order.createdAt,
    name: order.name,
    phone: order.phone,
    channel: order.channel,
    total: order.total,
    status: order.status,
    statusHistory: Array.isArray(order.statusHistory) ? order.statusHistory : [],
    items: order.items,
  };
}

function orderLimitPayload(scope) {
  return {
    error: scope === "day"
      ? "Слишком много заказов за сегодня. Напишите Динаре напрямую."
      : "Слишком много заказов подряд. Напишите Динаре напрямую.",
    scope: scope === "day" ? "day" : "minute",
  };
}

async function handleOrderCreate(req, res) {
  const ip = clientIp(req);
  const limitedScope = orderLimiter.scope(ip);
  if (limitedScope) {
    req.resume();
    sendJson(res, 429, orderLimitPayload(limitedScope));
    return;
  }
  const body = await readJsonBody(req, MAX_SMALL_BODY_BYTES);
  const name = String(body?.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const digits = phoneKey(body?.phone);
  const channel = body?.channel === "telegram" ? "telegram" : body?.channel === "whatsapp" ? "whatsapp" : "";
  const clientOrderId = String(body?.clientOrderId || "");

  if (name.length < 2) {
    sendJson(res, 400, { error: "Укажите имя" });
    return;
  }
  // Международный формат E.164: код страны + номер, не больше 15 цифр.
  if (digits.length < 7 || digits.length > 15) {
    sendJson(res, 400, { error: "Введите номер с кодом страны, например 7 700 123 45 67" });
    return;
  }
  if (!channel) {
    sendJson(res, 400, { error: "Выберите WhatsApp или Telegram" });
    return;
  }

  const validClientId = /^[A-Za-z0-9_-]{8,64}$/.test(clientOrderId);
  const state = {};
  try {
  store.transaction(() => {
    const duplicate = validClientId ? store.readOrderByClientOrderId(clientOrderId) : null;
    if (duplicate) {
      state.duplicate = duplicate;
      return;
    }
    const catalog = readProductsFile();
    const priced = priceOrderItems(body?.items, catalog);
    if (priced.error) {
      state.conflict = priced.error;
      return;
    }
    if (!priced.items.length) {
      state.empty = true;
      return;
    }
    const shortage = stockShortage(priced.items, store.stockBalances());
    if (shortage) {
      state.stock = shortage.error;
      return;
    }
    const claim = orderLimiter.claim(ip);
    if (claim.scope) {
      state.limited = claim.scope;
      return;
    }
    const createdAt = new Date().toISOString();
    const order = {
      id: `o${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`,
      createdAt,
      updatedAt: createdAt,
      name,
      phone: `+${digits}`,
      channel,
      total: priced.total,
      status: "new",
      statusHistory: [{ status: "new", at: createdAt }],
      items: priced.items,
    };
    if (validClientId) order.clientOrderId = clientOrderId;
    state.order = store.insertOrder(order);
    syncClientsFromOrders(readOrdersFile());
  });
  } catch (err) {
    logEvent("error", `Не удалось записать заказ: ${err.message || err}`, {
      route: "POST /api/orders",
      status: 503,
      stack: err.stack || "",
    });
    sendJson(res, 503, {
      error: "Каталог временно недоступен. Заказ не записан. Отправьте его ещё раз чуть позже.",
      retry: false,
    });
    return;
  }
  if (state.duplicate) {
    sendJson(res, 200, { ok: true, order: publicOrder(state.duplicate) });
    return;
  }
  if (state.conflict) {
    sendJson(res, 409, { error: state.conflict });
    return;
  }
  if (state.limited) {
    sendJson(res, 429, orderLimitPayload(state.limited));
    return;
  }
  if (state.stock) {
    sendJson(res, 400, { error: state.stock });
    return;
  }
  if (state.empty || !state.order) {
    sendJson(res, 400, { error: "В заказе нет позиций" });
    return;
  }
  sendJson(res, 201, { ok: true, order: publicOrder(state.order) });
}

function handleStockList(req, res) {
  if (!isAdminRequest(req)) {
    sendJson(res, 401, { error: "Нужно войти в админку" });
    return;
  }
  sendJson(res, 200, { items: store.stockReport() });
}

async function handleStockCreate(req, res) {
  if (!isAdminRequest(req)) {
    req.resume();
    sendJson(res, 401, { error: "Нужно войти в админку" });
    return;
  }
  const body = await readJsonBody(req, MAX_SMALL_BODY_BYTES);
  const productId = String(body?.productId || "");
  const qty = Math.floor(Number(body?.qty));
  const note = String(body?.note || "").trim().slice(0, 200);
  if (!PRODUCT_ID_RE.test(productId)) {
    sendJson(res, 400, { error: "Выберите товар из каталога" });
    return;
  }
  if (!Number.isInteger(qty) || qty < 1 || qty > 9999) {
    sendJson(res, 400, { error: "Количество прихода — целое число от 1 до 9999" });
    return;
  }
  const saved = store.transaction(() => {
    if (!(readProductsFile() || []).some((product) => product.id === productId && product.kind !== "service")) return null;
    store.addStockReceipt({
      id: `s${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`,
      productId,
      qty,
      note,
      createdAt: new Date().toISOString(),
    });
    return store.stockReport();
  });
  if (!saved) {
    const product = (readProductsFile() || []).find((item) => item.id === productId);
    sendJson(res, 400, {
      error: product && product.kind === "service"
        ? "Остатки ведутся только для товаров. Услугу можно заказывать без прихода."
        : "Выберите товар из каталога",
    });
    return;
  }
  sendJson(res, 201, { ok: true, items: saved });
}

function handleStockDelete(req, res, id) {
  if (!isAdminRequest(req)) {
    req.resume();
    sendJson(res, 401, { error: "Нужно войти в админку" });
    return;
  }
  if (!store.deleteStockReceipt(id)) {
    sendJson(res, 404, { error: "Приход не найден" });
    return;
  }
  sendJson(res, 200, { ok: true, items: store.stockReport() });
}

async function handleCatalogPdf(req, res) {
  let products;
  try {
    products = readProductsFile();
  } catch (err) {
    logEvent("error", `Не удалось прочитать каталог для PDF: ${err.message || err}`, {
      route: "GET /api/catalog.pdf",
      status: 503,
      stack: err.stack || "",
    });
    sendJson(res, 503, { error: "Каталог временно недоступен. PDF сейчас не собрать." });
    return;
  }
  try {
    const pdf = await renderCatalogPdf({
      root: ROOT,
      products: Array.isArray(products) ? products : [],
      contacts: { waPhone: WA_PHONE, tgUser: TG_USER },
    });
    const filename = encodeURIComponent("Каталог услуг Динара.pdf");
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": pdf.length,
      "Content-Disposition": `attachment; filename="dinara-catalog.pdf"; filename*=UTF-8''${filename}`,
      "Cache-Control": "no-store",
    });
    res.end(pdf);
  } catch (err) {
    const stderr = String(err?.stderr || "").trim().slice(0, 1500);
    logEvent("error", `Не удалось собрать PDF каталога: ${err?.message || err}`, {
      route: "GET /api/catalog.pdf",
      status: 503,
      stack: [err?.stack, stderr && `stderr: ${stderr}`].filter(Boolean).join("\n"),
    });
    sendJson(res, 503, { error: "Не удалось собрать PDF каталога. Проверьте путь к Chrome в CHROME_PATH." });
  }
}

async function handleInvoicePdf(req, res, id) {
  if (!isAdminRequest(req)) {
    sendJson(res, 401, { error: "Нужно войти в админку" });
    return;
  }
  const order = (readOrdersFile() || []).find((item) => item.id === id);
  if (!order) {
    sendJson(res, 404, { error: "Заказ не найден" });
    return;
  }
  try {
    const pdf = await renderInvoicePdf({
      root: ROOT,
      order,
      contacts: { waPhone: WA_PHONE, tgUser: TG_USER },
    });
    const number = invoiceNumber(order);
    const filename = encodeURIComponent(`Счет ${number}.pdf`);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": pdf.length,
      "Content-Disposition": `attachment; filename="invoice-${number}.pdf"; filename*=UTF-8''${filename}`,
      "Cache-Control": "no-store",
    });
    res.end(pdf);
  } catch (err) {
    const stderr = String(err?.stderr || "").trim().slice(0, 1500);
    logEvent("error", `Не удалось собрать счет: ${err?.message || err}`, {
      route: "GET /api/orders/:id/invoice.pdf",
      status: 503,
      stack: [err?.stack, stderr && `stderr: ${stderr}`].filter(Boolean).join("\n"),
    });
    sendJson(res, 503, { error: "Не удалось собрать счет. Проверьте путь к Chrome в CHROME_PATH." });
  }
}

function handleOrdersList(req, res) {
  if (!isAdminRequest(req)) {
    sendJson(res, 401, { error: "Нужно войти в админку" });
    return;
  }
  const orders = readOrdersFile()
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(publicOrder);
  sendJson(res, 200, { orders });
}

async function handleOrderUpdate(req, res, id) {
  if (!isAdminRequest(req)) {
    req.resume();
    sendJson(res, 401, { error: "Нужно войти в админку" });
    return;
  }
  const body = await readJsonBody(req, MAX_SMALL_BODY_BYTES);
  const status = String(body?.status || "");
  if (!ORDER_STATUSES.has(status)) {
    sendJson(res, 400, { error: "Неизвестный статус" });
    return;
  }
  const state = {};
  store.transaction(() => {
    const order = readOrdersFile().find((item) => item.id === id);
    if (!order) {
      state.missing = true;
      return;
    }
    if (order.status === status) {
      state.order = order;
      return;
    }
    if (order.status === "cancelled" && status !== "cancelled") {
      const shortage = stockShortage(order.items || [], store.stockBalances());
      if (shortage) {
        state.stock = shortage.error;
        return;
      }
    }
    const at = new Date().toISOString();
    state.order = store.updateOrderStatus(id, status, at);
    if (!state.order) {
      state.missing = true;
      return;
    }
    syncClientsFromOrders(readOrdersFile());
  });
  if (state.stock) {
    sendJson(res, 400, { error: state.stock });
    return;
  }
  if (state.missing || !state.order) {
    sendJson(res, 404, { error: "Заказ не найден" });
    return;
  }
  sendJson(res, 200, { ok: true, order: publicOrder(state.order) });
}

function handleOrderDelete(req, res, id) {
  if (!isAdminRequest(req)) {
    req.resume();
    sendJson(res, 401, { error: "Нужно войти в админку" });
    return;
  }
  const removed = store.transaction(() => {
    if (!readOrdersFile().some((item) => item.id === id)) return false;
    store.deleteOrder(id);
    syncClientsFromOrders(readOrdersFile());
    return true;
  });
  if (!removed) {
    sendJson(res, 404, { error: "Заказ не найден" });
    return;
  }
  sendJson(res, 200, { ok: true });
}

const REAL_ROOT = fs.realpathSync.native(ROOT);

// Отдаём только файлы с расширением из MIME: Windows открывает .env и по короткому имени ENV~1,
// а orders.json — по ORDERS~1.JSO или orders.json::$DATA, и такие имена чёрный список не ловит.
const DIST_DIR = path.join(ROOT, "dist");
const SPA_REDIRECTS = {
  "/index.html": "/",
  "/catalog.html": "/catalog",
  "/admin.html": "/admin",
};

function isPublicPath(rel) {
  const segments = rel.split(path.sep);
  const base = segments[segments.length - 1].toLowerCase();
  const ext = path.extname(base);
  const blocked = new Set(["node_modules", "legacy", "src", "dist", "backups", "ai", "data"]);
  return (
    !rel.startsWith("..") &&
    !path.isAbsolute(rel) &&
    !segments.some((seg) => seg.startsWith(".") || blocked.has(seg.toLowerCase())) &&
    Boolean(MIME[ext]) &&
    !PRIVATE_EXT.has(ext) &&
    !PRIVATE_FILES.has(base)
  );
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function serveBuiltFile(pathname, res, onMiss) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return onMiss();
  }
  if (rel.startsWith("/")) rel = rel.slice(1);
  if (!rel || rel.includes("..") || /[:\0]/.test(rel)) return onMiss();
  const filePath = path.normalize(path.join(DIST_DIR, rel));
  const relToDist = path.relative(DIST_DIR, filePath);
  if (relToDist.startsWith("..") || path.isAbsolute(relToDist)) return onMiss();
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return onMiss();
    fs.realpath.native(filePath, (realErr, realPath) => {
      let realDist;
      try {
        realDist = fs.realpathSync.native(DIST_DIR);
      } catch {
        return onMiss();
      }
      const relReal = realErr ? ".." : path.relative(realDist, realPath);
      if (realErr || relReal.startsWith("..") || path.isAbsolute(relReal)) return onMiss();
      const ext = path.extname(realPath).toLowerCase();
      if (!MIME[ext]) return onMiss();
      const headers = {
        "Content-Type": MIME[ext],
        "Content-Length": stat.size,
      };
      if (relReal.split(path.sep)[0] === "assets") {
        headers["Cache-Control"] = "public, max-age=31536000, immutable";
      }
      sendFile(res, realPath, headers, pathname);
    });
  });
}

function serveSpa(res) {
  const indexPath = path.join(DIST_DIR, "index.html");
  fs.stat(indexPath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Фронт ещё не собран. В папке сайта выполните: npm run build");
      return;
    }
    sendFile(res, indexPath, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
    }, "/");
  });
}

function serveStatic(pathname, res) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    rel = pathname;
  }
  if (rel.endsWith("/")) rel += "index.html";
  if (/[:\0]/.test(rel)) return notFound(res);

  const filePath = path.normalize(path.join(ROOT, rel));
  if (!filePath.startsWith(ROOT + path.sep) || !isPublicPath(path.relative(ROOT, filePath))) {
    return notFound(res);
  }

  // Повторная проверка по настоящему имени на диске: регистр букв, короткие имена 8.3, ссылки.
  fs.realpath.native(filePath, (realErr, realPath) => {
    if (realErr || !isPublicPath(path.relative(REAL_ROOT, realPath))) return notFound(res);
    fs.stat(realPath, (err, stat) => {
      if (err || !stat.isFile()) return notFound(res);
      const base = path.basename(realPath);
      const headers = {
        "Content-Type": MIME[path.extname(base).toLowerCase()],
        "Content-Length": stat.size,
      };
      // Имя файла в uploads/ — хэш содержимого, поэтому его можно кэшировать навсегда.
      if (UPLOAD_NAME_RE.test(base) && path.relative(REAL_ROOT, path.dirname(realPath)) === "uploads") {
        headers["Cache-Control"] = "public, max-age=31536000, immutable";
      }
      sendFile(res, realPath, headers, pathname);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  try {
    if (pathname.startsWith("/api/")) {
      apiCors(req, res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    if ((pathname === "/health" || pathname === "/api/health") && req.method === "GET") {
      try {
        store.ping();
        sendJson(res, 200, { status: "ok" });
      } catch (err) {
        logEvent("error", `Healthcheck: ${err.message || err}`, {
          route: "GET /health",
          status: 503,
          stack: err.stack || "",
        });
        sendJson(res, 503, { status: "error" });
      }
      return;
    }

    if (pathname === "/api/config" && req.method === "GET") {
      sendJson(res, 200, {
        waPhone: WA_PHONE,
        tgUser: TG_USER,
        chatName: CHAT_NAME,
        chatApi: true,
        aiReady: Boolean(OPENAI_API_KEY),
        demoReset: ENABLE_DEMO_RESET,
      });
      return;
    }

    if (pathname === "/api/admin/login" && req.method === "POST") {
      await handleAdminLogin(req, res);
      return;
    }

    if (pathname === "/api/admin/session" && req.method === "GET") {
      handleAdminSession(req, res);
      return;
    }

    if (pathname === "/api/admin/logout" && req.method === "POST") {
      handleAdminLogout(req, res);
      return;
    }

    if (pathname === "/api/catalog.pdf" && req.method === "GET") {
      await handleCatalogPdf(req, res);
      return;
    }

    if (pathname === "/api/products") {
      if (req.method === "GET") {
        const products = withAvailability(readProductsFile());
        sendJson(res, 200, { products, version: productsVersion() });
        return;
      }
      if (req.method === "PUT") {
        await handleProductsPut(req, res);
        return;
      }
    }

    if (pathname === "/api/chat" && req.method === "POST") {
      await handleChat(req, res);
      return;
    }

    if (pathname === "/api/clients" && req.method === "GET") {
      handleClientsList(req, res);
      return;
    }

    const clientMatch = pathname.match(/^\/api\/clients\/([A-Za-z0-9_-]{4,40})$/);
    if (clientMatch && req.method === "PATCH") {
      await handleClientComment(req, res, clientMatch[1]);
      return;
    }
    if (clientMatch && req.method === "DELETE") {
      handleClientDelete(req, res, clientMatch[1]);
      return;
    }

    if (pathname === "/api/stock" && req.method === "GET") {
      handleStockList(req, res);
      return;
    }

    if (pathname === "/api/stock" && req.method === "POST") {
      await handleStockCreate(req, res);
      return;
    }

    const stockMatch = pathname.match(/^\/api\/stock\/([A-Za-z0-9_-]{4,40})$/);
    if (stockMatch && req.method === "DELETE") {
      handleStockDelete(req, res, stockMatch[1]);
      return;
    }

    if (pathname === "/api/orders" && req.method === "GET") {
      handleOrdersList(req, res);
      return;
    }

    if (pathname === "/api/orders" && req.method === "POST") {
      await handleOrderCreate(req, res);
      return;
    }

    const invoiceMatch = pathname.match(/^\/api\/orders\/([A-Za-z0-9_-]{4,40})\/invoice\.pdf$/);
    if (invoiceMatch && req.method === "GET") {
      await handleInvoicePdf(req, res, invoiceMatch[1]);
      return;
    }

    const orderMatch = pathname.match(/^\/api\/orders\/([A-Za-z0-9_-]{4,40})$/);
    if (orderMatch && req.method === "PATCH") {
      await handleOrderUpdate(req, res, orderMatch[1]);
      return;
    }
    if (orderMatch && req.method === "DELETE") {
      handleOrderDelete(req, res, orderMatch[1]);
      return;
    }

    if (pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }

    if (SPA_REDIRECTS[pathname]) {
      res.writeHead(301, { Location: SPA_REDIRECTS[pathname] });
      res.end();
      return;
    }

    if (path.extname(pathname)) {
      serveBuiltFile(pathname, res, () => serveStatic(pathname, res));
      return;
    }

    serveSpa(res);
  } catch (err) {
    const status = err.status || 500;
    if (!err.status || status >= 500) {
      logEvent("error", err.message || "Ошибка сервера", {
        route: `${req.method} ${pathname}`,
        status,
        stack: err.stack || "",
      });
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    sendJson(res, status, { error: err.status ? err.message : "Ошибка сервера" });
  }
});

function stopAfterFatal(kind, err) {
  const error = err instanceof Error ? err : new Error(String(err));
  try {
    logEvent("error", error.message || kind, {
      route: kind,
      status: 500,
      stack: error.stack || "",
    });
  } catch (logErr) {
    console.error(logErr);
  }
  process.exit(1);
}

process.on("uncaughtException", (err) => stopAfterFatal("uncaughtException", err));
process.on("unhandledRejection", (err) => stopAfterFatal("unhandledRejection", err));

// Код 2 = сервер уже запущен; run-server.cmd по нему понимает, что перезапускать не нужно.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`Порт ${PORT} уже занят — сервер, видимо, уже работает.`);
    process.exit(2);
  }
  console.error("Ошибка сервера:", err);
  process.exit(1);
});

try {
  store.setSessionSecret(SESSION_SECRET);
  store.open(ROOT, { dataDir: DATA_DIR, dbFilename: DB_FILENAME });
} catch (err) {
  console.error("Не удалось открыть базу SQLite:", err.message);
  process.exit(1);
}

if (!CHROME_PATH) {
  console.error("CHROME_PATH не задан. PDF пока собрать нельзя.");
} else if (!fs.existsSync(CHROME_PATH)) {
  console.error(`CHROME_PATH не найден (${CHROME_PATH}). PDF пока собрать нельзя.`);
}

migrateProductsMedia();

function tlsCredentials() {
  const certFile = (process.env.TLS_CERT || "").trim();
  const keyFile = (process.env.TLS_KEY || "").trim();
  if (!certFile && !keyFile) return null;
  if (!certFile || !keyFile || !fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
    console.error("HTTPS не включён: задайте существующие файлы TLS_CERT и TLS_KEY.");
    return null;
  }
  return { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
}

const tls = tlsCredentials();
const listener = tls ? https.createServer(tls, server.listeners("request")[0]) : server;
if (tls) listener.on("error", (err) => server.emit("error", err));

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logEvent("info", `Остановка (${signal})`, { route: signal, status: 0 });
  const timer = setTimeout(() => {
    logEvent("error", "Сервер не закрылся за 10 секунд", { route: signal, status: 500 });
    try {
      store.close();
    } catch (err) {
      logEvent("error", `Не удалось закрыть базу: ${err.message || err}`, {
        route: signal,
        status: 500,
        stack: err.stack || "",
      });
    }
    process.exit(1);
  }, 10000);
  timer.unref();
  if (typeof listener.closeIdleConnections === "function") listener.closeIdleConnections();
  if (typeof listener.closeAllConnections === "function") listener.closeAllConnections();
  listener.close((err) => {
    clearTimeout(timer);
    if (err) {
      logEvent("error", `Не удалось закрыть сервер: ${err.message || err}`, {
        route: signal,
        status: 500,
        stack: err.stack || "",
      });
      process.exit(1);
      return;
    }
    try {
      store.close();
    } catch (closeErr) {
      logEvent("error", `Не удалось закрыть базу: ${closeErr.message || closeErr}`, {
        route: signal,
        status: 500,
        stack: closeErr.stack || "",
      });
      process.exit(1);
      return;
    }
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

listener.listen(PORT, HOST, () => {
  const scheme = tls ? "https" : "http";
  console.log(`Сайт: ${scheme}://localhost:${PORT}${HOST === "127.0.0.1" ? "" : ` (открыт на адресе ${HOST})`}`);
  const passProblem = adminPassProblem();
  if (passProblem) console.log(`Админка отключена: ${passProblem}`);
  console.log(`AI-чат: готов (модель ${OPENAI_MODEL})`);
  console.log(`База: ${path.join(DATA_DIR, DB_FILENAME)}`);
});

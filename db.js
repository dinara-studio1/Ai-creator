/**
 * Хранение каталога, заказов, клиентов и сессий админки в SQLite.
 * Модуль node:sqlite встроен в Node.js 22.13+ / 24, отдельный пакет не нужен.
 * Файл базы: path.join(DATA_DIR, DB_FILENAME). Фото и видео по-прежнему лежат в uploads/.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  console.error("Нужен Node.js 22.13 или новее: в нём есть встроенный SQLite (node:sqlite).");
  process.exit(1);
}

function tokenHash(token) {
  const value = String(token);
  if (!sessionSecret) return crypto.createHash("sha256").update(value).digest("hex");
  return crypto.createHmac("sha256", sessionSecret).update(value).digest("hex");
}

function setSessionSecret(secret) {
  sessionSecret = String(secret || "");
}

const BACKUP_KEEP_DAYS = 30;
const JSON_NAMES = [
  "products.json",
  "products.json.bak",
  "orders.json",
  "orders.json.bak",
  "clients.json",
  "clients.json.bak",
];

let root = "";
let dataDir = "";
let sessionSecret = "";
let db = null;
let txDepth = 0;
let closed = false;

const stmt = {};

function open(siteRoot, options = {}) {
  if (db) return;
  root = siteRoot;
  const filename = String(options.dbFilename || "dinara.sqlite");
  if (!filename || path.basename(filename) !== filename) {
    throw new Error("DB_FILENAME должен быть именем файла, без пути");
  }
  dataDir = options.dataDir ? path.resolve(String(options.dataDir)) : path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, filename);
  db = new DatabaseSync(file, { timeout: 5000 });
  closed = false;
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = FULL;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      amount TEXT NOT NULL,
      currency TEXT NOT NULL,
      kind TEXT NOT NULL,
      price TEXT NOT NULL,
      image TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      position INTEGER NOT NULL,
      client_order_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      channel TEXT NOT NULL,
      total TEXT NOT NULL,
      status TEXT NOT NULL,
      seq INTEGER
    ) STRICT;

    CREATE TABLE IF NOT EXISTS order_items (
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      product_id TEXT NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      qty INTEGER NOT NULL,
      unit_price TEXT NOT NULL,
      line_total TEXT NOT NULL,
      PRIMARY KEY (order_id, position)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS order_status_history (
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      status TEXT NOT NULL,
      at TEXT NOT NULL,
      PRIMARY KEY (order_id, position)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      phone_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_order_at TEXT NOT NULL,
      order_count INTEGER NOT NULL,
      cancelled_count INTEGER NOT NULL,
      comment TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS client_names (
      phone_key TEXT NOT NULL REFERENCES clients(phone_key) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (phone_key, position)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS client_channels (
      phone_key TEXT NOT NULL REFERENCES clients(phone_key) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      channel TEXT NOT NULL,
      PRIMARY KEY (phone_key, position)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS stock_receipts (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      qty INTEGER NOT NULL CHECK (qty > 0 AND qty <= 9999),
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS orders_client_order_id
      ON orders(client_order_id) WHERE client_order_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS stock_receipts_product ON stock_receipts(product_id);

    CREATE TABLE IF NOT EXISTS stock_tracked (
      product_id TEXT PRIMARY KEY
    ) STRICT;

    CREATE TABLE IF NOT EXISTS rate_hits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bucket TEXT NOT NULL,
      ip TEXT NOT NULL,
      at INTEGER NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS rate_hits_lookup ON rate_hits(bucket, ip, at);
  `);
  migrateOrderSeq();

  stmt.deleteProducts = db.prepare("DELETE FROM products");
  stmt.insertProduct = db.prepare(
    `INSERT INTO products (id, position, title, description, amount, currency, kind, price, image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.products = db.prepare(
    `SELECT id, title, description, amount, currency, kind, price, image
     FROM products ORDER BY position ASC`
  );
  stmt.deleteOrders = db.prepare("DELETE FROM orders");
  stmt.insertOrder = db.prepare(
    `INSERT INTO orders (
       id, position, client_order_id, created_at, updated_at, name, phone, channel, total, status, seq
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.insertItem = db.prepare(
    `INSERT INTO order_items (order_id, position, product_id, title, kind, qty, unit_price, line_total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.insertHistory = db.prepare(
    `INSERT INTO order_status_history (order_id, position, status, at) VALUES (?, ?, ?, ?)`
  );
  stmt.orders = db.prepare(
    `SELECT id, client_order_id, created_at, updated_at, name, phone, channel, total, status, seq
     FROM orders ORDER BY created_at DESC, seq DESC`
  );
  stmt.maxSeq = db.prepare("SELECT MAX(seq) AS n FROM orders");
  stmt.ordersWithoutSeq = db.prepare(
    "SELECT id FROM orders WHERE seq IS NULL ORDER BY created_at ASC, position DESC"
  );
  stmt.setSeq = db.prepare("UPDATE orders SET seq = ? WHERE id = ?");
  stmt.orderIdByClient = db.prepare("SELECT id FROM orders WHERE client_order_id = ?");
  stmt.setOrderStatus = db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?");
  stmt.maxHistoryPos = db.prepare(
    "SELECT MAX(position) AS n FROM order_status_history WHERE order_id = ?"
  );
  stmt.trimHistory = db.prepare(
    `DELETE FROM order_status_history
     WHERE order_id = ? AND position NOT IN (
       SELECT position FROM order_status_history WHERE order_id = ? ORDER BY position DESC LIMIT ?
     )`
  );
  stmt.deleteOneOrder = db.prepare("DELETE FROM orders WHERE id = ?");
  stmt.items = db.prepare(
    `SELECT order_id, product_id, title, kind, qty, unit_price, line_total
     FROM order_items ORDER BY order_id ASC, position ASC`
  );
  stmt.history = db.prepare(
    `SELECT order_id, status, at FROM order_status_history ORDER BY order_id ASC, position ASC`
  );
  stmt.deleteClients = db.prepare("DELETE FROM clients");
  stmt.insertClient = db.prepare(
    `INSERT INTO clients (
       id, phone_key, name, phone, created_at, updated_at, last_order_at, order_count, cancelled_count, comment
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.insertName = db.prepare(
    "INSERT INTO client_names (phone_key, position, name) VALUES (?, ?, ?)"
  );
  stmt.insertChannel = db.prepare(
    "INSERT INTO client_channels (phone_key, position, channel) VALUES (?, ?, ?)"
  );
  stmt.clients = db.prepare(
    `SELECT id, phone_key, name, phone, created_at, updated_at, last_order_at, order_count, cancelled_count, comment
     FROM clients ORDER BY rowid ASC`
  );
  stmt.names = db.prepare(
    "SELECT phone_key, name FROM client_names ORDER BY phone_key ASC, position ASC"
  );
  stmt.channels = db.prepare(
    "SELECT phone_key, channel FROM client_channels ORDER BY phone_key ASC, position ASC"
  );
  stmt.getMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
  stmt.setMeta = db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  stmt.getSession = db.prepare("SELECT expires_at FROM admin_sessions WHERE token = ?");
  stmt.saveSession = db.prepare(
    `INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)
     ON CONFLICT(token) DO UPDATE SET expires_at = excluded.expires_at`
  );
  stmt.deleteSession = db.prepare("DELETE FROM admin_sessions WHERE token = ?");
  stmt.purgeSessions = db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?");
  stmt.stockIncoming = db.prepare(
    "SELECT product_id, SUM(qty) AS qty FROM stock_receipts GROUP BY product_id"
  );
  stmt.stockOutgoing = db.prepare(
    `SELECT oi.product_id AS product_id, SUM(oi.qty) AS qty
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.status != 'cancelled' AND oi.kind != 'service'
     GROUP BY oi.product_id`
  );
  stmt.stockReceiptList = db.prepare(
    "SELECT id, product_id, qty, note, created_at FROM stock_receipts ORDER BY created_at DESC"
  );
  stmt.stockOrderLines = db.prepare(
    `SELECT oi.product_id AS product_id, oi.title AS title, oi.qty AS qty,
            o.id AS order_id, o.seq AS seq, o.created_at AS created_at, o.status AS status, o.name AS name
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.status != 'cancelled' AND oi.kind != 'service'
     ORDER BY o.created_at DESC`
  );
  stmt.insertReceipt = db.prepare(
    "INSERT INTO stock_receipts (id, product_id, qty, note, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  stmt.deleteReceipt = db.prepare("DELETE FROM stock_receipts WHERE id = ?");
  stmt.trackProduct = db.prepare(
    "INSERT INTO stock_tracked (product_id) VALUES (?) ON CONFLICT(product_id) DO NOTHING"
  );
  stmt.trackedProducts = db.prepare("SELECT product_id FROM stock_tracked");
  stmt.insertRate = db.prepare("INSERT INTO rate_hits (bucket, ip, at) VALUES (?, ?, ?)");
  stmt.rateHits = db.prepare(
    "SELECT at FROM rate_hits WHERE bucket = ? AND ip = ? AND at >= ? ORDER BY at ASC"
  );
  stmt.refundRate = db.prepare(
    `DELETE FROM rate_hits WHERE id = (
       SELECT id FROM rate_hits WHERE bucket = ? AND ip = ? AND at = ? ORDER BY id DESC LIMIT 1
     )`
  );
  stmt.clearRate = db.prepare("DELETE FROM rate_hits WHERE bucket = ? AND ip = ?");
  stmt.purgeRate = db.prepare("DELETE FROM rate_hits WHERE at < ?");
  db.exec(
    `INSERT INTO stock_tracked (product_id)
     SELECT DISTINCT r.product_id FROM stock_receipts r
     JOIN products p ON p.id = r.product_id AND p.kind != 'service'
     WHERE r.product_id NOT IN (SELECT product_id FROM stock_tracked)`
  );
  resetCountersOnce();

  const report = importJsonIfNeeded();
  backfillOrderSeq();
  checkpointWal();
  if (report.imported) {
    console.log(
      `SQLite: перенесены текущие данные — товаров ${report.products}, заказов ${report.orders}, клиентов ${report.clients}`
    );
  }
  return report;
}

function getMeta(key) {
  const row = stmt.getMeta.get(key);
  return row ? String(row.value) : "";
}

function setMeta(key, value) {
  stmt.setMeta.run(key, String(value));
}

function checkpointWal() {
  if (!db || closed) return;
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch (err) {
    console.error("Не удалось перенести журнал базы в основной файл:", err.message);
  }
}

function transaction(fn, options) {
  if (!db) throw new Error("База ещё не открыта");
  if (txDepth > 0) return fn();
  if (!options?.skipBackup) dailyBackup();
  const result = immediate(fn);
  checkpointWal();
  return result;
}

function immediate(fn) {
  if (!db) throw new Error("База ещё не открыта");
  if (txDepth > 0) return fn();
  txDepth += 1;
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* транзакция уже закрыта */
    }
    throw err;
  } finally {
    txDepth -= 1;
  }
}

function readProducts() {
  return stmt.products.all().map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    kind: row.kind,
    price: row.price,
    image: row.image,
  }));
}

function replaceProducts(products) {
  return transaction(() => {
    stmt.deleteProducts.run();
    products.forEach((product, index) => {
      stmt.insertProduct.run(
        String(product.id),
        index,
        String(product.title || ""),
        String(product.description || ""),
        String(product.amount ?? ""),
        String(product.currency || "kzt"),
        product.kind === "service" ? "service" : "product",
        String(product.price || ""),
        String(product.image || "")
      );
    });
    const next = (Number(getMeta("catalog_version")) || Date.now()) + 1;
    setMeta("catalog_version", next);
    return next;
  });
}

function productsVersion() {
  return Number(getMeta("catalog_version")) || 0;
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const id = row[key];
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}

function readOrders() {
  const items = groupBy(stmt.items.all(), "order_id");
  const history = groupBy(stmt.history.all(), "order_id");
  return stmt.orders.all().map((row) => {
    const order = {
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      name: row.name,
      phone: row.phone,
      channel: row.channel,
      total: row.total,
      status: row.status,
      statusHistory: (history.get(row.id) || []).map((entry) => ({ status: entry.status, at: entry.at })),
      items: (items.get(row.id) || []).map((item) => ({
        id: item.product_id,
        title: item.title,
        kind: item.kind,
        qty: Number(item.qty) || 1,
        unitPrice: item.unit_price,
        lineTotal: item.line_total,
      })),
    };
    if (row.client_order_id) order.clientOrderId = row.client_order_id;
    if (row.seq != null) order.number = Number(row.seq);
    return order;
  });
}

function writeOrderContents(order, position, seq) {
  const createdAt = String(order.createdAt || new Date().toISOString());
  stmt.insertOrder.run(
    String(order.id),
    position,
    order.clientOrderId ? String(order.clientOrderId) : null,
    createdAt,
    String(order.updatedAt || createdAt),
    String(order.name || ""),
    String(order.phone || ""),
    String(order.channel || ""),
    String(order.total || ""),
    String(order.status || "new"),
    seq
  );
  (Array.isArray(order.items) ? order.items : []).forEach((item, itemIndex) => {
    stmt.insertItem.run(
      String(order.id),
      itemIndex,
      String(item.id || ""),
      String(item.title || ""),
      item.kind === "service" ? "service" : "product",
      Math.max(1, Math.min(99, Math.floor(Number(item.qty)) || 1)),
      String(item.unitPrice || ""),
      String(item.lineTotal || "")
    );
  });
  (Array.isArray(order.statusHistory) ? order.statusHistory : []).forEach((entry, entryIndex) => {
    stmt.insertHistory.run(
      String(order.id),
      entryIndex,
      String(entry.status || ""),
      String(entry.at || createdAt)
    );
  });
  return { ...order, number: seq };
}

function nextOrderSeq() {
  const fromMeta = Number(getMeta("order_seq")) || 0;
  const fromRows = Number(stmt.maxSeq.get()?.n) || 0;
  const next = Math.max(fromMeta, fromRows) + 1;
  setMeta("order_seq", next);
  return next;
}

function insertOrder(order) {
  return transaction(() => {
    const seq = nextOrderSeq();
    return writeOrderContents(order, seq, seq);
  });
}

function replaceOrders(orders) {
  return transaction(() => {
    stmt.deleteOrders.run();
    let maxExplicit = 0;
    const claimed = new Set();
    const seqs = orders.map((order) => {
      const explicit = Number(order.number || order.seq);
      if (Number.isInteger(explicit) && explicit > 0 && !claimed.has(explicit)) {
        claimed.add(explicit);
        if (explicit > maxExplicit) maxExplicit = explicit;
        return explicit;
      }
      return null;
    });
    let auto = maxExplicit;
    orders.forEach((order, index) => {
      let seq = seqs[index];
      if (seq == null) {
        auto += 1;
        seq = auto;
      }
      writeOrderContents(order, index, seq);
    });
    setMeta("order_seq", Math.max(maxExplicit, auto));
  });
}

function readOrderByClientOrderId(clientOrderId) {
  if (!clientOrderId) return null;
  const row = stmt.orderIdByClient.get(String(clientOrderId));
  if (!row) return null;
  return readOrders().find((order) => order.id === row.id) || null;
}

const MAX_STATUS_HISTORY = 50;

function updateOrderStatus(id, status, at) {
  return transaction(() => {
    const changed = stmt.setOrderStatus.run(String(status), String(at), String(id)).changes > 0;
    if (!changed) return null;
    const position = (Number(stmt.maxHistoryPos.get(String(id))?.n) ?? -1) + 1;
    stmt.insertHistory.run(String(id), position, String(status), String(at));
    stmt.trimHistory.run(String(id), String(id), MAX_STATUS_HISTORY);
    return readOrders().find((order) => order.id === id) || null;
  });
}

function deleteOrder(id) {
  return transaction(() => stmt.deleteOneOrder.run(String(id)).changes > 0);
}

function readClients() {
  const names = groupBy(stmt.names.all(), "phone_key");
  const channels = groupBy(stmt.channels.all(), "phone_key");
  const clients = stmt.clients.all().map((row) => ({
    id: row.id,
    phoneKey: row.phone_key,
    name: row.name,
    phone: row.phone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOrderAt: row.last_order_at,
    orderCount: Number(row.order_count) || 0,
    cancelledCount: Number(row.cancelled_count) || 0,
    channels: (channels.get(row.phone_key) || []).map((entry) => entry.channel),
    names: (names.get(row.phone_key) || []).map((entry) => entry.name),
    comment: row.comment || "",
  }));
  clients.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return clients;
}

function replaceClients(clients) {
  return transaction(() => {
    stmt.deleteClients.run();
    clients.forEach((client) => {
      const createdAt = String(client.createdAt || new Date().toISOString());
      const updatedAt = String(client.updatedAt || createdAt);
      stmt.insertClient.run(
        String(client.id),
        String(client.phoneKey || ""),
        String(client.name || ""),
        String(client.phone || ""),
        createdAt,
        updatedAt,
        String(client.lastOrderAt || updatedAt),
        Number(client.orderCount) || 0,
        Number(client.cancelledCount) || 0,
        String(client.comment || "").slice(0, 500)
      );
      (Array.isArray(client.names) ? client.names : []).forEach((name, index) => {
        stmt.insertName.run(String(client.phoneKey || ""), index, String(name));
      });
      (Array.isArray(client.channels) ? client.channels : []).forEach((channel, index) => {
        stmt.insertChannel.run(String(client.phoneKey || ""), index, String(channel));
      });
    });
  });
}

function sessionExpires(token) {
  if (!token) return 0;
  const hash = tokenHash(token);
  const row = stmt.getSession.get(hash);
  if (!row) return 0;
  const expiresAt = Number(row.expires_at) || 0;
  if (expiresAt < Date.now()) {
    stmt.deleteSession.run(hash);
    checkpointWal();
    return 0;
  }
  return expiresAt;
}

function saveSession(token, expiresAt) {
  transaction(() => {
    stmt.saveSession.run(tokenHash(token), Number(expiresAt) || 0);
  });
}

function deleteSession(token) {
  if (!token) return;
  transaction(() => {
    stmt.deleteSession.run(tokenHash(token));
  });
}

function purgeSessions(now) {
  stmt.purgeSessions.run(Number(now) || Date.now());
  checkpointWal();
}

function stockReport() {
  const products = readProducts();
  const incoming = new Map(stmt.stockIncoming.all().map((row) => [row.product_id, Number(row.qty) || 0]));
  const outgoing = new Map(stmt.stockOutgoing.all().map((row) => [row.product_id, Number(row.qty) || 0]));
  const receipts = groupBy(stmt.stockReceiptList.all(), "product_id");
  const lines = groupBy(stmt.stockOrderLines.all(), "product_id");
  const ids = products.filter((product) => product.kind !== "service").map((product) => product.id);
  const seen = new Set(ids);
  for (const id of [...incoming.keys(), ...outgoing.keys()]) {
    if (seen.has(id)) continue;
    const product = products.find((item) => item.id === id);
    if (product && product.kind === "service") continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.map((id) => {
    const product = products.find((item) => item.id === id);
    const productLines = lines.get(id) || [];
    const inQty = incoming.get(id) || 0;
    const outQty = outgoing.get(id) || 0;
    return {
      id,
      title: product?.title || productLines[0]?.title || "Товар удалён из каталога",
      price: product?.price || "",
      inCatalog: Boolean(product),
      incoming: inQty,
      outgoing: outQty,
      balance: inQty - outQty,
      receipts: (receipts.get(id) || []).map((row) => ({
        id: row.id,
        qty: Number(row.qty) || 0,
        note: row.note || "",
        createdAt: row.created_at,
      })),
      orders: productLines.map((row) => ({
        orderId: row.order_id,
        number: row.seq == null ? undefined : Number(row.seq),
        qty: Number(row.qty) || 0,
        status: row.status,
        createdAt: row.created_at,
        name: row.name,
      })),
    };
  });
}

function addStockReceipt(receipt) {
  transaction(() => {
    const productId = String(receipt.productId);
    const product = readProducts().find((item) => item.id === productId);
    if (product && product.kind === "service") return;
    stmt.insertReceipt.run(
      String(receipt.id),
      productId,
      Math.floor(Number(receipt.qty)),
      String(receipt.note || "").slice(0, 200),
      String(receipt.createdAt || new Date().toISOString())
    );
    stmt.trackProduct.run(productId);
  });
}

function deleteStockReceipt(id) {
  let removed = false;
  transaction(() => {
    removed = stmt.deleteReceipt.run(String(id)).changes > 0;
  });
  return removed;
}

function readJsonArray(file) {
  if (!fs.existsSync(file)) return null;
  let firstError = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(parsed)) return parsed;
    firstError = new Error("файл не является списком");
  } catch (err) {
    firstError = err;
  }
  const backup = `${file}.bak`;
  if (fs.existsSync(backup)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(backup, "utf8"));
      if (Array.isArray(parsed)) {
        console.error(`${path.basename(file)} повреждён, для переноса взята копия .bak`);
        return parsed;
      }
    } catch {
      /* разберёмся по исходной ошибке */
    }
  }
  throw new Error(`Не удалось прочитать ${path.basename(file)} для переноса в SQLite: ${firstError.message}`);
}

function backupsRoot() {
  return path.join(dataDir || path.join(root, "data"), "backups");
}

function ping() {
  if (!db || closed) throw new Error("База не открыта");
  db.prepare("SELECT 1 AS ok").get();
  return true;
}

function archiveJsonSources() {
  const archiveDir = path.join(backupsRoot(), "json-before-sqlite");
  const names = new Set(JSON_NAMES);
  let extras = [];
  try {
    extras = fs.readdirSync(root).filter((name) => /\.corrupt-.*\.json$/i.test(name));
  } catch {
    extras = [];
  }
  const present = [...JSON_NAMES, ...extras].filter((name, index, list) => {
    return list.indexOf(name) === index && (names.has(name) || extras.includes(name)) && fs.existsSync(path.join(root, name));
  });
  if (!present.length) return;
  fs.mkdirSync(archiveDir, { recursive: true });
  for (const name of present) {
    const from = path.join(root, name);
    const dest = path.join(archiveDir, name);
    const target = fs.existsSync(dest) ? path.join(archiveDir, `${name}.left-${Date.now()}`) : dest;
    try {
      fs.renameSync(from, target);
    } catch (err) {
      console.error(`Не удалось убрать ${name} после переноса в SQLite:`, err.message);
    }
  }
  console.log("Прежние JSON-файлы убраны в backups/json-before-sqlite/");
}

function importJsonIfNeeded() {
  const empty = { imported: false, products: 0, orders: 0, clients: 0 };
  if (getMeta("json_imported") === "1") {
    archiveJsonSources();
    return empty;
  }
  const already =
    db.prepare("SELECT COUNT(*) AS n FROM products").get().n +
    db.prepare("SELECT COUNT(*) AS n FROM orders").get().n +
    db.prepare("SELECT COUNT(*) AS n FROM clients").get().n;
  if (already > 0) {
    setMeta("json_imported", "1");
    archiveJsonSources();
    return empty;
  }

  const products = readJsonArray(path.join(root, "products.json"));
  const orders = readJsonArray(path.join(root, "orders.json"));
  const clients = readJsonArray(path.join(root, "clients.json"));
  if (!products && !orders && !clients) return empty;

  transaction(() => {
    if (products) replaceProducts(products);
    else setMeta("catalog_version", Date.now());
    if (orders) replaceOrders(orders || []);
    if (clients) replaceClients(clients || []);
    setMeta("json_imported", "1");
  }, { skipBackup: true });

  const report = {
    imported: true,
    products: products ? products.length : 0,
    orders: orders ? orders.length : 0,
    clients: clients ? clients.length : 0,
  };
  archiveJsonSources();
  return report;
}

function dailyBackup() {
  try {
    if (!db) return;
    const backupsDir = backupsRoot();
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const target = path.join(backupsDir, `dinara-${day}.sqlite`);
    if (fs.existsSync(target)) return;
    fs.mkdirSync(backupsDir, { recursive: true });
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, db.serialize());
    fs.renameSync(tmp, target);
    const pattern = /^dinara-\d{4}-\d{2}-\d{2}\.sqlite$/;
    fs.readdirSync(backupsDir)
      .filter((name) => pattern.test(name))
      .sort()
      .slice(0, -BACKUP_KEEP_DAYS)
      .forEach((name) => fs.rmSync(path.join(backupsDir, name), { force: true }));
  } catch (err) {
    console.error("Не удалось сделать резервную копию базы:", err.message);
  }
}

function stockBalances() {
  const incoming = new Map(stmt.stockIncoming.all().map((row) => [row.product_id, Number(row.qty) || 0]));
  const outgoing = new Map(stmt.stockOutgoing.all().map((row) => [row.product_id, Number(row.qty) || 0]));
  const tracked = new Set(stmt.trackedProducts.all().map((row) => row.product_id));
  for (const id of incoming.keys()) tracked.add(id);
  const balances = new Map();
  for (const product of readProducts()) {
    if (product.kind === "service" || !tracked.has(product.id)) continue;
    balances.set(product.id, (incoming.get(product.id) || 0) - (outgoing.get(product.id) || 0));
  }
  return balances;
}

let lastRatePurge = 0;

function maybePurgeRates(now) {
  if (now - lastRatePurge < 60_000) return;
  lastRatePurge = now;
  stmt.purgeRate.run(now - 2 * 24 * 60 * 60 * 1000);
}

function addRateHit(bucket, ip, at) {
  const now = Number(at) || Date.now();
  stmt.insertRate.run(String(bucket), String(ip).slice(0, 64), now);
  maybePurgeRates(now);
}

function rateHits(bucket, ip, since) {
  return stmt.rateHits.all(String(bucket), String(ip).slice(0, 64), Number(since) || 0).map((row) => Number(row.at) || 0);
}

function refundRateHit(bucket, ip, at) {
  stmt.refundRate.run(String(bucket), String(ip).slice(0, 64), Number(at) || 0);
}

function clearRateHits(bucket, ip) {
  stmt.clearRate.run(String(bucket), String(ip).slice(0, 64));
}

function claimRateHit(bucket, ip, rules, at) {
  const now = Number(at) || Date.now();
  const list = Array.isArray(rules) ? rules : [];
  return immediate(() => {
    const longest = Math.max(0, ...list.map((rule) => Number(rule.windowMs) || 0));
    const hits = rateHits(bucket, ip, now - longest);
    let scope = null;
    for (const rule of list) {
      const windowMs = Number(rule.windowMs) || 0;
      const max = Number(rule.max) || 0;
      if (max > 0 && hits.filter((stamp) => now - stamp < windowMs).length >= max) {
        scope = windowMs >= 24 * 60 * 60 * 1000 ? "day" : "minute";
      }
    }
    if (scope) return { scope, stamp: null };
    addRateHit(bucket, ip, now);
    return { scope: null, stamp: now };
  });
}

function resetCountersOnce() {
  if (getMeta("counters_reset_2026_10_21") === "1") return;
  immediate(() => {
    db.exec("DELETE FROM rate_hits");
    db.exec(
      `DELETE FROM stock_receipts
       WHERE product_id IN (SELECT id FROM products WHERE kind = 'service')`
    );
    db.exec(
      `DELETE FROM stock_tracked
       WHERE product_id IN (SELECT id FROM products WHERE kind = 'service')`
    );
    setMeta("counters_reset_2026_10_21", "1");
  });
}

function migrateOrderSeq() {
  const cols = db.prepare("PRAGMA table_info(orders)").all();
  if (!cols.some((col) => col.name === "seq")) {
    db.exec("ALTER TABLE orders ADD COLUMN seq INTEGER");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS orders_seq ON orders(seq) WHERE seq IS NOT NULL");
}

function backfillOrderSeq() {
  const missing = stmt.ordersWithoutSeq.all();
  const current = Math.max(Number(getMeta("order_seq")) || 0, Number(stmt.maxSeq.get()?.n) || 0);
  if (!missing.length) {
    if (String(current) !== getMeta("order_seq")) setMeta("order_seq", current);
    return;
  }
  let next = current;
  for (const row of missing) {
    next += 1;
    stmt.setSeq.run(next, row.id);
  }
  setMeta("order_seq", next);
}

function close() {
  if (!db || closed) return;
  checkpointWal();
  closed = true;
  db.close();
  db = null;
}

module.exports = {
  open,
  setSessionSecret,
  ping,
  transaction,
  readProducts,
  replaceProducts,
  productsVersion,
  readOrders,
  replaceOrders,
  insertOrder,
  updateOrderStatus,
  deleteOrder,
  readOrderByClientOrderId,
  readClients,
  replaceClients,
  sessionExpires,
  saveSession,
  deleteSession,
  purgeSessions,
  stockReport,
  stockBalances,
  addRateHit,
  rateHits,
  refundRateHit,
  clearRateHits,
  claimRateHit,
  immediate,
  addStockReceipt,
  deleteStockReceipt,
  close,
};

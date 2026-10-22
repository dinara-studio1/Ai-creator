import { cartTotalsByCurrency, productKind, totalPrice } from "./money";

export const DEFAULT_PRODUCTS = [
  {
    id: "p1",
    title: "Пакет Reels × 3",
    description: "Три коротких ролика для Instagram или TikTok: идея, AI-кадры и монтаж.",
    amount: "25000",
    currency: "kzt",
    kind: "product",
    price: "25 000 ₸",
    image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "p2",
    title: "Детский обучающий ролик",
    description: "Мягкий короткий ролик для детей и подростков — понятно и без крика.",
    amount: "18000",
    currency: "kzt",
    kind: "product",
    price: "18 000 ₸",
    image: "https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "p3",
    title: "AI-сцена под ключ",
    description: "Генерация персонажей и атмосферы, которые сложно снять камерой.",
    amount: "22000",
    currency: "kzt",
    kind: "product",
    price: "22 000 ₸",
    image: "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "p4",
    title: "Монтаж ролика",
    description: "Сборка ваших материалов: ритм, звук, титры и аккуратные переходы.",
    amount: "12000",
    currency: "kzt",
    kind: "product",
    price: "12 000 ₸",
    image: "https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "p5",
    title: "Серия Stories × 5",
    description: "Пять вертикальных историй в одном стиле для прогрева аудитории.",
    amount: "20000",
    currency: "kzt",
    kind: "product",
    price: "20 000 ₸",
    image: "https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?auto=format&fit=crop&w=800&q=80",
  },
  {
    id: "p6",
    title: "Презентационный ролик",
    description: "Короткий ролик о продукте или услуге — для сайта и соцсетей.",
    amount: "30000",
    currency: "kzt",
    kind: "product",
    price: "30 000 ₸",
    image: "https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=800&q=80",
  },
];

const PRODUCTS_KEY = "dinara_products";

try {
  localStorage.removeItem("dinara_admin_pass");
  localStorage.removeItem("dinara_admin_ok");
  localStorage.removeItem("dinara_admin_token");
} catch {
  /* localStorage недоступен */
}

let productsCache = null;
let productsVersion = null;
let productsLoaded = false;
let productsLoadFailed = false;
const listeners = new Set();
const authListeners = new Set();

export function subscribeProducts(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeAuthRequired(listener) {
  authListeners.add(listener);
  return () => authListeners.delete(listener);
}

function emitProducts() {
  listeners.forEach((listener) => listener());
}

export function notifyAuthRequired() {
  authListeners.forEach((listener) => listener());
}

export function loadProducts() {
  if (productsCache) return structuredClone(productsCache);
  try {
    const parsed = JSON.parse(localStorage.getItem(PRODUCTS_KEY) || "null");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function productsStatus() {
  return { loaded: productsLoaded, failed: productsLoadFailed, version: productsVersion };
}

function saveProductsLocal(products) {
  productsCache = structuredClone(products);
  try {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
  } catch {
    localStorage.removeItem(PRODUCTS_KEY);
  }
  emitProducts();
}

async function pushProductsToServer(products) {
  let res;
  try {
    res = await fetch("/api/products", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products, version: productsVersion }),
    });
  } catch (err) {
    return { ok: false, status: 0, error: err?.message || "Failed to fetch" };
  }
  const raw = await res.text();
  let data = {};
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 180);
      return { ok: false, status: res.status, error: `HTTP ${res.status}: ${snippet || "ответ не JSON"}` };
    }
  }
  if (res.status === 401) notifyAuthRequired();
  if (res.status === 409) await syncProductsWithServer();
  let error = typeof data.error === "string" ? data.error : "";
  if (!error && !res.ok) error = `HTTP ${res.status}`;
  if (res.ok && !Array.isArray(data.products)) error = error || `HTTP ${res.status}: сервер не вернул каталог`;
  return {
    ok: res.ok && Array.isArray(data.products),
    status: res.status,
    error,
    version: data.version,
    products: data.products,
  };
}

export async function saveProducts(products) {
  const result = await pushProductsToServer(products);
  if (result.ok) {
    productsVersion = result.version;
    saveProductsLocal(result.products);
  }
  return result;
}

export async function syncProductsWithServer() {
  const url = "/api/products";
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    productsVersion = Number(data.version) || 0;
    if (Array.isArray(data.products)) {
      if (JSON.stringify(data.products) !== JSON.stringify(loadProducts())) {
        saveProductsLocal(data.products);
      } else {
        productsCache = structuredClone(data.products);
        emitProducts();
      }
    }
    productsLoadFailed = false;
    return true;
  } catch (err) {
    productsLoadFailed = true;
    console.error(`Каталог: не удалось обновить ${url} (HTTP ${err?.status || 0}): ${err?.message || err}`);
    return false;
  } finally {
    productsLoaded = true;
    emitProducts();
  }
}

export function uid() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function orderNumber(order) {
  const number = Number(order?.number);
  if (Number.isInteger(number) && number > 0) return String(number);
  return String(order?.id || "").slice(-6).toUpperCase();
}

export function orderTextFromRows(rows, totals, contact, orderNo = "") {
  const list = rows
    .map((row, i) => {
      const kindLabel = row.kind === "service" ? "услуга" : "товар";
      const prefix = rows.length > 1 ? `${i + 1}. ` : "";
      return `${prefix}${row.title} (${kindLabel}) — ${row.qty} шт. — ${row.lineTotal}`;
    })
    .join("\n");
  const who =
    contact && contact.name && contact.phone
      ? `Меня зовут ${String(contact.name).trim()}, телефон ${String(contact.phone).trim()}.\n`
      : "";
  return (
    `Здравствуйте, Динара!\n` +
    who +
    `Хочу оформить заказ${orderNo ? ` №${orderNo}` : ""}:\n\n` +
    `${list}\n\n` +
    `Итого: ${totals}.\n` +
    `Подскажите, пожалуйста, как оплатить и получить заказ?`
  );
}

export function buildOrderText(lines, contact) {
  const rows = lines.map(({ product, qty }) => ({
    title: product.title,
    kind: productKind(product),
    qty,
    lineTotal: totalPrice(product, qty),
  }));
  return orderTextFromRows(rows, cartTotalsByCurrency(lines).join(" · "), contact);
}

export function messengerUrl(channel, text, site) {
  if (site?.configState !== "ready" || !site.waPhone || !site.tgUser) return "";
  const encoded = encodeURIComponent(text);
  if (channel === "telegram") return `https://t.me/${site.tgUser}?text=${encoded}`;
  return `https://wa.me/${site.waPhone}?text=${encoded}`;
}

export function orderPayload(lines, contact, channel, clientOrderId) {
  return {
    clientOrderId,
    name: String(contact.name || "").trim(),
    phone: String(contact.phone || "").trim(),
    channel,
    items: lines.map(({ product, qty }) => ({ id: product.id, qty })),
  };
}

export function newClientOrderId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

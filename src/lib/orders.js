import { releaseConfirmedItems, restoreCartItems } from "./cart";
import { orderPayload } from "./products";

const CLIENT_KEY = "dinara_client";
const PENDING_ORDERS_KEY = "dinara_pending_orders";
const PENDING_ORDER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_ORDERS_MAX = 10;
export const PENDING_RETRY_MS = 60 * 1000;
const LIMIT_WINDOW_MS = 10 * 60 * 1000;
const LIMIT_DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRED_ORDER_TEXT = "Заказ не подтвердился за 7 дней и снят с повторной отправки. Корзина на месте — оформите его ещё раз.";
const UNSAVED_ORDER_KEY = "dinara_order_unsaved";
const UNSAVED_ORDER_TEXT = "Заказ не записался: этой услуги уже нет в каталоге. Оформите его ещё раз.";
const unsavedListeners = new Set();

export function unsavedOrderMessage() {
  try {
    return sessionStorage.getItem(UNSAVED_ORDER_KEY) || "";
  } catch {
    return "";
  }
}

export function subscribeUnsavedOrder(listener) {
  unsavedListeners.add(listener);
  return () => unsavedListeners.delete(listener);
}

function rememberUnsavedOrder(message) {
  const text = String(message || "").trim() || UNSAVED_ORDER_TEXT;
  try {
    sessionStorage.setItem(UNSAVED_ORDER_KEY, text);
  } catch {
    /* sessionStorage недоступен */
  }
  unsavedListeners.forEach((listener) => listener());
}

export function dismissUnsavedOrder() {
  try {
    sessionStorage.removeItem(UNSAVED_ORDER_KEY);
  } catch {
    /* sessionStorage недоступен */
  }
  unsavedListeners.forEach((listener) => listener());
}

export function loadClientContact() {
  try {
    const raw = JSON.parse(localStorage.getItem(CLIENT_KEY) || "null");
    if (!raw || typeof raw !== "object") return { name: "", phone: "" };
    return {
      name: String(raw.name || "").slice(0, 80),
      phone: String(raw.phone || "").slice(0, 24),
    };
  } catch {
    return { name: "", phone: "" };
  }
}

export function saveClientContact(contact) {
  localStorage.setItem(CLIENT_KEY, JSON.stringify({
    name: contact.name,
    phone: contact.phone,
  }));
}

export async function postJsonWithTimeout(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

export function pendingRetryDelay(kind) {
  if (kind === "day") return LIMIT_DAY_MS;
  if (kind === "minute") return LIMIT_WINDOW_MS;
  return PENDING_RETRY_MS;
}

export function pendingOrderNotice(kind) {
  if (kind === "day") {
    return "Слишком много заказов за сегодня. Заказ не записан. Следующая попытка — примерно через сутки. Корзина на месте.";
  }
  if (kind === "minute") {
    return "Слишком много заказов подряд. Заказ не записан. Следующая попытка — примерно через 10 минут. Корзина на месте.";
  }
  if (kind === "catalog") {
    return "Каталог сейчас недоступен. Заказ не записан. Следующая попытка — примерно через минуту. Корзина на месте.";
  }
  if (kind === "server") {
    return "Сервер не записал заказ. Следующая попытка — примерно через минуту. Корзина на месте.";
  }
  return "Нет связи с сайтом. Заказ не записан. Следующая попытка — примерно через минуту. Корзина на месте.";
}

function readPendingOrders() {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_ORDERS_KEY) || "[]");
    return Array.isArray(list) ? list.filter((entry) => entry?.payload?.clientOrderId) : [];
  } catch {
    return [];
  }
}

function dropExpiredPending() {
  const now = Date.now();
  const fresh = [];
  const expired = [];
  for (const entry of readPendingOrders()) {
    if (now - Number(entry.savedAt) < PENDING_ORDER_MAX_AGE_MS) fresh.push(entry);
    else expired.push(entry);
  }
  if (!expired.length) return fresh;
  for (const entry of expired) {
    if (entry.cart?.length) restoreCartItems(entry.cart);
    console.warn(`Заказ ${entry.payload.clientOrderId}: снят с очереди после 7 дней без подтверждения сервера`);
  }
  rememberUnsavedOrder(EXPIRED_ORDER_TEXT);
  savePendingOrders(fresh);
  return fresh;
}

function loadPendingOrders() {
  return dropExpiredPending();
}

function savePendingOrders(list) {
  try {
    const raw = list.length ? JSON.stringify(list.slice(-PENDING_ORDERS_MAX)) : "";
    if (raw) localStorage.setItem(PENDING_ORDERS_KEY, raw);
    else localStorage.removeItem(PENDING_ORDERS_KEY);
    return (localStorage.getItem(PENDING_ORDERS_KEY) || "") === raw;
  } catch {
    return false;
  }
}

export function queuePendingOrder(payload, cartItems, retryAt = Date.now() + PENDING_RETRY_MS) {
  const list = loadPendingOrders().filter((entry) => entry.payload.clientOrderId !== payload.clientOrderId);
  const cart = (Array.isArray(cartItems) ? cartItems : [])
    .map((item) => ({
      id: String(item?.id || ""),
      qty: Math.max(1, Math.min(99, Number(item?.qty) || 1)),
    }))
    .filter((item) => item.id);
  list.push({ payload, savedAt: Date.now(), retryAt, cart });
  return savePendingOrders(list);
}

let pendingFlushBusy = false;

export async function flushPendingOrders() {
  if (pendingFlushBusy) return;
  const now = Date.now();
  const list = loadPendingOrders();
  const due = list.filter((entry) => !entry.retryAt || Number(entry.retryAt) <= now);
  if (!due.length) return;
  pendingFlushBusy = true;
  const done = new Set();
  const retries = new Map();
  let unsaved = "";
  try {
    for (const entry of due) {
      const id = entry.payload.clientOrderId;
      try {
        const { res, data } = await postJsonWithTimeout("/api/orders", entry.payload, 12000);
        if (res.ok) {
          done.add(id);
          if (entry.cart?.length) releaseConfirmedItems(entry.cart);
          continue;
        }
        console.warn(`Заказ ${id}: HTTP ${res.status}`);
        if (res.status === 400 || res.status === 409 || (res.status === 503 && data.retry !== true)) {
          done.add(id);
          if (entry.cart?.length) restoreCartItems(entry.cart);
          unsaved = res.status === 409
            ? UNSAVED_ORDER_TEXT
            : (data.error || (res.status === 503
              ? "Каталог временно недоступен. Заказ не записан. Оформите его ещё раз."
              : "Заказ не записался. Оформите его ещё раз."));
          if (res.status === 503) console.warn(`Заказ ${id}: HTTP 503, повтор остановлен`);
          continue;
        }
        const kind = res.status === 429 ? (data.scope === "day" ? "day" : "minute") : "server";
        retries.set(id, Date.now() + pendingRetryDelay(kind));
      } catch (err) {
        console.warn(`Заказ ${id}: сеть (${err?.name || "error"})`);
        retries.set(id, Date.now() + PENDING_RETRY_MS);
      }
    }
  } finally {
    const next = loadPendingOrders()
      .filter((entry) => !done.has(entry.payload.clientOrderId))
      .map((entry) => {
        const retryAt = retries.get(entry.payload.clientOrderId);
        return retryAt ? { ...entry, retryAt } : entry;
      });
    savePendingOrders(next);
    if (unsaved) rememberUnsavedOrder(unsaved);
    pendingFlushBusy = false;
  }
}

export function buildPayload(lines, contact, channel, clientOrderId) {
  return orderPayload(lines, contact, channel, clientOrderId);
}

export function openMessenger(popup, url) {
  if (popup && !popup.closed) {
    try {
      popup.location.href = url;
      return;
    } catch {
      /* окно могли заблокировать */
    }
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.assign(url);
}

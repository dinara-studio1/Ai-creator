import { loadProducts } from "./products";

const CART_KEY = "dinara_cart";
const listeners = new Set();

export function subscribeCart(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  listeners.forEach((listener) => listener());
}

export function loadCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => ({
        id: String(row.id || ""),
        qty: Math.max(1, Math.min(99, Number(row.qty) || 1)),
      }))
      .filter((row) => row.id);
  } catch {
    return [];
  }
}

const CART_SAVE_ERROR = "Не удалось сохранить корзину в браузере. Освободите место и попробуйте ещё раз.";

function saveCart(cart, { warn = false } = {}) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch {
    if (warn) window.alert(CART_SAVE_ERROR);
    return false;
  }
  emit();
  return true;
}

export function cartQtyCap(product) {
  if (!product || product.kind === "service" || product.available == null || product.available === "") return 99;
  const available = Number(product.available);
  if (!Number.isFinite(available)) return 99;
  return Math.max(0, Math.min(99, Math.floor(available)));
}

export function stockLimitMessage(lines) {
  for (const { product, qty } of lines) {
    const cap = cartQtyCap(product);
    if (product?.kind === "service" || product?.available == null || product?.available === "") continue;
    if (qty <= cap) continue;
    return cap > 0
      ? `«${product.title}» — в наличии ${cap} шт.`
      : `«${product.title}» сейчас нет в наличии.`;
  }
  return "";
}

export function addToCart(productId, qty = 1, maxQty = 99) {
  const cap = Math.max(0, Math.min(99, Math.floor(Number(maxQty))));
  if (cap < 1) return false;
  const cart = loadCart();
  const addQty = Math.max(1, Math.min(cap, Number(qty) || 1));
  const existing = cart.find((row) => row.id === productId);
  if (existing) existing.qty = Math.min(cap, existing.qty + addQty);
  else cart.push({ id: productId, qty: addQty });
  return saveCart(cart, { warn: true });
}

export function setCartQty(productId, qty, maxQty = 99) {
  const cap = Math.max(0, Math.min(99, Math.floor(Number(maxQty))));
  const nextQty = Math.max(0, Math.min(cap, Number(qty) || 0));
  let cart = loadCart();
  if (nextQty <= 0) cart = cart.filter((row) => row.id !== productId);
  else {
    const row = cart.find((item) => item.id === productId);
    if (row) row.qty = nextQty;
  }
  return saveCart(cart, { warn: true });
}

export function removeFromCart(productId) {
  return saveCart(loadCart().filter((row) => row.id !== productId), { warn: true });
}

export function clearCart() {
  return saveCart([]);
}

export function releaseConfirmedItems(items) {
  if (!Array.isArray(items) || !items.length) return false;
  const cart = loadCart();
  let changed = false;
  for (const item of items) {
    const id = String(item?.id || "");
    const qty = Math.max(1, Math.min(99, Number(item?.qty) || 1));
    const index = cart.findIndex((row) => row.id === id);
    if (!id || index < 0) continue;
    const next = cart[index].qty - qty;
    if (next <= 0) cart.splice(index, 1);
    else cart[index].qty = next;
    changed = true;
  }
  if (!changed) return true;
  return saveCart(cart);
}

export function restoreCartItems(items) {
  if (!Array.isArray(items) || !items.length) return false;
  const cart = loadCart();
  let changed = false;
  for (const item of items) {
    const id = String(item?.id || "");
    const qty = Math.max(1, Math.min(99, Number(item?.qty) || 1));
    if (!id) continue;
    const existing = cart.find((row) => row.id === id);
    if (!existing) {
      cart.push({ id, qty });
      changed = true;
    } else if (existing.qty < qty) {
      existing.qty = qty;
      changed = true;
    }
  }
  if (!changed) return true;
  return saveCart(cart);
}

export function getCartLines() {
  const products = loadProducts();
  return loadCart()
    .map((row) => {
      const product = products.find((item) => item.id === row.id);
      if (!product) return null;
      return { product, qty: row.qty };
    })
    .filter(Boolean);
}

export function cartCount() {
  return getCartLines().reduce((sum, line) => sum + line.qty, 0);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== CART_KEY && event.key !== null) return;
    emit();
  });
}

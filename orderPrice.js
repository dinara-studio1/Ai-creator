/**
 * Правила заказа, которые не ходят в базу: телефон и цена из каталога.
 * Браузерные суммы сюда не попадают.
 */
const CURRENCY_SYMBOLS = { kzt: "₸", usd: "$", rub: "₽" };
const MAX_PRODUCTS = 200;

function formatMoney(amount, currency) {
  const symbol = CURRENCY_SYMBOLS[currency] || CURRENCY_SYMBOLS.kzt;
  return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ${symbol}`;
}

function productCurrency(product) {
  if (CURRENCY_SYMBOLS[product?.currency]) return product.currency;
  const price = String(product?.price || "");
  if (price.includes("$") || /usd|долл/i.test(price)) return "usd";
  if (price.includes("₽") || /rub|руб/i.test(price)) return "rub";
  return "kzt";
}

function productAmount(product) {
  const raw = product?.amount != null ? product.amount : product?.price;
  return Number(String(raw ?? "").replace(/\D/g, "")) || 0;
}

function productPriceText(product) {
  const digits = String(product.amount ?? "").replace(/\D/g, "");
  if (digits && product.currency) return formatMoney(digits, product.currency);
  return String(product.price || "").trim();
}

function phoneKey(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 11 && /^8[79]/.test(digits)) digits = `7${digits.slice(1)}`;
  else if (digits.length === 10 && /^[79]/.test(digits)) digits = `7${digits}`;
  return digits;
}

function balanceOf(balances, id) {
  if (!balances) return 0;
  const raw = typeof balances.get === "function" ? balances.get(id) : balances[id];
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : 0;
}

function isTracked(balances, id) {
  if (!balances) return false;
  if (typeof balances.has === "function") return balances.has(id);
  return Object.prototype.hasOwnProperty.call(balances, id);
}

function stockShortage(items, balances) {
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (!item || item.kind === "service" || !isTracked(balances, item.id)) continue;
    const available = balanceOf(balances, item.id);
    const qty = Math.max(1, Math.min(99, Math.floor(Number(item.qty)) || 1));
    if (qty <= available) continue;
    const title = String(item.title || "Товар").replace(/\s+/g, " ").trim().slice(0, 120);
    return {
      error: available > 0
        ? `«${title}» — в наличии ${available} шт.`
        : `«${title}» сейчас нет в наличии.`,
    };
  }
  return null;
}

function isLoopback(addr) {
  const ip = String(addr || "").toLowerCase().replace(/^::ffff:/, "");
  return ip === "127.0.0.1" || ip === "::1";
}

// Прокси на этом же компьютере (nginx, ngrok, cloudflared) подключается с loopback
// и дописывает адрес посетителя в конец X-Forwarded-For. Чужой адрес из интернета
// этот заголовок подделать не может: его учитываем только с TRUST_PROXY.
function clientIp(remoteAddress, forwardedHeader, trustProxy) {
  const remote = String(remoteAddress || "");
  if (trustProxy || isLoopback(remote)) {
    const forwarded = String(forwardedHeader || "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (forwarded.length) return forwarded[forwarded.length - 1].slice(0, 64);
  }
  return remote || "unknown";
}

function priceOrderItems(raw, catalog) {
  if (!Array.isArray(raw)) return { items: [], total: "" };
  if (raw.length > MAX_PRODUCTS) {
    return { error: `В одном заказе не больше ${MAX_PRODUCTS} позиций.` };
  }
  const byId = new Map(catalog.filter((item) => item && item.id).map((item) => [String(item.id), item]));
  const qtyById = new Map();
  for (const item of raw) {
    const id = String(item?.id || "");
    if (!id) continue;
    const product = byId.get(id);
    if (!product || !String(product.title || "").trim()) {
      return { error: "Часть товаров уже нет в каталоге. Обновите страницу и проверьте заказ." };
    }
    const qty = Math.max(1, Math.min(99, Math.floor(Number(item?.qty)) || 1));
    qtyById.set(id, Math.min(99, (qtyById.get(id) || 0) + qty));
  }

  const sums = {};
  const items = [...qtyById].map(([id, qty]) => {
    const product = byId.get(id);
    const currency = productCurrency(product);
    const unit = productAmount(product);
    sums[currency] = (sums[currency] || 0) + unit * qty;
    return {
      id,
      title: String(product.title).replace(/\s+/g, " ").trim().slice(0, 120),
      kind: product.kind === "service" ? "service" : "product",
      qty,
      unitPrice: formatMoney(unit, currency),
      lineTotal: formatMoney(unit * qty, currency),
    };
  });
  const total = Object.entries(sums)
    .map(([currency, amount]) => formatMoney(amount, currency))
    .join(" · ");
  return { items, total };
}

module.exports = {
  formatMoney,
  productCurrency,
  productAmount,
  productPriceText,
  phoneKey,
  priceOrderItems,
  stockShortage,
  clientIp,
};

export const CURRENCIES = {
  kzt: { code: "kzt", symbol: "₸", label: "Тенге ₸" },
  usd: { code: "usd", symbol: "$", label: "Доллар $" },
  rub: { code: "rub", symbol: "₽", label: "Рубли ₽" },
};

export function formatAmount(raw) {
  const digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatPrice(amount, currencyCode) {
  const cur = CURRENCIES[currencyCode] || CURRENCIES.kzt;
  const formatted = formatAmount(amount);
  if (!formatted) return "";
  return `${formatted} ${cur.symbol}`;
}

export function detectCurrency(priceStr) {
  const s = String(priceStr || "");
  if (s.includes("$") || /usd|долл/i.test(s)) return "usd";
  if (s.includes("₽") || /rub|руб/i.test(s)) return "rub";
  return "kzt";
}

export function parsePriceFields(product) {
  if (product && product.amount != null && product.currency) {
    return {
      amount: formatAmount(product.amount),
      currency: CURRENCIES[product.currency] ? product.currency : "kzt",
    };
  }
  const price = product?.price || "";
  return {
    amount: formatAmount(price),
    currency: detectCurrency(price),
  };
}

export function displayPrice(product) {
  if (!product) return "";
  if (product.amount != null && product.currency) {
    return formatPrice(product.amount, product.currency);
  }
  return product.price || "";
}

export function productKind(product) {
  return product?.kind === "service" ? "service" : "product";
}

export function productAmountValue(product) {
  if (product?.amount != null) {
    return Number(String(product.amount).replace(/[^\d]/g, "")) || 0;
  }
  return Number(String(product?.price || "").replace(/[^\d]/g, "")) || 0;
}

export function totalPrice(product, qty = 1) {
  const q = Math.max(1, Number(qty) || 1);
  const unit = productAmountValue(product);
  const currency = product?.currency || (product?.price ? detectCurrency(product.price) : "kzt");
  return formatPrice(String(unit * q), currency);
}

export function cartTotalsByCurrency(lines) {
  const map = {};
  lines.forEach(({ product, qty }) => {
    const currency = product.currency || (product.price ? detectCurrency(product.price) : "kzt");
    const unit = productAmountValue(product);
    map[currency] = (map[currency] || 0) + unit * qty;
  });
  return Object.entries(map).map(([currency, amount]) => formatPrice(String(amount), currency));
}

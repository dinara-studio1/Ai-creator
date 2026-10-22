/*!
 * Общие данные товаров (localStorage)
 */
const PRODUCTS_KEY = "dinara_products";
const ADMIN_TOKEN_KEY = "dinara_admin_token";

// Раньше здесь в открытом виде хранился пароль админки — стираем его у всех, кто заходил.
try {
  localStorage.removeItem("dinara_admin_pass");
  localStorage.removeItem("dinara_admin_ok");
} catch {
  /* localStorage недоступен */
}

// Открыто как файл — браузер часто не пускает такие страницы к серверу, и чат теряет AI.
// Картинка не требует CORS, поэтому по ней надёжно видно, запущен ли сервер.
if (location.protocol === "file:") {
  const probe = new Image();
  probe.onload = () => {
    const page = location.pathname.split("/").pop() || "index.html";
    location.replace(`http://localhost:3000/${page}${location.search}${location.hash}`);
  };
  probe.src = `http://localhost:3000/catalog-bg.jpg?probe=${Date.now()}`;
}
const WA_PHONE = "77003096823";
const TG_USER = "TDS_dinara";

const CURRENCIES = {
  kzt: { code: "kzt", symbol: "₸", label: "Тенге ₸" },
  usd: { code: "usd", symbol: "$", label: "Доллар $" },
  rub: { code: "rub", symbol: "₽", label: "Рубли ₽" },
};

function formatAmount(raw) {
  const digits = String(raw).replace(/[^\d]/g, "");
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function formatPrice(amount, currencyCode) {
  const cur = CURRENCIES[currencyCode] || CURRENCIES.kzt;
  const formatted = formatAmount(amount);
  if (!formatted) return "";
  return `${formatted} ${cur.symbol}`;
}

function detectCurrency(priceStr) {
  const s = String(priceStr || "");
  if (s.includes("$") || /usd|долл/i.test(s)) return "usd";
  if (s.includes("₽") || /rub|руб/i.test(s)) return "rub";
  return "kzt";
}

function parsePriceFields(product) {
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

function displayPrice(product) {
  if (!product) return "";
  if (product.amount != null && product.currency) {
    return formatPrice(product.amount, product.currency);
  }
  return product.price || "";
}

function productKind(product) {
  return product?.kind === "service" ? "service" : "product";
}

function productAmountValue(product) {
  if (product?.amount != null) {
    return Number(String(product.amount).replace(/[^\d]/g, "")) || 0;
  }
  return Number(String(product?.price || "").replace(/[^\d]/g, "")) || 0;
}

function totalPrice(product, qty = 1) {
  const q = Math.max(1, Number(qty) || 1);
  const unit = productAmountValue(product);
  const currency =
    product?.currency ||
    (product?.price ? detectCurrency(product.price) : "kzt");
  return formatPrice(String(unit * q), currency);
}

const DEFAULT_PRODUCTS = [
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

function isInstagramUrl(url) {
  return /instagram\.com|instagr\.am/i.test(url || "");
}

function isVideoUrl(url) {
  return /\.(mp4|webm|ogg)(\?|$)/i.test(url || "") || /^data:video\//i.test(url || "");
}

function safeMediaUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^data:(image|video)\//i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? "" : value;
}

function mediaHtml(product) {
  const url = safeMediaUrl(product.image);
  const title = escapeHtml(product.title);

  if (isInstagramUrl(url)) {
    return `
      <div class="product-card__media product-card__media--link">
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
          Смотреть в Instagram ↗
        </a>
      </div>`;
  }

  if (isVideoUrl(url)) {
    return `
      <div class="product-card__media">
        <video src="${escapeHtml(url)}" muted playsinline loop autoplay controls preload="metadata"></video>
      </div>`;
  }

  return `
    <div class="product-card__media">
      <img
        src="${escapeHtml(url)}"
        alt="${title}"
        loading="lazy"
        width="800"
        height="500"
        onerror="this.parentElement.classList.add('product-card__media--broken'); this.remove();"
      />
    </div>`;
}

// Нужен escapeHtml из script — продублируем лёгкую версию здесь для mediaHtml
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

let productsCache = null;
// Версия каталога на сервере: без неё сервер не примет сохранение, чтобы устаревший
// список из другой вкладки не затёр свежие правки.
let productsVersion = null;
let productsLoaded = false;
let productsLoadFailed = false;

function loadProducts() {
  if (productsCache) return structuredClone(productsCache);
  try {
    const parsed = JSON.parse(localStorage.getItem(PRODUCTS_KEY) || "null");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const PRODUCTS_API =
  location.protocol === "file:" ? "http://localhost:3000/api/products" : "/api/products";

function adminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY) || "";
}

/** Сначала сервер, потом браузер: при ошибке в админке не остаётся «несохранённых» товаров. */
async function saveProducts(products) {
  const result = await pushProductsToServer(products);
  if (result.ok) {
    productsVersion = result.version;
    saveProductsLocal(result.products);
    window.dispatchEvent(new CustomEvent("products:updated"));
  }
  return result;
}

function saveProductsLocal(products) {
  productsCache = structuredClone(products);
  try {
    localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
  } catch {
    // Не влезло — убираем старую копию, иначе после перезагрузки покажется устаревший каталог.
    localStorage.removeItem(PRODUCTS_KEY);
  }
}

async function pushProductsToServer(products) {
  try {
    const res = await fetch(PRODUCTS_API, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Admin-Token": adminToken() },
      body: JSON.stringify({ products, version: productsVersion }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) window.dispatchEvent(new CustomEvent("products:auth-required"));
    if (res.status === 409) await syncProductsWithServer();
    return {
      ok: res.ok && Array.isArray(data.products),
      status: res.status,
      error: data.error || "",
      version: data.version,
      products: data.products,
    };
  } catch {
    return { ok: false, status: 0, error: "" };
  }
}

async function syncProductsWithServer() {
  try {
    const res = await fetch(PRODUCTS_API, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    productsVersion = Number(data.version) || 0;
    if (Array.isArray(data.products)) {
      if (JSON.stringify(data.products) !== JSON.stringify(loadProducts())) {
        saveProductsLocal(data.products);
      } else {
        productsCache = structuredClone(data.products);
      }
    } else if (adminToken()) {
      // На сервере каталога ещё нет — переносим туда тот, что сделан в этом браузере.
      const local = loadProducts();
      if (local.length) await saveProducts(local);
    }
    productsLoadFailed = false;
  } catch {
    productsLoadFailed = true;
  } finally {
    productsLoaded = true;
    window.dispatchEvent(new CustomEvent("products:updated"));
  }
}

const productsReady = syncProductsWithServer();

function uid() {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function orderMessage(product, qty = 1, contact) {
  return buildOrderText([{ product, qty }], contact);
}

function whatsappOrderUrl(product, qty = 1, contact) {
  return messengerUrl("whatsapp", orderMessage(product, qty, contact));
}

const CART_KEY = "dinara_cart";

function loadCart() {
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

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function addToCart(productId, qty = 1) {
  const cart = loadCart();
  const addQty = Math.max(1, Math.min(99, Number(qty) || 1));
  const existing = cart.find((row) => row.id === productId);
  if (existing) {
    existing.qty = Math.min(99, existing.qty + addQty);
  } else {
    cart.push({ id: productId, qty: addQty });
  }
  saveCart(cart);
  return cart;
}

function setCartQty(productId, qty) {
  const nextQty = Math.max(0, Math.min(99, Number(qty) || 0));
  let cart = loadCart();
  if (nextQty <= 0) {
    cart = cart.filter((row) => row.id !== productId);
  } else {
    const row = cart.find((item) => item.id === productId);
    if (row) row.qty = nextQty;
  }
  saveCart(cart);
  return cart;
}

function removeFromCart(productId) {
  const cart = loadCart().filter((row) => row.id !== productId);
  saveCart(cart);
  return cart;
}

function clearCart() {
  saveCart([]);
  return [];
}

// Считаем только товары, которые есть в каталоге: удалённые админом не должны висеть на значке.
function cartCount() {
  return getCartLines().reduce((sum, line) => sum + line.qty, 0);
}

function getCartLines() {
  const products = loadProducts();
  return loadCart()
    .map((row) => {
      const product = products.find((p) => p.id === row.id);
      if (!product) return null;
      return { product, qty: row.qty };
    })
    .filter(Boolean);
}

function cartTotalsByCurrency(lines) {
  const map = {};
  lines.forEach(({ product, qty }) => {
    const currency =
      product.currency ||
      (product.price ? detectCurrency(product.price) : "kzt");
    const unit = productAmountValue(product);
    map[currency] = (map[currency] || 0) + unit * qty;
  });
  return Object.entries(map).map(([currency, amount]) =>
    formatPrice(String(amount), currency)
  );
}

function buildOrderText(lines, contact) {
  const rows = lines.map(({ product, qty }) => ({
    title: product.title,
    kind: productKind(product),
    qty,
    lineTotal: totalPrice(product, qty),
  }));
  return orderTextFromRows(rows, cartTotalsByCurrency(lines).join(" · "), contact);
}

// Короткий номер для покупателя и Динары: хвост id заказа, который выдал сервер.
function orderNumber(order) {
  return String(order?.id || "").slice(-6).toUpperCase();
}

/** rows: [{ title, kind, qty, lineTotal }] — строки из корзины или из заказа, сохранённого сервером. */
function orderTextFromRows(rows, totals, contact, orderNo = "") {
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

function messengerUrl(channel, text) {
  const encoded = encodeURIComponent(text);
  if (channel === "telegram") return `https://t.me/${TG_USER}?text=${encoded}`;
  return `https://wa.me/${WA_PHONE}?text=${encoded}`;
}

// Цены сервер считает сам по своему каталогу, поэтому отправляем только id и количество.
function orderPayload(lines, contact, channel, clientOrderId) {
  return {
    clientOrderId,
    name: String(contact.name || "").trim(),
    phone: String(contact.phone || "").trim(),
    channel,
    items: lines.map(({ product, qty }) => ({ id: product.id, qty })),
  };
}

function cartOrderMessage(lines, contact) {
  return buildOrderText(lines, contact);
}

function whatsappCartUrl(lines, contact) {
  return messengerUrl("whatsapp", buildOrderText(lines, contact));
}

function telegramOrderUrl(text) {
  return text ? messengerUrl("telegram", text) : `https://t.me/${TG_USER}`;
}

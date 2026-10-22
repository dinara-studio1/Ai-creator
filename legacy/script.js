function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function updateCartBadge() {
  const badge = document.getElementById("cart-count");
  if (!badge) return;
  const count = cartCount();
  badge.textContent = String(count);
  badge.hidden = count === 0;
}

function renderCart() {
  const list = document.getElementById("cart-list");
  const foot = document.getElementById("cart-foot");
  const totalEl = document.getElementById("cart-total");
  if (!list) return;

  const lines = getCartLines();
  updateCartBadge();

  if (!lines.length) {
    list.innerHTML = `<p class="cart-drawer__empty">Корзина пуста. Добавьте услуги из раздела «Каталог».</p>`;
    if (foot) foot.hidden = true;
    if (totalEl) totalEl.textContent = "0 ₸";
    return;
  }

  list.innerHTML = lines
    .map(({ product, qty }) => `
      <article class="cart-item" data-id="${escapeHtml(product.id)}">
        <div class="cart-item__top">
          <div class="cart-item__info">
            <strong>${escapeHtml(product.title)}</strong>
            <span class="cart-item__meta">${escapeHtml(displayPrice(product))}</span>
          </div>
          <button type="button" class="cart-item__remove" data-cart-remove aria-label="Удалить услугу">
            Удалить
          </button>
        </div>
        <div class="cart-item__controls">
          <div class="order-qty__controls cart-item__qty">
            <button type="button" class="order-qty__btn" data-cart-minus aria-label="Меньше">−</button>
            <span class="cart-item__qty-val" data-cart-qty>${qty}</span>
            <button type="button" class="order-qty__btn" data-cart-plus aria-label="Больше">+</button>
          </div>
          <span class="cart-item__sum">${escapeHtml(totalPrice(product, qty))}</span>
        </div>
      </article>`)
    .join("");

  if (foot) foot.hidden = false;
  if (totalEl) totalEl.textContent = cartTotalsByCurrency(lines).join(" · ");
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
// Сверху вниз: окно контактов открывается поверх заказа, заказ — поверх корзины.
const OVERLAY_IDS = ["contact-modal", "order-modal", "cart-drawer"];
const overlayOpeners = new Map();

function topOverlay() {
  return OVERLAY_IDS.map((id) => document.getElementById(id)).find((el) => el && !el.hidden) || null;
}

function focusableIn(el) {
  return [...el.querySelectorAll(FOCUSABLE)].filter((node) => node.getClientRects().length);
}

// Запоминаем, откуда открыли окно, и переводим фокус внутрь — иначе с клавиатуры
// и в экранном дикторе окно «не видно», а Tab гуляет по странице под ним.
function focusOverlay(el, target) {
  if (!overlayOpeners.has(el.id)) overlayOpeners.set(el.id, document.activeElement);
  requestAnimationFrame(() => (target || focusableIn(el)[0])?.focus());
}

function restoreOverlayFocus(el) {
  const opener = overlayOpeners.get(el.id);
  overlayOpeners.delete(el.id);
  const top = topOverlay();
  if (top) {
    // Заказ открыли из корзины, а корзина закрылась первой: после заказа фокус вернётся к кнопке корзины.
    if (el.contains(overlayOpeners.get(top.id))) overlayOpeners.set(top.id, opener);
    return;
  }
  if (opener?.isConnected && opener.getClientRects().length) opener.focus();
}

function trapOverlayTab(e) {
  if (e.key !== "Tab") return;
  const overlay = topOverlay();
  if (!overlay || document.getElementById("ai-chat")?.contains(document.activeElement)) return;
  const items = focusableIn(overlay);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (!overlay.contains(document.activeElement)) {
    e.preventDefault();
    first.focus();
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function openCart() {
  const drawer = document.getElementById("cart-drawer");
  if (!drawer) return;
  renderCart();
  drawer.hidden = false;
  document.body.style.overflow = "hidden";
  focusOverlay(drawer, document.getElementById("cart-close"));
}

function overlayOpen(id) {
  const el = document.getElementById(id);
  return Boolean(el && !el.hidden);
}

function syncPageScroll() {
  const open = overlayOpen("cart-drawer") || overlayOpen("order-modal") || overlayOpen("contact-modal");
  document.body.style.overflow = open ? "hidden" : "";
}

function closeCart() {
  const drawer = document.getElementById("cart-drawer");
  if (!drawer || drawer.hidden) return;
  drawer.hidden = true;
  syncPageScroll();
  restoreOverlayFocus(drawer);
}

const CLIENT_KEY = "dinara_client";
let pendingOrder = null;

function loadClientContact() {
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

function saveClientContact(contact) {
  localStorage.setItem(CLIENT_KEY, JSON.stringify({
    name: contact.name,
    phone: contact.phone,
  }));
}

function ordersApiUrl() {
  return location.protocol === "file:" ? "http://localhost:3000/api/orders" : "/api/orders";
}

const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(0, PHONE_MAX_DIGITS);
}

// Казахстан/Россия: 7 700 123 45 67. Остальные страны — группами по три цифры.
function formatOrderPhone(value) {
  const digits = phoneDigits(value);
  const local = /^(7|8$|8[79])/.test(digits) && digits.length <= 11;
  const sizes = local ? [1, 3, 3, 2, 2] : [3, 3, 3, 3, 3];
  const parts = [];
  let index = 0;
  sizes.forEach((size) => {
    if (index >= digits.length) return;
    parts.push(digits.slice(index, index + size));
    index += size;
  });
  return parts.join(" ");
}

// То же правило, что phoneKey в server.js.
function orderPhoneValue(value) {
  let digits = phoneDigits(value);
  if (digits.length === 11 && /^8[79]/.test(digits)) digits = `7${digits.slice(1)}`;
  else if (digits.length === 10 && /^[79]/.test(digits)) digits = `7${digits}`;
  return digits ? `+${digits}` : "";
}

function newClientOrderId() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

async function postJsonWithTimeout(url, body, timeoutMs) {
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

// Заказ, который сервер не принял (нет связи, перегрузка, лимит), ждёт здесь и досылается позже.
// Повторы безопасны: по clientOrderId сервер узнаёт уже сохранённый заказ и не создаёт дубль.
const PENDING_ORDERS_KEY = "dinara_pending_orders";
const PENDING_ORDER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_ORDERS_MAX = 10;
const PENDING_RETRY_MS = 60 * 1000;
let pendingFlushBusy = false;

function loadPendingOrders() {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_ORDERS_KEY) || "[]");
    const now = Date.now();
    return Array.isArray(list)
      ? list.filter((entry) => entry?.payload?.clientOrderId && now - Number(entry.savedAt) < PENDING_ORDER_MAX_AGE_MS)
      : [];
  } catch {
    return [];
  }
}

function savePendingOrders(list) {
  try {
    if (list.length) localStorage.setItem(PENDING_ORDERS_KEY, JSON.stringify(list.slice(-PENDING_ORDERS_MAX)));
    else localStorage.removeItem(PENDING_ORDERS_KEY);
  } catch {
    /* localStorage недоступен */
  }
}

function queuePendingOrder(payload) {
  const list = loadPendingOrders().filter((entry) => entry.payload.clientOrderId !== payload.clientOrderId);
  list.push({ payload, savedAt: Date.now() });
  savePendingOrders(list);
}

async function flushPendingOrders() {
  if (pendingFlushBusy) return;
  const list = loadPendingOrders();
  if (!list.length) {
    savePendingOrders([]);
    return;
  }
  pendingFlushBusy = true;
  const done = new Set();
  try {
    for (const entry of list) {
      try {
        const { res } = await postJsonWithTimeout(ordersApiUrl(), entry.payload, 12000);
        // 400/409 — такой заказ сервер уже не примет (каталог изменился); сообщение Динаре он всё равно получил.
        if (res.ok || res.status === 400 || res.status === 409) done.add(entry.payload.clientOrderId);
      } catch {
        /* нет связи — попробуем позже */
      }
    }
  } finally {
    // Перечитываем: пока шла отправка, другая вкладка могла добавить заказ.
    savePendingOrders(loadPendingOrders().filter((entry) => !done.has(entry.payload.clientOrderId)));
    pendingFlushBusy = false;
  }
}

function setOrderError(message) {
  const el = document.getElementById("order-error");
  if (!el) return;
  el.textContent = message || "";
  el.hidden = !message;
}

function resetOrderDone() {
  const panel = document.querySelector("#order-modal .order-modal__panel");
  if (!panel) return;
  panel.classList.remove("is-done");
  panel.setAttribute("aria-labelledby", "order-modal-title");
}

// После отправки окно не закрывается молча: покупатель видит номер заказа и может
// открыть мессенджер ещё раз, если браузер заблокировал новую вкладку.
function showOrderDone({ order, channel, url }) {
  const panel = document.querySelector("#order-modal .order-modal__panel");
  if (!panel) {
    closeOrderModal();
    return;
  }
  pendingOrder = null;
  let done = document.getElementById("order-done");
  if (!done) {
    done = document.createElement("div");
    done.id = "order-done";
    done.className = "order-done";
    done.setAttribute("aria-live", "polite");
    panel.appendChild(done);
    done.addEventListener("click", (e) => {
      if (e.target.closest("[data-order-done-close]")) closeOrderModal();
    });
  }
  const label = channel === "telegram" ? "Telegram" : "WhatsApp";
  const number = orderNumber(order);
  const text = order
    ? `Заказ сохранён${order.total ? ` на ${escapeHtml(order.total)}` : ""}. Отправьте Динаре сообщение в ${label} — текст уже готов.`
    : `Связь с сайтом сейчас пропала — заказ сохранится сам, как только она появится. Отправьте Динаре сообщение в ${label} — текст уже готов.`;
  done.innerHTML = `
    <span class="order-done__icon" aria-hidden="true">✓</span>
    <h3 id="order-done-title">${number ? `Заказ №${escapeHtml(number)} принят` : "Заказ почти готов"}</h3>
    <p class="order-modal__text">${text}</p>
    <div class="order-done__actions">
      <a class="btn ${channel === "telegram" ? "btn--tg" : "btn--primary"}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Открыть ${label}</a>
      <button type="button" class="btn btn--ghost-dark" data-order-done-close>Готово</button>
    </div>`;
  panel.classList.add("is-done");
  panel.setAttribute("aria-labelledby", "order-done-title");
  done.querySelector("[data-order-done-close]")?.focus();
}

function openCheckout(lines, source) {
  const modal = document.getElementById("order-modal");
  const summary = document.getElementById("order-summary");
  const totalEl = document.getElementById("order-total");
  if (!modal || !lines?.length) return;
  resetOrderDone();

  pendingOrder = { lines, source, clientOrderId: newClientOrderId() };
  const saved = loadClientContact();
  const nameInput = document.getElementById("order-name");
  const phoneInput = document.getElementById("order-phone");
  if (nameInput && !nameInput.value) nameInput.value = saved.name;
  if (phoneInput) phoneInput.value = formatOrderPhone(phoneInput.value || saved.phone);
  setOrderError("");

  if (summary) {
    summary.innerHTML = lines
      .map(({ product, qty }) => `
        <li>
          <span>${escapeHtml(product.title)} × ${qty}</span>
          <strong>${escapeHtml(totalPrice(product, qty))}</strong>
        </li>`)
      .join("");
  }
  if (totalEl) totalEl.innerHTML = `Итого: <strong>${escapeHtml(cartTotalsByCurrency(lines).join(" · "))}</strong>`;

  modal.hidden = false;
  syncPageScroll();
  focusOverlay(modal, nameInput);
}

function closeOrderModal() {
  const modal = document.getElementById("order-modal");
  if (!modal) return;
  const wasOpen = !modal.hidden;
  modal.hidden = true;
  pendingOrder = null;
  resetOrderDone();
  syncPageScroll();
  if (wasOpen) restoreOverlayFocus(modal);
}

function localPhone(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("7")) return `8${d.slice(1)}`;
  return d;
}

function prettyPhone(digits) {
  const d = localPhone(digits);
  if (d.length !== 11) return d;
  return `${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}`;
}

function ensureContactModal() {
  if (document.getElementById("contact-modal")) return;
  const phone = typeof WA_PHONE !== "undefined" ? WA_PHONE : "77003096823";
  const tg = typeof TG_USER !== "undefined" ? TG_USER : "TDS_dinara";
  const shown = prettyPhone(phone);
  const modal = document.createElement("div");
  modal.className = "order-modal contact-modal";
  modal.id = "contact-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="contact-modal__panel" role="dialog" aria-modal="true" aria-labelledby="contact-modal-title">
      <button type="button" class="contact-modal__close" id="contact-modal-close" aria-label="Закрыть">×</button>
      <p class="contact-modal__kicker">Контакт</p>
      <h3 id="contact-modal-title">Напишите — обсудим ролик</h3>
      <p class="contact-modal__text">Расскажите задачу и аудиторию. Отвечу и предложу простой формат.</p>
      <div class="contact-modal__list">
        <a class="contact-modal__row" id="contact-wa" href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer">
          <span>WhatsApp</span>
          <strong>${shown}</strong>
        </a>
        <a class="contact-modal__row contact-modal__row--tg" id="contact-tg" href="https://t.me/${tg}" target="_blank" rel="noopener noreferrer">
          <span>Telegram</span>
          <strong>@${tg}</strong>
        </a>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeContactModal();
  });
  modal.querySelector("#contact-modal-close")?.addEventListener("click", closeContactModal);
}

function openContactModal() {
  ensureContactModal();
  const modal = document.getElementById("contact-modal");
  if (!modal) return;
  modal.hidden = false;
  syncPageScroll();
  focusOverlay(modal, document.getElementById("contact-wa"));
}

function closeContactModal() {
  const modal = document.getElementById("contact-modal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  syncPageScroll();
  restoreOverlayFocus(modal);
}

function isContactLink(node) {
  const link = node?.closest?.("a[href]");
  if (!link || link.closest("#contact-modal")) return false;
  const href = link.getAttribute("href") || "";
  return href === "#contact" || href.endsWith("#contact");
}

function openMessenger(popup, url) {
  if (popup && !popup.closed) {
    try {
      popup.location.href = url;
      return;
    } catch {
      /* окно могли заблокировать — откроем ссылку ещё раз */
    }
  }
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.assign(url);
}

let checkoutBusy = false;

async function handleStaleCatalog(source, message) {
  await syncProductsWithServer();
  renderCart();
  const fresh = source === "cart" ? getCartLines() : [];
  if (fresh.length) {
    openCheckout(fresh, "cart");
    setOrderError("Каталог обновился — проверьте заказ и отправьте ещё раз.");
    return;
  }
  closeOrderModal();
  alert(message || "Этого товара уже нет в каталоге.");
}

async function submitCheckout(channel) {
  if (checkoutBusy) return;
  const lines = pendingOrder?.lines;
  const source = pendingOrder?.source;
  const clientOrderId = pendingOrder?.clientOrderId;
  if (!lines?.length) return;

  const name = document.getElementById("order-name")?.value.trim().replace(/\s+/g, " ") || "";
  const digits = phoneDigits(document.getElementById("order-phone")?.value || "");
  const phone = orderPhoneValue(digits);

  if (name.length < 2) {
    setOrderError("Укажите имя");
    document.getElementById("order-name")?.focus();
    return;
  }
  if (digits.length < PHONE_MIN_DIGITS) {
    setOrderError("Введите номер с кодом страны, например 7 700 123 45 67");
    document.getElementById("order-phone")?.focus();
    return;
  }

  const contact = { name, phone };
  const buttons = [...document.querySelectorAll("#order-form button[type='submit']")];
  const setBusy = (busy) => {
    checkoutBusy = busy;
    buttons.forEach((btn) => {
      btn.disabled = busy;
    });
  };
  setBusy(true);
  setOrderError("");

  const popup = window.open("about:blank", "_blank");
  const payload = orderPayload(lines, contact, channel, clientOrderId);
  let savedOrder = null;
  try {
    const { res, data } = await postJsonWithTimeout(ordersApiUrl(), payload, 12000);
    // 400 — ошибка в данных, 409 — каталог изменился: это покупатель должен увидеть и поправить.
    // Остальные сбои (сервер лежит, лимит, таймаут) не должны срывать заказ — он уйдёт сообщением.
    if (res.status === 400 || res.status === 409) {
      if (popup && !popup.closed) popup.close();
      if (res.status === 409) await handleStaleCatalog(source, data.error);
      else setOrderError(data.error || "Проверьте данные заказа");
      return;
    }
    if (res.ok && data.order) savedOrder = data.order;
  } catch {
    /* нет связи или таймаут — ниже откроем мессенджер с текстом заказа из браузера */
  } finally {
    setBusy(false);
  }

  if (!savedOrder) queuePendingOrder(payload);
  saveClientContact(contact);
  const text = savedOrder
    ? orderTextFromRows(savedOrder.items || [], savedOrder.total, contact, orderNumber(savedOrder))
    : buildOrderText(lines, contact);
  const url = messengerUrl(channel, text);
  openMessenger(popup, url);
  if (source === "cart") {
    clearCart();
    renderCart();
    closeCart();
  }
  showOrderDone({ order: savedOrder, channel, url });
}

function flashAdded(btn) {
  if (!btn) return;
  const prev = btn.textContent;
  btn.textContent = "Добавлено";
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = prev || "В корзину";
    btn.disabled = false;
  }, 900);
}

function renderShop() {
  const grid = document.getElementById("shop-grid");
  if (!grid) return;

  const limitAttr = Number(grid.dataset.limit);
  const allProducts = loadProducts();
  const products =
    Number.isFinite(limitAttr) && limitAttr > 0
      ? allProducts.slice(0, limitAttr)
      : allProducts;

  if (!allProducts.length) {
    const message = !productsLoaded
      ? "Загружаем каталог…"
      : productsLoadFailed
        ? "Не удалось загрузить каталог. Обновите страницу чуть позже."
        : "Пока нет услуг.";
    grid.innerHTML = `<p class="shop__empty">${message}</p>`;
    const moreEmpty = document.querySelector(".shop__more");
    if (moreEmpty) moreEmpty.hidden = true;
    return;
  }

  const more = document.querySelector(".shop__more");
  if (more && grid.dataset.limit) {
    more.hidden = allProducts.length <= limitAttr;
  }

  grid.innerHTML = products
    .map(
      (p) => `
      <article class="product-card" data-id="${escapeHtml(p.id)}">
        ${mediaHtml(p)}
        <div class="product-card__body">
          <h3 class="product-card__title">${escapeHtml(p.title)}</h3>
          <p class="product-card__desc">${escapeHtml(p.description)}</p>
          <div class="product-card__bar">
            <span class="product-card__price">${escapeHtml(displayPrice(p))}</span>
            <div class="product-card__qty" role="group" aria-label="Количество">
              <button type="button" class="product-card__qty-btn" data-qty-minus aria-label="Меньше">−</button>
              <span class="product-card__qty-val" data-qty>1</span>
              <button type="button" class="product-card__qty-btn" data-qty-plus aria-label="Больше">+</button>
            </div>
            <button type="button" class="btn btn--ghost-dark btn--order" data-add-cart="${escapeHtml(p.id)}">В корзину</button>
            <button type="button" class="btn btn--primary btn--order product-card__buy" data-buy="${escapeHtml(p.id)}">Заказать</button>
          </div>
        </div>
      </article>`
    )
    .join("");
}

document.addEventListener("DOMContentLoaded", () => {
  renderShop();
  updateCartBadge();

  flushPendingOrders();
  setInterval(flushPendingOrders, PENDING_RETRY_MS);
  window.addEventListener("online", flushPendingOrders);

  window.addEventListener("products:updated", () => {
    renderShop();
    updateCartBadge();
    if (typeof renderCart === "function") renderCart();
  });

  window.addEventListener("storage", (e) => {
    if (e.key !== CART_KEY && e.key !== null) return;
    updateCartBadge();
    renderCart();
  });

  document.getElementById("shop-grid")?.addEventListener("click", (e) => {
    const card = e.target.closest(".product-card");
    if (!card) return;

    const qtyEl = card.querySelector("[data-qty]");
    const readQty = () => Math.max(1, Math.min(99, Number(qtyEl?.textContent) || 1));
    const writeQty = (n) => {
      if (qtyEl) qtyEl.textContent = String(n);
    };

    if (e.target.closest("[data-qty-minus]") && qtyEl) {
      writeQty(Math.max(1, readQty() - 1));
      return;
    }
    if (e.target.closest("[data-qty-plus]") && qtyEl) {
      writeQty(Math.min(99, readQty() + 1));
      return;
    }

    const buyBtn = e.target.closest("[data-buy]");
    if (buyBtn) {
      e.preventDefault();
      const products = loadProducts();
      const product = products.find((p) => p.id === buyBtn.dataset.buy);
      const qty = readQty();
      if (!product) return;
      openCheckout([{ product, qty }], "buy");
      return;
    }

    const addBtn = e.target.closest("[data-add-cart]");
    if (!addBtn) return;
    addToCart(addBtn.dataset.addCart, readQty());
    updateCartBadge();
    flashAdded(addBtn);
  });

  document.getElementById("cart-open")?.addEventListener("click", openCart);
  document.getElementById("cart-close")?.addEventListener("click", closeCart);
  document.getElementById("cart-close-backdrop")?.addEventListener("click", closeCart);

  document.getElementById("cart-list")?.addEventListener("click", (e) => {
    const item = e.target.closest(".cart-item");
    if (!item) return;
    const id = item.dataset.id;
    const qtyEl = item.querySelector("[data-cart-qty]");
    const readQty = () => Math.max(1, Math.min(99, Number(qtyEl?.textContent) || 1));

    if (e.target.closest("[data-cart-remove]")) {
      removeFromCart(id);
      renderCart();
      return;
    }
    if (e.target.closest("[data-cart-minus]") && qtyEl) {
      setCartQty(id, Math.max(1, readQty() - 1));
      renderCart();
      return;
    }
    if (e.target.closest("[data-cart-plus]") && qtyEl) {
      setCartQty(id, Math.min(99, readQty() + 1));
      renderCart();
    }
  });

  document.getElementById("cart-clear")?.addEventListener("click", () => {
    if (!confirm("Очистить корзину?")) return;
    clearCart();
    renderCart();
  });

  document.getElementById("cart-checkout")?.addEventListener("click", () => {
    const lines = getCartLines();
    if (!lines.length) return;
    openCheckout(lines, "cart");
  });

  document.getElementById("order-modal-close")?.addEventListener("click", closeOrderModal);
  document.getElementById("order-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "order-modal") closeOrderModal();
  });
  document.getElementById("order-name")?.addEventListener("input", () => setOrderError(""));
  document.getElementById("order-phone")?.addEventListener("input", (e) => {
    const input = e.target;
    const next = formatOrderPhone(input.value);
    if (input.value !== next) input.value = next;
    setOrderError("");
  });

  document.getElementById("order-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const channel = e.submitter?.dataset.channel === "telegram" ? "telegram" : "whatsapp";
    submitCheckout(channel);
  });

  ensureContactModal();

  document.addEventListener("click", (e) => {
    if (!isContactLink(e.target)) return;
    e.preventDefault();
    openContactModal();
  });

  if (location.hash === "#contact") openContactModal();

  document.addEventListener("keydown", trapOverlayTab);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (overlayOpen("contact-modal")) {
      closeContactModal();
      return;
    }
    if (overlayOpen("order-modal")) {
      closeOrderModal();
      return;
    }
    closeCart();
  });
});

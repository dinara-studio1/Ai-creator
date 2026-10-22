const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_PRICE_DIGITS = 9;

async function adminLogin(pass) {
  try {
    const res = await fetch(`${apiOrigin()}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pass }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.token) return { ok: true, token: data.token };
    return { ok: false, error: data.error || "Неверный пароль" };
  } catch {
    return {
      ok: false,
      error: "Сервер не запущен. Запустите start.cmd и откройте http://localhost:3000/admin.html",
    };
  }
}

function isAuthed() {
  return Boolean(adminToken());
}

function setAuthed(ok, token = "") {
  if (ok && token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
  else localStorage.removeItem(ADMIN_TOKEN_KEY);
  const logout = document.getElementById("admin-logout");
  if (logout) logout.hidden = !ok;
}

/**
 * change получает свежий список товаров и возвращает новый (или null — отмена).
 * Ждём первую загрузку каталога с сервера, иначе можно сохранить устаревший список поверх нового.
 */
async function updateCatalog(change) {
  await productsReady;
  if (productsLoadFailed) {
    alert("Нет связи с сервером. Запустите start.cmd и откройте сайт по адресу http://localhost:3000");
    return false;
  }
  const next = change(loadProducts());
  if (!next) return false;
  const result = await saveProducts(next);
  if (!result.ok && result.status !== 401) {
    alert(
      result.error ||
        "Не удалось сохранить каталог на сервере. Запустите start.cmd и откройте сайт по адресу http://localhost:3000"
    );
  }
  renderAdminList();
  return result.ok;
}

function showPanel() {
  document.getElementById("login-box").hidden = true;
  document.getElementById("admin-panel").hidden = false;
  const logout = document.getElementById("admin-logout");
  if (logout) logout.hidden = false;
  renderAdminList();
  fetchOrders();
  fetchClients();
  startOrdersPolling();
}

const ORDERS_POLL_MS = 30 * 1000;
const ADMIN_TITLE = document.title;
let ordersPollTimer = 0;
// Список изменился, но админ как раз выбирает статус — перерисуем при следующей проверке.
let ordersStale = false;

function startOrdersPolling() {
  clearInterval(ordersPollTimer);
  ordersPollTimer = setInterval(pollOrders, ORDERS_POLL_MS);
}

function pollOrders() {
  if (!isAuthed() || document.getElementById("admin-panel")?.hidden) return;
  fetchOrders({ quiet: true });
}

const ORDER_STATUSES = [
  ["new", "Новый"],
  ["progress", "В работе"],
  ["done", "Готово"],
  ["cancelled", "Отменён"],
];

let ordersCache = [];
let clientsCache = [];

function apiOrigin() {
  return location.protocol === "file:" ? "http://localhost:3000" : "";
}

async function adminFetch(path, options = {}) {
  const headers = Object.assign({ "X-Admin-Token": adminToken() }, options.headers || {});
  const res = await fetch(`${apiOrigin()}${path}`, {
    ...options,
    headers,
    cache: "no-store",
  });
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent("products:auth-required"));
    throw new Error("Нужно войти в админку ещё раз");
  }
  return res;
}

function updateOrdersBadge() {
  const badge = document.getElementById("orders-new-badge");
  if (!badge) return;
  const count = ordersCache.filter((order) => order.status === "new").length;
  badge.textContent = String(count);
  badge.hidden = count === 0;
  document.title = count ? `(${count}) ${ADMIN_TITLE}` : ADMIN_TITLE;
}

function formatOrderDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function orderChannelLabel(channel) {
  return channel === "telegram" ? "Telegram" : "WhatsApp";
}

const WA_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12.04 2C6.58 2 2.15 6.4 2.15 11.83c0 1.74.46 3.44 1.34 4.94L2 22l5.39-1.41a10.1 10.1 0 0 0 4.65 1.18h.01c5.46 0 9.89-4.4 9.89-9.83C21.94 6.4 17.5 2 12.04 2zm5.76 13.9c-.24.68-1.4 1.3-1.94 1.38-.5.08-1.12.11-1.81-.11-.41-.14-.95-.31-1.63-.61-2.87-1.24-4.74-4.13-4.88-4.32-.14-.19-1.16-1.54-1.16-2.94s.73-2.08 1-2.37c.24-.27.64-.39 1.02-.39h.73c.23 0 .54-.09.85.64.32.77 1.08 2.64 1.18 2.83.09.19.16.42.03.67-.12.26-.18.42-.36.64-.18.22-.38.5-.54.67-.18.18-.36.38-.16.73.21.35.93 1.53 2 2.48 1.37 1.22 2.53 1.6 2.89 1.78.36.18.57.15.78-.09.21-.24.9-1.05 1.14-1.41.24-.36.48-.3.81-.18.33.12 2.1 1 2.46 1.18.36.18.6.27.69.42.09.15.09.86-.15 1.54z"/></svg>`;

const TG_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M21.5 4.5 2.8 11.2c-1.2.46-1.19 1.1-.22 1.39l4.8 1.5 11.1-7c.52-.32 1 .16.6.5l-9 8.14-.34 4.9c.5 0 .72-.23 1-.5l2.4-2.33 5 3.68c.92.5 1.58.24 1.81-.85l3.28-15.46c.34-1.35-.52-1.96-1.43-1.57z"/></svg>`;

function orderStatusLabel(status) {
  return ORDER_STATUSES.find(([value]) => value === status)?.[1] || "Новый";
}

// То же правило, что phoneKey в server.js.
function replyPhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 11 && /^8[79]/.test(digits)) digits = `7${digits.slice(1)}`;
  else if (digits.length === 10 && /^[79]/.test(digits)) digits = `7${digits}`;
  return digits;
}

function replyGreeting(name) {
  const rawName = String(name || "").trim();
  const who = rawName ? rawName.charAt(0).toLocaleUpperCase("ru") + rawName.slice(1) : "";
  const hello = who ? `Здравствуйте, ${who}!` : "Здравствуйте!";
  return `${hello} Это Динара. Напишите, пожалуйста, когда вам удобно обсудить наш проект?`;
}

function replyText(order) {
  return replyGreeting(order.name);
}

function replyLinks(order) {
  const phone = replyPhone(order.phone);
  if (!phone) return { wa: "", tg: "" };
  const text = encodeURIComponent(replyText(order));
  return {
    wa: `https://wa.me/${phone}?text=${text}`,
    tg: `https://t.me/+${phone}?text=${text}`,
  };
}

function clientReplyText(client) {
  return replyGreeting(client.name);
}

function clientReplyLinks(client) {
  const phone = replyPhone(client.phone);
  if (!phone) return { wa: "", tg: "" };
  const text = encodeURIComponent(clientReplyText(client));
  return {
    wa: `https://wa.me/${phone}?text=${text}`,
    tg: `https://t.me/+${phone}?text=${text}`,
  };
}

// Итог заказа хранится строкой вида «10 000 ₸ · 5 $» — складываем суммы по каждой валюте.
function addTotals(sums, total) {
  String(total || "")
    .split("·")
    .forEach((part) => {
      const amount = Number(part.replace(/\D/g, ""));
      const symbol = part.replace(/[\d\s]/g, "");
      if (amount && symbol) sums[symbol] = (sums[symbol] || 0) + amount;
    });
  return sums;
}

function formatSums(sums) {
  const parts = Object.entries(sums).map(([symbol, amount]) => `${formatAmount(amount)} ${symbol}`);
  return parts.length ? parts.join(" · ") : "0 ₸";
}

// Месяц выручки — по дате, когда заказу поставили «Готово», а не когда его оформили.
function orderDoneAt(order) {
  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const entry = history.filter((item) => item.status === "done").pop();
  return entry?.at || order.updatedAt || order.createdAt;
}

// Телефон ищем и в местном виде: «8 700…» находит заказ с номером «+7 700…».
function orderMatchesQuery(order, query) {
  if (!query) return true;
  if (String(order.name || "").toLocaleLowerCase("ru").includes(query)) return true;
  if (orderNumber(order).toLowerCase().includes(query.replace(/^№\s*/, ""))) return true;
  const digits = query.replace(/\D/g, "");
  if (digits.length < 3) return false;
  const phone = String(order.phone || "").replace(/\D/g, "");
  return phone.includes(digits) || phone.includes(digits.replace(/^8/, "7"));
}

function renderOrders() {
  const list = document.getElementById("orders-list");
  const stats = document.getElementById("orders-stats");
  if (!list) return;
  ordersStale = false;
  const openHistory = new Set(
    [...list.querySelectorAll("details.order-row__history[open]")].map((el) => el.dataset.orderId)
  );

  const counts = { new: 0, progress: 0, done: 0, cancelled: 0 };
  ordersCache.forEach((order) => {
    if (counts[order.status] != null) counts[order.status] += 1;
  });
  updateOrdersBadge();
  if (stats) {
    const statItems = [
      ["new", "Новые", counts.new],
      ["progress", "В работе", counts.progress],
      ["done", "Готово", counts.done],
      ["cancelled", "Отменённые", counts.cancelled],
    ];
    const done = ordersCache.filter((order) => order.status === "done");
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const revenueAll = done.reduce((sums, order) => addTotals(sums, order.total), {});
    const revenueMonth = done
      .filter((order) => new Date(orderDoneAt(order)) >= monthStart)
      .reduce((sums, order) => addTotals(sums, order.total), {});
    const revenue = `<span class="orders-stat orders-stat--sum">Выручка <b>${escapeAttr(formatSums(revenueAll))}</b> · в этом месяце <b>${escapeAttr(formatSums(revenueMonth))}</b></span>`;
    stats.innerHTML = ordersCache.length
      ? statItems
          .map(
            ([key, label, count]) =>
              `<span class="orders-stat orders-stat--${key}"><b>${count}</b> ${label}</span>`
          )
          .join("") + revenue
      : "";
  }

  if (!ordersCache.length) {
    list.innerHTML = `<p class="orders-empty">Пока нет заказов. Они появятся здесь, когда клиент оформит заказ на сайте.</p>`;
    return;
  }

  const filter = document.getElementById("orders-filter")?.value || "all";
  const query = (document.getElementById("orders-search")?.value || "").trim().toLocaleLowerCase("ru");
  const rows = ordersCache.filter(
    (order) => (filter === "all" || order.status === filter) && orderMatchesQuery(order, query)
  );
  if (!rows.length) {
    list.innerHTML = `<p class="orders-empty">${query ? "Ничего не найдено." : "Нет заказов с таким статусом."}</p>`;
    return;
  }

  list.innerHTML = rows.map((order) => {
    const items = (order.items || [])
      .map((item) => {
        const sum = item.lineTotal || item.unitPrice || "";
        return `<li>
          <span class="order-row__item-title">${escapeAttr(item.title || "")}</span>
          <span class="order-row__item-meta">${item.qty} шт.${sum ? ` · цена ${escapeAttr(sum)}` : ""}</span>
        </li>`;
      })
      .join("");
    const statusOptions = ORDER_STATUSES.map(
      ([value, label]) =>
        `<option value="${value}"${order.status === value ? " selected" : ""}>${label}</option>`
    ).join("");
    const phoneDigits = replyPhone(order.phone);
    const links = replyLinks(order);
    const reply = links.wa
      ? `<div class="order-row__reply">
          <a class="order-row__wa" href="${escapeAttr(links.wa)}" target="_blank" rel="noopener noreferrer" aria-label="Ответить в WhatsApp" title="WhatsApp">${WA_ICON}</a>
          <a class="order-row__tg" href="${escapeAttr(links.tg)}" target="_blank" rel="noopener noreferrer" aria-label="Ответить в Telegram" title="Telegram">${TG_ICON}</a>
        </div>`
      : "";
    const status = escapeAttr(order.status || "new");
    const historyRows = (Array.isArray(order.statusHistory) ? order.statusHistory : [])
      .slice()
      .reverse()
      .map(
        (entry) =>
          `<li><time datetime="${escapeAttr(entry.at)}">${escapeAttr(formatOrderDate(entry.at))}</time> — ${escapeAttr(orderStatusLabel(entry.status))}</li>`
      )
      .join("");
    const changed = order.updatedAt && order.updatedAt !== order.createdAt;
    const history = historyRows
      ? `<details class="order-row__history" data-order-id="${escapeAttr(order.id)}"${openHistory.has(order.id) ? " open" : ""}>
          <summary>${changed ? `Статус изменён ${escapeAttr(formatOrderDate(order.updatedAt))}` : "История статусов"}</summary>
          <ol>${historyRows}</ol>
        </details>`
      : "";
    return `
      <article class="order-row" data-status="${status}">
        <div class="order-row__body">
          <div class="order-row__top">
            <div>
              <strong>${escapeAttr(order.name)}</strong>
              <a class="order-row__phone" href="tel:+${escapeAttr(phoneDigits)}">${escapeAttr(order.phone)}</a>
            </div>
            <div class="order-row__meta">
              <span class="order-row__no">№${escapeAttr(orderNumber(order))}</span>
              <span class="order-row__status order-row__status--${status}">${escapeAttr(orderStatusLabel(order.status))}</span>
              <span class="order-row__channel order-row__channel--${escapeAttr(order.channel)}">${orderChannelLabel(order.channel)}</span>
              <time datetime="${escapeAttr(order.createdAt)}">${escapeAttr(formatOrderDate(order.createdAt))}</time>
            </div>
          </div>
          <ul class="order-row__items">${items}</ul>
          <p class="order-row__total">Итого: <strong>${escapeAttr(order.total || "—")}</strong></p>
          ${history}
          <div class="order-row__actions">
            <label class="order-row__status-field">
              <select data-order-status="${escapeAttr(order.id)}" aria-label="Статус заказа">${statusOptions}</select>
            </label>
            <button type="button" data-order-del="${escapeAttr(order.id)}">Удалить</button>
            ${reply}
          </div>
        </div>
      </article>`;
  }).join("");
}

async function fetchOrders({ quiet = false } = {}) {
  const list = document.getElementById("orders-list");
  try {
    const res = await adminFetch("/api/orders");
    if (!res.ok) throw new Error("Не удалось загрузить заказы");
    const data = await res.json();
    const next = Array.isArray(data.orders) ? data.orders : [];
    if (!quiet || JSON.stringify(next) !== JSON.stringify(ordersCache)) ordersStale = true;
    ordersCache = next;
    updateOrdersBadge();
    // Фоновая проверка не перерисовывает список под рукой: открытый выпадающий список статуса закрылся бы.
    if (ordersStale && !(quiet && list?.contains(document.activeElement))) renderOrders();
    return true;
  } catch (err) {
    updateOrdersBadge();
    if (!quiet && list && !document.getElementById("orders-card")?.hidden) {
      list.innerHTML = `<p class="orders-empty">${escapeAttr(err.message || "Не удалось загрузить заказы. Запустите сервер через start.cmd.")}</p>`;
    }
    return false;
  }
}

async function patchOrder(id, status) {
  const res = await adminFetch(`/api/orders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Не удалось обновить статус");
  return data.order;
}

async function deleteOrder(id) {
  const res = await adminFetch(`/api/orders/${encodeURIComponent(id)}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Не удалось удалить заказ");
}

function showAdminTab(name) {
  const products = document.getElementById("products-card");
  const orders = document.getElementById("orders-card");
  const clients = document.getElementById("clients-card");
  if (products) products.hidden = name !== "products";
  if (orders) orders.hidden = name !== "orders";
  if (clients) clients.hidden = name !== "clients";
  document.querySelectorAll("[data-admin-tab]").forEach((btn) => {
    const active = btn.dataset.adminTab === name;
    btn.classList.toggle("is-active", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  if (name === "orders") fetchOrders();
  if (name === "clients") fetchClients();
}

function renderClients() {
  const list = document.getElementById("clients-list");
  if (!list) return;
  if (!clientsCache.length) {
    list.innerHTML = `<p class="orders-empty">Пока нет клиентов. Они появятся здесь после первого заказа.</p>`;
    return;
  }
  list.innerHTML = clientsCache
    .map((client) => {
      const phoneDigits = replyPhone(client.phone);
      const links = clientReplyLinks(client);
      const reply = links.wa
        ? `<div class="client-card__reply">
            <a class="order-row__wa" href="${escapeAttr(links.wa)}" target="_blank" rel="noopener noreferrer" aria-label="Написать в WhatsApp" title="WhatsApp">${WA_ICON}</a>
            <a class="order-row__tg" href="${escapeAttr(links.tg)}" target="_blank" rel="noopener noreferrer" aria-label="Написать в Telegram" title="Telegram">${TG_ICON}</a>
          </div>`
        : "";
      const count = Number(client.orderCount) || 0;
      const mod10 = count % 10;
      const mod100 = count % 100;
      const ordersWord =
        mod10 === 1 && mod100 !== 11
          ? "заказ"
          : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
            ? "заказа"
            : "заказов";
      const cancelled = Number(client.cancelledCount) || 0;
      const ordersLabel = `${count} ${ordersWord}${cancelled ? ` · отменено: ${cancelled}` : ""}`;
      const otherNames = Array.isArray(client.otherNames) ? client.otherNames : [];
      const namesLine = otherNames.length
        ? `<p class="client-card__names">Также представлялся(ась): ${escapeAttr(otherNames.join(", "))}</p>`
        : "";
      return `
        <article class="client-card">
          <strong>${escapeAttr(client.name)}</strong>
          ${namesLine}
          <a class="order-row__phone" href="tel:+${escapeAttr(phoneDigits)}">${escapeAttr(client.phone)}</a>
          <p class="client-card__count">${ordersLabel}</p>
          <p class="client-card__date">Последний заказ: ${escapeAttr(formatOrderDate(client.lastOrderAt))}</p>
          ${reply}
          <label class="client-card__comment">
            Комментарий
            <textarea data-client-comment="${escapeAttr(client.id)}" rows="3" maxlength="500" placeholder="Заметка о клиенте">${escapeAttr(client.comment || "")}</textarea>
          </label>
          <span class="client-card__comment-status" data-comment-status="${escapeAttr(client.id)}" aria-live="polite"></span>
        </article>`;
    })
    .join("");
}

const COMMENT_SAVE_DELAY_MS = 800;
// id клиента -> { value, timer, chain }: несохранённый текст и очередь запросов,
// чтобы ответы не приходили вразнобой и старый текст не затирал новый.
const commentSaves = new Map();

function commentStatus(id, text, isError = false) {
  const status = document.querySelector(`[data-comment-status="${CSS.escape(id)}"]`);
  const field = document.querySelector(`[data-client-comment="${CSS.escape(id)}"]`);
  if (status) {
    status.textContent = text;
    status.classList.toggle("is-error", isError);
  }
  if (field) {
    if (isError) field.setAttribute("aria-invalid", "true");
    else field.removeAttribute("aria-invalid");
  }
}

function queueCommentSave(id, value) {
  const entry = commentSaves.get(id) || { value: "", timer: 0, chain: Promise.resolve() };
  entry.value = value;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => flushCommentSave(id), COMMENT_SAVE_DELAY_MS);
  commentSaves.set(id, entry);
  commentStatus(id, "Не сохранено…");
}

function flushCommentSave(id) {
  const entry = commentSaves.get(id);
  if (!entry) return Promise.resolve();
  clearTimeout(entry.timer);
  entry.chain = entry.chain.then(() => saveLatestComment(id, entry));
  return entry.chain;
}

async function saveLatestComment(id, entry) {
  if (commentSaves.get(id) !== entry) return;
  const value = entry.value;
  const client = clientsCache.find((item) => item.id === id);
  if (!client || String(client.comment || "") !== value) {
    commentStatus(id, "Сохраняем…");
    try {
      await saveClientComment(id, value);
    } catch (err) {
      commentStatus(id, `Не сохранено: ${err.message || "ошибка"}. Попробуйте ещё раз.`, true);
      return;
    }
  }
  if (entry.value === value) {
    commentSaves.delete(id);
    commentStatus(id, "Сохранено");
  }
}

async function saveClientComment(id, comment) {
  const res = await adminFetch(`/api/clients/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comment }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Не удалось сохранить комментарий");
  const client = clientsCache.find((item) => item.id === id);
  if (client) client.comment = data.client?.comment || "";
}

async function fetchClients() {
  const list = document.getElementById("clients-list");
  try {
    await Promise.all([...commentSaves.keys()].map(flushCommentSave));
    const res = await adminFetch("/api/clients");
    if (!res.ok) throw new Error("Не удалось загрузить клиентов");
    const data = await res.json();
    clientsCache = Array.isArray(data.clients) ? data.clients : [];
    renderClients();
    // Текст, который не удалось сохранить, не должен пропасть при перерисовке.
    commentSaves.forEach((entry, id) => {
      const field = document.querySelector(`[data-client-comment="${CSS.escape(id)}"]`);
      if (field) field.value = entry.value;
      commentStatus(id, "Не сохранено. Попробуйте ещё раз.", true);
    });
    return true;
  } catch (err) {
    if (list && !document.getElementById("clients-card")?.hidden) {
      list.innerHTML = `<p class="orders-empty">${escapeAttr(err.message || "Не удалось загрузить клиентов.")}</p>`;
    }
    return false;
  }
}

function thumbSrc(product) {
  const src = safeMediaUrl(product.image);
  if (isVideoUrl(src) || src.startsWith("data:video")) {
    return "";
  }
  return src;
}

function renderAdminList() {
  const list = document.getElementById("admin-list");
  const products = loadProducts();
  if (!products.length) {
    list.innerHTML = !productsLoaded
      ? "<p>Загружаем каталог…</p>"
      : productsLoadFailed
        ? "<p>Нет связи с сервером. Запустите start.cmd.</p>"
        : "<p>Список пуст.</p>";
    return;
  }

  list.innerHTML = products
    .map((p) => {
      const thumb = thumbSrc(p);
      const media = thumb
        ? `<img src="${escapeAttr(thumb)}" alt="" width="72" height="72" />`
        : `<div class="admin-item__video">Видео</div>`;
      return `
      <article class="admin-item">
        ${media}
        <div>
          <strong>${escapeAttr(p.title)}</strong>
          <span>Цена ${escapeAttr(displayPrice(p))}</span>
          <p>${escapeAttr(p.description)}</p>
        </div>
        <div class="admin-item__actions">
          <button type="button" data-edit="${escapeAttr(p.id)}">Изменить</button>
          <button type="button" data-del="${escapeAttr(p.id)}">Удалить</button>
        </div>
      </article>`;
    })
    .join("");
}

function escapeAttr(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function clearMediaPreview() {
  const imageInput = document.getElementById("f-image");
  const fileInput = document.getElementById("f-file");
  const empty = document.getElementById("dropzone-empty");
  const preview = document.getElementById("dropzone-preview");
  const img = document.getElementById("dropzone-img");
  const video = document.getElementById("dropzone-video");
  const editBtn = document.getElementById("dropzone-edit");

  imageInput.value = "";
  if (fileInput) fileInput.value = "";
  empty.hidden = false;
  preview.hidden = true;
  img.hidden = true;
  video.hidden = true;
  if (editBtn) editBtn.hidden = true;
  img.removeAttribute("src");
  video.removeAttribute("src");
}

function showMediaPreview(src) {
  const imageInput = document.getElementById("f-image");
  const empty = document.getElementById("dropzone-empty");
  const preview = document.getElementById("dropzone-preview");
  const img = document.getElementById("dropzone-img");
  const video = document.getElementById("dropzone-video");
  const editBtn = document.getElementById("dropzone-edit");

  imageInput.value = src || "";
  if (!src) {
    clearMediaPreview();
    return;
  }

  empty.hidden = true;
  preview.hidden = false;

  const isVideo = isVideoUrl(src) || src.startsWith("data:video");
  if (isVideo) {
    img.hidden = true;
    img.removeAttribute("src");
    video.hidden = false;
    video.src = src;
    if (editBtn) editBtn.hidden = true;
  } else {
    video.hidden = true;
    video.removeAttribute("src");
    img.hidden = false;
    img.src = src;
    if (editBtn) editBtn.hidden = false;
  }
}

function readBlobAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(blob);
  });
}

function readFileAsDataURL(file) {
  return readBlobAsDataURL(file);
}

async function toEditableDataUrl(src) {
  if (!src) throw new Error("Нет изображения");
  if (String(src).startsWith("data:")) return src;

  try {
    const res = await fetch(src, { mode: "cors" });
    if (!res.ok) throw new Error("fetch failed");
    return await readBlobAsDataURL(await res.blob());
  } catch {
    /* fallback below */
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        canvas.getContext("2d").drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      } catch {
        reject(new Error("Нельзя обрезать это фото. Загрузите файл с компьютера."));
      }
    };
    img.onerror = () =>
      reject(new Error("Нельзя обрезать это фото. Загрузите файл с компьютера."));
    img.src = src;
  });
}

function loadImageFromSrc(src) {
  return toEditableDataUrl(src).then(
    (dataUrl) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ img, dataUrl });
        img.onerror = () => reject(new Error("Не удалось открыть изображение"));
        img.src = dataUrl;
      })
  );
}

const CROP_ASPECT = 16 / 10;
const cropState = {
  source: null,
  dataUrl: "",
  zoom: 1,
  ox: 0,
  oy: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
};

function getCropMetrics() {
  const stage = document.getElementById("crop-stage");
  const img = cropState.source;
  if (!stage || !img) return null;
  const frameW = stage.clientWidth || stage.offsetWidth;
  const frameH = stage.clientHeight || stage.offsetHeight;
  if (!frameW || !frameH) return null;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return null;
  const base = Math.max(frameW / iw, frameH / ih);
  const scale = base * cropState.zoom;
  const drawW = iw * scale;
  const drawH = ih * scale;
  const maxOx = Math.max(0, (drawW - frameW) / 2);
  const maxOy = Math.max(0, (drawH - frameH) / 2);
  cropState.ox = Math.max(-maxOx, Math.min(maxOx, cropState.ox));
  cropState.oy = Math.max(-maxOy, Math.min(maxOy, cropState.oy));
  return { frameW, frameH, scale, drawW, drawH, maxOx, maxOy, iw, ih };
}

function applyCropTransform() {
  const el = document.getElementById("crop-image");
  const m = getCropMetrics();
  if (!el || !m) return;
  el.style.width = `${m.drawW}px`;
  el.style.height = `${m.drawH}px`;
  el.style.transform = `translate(calc(-50% + ${cropState.ox}px), calc(-50% + ${cropState.oy}px))`;
  renderCropPreview();
}

function drawCropToCanvas(canvas) {
  const img = cropState.source;
  const m = getCropMetrics();
  if (!canvas || !img || !m) return false;
  const ctx = canvas.getContext("2d");
  const sx = (m.drawW / 2 - m.frameW / 2 - cropState.ox) / m.scale;
  const sy = (m.drawH / 2 - m.frameH / 2 - cropState.oy) / m.scale;
  const sw = m.frameW / m.scale;
  const sh = m.frameH / m.scale;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return true;
}

function renderCropPreview() {
  const canvas = document.getElementById("crop-preview-canvas");
  drawCropToCanvas(canvas);
}

function exportCroppedImage() {
  const outW = 960;
  const outH = Math.round(outW / CROP_ASPECT);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  if (!drawCropToCanvas(canvas)) {
    throw new Error("Не удалось подготовить кадр. Подождите загрузки фото.");
  }
  try {
    return canvas.toDataURL("image/jpeg", 0.86);
  } catch {
    const preview = document.getElementById("crop-preview-canvas");
    if (preview) {
      try {
        return preview.toDataURL("image/jpeg", 0.86);
      } catch {
        /* fall through */
      }
    }
    throw new Error("Нельзя сохранить кадр для этого фото. Загрузите файл с компьютера.");
  }
}

function syncCropPreviewMeta() {
  const title =
    document.getElementById("f-title")?.value.trim() || "Название товара";
  const amount = document.getElementById("f-price")?.value.trim() || "0";
  const currency = document.getElementById("f-currency")?.value || "kzt";
  const titleEl = document.getElementById("crop-preview-title");
  const priceEl = document.getElementById("crop-preview-price");
  if (titleEl) titleEl.textContent = title;
  if (priceEl) priceEl.textContent = formatPrice(amount.replace(/[^\d]/g, "") || "0", currency) || "0 ₸";
}

function openCropEditor(src) {
  return loadImageFromSrc(src).then(({ img, dataUrl }) => {
    cropState.source = img;
    cropState.dataUrl = dataUrl;
    cropState.zoom = 1;
    cropState.ox = 0;
    cropState.oy = 0;
    const el = document.getElementById("crop-image");
    const zoom = document.getElementById("crop-zoom");
    const modal = document.getElementById("crop-modal");
    el.src = dataUrl;
    if (zoom) zoom.value = "100";
    syncCropPreviewMeta();
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => {
      applyCropTransform();
      requestAnimationFrame(applyCropTransform);
    });
  });
}

function closeCropEditor() {
  const modal = document.getElementById("crop-modal");
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = "";
  cropState.source = null;
}

async function handleMediaFile(file) {
  if (!file) return;

  if (file.size > MAX_FILE_BYTES) {
    alert("Файл слишком большой. Максимум 3 МБ.");
    return;
  }

  const isImage = /^image\/(jpeg|png|webp|gif)$/.test(file.type);
  const isVideo = file.type === "video/mp4" || /\.mp4$/i.test(file.name);

  if (!isImage && !isVideo) {
    alert("Нужно фото (JPG, PNG, WEBP, GIF) или видео MP4.");
    return;
  }

  try {
    // GIF не обрезаем сразу: редактор сохраняет JPEG, и анимация пропала бы.
    if (isImage && file.type !== "image/gif") {
      const dataUrl = await readFileAsDataURL(file);
      await openCropEditor(dataUrl);
    } else {
      const dataUrl = await readFileAsDataURL(file);
      showMediaPreview(dataUrl);
    }
  } catch (err) {
    alert(err.message || "Ошибка загрузки файла");
  }
}

function resetForm() {
  document.getElementById("edit-id").value = "";
  document.getElementById("product-form").reset();
  document.getElementById("f-currency").value = "kzt";
  document.getElementById("f-kind").value = "product";
  clearMediaPreview();
  document.getElementById("save-btn").textContent = "Добавить";
  const title = document.getElementById("product-modal-title");
  if (title) title.textContent = "Добавить товар";
}

let productModalOpener = null;

function openProductModal(mode) {
  const modal = document.getElementById("product-modal");
  if (!modal) return;
  if (modal.hidden) productModalOpener = document.activeElement;
  const title = document.getElementById("product-modal-title");
  if (title) title.textContent = mode === "edit" ? "Редактировать товар" : "Добавить товар";
  document.getElementById("save-btn").textContent = mode === "edit" ? "Сохранить" : "Добавить";
  modal.hidden = false;
  document.body.classList.add("product-modal-open");
  requestAnimationFrame(() => {
    document.getElementById("f-title")?.focus();
  });
}

function closeProductModal() {
  const modal = document.getElementById("product-modal");
  if (!modal) return;
  const wasOpen = !modal.hidden;
  modal.hidden = true;
  document.body.classList.remove("product-modal-open");
  resetForm();
  const opener = productModalOpener;
  productModalOpener = null;
  // Кнопка «Изменить» могла исчезнуть при перерисовке списка — тогда фокус просто остаётся на странице.
  if (wasOpen && opener?.isConnected && opener.getClientRects().length) opener.focus();
}

document.addEventListener("DOMContentLoaded", () => {
  if (isAuthed()) showPanel();

  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("f-file");

  dropzone?.addEventListener("click", (e) => {
    if (e.target.closest("#dropzone-clear, video")) return;
    fileInput.click();
  });

  dropzone?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    handleMediaFile(file);
  });

  dropzone?.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dropzone.classList.add("is-drag");
  });
  dropzone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("is-drag");
  });
  dropzone?.addEventListener("dragleave", (e) => {
    if (!dropzone.contains(e.relatedTarget)) {
      dropzone.classList.remove("is-drag");
    }
  });
  dropzone?.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-drag");
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    handleMediaFile(file);
  });

  document.getElementById("dropzone-clear")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearMediaPreview();
  });

  document.getElementById("dropzone-edit")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const src = document.getElementById("f-image").value;
    if (!src || isVideoUrl(src) || src.startsWith("data:video")) return;
    openCropEditor(src).catch((err) => alert(err.message || "Ошибка"));
  });

  const stage = document.getElementById("crop-stage");
  const zoomInput = document.getElementById("crop-zoom");

  zoomInput?.addEventListener("input", () => {
    cropState.zoom = Math.max(1, Number(zoomInput.value) / 100);
    applyCropTransform();
  });

  stage?.addEventListener("pointerdown", (e) => {
    if (!cropState.source) return;
    cropState.dragging = true;
    cropState.lastX = e.clientX;
    cropState.lastY = e.clientY;
    stage.classList.add("is-dragging");
    stage.setPointerCapture(e.pointerId);
  });

  stage?.addEventListener("pointermove", (e) => {
    if (!cropState.dragging) return;
    cropState.ox += e.clientX - cropState.lastX;
    cropState.oy += e.clientY - cropState.lastY;
    cropState.lastX = e.clientX;
    cropState.lastY = e.clientY;
    applyCropTransform();
  });

  const endDrag = (e) => {
    if (!cropState.dragging) return;
    cropState.dragging = false;
    stage.classList.remove("is-dragging");
    try {
      stage.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  stage?.addEventListener("pointerup", endDrag);
  stage?.addEventListener("pointercancel", endDrag);

  document.querySelector(".crop-presets")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-crop-preset]");
    if (!btn || !cropState.source) return;
    const preset = btn.dataset.cropPreset;
    const m = getCropMetrics();
    if (!m) return;
    if (preset === "reset") {
      cropState.zoom = 1;
      cropState.ox = 0;
      cropState.oy = 0;
      if (zoomInput) zoomInput.value = "100";
    } else if (preset === "center") {
      cropState.ox = 0;
      cropState.oy = 0;
    } else if (preset === "top") {
      cropState.ox = 0;
      cropState.oy = m.maxOy;
    }
    applyCropTransform();
  });

  document.getElementById("crop-apply")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const dataUrl = exportCroppedImage();
      if (!dataUrl) {
        alert("Не удалось применить кадр.");
        return;
      }
      showMediaPreview(dataUrl);
      closeCropEditor();
    } catch (err) {
      alert(err.message || "Не удалось применить кадр.");
    }
  });

  document.getElementById("crop-cancel")?.addEventListener("click", closeCropEditor);
  document.getElementById("crop-cancel-x")?.addEventListener("click", closeCropEditor);

  ["f-title", "f-price", "f-currency"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", () => {
      if (!document.getElementById("crop-modal")?.hidden) syncCropPreviewMeta();
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!document.getElementById("crop-modal")?.hidden) {
      closeCropEditor();
      return;
    }
    if (!document.getElementById("product-modal")?.hidden) {
      closeProductModal();
    }
  });

  document.getElementById("add-product-btn")?.addEventListener("click", () => {
    resetForm();
    openProductModal("add");
  });

  document.getElementById("product-modal-close")?.addEventListener("click", closeProductModal);
  document.getElementById("product-modal-backdrop")?.addEventListener("click", closeProductModal);

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pass = document.getElementById("admin-pass").value;
    const err = document.getElementById("login-error");
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      const result = await adminLogin(pass);
      if (result.ok) {
        setAuthed(true, result.token);
        document.getElementById("admin-pass").value = "";
        err.hidden = true;
        showPanel();
      } else {
        err.textContent = result.error;
        err.hidden = false;
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  window.addEventListener("products:updated", () => {
    if (document.getElementById("admin-panel").hidden) return;
    renderAdminList();
  });

  window.addEventListener("products:auth-required", () => {
    if (document.getElementById("admin-panel").hidden) return;
    setAuthed(false);
    closeProductModal();
    document.title = ADMIN_TITLE;
    document.getElementById("admin-panel").hidden = true;
    document.getElementById("login-box").hidden = false;
    alert("Сессия истекла (например, сервер перезапускался). Войдите в админку ещё раз.");
  });

  document.getElementById("admin-logout")?.addEventListener("click", () => {
    fetch(`${apiOrigin()}/api/admin/logout`, {
      method: "POST",
      headers: { "X-Admin-Token": adminToken() },
    }).catch(() => {});
    setAuthed(false);
    closeProductModal();
    document.title = ADMIN_TITLE;
    document.getElementById("admin-panel").hidden = true;
    document.getElementById("login-box").hidden = false;
  });

  document.getElementById("product-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const editId = document.getElementById("edit-id").value;
    const title = document.getElementById("f-title").value.replace(/\s+/g, " ").trim();
    const description = document.getElementById("f-desc").value.trim();
    const amountRaw = document.getElementById("f-price").value.trim();
    const currency = document.getElementById("f-currency").value;
    const image = document.getElementById("f-image").value.trim();

    if (!title) {
      alert("Укажите название");
      return;
    }
    if (!description) {
      alert("Добавьте описание");
      return;
    }
    if (!/^\d[\d\s]*$/.test(amountRaw)) {
      alert("Цена — целое число без копеек, например 15000");
      return;
    }
    const amount = amountRaw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    if (amount.length > MAX_PRICE_DIGITS) {
      alert("Слишком большая цена");
      return;
    }
    if (!image) {
      alert("Добавьте фото или видео");
      return;
    }

    const item = {
      id: editId || uid(),
      title,
      description,
      amount,
      currency,
      kind: document.getElementById("f-kind").value === "service" ? "service" : "product",
      price: formatPrice(amount, currency),
      image,
    };

    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    const ok = await updateCatalog((products) => {
      if (!editId) return [item, ...products];
      const idx = products.findIndex((p) => p.id === editId);
      if (idx < 0) {
        alert("Этот товар уже удалён — возможно, в другой вкладке.");
        return null;
      }
      products[idx] = item;
      return products;
    });
    if (submitBtn) submitBtn.disabled = false;
    if (ok) closeProductModal();
  });

  document.getElementById("cancel-edit").addEventListener("click", closeProductModal);

  document.getElementById("admin-list").addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-edit]");
    const delBtn = e.target.closest("[data-del]");
    const products = loadProducts();

    if (editBtn) {
      const p = products.find((x) => x.id === editBtn.dataset.edit);
      if (!p) return;
      const fields = parsePriceFields(p);
      resetForm();
      document.getElementById("edit-id").value = p.id;
      document.getElementById("f-title").value = p.title;
      document.getElementById("f-desc").value = p.description;
      document.getElementById("f-kind").value = productKind(p);
      document.getElementById("f-price").value = fields.amount;
      document.getElementById("f-currency").value = fields.currency;
      showMediaPreview(p.image || "");
      openProductModal("edit");
    }

    if (delBtn) {
      if (!confirm("Удалить товар?")) return;
      const id = delBtn.dataset.del;
      delBtn.disabled = true;
      updateCatalog((list) => list.filter((p) => p.id !== id)).finally(() => {
        delBtn.disabled = false;
      });
    }
  });

  document.getElementById("reset-btn").addEventListener("click", async () => {
    if (!confirm("Вернуть 6 демо-товаров? Текущий каталог будет заменён.")) return;
    closeProductModal();
    await updateCatalog(() => structuredClone(DEFAULT_PRODUCTS));
  });

  document.querySelector(".admin-tabs")?.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-admin-tab]");
    if (!tab) return;
    showAdminTab(tab.dataset.adminTab);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pollOrders();
  });
  document.getElementById("orders-filter")?.addEventListener("change", renderOrders);
  document.getElementById("orders-search")?.addEventListener("input", renderOrders);
  // Если данные не изменились, список выглядит так же — без отклика кажется, что кнопка не сработала.
  const bindRefresh = (id, load) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    const label = btn.textContent;
    let resetTimer = 0;
    btn.addEventListener("click", async () => {
      if (btn.disabled) return;
      clearTimeout(resetTimer);
      btn.disabled = true;
      btn.textContent = "Обновляем…";
      let ok = false;
      try {
        ok = await load();
      } finally {
        btn.disabled = false;
        btn.textContent = ok ? "Обновлено" : "Не удалось";
        resetTimer = setTimeout(() => {
          btn.textContent = label;
        }, 1200);
      }
    });
  };
  bindRefresh("orders-refresh", () => fetchOrders());
  bindRefresh("clients-refresh", () => fetchClients());
  const clientsList = document.getElementById("clients-list");
  clientsList?.addEventListener("input", (e) => {
    const field = e.target.closest("[data-client-comment]");
    if (field) queueCommentSave(field.dataset.clientComment, field.value.trim());
  });
  clientsList?.addEventListener("focusout", (e) => {
    const field = e.target.closest("[data-client-comment]");
    if (field && commentSaves.has(field.dataset.clientComment)) flushCommentSave(field.dataset.clientComment);
  });
  // Закрыли вкладку, не дождавшись автосохранения, — досылаем текст запросом, который переживёт закрытие.
  window.addEventListener("pagehide", () => {
    commentSaves.forEach((entry, id) => {
      clearTimeout(entry.timer);
      fetch(`${apiOrigin()}/api/clients/${encodeURIComponent(id)}`, {
        method: "PATCH",
        keepalive: true,
        headers: { "Content-Type": "application/json", "X-Admin-Token": adminToken() },
        body: JSON.stringify({ comment: entry.value }),
      }).catch(() => {});
    });
  });

  document.getElementById("orders-list")?.addEventListener("change", async (e) => {
    const select = e.target.closest("[data-order-status]");
    if (!select) return;
    const id = select.dataset.orderStatus;
    const status = select.value;
    select.disabled = true;
    try {
      const updated = await patchOrder(id, status);
      const row = ordersCache.find((order) => order.id === id);
      if (row && updated) Object.assign(row, updated);
      renderOrders();
    } catch (err) {
      alert(err.message || "Не удалось обновить статус");
      renderOrders();
    }
  });

  document.getElementById("orders-list")?.addEventListener("click", async (e) => {
    const del = e.target.closest("[data-order-del]");
    if (!del) return;
    if (!confirm("Удалить заказ?")) return;
    del.disabled = true;
    try {
      await deleteOrder(del.dataset.orderDel);
      ordersCache = ordersCache.filter((order) => order.id !== del.dataset.orderDel);
      renderOrders();
    } catch (err) {
      alert(err.message || "Не удалось удалить заказ");
      del.disabled = false;
    }
  });
});

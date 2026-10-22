import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ProductEditor from "../admin/ProductEditor";
import StockPanel from "../admin/StockPanel";
import {
  ORDER_STATUSES,
  formatOrderDate,
  orderChannelLabel,
  orderMatchesQuery,
  orderStatusLabel,
  ordersWord,
  replyLinks,
  revenueOf,
} from "../admin/helpers";
import { downloadCatalogPdf } from "../lib/downloadPdf";
import { useShop } from "../context/ShopContext";
import { displayPrice } from "../lib/money";
import { isVideoUrl, safeMediaUrl } from "../lib/media";
import { replyPhone } from "../lib/phone";
import {
  DEFAULT_PRODUCTS,
  loadProducts,
  notifyAuthRequired,
  orderNumber,
  productsStatus,
  saveProducts,
  subscribeAuthRequired,
  subscribeProducts,
  syncProductsWithServer,
  uid,
} from "../lib/products";

const ADMIN_TITLE = "Админка — Динара";

function OrdersBadge({ api, authed }) {
  const [count, setCount] = useState(0);
  api.current = setCount;
  useEffect(() => {
    document.title = authed && count ? `(${count}) ${ADMIN_TITLE}` : ADMIN_TITLE;
  }, [authed, count]);
  return <span className="admin-tab__badge" hidden={!count}>{count}</span>;
}

function WaIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12.04 2C6.58 2 2.15 6.4 2.15 11.83c0 1.74.46 3.44 1.34 4.94L2 22l5.39-1.41a10.1 10.1 0 0 0 4.65 1.18h.01c5.46 0 9.89-4.4 9.89-9.83C21.94 6.4 17.5 2 12.04 2zm5.76 13.9c-.24.68-1.4 1.3-1.94 1.38-.5.08-1.12.11-1.81-.11-.41-.14-.95-.31-1.63-.61-2.87-1.24-4.74-4.13-4.88-4.32-.14-.19-1.16-1.54-1.16-2.94s.73-2.08 1-2.37c.24-.27.64-.39 1.02-.39h.73c.23 0 .54-.09.85.64.32.77 1.08 2.64 1.18 2.83.09.19.16.42.03.67-.12.26-.18.42-.36.64-.18.22-.38.5-.54.67-.18.18-.36.38-.16.73.21.35.93 1.53 2 2.48 1.37 1.22 2.53 1.6 2.89 1.78.36.18.57.15.78-.09.21-.24.9-1.05 1.14-1.41.24-.36.48-.3.81-.18.33.12 2.1 1 2.46 1.18.36.18.6.27.69.42.09.15.09.86-.15 1.54z" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg className="order-row__invoice-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M6 2h8l6 6v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V9h5.5L13 3.5zM8 13h8v1.5H8V13zm0 3.5h8V18H8v-1.5z" />
    </svg>
  );
}

function TgIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M21.5 4.5 2.8 11.2c-1.2.46-1.19 1.1-.22 1.39l4.8 1.5 11.1-7c.52-.32 1 .16.6.5l-9 8.14-.34 4.9c.5 0 .72-.23 1-.5l2.4-2.33 5 3.68c.92.5 1.58.24 1.81-.85l3.28-15.46c.34-1.35-.52-1.96-1.43-1.57z" />
    </svg>
  );
}

async function adminFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const res = await fetch(path, { ...options, headers, cache: "no-store" });
  if (res.status === 401) {
    notifyAuthRequired();
    throw new Error("Нужно войти в админку ещё раз");
  }
  return res;
}

export default function AdminPage() {
  const { site } = useShop();
  const demoReset = site.demoReset === true;
  const [authed, setAuthed] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [tab, setTab] = useState("products");
  const [tick, setTick] = useState(0);
  const [editor, setEditor] = useState(null);
  const [orders, setOrders] = useState([]);
  const [ordersError, setOrdersError] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [openHistory, setOpenHistory] = useState(() => new Set());
  const [clients, setClients] = useState([]);
  const [clientsError, setClientsError] = useState("");
  const [stock, setStock] = useState([]);
  const [stockError, setStockError] = useState("");
  const [commentState, setCommentState] = useState({});
  const [refreshLabel, setRefreshLabel] = useState({ orders: "Обновить", clients: "Обновить" });
  const [invoiceId, setInvoiceId] = useState("");
  const [pdfError, setPdfError] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const badgeApi = useRef(() => {});
  const commentSaves = useRef(new Map());
  const ordersRef = useRef([]);
  const ordersPending = useRef(null);
  const listRef = useRef(null);
  ordersRef.current = orders;

  function publishBadge(list) {
    badgeApi.current((Array.isArray(list) ? list : []).filter((item) => item.status === "new").length);
  }

  useEffect(() => {
    document.body.classList.add("admin-page");
    document.title = ADMIN_TITLE;
    return () => {
      document.body.classList.remove("admin-page");
      document.title = "Динара — AI Video Creator";
    };
  }, []);

  useEffect(() => subscribeProducts(() => setTick((value) => value + 1)), []);
  useEffect(() => {
    let ignore = false;
    fetch("/api/admin/session")
      .then((res) => { if (!ignore) setAuthed(res.ok); })
      .catch(() => { if (!ignore) setAuthed(false); })
      .finally(() => { if (!ignore) setSessionReady(true); });
    return () => { ignore = true; };
  }, []);
  useEffect(() => subscribeAuthRequired(() => {
    setAuthed(false);
    setEditor(null);
    document.title = ADMIN_TITLE;
    window.alert("Сессия истекла (например, сервер перезапускался). Войдите в админку ещё раз.");
  }), []);

  async function updateCatalog(change) {
    await syncProductsWithServer();
    if (productsStatus().failed) {
      window.alert("Нет связи с сервером. Запустите start.cmd и откройте сайт по адресу http://localhost:3000");
      return false;
    }
    const next = change(loadProducts());
    if (!next) return false;
    const result = await saveProducts(next);
    if (!result.ok && result.status !== 401) {
      window.alert(result.error
        ? result.error
        : "Не удалось сохранить каталог на сервере. Запустите start.cmd и откройте сайт по адресу http://localhost:3000");
    }
    return result.ok;
  }

  async function fetchOrders({ quiet = false } = {}) {
    try {
      const res = await adminFetch("/api/orders");
      if (!res.ok) throw new Error("Не удалось загрузить заказы");
      const data = await res.json();
      const next = Array.isArray(data.orders) ? data.orders : [];
      const changed = JSON.stringify(next) !== JSON.stringify(ordersRef.current);
      publishBadge(next);
      if (changed) fetchClients();
      if (!quiet || changed) {
        if (quiet && listRef.current?.contains(document.activeElement)) {
          ordersPending.current = next;
          return true;
        }
        ordersPending.current = null;
        setOrders(next);
      }
      setOrdersError("");
      return true;
    } catch (err) {
      if (!quiet) setOrdersError(err.message || "Не удалось загрузить заказы. Запустите сервер через start.cmd.");
      return false;
    }
  }

  async function fetchStock(options = {}) {
    try {
      const res = await adminFetch("/api/stock");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Не удалось загрузить остатки");
      setStock(Array.isArray(data.items) ? data.items : []);
      setStockError("");
    } catch (err) {
      if (!options.quiet) setStockError(err.message || "Не удалось загрузить остатки");
    }
  }

  function patchCommentStatus(id, patch) {
    setCommentState((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  }

  async function saveComment(id, entry) {
    if (commentSaves.current.get(id) !== entry) return;
    const value = entry.value;
    patchCommentStatus(id, { text: "Сохраняем…", error: false });
    try {
      const res = await adminFetch(`/api/clients/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Не удалось сохранить комментарий");
      setClients((current) => current.map((client) => (client.id === id ? { ...client, comment: data.client?.comment || "" } : client)));
      if (commentSaves.current.get(id) === entry && entry.value === value) {
        commentSaves.current.delete(id);
        setCommentState((current) => ({ ...current, [id]: { text: "Сохранено", error: false } }));
      }
    } catch (err) {
      if (commentSaves.current.get(id) !== entry) return;
      patchCommentStatus(id, { text: `Не сохранено: ${err.message || "ошибка"}. Попробуйте ещё раз.`, error: true });
    }
  }

  function flushComment(id) {
    const entry = commentSaves.current.get(id);
    if (!entry) return Promise.resolve();
    window.clearTimeout(entry.timer);
    entry.timer = 0;
    entry.chain = (entry.chain || Promise.resolve()).then(() => saveComment(id, entry));
    return entry.chain;
  }

  async function fetchClients() {
    await Promise.all([...commentSaves.current.keys()].map((id) => flushComment(id)));
    try {
      const res = await adminFetch("/api/clients");
      if (!res.ok) throw new Error("Не удалось загрузить клиентов");
      const data = await res.json();
      setClients(Array.isArray(data.clients) ? data.clients : []);
      setClientsError("");
      commentSaves.current.forEach((entry, id) => {
        if (entry.timer) return;
        setCommentState((current) => ({ ...current, [id]: { text: "Не сохранено. Попробуйте ещё раз.", error: true, value: entry.value } }));
      });
      return true;
    } catch (err) {
      setClientsError(err.message || "Не удалось загрузить клиентов.");
      return false;
    }
  }

  useEffect(() => {
    if (!authed) return undefined;
    fetchOrders();
    fetchClients();
    fetchStock();
    const timer = window.setInterval(() => {
      fetchOrders({ quiet: true });
      fetchStock({ quiet: true });
    }, 30000);
    const onVisible = () => { if (!document.hidden) fetchOrders({ quiet: true }); };
    window.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("visibilitychange", onVisible);
    };
  }, [authed]);

  useEffect(() => {
    const onHide = () => {
      commentSaves.current.forEach((entry, id) => {
        window.clearTimeout(entry.timer);
        fetch(`/api/clients/${encodeURIComponent(id)}`, {
          method: "PATCH",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comment: entry.value }),
        }).catch(() => {});
      });
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  async function login(event) {
    event.preventDefault();
    setLoginBusy(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setPassword("");
        setLoginError("");
        setAuthed(true);
      } else {
        setLoginError(data.error || "Неверный пароль");
      }
    } catch {
      setLoginError("Сервер не запущен. Запустите start.cmd и откройте http://localhost:3000/admin");
    } finally {
      setLoginBusy(false);
    }
  }

  function logout() {
    fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
    setAuthed(false);
    setEditor(null);
    document.title = ADMIN_TITLE;
  }

  async function refresh(kind) {
    const load = kind === "orders" ? () => fetchOrders() : () => fetchClients();
    setRefreshLabel((current) => ({ ...current, [kind]: "Обновляем…" }));
    const ok = await load();
    setRefreshLabel((current) => ({ ...current, [kind]: ok ? "Обновлено" : "Не удалось" }));
    window.setTimeout(() => setRefreshLabel((current) => ({ ...current, [kind]: "Обновить" })), 1200);
  }

  const products = loadProducts();
  const status = productsStatus();
  const stockById = new Map(stock.map((item) => [item.id, item]));
  const counts = { new: 0, progress: 0, done: 0, cancelled: 0 };
  orders.forEach((order) => { if (counts[order.status] != null) counts[order.status] += 1; });
  const revenue = revenueOf(orders);
  const visibleOrders = orders.filter((order) => (filter === "all" || order.status === filter) && orderMatchesQuery(order, query.trim().toLocaleLowerCase("ru")));
  void tick;

  return (
    <>
      <header className="admin-top">
        <Link className="admin-back" to="/">← На сайт</Link>
        <div className="admin-top__right">
          <button type="button" className="admin-back" hidden={!authed} onClick={logout}>Выйти</button>
          <span className="admin-top__title">Админка</span>
        </div>
      </header>
      <main className="admin-main">
        {!sessionReady ? (
          <p className="admin-login__lead">Проверяем вход…</p>
        ) : !authed ? (
          <section className="admin-login">
            <h1 className="admin-login__title">Вход</h1>
            <p className="admin-login__lead">Услуги на сайте и заказы клиентов.</p>
            <form className="admin-form admin-form--login" onSubmit={login}>
              <div className="admin-field">
                <label htmlFor="admin-pass">Пароль</label>
                <div className="pass-field">
                  <input id="admin-pass" type={showPassword ? "text" : "password"} required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
                  <button
                    type="button"
                    className={`pass-toggle${showPassword ? " is-open" : ""}`}
                    aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                    title={showPassword ? "Скрыть пароль" : "Показать пароль"}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? "🙈" : "👁"}
                  </button>
                </div>
              </div>
              <button type="submit" className="btn btn--primary admin-login__btn" disabled={loginBusy}>Войти</button>
              <p className="admin-error" hidden={!loginError}>{loginError}</p>
            </form>
          </section>
        ) : (
          <section className="admin-panel wrap">
            <nav className="admin-tabs" aria-label="Разделы админки">
              {[
                ["products", "Услуги"],
                ["stock", "Остатки"],
                ["orders", "Заказы"],
                ["clients", "Клиенты"],
              ].map(([id, label]) => (
                <button key={id} type="button" className={`admin-tab${tab === id ? " is-active" : ""}`} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
                  {label}
                  {id === "orders" ? <OrdersBadge api={badgeApi} authed={authed} /> : null}
                </button>
              ))}
            </nav>

            {tab === "products" ? (
              <div className="admin-card">
                <div className="admin-card__head">
                  <h2>Услуги на сайте</h2>
                  <div className="admin-card__actions">
                    <button
                      type="button"
                      className="btn btn--ghost-dark"
                      disabled={pdfBusy}
                      onClick={async () => {
                        if (pdfBusy) return;
                        setPdfError("");
                        setPdfBusy(true);
                        try {
                          await downloadCatalogPdf();
                        } catch (err) {
                          setPdfError(err?.message || "Не удалось скачать PDF.");
                        } finally {
                          setPdfBusy(false);
                        }
                      }}
                    >{pdfBusy ? "Собираем PDF…" : "Скачать PDF"}</button>
                    <button type="button" className="btn btn--primary" onClick={() => setEditor({})}>Добавить товар</button>
                    {demoReset ? (
                      <button type="button" className="btn btn--ghost-dark" onClick={async () => {
                        if (!window.confirm("Вернуть 6 демо-товаров? Текущий каталог будет заменён.")) return;
                        setEditor(null);
                        await updateCatalog(() => structuredClone(DEFAULT_PRODUCTS));
                      }}>Сбросить к 6 демо</button>
                    ) : null}
                  </div>
                  {pdfError ? <p className="catalog-pdf-error" role="alert">{pdfError}</p> : null}
                </div>
                <div className="admin-list">
                  {!products.length ? (
                    <p>{!status.loaded ? "Загружаем каталог…" : status.failed ? "Нет связи с сервером. Запустите start.cmd." : "Список пуст."}</p>
                  ) : products.map((product) => {
                    const thumb = safeMediaUrl(product.image);
                    const video = isVideoUrl(thumb) || thumb.startsWith("data:video");
                    return (
                      <article className="admin-item" key={product.id}>
                        {thumb && !video ? <img src={thumb} alt="" width="72" height="72" /> : <div className="admin-item__video">Видео</div>}
                        <div>
                          <strong>{product.title}</strong>
                          <span>Цена {displayPrice(product)}</span>
                          {stockById.has(product.id) ? (
                            <span className={stockById.get(product.id).balance < 0 ? "admin-item__stock is-low" : "admin-item__stock"}>
                              Остаток {stockById.get(product.id).balance}
                            </span>
                          ) : null}
                          <p>{product.description}</p>
                        </div>
                        <div className="admin-item__actions">
                          <button type="button" onClick={() => setEditor(product)}>Изменить</button>
                          <button type="button" onClick={async (event) => {
                            if (!window.confirm("Удалить товар?")) return;
                            const button = event.currentTarget;
                            button.disabled = true;
                            try {
                              await updateCatalog((list) => list.filter((item) => item.id !== product.id));
                            } finally {
                              button.disabled = false;
                            }
                          }}>Удалить</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {tab === "stock" ? (
              <StockPanel
                items={stock}
                error={stockError}
                onItems={setStock}
                onOpenOrder={(order) => {
                  setTab("orders");
                  setFilter("all");
                  setQuery(orderNumber({ id: order.orderId, number: order.number }));
                }}
              />
            ) : null}

            {tab === "orders" ? (
              <div className="admin-card">
                <div className="admin-card__head">
                  <h2>Заказы</h2>
                  <div className="admin-card__actions">
                    <label className="orders-search">
                      <span className="visually-hidden">Поиск заказа</span>
                      <input type="search" placeholder="Имя, телефон или №" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
                    </label>
                    <label className="orders-filter">
                      <span className="visually-hidden">Статус</span>
                      <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                        <option value="all">Все статусы</option>
                        <option value="new">Новые</option>
                        <option value="progress">В работе</option>
                        <option value="done">Готово</option>
                        <option value="cancelled">Отменённые</option>
                      </select>
                    </label>
                    <button type="button" className="btn btn--ghost-dark" onClick={() => refresh("orders")}>{refreshLabel.orders}</button>
                  </div>
                </div>
                <div className="orders-stats">
                  {orders.length ? (
                    <>
                      {[["new", "Новые", counts.new], ["progress", "В работе", counts.progress], ["done", "Готово", counts.done], ["cancelled", "Отменённые", counts.cancelled]].map(([key, label, count]) => (
                        <span className={`orders-stat orders-stat--${key}`} key={key}><b>{count}</b> {label}</span>
                      ))}
                      <span className="orders-stat orders-stat--sum">Выручка <b>{revenue.all}</b> · в этом месяце <b>{revenue.month}</b></span>
                    </>
                  ) : null}
                </div>
                <div
                  className="orders-list"
                  ref={listRef}
                  onBlur={() => {
                    window.setTimeout(() => {
                      if (!ordersPending.current || listRef.current?.contains(document.activeElement)) return;
                      setOrders(ordersPending.current);
                      ordersPending.current = null;
                    }, 0);
                  }}
                >
                  {ordersError ? <p className="orders-empty">{ordersError}</p> : !orders.length ? (
                    <p className="orders-empty">Пока нет заказов. Они появятся здесь, когда клиент оформит заказ на сайте.</p>
                  ) : !visibleOrders.length ? (
                    <p className="orders-empty">{query.trim() ? "Ничего не найдено." : "Нет заказов с таким статусом."}</p>
                  ) : visibleOrders.map((order) => {
                    const links = replyLinks(order);
                    const status = order.status || "new";
                    const history = Array.isArray(order.statusHistory) ? [...order.statusHistory].reverse() : [];
                    const changed = order.updatedAt && order.updatedAt !== order.createdAt;
                    return (
                      <article className="order-row" data-status={status} key={order.id}>
                        <div className="order-row__body">
                          <div className="order-row__top">
                            <div>
                              <strong>{order.name}</strong>
                              <a className="order-row__phone" href={`tel:+${replyPhone(order.phone)}`}>{order.phone}</a>
                            </div>
                            <div className="order-row__meta">
                              <span className="order-row__no">№{orderNumber(order)}</span>
                              <span className={`order-row__status order-row__status--${status}`}>{orderStatusLabel(status)}</span>
                              <span className={`order-row__channel order-row__channel--${order.channel}`}>{orderChannelLabel(order.channel)}</span>
                              <time dateTime={order.createdAt}>{formatOrderDate(order.createdAt)}</time>
                            </div>
                          </div>
                          <ul className="order-row__items">
                            {(order.items || []).map((item, index) => (
                              <li key={`${item.title}-${index}`}>
                                <span className="order-row__item-title">{item.title || ""}</span>
                                <span className="order-row__item-meta">{item.qty} шт.{item.lineTotal || item.unitPrice ? ` · цена ${item.lineTotal || item.unitPrice}` : ""}</span>
                              </li>
                            ))}
                          </ul>
                          <p className="order-row__total">Итого: <strong>{order.total || "—"}</strong></p>
                          {history.length ? (
                            <details
                              className="order-row__history"
                              open={openHistory.has(order.id)}
                              onToggle={(event) => {
                                setOpenHistory((current) => {
                                  const next = new Set(current);
                                  if (event.currentTarget.open) next.add(order.id);
                                  else next.delete(order.id);
                                  return next;
                                });
                              }}
                            >
                              <summary>{changed ? `Статус изменён ${formatOrderDate(order.updatedAt)}` : "История статусов"}</summary>
                              <ol>
                                {history.map((entry, index) => (
                                  <li key={`${entry.at}-${index}`}><time dateTime={entry.at}>{formatOrderDate(entry.at)}</time> — {orderStatusLabel(entry.status)}</li>
                                ))}
                              </ol>
                            </details>
                          ) : null}
                          <div className="order-row__actions">
                            <button
                              type="button"
                              className="order-row__invoice"
                              disabled={invoiceId === order.id}
                              onClick={async () => {
                                if (invoiceId) return;
                                setInvoiceId(order.id);
                                try {
                                  const res = await adminFetch(`/api/orders/${encodeURIComponent(order.id)}/invoice.pdf`);
                                  if (!res.ok) {
                                    const data = await res.json().catch(() => ({}));
                                    throw new Error(data.error || "Не удалось сформировать счет");
                                  }
                                  const blob = await res.blob();
                                  const url = URL.createObjectURL(blob);
                                  const link = document.createElement("a");
                                  link.href = url;
                                  link.download = `invoice-${orderNumber(order)}.pdf`;
                                  link.click();
                                  setTimeout(() => URL.revokeObjectURL(url), 1500);
                                } catch (err) {
                                  window.alert(err.message || "Не удалось сформировать счет");
                                } finally {
                                  setInvoiceId("");
                                }
                              }}
                            >
                              <DocIcon />
                              {invoiceId === order.id ? "Формирование PDF..." : "Скачать счет-фактуру"}
                            </button>
                            <label className="order-row__status-field">
                              <select
                                aria-label="Статус заказа"
                                value={status}
                                onChange={async (event) => {
                                  const select = event.target;
                                  const nextStatus = select.value;
                                  select.disabled = true;
                                  try {
                                    const res = await adminFetch(`/api/orders/${encodeURIComponent(order.id)}`, {
                                      method: "PATCH",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ status: nextStatus }),
                                    });
                                    const data = await res.json().catch(() => ({}));
                                    if (!res.ok) throw new Error(data.error || "Не удалось обновить статус");
                                    const apply = (list) => list.map((item) => (item.id === order.id && data.order ? { ...item, ...data.order } : item));
                                    const applied = apply(ordersPending.current || ordersRef.current);
                                    setOrders(apply);
                                    if (ordersPending.current) ordersPending.current = apply(ordersPending.current);
                                    publishBadge(applied);
                                    fetchStock({ quiet: true });
                                    fetchClients();
                                  } catch (err) {
                                    window.alert(err.message || "Не удалось обновить статус");
                                    fetchOrders();
                                  } finally {
                                    select.disabled = false;
                                  }
                                }}
                              >
                                {ORDER_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                              </select>
                            </label>
                            <button type="button" onClick={async (event) => {
                              if (!window.confirm("Удалить заказ?")) return;
                              event.currentTarget.disabled = true;
                              try {
                                const res = await adminFetch(`/api/orders/${encodeURIComponent(order.id)}`, { method: "DELETE" });
                                const data = await res.json().catch(() => ({}));
                                if (!res.ok) throw new Error(data.error || "Не удалось удалить заказ");
                                const remove = (list) => list.filter((item) => item.id !== order.id);
                                const applied = remove(ordersPending.current || ordersRef.current);
                                setOrders(remove);
                                if (ordersPending.current) ordersPending.current = remove(ordersPending.current);
                                publishBadge(applied);
                                fetchStock({ quiet: true });
                                fetchClients();
                              } catch (err) {
                                window.alert(err.message || "Не удалось удалить заказ");
                                event.currentTarget.disabled = false;
                              }
                            }}>Удалить</button>
                            {links.wa ? (
                              <div className="order-row__reply">
                                <a className="order-row__wa" href={links.wa} target="_blank" rel="noopener noreferrer" aria-label="Ответить в WhatsApp" title="WhatsApp"><WaIcon /></a>
                                <a className="order-row__tg" href={links.tg} target="_blank" rel="noopener noreferrer" aria-label="Ответить в Telegram" title="Telegram"><TgIcon /></a>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {tab === "clients" ? (
              <div className="admin-card">
                <div className="admin-card__head">
                  <h2>Клиенты</h2>
                  <button type="button" className="btn btn--ghost-dark" onClick={() => refresh("clients")}>{refreshLabel.clients}</button>
                </div>
                <p className="clients-lead">Один номер телефона — один клиент. Новый заказ с тем же номером обновляет карточку, а не создаёт дубль.</p>
                <div className="clients-list">
                  {clientsError ? <p className="orders-empty">{clientsError}</p> : !clients.length ? (
                    <p className="orders-empty">Пока нет клиентов. Они появятся здесь после первого заказа.</p>
                  ) : clients.map((client) => {
                    const links = replyLinks(client);
                    const count = Number(client.orderCount) || 0;
                    const cancelled = Number(client.cancelledCount) || 0;
                    const note = commentState[client.id];
                    const commentValue = note?.value != null ? note.value : (client.comment || "");
                    return (
                      <article className="client-card" key={client.id}>
                        <strong>{client.name}</strong>
                        {client.otherNames?.length ? <p className="client-card__names">Также представлялся(ась): {client.otherNames.join(", ")}</p> : null}
                        <a className="order-row__phone" href={`tel:+${replyPhone(client.phone)}`}>{client.phone}</a>
                        <p className="client-card__count">{count} {ordersWord(count)}{cancelled ? ` · отменено: ${cancelled}` : ""}</p>
                        <p className="client-card__date">Последний заказ: {formatOrderDate(client.lastOrderAt)}</p>
                        {links.wa ? (
                          <div className="client-card__reply">
                            <a className="order-row__wa" href={links.wa} target="_blank" rel="noopener noreferrer" aria-label="Написать в WhatsApp" title="WhatsApp"><WaIcon /></a>
                            <a className="order-row__tg" href={links.tg} target="_blank" rel="noopener noreferrer" aria-label="Написать в Telegram" title="Telegram"><TgIcon /></a>
                          </div>
                        ) : null}
                        <label className="client-card__comment">
                          Комментарий
                          <textarea
                            rows={3}
                            maxLength={500}
                            placeholder="Заметка о клиенте"
                            aria-invalid={note?.error || undefined}
                            value={commentValue}
                            onChange={(event) => {
                              const raw = event.target.value;
                              const value = raw.trim();
                              const entry = commentSaves.current.get(client.id) || { value: "", timer: 0, chain: Promise.resolve() };
                              window.clearTimeout(entry.timer);
                              entry.value = value;
                              entry.timer = window.setTimeout(() => flushComment(client.id), 800);
                              commentSaves.current.set(client.id, entry);
                              setCommentState((current) => ({ ...current, [client.id]: { text: "Не сохранено…", error: false, value: raw } }));
                            }}
                            onBlur={() => { if (commentSaves.current.has(client.id)) flushComment(client.id); }}
                          />
                        </label>
                        <span className={`client-card__comment-status${note?.error ? " is-error" : ""}`} aria-live="polite">{note?.text || ""}</span>
                        <button
                          type="button"
                          className="client-card__delete"
                          onClick={async (event) => {
                            const total = count + cancelled;
                            const question = total
                              ? `Удалить клиента «${client.name}» вместе с ${total} ${ordersWord(total)}? Заказы тоже исчезнут.`
                              : `Удалить клиента «${client.name}»?`;
                            if (!window.confirm(question)) return;
                            const button = event.currentTarget;
                            button.disabled = true;
                            const pending = commentSaves.current.get(client.id);
                            if (pending) {
                              window.clearTimeout(pending.timer);
                              commentSaves.current.delete(client.id);
                            }
                            try {
                              const res = await adminFetch(`/api/clients/${encodeURIComponent(client.id)}`, { method: "DELETE" });
                              const data = await res.json().catch(() => ({}));
                              if (!res.ok) throw new Error(data.error || "Не удалось удалить клиента");
                              setClients((current) => current.filter((item) => item.id !== client.id));
                              const removed = new Set(Array.isArray(data.removedOrderIds) ? data.removedOrderIds : []);
                              if (removed.size) {
                                const removeOrders = (list) => list.filter((item) => !removed.has(item.id));
                                const applied = removeOrders(ordersPending.current || ordersRef.current);
                                setOrders(removeOrders);
                                if (ordersPending.current) ordersPending.current = removeOrders(ordersPending.current);
                                publishBadge(applied);
                                fetchStock({ quiet: true });
                              }
                            } catch (err) {
                              window.alert(err.message || "Не удалось удалить клиента");
                              button.disabled = false;
                            }
                          }}
                        >
                          Удалить
                        </button>
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>
        )}
      </main>
      {editor ? (
        <ProductEditor
          draft={editor.id ? editor : null}
          onClose={() => setEditor(null)}
          onSave={(item) => updateCatalog((list) => {
            const next = { ...item, id: item.id || uid() };
            if (!item.id) return [next, ...list];
            const index = list.findIndex((product) => product.id === item.id);
            if (index < 0) {
              window.alert("Этот товар уже удалён — возможно, в другой вкладке.");
              return null;
            }
            const copy = list.slice();
            copy[index] = next;
            return copy;
          })}
        />
      ) : null}
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { clearCart, getCartLines, stockLimitMessage } from "../lib/cart";
import { cartTotalsByCurrency, totalPrice } from "../lib/money";
import { buildOrderText, loadProducts, messengerUrl, orderNumber, orderTextFromRows, syncProductsWithServer } from "../lib/products";
import { formatOrderPhone, orderPhoneValue, phoneDigits, PHONE_MIN_DIGITS } from "../lib/phone";
import { buildPayload, loadClientContact, openMessenger, pendingOrderNotice, pendingRetryDelay, postJsonWithTimeout, queuePendingOrder, saveClientContact } from "../lib/orders";
import { useShop } from "../context/ShopContext";
import { useFocusTrap } from "../hooks/useOverlay";

export default function OrderModal() {
  const { order, closeOrder, closeCart, site, setOrderLines, contactOpen } = useShop();
  const panelRef = useRef(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const busyRef = useRef(false);
  if (done && done.clientOrderId !== (order?.clientOrderId || "")) setDone(null);
  const open = Boolean(order);
  useFocusTrap(open && !contactOpen, panelRef, done ? ".order-done .btn--ghost-dark" : "#order-name");

  useEffect(() => {
    if (!done) return undefined;
    panelRef.current?.querySelector(".order-done .btn--ghost-dark")?.focus();
    return undefined;
  }, [done]);

  useEffect(() => {
    if (!order) return;
    const saved = loadClientContact();
    setName((current) => current || saved.name);
    setPhone((current) => formatOrderPhone(current || saved.phone));
    setError("");
  }, [order?.clientOrderId]);

  if (!order) return null;

  const lines = order.lines || [];
  const total = cartTotalsByCurrency(lines).join(" · ");

  function currentLines() {
    if (order.source === "cart") return getCartLines();
    const products = loadProducts();
    return lines
      .map(({ product, qty }) => {
        const fresh = products.find((item) => item.id === product.id);
        return fresh ? { product: fresh, qty } : null;
      })
      .filter(Boolean);
  }

  function lineKey(rows) {
    return rows
      .map(({ product, qty }) => [product.id, qty, product.title, product.amount ?? "", product.currency ?? "", product.price ?? ""].join("\u0001"))
      .join("\n");
  }

  async function handleStale(message) {
    await syncProductsWithServer();
    if (order.source === "cart") {
      const fresh = getCartLines();
      if (fresh.length) {
        setOrderLines(fresh);
        setError("Каталог обновился — проверьте заказ и отправьте ещё раз.");
        return;
      }
    }
    closeOrder();
    window.alert(message || "Этого товара уже нет в каталоге.");
  }

  async function submit(event) {
    event.preventDefault();
    if (busyRef.current || !lines.length) return;
    const channel = event.nativeEvent.submitter?.dataset.channel === "telegram" ? "telegram" : "whatsapp";
    const cleanName = name.trim().replace(/\s+/g, " ");
    const digits = phoneDigits(phone);
    const phoneValue = orderPhoneValue(digits);
    if (cleanName.length < 2) {
      setError("Укажите имя");
      document.getElementById("order-name")?.focus();
      return;
    }
    if (digits.length < PHONE_MIN_DIGITS) {
      setError("Введите номер с кодом страны, например 7 700 123 45 67");
      document.getElementById("order-phone")?.focus();
      return;
    }

    if (site.configState !== "ready" || !site.waPhone || !site.tgUser) {
      setError("Контакты и чат не загрузились. Подождите, пока сайт восстановит связь, и отправьте ещё раз.");
      return;
    }

    const contact = { name: cleanName, phone: phoneValue };
    busyRef.current = true;
    setBusy(true);
    setError("");
    const popup = window.open("about:blank", "_blank");
    const synced = await syncProductsWithServer();
    if (!synced) {
      if (popup && !popup.closed) popup.close();
      busyRef.current = false;
      setBusy(false);
      setError("Не удалось проверить актуальную цену. Проверьте интернет и отправьте ещё раз.");
      return;
    }
    const fresh = currentLines();
    if (!fresh.length || lineKey(fresh) !== lineKey(lines)) {
      if (popup && !popup.closed) popup.close();
      busyRef.current = false;
      setBusy(false);
      if (fresh.length) {
        setOrderLines(fresh);
        setError("Сумма или состав заказа изменились. Проверьте и отправьте ещё раз.");
      } else {
        closeOrder();
        window.alert("Этого товара уже нет в каталоге.");
      }
      return;
    }
    const stockError = stockLimitMessage(fresh);
    if (stockError) {
      if (popup && !popup.closed) popup.close();
      busyRef.current = false;
      setBusy(false);
      setOrderLines(fresh);
      setError(stockError);
      return;
    }

    const payload = buildPayload(fresh, contact, channel, order.clientOrderId);
    const cartSnapshot = order.source === "cart"
      ? fresh.map(({ product, qty }) => ({ id: product.id, qty }))
      : [];
    let savedOrder = null;
    let failureKind = "";
    let stopMessage = "";
    try {
      const { res, data } = await postJsonWithTimeout("/api/orders", payload, 12000);
      if (res.status === 400 || res.status === 409) {
        if (popup && !popup.closed) popup.close();
        if (res.status === 409) await handleStale(data.error);
        else setError(data.error || "Проверьте данные заказа");
        return;
      }
      if (res.ok && data.order) savedOrder = data.order;
      else if (res.status === 429) failureKind = data.scope === "day" ? "day" : "minute";
      else if (res.status === 503 && data.retry !== true) {
        stopMessage = data.error || "Каталог временно недоступен. Заказ не записан. Отправьте его ещё раз чуть позже.";
      } else if (res.status === 503) failureKind = "catalog";
      else failureKind = "server";
    } catch (err) {
      failureKind = "offline";
      console.warn(`Заказ ${order.clientOrderId}: ${err?.name || "error"} ${err?.message || ""}`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }

    if (stopMessage) {
      if (popup && !popup.closed) popup.close();
      setError(stopMessage);
      return;
    }

    if (!savedOrder) {
      if (popup && !popup.closed) popup.close();
      const queued = queuePendingOrder(payload, cartSnapshot, Date.now() + pendingRetryDelay(failureKind));
      setError(queued
        ? pendingOrderNotice(failureKind)
        : "Заказ не сохранился в браузере. Освободите место и отправьте ещё раз. Корзина на месте.");
      return;
    }
    try {
      saveClientContact(contact);
    } catch {
      /* имя не запомнилось — заказ уже уходит в мессенджер */
    }
    const text = savedOrder
      ? orderTextFromRows(savedOrder.items || [], savedOrder.total, contact, orderNumber(savedOrder))
      : buildOrderText(fresh, contact);
    const url = messengerUrl(channel, text, site);
    if (url) openMessenger(popup, url);
    else if (popup && !popup.closed) popup.close();
    if (order.source === "cart") {
      try {
        clearCart();
      } catch {
        /* корзина останется в браузере, заказ уже оформлен */
      }
      closeCart();
    }
    setDone({ order: savedOrder, channel, url, clientOrderId: order.clientOrderId });
  }

  const channelLabel = done?.channel === "telegram" ? "Telegram" : "WhatsApp";
  const number = done ? orderNumber(done.order) : "";

  return (
    <div className="order-modal" onClick={(event) => { if (event.target === event.currentTarget) closeOrder(); }}>
      <div
        className={`order-modal__panel${done ? " is-done" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={done ? "order-done-title" : "order-modal-title"}
        ref={panelRef}
      >
        <button type="button" className="order-modal__close" aria-label="Закрыть" onClick={closeOrder}>×</button>
        {done ? (
          <div className="order-done" aria-live="polite">
            <span className="order-done__icon" aria-hidden="true">✓</span>
            <h3 id="order-done-title">{number ? `Заказ №${number} принят` : "Заказ почти готов"}</h3>
            <p className="order-modal__text">
              {`Заказ сохранён${done.order?.total ? ` на ${done.order.total}` : ""}. Отправьте Динаре сообщение в ${channelLabel} — текст уже готов.`}
            </p>
            <div className="order-done__actions">
              <a className={`btn ${done.channel === "telegram" ? "btn--tg" : "btn--primary"}`} href={done.url} target="_blank" rel="noopener noreferrer">
                Открыть {channelLabel}
              </a>
              <button type="button" className="btn btn--ghost-dark" onClick={closeOrder}>Готово</button>
            </div>
          </div>
        ) : (
          <>
            <h3 id="order-modal-title">Оформление заказа</h3>
            <p className="order-modal__text">Оставьте имя и телефон. Заказ сохранится, и откроется чат с Динарой.</p>
            <ul className="order-modal__summary">
              {lines.map(({ product, qty }) => (
                <li key={product.id}>
                  <span>{product.title} × {qty}</span>
                  <strong>{totalPrice(product, qty)}</strong>
                </li>
              ))}
            </ul>
            <p className="order-modal__total">Итого: <strong>{total}</strong></p>
            <form className="order-form" onSubmit={submit}>
              <label className="order-field">
                Имя
                <input id="order-name" name="name" required maxLength={80} autoComplete="name" placeholder="Как к вам обращаться" value={name} onChange={(event) => { setName(event.target.value); setError(""); }} />
              </label>
              <label className="order-field">
                Телефон с кодом страны
                <span className="order-phone">
                  <span className="order-phone__plus" aria-hidden="true">+</span>
                  <input
                    id="order-phone"
                    name="phone"
                    type="tel"
                    required
                    maxLength={19}
                    autoComplete="tel"
                    inputMode="numeric"
                    placeholder="7 700 000 00 00"
                    aria-label="Номер телефона с кодом страны"
                    value={phone}
                    onChange={(event) => { setPhone(formatOrderPhone(event.target.value)); setError(""); }}
                  />
                </span>
              </label>
              <p className="order-form__error" hidden={!error}>{error}</p>
              <div className="order-modal__actions">
                <button type="submit" className="btn btn--primary" data-channel="whatsapp" disabled={busy}>WhatsApp</button>
                <button type="submit" className="btn btn--tg" data-channel="telegram" disabled={busy}>Telegram</button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

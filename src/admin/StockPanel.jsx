import { useState } from "react";
import { formatOrderDate, orderStatusLabel } from "./helpers";
import { notifyAuthRequired, orderNumber } from "../lib/products";

async function adminFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const res = await fetch(path, { ...options, headers, cache: "no-store" });
  if (res.status === 401) {
    notifyAuthRequired();
    throw new Error("Нужно войти в админку ещё раз");
  }
  return res;
}

export default function StockPanel({ items, error, onItems, onOpenOrder }) {
  const [drafts, setDrafts] = useState({});
  const [busyId, setBusyId] = useState("");
  const [formError, setFormError] = useState("");

  function draftOf(id) {
    return drafts[id] || { qty: "", note: "" };
  }

  function setDraft(id, patch) {
    setDrafts((current) => ({ ...current, [id]: { ...draftOf(id), ...patch } }));
  }

  async function addReceipt(event, productId) {
    event.preventDefault();
    const draft = draftOf(productId);
    setBusyId(productId);
    setFormError("");
    try {
      const res = await adminFetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, qty: draft.qty, note: draft.note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Не удалось записать приход");
      onItems(Array.isArray(data.items) ? data.items : []);
      setDraft(productId, { qty: "", note: "" });
    } catch (err) {
      setFormError(err.message || "Не удалось записать приход");
    } finally {
      setBusyId("");
    }
  }

  async function removeReceipt(receiptId) {
    if (!window.confirm("Удалить этот приход? Остаток пересчитается.")) return;
    setBusyId(receiptId);
    setFormError("");
    try {
      const res = await adminFetch(`/api/stock/${encodeURIComponent(receiptId)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Не удалось удалить приход");
      onItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setFormError(err.message || "Не удалось удалить приход");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="admin-card">
      <div className="admin-card__head">
        <h2>Остатки</h2>
      </div>
      <p className="admin-hint stock-lead">
        Приход записываете вы, и только для товаров. Пока прихода не было, товар заказывается свободно. После первого прихода заказать больше остатка нельзя, и это ограничение сохраняется, даже если приходы потом удалить. Услуги в остатках не участвуют. Отменённый заказ в расход не входит.
      </p>
      <p className="admin-error" hidden={!error && !formError}>{error || formError}</p>
      {!items.length ? (
        <p>Товаров пока нет. Услуги в остатках не учитываются.</p>
      ) : (
        <div className="stock-list">
          {items.map((item) => {
            const draft = draftOf(item.id);
            const low = item.balance < 0;
            return (
              <article className="stock-row" key={item.id}>
                <div className="stock-row__title">
                  <strong>{item.title}</strong>
                  {item.price ? <span>{item.price}</span> : null}
                  {!item.inCatalog ? <em>Нет в каталоге</em> : null}
                </div>
                <dl className="stock-nums">
                  <div>
                    <dt>Приход</dt>
                    <dd>{item.incoming}</dd>
                  </div>
                  <div>
                    <dt>Расход</dt>
                    <dd>{item.outgoing}</dd>
                  </div>
                  <div>
                    <dt>Остаток</dt>
                    <dd className={low ? "is-low" : ""}>{item.balance}</dd>
                  </div>
                </dl>
                <details className="stock-links">
                  <summary>Откуда цифры</summary>
                  <div>
                    <h3>Приходы</h3>
                    {item.receipts.length ? (
                      <ul>
                        {item.receipts.map((receipt) => (
                          <li key={receipt.id}>
                            <time dateTime={receipt.createdAt}>{formatOrderDate(receipt.createdAt)}</time>
                            <b>+{receipt.qty}</b>
                            {receipt.note ? <span>{receipt.note}</span> : null}
                            <button type="button" disabled={busyId === receipt.id} onClick={() => removeReceipt(receipt.id)}>Удалить</button>
                          </li>
                        ))}
                      </ul>
                    ) : <p>Приходов пока нет.</p>}
                    <h3>Заказы в расходе</h3>
                    {item.orders.length ? (
                      <ul>
                        {item.orders.map((order, index) => (
                          <li key={`${order.orderId}-${index}`}>
                            <button type="button" onClick={() => onOpenOrder(order)}>№{orderNumber({ id: order.orderId, number: order.number })}</button>
                            <span>{order.name}</span>
                            <b>{order.qty}</b>
                            <span>{orderStatusLabel(order.status)}</span>
                            <time dateTime={order.createdAt}>{formatOrderDate(order.createdAt)}</time>
                          </li>
                        ))}
                      </ul>
                    ) : <p>Заказов в расходе нет.</p>}
                  </div>
                </details>
                {item.inCatalog ? (
                  <form className="stock-form" onSubmit={(event) => addReceipt(event, item.id)}>
                    <label>
                      <span className="visually-hidden">Количество прихода</span>
                      <input
                        type="number"
                        min="1"
                        max="9999"
                        step="1"
                        inputMode="numeric"
                        placeholder="Кол-во"
                        required
                        value={draft.qty}
                        onChange={(event) => setDraft(item.id, { qty: event.target.value })}
                      />
                    </label>
                    <label>
                      <span className="visually-hidden">Комментарий к приходу</span>
                      <input
                        type="text"
                        maxLength="200"
                        placeholder="Комментарий, необязательно"
                        value={draft.note}
                        onChange={(event) => setDraft(item.id, { note: event.target.value })}
                      />
                    </label>
                    <button type="submit" className="btn btn--primary" disabled={busyId === item.id}>Записать приход</button>
                  </form>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

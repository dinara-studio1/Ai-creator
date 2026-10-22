import { useRef } from "react";
import { cartTotalsByCurrency, displayPrice, totalPrice } from "../lib/money";
import { cartQtyCap, clearCart, removeFromCart, setCartQty, stockLimitMessage } from "../lib/cart";
import { useShop } from "../context/ShopContext";
import { useFocusTrap } from "../hooks/useOverlay";

export default function CartDrawer() {
  const { cartOpen, closeCart, lines, openOrder, order, contactOpen, productsLoadFailed } = useShop();
  const panelRef = useRef(null);
  useFocusTrap(cartOpen && !order && !contactOpen, panelRef, ".cart-drawer__close");

  const total = cartTotalsByCurrency(lines).join(" · ");
  const stockError = stockLimitMessage(lines);

  return (
    <div className="cart-drawer" hidden={!cartOpen}>
      <button type="button" className="cart-drawer__backdrop" aria-label="Закрыть корзину" onClick={closeCart} />
      <aside className="cart-drawer__panel" role="dialog" aria-modal="true" aria-labelledby="cart-title" ref={panelRef}>
        <div className="cart-drawer__head">
          <h2 id="cart-title">Корзина</h2>
          <button type="button" className="cart-drawer__close" aria-label="Закрыть" onClick={closeCart}>×</button>
        </div>
        <div className="cart-drawer__body">
          {lines.length ? lines.map(({ product, qty }) => {
            const cap = cartQtyCap(product);
            return (
            <article className="cart-item" key={product.id}>
              <div className="cart-item__top">
                <div className="cart-item__info">
                  <strong>{product.title}</strong>
                  <span className="cart-item__meta">{displayPrice(product)}{product.kind !== "service" && product.available != null && product.available !== "" ? ` · ${cap > 0 ? `в наличии ${cap}` : "нет в наличии"}` : ""}</span>
                </div>
                <button type="button" className="cart-item__remove" aria-label="Удалить услугу" onClick={() => removeFromCart(product.id)}>
                  Удалить
                </button>
              </div>
              <div className="cart-item__controls">
                <div className="order-qty__controls cart-item__qty">
                  <button type="button" className="order-qty__btn" aria-label="Меньше" onClick={() => setCartQty(product.id, Math.max(1, qty - 1), Math.max(cap, qty))}>−</button>
                  <span className="cart-item__qty-val">{qty}</span>
                  <button type="button" className="order-qty__btn" aria-label="Больше" disabled={productsLoadFailed || qty >= cap} onClick={() => setCartQty(product.id, Math.min(cap, qty + 1), cap)}>+</button>
                </div>
                <span className="cart-item__sum">{totalPrice(product, qty)}</span>
              </div>
            </article>
            );
          }) : (
            <p className="cart-drawer__empty">Корзина пуста. Добавьте услуги из раздела «Каталог».</p>
          )}
        </div>
        <div className="cart-drawer__foot" hidden={!lines.length}>
          <p className="cart-drawer__total">Итого: <strong>{total || "0 ₸"}</strong></p>
          {productsLoadFailed ? <p className="order-form__error">Цены и остатки могли устареть. Количество пока нельзя увеличить.</p> : null}
          {stockError ? <p className="order-form__error">{stockError}</p> : null}
          <button
            type="button"
            className="btn btn--primary cart-drawer__checkout"
            disabled={Boolean(stockError)}
            onClick={() => {
              if (!lines.length || stockError) return;
              openOrder(lines, "cart");
            }}
          >
            Оформить заказ
          </button>
          <button
            type="button"
            className="btn btn--ghost-dark cart-drawer__clear"
            onClick={() => {
              if (!window.confirm("Очистить корзину?")) return;
              clearCart();
            }}
          >
            Очистить корзину
          </button>
        </div>
      </aside>
    </div>
  );
}

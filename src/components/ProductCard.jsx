import { useState } from "react";
import { addToCart, cartQtyCap } from "../lib/cart";
import { displayPrice } from "../lib/money";
import { isInstagramUrl, isVideoUrl, safeMediaUrl } from "../lib/media";
import { useShop } from "../context/ShopContext";

function ProductMedia({ product }) {
  const url = safeMediaUrl(product.image);
  const [brokenUrl, setBrokenUrl] = useState("");
  const broken = Boolean(url) && brokenUrl === url;

  if (isInstagramUrl(url)) {
    return (
      <div className="product-card__media product-card__media--link">
        <a href={url} target="_blank" rel="noopener noreferrer">Смотреть в Instagram ↗</a>
      </div>
    );
  }

  if (isVideoUrl(url)) {
    return (
      <div className="product-card__media">
        <video src={url} muted playsInline loop autoPlay controls preload="metadata" />
      </div>
    );
  }

  return (
    <div className={`product-card__media${broken ? " product-card__media--broken" : ""}`}>
      {url && !broken ? (
        <img src={url} alt={product.title} loading="lazy" width="800" height="500" onError={() => setBrokenUrl(url)} />
      ) : null}
    </div>
  );
}

export default function ProductCard({ product }) {
  const { openOrder, productsLoadFailed } = useShop();
  const cap = cartQtyCap(product);
  const out = cap === 0;
  const [qty, setQty] = useState(1);
  const shownQty = out ? 1 : Math.min(qty, cap);
  const [added, setAdded] = useState(false);

  function add() {
    if (out || productsLoadFailed) return;
    if (!addToCart(product.id, shownQty, cap)) return;
    setAdded(true);
    window.setTimeout(() => setAdded(false), 900);
  }

  return (
    <article className="product-card">
      <ProductMedia product={product} />
      <div className="product-card__body">
        <h3 className="product-card__title">{product.title}</h3>
        <p className="product-card__desc">{product.description}</p>
        <div className="product-card__bar">
          <div className="product-card__price">
            <span>{displayPrice(product)}</span>
            {product.kind === "service" || product.available == null || product.available === "" ? null : (
              <span className={`product-card__stock${out ? " is-out" : ""}`}>
                {out ? "Нет в наличии" : `В наличии ${cap}`}
              </span>
            )}
          </div>
          <div className="product-card__qty" role="group" aria-label="Количество">
            <button type="button" className="product-card__qty-btn" aria-label="Меньше" disabled={out} onClick={() => setQty((value) => Math.max(1, value - 1))}>−</button>
            <span className="product-card__qty-val">{shownQty}</span>
            <button type="button" className="product-card__qty-btn" aria-label="Больше" disabled={out || shownQty >= cap} onClick={() => setQty((value) => Math.min(cap, value + 1))}>+</button>
          </div>
          <button type="button" className="btn btn--ghost-dark btn--order product-card__cart" disabled={added || out || productsLoadFailed} onClick={add}>
            {added ? "Добавлено" : "В корзину"}
          </button>
          <button type="button" className="btn btn--primary btn--order product-card__buy" disabled={out} onClick={() => openOrder([{ product, qty: shownQty }], "buy")}>
            Заказать
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ limit }) {
  const { products, productsLoaded, productsLoadFailed } = useShop();
  const shown = Number.isFinite(limit) && limit > 0 ? products.slice(0, limit) : products;

  if (!products.length) {
    const message = !productsLoaded
      ? "Загружаем каталог…"
      : productsLoadFailed
        ? "Не удалось загрузить каталог. Обновите страницу чуть позже."
        : "Пока нет услуг.";
    return <p className="shop__empty">{message}</p>;
  }

  return shown.map((product) => <ProductCard key={product.id} product={product} />);
}

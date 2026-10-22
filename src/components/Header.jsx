import { Link, useLocation } from "react-router-dom";
import { useShop } from "../context/ShopContext";

export default function Header() {
  const { pathname } = useLocation();
  const { count, openCart, openContact } = useShop();
  const home = pathname === "/";
  const catalog = pathname === "/catalog";

  return (
    <header className={`top${home ? "" : " top--solid"}`}>
      <Link className="logo" to="/">
        <img className="logo__mark" src="/logo.png" alt="" width="40" height="40" />
        Динара
      </Link>
      <div className="top__right">
        <nav className="nav" aria-label="Основная навигация">
          <Link to="/#about">Обо мне</Link>
          <Link to="/#directions">Услуги</Link>
          <Link to="/catalog" aria-current={catalog ? "page" : undefined}>Каталог</Link>
          <a href="/#contact" onClick={(event) => { event.preventDefault(); openContact(); }}>Контакт</a>
        </nav>
        <button type="button" className="cart-btn" onClick={openCart} aria-label="Открыть корзину">
          <span className="cart-btn__icon" aria-hidden="true">🛒</span>
          <span className="cart-btn__label">Корзина</span>
          <span className="cart-btn__count" hidden={count === 0}>{count}</span>
        </button>
      </div>
    </header>
  );
}

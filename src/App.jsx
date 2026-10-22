import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import Header from "./components/Header";
import Footer from "./components/Footer";
import CartDrawer from "./components/CartDrawer";
import OrderModal from "./components/OrderModal";
import ContactModal from "./components/ContactModal";
import ChatWidget from "./components/ChatWidget";
import HomePage from "./pages/HomePage";
import CatalogPage from "./pages/CatalogPage";
import AdminPage from "./pages/AdminPage";
import ErrorBoundary from "./components/ErrorBoundary";
import { useShop } from "./context/ShopContext";
import { useBodyLock } from "./hooks/useOverlay";
import { dismissUnsavedOrder, subscribeUnsavedOrder, unsavedOrderMessage } from "./lib/orders";

function UnsavedOrderNotice() {
  const [message, setMessage] = useState(unsavedOrderMessage);
  useEffect(() => {
    setMessage(unsavedOrderMessage());
    return subscribeUnsavedOrder(() => setMessage(unsavedOrderMessage()));
  }, []);
  if (!message) return null;
  return (
    <div className="order-unsaved" role="status">
      <p>{message}</p>
      <button type="button" onClick={dismissUnsavedOrder}>Понятно</button>
    </div>
  );
}

function PublicLayout() {
  const location = useLocation();
  const { cartOpen, contactOpen, order, openContact, closeContact, closeOrder, closeCart, products, productsLoadFailed, site } = useShop();
  const openContactRef = useRef(openContact);
  openContactRef.current = openContact;
  useBodyLock(cartOpen || contactOpen || Boolean(order));

  useEffect(() => {
    const catalog = location.pathname === "/catalog";
    document.body.classList.toggle("page-catalog", catalog);
    document.title = catalog ? "Каталог — Динара" : "Динара — AI Video Creator";
    const description = document.querySelector('meta[name="description"]');
    if (description) {
      description.setAttribute("content", catalog
        ? "Каталог услуг Динары — AI Video Creator."
        : "Динара — AI Video Creator. Создаю видео с помощью искусственного интеллекта.");
    }
    return () => document.body.classList.remove("page-catalog");
  }, [location.pathname]);

  useEffect(() => {
    if (location.hash === "#contact") openContactRef.current();
    else if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      if (contactOpen) closeContact();
      else if (order) closeOrder();
      else if (cartOpen) closeCart();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [contactOpen, order, cartOpen, closeContact, closeOrder, closeCart]);

  return (
    <>
      {site.configState === "failed" ? (
        <div className="site-banner" role="status">Контакты и чат не загрузились</div>
      ) : null}
      {productsLoadFailed && products.length ? (
        <div className="site-banner" role="status">Цены и остатки могли устареть. Не удалось обновить каталог.</div>
      ) : null}
      <Header />
      <Outlet />
      <Footer />
      <CartDrawer />
      <OrderModal />
      <ContactModal />
      <ChatWidget />
      <UnsavedOrderNotice />
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/catalog" element={<CatalogPage />} />
      </Route>
      <Route path="/admin" element={<ErrorBoundary name="admin"><AdminPage /></ErrorBoundary>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

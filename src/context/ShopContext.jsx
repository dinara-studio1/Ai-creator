import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { cartCount, getCartLines, subscribeCart } from "../lib/cart";
import { PENDING_RETRY_MS, flushPendingOrders } from "../lib/orders";
import {
  loadProducts,
  newClientOrderId,
  productsStatus,
  subscribeProducts,
  syncProductsWithServer,
} from "../lib/products";

const ShopContext = createContext(null);

export function ShopProvider({ children }) {
  const [, setTick] = useState(0);
  const [cartOpen, setCartOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [order, setOrder] = useState(null);
  const [site, setSite] = useState({
    waPhone: "",
    tgUser: "",
    chatName: "",
    aiReady: false,
    demoReset: false,
    configState: "loading",
  });

  useEffect(() => subscribeProducts(() => setTick((value) => value + 1)), []);
  useEffect(() => subscribeCart(() => setTick((value) => value + 1)), []);

  useEffect(() => {
    syncProductsWithServer();
    flushPendingOrders();
    const timer = setInterval(flushPendingOrders, PENDING_RETRY_MS);
    window.addEventListener("online", flushPendingOrders);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", flushPendingOrders);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer = 0;
    let attempt = 0;
    let stopped = false;

    const load = async () => {
      try {
        const res = await fetch("/api/config", { cache: "no-store", signal: controller.signal });
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        const data = await res.json();
        if (stopped) return;
        if (!data?.waPhone || !data?.tgUser) {
          const err = new Error("нет контактов");
          err.status = res.status;
          throw err;
        }
        setSite({
          waPhone: String(data.waPhone),
          tgUser: String(data.tgUser),
          chatName: String(data.chatName || ""),
          aiReady: Boolean(data.aiReady),
          demoReset: data.demoReset === true,
          configState: "ready",
        });
      } catch (err) {
        if (stopped || controller.signal.aborted) return;
        console.error(`Конфиг: не удалось загрузить /api/config (HTTP ${err?.status || 0}): ${err?.message || err}`);
        setSite({
          waPhone: "",
          tgUser: "",
          chatName: "",
          aiReady: false,
          demoReset: false,
          configState: "failed",
        });
        const delay = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
        attempt += 1;
        timer = window.setTimeout(load, delay);
      }
    };

    load();
    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  const openCart = useCallback(() => setCartOpen(true), []);
  const closeCart = useCallback(() => setCartOpen(false), []);
  const openContact = useCallback(() => setContactOpen(true), []);
  const closeContact = useCallback(() => setContactOpen(false), []);
  const openOrder = useCallback((lines, source) => {
    setOrder({ lines, source, clientOrderId: newClientOrderId() });
  }, []);
  const closeOrder = useCallback(() => setOrder(null), []);
  const setOrderLines = useCallback((lines) => {
    setOrder((current) => (current ? { ...current, lines } : current));
  }, []);

  const status = productsStatus();
  const value = {
    products: loadProducts(),
    productsLoaded: status.loaded,
    productsLoadFailed: status.failed,
    lines: getCartLines(),
    count: cartCount(),
    site,
    cartOpen,
    contactOpen,
    order,
    openCart,
    closeCart,
    openContact,
    closeContact,
    openOrder,
    closeOrder,
    setOrderLines,
  };

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop() {
  const value = useContext(ShopContext);
  if (!value) throw new Error("useShop вне ShopProvider");
  return value;
}

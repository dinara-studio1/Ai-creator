import { useEffect, useRef } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useBodyLock(locked) {
  useEffect(() => {
    if (!locked) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [locked]);
}

export function useFocusTrap(active, ref, focusSelector) {
  const selectorRef = useRef(focusSelector);
  selectorRef.current = focusSelector;
  useEffect(() => {
    if (!active) return undefined;
    const root = ref.current;
    if (!root) return undefined;
    const opener = document.activeElement;
    const items = () => [...root.querySelectorAll(FOCUSABLE)].filter((node) => node.getClientRects().length);
    const frame = requestAnimationFrame(() => {
      const selector = selectorRef.current;
      const target = selector ? root.querySelector(selector) : null;
      (target || items()[0])?.focus();
    });
    const onKey = (event) => {
      if (event.key !== "Tab") return;
      if (document.getElementById("ai-chat")?.contains(document.activeElement)) return;
      const list = items();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (!root.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      if (opener instanceof HTMLElement && opener.isConnected && opener.getClientRects().length) opener.focus();
    };
  }, [active, ref]);
}

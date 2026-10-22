import { useRef } from "react";
import { prettyPhone } from "../lib/phone";
import { useShop } from "../context/ShopContext";
import { useFocusTrap } from "../hooks/useOverlay";

export default function ContactModal() {
  const { contactOpen, closeContact, site } = useShop();
  const panelRef = useRef(null);
  const ready = site.configState === "ready" && site.waPhone && site.tgUser;
  useFocusTrap(contactOpen, panelRef, ready ? "#contact-wa" : ".contact-modal__close");
  if (!contactOpen) return null;

  return (
    <div className="order-modal contact-modal" onClick={(event) => { if (event.target === event.currentTarget) closeContact(); }}>
      <div className="contact-modal__panel" role="dialog" aria-modal="true" aria-labelledby="contact-modal-title" ref={panelRef}>
        <button type="button" className="contact-modal__close" aria-label="Закрыть" onClick={closeContact}>×</button>
        <p className="contact-modal__kicker">Контакт</p>
        <h3 id="contact-modal-title">Напишите — обсудим ролик</h3>
        <p className="contact-modal__text">Расскажите задачу и аудиторию. Отвечу и предложу простой формат.</p>
        <div className="contact-modal__list">
          {ready ? (
            <>
              <a className="contact-modal__row" id="contact-wa" href={`https://wa.me/${site.waPhone}`} target="_blank" rel="noopener noreferrer">
                <span>WhatsApp</span>
                <strong>{prettyPhone(site.waPhone)}</strong>
              </a>
              <a className="contact-modal__row contact-modal__row--tg" href={`https://t.me/${site.tgUser}`} target="_blank" rel="noopener noreferrer">
                <span>Telegram</span>
                <strong>@{site.tgUser}</strong>
              </a>
            </>
          ) : (
            <p className="contact-modal__text">{site.configState === "loading" ? "Загружаем контакты…" : "Контакты и чат не загрузились"}</p>
          )}
        </div>
      </div>
    </div>
  );
}

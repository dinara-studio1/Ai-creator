import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { greetingText, historyForApi, replyWithAttachments, slimCard } from "../lib/chatEngine";
import { loadProducts } from "../lib/products";
import { useShop } from "../context/ShopContext";

const CHAT_KEY = "dinara_ai_chat_v2";
const HEIGHT_KEY = "dinara_ai_chat_height";
const WIDTH_KEY = "dinara_ai_chat_width";
const API_TIMEOUT_MS = 60000;
const MAX_ATTACH = 4;
const MAX_TEXT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_FILE_TEXT = 20000;
const IMAGE_MAX_SIDE = 1600;
const THUMB_MAX_SIDE = 200;
const MIN_HEIGHT = 280;
const MIN_WIDTH = 280;
const LINK_RE = /\[([^\]\n]{1,200})\]\((https?:\/\/(?:wa\.me|t\.me|telegram\.me)\/[^\s()<>"]+)\)|(https?:\/\/(?:wa\.me|t\.me|telegram\.me)\/[^\s<>"]*[^\s<>".,;:!?)\]»'])/g;

try {
  sessionStorage.removeItem("dinara_ai_chat");
} catch {
  /* ignore */
}

function loadHistory() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(CHAT_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storedMessages(messages, keepThumbs) {
  return messages.slice(keepThumbs ? -40 : -20).map((message) => ({
    ...message,
    attachments: (message.attachments || []).map(({ dataUrl, thumb, ...rest }) => (
      keepThumbs ? { ...rest, thumb } : rest
    )),
  }));
}

function saveHistory(messages) {
  try {
    sessionStorage.setItem(CHAT_KEY, JSON.stringify(storedMessages(messages, true)));
  } catch {
    try {
      sessionStorage.setItem(CHAT_KEY, JSON.stringify(storedMessages(messages, false)));
    } catch {
      /* ignore */
    }
  }
}

function isHeicFile(file) {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || "");
}

function isImageFile(file) {
  if (isHeicFile(file)) return false;
  if (/^image\//i.test(file.type)) return true;
  return /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name || "");
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Не удалось открыть изображение"));
    };
    img.src = url;
  });
}

function imageToJpeg(img, maxSide, quality) {
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) throw new Error("Пустое изображение");
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsText(file);
  });
}

function Inline({ text }) {
  const parts = String(text).split(/(\*\*[^*\n]+\*\*|\n)/g);
  return parts.map((part, index) => {
    if (part === "\n") return <br key={index} />;
    const bold = part.match(/^\*\*([^*\n]+)\*\*$/);
    if (bold) return <strong key={index}>{bold[1]}</strong>;
    return part;
  });
}

function RichText({ text }) {
  const src = String(text || "").replace(/^#{1,6}\s+/gm, "");
  const nodes = [];
  let last = 0;
  let index = 0;
  for (const match of src.matchAll(LINK_RE)) {
    nodes.push(<Inline key={index} text={src.slice(last, match.index)} />);
    index += 1;
    const url = match[2] || match[3];
    const label = match[2] ? match[1] : match[3];
    nodes.push(
      <a key={index} href={url} target="_blank" rel="noopener noreferrer">{label}</a>
    );
    index += 1;
    last = match.index + match[0].length;
  }
  nodes.push(<Inline key={index} text={src.slice(last)} />);
  return nodes;
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5.2 18.6 4 21.2c-.3.6.3 1.2.9 1l3.2-1.2A8.8 8.8 0 1 0 5.2 18.6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8.2 11.1h7.4M8.2 14.2h4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.2 12.1 19 5.4c.7-.3 1.4.4 1.1 1.1L13.9 20c-.3.7-1.3.6-1.5-.1l-1.6-6.2L4.3 13.3c-.8-.2-.8-1.3-.1-1.2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 9.5 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ChatWidget() {
  const { site, cartOpen, contactOpen, order } = useShop();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(loadHistory);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);
  const [typing, setTyping] = useState(false);
  const [modelState, setModelState] = useState("unknown");
  const [fabHost, setFabHost] = useState(null);
  const [size, setSize] = useState({ height: null, width: null });
  const [resizeAxis, setResizeAxis] = useState("");
  const panelRef = useRef(null);
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const imageRef = useRef(null);
  const attachRef = useRef(null);
  const attachMenuRef = useRef(false);
  const messagesRef = useRef(messages);
  const addingRef = useRef(false);
  const busyRef = useRef(false);
  const sizeRef = useRef(size);
  const overlayRef = useRef(false);
  messagesRef.current = messages;
  attachMenuRef.current = attachMenu;
  sizeRef.current = size;
  overlayRef.current = contactOpen || Boolean(order) || cartOpen;

  const chatName = site.chatName || "Чат";
  const contactsReady = site.configState === "ready" && Boolean(site.waPhone) && Boolean(site.tgUser);
  const waLink = contactsReady ? `https://wa.me/${site.waPhone}` : "";
  const tgLink = contactsReady ? `https://t.me/${site.tgUser}` : "";
  const modelOnline = contactsReady && site.aiReady && modelState === "up";
  const statusText = site.configState === "failed" || (site.configState === "ready" && !contactsReady)
    ? "Чат не загрузился"
    : site.configState !== "ready"
      ? "Подключаемся…"
      : !site.aiReady
        ? "Ответ без модели"
        : modelState === "down"
          ? "Модель сейчас недоступна"
          : modelOnline
            ? "AI-консультант · онлайн"
            : "AI-консультант";

  useLayoutEffect(() => {
    setFabHost(document.querySelector(".hero__actions"));
  }, [location.pathname]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const maxHeight = () => Math.max(MIN_HEIGHT, window.innerHeight - 88);
    const maxWidth = () => Math.max(MIN_WIDTH, Math.min(640, window.innerWidth - 24));
    let savedH = 0;
    let savedW = 0;
    try {
      savedH = Number(localStorage.getItem(HEIGHT_KEY)) || 0;
      savedW = Number(localStorage.getItem(WIDTH_KEY)) || 0;
    } catch {
      /* ignore */
    }
    setSize({
      height: Math.min(maxHeight(), Math.max(MIN_HEIGHT, Math.round(savedH || Math.min(560, window.innerHeight * 0.72)))),
      width: Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(savedW || Math.min(380, window.innerWidth - 24)))),
    });
    return undefined;
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, typing, open]);

  useEffect(() => {
    const panel = panelRef.current;
    const root = document.getElementById("ai-chat");
    const trap = (event) => {
      if (panel.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      if (logRef.current) logRef.current.scrollTop += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    };
    panel?.addEventListener("wheel", trap, { passive: false });
    root?.addEventListener("wheel", trap, { passive: false });
    return () => {
      panel?.removeEventListener("wheel", trap);
      root?.removeEventListener("wheel", trap);
    };
  }, [open]);

  useEffect(() => {
    if (!attachMenu) return undefined;
    const onPointer = (event) => {
      if (attachRef.current?.contains(event.target)) return;
      setAttachMenu(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [attachMenu]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key !== "Escape" || overlayRef.current) return;
      if (attachMenuRef.current) {
        setAttachMenu(false);
        return;
      }
      closeChat();
    };
    document.addEventListener("keydown", onKey);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    const onResize = () => {
      if (panelRef.current?.hidden || !sizeRef.current.height) return;
      clampSize(sizeRef.current, true);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function clampSize(next, save) {
    const height = Math.min(Math.max(MIN_HEIGHT, window.innerHeight - 88), Math.max(MIN_HEIGHT, Math.round(next.height)));
    const width = Math.min(Math.max(MIN_WIDTH, Math.min(640, window.innerWidth - 24)), Math.max(MIN_WIDTH, Math.round(next.width)));
    setSize({ height, width });
    if (save) {
      try {
        localStorage.setItem(HEIGHT_KEY, String(height));
        localStorage.setItem(WIDTH_KEY, String(width));
      } catch {
        /* ignore */
      }
    }
  }

  function startResize(axis, event) {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const start = sizeRef.current;
    setResizeAxis(axis);
    const onMove = (moveEvent) => {
      const point = moveEvent.touches ? moveEvent.touches[0] : moveEvent;
      if (moveEvent.cancelable) moveEvent.preventDefault();
      clampSize({
        height: axis === "w" ? start.height : start.height + (startY - point.clientY),
        width: axis === "h" ? start.width : start.width + (startX - point.clientX),
      }, false);
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      setResizeAxis("");
      setSize((current) => {
        try {
          localStorage.setItem(HEIGHT_KEY, String(current.height));
          localStorage.setItem(WIDTH_KEY, String(current.width));
        } catch {
          /* ignore */
        }
        return current;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    addingRef.current = true;
    setAdding(true);
    const next = [...pending];
    try {
      for (const file of files) {
        if (next.length >= MAX_ATTACH) {
          window.alert(`Можно прикрепить максимум ${MAX_ATTACH} файла.`);
          break;
        }
        if (isHeicFile(file)) {
          window.alert(`«${file.name}»: формат HEIC не поддерживается. Сохраните фото как JPG или PNG.`);
          continue;
        }
        try {
          if (isImageFile(file)) {
            if (file.size > MAX_IMAGE_SOURCE_BYTES) {
              window.alert(`«${file.name}» слишком большой. Максимум 25 МБ.`);
              continue;
            }
            const img = await loadImage(file);
            next.push({
              name: file.name,
              mime: "image/jpeg",
              kind: "image",
              dataUrl: imageToJpeg(img, IMAGE_MAX_SIDE, 0.85),
              thumb: imageToJpeg(img, THUMB_MAX_SIDE, 0.7),
            });
          } else if (/^text\//i.test(file.type) || /\.(txt|md|csv|json|log)$/i.test(file.name || "")) {
            if (file.size > MAX_TEXT_FILE_BYTES) {
              window.alert(`«${file.name}» слишком большой. Максимум 4 МБ.`);
              continue;
            }
            const text = await readAsText(file);
            next.push({ name: file.name, mime: file.type || "text/plain", kind: "text", text: text.slice(0, MAX_FILE_TEXT) });
          } else {
            window.alert(`«${file.name}»: можно прикрепить фото или текстовый файл (TXT, MD, CSV, JSON).`);
          }
        } catch {
          window.alert(`Не удалось добавить «${file.name}».`);
        }
        setPending([...next]);
      }
    } finally {
      addingRef.current = false;
      setAdding(false);
      setPending([...next]);
    }
  }

  function pushMessages(updater) {
    setMessages((current) => {
      const next = updater(current);
      saveHistory(next);
      return next;
    });
  }

  function withContacts(text) {
    const lines = [text];
    if (waLink) lines.push(`WhatsApp: ${waLink}`);
    if (tgLink) lines.push(`Telegram: ${tgLink}`);
    return lines.join("\n\n");
  }

  function errorReply(text) {
    return { text: withContacts(text), source: "error", cards: [] };
  }

  async function ask(value, files) {
    const replyCtx = { catalog: loadProducts(), chatName: site.chatName || chatName, waLink, tgLink };
    const history = historyForApi(messagesRef.current);
    pushMessages((current) => [
      ...current,
      {
        role: "user",
        text: value,
        attachments: files.map((file) => ({
          name: file.name,
          mime: file.mime,
          kind: file.kind,
          thumb: file.kind === "image" ? file.thumb : undefined,
          dataUrl: file.kind === "image" ? file.dataUrl : undefined,
          text: file.kind === "text" ? String(file.text || "").slice(0, 2000) : undefined,
        })),
      },
    ]);
    setBusy(true);
    setTyping(true);
    let reply;
    try {
      if (site.configState !== "ready" || !contactsReady) {
        reply = errorReply(site.configState === "loading"
          ? "Контакты и чат ещё загружаются. Подождите пару секунд и отправьте ещё раз."
          : "Контакты и чат не загрузились. Обновите страницу чуть позже.");
      } else if (!site.aiReady) {
        reply = { ...replyWithAttachments(value, files, replyCtx), source: "fallback" };
      } else {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
        try {
          const res = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              message: value,
              history,
              attachments: files.map((file) => ({
                name: file.name,
                mime: file.mime,
                kind: file.kind,
                dataUrl: file.kind === "image" ? file.dataUrl : undefined,
                text: file.kind === "text" ? file.text : undefined,
              })),
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || typeof data.reply !== "string" || !data.reply.trim()) {
            const err = new Error(data.error || "Сейчас не удалось ответить.");
            err.status = res.ok ? 502 : res.status;
            err.scope = data.scope;
            err.fallback = data.fallback === true && data.source !== "error";
            throw err;
          }
          reply = {
            text: data.reply,
            source: "model",
            cards: Array.isArray(data.cards) ? data.cards.filter((card) => card && typeof card === "object") : [],
          };
          setModelState("up");
        } finally {
          window.clearTimeout(timer);
        }
      }
    } catch (err) {
      if (err?.status === 413) {
        reply = errorReply("Вложения получились слишком большими. Отправьте их по одному или уменьшите файл.");
      } else if (err?.status === 429) {
        reply = errorReply(err.scope === "day"
          ? "На сегодня сообщений уже много. Напишите завтра."
          : err.scope === "busy"
            ? "Сейчас много запросов. Попробуйте через несколько секунд."
            : "Слишком много сообщений подряд. Подождите минуту и напишите снова.");
      } else if (err?.fallback === true) {
        reply = { ...replyWithAttachments(value, files, replyCtx), source: "fallback" };
      } else {
        const timedOut = err?.name === "AbortError" || err?.status === 504;
        if (err?.status !== 503) setModelState("down");
        reply = errorReply(timedOut
          ? "Модель не ответила вовремя."
          : (err?.status ? (err.message || "AI временно недоступен.") : "Сейчас не удалось ответить. Попробуйте ещё раз чуть позже."));
      }
    } finally {
      setTyping(false);
      const source = reply?.source === "model" || reply?.source === "fallback" ? reply.source : "error";
      pushMessages((current) => [
        ...current,
        {
          role: "bot",
          text: String(reply?.text || "Сейчас не удалось ответить. Попробуйте ещё раз чуть позже."),
          cards: (reply?.cards || []).map(slimCard),
          source,
          fallback: source === "fallback" ? true : undefined,
        },
      ]);
      busyRef.current = false;
      setBusy(false);
    }
  }

  function closeChat() {
    setAttachMenu(false);
    setOpen(false);
    requestAnimationFrame(() => document.querySelector(".ai-chat__fab")?.focus());
  }

  function toggle() {
    if (open) {
      closeChat();
      return;
    }
    if (!messagesRef.current.length) {
      const greeting = contactsReady && !site.aiReady
        ? [{ role: "bot", text: greetingText(site.chatName || chatName), source: "fallback", fallback: true }]
        : site.configState === "ready"
          ? [{ role: "bot", text: greetingText(site.chatName || chatName) }]
          : [{
            role: "bot",
            text: site.configState === "loading"
              ? "Контакты и чат ещё загружаются."
              : "Контакты и чат не загрузились. Обновите страницу чуть позже.",
            source: "error",
          }];
      saveHistory(greeting);
      setMessages(greeting);
    }
    setOpen(true);
  }

  const fab = (
    <button
      type="button"
      className={`ai-chat__fab${open ? " is-open" : ""}`}
      aria-label={`Открыть чат с ${chatName}`}
      aria-expanded={open}
      aria-controls="ai-chat-panel"
      onClick={toggle}
    >
      <span className="ai-chat__fab-pulse" aria-hidden="true" />
      <span className="ai-chat__fab-icon"><ChatIcon /></span>
    </button>
  );

  const resizingClass = resizeAxis === "both"
    ? " is-resizing is-resizing-h is-resizing-w"
    : resizeAxis === "h"
      ? " is-resizing is-resizing-h"
      : resizeAxis === "w"
        ? " is-resizing is-resizing-w"
        : "";

  return (
    <div className={`ai-chat${open ? " is-open" : ""}${fabHost ? " ai-chat--hero" : ""}`} id="ai-chat">
      <div
        className={`ai-chat__panel${resizingClass}`}
        id="ai-chat-panel"
        hidden={!open}
        role="dialog"
        aria-labelledby="ai-chat-title"
        ref={panelRef}
        style={size.height ? { height: `${size.height}px`, width: `${size.width}px`, maxHeight: `${Math.max(MIN_HEIGHT, window.innerHeight - 88)}px`, maxWidth: `${Math.max(MIN_WIDTH, Math.min(640, window.innerWidth - 24))}px` } : undefined}
      >
        <div
          className="ai-chat__resize ai-chat__resize--h"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Изменить высоту чата"
          tabIndex={0}
          onPointerDown={(event) => startResize("h", event)}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              clampSize({ ...size, height: size.height + 56 }, true);
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              clampSize({ ...size, height: size.height - 56 }, true);
            }
          }}
        />
        <div
          className="ai-chat__resize ai-chat__resize--w"
          role="separator"
          aria-orientation="vertical"
          aria-label="Изменить ширину чата"
          tabIndex={0}
          onPointerDown={(event) => startResize("w", event)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              clampSize({ ...size, width: size.width + 40 }, true);
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              clampSize({ ...size, width: size.width - 40 }, true);
            }
          }}
        />
        <div className="ai-chat__resize ai-chat__resize--corner" aria-label="Изменить размер чата" onPointerDown={(event) => startResize("both", event)} />
        <div className="ai-chat__head">
          <span className="ai-chat__avatar" aria-hidden="true">{(chatName || "А").charAt(0).toUpperCase()}</span>
          <div className="ai-chat__who">
            <p className="ai-chat__name" id="ai-chat-title">{chatName}</p>
            <p className={`ai-chat__status${modelOnline ? "" : " is-off"}`}>{statusText}</p>
          </div>
          <div className="ai-chat__head-actions">
            <button type="button" className="ai-chat__size-btn ai-chat__minimize" aria-label="Свернуть чат" title="Свернуть" onClick={closeChat}>
              <MinimizeIcon />
            </button>
          </div>
        </div>
        <div className="ai-chat__log" role="log" aria-live="polite" ref={logRef}>
          {messages.map((message, index) => (
            <div className={`ai-chat__bubble ai-chat__bubble--${message.role === "user" ? "user" : "bot"}`} key={`${message.role}-${index}`}>
              {message.role === "user" && message.attachments?.length ? (
                <div className="ai-chat__msg-files">
                  {message.attachments.map((file) => (
                    file.kind === "image" && /^data:image\/jpeg;base64,/.test(file.thumb || "")
                      ? <span className="ai-chat__msg-thumb" key={file.name}><img src={file.thumb} alt={file.name} /></span>
                      : <span className="ai-chat__msg-file" key={file.name}>{file.name}</span>
                  ))}
                </div>
              ) : null}
              {message.role !== "user" && (message.source === "fallback" || message.fallback) ? (
                <p className="ai-chat__note">Ответ без модели</p>
              ) : null}
              {message.role !== "user" && message.source === "error" ? (
                <p className="ai-chat__note ai-chat__note--error">Ошибка</p>
              ) : null}
              <RichText text={message.text} />
              {message.role !== "user" && message.cards?.length ? (
                <div className="ai-chat__cards">
                  {message.cards.map((card) => (
                    <article className="ai-chat__card" key={card.title}>
                      <strong>{card.title}</strong>
                      <span>{card.price}</span>
                      {card.description ? <em>{card.description}</em> : null}
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {typing ? (
            <div className="ai-chat__bubble ai-chat__bubble--bot">
              <span className="ai-chat__typing" aria-label={`${chatName} печатает`}><i /><i /><i /></span>
            </div>
          ) : null}
        </div>
        <div className="ai-chat__attach-list" hidden={!pending.length}>
          {pending.map((file, index) => (
            <div className={`ai-chat__pending${file.kind === "image" && file.thumb ? " ai-chat__pending--img" : ""}`} key={`${file.name}-${index}`}>
              {file.kind === "image" && file.thumb ? <img src={file.thumb} alt="" /> : <span>{file.name}</span>}
              <button type="button" aria-label="Убрать" onClick={() => setPending((current) => current.filter((_, item) => item !== index))}>×</button>
            </div>
          ))}
        </div>
        <form
          className="ai-chat__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (busyRef.current || addingRef.current) return;
            const value = draft.trim();
            const files = pending.slice();
            if (!value && !files.length) return;
            busyRef.current = true;
            setDraft("");
            setPending([]);
            ask(value, files);
          }}
        >
          <input
            ref={imageRef}
            type="file"
            hidden
            multiple
            accept="image/*"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept=".txt,.md,.csv,.json,.log,text/plain,text/markdown,text/csv,application/json"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <div className="ai-chat__attach" ref={attachRef}>
            {attachMenu ? (
              <div className="ai-chat__attach-menu" role="menu" aria-label="Что прикрепить">
                <button type="button" role="menuitem" onClick={() => { setAttachMenu(false); imageRef.current?.click(); }}>Фото</button>
                <button type="button" role="menuitem" onClick={() => { setAttachMenu(false); fileRef.current?.click(); }}>Файл</button>
              </div>
            ) : null}
            <button
              type="button"
              className={`ai-chat__attach-btn${attachMenu ? " is-open" : ""}`}
              aria-label="Прикрепить фото или файл"
              aria-haspopup="menu"
              aria-expanded={attachMenu}
              title="Фото или файл"
              disabled={adding}
              onClick={() => setAttachMenu((open) => !open)}
            >
              +
            </button>
          </div>
          <input
            ref={inputRef}
            className="ai-chat__input"
            type="text"
            maxLength={500}
            autoComplete="off"
            placeholder={`Напишите ${chatName}…`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button className="ai-chat__send" type="submit" aria-label="Отправить" disabled={busy}><SendIcon /></button>
        </form>
      </div>
      {fabHost ? createPortal(fab, fabHost) : fab}
    </div>
  );
}

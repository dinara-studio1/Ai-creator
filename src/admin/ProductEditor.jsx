import { useEffect, useRef, useState } from "react";
import { CURRENCIES, formatPrice, parsePriceFields, productKind } from "../lib/money";
import { isVideoUrl } from "../lib/media";
import { drawCropToCanvas, exportCroppedImage, getCropMetrics, loadImageFromSrc, readFileAsDataURL } from "./crop";

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_PRICE_DIGITS = 9;

const EMPTY = { id: "", title: "", description: "", amount: "", currency: "kzt", kind: "product", image: "" };

function formFromProduct(product) {
  if (!product) return { ...EMPTY };
  const fields = parsePriceFields(product);
  return {
    id: product.id,
    title: product.title || "",
    description: product.description || "",
    amount: fields.amount,
    currency: fields.currency,
    kind: productKind(product),
    image: product.image || "",
  };
}

export default function ProductEditor({ draft, onClose, onSave }) {
  const [form, setForm] = useState(() => formFromProduct(draft));
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [cropSrc, setCropSrc] = useState("");
  const fileRef = useRef(null);
  const editing = Boolean(draft?.id);
  const video = isVideoUrl(form.image) || String(form.image).startsWith("data:video");

  useEffect(() => {
    document.body.classList.add("product-modal-open");
    return () => document.body.classList.remove("product-modal-open");
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape") return;
      if (cropSrc) setCropSrc("");
      else onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cropSrc, onClose]);

  async function handleFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      window.alert("Файл слишком большой. Максимум 3 МБ.");
      return;
    }
    const isImage = /^image\/(jpeg|png|webp|gif)$/.test(file.type);
    const isVideo = file.type === "video/mp4" || /\.mp4$/i.test(file.name);
    if (!isImage && !isVideo) {
      window.alert("Нужно фото (JPG, PNG, WEBP, GIF) или видео MP4.");
      return;
    }
    try {
      const dataUrl = await readFileAsDataURL(file);
      if (isImage && file.type !== "image/gif") setCropSrc(dataUrl);
      else setForm((current) => ({ ...current, image: dataUrl }));
    } catch (err) {
      window.alert(err.message || "Ошибка загрузки файла");
    }
  }

  async function submit(event) {
    event.preventDefault();
    const title = form.title.replace(/\s+/g, " ").trim();
    const description = form.description.trim();
    const amountRaw = form.amount.trim();
    if (!title) return window.alert("Укажите название");
    if (!description) return window.alert("Добавьте описание");
    if (!/^\d[\d\s]*$/.test(amountRaw)) return window.alert("Цена — целое число без копеек, например 15000");
    const amount = amountRaw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    if (amount.length > MAX_PRICE_DIGITS) return window.alert("Слишком большая цена");
    if (!form.image) return window.alert("Добавьте фото или видео");
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const ok = await onSave({
        id: form.id,
        title,
        description,
        amount,
        currency: form.currency,
        kind: form.kind === "service" ? "service" : "product",
        price: formatPrice(amount, form.currency),
        image: form.image,
      });
      if (ok) onClose();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="product-modal">
      <button type="button" className="product-modal__backdrop" aria-label="Закрыть" onClick={onClose} />
      <div className="product-modal__panel" role="dialog" aria-modal="true" aria-labelledby="product-modal-title">
        <div className="product-modal__head">
          <h2 id="product-modal-title">{editing ? "Редактировать товар" : "Добавить товар"}</h2>
          <button type="button" className="product-modal__x" aria-label="Закрыть" onClick={onClose}>×</button>
        </div>
        <form className="admin-form" onSubmit={submit}>
          <label>
            Название
            <input type="text" required maxLength={80} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label>
            Тип
            <select required value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
              <option value="product">Товар</option>
              <option value="service">Услуга</option>
            </select>
          </label>
          <label>
            Описание
            <textarea required rows={3} maxLength={280} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          <div className="admin-price">
            <label className="admin-price__amount">
              Цена
              <input type="text" required maxLength={11} inputMode="numeric" placeholder="15000" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
            </label>
            <label className="admin-price__currency">
              Валюта
              <select required value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}>
                {Object.values(CURRENCIES).map((currency) => (
                  <option key={currency.code} value={currency.code}>{currency.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="admin-media">
            <span className="admin-media__label">Фото или видео</span>
            <div
              className={`dropzone${dragOver ? " is-drag" : ""}`}
              tabIndex={0}
              role="button"
              aria-label="Выберите или перетащите фото"
              onClick={(event) => {
                if (event.target.closest("video, .dropzone__clear")) return;
                fileRef.current?.click();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  fileRef.current?.click();
                }
              }}
              onDragEnter={(event) => { event.preventDefault(); setDragOver(true); }}
              onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false); }}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                handleFile(event.dataTransfer.files?.[0]);
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,video/mp4"
                hidden
                onChange={(event) => {
                  handleFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              {!form.image ? (
                <div className="dropzone__empty">
                  <strong>Выберите или перетащите фото</strong>
                  <span>JPG, PNG, WEBP, GIF или MP4 до 3 МБ</span>
                </div>
              ) : (
                <div className="dropzone__preview">
                  {video ? <video src={form.image} muted playsInline controls /> : <img src={form.image} alt="" />}
                  <button type="button" className="dropzone__clear" aria-label="Убрать файл" onClick={() => setForm({ ...form, image: "" })}>×</button>
                </div>
              )}
            </div>
            <p className="admin-hint">После выбора фото откроется окно: сетка, сдвиг и превью карточки на сайте.</p>
          </div>
          <div className="admin-form__actions">
            <button type="submit" className="btn btn--primary" disabled={saving}>{editing ? "Сохранить" : "Добавить"}</button>
            <button type="button" className="btn btn--ghost-dark" onClick={onClose}>Отмена</button>
            <button
              type="button"
              className="btn btn--ghost-dark admin-form__crop"
              hidden={!form.image || video}
              onClick={() => {
                loadImageFromSrc(form.image).then(() => setCropSrc(form.image)).catch((err) => window.alert(err.message || "Ошибка"));
              }}
            >
              Настроить кадр
            </button>
          </div>
        </form>
      </div>
      {cropSrc ? (
        <CropModal
          src={cropSrc}
          title={form.title}
          amount={form.amount}
          currency={form.currency}
          onCancel={() => setCropSrc("")}
          onApply={(dataUrl) => {
            setForm((current) => ({ ...current, image: dataUrl }));
            setCropSrc("");
          }}
        />
      ) : null}
    </div>
  );
}

function CropModal({ src, title, amount, currency, onApply, onCancel }) {
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const previewRef = useRef(null);
  const sourceRef = useRef(null);
  const stateRef = useRef({ zoom: 1, ox: 0, oy: 0, dragging: false, lastX: 0, lastY: 0 });
  const [zoom, setZoom] = useState(100);
  const [, setFrame] = useState(0);

  function paint() {
    const stage = stageRef.current;
    const image = sourceRef.current;
    const el = imageRef.current;
    const metrics = getCropMetrics(stage, image, stateRef.current);
    if (!el || !metrics) return;
    el.style.width = `${metrics.drawW}px`;
    el.style.height = `${metrics.drawH}px`;
    el.style.transform = `translate(calc(-50% + ${stateRef.current.ox}px), calc(-50% + ${stateRef.current.oy}px))`;
    drawCropToCanvas(previewRef.current, stage, image, stateRef.current);
  }

  useEffect(() => {
    let cancelled = false;
    loadImageFromSrc(src).then(({ img, dataUrl }) => {
      if (cancelled) return;
      sourceRef.current = img;
      if (imageRef.current) imageRef.current.src = dataUrl;
      stateRef.current = { zoom: 1, ox: 0, oy: 0, dragging: false, lastX: 0, lastY: 0 };
      requestAnimationFrame(() => {
        paint();
        requestAnimationFrame(paint);
      });
    }).catch((err) => {
      window.alert(err.message || "Ошибка");
      onCancel();
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    stateRef.current.zoom = Math.max(1, zoom / 100);
    paint();
  }, [zoom, title, amount, currency]);

  const price = formatPrice(String(amount || "0").replace(/[^\d]/g, "") || "0", currency) || "0 ₸";

  return (
    <div className="crop-modal">
      <div className="crop-modal__panel" role="dialog" aria-modal="true" aria-labelledby="crop-title">
        <div className="crop-modal__head">
          <h2 id="crop-title">Настройка фото</h2>
          <button type="button" className="crop-modal__x" aria-label="Закрыть" onClick={onCancel}>×</button>
        </div>
        <div className="crop-modal__grid">
          <div className="crop-modal__editor">
            <p className="crop-modal__hint">Перетащите фото. Сетка — как на карточке каталога (16:10).</p>
            <div
              className={`crop-stage${stateRef.current.dragging ? " is-dragging" : ""}`}
              ref={stageRef}
              onPointerDown={(event) => {
                if (!sourceRef.current) return;
                stateRef.current.dragging = true;
                stateRef.current.lastX = event.clientX;
                stateRef.current.lastY = event.clientY;
                event.currentTarget.setPointerCapture(event.pointerId);
                setFrame((value) => value + 1);
              }}
              onPointerMove={(event) => {
                if (!stateRef.current.dragging) return;
                stateRef.current.ox += event.clientX - stateRef.current.lastX;
                stateRef.current.oy += event.clientY - stateRef.current.lastY;
                stateRef.current.lastX = event.clientX;
                stateRef.current.lastY = event.clientY;
                paint();
              }}
              onPointerUp={(event) => {
                stateRef.current.dragging = false;
                try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
                setFrame((value) => value + 1);
              }}
              onPointerCancel={(event) => {
                stateRef.current.dragging = false;
                try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
                setFrame((value) => value + 1);
              }}
            >
              <img ref={imageRef} alt="" draggable="false" />
              <div className="crop-stage__grid" aria-hidden="true" />
              <div className="crop-stage__profile" aria-hidden="true" />
            </div>
            <label className="crop-zoom">
              <span>Масштаб</span>
              <input type="range" min="100" max="250" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
            </label>
            <div className="crop-presets">
              <button type="button" className="btn btn--ghost-dark" onClick={() => { stateRef.current.ox = 0; stateRef.current.oy = 0; paint(); }}>По центру</button>
              <button type="button" className="btn btn--ghost-dark" onClick={() => {
                const metrics = getCropMetrics(stageRef.current, sourceRef.current, stateRef.current);
                if (!metrics) return;
                stateRef.current.ox = 0;
                stateRef.current.oy = metrics.maxOy;
                paint();
              }}>Лицо сверху</button>
              <button type="button" className="btn btn--ghost-dark" onClick={() => {
                stateRef.current.zoom = 1;
                stateRef.current.ox = 0;
                stateRef.current.oy = 0;
                setZoom(100);
                paint();
              }}>Сбросить</button>
            </div>
          </div>
          <div className="crop-modal__preview">
            <p className="crop-modal__hint">Как будет на сайте</p>
            <article className="crop-card-preview">
              <div className="crop-card-preview__media">
                <canvas ref={previewRef} width="480" height="300" />
              </div>
              <div className="crop-card-preview__body">
                <span className="product-card__kind">Превью</span>
                <strong>{title.trim() || "Название товара"}</strong>
                <span className="crop-card-preview__price">{price}</span>
              </div>
            </article>
          </div>
        </div>
        <div className="crop-modal__actions">
          <button type="button" className="btn btn--ghost-dark" onClick={onCancel}>Отмена</button>
          <button type="button" className="btn btn--primary" onClick={() => {
            try {
              const dataUrl = exportCroppedImage(stageRef.current, sourceRef.current, stateRef.current);
              if (!dataUrl) return window.alert("Не удалось применить кадр.");
              onApply(dataUrl);
            } catch (err) {
              window.alert(err.message || "Не удалось применить кадр.");
            }
          }}>Применить кадр</button>
        </div>
      </div>
    </div>
  );
}

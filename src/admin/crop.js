const CROP_ASPECT = 16 / 10;

function readBlobAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(blob);
  });
}

export function readFileAsDataURL(file) {
  return readBlobAsDataURL(file);
}

async function toEditableDataUrl(src) {
  if (!src) throw new Error("Нет изображения");
  if (String(src).startsWith("data:")) return src;
  try {
    const res = await fetch(src, { mode: "cors" });
    if (!res.ok) throw new Error("fetch failed");
    return await readBlobAsDataURL(await res.blob());
  } catch {
    /* fallback below */
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        canvas.getContext("2d").drawImage(img, 0, 0);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      } catch {
        reject(new Error("Нельзя обрезать это фото. Загрузите файл с компьютера."));
      }
    };
    img.onerror = () => reject(new Error("Нельзя обрезать это фото. Загрузите файл с компьютера."));
    img.src = src;
  });
}

export function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось открыть изображение"));
    img.src = dataUrl;
  });
}

export async function loadImageFromSrc(src) {
  const dataUrl = await toEditableDataUrl(src);
  const img = await loadImageElement(dataUrl);
  return { img, dataUrl };
}

export function getCropMetrics(stage, img, state) {
  if (!stage || !img) return null;
  const frameW = stage.clientWidth || stage.offsetWidth;
  const frameH = stage.clientHeight || stage.offsetHeight;
  if (!frameW || !frameH) return null;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return null;
  const base = Math.max(frameW / iw, frameH / ih);
  const scale = base * state.zoom;
  const drawW = iw * scale;
  const drawH = ih * scale;
  const maxOx = Math.max(0, (drawW - frameW) / 2);
  const maxOy = Math.max(0, (drawH - frameH) / 2);
  state.ox = Math.max(-maxOx, Math.min(maxOx, state.ox));
  state.oy = Math.max(-maxOy, Math.min(maxOy, state.oy));
  return { frameW, frameH, scale, drawW, drawH, maxOx, maxOy };
}

export function drawCropToCanvas(canvas, stage, img, state) {
  const metrics = getCropMetrics(stage, img, state);
  if (!canvas || !img || !metrics) return false;
  const ctx = canvas.getContext("2d");
  const sx = (metrics.drawW / 2 - metrics.frameW / 2 - state.ox) / metrics.scale;
  const sy = (metrics.drawH / 2 - metrics.frameH / 2 - state.oy) / metrics.scale;
  const sw = metrics.frameW / metrics.scale;
  const sh = metrics.frameH / metrics.scale;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return true;
}

export function exportCroppedImage(stage, img, state) {
  const outW = 960;
  const outH = Math.round(outW / CROP_ASPECT);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  if (!drawCropToCanvas(canvas, stage, img, state)) {
    throw new Error("Не удалось подготовить кадр. Подождите загрузки фото.");
  }
  try {
    return canvas.toDataURL("image/jpeg", 0.86);
  } catch {
    throw new Error("Нельзя сохранить кадр для этого фото. Загрузите файл с компьютера.");
  }
}

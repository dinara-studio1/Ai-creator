const MAX_IMAGE_DATA_URL = 3_000_000;
const MAX_FILE_TEXT = 20000;
const MAX_TOTAL_FILE_TEXT = 40000;
const IMAGE_DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;

function normalizeAttachments(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 4)
    .map((item) => {
      const named = typeof item?.name === "string" ? item.name.trim() : "";
      return {
        name: (named || "file").slice(0, 120),
        mime: String(item?.mime || "application/octet-stream").slice(0, 120),
        kind: item?.kind === "image" || item?.kind === "text" ? item.kind : "file",
        dataUrl:
          typeof item?.dataUrl === "string" && item.dataUrl.length <= MAX_IMAGE_DATA_URL ? item.dataUrl : "",
        text: typeof item?.text === "string" ? item.text.slice(0, MAX_FILE_TEXT) : "",
        named: Boolean(named),
      };
    })
    .filter((item) => item.dataUrl || item.text || item.named)
    .map(({ named, ...item }) => item);
}

function sanitizeContentParts(raw) {
  if (!Array.isArray(raw)) return null;
  const parts = [];
  let images = 0;
  for (const part of raw.slice(0, 8)) {
    if (part?.type === "text" && typeof part.text === "string" && part.text.trim()) {
      parts.push({ type: "text", text: part.text.trim().slice(0, 4500) });
      continue;
    }
    const url = part?.type === "image_url" ? part.image_url?.url : "";
    if (
      images < 2 &&
      typeof url === "string" &&
      url.length <= MAX_IMAGE_DATA_URL &&
      IMAGE_DATA_URL_RE.test(url)
    ) {
      images += 1;
      parts.push({
        type: "image_url",
        image_url: { url, detail: "high" },
      });
    }
  }
  if (!parts.some((part) => part.type === "text") && parts.length) {
    parts.unshift({ type: "text", text: "Клиент прислал изображение." });
  }
  return parts.length ? parts : null;
}

function buildUserContent(message, attachments) {
  const parts = [];
  const textChunks = [];
  let textBudget = MAX_TOTAL_FILE_TEXT;

  if (message) textChunks.push(message);

  attachments.forEach((file) => {
    if (file.kind === "text" && file.text && textBudget > 0) {
      const text = file.text.slice(0, textBudget);
      textBudget -= text.length;
      textChunks.push(`Файл «${file.name}» (${file.mime}):\n"""\n${text}\n"""`);
      return;
    }
    if (file.kind === "image" && IMAGE_DATA_URL_RE.test(file.dataUrl)) {
      parts.push({
        type: "image_url",
        image_url: { url: file.dataUrl, detail: "high" },
      });
      textChunks.push(`[Прикреплено изображение: ${file.name}]`);
      return;
    }
    textChunks.push(
      `Прикреплён файл «${file.name}» (${file.mime}). Содержимое недоступно для прямого чтения — опирайся на имя и вопрос клиента.`
    );
  });

  const text = textChunks.join("\n\n").trim() || "Клиент прислал вложение. Помоги разобрать.";

  if (!parts.length) return text;

  parts.unshift({ type: "text", text });
  return parts;
}

module.exports = { normalizeAttachments, buildUserContent, sanitizeContentParts };

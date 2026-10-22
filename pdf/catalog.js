/**
 * PDF каталога: HTML из базы и печать через системный Chrome или Edge.
 * Отдельный пакет не нужен — браузер на этом компьютере уже есть.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const IMAGE_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const MAX_REMOTE_IMAGE = 8 * 1024 * 1024;

let queue = Promise.resolve();

function findBrowser() {
  const file = String(process.env.CHROME_PATH || "").trim();
  if (file && fs.existsSync(file)) return file;
  return "";
}

function pdfTimeoutMs() {
  const value = Number(process.env.PDF_TIMEOUT_MS);
  return Number.isInteger(value) && value > 0 ? value : 30000;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function logSkippedImage(src, reason) {
  console.error(`PDF каталога: картинка пропущена (${reason}): ${String(src || "").slice(0, 180)}`);
}

function localImage(root, src) {
  const value = String(src || "").trim();
  if (!value || /^https?:\/\//i.test(value)) return { data: "", reason: "" };
  if (/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) return { data: value, reason: "" };
  if (value.startsWith("data:")) return { data: "", reason: "не картинка" };
  if (value.includes("..") || path.isAbsolute(value)) return { data: "", reason: "недопустимый путь" };
  const rel = value.replace(/^\/+/, "").replace(/\//g, path.sep);
  if (!rel || rel.split(path.sep).some((seg) => !seg || seg.startsWith("."))) return { data: "", reason: "недопустимый путь" };
  const file = path.resolve(root, rel);
  const fromRoot = path.relative(root, file);
  if (!fromRoot || fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) return { data: "", reason: "недопустимый путь" };
  const mime = IMAGE_EXT[path.extname(file).toLowerCase()];
  if (!mime) return { data: "", reason: "не картинка" };
  if (!fs.existsSync(file)) return { data: "", reason: "файл не найден" };
  const stat = fs.statSync(file);
  if (!stat.isFile()) return { data: "", reason: "не файл" };
  if (stat.size > MAX_REMOTE_IMAGE) return { data: "", reason: "размер больше 8 МБ" };
  return { data: `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`, reason: "" };
}

async function remoteImage(src) {
  const value = String(src || "").trim();
  if (!/^https?:\/\//i.test(value)) return { data: "", reason: "" };
  try {
    const response = await fetch(value, { signal: AbortSignal.timeout(8000), redirect: "follow" });
    if (!response.ok) return { data: "", reason: `сеть HTTP ${response.status}` };
    const mime = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime)) {
      return { data: "", reason: `не картинка (${mime || "нет content-type"})` };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) return { data: "", reason: "пустой ответ" };
    if (buffer.length > MAX_REMOTE_IMAGE) return { data: "", reason: "размер больше 8 МБ" };
    return { data: `data:${mime};base64,${buffer.toString("base64")}`, reason: "" };
  } catch (err) {
    const reason = err?.name === "TimeoutError" ? "сеть: таймаут" : `сеть: ${err?.message || "ошибка"}`;
    return { data: "", reason };
  }
}

async function productImage(root, src) {
  const value = String(src || "").trim();
  if (!value) return "";
  const image = /^https?:\/\//i.test(value) ? await remoteImage(value) : localImage(root, value);
  if (!image.data && image.reason) logSkippedImage(value, image.reason);
  return image.data;
}

function catalogHtml(products, images, contacts) {
  const printed = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const contactBits = [
    contacts.waPhone ? `WhatsApp +${String(contacts.waPhone).replace(/^\+/, "")}` : "",
    contacts.tgUser ? `Telegram @${contacts.tgUser}` : "",
  ].filter(Boolean);
  const cards = products.map((product, index) => {
    const title = escapeHtml(product.title);
    const description = escapeHtml(product.description);
    const price = escapeHtml(product.price);
    const kind = product.kind === "service" ? "Услуга" : "Товар";
    const src = images[index];
    const media = src
      ? `<img src="${src}" alt="">`
      : `<div class="ph"></div>`;
    return `<article class="item">${media}<div><p class="kind">${kind}</p><h2>${title}</h2><p class="desc">${description}</p><p class="price">${price}</p></div></article>`;
  }).join("");
  const body = cards || `<p class="empty">В каталоге пока нет услуг.</p>`;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Каталог услуг — Динара</title>
  <style>
    @page { size: A4; margin: 14mm 14mm 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #13242e; font-family: "Segoe UI", Arial, sans-serif; }
    header { display: flex; justify-content: space-between; align-items: flex-end; gap: 8mm; border-bottom: 2px solid #13242e; padding-bottom: 4mm; margin-bottom: 6mm; }
    .kicker { margin: 0 0 1.5mm; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: #5c6b73; }
    h1 { margin: 0; font-size: 26px; line-height: 1.15; }
    .meta { margin: 0; text-align: right; font-size: 12px; line-height: 1.45; color: #3d4c55; }
    .item { display: grid; grid-template-columns: 42mm 1fr; gap: 5mm; padding: 4.5mm 0; border-bottom: 1px solid #e4e8ea; break-inside: avoid; page-break-inside: avoid; }
    .item img, .ph { width: 42mm; height: 28mm; object-fit: cover; border-radius: 3mm; background: #eef2f3; }
    .kind { margin: 0 0 1mm; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #5c6b73; }
    h2 { margin: 0 0 2mm; font-size: 16px; line-height: 1.25; }
    .desc { margin: 0; font-size: 12.5px; line-height: 1.45; color: #3d4c55; }
    .price { margin: 3mm 0 0; font-size: 16px; font-weight: 700; }
    .empty { font-size: 14px; }
    footer { margin-top: 6mm; font-size: 11px; color: #5c6b73; }
  </style>
</head>
<body>
  <header>
    <div>
      <p class="kicker">Динара · AI Video Creator</p>
      <h1>Каталог услуг</h1>
    </div>
    <p class="meta">${escapeHtml(printed)}${contactBits.length ? `<br>${escapeHtml(contactBits.join(" · "))}` : ""}</p>
  </header>
  ${body}
  <footer>Цены на ${escapeHtml(printed)}. Состав и стоимость подтверждаются при заказе.</footer>
</body>
</html>`;
}

function removeDir(dir) {
  const fail = (err) => {
    console.error(`PDF каталога: не удалось удалить временный профиль ${dir}: ${err?.message || err}`);
  };
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    setTimeout(() => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (retryErr) {
        fail(retryErr);
      }
    }, 4000).unref();
  }
}

function browserStderr(chunks) {
  return chunks.join("").trim().slice(-1500);
}

function failPrint(message, stderr) {
  const err = new Error(message);
  if (stderr) {
    err.stderr = stderr;
    console.error(`PDF каталога: stderr Chrome/Edge: ${stderr}`);
  }
  return err;
}

function chromeArgs(profileDir, pdfPath, htmlPath) {
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    `--user-data-dir=${profileDir}`,
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath}`,
  ];
  if (/^(1|true|yes)$/i.test(String(process.env.CHROME_NO_SANDBOX || ""))) {
    args.push("--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage");
  }
  args.push(pathToFileURL(htmlPath).href);
  return args;
}

function printHtml(browser, htmlPath, pdfPath, profileDir) {
  return new Promise((resolve, reject) => {
    const child = spawn(browser, chromeArgs(profileDir, pdfPath, htmlPath), { windowsHide: true });
    const stderrChunks = [];
    child.stderr?.on("data", (chunk) => {
      stderrChunks.push(chunk.toString());
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(failPrint("Браузер не успел собрать PDF", browserStderr(stderrChunks)));
    }, pdfTimeoutMs());
    child.on("error", (err) => {
      clearTimeout(timer);
      const stderr = browserStderr(stderrChunks);
      if (stderr) {
        err.stderr = stderr;
        console.error(`PDF каталога: stderr Chrome/Edge: ${stderr}`);
      }
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      const stderr = browserStderr(stderrChunks);
      if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 500) {
        if (stderr) console.error(`PDF каталога: stderr Chrome/Edge: ${stderr}`);
        resolve();
      } else reject(failPrint(`Браузер завершился с кодом ${code}, PDF не создан`, stderr));
    });
  });
}

async function renderOnce(options) {
  const browser = findBrowser();
  if (!browser) throw new Error("Не найден Chrome. Задайте путь в CHROME_PATH.");
  const products = Array.isArray(options.products) ? options.products : [];
  const images = [];
  for (const product of products) images.push(await productImage(options.root, product.image));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dinara-pdf-"));
  const htmlPath = path.join(dir, "catalog.html");
  const pdfPath = path.join(dir, "catalog.pdf");
  const profileDir = path.join(dir, "profile");
  try {
    fs.writeFileSync(htmlPath, catalogHtml(products, images, options.contacts || {}));
    await printHtml(browser, htmlPath, pdfPath, profileDir);
    return fs.readFileSync(pdfPath);
  } finally {
    removeDir(dir);
  }
}

function renderCatalogPdf(options) {
  const run = queue.then(() => renderOnce(options), () => renderOnce(options));
  queue = run.then(() => {}, () => {});
  return run;
}

module.exports = { findBrowser, pdfTimeoutMs, chromeArgs, renderCatalogPdf };

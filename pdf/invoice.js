/**
 * PDF счёта по заказу. Печать через системный Chrome или Edge.
 * Генератор каталога pdf/catalog.js не используется и не меняется:
 * у счетов своя очередь, чтобы два счёта не запускали Chrome одновременно.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const { findBrowser, pdfTimeoutMs, chromeArgs } = require("./catalog");
const STATUSES = {
  new: "Новый",
  progress: "В работе",
  done: "Готово",
  cancelled: "Отменён",
};

let queue = Promise.resolve();

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function invoiceNumber(order) {
  const number = Number(order?.number);
  if (Number.isInteger(number) && number > 0) return String(number);
  return String(order?.id || "").slice(-6).toUpperCase();
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function plural(n, forms) {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
  return forms[2];
}

function chunkWords(n, female) {
  const hundreds = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
  const tens = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
  const teens = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
  const ones = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const words = [];
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const one = n % 10;
  if (hundred) words.push(hundreds[hundred]);
  if (rest >= 10 && rest < 20) words.push(teens[rest - 10]);
  else {
    if (Math.floor(rest / 10) > 1) words.push(tens[Math.floor(rest / 10)]);
    if (one) words.push(female && one <= 2 ? (one === 1 ? "одна" : "две") : ones[one]);
  }
  return words.join(" ");
}

function spellAmount(value) {
  const n = Math.floor(Number(value));
  if (!Number.isSafeInteger(n) || n < 0) return "";
  if (n === 0) return "ноль";
  const parts = [];
  const billions = Math.floor(n / 1_000_000_000);
  const millions = Math.floor(n / 1_000_000) % 1000;
  const thousands = Math.floor(n / 1000) % 1000;
  const rest = n % 1000;
  if (billions) parts.push(`${chunkWords(billions, false)} ${plural(billions, ["миллиард", "миллиарда", "миллиардов"])}`);
  if (millions) parts.push(`${chunkWords(millions, false)} ${plural(millions, ["миллион", "миллиона", "миллионов"])}`);
  if (thousands) parts.push(`${chunkWords(thousands, true)} ${plural(thousands, ["тысяча", "тысячи", "тысяч"])}`);
  if (rest) parts.push(chunkWords(rest, false));
  return parts.join(" ");
}

function moneyParts(total) {
  return String(total || "")
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const amount = Number(part.replace(/\D/g, ""));
      const symbol = part.replace(/[\d\s\u00a0]/g, "").trim();
      return { amount, symbol, text: part };
    })
    .filter((part) => Number.isFinite(part.amount));
}

function currencyPhrase(amount, symbol) {
  const words = spellAmount(amount);
  if (!words) return "";
  if (symbol.includes("₸")) return `${words} тенге`;
  if (symbol.includes("$")) return `${words} ${plural(amount, ["доллар", "доллара", "долларов"])}`;
  if (symbol.includes("₽")) return `${words} ${plural(amount, ["рубль", "рубля", "рублей"])}`;
  return symbol ? `${words} ${symbol}` : words;
}

function totalInWords(total) {
  const phrases = moneyParts(total).map((part) => currencyPhrase(part.amount, part.symbol)).filter(Boolean);
  return phrases.join("; ");
}

function logoDataUrl(root) {
  const file = path.join(root, "logo.png");
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return "";
    return `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
  } catch {
    return "";
  }
}

function sellerLines(contacts) {
  const lines = ["Динара · AI Video Creator"];
  const phone = String(contacts?.waPhone || "").replace(/[^\d]/g, "");
  const telegram = String(contacts?.tgUser || "").replace(/^@/, "").trim();
  if (phone) lines.push(`WhatsApp +${phone}`);
  if (telegram) lines.push(`Telegram @${telegram}`);
  return lines;
}

function invoiceHtml(order, contacts, logo) {
  const number = invoiceNumber(order);
  const date = formatDate(order.createdAt);
  const status = STATUSES[order.status] || "Новый";
  const channel = order.channel === "telegram" ? "Telegram" : order.channel === "whatsapp" ? "WhatsApp" : "";
  const items = Array.isArray(order.items) ? order.items : [];
  const rows = items.map((item, index) => {
    const kind = item.kind === "service" ? "услуга" : "товар";
    const title = escapeHtml(item.title || "Без названия");
    const qty = Math.max(1, Math.min(99, Math.floor(Number(item.qty)) || 1));
    return `<tr><td>${index + 1}</td><td>${title}<div class="kind">${kind}</div></td><td class="num">${qty}</td><td class="num">${escapeHtml(item.unitPrice || "—")}</td><td class="num">${escapeHtml(item.lineTotal || item.unitPrice || "—")}</td></tr>`;
  }).join("");
  const tableBody = rows || `<tr><td colspan="5">В заказе нет позиций.</td></tr>`;
  const words = totalInWords(order.total);
  const seller = sellerLines(contacts).map((line) => `<div>${escapeHtml(line)}</div>`).join("");
  const mark = logo
    ? `<img class="logo" src="${logo}" alt="">`
    : `<div class="brand">Динара</div>`;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <title>Счет-фактура ${escapeHtml(number)}</title>
  <style>
    @page { size: A4; margin: 12mm 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #1c1c1c; font-family: Arial, "Segoe UI", sans-serif; font-size: 11pt; }
    header { display: flex; justify-content: space-between; gap: 8mm; align-items: flex-start; margin-bottom: 6mm; }
    .seller { font-size: 10pt; line-height: 1.4; }
    .logo { width: 16mm; height: 16mm; object-fit: contain; display: block; margin-bottom: 2mm; }
    .brand { font-size: 16pt; font-weight: 700; margin-bottom: 2mm; }
    h1 { margin: 0; font-size: 15pt; letter-spacing: 0.04em; text-align: right; }
    .doc-meta { margin: 1.5mm 0 0; text-align: right; font-size: 10pt; color: #333; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin: 4mm 0 5mm; }
    .box { border: 1px solid #222; padding: 3mm 4mm; min-height: 22mm; }
    .box h2 { margin: 0 0 2mm; font-size: 9pt; letter-spacing: 0.08em; text-transform: uppercase; color: #444; }
    .box p { margin: 0; line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #222; padding: 2mm 2.5mm; vertical-align: top; }
    th { font-size: 9pt; text-align: left; background: #f3f3f3; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    .kind { margin-top: 1mm; font-size: 8.5pt; color: #555; }
    .totals { margin-top: 4mm; margin-left: auto; width: 88mm; }
    .totals div { display: flex; justify-content: space-between; gap: 4mm; padding: 1.2mm 0; border-bottom: 1px solid #ccc; }
    .totals strong { font-size: 12pt; }
    .words { margin-top: 3mm; font-size: 10.5pt; line-height: 1.4; }
    .signs { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-top: 12mm; }
    .sign { min-height: 28mm; }
    .sign span { display: block; margin-bottom: 8mm; font-size: 10pt; }
    .line { border-bottom: 1px solid #222; height: 8mm; }
    .hint { margin-top: 1mm; font-size: 8pt; color: #666; }
  </style>
</head>
<body>
  <header>
    <div class="seller">${mark}${seller}</div>
    <div>
      <h1>СЧЕТ-ФАКТУРА</h1>
      <p class="doc-meta">№ ${escapeHtml(number)}${date ? ` от ${escapeHtml(date)}` : ""}<br>Статус: ${escapeHtml(status)}${channel ? ` · ${escapeHtml(channel)}` : ""}</p>
    </div>
  </header>
  <section class="parties">
    <div class="box">
      <h2>Исполнитель</h2>
      <p>${seller}</p>
    </div>
    <div class="box">
      <h2>Заказчик</h2>
      <p>${escapeHtml(order.name || "—")}<br>${escapeHtml(order.phone || "Телефон не указан")}</p>
    </div>
  </section>
  <table>
    <thead>
      <tr>
        <th style="width:10mm">№</th>
        <th>Наименование услуги / товара</th>
        <th class="num" style="width:18mm">Кол-во</th>
        <th class="num" style="width:32mm">Цена</th>
        <th class="num" style="width:34mm">Сумма</th>
      </tr>
    </thead>
    <tbody>${tableBody}</tbody>
  </table>
  <div class="totals">
    <div><span>Итого к оплате</span><strong>${escapeHtml(order.total || "—")}</strong></div>
    <div><span>В том числе НДС</span><span>Без НДС</span></div>
  </div>
  ${words ? `<p class="words">Всего к оплате: ${escapeHtml(words)}.</p>` : ""}
  <section class="signs">
    <div class="sign">
      <span>Исполнитель</span>
      <div class="line"></div>
      <div class="hint">подпись</div>
    </div>
    <div class="sign">
      <span>М.П.</span>
      <div class="line"></div>
      <div class="hint">место печати</div>
    </div>
  </section>
</body>
</html>`;
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    setTimeout(() => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (err) {
        console.error(`PDF счета: не удалось удалить временный профиль ${dir}: ${err?.message || err}`);
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
    console.error(`PDF счета: stderr Chrome/Edge: ${stderr}`);
  }
  return err;
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
      reject(failPrint("Браузер не успел собрать счет", browserStderr(stderrChunks)));
    }, pdfTimeoutMs());
    child.on("error", (err) => {
      clearTimeout(timer);
      const stderr = browserStderr(stderrChunks);
      if (stderr) {
        err.stderr = stderr;
        console.error(`PDF счета: stderr Chrome/Edge: ${stderr}`);
      }
      reject(err);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      const stderr = browserStderr(stderrChunks);
      if (fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 500) {
        if (stderr) console.error(`PDF счета: stderr Chrome/Edge: ${stderr}`);
        resolve();
      } else reject(failPrint(`Браузер завершился с кодом ${code}, счет не создан`, stderr));
    });
  });
}

async function renderOnce(options) {
  const browser = findBrowser();
  if (!browser) throw new Error("Не найден Chrome. Задайте путь в CHROME_PATH.");
  const order = options.order || {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dinara-invoice-"));
  const htmlPath = path.join(dir, "invoice.html");
  const pdfPath = path.join(dir, "invoice.pdf");
  const profileDir = path.join(dir, "profile");
  try {
    fs.writeFileSync(htmlPath, invoiceHtml(order, options.contacts || {}, logoDataUrl(options.root)));
    await printHtml(browser, htmlPath, pdfPath, profileDir);
    return fs.readFileSync(pdfPath);
  } finally {
    removeDir(dir);
  }
}

function renderInvoicePdf(options) {
  const run = queue.then(() => renderOnce(options), () => renderOnce(options));
  queue = run.then(() => {}, () => {});
  return run;
}

module.exports = { renderInvoicePdf, invoiceNumber, totalInWords };

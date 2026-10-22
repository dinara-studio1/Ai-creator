const STOP_WORDS = new Set([
  "для", "про", "или", "как", "что", "это", "мне", "нам", "вам", "нужен", "нужна",
  "нужно", "хочу", "есть", "под", "при", "без", "the", "and", "ролик", "ролики",
  "видео", "сколько", "стоит", "можно", "какой", "какие", "какая",
]);

function normalize(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s+]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function listProducts(products) {
  return (Array.isArray(products) ? products : []).filter(
    (product) => product && typeof product === "object" && String(product.title || "").trim()
  );
}

// В кэше только текст карточки: products.json хранит фото, и держать их в памяти чата незачем.
function slimProducts(products) {
  return listProducts(products).map((product) => ({
    title: String(product.title).replace(/\s+/g, " ").trim(),
    description: String(product.description || ""),
    kind: product.kind === "service" ? "service" : "product",
    amount: product.amount,
    currency: product.currency,
    price: product.price,
  }));
}

function formatCatalog(products, priceText) {
  return listProducts(products)
    .slice(0, 200)
    .map((product) => {
      const title = String(product.title).replace(/\s+/g, " ").trim().slice(0, 120);
      const kind = product.kind === "service" ? "услуга" : "товар";
      let price = "";
      try {
        price = String(priceText(product) || "").trim();
      } catch {
        price = "";
      }
      const desc = String(product.description || "").replace(/\s+/g, " ").trim().slice(0, 80);
      return `- ${title} (${kind}) — ${price || "цена по запросу"}${desc ? `. ${desc}` : ""}`;
    })
    .join("\n");
}

function searchCatalog(products, query, priceText) {
  const q = normalize(query);
  const stems = q
    .split(" ")
    .filter((token) => token.length > 3 && !STOP_WORDS.has(token))
    .map((token) => token.slice(0, Math.max(4, token.length - 2)));
  if (!stems.length) return [];

  return listProducts(products)
    .map((product) => {
      const words = normalize(`${product.title} ${product.description || ""}`).split(" ");
      const score = stems.reduce((sum, stem) => sum + (words.some((word) => word.startsWith(stem)) ? 2 : 0), 0);
      return { product, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ product }) => {
      let price = "";
      try {
        price = String(priceText(product) || "").trim();
      } catch {
        price = "";
      }
      return {
        title: String(product.title).replace(/\s+/g, " ").trim().slice(0, 120),
        description: String(product.description || "").replace(/\s+/g, " ").trim().slice(0, 110),
        price: price || "цена по запросу",
      };
    });
}

module.exports = { formatCatalog, searchCatalog, slimProducts };

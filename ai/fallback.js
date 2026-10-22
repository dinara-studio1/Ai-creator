import { displayPrice } from "../src/lib/money.js";

const STOP_WORDS = new Set([
  "для", "про", "или", "как", "что", "это", "мне", "нам", "вам", "нужен", "нужна",
  "нужно", "хочу", "есть", "под", "при", "без", "the", "and", "ролик", "ролики",
  "видео", "сколько", "стоит", "можно", "какой", "какие", "какая",
]);

function normalize(str) {
  return String(str)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s+]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(q, words) {
  return words.some((word) => q.includes(word));
}

function findProducts(query, catalog) {
  const q = normalize(query);
  const stems = q
    .split(" ")
    .filter((token) => token.length > 3 && !STOP_WORDS.has(token))
    .map((token) => token.slice(0, Math.max(4, token.length - 2)));
  if (!stems.length) return [];
  return catalog
    .map((product) => {
      const words = normalize(`${product.title} ${product.description || ""}`).split(" ");
      const score = stems.reduce((sum, stem) => sum + (words.some((word) => word.startsWith(stem)) ? 2 : 0), 0);
      return { product, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((row) => row.product);
}

function formatCatalogList(catalog) {
  if (!catalog.length) return "Сейчас в каталоге нет готовых пакетов — Динара подберёт формат лично.";
  return catalog.map((product) => `• ${product.title} — ${displayPrice(product)}`).join("\n");
}

function catalogMatches(stems, catalog) {
  return catalog
    .filter((product) => {
      const words = normalize(`${product.title} ${product.description || ""}`).split(" ");
      return stems.some((stem) => words.some((word) => word.startsWith(stem)));
    })
    .slice(0, 3);
}

function topicReply(intro, question, stems, catalog) {
  const cards = catalogMatches(stems, catalog);
  if (!cards.length) return { text: `${intro}\n\n${question}` };
  return { text: `${intro} Подходящее из каталога — ниже.\n\n${question}`, cards };
}

function handoffText(hint, waLink, tgLink) {
  const lead = hint || "Могу передать вас Динаре — она уточнит детали и смету.";
  return `${lead}\n\nWhatsApp: ${waLink}\nTelegram: ${tgLink}`;
}

export function greetingText(chatName) {
  return `Здравствуйте! Я ${chatName}, консультант Динары. Расскажите, какой ролик нужен — подскажу формат.`;
}

export function replyTo(raw, { catalog, chatName, waLink, tgLink }) {
  const text = String(raw || "").trim();
  const q = normalize(text);
  const products = findProducts(text, catalog);

  if (hasAny(q, [
    "whatsapp", "ватсап", "вацап", "телеграм", "telegram", "контакт", "телефон", "номер",
    "связ", "человек", "оператор", "менеджер", "поговори", "созвон", "напиши дина", "свяжи",
  ])) {
    return {
      text: handoffText("Конечно. Напишите Динаре в мессенджер — коротко опишите задачу и желаемый формат.", waLink, tgLink),
    };
  }

  if (hasAny(q, ["заказ", "заказать", "оплат", "корзин", "купить", "оформить", "бриф", "смет"])) {
    return {
      text:
        "Заказать можно через каталог: «Заказать» или корзина откроют WhatsApp или Telegram с готовым текстом.\n\n" +
        "Если формат ещё не выбран — опишите задачу здесь, подскажу что ближе. А когда будете готовы, передам Динаре.",
    };
  }

  if (hasAny(q, ["дети", "детей", "детям", "детьми", "детск", "ребен", "малыш", "школьн", "праздник", "день рожден", "мульт", "сказк"])) {
    return topicReply(
      "Для детского праздника Динара делает ролик, где ребёнок становится героем: день рождения, супергерой или сказка.",
      "Сколько лет ребёнку и какая идея? Подскажу, какой формат лучше.",
      ["детск", "дети", "детей", "мульт", "поздрав", "ребен", "праздн"],
      catalog
    );
  }

  if (hasAny(q, ["подрост", "тикток", "tiktok", "стиль"])) {
    return topicReply(
      "Подростковый формат — про стиль и характер, без «мультиков».",
      "Какая тема и куда выложите — TikTok, Instagram?",
      ["подрост", "трансформ", "тикток", "reels", "рилс"],
      catalog
    );
  }

  if (hasAny(q, ["бизнес", "гастро", "ресторан", "кафе", "бренд", "реклам", "продукт", "коммерч"])) {
    return topicReply(
      "Для бизнеса и гастро Динара собирает ролик, после которого хочется зайти и заказать — без тяжёлой съёмки.",
      "Что продвигаете — кафе, продукт, услугу?",
      ["бизнес", "гастро", "реклам", "презентац", "бренд"],
      catalog
    );
  }

  if (hasAny(q, ["скетч", "сериал", "мини сери", "персонаж"])) {
    return topicReply(
      "Скетчи и мини-сериалы — короткие сценки с персонажем «как клиент»: сомнения, выбор, «брать или нет». Хорошо заходят серией.",
      "Нужен один ролик или сразу мини-серия?",
      ["скетч", "сериал"],
      catalog
    );
  }

  if (hasAny(q, ["цен", "сколько", "стоит", "каталог", "тариф", "прайс"]) || (products.length && hasAny(q, ["reel", "рилс", "stor", "стор", "монтаж", "обучающ"]))) {
    if (products.length === 1) {
      const product = products[0];
      return {
        text: `«${product.title}» в каталоге — ${displayPrice(product)}. ${product.description || "Могу рассказать, чем этот формат отличается от других."}\n\nПод вашу задачу нужен именно этот пакет или что-то индивидуальное?`,
        cards: products,
      };
    }
    if (products.length > 1) {
      return {
        text: "Нашла близкие позиции в каталоге. Могу коротко сравнить — какой формат вам ближе по задаче?",
        cards: products,
      };
    }
    return {
      text: "Ориентиры по готовым пакетам:\n\n" + formatCatalogList(catalog) + "\n\nИндивидуальная смета зависит от объёма. Расскажите задачу — подскажу, с чего начать.",
    };
  }

  if (hasAny(q, ["услуг", "направлен", "что дела", "формат", "работае", "предлага"])) {
    return {
      text:
        "Динара чаще всего делает:\n\n" +
        "• ролики для бизнеса и гастро\n" +
        "• скетчи и мини-сериалы\n" +
        "• детские праздничные истории\n" +
        "• подростковый контент для соцсетей\n\n" +
        "Что ближе вашей задаче?",
    };
  }

  if (hasAny(q, ["привет", "здравств", "добрый", "доброе", "hi", "hello", "хай"])) {
    return { text: `Здравствуйте! Я ${chatName}. Чем помочь — выбрать формат, сориентировать по каталогу или разобрать вашу задачу?` };
  }

  if (hasAny(q, ["кто ты", "о себе", "кто вы", "кто такая"])) {
    return { text: `Я ${chatName}, AI-консультант на сайте Динары. Помогаю выбрать формат AI-видео. Если понадобится личный разговор — тогда уже передам Динаре.` };
  }

  if (hasAny(q, ["спасибо", "благодар", "отлично", "супер", "класс"])) {
    return { text: "Пожалуйста. Если появятся ещё вопросы по формату — пишите сюда." };
  }

  if (products.length) {
    const lead = products.length === 1 ? `Похоже, вам близко «${products[0].title}».` : "Похоже, из каталога вам подойдёт вот это:";
    return { text: `${lead}\n\nМогу рассказать подробнее или помочь сравнить с другими форматами.`, cards: products };
  }

  return { text: "Расскажите чуть конкретнее: для кого ролик, куда выложите и есть ли срок? Подскажу подходящий формат." };
}

export function replyWithAttachments(raw, attachments, ctx) {
  const files = attachments || [];
  if (!files.length) return replyTo(raw, ctx);
  const names = files.map((file) => file.name).join(", ");
  const textFile = files.find((file) => file.kind === "text" && file.text);
  const hasImage = files.some((file) => file.kind === "image");

  if (hasImage && !textFile) {
    return {
      text: `Получила изображение (${names}), но сейчас не могу его подробно разобрать.\n\n` + (raw ? replyTo(raw, ctx).text : "Опишите словами, что на фото и какой ролик хотите — подскажу формат."),
    };
  }

  if (textFile) {
    const snippet = textFile.text.replace(/\s+/g, " ").trim().slice(0, 420);
    return {
      text:
        `Просмотрела файл «${textFile.name}». Кратко: ${snippet}${textFile.text.length > 420 ? "…" : ""}\n\n` +
        (raw ? `По вашему вопросу: ${replyTo(raw, ctx).text}` : "Чем помочь дальше — выбрать формат под этот бриф?"),
    };
  }

  return {
    text: `Получила файл (${names}).\n\n` + (raw ? replyTo(raw, ctx).text : "Кратко опишите, что внутри или какая задача — подскажу формат."),
  };
}

const JPEG_DATA_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

export function historyForApi(messages) {
  const recent = messages.filter((message) => message.role === "user" || message.role === "bot").slice(-10);
  let keepImages = true;
  const mapped = [];
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    const files = message.role === "user" ? message.attachments || [] : [];
    const names = files.map((file) => file.name).filter(Boolean);
    const excerpts = files
      .filter((file) => file.kind === "text" && typeof file.text === "string" && file.text.trim())
      .slice(0, 2)
      .map((file) => `Файл «${file.name}»:\n${file.text.replace(/\s+/g, " ").trim().slice(0, 2000)}`);
    let text = [message.text, excerpts.join("\n\n"), names.length ? `[Вложения: ${names.join(", ")}]` : ""].filter(Boolean).join("\n\n");
    if (message.role === "bot" && message.source === "error" && text) text = `[Ошибка, не ответ модели] ${text}`;
    else if (message.role === "bot" && (message.fallback || message.source === "fallback") && text) text = `[Автоответ без модели] ${text}`;
    const images = keepImages
      ? files.filter((file) => file.kind === "image" && JPEG_DATA_RE.test(file.dataUrl || "")).slice(0, 2)
      : [];
    if (images.length) keepImages = false;
    if (images.length) {
      mapped.push({
        role: message.role === "bot" ? "assistant" : "user",
        content: [
          { type: "text", text: text || "Клиент прислал изображение." },
          ...images.map((file) => ({ type: "image_url", image_url: { url: file.dataUrl, detail: "high" } })),
        ],
      });
    } else if (text) {
      mapped.push({ role: message.role === "bot" ? "assistant" : "user", content: text });
    }
  }
  return mapped.reverse();
}

export function slimCard(product) {
  return {
    title: String(product.title || ""),
    description: String(product.description || "").slice(0, 110),
    price: displayPrice(product),
  };
}

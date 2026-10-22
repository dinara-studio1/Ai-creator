const assert = require("assert");
const { buildUserContent, normalizeAttachments, sanitizeContentParts } = require("./attachments");
const { AiHttpError, isTransientStatus, toolsWereRejected } = require("./client");
const { searchCatalog, slimProducts } = require("./catalog");
const { correctPrices, ensureContactLinks, mentionedCards } = require("./index");
const { runLoop } = require("./loop");
const { loadTools, runTool, toolSchemas } = require("./registry");

const products = [
  { title: "Детский праздник", description: "Ролик ко дню рождения", price: "45 000 ₸" },
  { title: "Гастро-ролик", description: "Для кафе", price: "70 000 ₸" },
];

const tools = loadTools();
const names = tools.map((tool) => tool.name).sort();
assert.deepStrictEqual(names, ["get_contacts", "search_catalog"]);
assert.strictEqual(toolSchemas(tools).length, 2);

const ctx = {
  searchCatalog(query) {
    return searchCatalog(products, query, (product) => product.price);
  },
  contacts() {
    return { whatsapp: "https://wa.me/7700", telegram: "https://t.me/test" };
  },
};

async function checkTools() {
  const found = await runTool(tools, "search_catalog", { query: "детский праздник" }, ctx);
  assert.strictEqual(found.products.length, 1);
  assert.strictEqual(found.products[0].title, "Детский праздник");
  assert.strictEqual(found.products[0].price, "45 000 ₸");

  const broken = await runTool(tools, "search_catalog", null, ctx);
  assert.ok(Array.isArray(broken.products));
  assert.strictEqual(broken.products.length, 0);
  assert.doesNotThrow(() => tools.find((tool) => tool.name === "search_catalog").run(null, ctx));

  const unknown = await runTool(tools, "missing_tool", { query: 1 }, ctx);
  assert.match(unknown.error, /Неизвестная функция/);

  const contacts = await runTool(tools, "get_contacts", { extra: true }, ctx);
  assert.strictEqual(contacts.whatsapp, "https://wa.me/7700");

  const throwing = [{ name: "boom", run() { throw new Error("fail"); } }];
  assert.deepStrictEqual(await runTool(throwing, "boom", {}, ctx), { error: "Функция не выполнилась" });

  const asyncTool = [{ name: "later", async run() { return { products: [{ title: "Позже", description: "", price: "1" }] }; } }];
  assert.strictEqual((await runTool(asyncTool, "later", {}, ctx)).products[0].title, "Позже");

  const slim = slimProducts([{ title: "Детский праздник", description: "текст", image: "data:image/jpeg;base64,AAAA", price: "45 000 ₸" }]);
  assert.strictEqual(slim.length, 1);
  assert.strictEqual(Object.hasOwn(slim[0], "image"), false);

  assert.strictEqual(toolsWereRejected(400, true), true);
  assert.strictEqual(toolsWereRejected(422, true), true);
  assert.strictEqual(toolsWereRejected(401, true), false);
  assert.strictEqual(toolsWereRejected(400, false), false);

  const links = { whatsapp: "https://wa.me/7700", telegram: "https://t.me/test" };
  assert.match(ensureContactLinks("Напишите в WhatsApp.", links), /wa\.me\/7700/);
  assert.strictEqual(ensureContactLinks("Для Telegram и TikTok.", links), "Для Telegram и TikTok.");
  const fixed = ensureContactLinks("WhatsApp: https://wa.me/1", links);
  assert.match(fixed, /https:\/\/wa\.me\/7700/);
  assert.doesNotMatch(fixed, /wa\.me\/1(?!\d)/);
  assert.match(fixed, /t\.me\/test/);
  const foreign = ensureContactLinks("Напишите в WhatsApp: https://example.com/pay", links);
  assert.match(foreign, /example\.com\/pay/);
  assert.match(foreign, /wa\.me\/7700/);

  assert.strictEqual(isTransientStatus(429), false);
  assert.strictEqual(isTransientStatus(502), true);
  assert.strictEqual(isTransientStatus(503), true);
  assert.strictEqual(isTransientStatus(504), true);
  assert.strictEqual(new AiHttpError("rate", { status: 429 }).transient, false);
  assert.strictEqual(new AiHttpError("rate", { status: 429, transient: true, retryAfterMs: 1000 }).retryAfterMs, 1000);
  assert.strictEqual(isTransientStatus(400), false);
  assert.strictEqual(new AiHttpError("busy", { status: 502 }).transient, true);
  assert.strictEqual(new AiHttpError("bad", { status: 400, toolsRejected: true }).transient, false);

  assert.deepStrictEqual(normalizeAttachments([{}, { name: "  " }, null]), []);
  assert.strictEqual(normalizeAttachments([{ name: "brief.txt", kind: "text", text: "привет" }])[0].text, "привет");

  const picked = mentionedCards("Подойдёт детский праздник.", [
    { title: "Детский праздник", description: "", price: "1" },
    { title: "Гастро-ролик", description: "", price: "2" },
  ]);
  assert.deepStrictEqual(picked.map((card) => card.title), ["Детский праздник"]);

  const priced = [
    { title: "Детский праздник", price: "45 000 ₸" },
    { title: "Гастро-ролик", price: "70 000 ₸" },
  ];
  const showPrice = (product) => product.price;
  assert.strictEqual(
    correctPrices("«Детский праздник» стоит 10 000 ₸.", priced, showPrice),
    "«Детский праздник» стоит 45 000 ₸."
  );
  assert.strictEqual(
    correctPrices("«Детский праздник» стоит 70 000 ₸.", priced, showPrice),
    "«Детский праздник» стоит 45 000 ₸."
  );
  assert.strictEqual(
    correctPrices("Детский праздник 70 000 ₸, Гастро-ролик 45 000 ₸.", priced, showPrice),
    "Детский праздник 45 000 ₸, Гастро-ролик 70 000 ₸."
  );
  assert.strictEqual(
    correctPrices("70 000 ₸ за Детский праздник.", priced, showPrice),
    "45 000 ₸ за Детский праздник."
  );
  assert.strictEqual(
    correctPrices("«Детский праздник» стоит 45 тысяч тенге.", priced, showPrice),
    "«Детский праздник» стоит 45 тысяч тенге."
  );
  assert.strictEqual(correctPrices("Смета 99 000 ₸.", priced, showPrice), "Смета по каталогу.");
  assert.strictEqual(
    correctPrices("Детский праздник и Гастро-ролик стоят 10 000 ₸.", priced, showPrice),
    "Детский праздник и Гастро-ролик стоят по каталогу."
  );
}

async function checkLoop() {
  let step = 0;
  const prompts = [];
  const outcome = await runLoop({
    client: {
      async complete({ tools: schemas }) {
        step += 1;
        if (step === 1) {
          assert.ok(schemas);
          return {
            content: "",
            finishReason: "tool_calls",
            toolCalls: [{ id: "call-1", type: "function", function: { name: "search_catalog", arguments: "{\"query\":\"детский\"}" } }],
          };
        }
        assert.ok(schemas);
        return { content: "Подойдёт детский праздник.", toolCalls: [], finishReason: "stop" };
      },
    },
    prompt(includeContacts) {
      prompts.push(includeContacts);
      return includeContacts ? "contacts" : "tools";
    },
    tools,
    schemas: toolSchemas(tools),
    ctx,
    history: [{ role: "user", content: "нужен детский" }],
    timeoutMs: 1000,
  });
  assert.deepStrictEqual(prompts, [false]);
  assert.strictEqual(outcome.reply, "Подойдёт детский праздник.");
  assert.strictEqual(outcome.cards.length, 1);
  assert.strictEqual(outcome.cards[0].title, "Детский праздник");

  const retryPrompts = [];
  const retried = await runLoop({
    client: {
      async complete({ tools: schemas }) {
        if (schemas) throw new AiHttpError("tools unsupported", { status: 400, toolsRejected: true });
        return { content: "Ответ без функций.", toolCalls: [], finishReason: "stop" };
      },
    },
    prompt(includeContacts) {
      retryPrompts.push(includeContacts);
      return "prompt";
    },
    tools,
    schemas: toolSchemas(tools),
    ctx,
    history: [{ role: "user", content: "привет" }],
    timeoutMs: 1000,
  });
  assert.deepStrictEqual(retryPrompts, [false, true]);
  assert.strictEqual(retried.reply, "Ответ без функций.");
  assert.strictEqual(retried.cards.length, 0);

  const plainPrompts = [];
  const plain = await runLoop({
    client: {
      async complete({ tools: schemas }) {
        assert.strictEqual(schemas, null);
        return { content: "Обычный ответ.", toolCalls: [], finishReason: "stop" };
      },
    },
    prompt(includeContacts) {
      plainPrompts.push(includeContacts);
      return "prompt";
    },
    tools: [],
    schemas: [],
    ctx,
    history: [{ role: "user", content: "привет" }],
    timeoutMs: 1000,
  });
  assert.deepStrictEqual(plainPrompts, [true]);
  assert.strictEqual(plain.reply, "Обычный ответ.");

  const circular = {};
  circular.self = circular;
  const survived = await runLoop({
    client: {
      async complete({ messages }) {
        const last = messages[messages.length - 1];
        if (last.role === "tool") {
          assert.doesNotThrow(() => JSON.parse(last.content));
          return { content: "Разобрала.", toolCalls: [], finishReason: "stop" };
        }
        return {
          content: "",
          finishReason: "tool_calls",
          toolCalls: [{ id: "call-round", type: "function", function: { name: "round", arguments: "{\"query\":" + "x".repeat(9000) } }],
        };
      },
    },
    prompt() {
      return "prompt";
    },
    tools: [{ name: "round", run() { return circular; } }],
    schemas: [{ type: "function", function: { name: "round", description: "", parameters: { type: "object", properties: {} } } }],
    ctx,
    history: [{ role: "user", content: "проверка" }],
    timeoutMs: 1000,
  });
  assert.strictEqual(survived.reply, "Разобрала.");

  const jpeg = "data:image/jpeg;base64,/9j/AAAA";
  const seen = [];
  const degraded = await runLoop({
    client: {
      async complete({ tools: schemas, messages }) {
        const blob = JSON.stringify(messages);
        seen.push(blob.includes("image_url"));
        if (schemas || blob.includes("image_url")) {
          throw new AiHttpError("unsupported", { status: 400, toolsRejected: Boolean(schemas) });
        }
        return { content: "Ответила по тексту.", toolCalls: [], finishReason: "stop" };
      },
    },
    prompt(includeContacts) {
      return includeContacts ? "contacts" : "tools";
    },
    tools,
    schemas: toolSchemas(tools),
    ctx,
    history: [{
      role: "user",
      content: [
        { type: "text", text: "что на фото?" },
        { type: "image_url", image_url: { url: jpeg, detail: "high" } },
      ],
    }],
    timeoutMs: 1000,
  });
  assert.deepStrictEqual(seen, [true, true, false]);
  assert.strictEqual(degraded.reply, "Ответила по тексту.");

  let later = 0;
  const recovered = await runLoop({
    client: {
      async complete({ tools: schemas }) {
        later += 1;
        if (later === 1) {
          return {
            content: "",
            finishReason: "tool_calls",
            toolCalls: [{ id: "call-later", type: "function", function: { name: "get_contacts", arguments: "{}" } }],
          };
        }
        if (schemas) throw new AiHttpError("tools unsupported", { status: 400, toolsRejected: true });
        return { content: "Ссылки ниже.", toolCalls: [], finishReason: "stop" };
      },
    },
    prompt() {
      return "prompt";
    },
    tools,
    schemas: toolSchemas(tools),
    ctx,
    history: [{ role: "user", content: "как связаться" }],
    timeoutMs: 1000,
  });
  assert.strictEqual(recovered.reply, "Ссылки ниже.");
}

function checkVision() {
  const jpeg = "data:image/jpeg;base64,/9j/AAAA";
  const content = buildUserContent("что на фото?", [{
    name: "ref.jpg",
    mime: "image/jpeg",
    kind: "image",
    dataUrl: jpeg,
    text: "",
  }]);
  assert.ok(Array.isArray(content));
  assert.strictEqual(content[0].type, "text");
  assert.match(content[0].text, /ref\.jpg/);
  assert.strictEqual(content[1].image_url.url, jpeg);
  assert.strictEqual(content[1].image_url.detail, "high");

  const safe = sanitizeContentParts([
    { type: "text", text: "смотри" },
    { type: "image_url", image_url: { url: "https://evil.example/a.jpg" } },
    { type: "image_url", image_url: { url: jpeg } },
  ]);
  assert.strictEqual(safe.length, 2);
  assert.strictEqual(safe[1].image_url.url, jpeg);
  assert.strictEqual(sanitizeContentParts([{ type: "image_url", image_url: { url: "not-an-image" } }]), null);
}

checkTools().then(checkLoop).then(checkVision).then(() => {
  console.log("ai/check: ok");
}).catch((err) => {
  console.error(err);
  process.exit(1);
});

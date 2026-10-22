module.exports = {
  name: "search_catalog",
  description: "Найти до 3 позиций каталога по запросу клиента. Вызывай, когда советуешь конкретный пакет.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Что ищет клиент: формат, тема или название пакета." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  run(args, ctx) {
    const query = args && typeof args.query === "string" ? args.query : "";
    return { products: ctx.searchCatalog(query) };
  },
};

module.exports = {
  name: "get_contacts",
  description:
    "Получить ссылки WhatsApp и Telegram Динары. Вызывай только если клиент просит контакт, готов заказать или спрашивает, что делать дальше.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  run(_args, ctx) {
    return ctx.contacts();
  },
};

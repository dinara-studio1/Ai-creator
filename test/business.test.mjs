import assert from "node:assert/strict";
import test from "node:test";
import { cartTotalsByCurrency, totalPrice } from "../src/lib/money.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { phoneKey, priceOrderItems, stockShortage, clientIp } = require("../orderPrice.js");

const reel = { id: "p1", title: "Ролик", amount: "5000", currency: "kzt", kind: "service", price: "5 000 ₸" };
const dollar = { id: "p2", title: "Монтаж", amount: "10", currency: "usd", kind: "service", price: "10 $" };

test("корзина считает сумму по валютам и не доверяет строке цены", () => {
  const lines = [
    { product: reel, qty: 2 },
    { product: dollar, qty: 3 },
  ];
  assert.equal(totalPrice(reel, 2), "10 000 ₸");
  assert.deepEqual(cartTotalsByCurrency(lines), ["10 000 ₸", "30 $"]);
});

test("сервер ставит цену из каталога, даже если браузер прислал другую", () => {
  const priced = priceOrderItems([{ id: "p1", qty: 2, unitPrice: "1 ₸" }], [reel]);
  assert.equal(priced.items[0].lineTotal, "10 000 ₸");
  assert.equal(priced.total, "10 000 ₸");
});

test("заказ без услуги из каталога не получает сумму", () => {
  const priced = priceOrderItems([{ id: "gone", qty: 1 }], [reel]);
  assert.equal(priced.error, "Часть товаров уже нет в каталоге. Обновите страницу и проверьте заказ.");
});

test("местный номер 8 7xx приводится к коду страны 7", () => {
  assert.equal(phoneKey("8 700 123 45 67"), "77001234567");
  assert.equal(phoneKey("+7 700 123 45 67"), "77001234567");
});

test("товар сверх остатка не проходит, услуга проходит", () => {
  const goods = { id: "p1", title: "Диск", kind: "product", qty: 3 };
  const service = { id: "s1", title: "Монтаж", kind: "service", qty: 9 };
  const balances = new Map([["p1", 2]]);
  assert.match(stockShortage([goods, service], balances).error, /в наличии 2/);
  assert.equal(stockShortage([{ ...goods, qty: 2 }, service], balances), null);
  assert.equal(stockShortage([goods], new Map()), null);
  assert.match(stockShortage([{ ...goods, qty: 1 }], new Map([["p1", 0]])).error, /нет в наличии/);
});

test("локальный прокси отдаёт адрес клиента, прямой визит — нет", () => {
  assert.equal(clientIp("127.0.0.1", "1.2.3.4, 10.0.0.8", false), "10.0.0.8");
  assert.equal(clientIp("::ffff:127.0.0.1", "9.9.9.9", false), "9.9.9.9");
  assert.equal(clientIp("8.8.8.8", "1.2.3.4", false), "8.8.8.8");
  assert.equal(clientIp("8.8.8.8", "1.2.3.4", true), "1.2.3.4");
});

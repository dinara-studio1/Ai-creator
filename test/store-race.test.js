const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const store = require("../db");

function product(id) {
  return {
    id,
    title: id,
    description: "",
    amount: "1000",
    currency: "kzt",
    kind: "service",
    price: "1 000 ₸",
    image: "",
  };
}

function order(id) {
  return {
    id,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
    name: "Тест",
    phone: "+77000000000",
    channel: "whatsapp",
    total: "1 000 ₸",
    status: "new",
    statusHistory: [{ status: "new", at: "2026-10-15T00:00:00.000Z" }],
    items: [{ id: "p1", title: "Услуга", kind: "service", qty: 1, unitPrice: "1 000 ₸", lineTotal: "1 000 ₸" }],
  };
}

function withStore(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dinara-race-"));
  store.open(dir);
  try {
    run();
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("сохранения заказов и каталога не затирают друг друга", () => {
  withStore(() => {
    store.transaction(() => {
      const orders = store.readOrders();
      orders.unshift(order("a"));
      store.replaceOrders(orders);
    });
    store.transaction(() => {
      const orders = store.readOrders();
      orders.unshift(order("b"));
      store.replaceOrders(orders);
    });
    assert.deepEqual(store.readOrders().map((item) => item.id).sort(), ["a", "b"]);
  });

  withStore(() => {
    store.replaceProducts([product("p1")]);
    const seen = store.productsVersion();
    store.transaction(() => {
      store.replaceProducts([product("p1"), product("p2")]);
    });
    const result = store.transaction(() => {
      if (seen !== store.productsVersion()) return "conflict";
      store.replaceProducts([product("p3")]);
      return "saved";
    });
    assert.equal(result, "conflict");
    assert.deepEqual(store.readProducts().map((item) => item.id), ["p1", "p2"]);
  });
});

test("новый заказ дописывается, не стирая остальные, и получает свой номер", () => {
  withStore(() => {
    store.insertOrder(order("a"));
    store.insertOrder(order("b"));
    const saved = store.readOrders();
    assert.deepEqual(saved.map((item) => item.id).sort(), ["a", "b"]);
    assert.deepEqual(saved.map((item) => item.number).sort(), [1, 2]);
  });
});

test("остаток товара уменьшает только товарный заказ, отмена возвращает его", () => {
  withStore(() => {
    store.replaceProducts([
      { ...product("p1"), kind: "product" },
      { ...product("s1"), kind: "service" },
    ]);
    assert.equal(store.stockBalances().has("p1"), false);
    store.addStockReceipt({
      id: "r1",
      productId: "p1",
      qty: 2,
      note: "",
      createdAt: "2026-10-15T00:00:00.000Z",
    });
    assert.equal(store.stockBalances().get("p1"), 2);
    assert.equal(store.stockBalances().has("s1"), false);
    store.insertOrder({
      ...order("goods"),
      items: [{ id: "p1", title: "Товар", kind: "product", qty: 2, unitPrice: "1 000 ₸", lineTotal: "2 000 ₸" }],
    });
    assert.equal(store.stockBalances().get("p1"), 0);
    store.insertOrder({
      ...order("svc"),
      items: [{ id: "s1", title: "Услуга", kind: "service", qty: 4, unitPrice: "1 000 ₸", lineTotal: "4 000 ₸" }],
    });
    assert.equal(store.stockBalances().get("p1"), 0);
    store.deleteStockReceipt("r1");
    assert.equal(store.stockBalances().has("p1"), true);
    assert.equal(store.stockBalances().get("p1"), -2);
    store.updateOrderStatus("goods", "cancelled", "2026-10-16T00:00:00.000Z");
    assert.equal(store.stockBalances().has("p1"), true);
    assert.equal(store.stockBalances().get("p1"), 0);
  });
});

test("приход услуги не включает учёт, даже если карточку потом сделать товаром", () => {
  withStore(() => {
    store.replaceProducts([{ ...product("s1"), kind: "service" }]);
    store.addStockReceipt({
      id: "rs",
      productId: "s1",
      qty: 10,
      note: "",
      createdAt: "2026-10-15T00:00:00.000Z",
    });
    store.replaceProducts([{ ...product("s1"), kind: "product" }]);
    assert.equal(store.stockBalances().has("s1"), false);
  });
});

test("лимит не пускает сверх нормы и откатывается вместе с заказом", () => {
  withStore(() => {
    const rules = [{ windowMs: 60_000, max: 2 }];
    const first = store.claimRateHit("order", "198.51.100.7", rules);
    const second = store.claimRateHit("order", "198.51.100.7", rules);
    const third = store.claimRateHit("order", "198.51.100.7", rules);
    assert.equal(first.scope, null);
    assert.equal(second.scope, null);
    assert.equal(third.scope, "minute");
    assert.equal(store.rateHits("order", "198.51.100.7", Date.now() - 60_000).length, 2);
    assert.throws(() => {
      store.transaction(() => {
        store.claimRateHit("order", "198.51.100.8", rules);
        throw new Error("rollback");
      });
    });
    assert.equal(store.rateHits("order", "198.51.100.8", Date.now() - 60_000).length, 0);
  });
});

test("лимит заказа переживает закрытие базы", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dinara-rate-"));
  store.open(dir);
  const at = Date.now();
  try {
    store.addRateHit("order", "203.0.113.8", at);
    assert.deepEqual(store.rateHits("order", "203.0.113.8", at - 1000), [at]);
    store.refundRateHit("order", "203.0.113.8", at);
    assert.deepEqual(store.rateHits("order", "203.0.113.8", at - 1000), []);
    store.addRateHit("order", "203.0.113.8", at);
    store.close();
    store.open(dir);
    assert.deepEqual(store.rateHits("order", "203.0.113.8", at - 1000), [at]);
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

import { formatAmount } from "../lib/money";
import { orderNumber } from "../lib/products";
import { replyPhone } from "../lib/phone";

export const ORDER_STATUSES = [
  ["new", "Новый"],
  ["progress", "В работе"],
  ["done", "Готово"],
  ["cancelled", "Отменён"],
];

export function formatOrderDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function orderChannelLabel(channel) {
  return channel === "telegram" ? "Telegram" : "WhatsApp";
}

export function orderStatusLabel(status) {
  return ORDER_STATUSES.find(([value]) => value === status)?.[1] || "Новый";
}

export function replyGreeting(name) {
  const rawName = String(name || "").trim();
  const who = rawName ? rawName.charAt(0).toLocaleUpperCase("ru") + rawName.slice(1) : "";
  const hello = who ? `Здравствуйте, ${who}!` : "Здравствуйте!";
  return `${hello} Это Динара. Напишите, пожалуйста, когда вам удобно обсудить наш проект?`;
}

export function replyLinks(entity) {
  const phone = replyPhone(entity.phone);
  if (!phone) return { wa: "", tg: "" };
  const text = encodeURIComponent(replyGreeting(entity.name));
  return {
    wa: `https://wa.me/${phone}?text=${text}`,
    tg: `https://t.me/+${phone}?text=${text}`,
  };
}

function addTotals(sums, total) {
  String(total || "").split("·").forEach((part) => {
    const amount = Number(part.replace(/\D/g, ""));
    const symbol = part.replace(/[\d\s]/g, "");
    if (amount && symbol) sums[symbol] = (sums[symbol] || 0) + amount;
  });
  return sums;
}

export function formatSums(sums) {
  const parts = Object.entries(sums).map(([symbol, amount]) => `${formatAmount(amount)} ${symbol}`);
  return parts.length ? parts.join(" · ") : "0 ₸";
}

export function orderDoneAt(order) {
  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const entry = history.filter((item) => item.status === "done").pop();
  return entry?.at || order.updatedAt || order.createdAt;
}

export function orderMatchesQuery(order, query) {
  if (!query) return true;
  if (String(order.name || "").toLocaleLowerCase("ru").includes(query)) return true;
  if (orderNumber(order).toLowerCase().includes(query.replace(/^№\s*/, ""))) return true;
  const digits = query.replace(/\D/g, "");
  if (digits.length < 3) return false;
  const phone = String(order.phone || "").replace(/\D/g, "");
  return phone.includes(digits) || phone.includes(digits.replace(/^8/, "7"));
}

export function ordersWord(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "заказ";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "заказа";
  return "заказов";
}

export function revenueOf(orders) {
  const done = orders.filter((order) => order.status === "done");
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  return {
    all: formatSums(done.reduce((sums, order) => addTotals(sums, order.total), {})),
    month: formatSums(done.filter((order) => new Date(orderDoneAt(order)) >= monthStart).reduce((sums, order) => addTotals(sums, order.total), {})),
  };
}

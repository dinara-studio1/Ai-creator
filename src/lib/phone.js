export const PHONE_MIN_DIGITS = 7;
export const PHONE_MAX_DIGITS = 15;

export function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(0, PHONE_MAX_DIGITS);
}

export function formatOrderPhone(value) {
  const digits = phoneDigits(value);
  const local = /^(7|8$|8[79])/.test(digits) && digits.length <= 11;
  const sizes = local ? [1, 3, 3, 2, 2] : [3, 3, 3, 3, 3];
  const parts = [];
  let index = 0;
  sizes.forEach((size) => {
    if (index >= digits.length) return;
    parts.push(digits.slice(index, index + size));
    index += size;
  });
  return parts.join(" ");
}

export function orderPhoneValue(value) {
  let digits = phoneDigits(value);
  if (digits.length === 11 && /^8[79]/.test(digits)) digits = `7${digits.slice(1)}`;
  else if (digits.length === 10 && /^[79]/.test(digits)) digits = `7${digits}`;
  return digits ? `+${digits}` : "";
}

export function replyPhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 11 && /^8[79]/.test(digits)) digits = `7${digits.slice(1)}`;
  else if (digits.length === 10 && /^[79]/.test(digits)) digits = `7${digits}`;
  return digits;
}

function localPhone(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("7")) return `8${d.slice(1)}`;
  return d;
}

export function prettyPhone(digits) {
  const d = localPhone(digits);
  if (d.length !== 11) return d;
  return `${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}`;
}

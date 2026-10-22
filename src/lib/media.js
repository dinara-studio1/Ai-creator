export function isInstagramUrl(url) {
  return /instagram\.com|instagr\.am/i.test(url || "");
}

export function isVideoUrl(url) {
  return /\.(mp4|webm|ogg)(\?|$)/i.test(url || "") || /^data:video\//i.test(url || "");
}

export function safeMediaUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^data:(image|video)\//i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? "" : value;
}

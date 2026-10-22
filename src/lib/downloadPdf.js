export async function downloadCatalogPdf() {
  let res;
  try {
    res = await fetch("/api/catalog.pdf");
  } catch (err) {
    throw new Error(err?.message || "Failed to fetch");
  }
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("pdf")) {
    const raw = await res.text().catch(() => "");
    let message = `Не удалось скачать PDF (HTTP ${res.status}).`;
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (data?.error) message = String(data.error);
      } catch {
        const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 180);
        if (snippet) message = `Не удалось скачать PDF (HTTP ${res.status}): ${snippet}`;
      }
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "dinara-catalog.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

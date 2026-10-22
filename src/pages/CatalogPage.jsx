import { useState } from "react";
import { Link } from "react-router-dom";
import { ProductGrid } from "../components/ProductCard";
import { downloadCatalogPdf } from "../lib/downloadPdf";

export default function CatalogPage() {
  const [pdfError, setPdfError] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);

  async function onDownloadPdf() {
    if (pdfBusy) return;
    setPdfError("");
    setPdfBusy(true);
    try {
      await downloadCatalogPdf();
    } catch (err) {
      setPdfError(err?.message || "Не удалось скачать PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <main className="catalog-page">
      <section className="about catalog-section">
        <div className="about__bg catalog-section__bg" aria-hidden="true">
          <picture>
            <source srcSet="/catalog-bg.webp" type="image/webp" />
            <img src="/catalog-bg.jpg" alt="" width="1920" height="1080" />
          </picture>
        </div>
        <div className="about__inner catalog-inner">
          <div className="catalog-head">
            <div>
              <p className="section-kicker">Каталог</p>
              <h1 className="section-title">Все услуги</h1>
            </div>
            <div className="catalog-head__actions">
              <button type="button" className="btn btn--primary" disabled={pdfBusy} onClick={onDownloadPdf}>
                {pdfBusy ? "Собираем PDF…" : "Скачать PDF"}
              </button>
              <Link className="btn btn--ghost-dark catalog-head__back" to="/">← На главную</Link>
              {pdfError ? <p className="catalog-pdf-error" role="alert">{pdfError}</p> : null}
            </div>
          </div>
          <div className="shop__grid">
            <ProductGrid />
          </div>
        </div>
      </section>
    </main>
  );
}

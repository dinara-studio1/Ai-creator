import { Link } from "react-router-dom";
import { useShop } from "../context/ShopContext";
import { ProductGrid } from "../components/ProductCard";
import { prettyPhone } from "../lib/phone";

const DIRECTIONS = [
  {
    title: "Для бизнеса и гастробрендов",
    text: "Ролик, после которого хочется зайти, заказать и вернуться. Показываю продукт, атмосферу и вкус без съёмочной группы и долгого производства.",
  },
  {
    title: "Скетчи / мини-сериалы",
    text: "Короткие сценки с персонажем, который говорит как клиент: сомнения, выбор, «брать или нет». Запоминается лучше обычной рекламы и легко собирается в серию.",
  },
  {
    title: "Детские праздники",
    text: "Ребёнок становится героем своего мультфильма: день рождения, супергерой или сказка. Ролик, который родители сохраняют и пересылают.",
  },
  {
    title: "Подростковый контент",
    text: "Ролики про стиль, характер и «уже не ребёнок». Не детская сказка и не взрослая реклама — контент, который подростки досматривают до конца.",
  },
];

export default function HomePage() {
  const { products, openContact, site } = useShop();
  const showMore = products.length > 3;
  const waShown = prettyPhone(site.waPhone);

  return (
    <main id="top">
      <div className="stage">
        <div className="stage__visual" aria-hidden="true">
          <picture>
            <source srcSet="/photo.webp" type="image/webp" />
            <img className="stage__photo" src="/photo.jpg" alt="" width="1920" height="1080" decoding="async" fetchPriority="high" />
          </picture>
        </div>
        <section className="hero" aria-label="Главный экран">
          <div className="hero__content wrap">
            <div className="hero__copy">
              <h1 className="hero__headline">
                <span className="hero__brand">Динара</span>
                <span className="hero__role">AI Video Creator</span>
              </h1>
              <p className="hero__lead">
                Воплощаю любые идеи в ИИ-формате —<br />
                от персональных праздников до коммерческого продвижения под ключ.
              </p>
            </div>
            <div className="hero__actions">
              <a className="btn btn--primary" href="#contact" onClick={(event) => { event.preventDefault(); openContact(); }}>Написать мне</a>
              <a className="btn btn--ghost" href="#directions">Смотреть услуги</a>
            </div>
          </div>
        </section>
        <section className="about" id="about">
          <div className="about__bg" aria-hidden="true">
            <picture>
              <source srcSet="/about-bg.webp" type="image/webp" />
              <img src="/about-bg.jpg" alt="" width="1920" height="1080" loading="lazy" />
            </picture>
          </div>
          <div className="about__inner">
            <p className="section-kicker">Обо мне</p>
            <div className="about__grid">
              <h2 className="section-title">Истории, где идея человека<br />встречается с&nbsp;ИИ</h2>
              <div className="about__body">
                <p>Мне 46. Я делаю видео с помощью искусственного интеллекта: от идеи и визуала до готового ролика.</p>
                <p>Важно, чтобы зритель чувствовал смысл, а не «сгенерированный» шаблон — поэтому в каждом кадре оставляю живой характер.</p>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="work directions" id="directions">
        <div className="wrap">
          <p className="section-kicker">Направления</p>
          <h2 className="section-title section-title--wide">Услуги</h2>
          <p className="work__intro">Четыре формата, в которых я работаю чаще всего — от бизнеса до детских и подростковых историй.</p>
          <div className="directions__list">
            {DIRECTIONS.map((item) => (
              <article className="dir-card" key={item.title}>
                <h3 className="dir-card__title">{item.title}</h3>
                <p className="dir-card__text">{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="shop" id="shop">
        <div className="wrap">
          <p className="section-kicker">Каталог</p>
          <h2 className="section-title">Выбери формат</h2>
          <div className="shop__grid">
            <ProductGrid limit={3} />
          </div>
          <div className="shop__more" hidden={!showMore}>
            <Link className="btn btn--primary" to="/catalog">Смотреть все услуги</Link>
          </div>
        </div>
      </section>

      <section className="contact" id="contact">
        <div className="wrap">
          <p className="section-kicker">Контакт</p>
          <h2 className="section-title">Напишите — обсудим ролик</h2>
          <p className="contact__text">Расскажите задачу и аудиторию. Отвечу и предложу простой формат.</p>
          <ul className="contact__list">
            {site.configState === "ready" && site.waPhone && site.tgUser ? (
              <>
                <li>
                  <span>WhatsApp</span>
                  <a href="#contact" onClick={(event) => { event.preventDefault(); openContact(); }}>{waShown}</a>
                </li>
                <li>
                  <span>Telegram</span>
                  <a href="#contact" onClick={(event) => { event.preventDefault(); openContact(); }}>@{site.tgUser}</a>
                </li>
              </>
            ) : (
              <li>
                <span>{site.configState === "loading" ? "Загружаем контакты…" : "Контакты не загрузились"}</span>
              </li>
            )}
          </ul>
        </div>
      </section>
    </main>
  );
}

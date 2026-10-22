# Сайт собирается в первом этапе, во втором остаётся Node и Chromium для PDF.
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.mjs ./
COPY src ./src
COPY ai ./ai
COPY styles.css admin.css ./
RUN npm run build

FROM node:22-bookworm-slim

RUN apt-get -o Acquire::Check-Valid-Until=false -o Acquire::Check-Date=false update \
  && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    DB_FILENAME=dinara.sqlite \
    CHROME_PATH=/usr/bin/chromium \
    CHROME_NO_SANDBOX=true \
    PDF_TIMEOUT_MS=30000

COPY server.js db.js orderPrice.js ./
COPY ai ./ai
COPY pdf ./pdf
COPY styles.css admin.css ./
COPY about-bg.jpg about-bg.webp catalog-bg.jpg catalog-bg.webp ./
COPY photo.jpg photo.webp product-sketches.jpg favicon.png logo.png ./
COPY --from=build /app/dist ./dist

RUN mkdir -p /data /app/uploads

EXPOSE 3000

VOLUME ["/data", "/app/uploads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

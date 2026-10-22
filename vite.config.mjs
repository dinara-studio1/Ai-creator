import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const ASSET_RE = /\.(css|jpe?g|png|webp|gif|svg|mp4|webm|ico|woff2|txt)$/i;

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function externalStyles() {
  return {
    name: "external-styles",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html
          .replaceAll('href="/styles.css"', 'href="__SITE_STYLES__"')
          .replaceAll('href="/admin.css"', 'href="__SITE_ADMIN__"');
      },
    },
  };
}

function restoreStyles() {
  return {
    name: "restore-styles",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return html
          .replaceAll('href="__SITE_STYLES__"', 'href="/styles.css"')
          .replaceAll('href="__SITE_ADMIN__"', 'href="/admin.css"');
      },
    },
  };
}
function siteAssets() {
  return {
    name: "site-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url || "").split("?")[0]);
        if (!ASSET_RE.test(url)) return next();
        const rel = url.replace(/^\/+/, "");
        if (!rel || rel.includes("..") || rel.split("/").some((seg) => seg.startsWith(".") || seg === "src" || seg === "legacy" || seg === "ai" || seg === "node_modules")) {
          return next();
        }
        const file = path.normalize(path.join(root, rel));
        if (!file.startsWith(root + path.sep)) return next();
        fs.stat(file, (err, stat) => {
          if (err || !stat.isFile()) return next();
          res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
          fs.createReadStream(file).pipe(res);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [externalStyles(), siteAssets(), react(), restoreStyles()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/uploads": "http://127.0.0.1:3000",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

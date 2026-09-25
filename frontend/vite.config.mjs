import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const directory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, directory, "");
  if (process.env.VERCEL && environment.REACT_APP_BACKEND_URL?.trim()) {
    throw new Error('Remove REACT_APP_BACKEND_URL on Vercel: use the same-origin /api proxy for session cookies.');
  }
  const version = randomUUID();
  let assets = [];
  const release = {
    name: "fittrack-release", apply: "build",
    transformIndexHtml(html) { return html.replace("</head>", `<meta name="fittrack-version" content="${version}"></head>`); },
    generateBundle(_, bundle) { assets = Object.keys(bundle).filter(name => /\.(js|css)$/.test(name)).map(name => "/" + name); },
    closeBundle() {
      const output = path.join(directory, "build");
      const worker = readFileSync(path.join(directory, "public/service-worker.js"), "utf8")
        .replaceAll("__FITTRACK_BUILD_ID__", version)
        .replace("/* BUILD_ASSETS */ null", JSON.stringify(assets));
      writeFileSync(path.join(output, "service-worker.js"), worker);
      writeFileSync(path.join(output, "version.json"), JSON.stringify({ version }));
    },
  };
  return {
    plugins: [release, react({ include: /src\/.*\.[jt]sx?$/ })],
    resolve: { alias: { "@": path.resolve(directory, "src") } },
    define: {
      __FITTRACK_BUILD_ID__: JSON.stringify(mode === "production" ? version : "development"),
      "process.env.NODE_ENV": JSON.stringify(mode === "production" ? "production" : "development"),
      "process.env.REACT_APP_BACKEND_URL": JSON.stringify(environment.REACT_APP_BACKEND_URL || ""),
    },
    esbuild: { loader: "jsx", include: /src\/.*\.[jt]sx?$/, exclude: [] },
    optimizeDeps: { esbuildOptions: { loader: { ".js": "jsx" } } },
    server: { host: "0.0.0.0", port: 3000, strictPort: true, proxy: { "/api": "http://127.0.0.1:8000" } },
    build: {
      outDir: "build",
      emptyOutDir: true,
      chunkSizeWarningLimit: 650,
    },
  };
});

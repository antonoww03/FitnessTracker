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
  return {
    plugins: [react({ include: /src\/.*\.[jt]sx?$/ })],
    resolve: { alias: { "@": path.resolve(directory, "src") } },
    define: {
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

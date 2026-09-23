const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { JSDOM } = require("jsdom");
const { indexedDB } = require("fake-indexeddb");
const root = path.resolve(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ft-offline-"));
const entry = path.join(root, "tests", ".offline-entry.js");
try {
  fs.writeFileSync(
    entry,
    "import * as offline from '../src/lib/offline'; import axios from 'axios'; window.testing={...offline,axios};",
  );
  execFileSync(
    "npx",
    [
      "--yes",
      "--package=esbuild@0.25.10",
      "esbuild",
      entry,
      "--bundle",
      '--define:process.env.REACT_APP_BACKEND_URL=""',
      `--outfile=${tmp}/bundle.js`,
    ],
    { cwd: root, stdio: "pipe" },
  );
} finally {
  fs.rmSync(entry, { force: true });
}
const dom = new JSDOM("<div></div>", {
  url: "https://test.invalid",
  runScripts: "outside-only",
});
const w = dom.window;
Object.defineProperty(w, "crypto", { value: require("node:crypto").webcrypto });
w.indexedDB = indexedDB;
w.structuredClone = structuredClone;
w.eval(fs.readFileSync(tmp + "/bundle.js", "utf8"));
const api = w.testing;
(async () => {
  api.installOffline();
  api.setOfflineUser({ id: "alice", username: "alice" });
  await api.setOfflineEnabled(true);
  api.axios.defaults.adapter = async (config) => ({
    data: { total: 12 },
    status: 200,
    headers: {},
    config,
  });
  await api.axios.get("/api/summary");
  assert(api.syncStatus().lastUpdated, "Successful summary updates timestamp");
  api.axios.defaults.adapter = async (config) => {
    throw Object.assign(new Error("network"), { config });
  };
  assert.equal((await api.axios.get("/api/summary")).data.total, 12);
  const result = await api.axios.post("/api/water", {
    date: "2026-09-20",
    amount_ml: 250,
  });
  assert.equal(result.status, 202);
  assert(api.syncStatus().errors.length > 0, "Network failure remains visible");
  assert.equal((await api.queue()).length, 1);
  const operation = (await api.queue())[0].config.headers["X-Operation-ID"];
  assert(operation);
  api.setOfflineUser({ id: "bob", username: "bob" });
  await api.setOfflineEnabled(true);
  assert.equal((await api.queue()).length, 0);
  await assert.rejects(api.axios.get("/api/summary"));
  // A delayed response from Alice must never populate Bob's cache.
  api.setOfflineUser({ id: "alice", username: "alice" });
  let release;
  api.axios.defaults.adapter = (config) =>
    new Promise((resolve) => {
      release = () =>
        resolve({ data: { secret: 1 }, status: 200, headers: {}, config });
    });
  const pending = api.axios.get("/api/private");
  await new Promise((r) => setTimeout(r, 0));
  api.setOfflineUser({ id: "bob", username: "bob" });
  release();
  await pending;
  api.axios.defaults.adapter = async (config) => {
    throw Object.assign(new Error("network"), { config });
  };
  await assert.rejects(api.axios.get("/api/private"));
  api.setOfflineUser({ id: "alice", username: "alice" });
  api.axios.defaults.adapter = async (config) => {
    throw Object.assign(new Error("expired"), {
      config,
      response: { status: 401 },
    });
  };
  await api.syncOffline();
  assert.equal((await api.queue()).length, 1);
  api.axios.defaults.adapter = async (config) => {
    assert.equal(config.headers["X-Operation-ID"], operation);
    return { data: { ok: true }, status: 200, headers: {}, config };
  };
  await api.syncOffline();
  assert.equal((await api.queue()).length, 0);
  await api.clearOffline();
  assert.equal(await api.cachedAccount(), undefined);
  console.log(
    "PASS: offline cache, queued writes, account isolation, delayed-response isolation, retry preservation, stable operation ID and cleanup.",
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    dom.window.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

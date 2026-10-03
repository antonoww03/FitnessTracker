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
    "import * as offline from '../src/lib/offline'; import * as diagnostics from '../src/lib/diagnostics'; import * as reads from '../src/lib/reads'; import axios from 'axios'; window.testing={...offline,...diagnostics,...reads,axios};",
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
  let calls = 0, settle;
  api.axios.defaults.adapter = config => {
    calls++;
    return new Promise(resolve => { settle = () => resolve({data:{ok:true},status:200,headers:{},config}); });
  };
  const aborter = new w.AbortController();
  const first = api.read('/api/test-shared', {signal:aborter.signal});
  const cancelled = assert.rejects(first, error => api.axios.isCancel(error));
  const second = api.read('/api/test-shared');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls,1,'Concurrent GETs share one transport');
  aborter.abort(); settle();
  await cancelled;
  assert.equal((await second).data.ok,true,'One caller cannot cancel another');
  const stale = api.read('/api/test-stale');
  const rejected = assert.rejects(stale, error => api.axios.isCancel(error));
  await new Promise(resolve => setTimeout(resolve, 0));
  api.invalidateReads(false); settle(); await rejected;
  let transportSignal;
  api.axios.defaults.adapter = config => {
    transportSignal = config.signal;
    return new Promise((resolve,reject) => config.signal.addEventListener('abort', () => reject(new api.axios.CanceledError())));
  };
  const lastCaller = new w.AbortController();
  const abandoned = api.read('/api/test-abandoned', {signal:lastCaller.signal});
  const abandonedError = assert.rejects(abandoned, error => api.axios.isCancel(error));
  await new Promise(resolve => setTimeout(resolve,0));
  lastCaller.abort(); await abandonedError;
  await new Promise(resolve => setTimeout(resolve,10));
  assert(transportSignal.aborted,'No consumers remain: abort underlying transport');
  console.log('PASS: concurrent GET deduplication, independent cancellation, stale generation rejection');
  api.installOffline();
  api.setOfflineUser({ id: "alice", username: "alice" });
  const enabling = api.setOfflineEnabled(true);
  assert(api.pendingOfflineStorage(), "Update must wait for IndexedDB writes");
  await enabling;
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
  assert.equal((await api.queue())[0].config.headers["X-FitTrack-Owner"], "alice");
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
  const entry = {id:"water-row",kind:"water",date:"2026-09-26",amount_ml:250,_revision:"a".repeat(64)};
  const historyUrl = "/api/history?start=2026-09-26&end=2026-09-26&kind=all";
  api.axios.defaults.adapter = async config => ({data:[entry],status:200,headers:{},config});
  await api.axios.get(historyUrl);
  const offline = async config => { throw Object.assign(new Error("network"),{config}); };
  api.axios.defaults.adapter = offline;
  let edited = await api.axios.put("/api/entries/water/water-row", {date:entry.date,amount_ml:500}, {offlineEntry:entry});
  assert.equal(edited.status,202);
  assert.equal((await api.queue())[0].config.method,"put");
  assert.equal((await api.queue())[0].config.headers["If-Match"],entry._revision);
  let view = (await api.axios.get(historyUrl)).data[0];
  assert.equal(view.amount_ml,500); assert(view.queued);
  const paged = await api.axios.get(historyUrl, {params:{limit:100,offset:0}});
  assert.equal(paged.data[0].amount_ml,500);
  assert(paged.data[0].queued, "Legacy offline cache preserves pending edit overlays");
  assert.equal((await api.axios.get(historyUrl,{params:{limit:100,offset:100}})).data.length,0);

  api.axios.defaults.adapter = async config => {throw Object.assign(new Error("conflict"),{config,response:{status:409,data:{detail:"Entry changed"}}});};
  await api.syncOffline();
  assert.equal((await api.queue()).length,1);
  assert.equal((await api.queue())[0].error,"Entry changed");
  api.axios.defaults.adapter = async config => ({data:{...entry,amount_ml:500,_revision:"b".repeat(64)},status:200,headers:{},config});
  await api.syncOffline();
  assert.equal((await api.queue()).length,0);
  api.axios.defaults.adapter = offline;
  view=(await api.axios.get(historyUrl)).data[0];
  assert.equal(view.amount_ml,500); assert.equal(view._revision,"b".repeat(64));
  await api.axios.delete("/api/entries/water/water-row", {offlineEntry:view});
  assert.equal((await api.queue())[0].config.method,"delete");
  assert.equal((await api.axios.get(historyUrl)).data[0].pendingAction,"Pending deletion");
  await api.discardQueued((await api.queue())[0].key);
  assert.equal((await api.axios.get(historyUrl)).data[0].queued,undefined);
  await api.axios.delete("/api/entries/water/water-row", {offlineEntry:view});
  api.axios.defaults.adapter = async config => ({data:{undo_token:"undo"},status:200,headers:{},config});
  await api.syncOffline();
  api.axios.defaults.adapter = offline;
  assert.equal((await api.axios.get(historyUrl)).data.length,0);
  await assert.rejects(api.axios.put("/api/entries/water/legacy", {amount_ml:1}), /History online/);
  // New rows use application-level preconditions before transport, not CDN If-Match.
  const modern = {...entry,_revision_header:"X-FitTrack-Revision"};
  api.axios.defaults.adapter = async config => {
    assert.equal(config.headers["X-FitTrack-Revision"],modern._revision);
    assert.equal(config.headers["If-Match"],undefined);
    return {data:{undo_token:"modern"},status:200,headers:{},config};
  };
  await api.axios.delete("/api/entries/water/water-row", {offlineEntry:modern});
  api.axios.defaults.adapter = offline;
  await api.axios.delete("/api/entries/water/water-row", {offlineEntry:modern});
  assert.equal((await api.queue())[0].config.headers["X-FitTrack-Revision"],modern._revision);
  await api.discardQueued((await api.queue())[0].key);
  // Persist a legacy item, then upgrade only its header after capability discovery.
  await api.axios.delete("/api/entries/water/water-row", {offlineEntry:entry});
  const legacyOperation = (await api.queue())[0].config.headers["X-Operation-ID"];
  let replayed = false;
  api.axios.defaults.adapter = async config => {
    if (config.method === "get") return {data:{entry_revision_header:"X-FitTrack-Revision"},status:200,headers:{},config};
    assert.equal(config.headers["If-Match"],undefined);
    assert.equal(config.headers["X-FitTrack-Revision"],entry._revision);
    assert.equal(config.headers["X-Operation-ID"],legacyOperation);
    replayed = true;
    return {data:{undo_token:"legacy"},status:200,headers:{},config};
  };
  await api.syncOffline();
  assert(replayed); assert.equal((await api.queue()).length,0);
  console.log("PASS: proxy-safe revision header, modern queue and legacy replay migration");
  const events=[];
  w.fetch = async (url,options) => {events.push({url,body:JSON.parse(options.body)});return {};};
  api.installDiagnostics();
  w.dispatchEvent(new w.ErrorEvent("error", {message:"SECRET health data",filename:"https://example.invalid/private"}));
  w.dispatchEvent(new w.ErrorEvent("error", {message:"other secret"}));
  api.reportDiagnostic("api",500,"a".repeat(32));
  assert.equal(events.length,2);
  assert(!JSON.stringify(events).includes("SECRET"));
  assert.deepEqual(Object.keys(events[0].body).sort(),["kind","release","status"]);
  for(let code=501;code<520;code++) api.reportDiagnostic("api",code);
  assert.equal(events.length,10,"Diagnostics are capped per page");
  console.log("PASS: offline edits/deletes, conflict retention, atomic cache acknowledgement, cancel pending deletion, privacy-safe diagnostics and cap");
  api.setOfflineUser({ id: "bob", username: "bob" });
  await api.setOfflineEnabled(true);
  w.localStorage.setItem("offline-enabled:alice", "1");
  await api.clearOffline("alice");
  assert.equal(w.localStorage.getItem("offline-enabled:alice"), null);
  assert.equal(w.localStorage.getItem("offline-enabled:bob"), "1");
  assert.equal((await api.cachedAccount()).id, "bob", "Alice cleanup must preserve Bob cached account");
  await api.clearOffline();
  assert.equal(await api.cachedAccount(), undefined);
  assert.equal(api.pendingOfflineStorage(), false);
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

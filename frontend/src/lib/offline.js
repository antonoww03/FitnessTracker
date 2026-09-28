import { invalidateReads, isReadCurrent } from "./reads";
import axios from "axios";
import { storage } from "./i18n";
let user = null,
  working = false,
  clearing = false;
let storageOperations = 0;
export const pendingOfflineStorage = () => storageOperations > 0 || clearing;
const failures = new Map();
export const syncStatus = () => ({
  working,
  errors: [...failures.values()],
  lastUpdated: user ? storage.get(`fittrack-updated:${user.id}`) : null,
});
const listeners = new Set();
export const offlineChanged = () => listeners.forEach((f) => f());
export function subscribeOffline(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const openDB = () =>
  new Promise((resolve, reject) => {
    const r = indexedDB.open("fittrack-offline-v1", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("items", { keyPath: "key" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
async function transaction(action) {
  storageOperations++;
  let db;
  try {
    db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("items", "readwrite"),
        r = action(tx.objectStore("items"));
      let result;
      r.onsuccess = () => {
        result = r.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db?.close();
    storageOperations--;
  }
}
let lastCacheCleanup = 0;
const put = (key, value) => transaction((s) => {
  const request = s.put({key, value, storedAt: Date.now()});
  if (key.includes(":cache:") && Date.now() - lastCacheCleanup > 60000) {
    const all = s.getAll();
    all.onsuccess = () => {
      const rows = all.result;
      const queuedOwners = new Set(rows.filter(row => row.key.includes(":queue:")).map(row => row.key.split(":")[0]));
      const caches = rows.filter(row => row.key.includes(":cache:") && !queuedOwners.has(row.key.split(":")[0]))
        .sort((a,b) => (b.storedAt || 0) - (a.storedAt || 0));
      caches.forEach((row,index) => {
        if (index >= 250 || (row.storedAt || 0) < Date.now() - 30*86400000) s.delete(row.key);
      });
      lastCacheCleanup = Date.now();
    };
  }
  return request;
});
const get = async (key) => (await transaction((s) => s.get(key)))?.value;
const remove = (key) => transaction((s) => s.delete(key));
const enabled = () =>
  !clearing && user && storage.get(`offline-enabled:${user.id}`) === "1";
export const offlineEnabled = () => Boolean(enabled());
export async function setOfflineEnabled(value) {
  if (!user) return;
  storage.set(`offline-enabled:${user.id}`, value ? "1" : "0");
  if (value) {
    try {
      await put("account", user);
    } catch (e) {
      storage.set(`offline-enabled:${user.id}`, "0");
      throw e;
    }
  } else await clearOffline();
  offlineChanged();
}
export function setOfflineUser(value) {
  if (user?.id !== value?.id) { failures.clear(); invalidateReads(false); }
  user = value;
  if (enabled()) put("account", value).catch(() => {});
  offlineChanged();
}
export async function cachedAccount() {
  try {
    return await get("account");
  } catch {
    return null;
  }
}
export async function clearOffline(ownerId = user?.id) {
  const previous = ownerId ? { id: ownerId } : null;
  clearing = true;
  failures.clear();
  if (previous) {
    storage.set(`fittrack-updated:${previous.id}`, "");
    storage.remove(`offline-enabled:${previous.id}`);
  }
  try {
    const db = await openDB();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction("items", "readwrite");
        const store = tx.objectStore("items");
        const request = store.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          const row = cursor.value;
          if ((row.key === "account" && row.value?.id === ownerId) ||
              (ownerId && row.key.startsWith(ownerId + ":"))) cursor.delete();
          cursor.continue();
        };
        tx.oncomplete = resolve;
        tx.onerror = tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  } finally {
    clearing = false;
    offlineChanged();
  }
}

export async function queue() {
  const owner = user?.id;
  if (!owner) return [];
  try {
    return (await transaction((s) => s.getAll()))
      .filter((r) => r.key.startsWith(owner + ":queue:"))
      .map((r) => ({ ...r.value, key: r.key }))
      .sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}
export async function discardQueued(key) {
  if (working) return;
  if (user && key.startsWith(user.id + ":queue:")) {
    await remove(key);
    offlineChanged();
  }
}
const urlFor = (config) => {
  const url = new URL(config.url, location.origin);
  for (const [k, v] of Object.entries(config.params || {}))
    url.searchParams.set(k, v);
  url.searchParams.sort();
  return url.pathname + url.search;
};
const creatable = (config) =>
  config.method?.toLowerCase() === "post" &&
  /^\/(?:api\/)?(food|water|weight|training)$/.test(
    new URL(config.url, location.origin).pathname,
  );
const editable = config => ["put", "delete"].includes(config.method?.toLowerCase()) &&
  /^\/(?:api\/)?entries\/(food|water|weight|training)\/[^/]+$/.test(new URL(config.url, location.origin).pathname);
const writable = config => creatable(config) || editable(config);
async function historyOverlay(config, data) {
  if (!Array.isArray(data) || !new URL(config.url, location.origin).pathname.endsWith("/history")) return data;
  const pending = await queue();
  if (config.offlineOwner !== user?.id) throw new Error("Account changed; sync stopped");
  return data.map(row => {
    const item = pending.find(item => item.entry?.id === row.id && item.entry?.kind === row.kind);
    return item ? {...row, ...(item.config.method === "put" ? item.config.data : {}), queued: true,
      pendingAction: item.config.method === "delete" ? "Pending deletion" : "Pending edit"} : row;
  });
}
async function completeQueued(item, response, owner) {
  // Persist the confirmed History view before removing its pending overlay.
  // These writes commit together, including after a lost-response replay.
  storageOperations++;
  let db;
  try {
    db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("items", "readwrite"), store = tx.objectStore("items");
      const request = store.getAll();
      request.onsuccess = () => {
        if (user?.id !== owner || clearing) { tx.abort(); return; }
        if (item.entry) for (const row of request.result) {
          if (!row.key.startsWith(owner + ":cache:/api/history?") || !Array.isArray(row.value)) continue;
          row.value = row.value.flatMap(value => {
            if (value.id !== item.entry.id || value.kind !== item.entry.kind) return [value];
            return item.config.method === "delete" ? [] : [{...response.data, kind:item.entry.kind}];
          });
          store.put(row);
        }
        store.delete(item.key);
      };
      tx.oncomplete = resolve;
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("Account changed; sync stopped"));
    });
  } finally { db?.close(); storageOperations--; }
}
export async function syncOffline() {
  if (working || clearing || !user || !navigator.onLine) return;
  working = true;
  offlineChanged();
  const owner = user.id;
  try {
    for (const item of await queue()) {
      if (user?.id !== owner || clearing) break;
      try {
        const response = await axios.request({
          ...item.config,
          skipOffline: true,
          expectedOwner: owner,
        });
        await completeQueued(item, response, owner);
      } catch (e) {
        if (user?.id !== owner || clearing) break;
        await put(item.key, {
          ...item,
          error:
            e.response?.status === 401
              ? "Sign in to sync"
              : e.response?.data?.detail || "Sync paused; retry when connected",
        });
        break;
      }
    }
  } finally {
    working = false;
    offlineChanged();
    window.dispatchEvent(new Event("fittrack-synced"));
  }
}
let installed = false;
export function installOffline() {
  if (installed) return;
  installed = true;
  axios.interceptors.request.use((config) => {
    if (config.expectedOwner && config.expectedOwner !== user?.id)
      throw new Error("Account changed; sync stopped");
    config.offlineOwner = user?.id;
    // Cookies are shared across tabs; the server must verify the intended owner.
    if (user && !/\/auth\/(login|register|reset-password)$/.test(config.url)) config.headers["X-FitTrack-Owner"] = user.id;
    if (writable(config) && !config.headers["X-Operation-ID"])
      config.headers["X-Operation-ID"] = crypto.randomUUID
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("");
    if (editable(config) && config.offlineEntry?._revision)
      config.headers["If-Match"] = config.offlineEntry._revision;
    return config;
  });
  axios.interceptors.response.use(
    async (response) => {
      const config = response.config;
      if (!isReadCurrent(config)) throw new axios.CanceledError();
      if (
        config.offlineOwner === user?.id &&
        user &&
        !config.url.includes("/auth/")
      ) {
        failures.delete(config.url);
        if (
          config.method === "get" &&
          new URL(config.url, location.origin).pathname.endsWith("/summary")
        )
          storage.set(`fittrack-updated:${user.id}`, new Date().toISOString());
        offlineChanged();
      }
      if (
        enabled() &&
        config.offlineOwner === user.id &&
        config.method === "get" &&
        !config.url.includes("/auth/") &&
        !config.responseType
      ) {
        try {
          await put(user.id + ":cache:" + urlFor(config), response.data);
        } catch {}
      }
      if (enabled() && config.offlineOwner === user.id && config.method === "get")
        response.data = await historyOverlay(config, response.data);
      return response;
    },
    async (error) => {
      if (axios.isCancel(error)) return Promise.reject(error);
      const config = error.config;
      if (
        config &&
        user &&
        config.offlineOwner === user.id &&
        !config.url.includes("/auth/")
      ) {
        failures.set(
          config.url,
          typeof error.response?.data?.detail === "string"
            ? error.response.data.detail
            : "Could not sync. Retry when connected.",
        );
        offlineChanged();
      }
      if (
        !config ||
        config.skipOffline ||
        !enabled() ||
        config.offlineOwner !== user.id ||
        error.response
      )
        return Promise.reject(error);
      if (writable(config)) {
        if (editable(config) && (!config.headers["If-Match"] || !config.offlineEntry))
          return Promise.reject(new Error("Open History online once before editing offline."));
        const id = config.headers["X-Operation-ID"];
        const data =
          typeof config.data === "string"
            ? JSON.parse(config.data)
            : config.data;
        const entry = {
          config: {
            url: config.url,
            method: config.method,
            headers: { "X-Operation-ID": id, "X-FitTrack-Owner": config.offlineOwner, ...(config.headers["If-Match"] ? {"If-Match": config.headers["If-Match"]} : {}) },
            data,
          },
          entry: config.offlineEntry,
          time: Date.now(),
        };
        try {
          await put(user.id + ":queue:" + id, entry);
          offlineChanged();
          return {
            data: { ...data, id: config.offlineEntry?.id || "offline-" + id, queued: true },
            status: 202,
            config,
          };
        } catch {
          return Promise.reject(
            new Error("Offline storage unavailable; entry not saved"),
          );
        }
      }
      if (config.method === "get") {
        try {
          const data = await get(user.id + ":cache:" + urlFor(config));
          if (data !== undefined && !clearing && config.offlineOwner === user?.id)
            return { data: await historyOverlay(config, data), status: 200, config, offline: true };
        } catch {}
      }
      return Promise.reject(error);
    },
  );
  window.addEventListener("online", syncOffline);
}

// Unlike queue(), fail closed on storage errors before a requested app reload.
export async function pendingOfflineUpdates() {
  if (!user) return false;
  const owner = user.id;
  const items = await transaction(store => store.getAll());
  return user?.id !== owner || items.some(row => row.key.startsWith(owner + ":queue:"));
}

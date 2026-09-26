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
const put = (key, value) => transaction((s) => s.put({ key, value }));
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
  if (user?.id !== value?.id) failures.clear();
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
  if (previous) storage.set(`fittrack-updated:${previous.id}`, "");
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
const writable = (config) =>
  config.method?.toLowerCase() === "post" &&
  /^\/(?:api\/)?(food|water|weight|training)$/.test(
    new URL(config.url, location.origin).pathname,
  );
export async function syncOffline() {
  if (working || clearing || !user || !navigator.onLine) return;
  working = true;
  offlineChanged();
  const owner = user.id;
  try {
    for (const item of await queue()) {
      if (user?.id !== owner || clearing) break;
      try {
        await axios.request({
          ...item.config,
          skipOffline: true,
          expectedOwner: owner,
        });
        await remove(item.key);
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
    return config;
  });
  axios.interceptors.response.use(
    async (response) => {
      const config = response.config;
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
        const id = config.headers["X-Operation-ID"];
        const data =
          typeof config.data === "string"
            ? JSON.parse(config.data)
            : config.data;
        const entry = {
          config: {
            url: config.url,
            method: "post",
            headers: { "X-Operation-ID": id, "X-FitTrack-Owner": config.offlineOwner },
            data,
          },
          time: Date.now(),
        };
        try {
          await put(user.id + ":queue:" + id, entry);
          offlineChanged();
          return {
            data: { ...data, id: "offline-" + id, queued: true },
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
            return { data, status: 200, config, offline: true };
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

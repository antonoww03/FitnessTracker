import axios from "axios";
import { useEffect, useState } from "react";
const pending = new Map();
let generation = 0;
let notification;
export const isReadCurrent = config => config.readGeneration === undefined || config.readGeneration === generation;
export function invalidateReads(notify = true) {
  generation++;
  for (const item of pending.values()) item.controller.abort();
  pending.clear();
  if (notify) {
    clearTimeout(notification);
    notification = setTimeout(() => window.dispatchEvent(new Event("fittrack-data-changed")), 0);
  }
}
export function useDataRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const update = () => setRevision(value => value + 1);
    window.addEventListener("fittrack-data-changed", update);
    window.addEventListener("fittrack-synced", update);
    return () => {
      window.removeEventListener("fittrack-data-changed", update);
      window.removeEventListener("fittrack-synced", update);
    };
  }, []);
  return revision;
}
// Share only concurrent reads, never completed responses or mutation requests.
// Each caller owns its cancellation; the transport ends when no callers remain.
export function read(url, config = {}) {
  if (config.signal?.aborted) return Promise.reject(new axios.CanceledError());
  const version = generation;
  const key = JSON.stringify([version, axios.getUri({url, params: config.params}), config.responseType || "json"]);
  let item = pending.get(key);
  if (!item) {
    const controller = new AbortController();
    item = { controller, users: 0 };
    item.promise = axios.get(url, {...config, signal: controller.signal, readGeneration: version}).finally(() => {
      if (pending.get(key) === item) pending.delete(key);
    });
    pending.set(key, item);
  }
  clearTimeout(item.timer);
  item.users++;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      config.signal?.removeEventListener("abort", abort);
      item.users--;
      if (!item.users) item.timer = setTimeout(() => {
        item.controller.abort();
        if (pending.get(key) === item) pending.delete(key);
      }, 0);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(new axios.CanceledError());
    config.signal?.addEventListener("abort", abort, {once:true});
    item.promise.then(response => finish(version !== generation ? new axios.CanceledError() : null, response), error => finish(error));
  });
}

import React, { useEffect, useState } from "react";
import { hasDrafts } from "@/lib/drafts";
import { pendingOfflineUpdates, pendingOfflineStorage, syncStatus } from "@/lib/offline";
import { pendingRequests } from "@/lib/api";
import { t } from "@/lib/i18n";

const current = typeof __FITTRACK_BUILD_ID__ === "string" ? __FITTRACK_BUILD_ID__ : "development";
async function fresh(url, read) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("Deployment unavailable");
    return await read(response);
  }
  finally { clearTimeout(timer); }
}
function draftsPending() {
  const event = new Event("fittrack-before-update", { cancelable: true });
  window.dispatchEvent(event);
  return hasDrafts() || event.defaultPrevented;
}
export function AppUpdate() {
  const [available, setAvailable] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (current === "development") return;
    let active = true, checking = false, registration;
    async function check() {
      if (!active || checking || document.visibilityState === "hidden" || !navigator.onLine) return;
      checking = true;
      try {
        const data = await fresh("/version.json", response => response.json());
        if (active && typeof data.version === "string" && data.version) setAvailable(data.version !== current);
        await registration?.update();
      } catch { /* Offline or a failed deployment must not interrupt the app. */ }
      finally { checking = false; }
    }
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/service-worker.js", { updateViaCache: "none" })
        .then(r => { registration = r; if (active) check(); }).catch(() => {});
    }
    check();
    const timer = setInterval(check, 5 * 60 * 1000);
    window.addEventListener("online", check);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("online", check);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  async function blocked() {
    const queued = await pendingOfflineUpdates();
    if (draftsPending()) { setMessage("Save or discard your changes before updating."); return true; }
    if (queued || pendingOfflineStorage() || syncStatus().working || pendingRequests()) {
      setMessage("Wait for saving and offline sync to finish before updating."); return true;
    }
    return false;
  }
  async function refresh() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (await blocked()) return;
      if (!navigator.onLine) { setMessage("Connect to the internet before updating."); return; }
      const html = await fresh("/", response => {
        if (!response.headers.get("content-type")?.includes("text/html")) throw new Error();
        return response.text();
      });
      if (!html.includes('name="fittrack-version"')) throw new Error();
      // Inputs or writes may have changed while the network request was pending.
      if (await blocked()) return;
      window.location.reload();
    } catch { setMessage("Update unavailable. Please try again when online."); }
    finally { setBusy(false); }
  }
  if (!available) return null;
  return <aside className="ft-update-banner" aria-label={t("Application update")}>
    <p role="status">{t("A new version is available.")}</p>
    <button className="ft-primary" type="button" disabled={busy} onClick={refresh}>{t(busy ? "Checking…" : "Update now")}</button>
    {message && <p role="alert">{t(message)}</p>}
  </aside>;
}

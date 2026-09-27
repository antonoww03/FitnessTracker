import React, { useEffect, useState, useSyncExternalStore } from "react";
import axios from "axios";
import { API } from "@/lib/api";
import { connectionSnapshot, subscribeConnection, connectionRecovered } from "@/lib/connection";
import { t } from "@/lib/i18n";

export function ConnectionStatus() {
  const state = useSyncExternalStore(subscribeConnection, connectionSnapshot);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [checking, setChecking] = useState(false);
  const [recovered, setRecovered] = useState(false);
  useEffect(() => {
    const update = () => { setOffline(!navigator.onLine); setRecovered(false); };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => {
    if (!recovered) return;
    const timer = setTimeout(() => setRecovered(false), 7000);
    return () => clearTimeout(timer);
  }, [recovered]);
  async function retry() {
    setChecking(true);
    setRecovered(false);
    try {
      // Probe only: never replay a write or reload/unmount the user's form.
      await axios.get(`${API}/auth/me`, { skipOffline: true });
      connectionRecovered(); setRecovered(true);
    } catch (error) {
      if (error.response?.status === 401) { connectionRecovered(); setRecovered(true); }
    } finally { setChecking(false); }
  }
  if (!offline && !state.slow && !state.failed && !checking && !recovered) return null;
  const message = offline ? "You are offline. Keep this page open to preserve your input."
    : checking ? "Checking connection…"
    : state.slow ? "The server is taking longer than usual. Startup may take about a minute. Keep this page open."
    : state.failed ? "Connection interrupted. Your form has not been reloaded."
    : "Connection restored. Retry the failed action in its form; pending offline changes sync separately.";
  return <aside className="ft-connection" aria-label={t("Connection status")}>
    <p role="status" aria-live="polite">{t(message)}</p>
    {(offline || state.failed) && <>
      <p className="ft-muted">{t("This checks the connection only; it does not submit your data again.")}</p>
      <button type="button" className="ft-secondary" onClick={retry} disabled={checking || state.pending > 0 || offline}>{t(checking ? "Checking connection…" : "Retry")}</button>
    </>}
  </aside>;
}

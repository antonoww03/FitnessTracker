import React, { useState, useEffect } from "react";
import axios from "axios";
import { API, errorMessage } from "@/lib/api";
import { t, storage } from "@/lib/i18n";
import { toast } from "sonner";
import {
  installOffline,
  setOfflineUser,
  cachedAccount,
  clearOffline,
  queue,
  syncOffline,
} from "@/lib/offline";
installOffline();
export function Account({ children }) {
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [mode, setMode] = useState("login"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [recovery, setRecovery] = useState("");
  function accept(data) {
    const account = { id: data.id, username: data.username };
    setOfflineUser(account);
    setUser(account);
    syncOffline();
    if (data.recovery_code) setRecovery(data.recovery_code);
  }
  useEffect(() => {
    axios
      .get(`${API}/auth/me`)
      .then((r) => {
        accept(r.data);
        syncOffline();
      })
      .catch(async (e) => {
        // Browsers can briefly report navigator.onLine=true after the network
        // has disappeared. A request without an HTTP response is the reliable
        // signal that the saved offline account should be used.
        if (!e.response) {
          const cached = await cachedAccount();
          if (cached && storage.get(`offline-enabled:${cached.id}`) === "1") {
            accept(cached);
            return;
          }
        }
        if (e.response?.status !== 401)
          setError(errorMessage(e, "Could not connect. Reload to retry."));
      })
      .finally(() => setLoading(false));
    const id = axios.interceptors.response.use(
      (r) => r,
      (e) => {
        if (e.response?.status === 401 && !e.config?.skipOffline) {
          setUser(null);
          setOfflineUser(null);
        }
        return Promise.reject(e);
      },
    );
    return () => axios.interceptors.response.eject(id);
  }, []);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (mode === "reset") {
        await axios.post(`${API}/auth/reset-password`, body);
        setMode("login");
        setError(
          t("Password reset. Sign in and generate a new recovery code."),
        );
      } else accept((await axios.post(`${API}/auth/${mode}`, body)).data);
    } catch (err) {
      setError(errorMessage(err, t("Could not sign in")));
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <div className="ft-app ft-auth">{t("Loading…")}</div>;
  if (recovery)
    return (
      <div className="ft-app ft-auth">
        <section className="ft-card ft-form">
          <h2>{t("Save your recovery code")}</h2>
          <p>
            {t(
              "Save this code privately. It replaces email recovery and can reset your password once.",
            )}
          </p>
          <output className="ft-recovery-code">{recovery}</output>
          <button className="ft-primary" onClick={() => setRecovery("")}>
            {t("I saved my code")}
          </button>
        </section>
      </div>
    );
  if (!user)
    return (
      <div className="ft-app ft-auth">
        <form className="ft-card ft-form" onSubmit={submit} key={mode}>
          <h1>FitTrack</h1>
          <h2>
            {t(
              mode === "register"
                ? "Create account"
                : mode === "reset"
                  ? "Reset password"
                  : "Sign in",
            )}
          </h2>
          <label>
            {t("Username")}
            <input
              required
              name="username"
              autoComplete="username"
              minLength="3"
              maxLength="40"
              pattern="[A-Za-z0-9_.-]+"
            />
          </label>
          {mode === "reset" && (
            <label>
              {t("Recovery code")}
              <input
                required
                name="recovery_code"
                autoComplete="off"
                minLength="20"
                maxLength="200"
              />
            </label>
          )}
          <label>
            {t(mode === "reset" ? "New password" : "Password")}
            <input
              required
              type="password"
              name="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              minLength="12"
              maxLength="128"
            />
          </label>
          <p className="ft-muted">
            {t("Use a unique password of at least 12 characters.")}
          </p>
          {error && <p role="alert">{error}</p>}
          <button className="ft-primary" disabled={busy}>
            {t(
              mode === "register"
                ? "Create account"
                : mode === "reset"
                  ? "Reset password"
                  : "Sign in",
            )}
          </button>
          <button
            type="button"
            className="ft-secondary"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
            }}
          >
            {t(mode === "login" ? "Create account" : "Sign in")}
          </button>
          {mode === "login" && (
            <button
              className="ft-text-button"
              type="button"
              onClick={() => setMode("reset")}
            >
              {t("Forgot password?")}
            </button>
          )}
        </form>
      </div>
    );
  return children(
    user,
    async () => {
      const pending = await queue();
      if (
        !window.confirm(
          t(
            pending.length
              ? "Sign out and delete pending offline entries?"
              : storage.get(`fittrack-workout:${user.id}`) &&
                  storage.get(`fittrack-workout:${user.id}`) !== "null"
                ? "Sign out and discard the saved workout?"
                : "Sign out",
          ) + "?",
        )
      )
        return;
      try {
        await axios.post(`${API}/auth/logout`);
        await clearOffline(user.id);
        storage.set(`fittrack-workout:${user.id}`, "null");
        setOfflineUser(null);
        setUser(null);
      } catch (e) {
        toast.error(errorMessage(e, "Could not sign out"));
      }
    },
    () => {
      setOfflineUser(null);
      setUser(null);
    },
  );
}

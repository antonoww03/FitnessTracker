import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { normalizeEmail } from "@/lib/accountValidation";
import { AuthPassword } from "./AuthPassword";
import { API, errorMessage } from "@/lib/api";
import { t, storage } from "@/lib/i18n";
import { toast } from "sonner";
import { removeBackgroundPush } from "@/lib/reminders";
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
  const inFlight = useRef(false);
  const activeUser = useRef(null);
  const [visible, setVisible] = useState(false);
  const [requirements, setRequirements] = useState({ length: false, uppercase: false, mismatch: false });
  const [attempt, setAttempt] = useState(0);
  const [bootstrapFailed, setBootstrapFailed] = useState(false);
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [slowConnection, setSlowConnection] = useState(false),
    [mode, setMode] = useState("login"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [recovery, setRecovery] = useState("");
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setSlowConnection(true), 8000);
    return () => clearTimeout(timer);
  }, [loading]);
  function accept(data) {
    const account = { id: data.id, username: data.username };
    setOfflineUser(account);
    setUser(account);
    activeUser.current = account;
    syncOffline();
    if (data.recovery_code) setRecovery(data.recovery_code);
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setSlowConnection(false);
    setBootstrapFailed(false);
    setError("");
    axios
      .get(`${API}/auth/me`)
      .then((r) => {
        if (!active) return;
        accept(r.data);
        syncOffline();
      })
      .catch(async (e) => {
        if (!active) return;
        // Browsers can briefly report navigator.onLine=true after the network
        // has disappeared. A request without an HTTP response is the reliable
        // signal that the saved offline account should be used.
        if (!e.response) {
          const cached = await cachedAccount();
          if (!active) return;
          if (cached && storage.get(`offline-enabled:${cached.id}`) === "1") {
            accept(cached);
            return;
          }
        }
        if (e.response?.status !== 401) {
          setBootstrapFailed(true);
          setError(errorMessage(e, t("Could not sign in")));
        }
      })
      .finally(() => { if (active) setLoading(false); });
    const id = axios.interceptors.response.use(
      (r) => r,
      (e) => {
        if ((e.response?.status === 401 || e.response?.data?.code === "account_changed") && !e.config?.skipOffline) {
          if (activeUser.current) setError(t("Your session expired. Sign in again."));
          activeUser.current = null;
          setUser(null);
          setOfflineUser(null);
        }
        return Promise.reject(e);
      },
    );
    return () => { active = false; axios.interceptors.response.eject(id); };
  }, [attempt]);
  async function submit(e) {
    e.preventDefault();
    if (inFlight.current) return;
    const body = Object.fromEntries(new FormData(e.currentTarget));
    if (mode === "register" && body.password !== body.confirm_password) {
      setError(t("Passwords do not match."));
      return;
    }
    delete body.confirm_password;
    if (mode === "register") {
      body.email = normalizeEmail(body.email);
      if (!body.email) { setError(t("Enter a valid email address.")); return; }
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      if (mode === "reset") {
        await axios.post(`${API}/auth/reset-password`, body);
        setMode("login");
        setError(
          t("Password reset. Sign in and generate a new recovery code."),
        );
      } else accept((await axios.post(`${API}/auth/${mode}`, body)).data);
    } catch (err) {
      setError(!err.response
        ? t(navigator.onLine === false ? "You are offline. Keep this page open to preserve your input." : "Connection interrupted. Your form has not been reloaded.")
        : t(errorMessage(err, t("Check the entered details and try again."))));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function validateRegistration(event) {
    if (mode !== "register") return;
    const form = event.currentTarget;
    form.elements.email.setCustomValidity(normalizeEmail(form.elements.email.value) ? "" : t("Enter a valid email address."));
    const password = form.elements.password.value;
    const confirmation = form.elements.confirm_password;
    const length = password.length >= 8;
    const uppercase = /[A-Z]/.test(password);
    const mismatch = Boolean(confirmation.value && confirmation.value !== password);
    form.elements.password.setCustomValidity(length && uppercase ? "" : t("Use at least 8 characters and one uppercase letter."));
    confirmation.setCustomValidity(mismatch ? t("Passwords do not match.") : "");
    confirmation.setAttribute("aria-invalid", String(mismatch));
    setRequirements({ length, uppercase, mismatch });
  }
  function changeMode(next) {
    if (inFlight.current) return;
    setMode(next);
    setVisible(false);
    setRequirements({ length: false, uppercase: false, mismatch: false });
    setError("");
  }
  if (loading) return <div className="ft-app ft-auth" role="status">{t(slowConnection ? "Connecting to the server. After inactivity, startup may take about a minute." : "Loading…")}</div>;
  if (bootstrapFailed) return <div className="ft-app ft-auth"><section className="ft-card"><p role="alert">{error}</p><button className="ft-secondary" onClick={() => setAttempt(value => value + 1)}>{t("Retry")}</button></section></div>;
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
        <form className="ft-card ft-form" onSubmit={submit} onInput={validateRegistration} key={mode} aria-busy={busy}>
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
          {mode === "register" && <label>
            {t("Email")}
            <input required type="email" name="email" autoComplete="email" maxLength={254}
              autoCapitalize="none" spellCheck={false} disabled={busy} />
          </label>}
          <label>
            {t("Username")}
            <input
              required
              name="username"
              autoComplete="username"
              minLength="3"
              maxLength="40"
              pattern={"[A-Za-z0-9_.\\-]+"}
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
          <AuthPassword name="password" label={mode === "reset" ? "New password" : "Password"}
            visible={visible} onToggle={() => setVisible(value => !value)} busy={busy}
            minLength={mode === "login" ? 1 : mode === "register" ? 8 : 12}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            describedBy={mode === "register" ? "auth-requirements" : undefined} />
          {mode === "register" && <>
            <div id="auth-requirements" className="ft-muted" aria-live="polite">
              <p>{requirements.length ? "✓ " : "○ "}{t("At least 8 characters")}</p>
              <p>{requirements.uppercase ? "✓ " : "○ "}{t("At least one uppercase letter (A–Z)")}</p>
            </div>
            <AuthPassword name="confirm_password" label="Confirm password" visible={visible}
              onToggle={() => setVisible(value => !value)} busy={busy} minLength={8}
              autoComplete="new-password" describedBy="auth-confirmation" />
            <p id="auth-confirmation" aria-live="polite">{requirements.mismatch ? t("Passwords do not match.") : ""}</p>
          </>}
          {mode === "reset" && <p className="ft-muted">{t("Use a unique password of at least 12 characters.")}</p>}
          {error && <p role="alert">{error}</p>}
          <button className="ft-primary" disabled={busy}>
            {t(
              busy ? "Waiting for server…" : error ? "Retry" : mode === "register"
                ? "Create account"
                : mode === "reset"
                  ? "Reset password"
                  : "Sign in",
            )}
          </button>
          <button
            type="button"
            disabled={busy}
            className="ft-secondary"
            onClick={() => {
              changeMode(mode === "login" ? "register" : "login");
            }}
          >
            {t(mode === "login" ? "Create account" : "Sign in")}
          </button>
          {mode === "login" && (
            <button
              className="ft-text-button"
              type="button"
              disabled={busy}
              onClick={() => changeMode("reset")}
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
        await removeBackgroundPush().catch(() => {});
        await axios.post(`${API}/auth/logout`);
        await clearOffline(user.id);
        storage.remove(`fittrack-workout:${user.id}`);
        setOfflineUser(null);
        setUser(null);
        activeUser.current = null;
      } catch (e) {
        toast.error(errorMessage(e, "Could not sign out"));
      }
    },
    () => {
      setOfflineUser(null);
      setUser(null);
      activeUser.current = null;
    },
  );
}

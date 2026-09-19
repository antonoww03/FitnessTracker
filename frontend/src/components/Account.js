import React, { useState, useEffect } from "react";
import axios from "axios";
import { API, errorMessage } from "@/lib/api";
import { t } from "@/lib/i18n";
import { toast } from "sonner";
export function Account({ children }) {
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [register, setRegister] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    axios
      .get(`${API}/auth/me`)
      .then((r) => setUser(r.data))
      .catch((e) => {
        if (e.response?.status !== 401)
          setError(errorMessage(e, "Could not connect. Reload to retry."));
      })
      .finally(() => setLoading(false));
    const id = axios.interceptors.response.use(
      (r) => r,
      (e) => {
        if (e.response?.status === 401) setUser(null);
        return Promise.reject(e);
      },
    );
    return () => axios.interceptors.response.eject(id);
  }, []);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      setUser(
        (
          await axios.post(
            `${API}/auth/${register ? "register" : "login"}`,
            Object.fromEntries(data),
          )
        ).data,
      );
    } catch (err) {
      setError(errorMessage(err, "Could not sign in"));
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <div className="ft-app ft-auth">{t("Loading…")}</div>;
  if (!user)
    return (
      <div className="ft-app ft-auth">
        <form className="ft-card ft-form" onSubmit={submit}>
          <h1>FitTrack</h1>
          <h2>{t(register ? "Create account" : "Sign in")}</h2>
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
          <label>
            {t("Password")}
            <input
              required
              type="password"
              name="password"
              autoComplete={register ? "new-password" : "current-password"}
              minLength="12"
              maxLength="128"
            />
          </label>
          <p className="ft-muted">
            {register ? "12+ characters · Use a unique password" : " "}
          </p>
          {error && <p role="alert">{error}</p>}
          <button className="ft-primary" disabled={busy}>
            {t(register ? "Create account" : "Sign in")}
          </button>
          <button
            type="button"
            className="ft-secondary"
            onClick={() => {
              setRegister(!register);
              setError("");
            }}
          >
            {t(register ? "Sign in" : "Create account")}
          </button>
        </form>
      </div>
    );
  return children(user, async () => {
    if (!window.confirm(t("Sign out") + "?")) return;
    try {
      await axios.post(`${API}/auth/logout`);
      setUser(null);
    } catch (e) {
      toast.error(errorMessage(e, "Could not sign out"));
    }
  });
}

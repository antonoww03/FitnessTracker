import { format } from "date-fns";
import React, { useState, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API, errorMessage } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useDraft } from "@/lib/drafts";
import { MACROS, Chart } from "./FeatureHub";
import {
  queue,
  subscribeOffline,
  syncOffline,
  discardQueued,
  setOfflineEnabled,
  offlineEnabled,
  syncStatus,
} from "@/lib/offline";
const zeros = () => Object.fromEntries(MACROS.map((k) => [k, 0]));
const ingredient = () => ({ name: "", grams: 100, per100: zeros() });
function RecipeEditor({ recipe, onSaved, onCancel }) {
  const initial = recipe
    ? {
        name: recipe.name,
        portions: recipe.portions,
        ingredients: recipe.ingredients,
      }
    : { name: "", portions: 1, ingredients: [ingredient()] };
  const [value, setValue] = useState(initial),
    [busy, setBusy] = useState(false);
  useDraft(JSON.stringify(value) !== JSON.stringify(initial));
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (recipe) await axios.put(`${API}/recipes/${recipe.id}`, value);
      else await axios.post(`${API}/recipes`, value);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err, t("Could not complete action")));
    } finally {
      setBusy(false);
    }
  }
  function change(i, k, v) {
    setValue({
      ...value,
      ingredients: value.ingredients.map((r, j) =>
        j === i ? { ...r, [k]: v } : r,
      ),
    });
  }
  return (
    <form className="ft-card ft-form" onSubmit={save}>
      <h2>{t("Recipe")}</h2>
      <div className="ft-row">
        <label>
          {t("Name")}
          <input
            required
            maxLength={100}
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
          />
        </label>
        <label>
          {t("Number of portions")}
          <input
            required
            type="number"
            min="0.1"
            max="1000"
            step="any"
            value={value.portions}
            onChange={(e) =>
              setValue({ ...value, portions: Number(e.target.value) })
            }
          />
        </label>
      </div>
      {value.ingredients.map((r, i) => (
        <div className="ft-card ft-form" key={i}>
          <div className="ft-row">
            <label>
              {t("Ingredient")}
              <input
                required
                value={r.name}
                maxLength={120}
                onChange={(e) => change(i, "name", e.target.value)}
              />
            </label>
            <label>
              {t("Grams")}
              <input
                required
                type="number"
                min="0.1"
                max="10000"
                step="any"
                value={r.grams}
                onChange={(e) => change(i, "grams", Number(e.target.value))}
              />
            </label>
          </div>
          <p>{t("Per 100 g")}</p>
          <div className="ft-macro-inputs">
            {MACROS.map((k) => (
              <label key={k}>
                {t(k)}
                <input
                  required
                  type="number"
                  min="0"
                  step="any"
                  value={r.per100[k]}
                  onChange={(e) =>
                    change(i, "per100", {
                      ...r.per100,
                      [k]: Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            className="ft-danger-text"
            onClick={() =>
              setValue({
                ...value,
                ingredients: value.ingredients.filter((_, j) => j !== i),
              })
            }
          >
            {t("Remove")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ft-secondary"
        onClick={() =>
          setValue({
            ...value,
            ingredients: [...value.ingredients, ingredient()],
          })
        }
      >
        {t("Add ingredient")}
      </button>
      <div className="ft-row">
        <button
          className="ft-primary"
          disabled={busy || !value.ingredients.length}
        >
          {t("Save")}
        </button>
        <button
          type="button"
          className="ft-secondary"
          onClick={() => {
            if (window.confirm(t("Unsaved changes. Discard them?"))) onCancel();
          }}
        >
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}
export function RecipesView({ selectedDate, onRefresh }) {
  const [rows, setRows] = useState([]),
    [edit, setEdit] = useState(null),
    [amounts, setAmounts] = useState({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    axios
      .get(`${API}/recipes`)
      .then((r) => {
        if (active) setRows(r.data);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e, t("Could not complete action")));
      });
    return () => {
      active = false;
    };
  }, [revision]);
  async function act(fn) {
    setBusy(true);
    try {
      await fn();
      setRevision((v) => v + 1);
      await onRefresh();
      setError("");
    } catch (e) {
      setError(errorMessage(e, t("Could not complete action")));
    } finally {
      setBusy(false);
    }
  }
  if (edit)
    return (
      <RecipeEditor
        recipe={edit === "new" ? null : edit}
        onCancel={() => setEdit(null)}
        onSaved={() => {
          setEdit(null);
          setRevision((v) => v + 1);
        }}
      />
    );
  return (
    <section className="ft-card ft-form">
      <div className="ft-section-head">
        <h2>{t("Recipes")}</h2>
        <button className="ft-primary" onClick={() => setEdit("new")}>
          {t("New recipe")}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {rows.map((r) => (
        <div className="ft-card ft-form" key={r.id}>
          <h3>{r.name}</h3>
          <p>
            {Math.round(r.per_portion.calories)} kcal / {t("portion")} ·{" "}
            {r.portions} {t("portions")}
          </p>
          <p className="ft-muted">
            {MACROS.slice(1)
              .map((k) => `${t(k)} ${r.per_portion[k]} g`)
              .join(" · ")}
          </p>
          <div className="ft-row">
            <label>
              {t("Portions to log")}
              <input
                type="number"
                min="0.1"
                max="1000"
                step="any"
                value={amounts[r.id] ?? 1}
                onChange={(e) =>
                  setAmounts({ ...amounts, [r.id]: Number(e.target.value) })
                }
              />
            </label>
            <button
              className="ft-primary"
              disabled={busy || !(amounts[r.id] ?? 1)}
              onClick={() =>
                act(() =>
                  axios.post(`${API}/recipes/${r.id}/log`, {
                    date: selectedDate,
                    portions: amounts[r.id] ?? 1,
                  }),
                )
              }
            >
              {t("Log meal")}
            </button>
            <button
              className="ft-secondary"
              disabled={busy}
              onClick={() => setEdit(r)}
            >
              {t("Edit")}
            </button>
            <button
              className="ft-danger-text"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("Delete") + "?"))
                  act(() => axios.delete(`${API}/recipes/${r.id}`));
              }}
            >
              {t("Delete")}
            </button>
          </div>
        </div>
      ))}
      {!rows.length && (
        <p>{t("Create a recipe to calculate nutrition per portion")}</p>
      )}
    </section>
  );
}
const measures = ["waist_cm", "chest_cm", "arm_cm", "thigh_cm"];
export function BodyMeasurements({ selectedDate }) {
  const [rows, setRows] = useState([]),
    [value, setValue] = useState({}),
    [field, setField] = useState("waist_cm"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [dirty, setDirty] = useState(false);
  useDraft(dirty);
  useEffect(() => {
    let active = true;
    axios
      .get(`${API}/measurements`)
      .then((r) => {
        if (active) {
          setRows(r.data);
          setValue(r.data.find((x) => x.date === selectedDate) || {});
          setDirty(false);
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e, t("Could not complete action")));
      });
    return () => {
      active = false;
    };
  }, [selectedDate, revision]);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.post(`${API}/measurements`, {
        date: selectedDate,
        ...Object.fromEntries(
          measures.map((k) => [
            k,
            value[k] === "" || value[k] == null ? null : Number(value[k]),
          ]),
        ),
      });
      setRevision((v) => v + 1);
      setError("");
    } catch (err) {
      setError(errorMessage(err, t("Could not complete action")));
    } finally {
      setBusy(false);
    }
  }
  const chartRows = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="ft-content">
      <form className="ft-card ft-form" onSubmit={submit}>
        <h2>
          {t("Body measurements")} · {selectedDate}
        </h2>
        <div className="ft-macro-inputs">
          {measures.map((k) => (
            <label key={k}>
              {t(k)} (cm)
              <input
                type="number"
                min="0.1"
                max="400"
                step="any"
                value={value[k] ?? ""}
                onChange={(e) => {
                  setValue({ ...value, [k]: e.target.value });
                  setDirty(true);
                }}
              />
            </label>
          ))}
        </div>
        <button className="ft-primary" disabled={busy}>
          {t("Save")}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
      <section className="ft-card ft-form">
        <label>
          {t("Measurement")}
          <select value={field} onChange={(e) => setField(e.target.value)}>
            {measures.map((k) => (
              <option key={k} value={k}>
                {t(k)}
              </option>
            ))}
          </select>
        </label>
        <Chart
          rows={chartRows}
          value={(r) => r[field] ?? null}
          title={field}
          unit="cm"
        />
        {[...rows]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((r) => (
            <div className="ft-history-row" key={r.id}>
              <div>
                <strong>{r.date}</strong>
                <p className="ft-muted">
                  {measures.map((k) => `${t(k)}: ${r[k] ?? "—"}`).join(" · ")}
                </p>
              </div>
              <button
                className="ft-danger-text"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm(t("Delete") + "?")) return;
                  setBusy(true);
                  try {
                    await axios.delete(`${API}/measurements/${r.date}`);
                    setRevision((v) => v + 1);
                  } catch (e) {
                    setError(errorMessage(e, t("Could not complete action")));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("Delete")}
              </button>
            </div>
          ))}
      </section>
    </div>
  );
}
export function DayGoalSettings({ onSaved }) {
  const [value, setValue] = useState(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useDraft(dirty);
  useEffect(() => {
    axios
      .get(`${API}/day-goals`)
      .then((r) => setValue(r.data))
      .catch((e) => setError(errorMessage(e, t("Could not complete action"))));
  }, []);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.put(`${API}/day-goals`, value);
      setDirty(false);
      onSaved();
      toast.success(t("Saved"));
    } catch (err) {
      setError(errorMessage(err, t("Could not complete action")));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ft-form ft-card" onSubmit={save}>
      <h2>{t("Goals by day type")}</h2>
      {error && <p role="alert">{error}</p>}
      {value && (
        <>
          {["training", "rest"].map((type) => (
            <div key={type}>
              <h3>{t(type === "training" ? "Training day" : "Rest day")}</h3>
              <div className="ft-macro-inputs">
                {MACROS.map((k) => (
                  <label key={k}>
                    {t(k)}
                    <input
                      required
                      type="number"
                      min="0"
                      step="any"
                      value={value[type][k]}
                      onChange={(e) => {
                        setValue({
                          ...value,
                          [type]: {
                            ...value[type],
                            [k]: Number(e.target.value),
                          },
                        });
                        setDirty(true);
                      }}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button disabled={busy} className="ft-primary">
            {t("Save")}
          </button>
        </>
      )}
    </form>
  );
}
export function OfflinePanel({ selectedDate }) {
  const [items, setItems] = useState([]),
    [syncErrors, setSyncErrors] = useState([]),
    [on, setOn] = useState(offlineEnabled()),
    [busy, setBusy] = useState(false),
    [install, setInstall] = useState(null);
  useEffect(() => {
    const update = () => {
      setSyncErrors(syncStatus().errors);
      setOn(offlineEnabled());
      queue().then(setItems);
    };
    update();
    const unsub = subscribeOffline(update);
    const prompt = (e) => {
      e.preventDefault();
      setInstall(e);
    };
    window.addEventListener("beforeinstallprompt", prompt);
    return () => {
      unsub();
      window.removeEventListener("beforeinstallprompt", prompt);
    };
  }, []);
  return (
    <section className="ft-card ft-form">
      <h2>{t("Phone & offline")}</h2>
      <p className="ft-muted">
        {t(
          "Install from your browser menu. On iPhone: Share → Add to Home Screen. HTTPS is required.",
        )}
      </p>
      {install && (
        <button
          className="ft-primary"
          onClick={async () => {
            await install.prompt();
            setInstall(null);
          }}
        >
          {t("Install app")}
        </button>
      )}
      <label className="ft-check">
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={async (e) => {
            const next = e.target.checked;
            if (
              !next &&
              items.length &&
              !window.confirm(t("Delete pending offline entries?"))
            )
              return;
            setOn(next);
            setBusy(true);
            try {
              await setOfflineEnabled(next);
              if (next) {
                const days = [
                  ...new Set(
                    [selectedDate, format(new Date(), "yyyy-MM-dd")].filter(
                      Boolean,
                    ),
                  ),
                ];
                await Promise.all([
                  ...days.flatMap((date) =>
                    ["summary", "food", "training", "streak/water", "plan"].map(
                      (path) =>
                        axios.get(`${API}/${path}`, { params: { date } }),
                    ),
                  ),
                  axios.get(`${API}/preferences`),
                  axios.get(`${API}/programs`),
                ]);
              }
            } catch {
              setOn(offlineEnabled());
              toast.error(
                t(
                  "Could not prepare offline data. Keep the connection and retry.",
                ),
              );
            } finally {
              setBusy(false);
            }
          }}
        />
        {t("Enable offline on this device")}
      </label>
      <p className="ft-muted">
        {t(
          "Keeps a local copy on this device. Offline food, water, weight and training entries sync when online. Sign out clears local cached data.",
        )}
      </p>
      {syncErrors.map((message, i) => (
        <p role="alert" key={i}>
          {t(message)}
        </p>
      ))}
      <strong>
        {items.length} {t("pending entries")}
      </strong>
      {items.map((item) => (
        <div key={item.key} className="ft-history-row">
          <div>
            {item.config.data.date} ·{" "}
            {item.config.data.food_name ||
              item.config.data.training_type ||
              item.config.url.split("/").pop()}
            {item.error && <p role="alert">{t(item.error)}</p>}
          </div>
          <button
            className="ft-danger-text"
            onClick={() => {
              if (window.confirm(t("Delete") + "?")) discardQueued(item.key);
            }}
          >
            {t("Delete")}
          </button>
        </div>
      ))}
      <button
        className="ft-secondary"
        disabled={busy || !items.length}
        onClick={syncOffline}
      >
        {t("Sync now")}
      </button>
    </section>
  );
}
export function RecoverySettings() {
  const [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="ft-card ft-form">
      <h2>{t("Account recovery")}</h2>
      <p>
        {t(
          "Save this code privately. It replaces email recovery and can reset your password once.",
        )}
      </p>
      <label>
        {t("Current password")}
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <button
        className="ft-secondary"
        disabled={busy || password.length < 12}
        onClick={async () => {
          setBusy(true);
          try {
            const { data } = await axios.post(`${API}/auth/recovery-code`, {
              password,
            });
            setCode(data.recovery_code);
            setPassword("");
            setError("");
          } catch (e) {
            setError(errorMessage(e, t("Could not complete action")));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Generate new recovery code")}
      </button>
      {code && <output className="ft-recovery-code">{code}</output>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function OfflineBadge({ onOpen }) {
  const [state, setState] = useState({
    ...syncStatus(),
    count: 0,
    online: navigator.onLine,
  });
  useEffect(() => {
    let alive = true;
    const update = async () => {
      const pending = await queue();
      if (alive)
        setState({
          ...syncStatus(),
          count: pending.length,
          online: navigator.onLine,
        });
    };
    update();
    const unsub = subscribeOffline(update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      alive = false;
      unsub();
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const label = state.working
    ? "Syncing…"
    : state.count
      ? "Saved on this device"
      : !state.online
        ? "Offline"
        : state.errors.length
          ? "Sync needs attention"
          : state.lastUpdated
            ? "Synced"
            : "Waiting for data";
  return (
    <div className="ft-sync-status" role="status" data-testid="sync-status">
      <button className="ft-secondary" onClick={onOpen}>
        {t(label)}
        {state.count ? ` · ${state.count} ${t("pending entries")}` : ""}
      </button>
      {state.lastUpdated && (
        <span className="ft-muted">
          {t("Last updated")}: {new Date(state.lastUpdated).toLocaleString()}
        </span>
      )}
      {(state.count > 0 || !state.online) && (
        <span className="ft-muted">
          {t("Totals show the last synchronized data.")}
        </span>
      )}
    </div>
  );
}

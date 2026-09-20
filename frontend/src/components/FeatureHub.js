import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API, errorMessage } from "@/lib/api";
import { t } from "@/lib/i18n";
import { MealType, CopyFoodButton } from "./DailyTools";
import { useDraft } from "@/lib/drafts";
import { format, subDays } from "date-fns";
export const MACROS = ["calories", "protein", "fat", "carbs", "sugar", "fiber"];
const fields = {
  food: ["meal_type", "food_name", "food_description", "grams", ...MACROS],
  training: [
    "training_type",
    "duration_minutes",
    "exercises",
    "sets_log",
    "program_name",
  ],
  water: ["amount_ml"],
  weight: ["weight_kg"],
};
const names = {
  food_name: "Name",
  food_description: "Description",
  grams: "Grams",
  training_type: "Type",
  duration_minutes: "Duration (minutes)",
  amount_ml: "Amount (ml)",
  weight_kg: "Weight (kg)",
};
export const payload = (kind, row) =>
  Object.fromEntries(
    ["date", ...fields[kind]]
      .filter((k) => row[k] !== undefined)
      .map((k) => [k, row[k]]),
  );
const dateBefore = (date, days) =>
  format(subDays(new Date(date + "T12:00:00"), days), "yyyy-MM-dd");
export function ExerciseEditor({ value = [], onChange }) {
  return (
    <div>
      <h3>{t("Exercises")}</h3>
      {value.map((row, i) => (
        <div className="ft-exercise" key={i}>
          {["name", "sets", "reps", "weight_kg"].map((k) => (
            <label key={k}>
              {t(
                {
                  name: "Exercise",
                  sets: "Sets",
                  reps: "Reps",
                  weight_kg: "Load (kg)",
                }[k],
              )}
              <input
                aria-label={`${t(k)} ${i + 1}`}
                required
                type={k === "name" ? "text" : "number"}
                min={k === "weight_kg" ? 0 : 1}
                step={k === "weight_kg" ? "any" : 1}
                value={row[k]}
                onChange={(e) =>
                  onChange(
                    value.map((r, j) =>
                      i === j
                        ? {
                            ...r,
                            [k]:
                              k === "name"
                                ? e.target.value
                                : Number(e.target.value),
                          }
                        : r,
                    ),
                  )
                }
              />
            </label>
          ))}
          <button
            type="button"
            className="ft-secondary"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            {t("Remove")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ft-secondary"
        onClick={() =>
          onChange([...value, { name: "", sets: 3, reps: 10, weight_kg: 0 }])
        }
      >
        {t("Add exercise")}
      </button>
    </div>
  );
}
export function EntryEditor({ entry, onClose, onSave }) {
  const [value, setValue] = useState(payload(entry.kind, entry)),
    [busy, setBusy] = useState(false);
  const dirty =
    JSON.stringify(value) !== JSON.stringify(payload(entry.kind, entry));
  useDraft(dirty);
  useEffect(() => {
    const guard = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await axios.put(`${API}/entries/${entry.kind}/${entry.id}`, value);
      toast.success(t("Saved"));
      onSave();
    } catch (err) {
      toast.error(errorMessage(err, t("Could not complete action")));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="ft-card ft-form"
      onSubmit={submit}
      data-testid="edit-entry"
    >
      <h2>
        {t("Edit")} · {t(entry.kind[0].toUpperCase() + entry.kind.slice(1))}
      </h2>
      {entry.kind === "food" && (
        <MealType
          value={value.meal_type}
          onChange={(meal_type) => setValue({ ...value, meal_type })}
        />
      )}
      {fields[entry.kind]
        .filter(
          (k) =>
            !["meal_type", "exercises", "sets_log", "program_name"].includes(k),
        )
        .map((k) => (
          <label key={k}>
            {t(names[k] || k)}
            {k === "training_type" ? (
              <select
                value={value[k]}
                onChange={(e) => setValue({ ...value, [k]: e.target.value })}
              >
                {[
                  "Strength",
                  "Cardio",
                  "HIIT",
                  "Yoga",
                  "Swimming",
                  "Cycling",
                  "Running",
                  "Walking",
                ].map((x) => (
                  <option key={x} value={x}>
                    {t(x)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                required={k !== "grams"}
                type={
                  ["food_name", "food_description"].includes(k)
                    ? "text"
                    : "number"
                }
                min={
                  [
                    "grams",
                    "duration_minutes",
                    "amount_ml",
                    "weight_kg",
                  ].includes(k)
                    ? 0.01
                    : 0
                }
                step={k === "duration_minutes" ? 1 : "any"}
                value={value[k] ?? ""}
                onChange={(e) => {
                  const next = {
                    ...value,
                    [k]: ["food_name", "food_description"].includes(k)
                      ? e.target.value
                      : e.target.value === "" && k === "grams"
                        ? null
                        : Number(e.target.value),
                  };
                  if (k === "grams" && value.grams > 0 && next.grams > 0)
                    MACROS.forEach((m) => {
                      next[m] =
                        Math.round(
                          ((value[m] * next.grams) / value.grams) * 100,
                        ) / 100;
                    });
                  setValue(next);
                }}
              />
            )}
          </label>
        ))}
      {entry.kind === "training" && !value.sets_log?.length && (
        <ExerciseEditor
          value={value.exercises}
          onChange={(exercises) => setValue({ ...value, exercises })}
        />
      )}
      {entry.kind === "training" &&
        value.sets_log?.map((row, i) => (
          <div className="ft-row" key={i}>
            {["name", "reps", "weight_kg"].map((k) => (
              <label key={k}>
                {t(
                  { name: "Exercise", reps: "Reps", weight_kg: "Load (kg)" }[k],
                )}
                <input
                  required
                  type={k === "name" ? "text" : "number"}
                  min={k === "reps" ? 1 : 0}
                  max={k === "name" ? undefined : 1000}
                  step={k === "weight_kg" ? "any" : 1}
                  value={row[k]}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      sets_log: value.sets_log.map((r, j) =>
                        i === j
                          ? {
                              ...r,
                              [k]:
                                k === "name"
                                  ? e.target.value
                                  : Number(e.target.value),
                            }
                          : r,
                      ),
                    })
                  }
                />
              </label>
            ))}
            <label className="ft-check">
              <input
                type="checkbox"
                checked={row.warmup || false}
                onChange={(e) =>
                  setValue({
                    ...value,
                    sets_log: value.sets_log.map((r, j) =>
                      i === j ? { ...r, warmup: e.target.checked } : r,
                    ),
                  })
                }
              />
              {t("Warm-up")}
            </label>
            {["superset", "notes"].map((k) => (
              <label key={k}>
                {t(k === "superset" ? "Superset group" : "Set notes")}
                <input
                  maxLength={k === "superset" ? 20 : 500}
                  value={row[k] || ""}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      sets_log: value.sets_log.map((r, j) =>
                        i === j ? { ...r, [k]: e.target.value } : r,
                      ),
                    })
                  }
                />
              </label>
            ))}
          </div>
        ))}
      <div className="ft-row">
        <button disabled={busy} className="ft-primary">
          {t("Save")}
        </button>
        <button
          type="button"
          disabled={busy}
          className="ft-secondary"
          onClick={() => {
            if (!dirty || window.confirm(t("Unsaved changes. Discard them?")))
              onClose();
          }}
        >
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}
export function HistoryView({ selectedDate, onRefresh }) {
  const [start, setStart] = useState(dateBefore(selectedDate, 29)),
    [end, setEnd] = useState(selectedDate),
    [kind, setKind] = useState("all"),
    [rows, setRows] = useState([]),
    [edit, setEdit] = useState(null),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    setStart(dateBefore(selectedDate, 29));
    setEnd(selectedDate);
  }, [selectedDate]);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    axios
      .get(`${API}/history`, { params: { start, end, kind }, signal: c.signal })
      .then((r) => setRows(r.data))
      .catch((e) => {
        if (!c.signal.aborted)
          setError(errorMessage(e, t("Could not complete action")));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [start, end, kind, revision]);
  function refresh() {
    setRevision((x) => x + 1);
    onRefresh();
  }
  async function remove(row) {
    setBusy(true);
    try {
      const { data } = await axios.delete(
        `${API}/entries/${row.kind}/${row.id}`,
      );
      refresh();
      toast(t("Entry deleted"), {
        duration: 15000,
        action: {
          label: t("Undo"),
          onClick: async () => {
            try {
              await axios.post(`${API}/undo/${data.undo_token}`);
              refresh();
              toast.success(t("Entry restored"));
            } catch (e) {
              toast.error(errorMessage(e, t("Could not complete action")));
            }
          },
        },
      });
    } catch (e) {
      toast.error(errorMessage(e, t("Could not complete action")));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ft-card ft-form" data-testid="full-history">
      <h2>{t("History")}</h2>
      {edit ? (
        <EntryEditor
          key={edit.id}
          entry={edit}
          onClose={() => setEdit(null)}
          onSave={() => {
            setEdit(null);
            refresh();
          }}
        />
      ) : (
        <>
          <div className="ft-row">
            <label>
              {t("Start")}
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              {t("End")}
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
            <label>
              {t("Type")}
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {["all", "food", "training", "water", "weight"].map((k) => (
                  <option value={k} key={k}>
                    {t(k === "all" ? "All" : k[0].toUpperCase() + k.slice(1))}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {loading ? (
            <p role="status">{t("Loading…")}</p>
          ) : error ? (
            <p role="alert">{error}</p>
          ) : rows.length ? (
            rows.map((row) => (
              <div className="ft-history-row" key={row.kind + row.id}>
                <div>
                  <strong>
                    {row.program_name ||
                      row.food_name ||
                      t(
                        row.training_type ||
                          row.kind[0].toUpperCase() + row.kind.slice(1),
                      )}
                  </strong>
                  <p className="ft-muted">
                    {row.date} ·{" "}
                    {row.kind === "food"
                      ? t(row.meal_type || "snack") + " · "
                      : ""}{" "}
                    {row.kind === "food"
                      ? `${row.calories} kcal · ${row.grams ?? "—"} g`
                      : row.kind === "training"
                        ? `${row.duration_minutes} min`
                        : row.kind === "water"
                          ? `${row.amount_ml} ml`
                          : `${row.weight_kg} kg`}
                  </p>
                  {row.sets_log?.map((ex, i) => (
                    <p className="ft-muted" key={"set-" + i}>
                      {ex.name}: {ex.reps} × {ex.weight_kg} kg{" "}
                      {ex.warmup && t("Warm-up")}{" "}
                      {ex.superset && `[${ex.superset}]`} {ex.notes}
                    </p>
                  ))}
                  {row.exercises?.map((ex, i) => (
                    <p className="ft-muted" key={i}>
                      {ex.name}: {ex.sets} × {ex.reps} · {ex.weight_kg} kg
                    </p>
                  ))}
                </div>
                <div className="ft-row">
                  {row.kind === "food" && (
                    <CopyFoodButton
                      row={row}
                      selectedDate={selectedDate}
                      onRefresh={() => {
                        setRevision((v) => v + 1);
                        onRefresh();
                      }}
                    />
                  )}
                  <button
                    className="ft-secondary"
                    disabled={busy}
                    onClick={() => setEdit(row)}
                  >
                    {t("Edit")}
                  </button>
                  <button
                    className="ft-danger-text"
                    disabled={busy}
                    onClick={() => remove(row)}
                  >
                    {t("Delete")}
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p>{t("No entries")}</p>
          )}
        </>
      )}
    </section>
  );
}
export function MealsView({ selectedDate, foods, onRefresh }) {
  const [meals, setMeals] = useState([]),
    [selected, setSelected] = useState([]),
    [name, setName] = useState(""),
    [source, setSource] = useState(dateBefore(selectedDate, 1)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useDraft(Boolean(name.trim() || selected.length));
  const load = () => axios.get(`${API}/meals`).then((r) => setMeals(r.data));
  useEffect(() => {
    let active = true;
    axios
      .get(`${API}/meals`)
      .then((r) => {
        if (active) setMeals(r.data);
      })
      .catch(() => {
        if (active) setError(t("Could not complete action"));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => setSelected([]), [selectedDate]);
  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      await onRefresh();
      toast.success(t("Saved"));
    } catch (e) {
      setError(errorMessage(e, t("Could not complete action")));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ft-content">
      <section className="ft-card ft-form">
        <h2>{t("Copy a day")}</h2>
        <div className="ft-row">
          <label>
            {t("Source date")}
            <input
              type="date"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          <p>
            {t("Target date")}: {selectedDate}
          </p>
        </div>
        <button
          className="ft-primary"
          disabled={busy || !source || source === selectedDate}
          onClick={() => {
            if (
              window.confirm(
                `${t("Copy food and training")} ${source} → ${selectedDate}?`,
              )
            )
              act(() =>
                axios.post(`${API}/copy-day`, {
                  source,
                  target: selectedDate,
                  kinds: ["food", "training"],
                }),
              );
          }}
        >
          {t("Copy food and training")}
        </button>
      </section>
      <section className="ft-card ft-form">
        <h2>{t("Save selected foods as a meal")}</h2>
        <p className="ft-muted">{selectedDate}</p>
        {foods.map((f) => (
          <label className="ft-check" key={f.id}>
            <input
              type="checkbox"
              checked={selected.includes(f.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, f.id]
                    : selected.filter((id) => id !== f.id),
                )
              }
            />
            {f.food_name} · {f.calories} kcal
          </label>
        ))}
        {!foods.length && <p>{t("No entries")}</p>}
        <label>
          {t("Meal name")}
          <input
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button
          className="ft-primary"
          disabled={busy || !name.trim() || !selected.length}
          onClick={() =>
            act(async () => {
              await axios.post(`${API}/meals`, {
                name,
                foods: foods
                  .filter((f) => selected.includes(f.id))
                  .map((f) => payload("food", f)),
              });
              setName("");
              setSelected([]);
            })
          }
        >
          {t("Save")}
        </button>
      </section>
      <section className="ft-card ft-form">
        <h2>{t("Saved meals")}</h2>
        {meals.map((m) => (
          <div className="ft-history-row" key={m.id}>
            <div>
              <strong>{m.name}</strong>
              <p className="ft-muted">
                {m.foods.length} ·{" "}
                {Math.round(m.foods.reduce((s, f) => s + f.calories, 0))} kcal
              </p>
            </div>
            <div className="ft-row">
              <button
                className="ft-secondary"
                disabled={busy}
                onClick={() =>
                  act(() =>
                    axios.post(`${API}/meals/${m.id}/log`, null, {
                      params: { date: selectedDate },
                    }),
                  )
                }
              >
                {t("Log meal")}
              </button>
              <button
                className="ft-danger-text"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t("Delete") + "?"))
                    act(() => axios.delete(`${API}/meals/${m.id}`));
                }}
              >
                {t("Delete")}
              </button>
            </div>
          </div>
        ))}
        {!meals.length && <p>{t("No entries")}</p>}
      </section>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function Chart({ rows, value, title, unit }) {
  const chartRef = useRef(null);
  const [width, setWidth] = useState(650);
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const measure = () =>
      setWidth(
        Math.max(180, Math.round(element.getBoundingClientRect().width) || 650),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [rows.length]);
  const vals = rows.map(value),
    numbers = vals.filter((v) => v !== null && Number.isFinite(v));
  if (!numbers.length)
    return (
      <section className="ft-card ft-form">
        <h3>{t(title)}</h3>
        <p>{t("No measurements")}</p>
      </section>
    );
  const min =
      title.includes("weight") || title === "Recorded weight"
        ? Math.floor(Math.min(...numbers) - 1)
        : 0,
    max = Math.max(...numbers, min + 1) * 1.02;
  const x = (i) => 50 + (i * (width - 75)) / Math.max(rows.length - 1, 1),
    y = (v) => 180 - ((v - min) / (max - min)) * 145;
  let segments = [],
    line = [];
  vals.forEach((v, i) => {
    if (v == null) {
      if (line.length) segments.push(line);
      line = [];
    } else line.push(`${x(i)},${y(v)}`);
  });
  if (line.length) segments.push(line);
  return (
    <section className="ft-card ft-form">
      <h3>{t(title)}</h3>
      <svg
        ref={chartRef}
        viewBox={`0 0 ${width} 220`}
        role="img"
        aria-label={`${t(title)} (${unit}), ${rows[0].date} – ${rows.at(-1).date}`}
        className="ft-chart"
      >
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line
              x1="50"
              x2={width - 25}
              y1={35 + v * 145}
              y2={35 + v * 145}
              stroke="currentColor"
              opacity=".15"
            />
            <text x="4" y={40 + v * 145} fill="currentColor" fontSize="12">
              {(max - v * (max - min)).toFixed(1)}
            </text>
          </g>
        ))}
        {segments.map((points, i) => (
          <polyline
            key={i}
            fill="none"
            stroke="#438dff"
            strokeWidth="3"
            points={points.join(" ")}
          />
        ))}
        {vals.map((v, i) =>
          v == null ? null : (
            <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="#438dff">
              <title>
                {rows[i].date}: {v} {unit}
              </title>
            </circle>
          ),
        )}
        <text x="50" y="210" fill="currentColor" fontSize="12">
          {width < 360 ? rows[0].date.slice(5) : rows[0].date}
        </text>
        <text
          x={width - 25}
          y="210"
          textAnchor="end"
          fill="currentColor"
          fontSize="12"
        >
          {width < 360 ? rows.at(-1).date.slice(5) : rows.at(-1).date}
        </text>
      </svg>
      <details>
        <summary>{t("History")}</summary>
        <div className="ft-table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("History")}</th>
                <th>{unit}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.date}>
                  <td>{r.date}</td>
                  <td>{vals[i] ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
export function ProgressView({ selectedDate }) {
  const [days, setDays] = useState(30),
    [rows, setRows] = useState([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setError("");
    axios
      .get(`${API}/progress`, {
        params: {
          start: dateBefore(selectedDate, days - 1),
          end: selectedDate,
        },
        signal: c.signal,
      })
      .then((r) => setRows(r.data))
      .catch((e) => {
        if (!c.signal.aborted)
          setError(errorMessage(e, t("Could not complete action")));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [days, selectedDate]);
  return (
    <div className="ft-content">
      <div className="ft-row">
        {[7, 30, 90].map((n) => (
          <button
            key={n}
            className={days === n ? "ft-primary" : "ft-secondary"}
            aria-pressed={days === n}
            onClick={() => setDays(n)}
          >
            {t(n + " days")}
          </button>
        ))}
      </div>
      {loading ? (
        <p>{t("Loading…")}</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : (
        <>
          <Chart
            rows={rows}
            value={(r) => r.weight_kg}
            title="Recorded weight"
            unit="kg"
          />
          <Chart
            rows={rows}
            value={(r) => r.weight_average_7d}
            title="7-day weight average"
            unit="kg"
          />
          <p className="ft-muted">
            {t(
              "Average uses recorded measurements within each 7-day window; missing days are excluded.",
            )}
          </p>
          <Chart
            rows={rows}
            value={(r) => r.totals.calories}
            title="Calories"
            unit="kcal"
          />
          <Chart
            rows={rows}
            value={(r) => r.training_minutes}
            title="Training minutes"
            unit="min"
          />
        </>
      )}
    </div>
  );
}
export function SettingsView({ preferences, onSave, user, onLogout }) {
  const [value, setValue] = useState(preferences),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useDraft(JSON.stringify(value) !== JSON.stringify(preferences));
  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e, t("Could not complete action")));
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    const { data } = await axios.get(`${API}/backup`, { responseType: "blob" });
    const url = URL.createObjectURL(data),
      a = document.createElement("a");
    a.href = url;
    a.download = "fittrack-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="ft-card ft-form">
      <h2>
        {t("Settings")} · {user.username}
      </h2>
      <label>
        {t("Language")}
        <select
          value={value.language}
          onChange={(e) => setValue({ ...value, language: e.target.value })}
        >
          <option value="en">English</option>
          <option value="bg">Български</option>
        </select>
      </label>
      <label>
        {t("Theme")}
        <select
          value={value.theme}
          onChange={(e) => setValue({ ...value, theme: e.target.value })}
        >
          <option value="dark">{t("Dark")}</option>
          <option value="light">{t("Light")}</option>
        </select>
      </label>
      <label>
        {t("Water target (ml)")}
        <input
          type="number"
          min="100"
          max="20000"
          step="100"
          value={value.water_goal_ml}
          onChange={(e) =>
            setValue({ ...value, water_goal_ml: Number(e.target.value) })
          }
        />
      </label>
      <fieldset className="ft-form">
        <legend>{t("Visible on Today")}</legend>
        {["water", "weight", "training", "activity", "review"].map((key) => (
          <label className="ft-check" key={key}>
            <input
              type="checkbox"
              checked={!(value.hidden_sections || []).includes(key)}
              onChange={(e) =>
                setValue({
                  ...value,
                  hidden_sections: e.target.checked
                    ? (value.hidden_sections || []).filter((k) => k !== key)
                    : [...(value.hidden_sections || []), key],
                })
              }
            />
            {t(key[0].toUpperCase() + key.slice(1))}
          </label>
        ))}
      </fieldset>
      <button
        disabled={busy}
        className="ft-primary"
        onClick={() =>
          act(async () => {
            const { data } = await axios.put(`${API}/preferences`, value);
            onSave(data);
            toast.success(t("Saved"));
          })
        }
      >
        {t("Save settings")}
      </button>
      <hr />
      <button
        disabled={busy}
        className="ft-secondary"
        onClick={() => act(download)}
      >
        {t("Download backup")}
      </button>
      <label>
        {t("Restore backup")}
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 5000000) {
              setError("Maximum 5 MB");
              return;
            }
            if (
              window.confirm(
                t(
                  "Restore merges records and replaces matching IDs. Continue?",
                ),
              )
            )
              act(async () => {
                await axios.post(
                  `${API}/backup/restore`,
                  JSON.parse(await file.text()),
                );
                onSave((await axios.get(`${API}/preferences`)).data);
                toast.success(t("Backup restored"));
              });
          }}
        />
      </label>
      <p className="ft-muted">
        {t(
          "Keep your backup private. It contains your fitness data, not your password.",
        )}
      </p>
      <button className="ft-secondary" disabled={busy} onClick={onLogout}>
        {t("Sign out")}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

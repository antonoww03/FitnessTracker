import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  format,
  subDays,
  startOfWeek,
  startOfMonth,
  addDays,
  addMonths,
} from "date-fns";
import { API, errorMessage } from "@/lib/api";
import { t, storage } from "@/lib/i18n";
import { toast } from "sonner";
import { Chart, payload } from "./FeatureHub";
import { DayPlanCard } from "./TrainingStudio";
import { clearOffline, setOfflineUser } from "@/lib/offline";
const dateString = (d) => format(d, "yyyy-MM-dd");
const dateObject = (s) => new Date(s + "T12:00:00");
export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];
export function MealType({ value, onChange }) {
  return (
    <label>
      {t("Meal category")}
      <select
        value={value || "snack"}
        onChange={(e) => onChange(e.target.value)}
      >
        {MEAL_TYPES.map((k) => (
          <option key={k} value={k}>
            {t(k)}
          </option>
        ))}
      </select>
    </label>
  );
}
export function QuickFoods({ selectedDate, onRefresh }) {
  const [rows, setRows] = useState([]),
    [favorites, setFavorites] = useState([]),
    [category, setCategory] = useState("snack"),
    [target, setTarget] = useState(selectedDate),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    setTarget(selectedDate);
  }, [selectedDate]);
  useEffect(() => {
    let alive = true;
    Promise.all([
      axios.get(`${API}/recent-foods`),
      axios.get(`${API}/favorite-foods`),
    ])
      .then(([a, b]) => {
        if (alive) {
          setRows(a.data);
          setFavorites(b.data);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e, t("Could not complete action")));
      });
    return () => {
      alive = false;
    };
  }, [revision]);
  async function act(fn) {
    setBusy(true);
    try {
      await fn();
      setRevision((v) => v + 1);
      await onRefresh();
      setError("");
      toast.success(t("Saved"));
    } catch (e) {
      setError(errorMessage(e, t("Could not complete action")));
    } finally {
      setBusy(false);
    }
  }
  const render = (row, favorite) => (
    <div className="ft-history-row" key={row.id}>
      <div>
        <strong>{row.food_name}</strong>
        <p className="ft-muted">
          {row.grams ?? "—"} g · {Math.round(row.calories)} kcal
        </p>
      </div>
      <div className="ft-row">
        <button
          className="ft-primary"
          disabled={busy || !target}
          onClick={() =>
            act(() =>
              axios.post(`${API}/food`, {
                ...payload("food", row),
                date: target,
                meal_type: category,
              }),
            )
          }
        >
          {t("Log portion")}
        </button>
        {favorite ? (
          <button
            className="ft-secondary"
            disabled={busy}
            onClick={() =>
              act(() => axios.delete(`${API}/favorite-foods/${row.id}`))
            }
          >
            {t("Remove favorite")}
          </button>
        ) : (
          <button
            className="ft-secondary"
            disabled={
              busy ||
              favorites.some(
                (f) =>
                  f.food_name.toLowerCase() === row.food_name.toLowerCase(),
              )
            }
            onClick={() =>
              act(() =>
                axios.post(`${API}/favorite-foods`, payload("food", row)),
              )
            }
          >
            {t("Favorite")}
          </button>
        )}
      </div>
    </div>
  );
  return (
    <section className="ft-card ft-form" data-testid="quick-foods">
      <h2>{t("Quick food logging")}</h2>
      <div className="ft-row">
        <label>
          {t("Copy to date")}
          <input
            type="date"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
        <MealType value={category} onChange={setCategory} />
      </div>
      <p className="ft-muted">
        {t(
          "Log the same portion on the chosen date, or save it as a favorite.",
        )}
      </p>
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => setRevision((v) => v + 1)}>
            {t("Retry")}
          </button>
        </p>
      )}
      <h3>{t("Favorites")}</h3>
      {favorites.map((r) => render(r, true))}
      {!favorites.length && <p>{t("No favorites yet")}</p>}
      <h3>{t("Recent foods")}</h3>
      {rows.map((r) => render(r, false))}
      {!rows.length && <p>{t("No food logged yet")}</p>}
    </section>
  );
}
export function ExerciseProgress({ selectedDate }) {
  const [days, setDays] = useState(90),
    [rows, setRows] = useState([]),
    [name, setName] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    axios
      .get(`${API}/exercise-progress`, {
        params: {
          start: dateString(subDays(dateObject(selectedDate), days - 1)),
          end: selectedDate,
        },
      })
      .then((r) => {
        if (alive) {
          setRows(r.data);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e, t("Could not complete action")));
      });
    return () => {
      alive = false;
    };
  }, [days, selectedDate]);
  const names = [...new Set(rows.map((r) => r.name.toLowerCase()))],
    chosen = names.includes(name) ? name : names[0] || "",
    series = rows.filter((r) => r.name.toLowerCase() === chosen),
    last = series.at(-1),
    previous = series.at(-2);
  return (
    <section className="ft-card ft-form" data-testid="exercise-progress">
      <h2>{t("Exercise progress")}</h2>
      <div className="ft-row">
        <label>
          {t("Period")}
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[30, 90, 365].map((n) => (
              <option key={n} value={n}>
                {n} {t("days")}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Exercise")}
          <select value={chosen} onChange={(e) => setName(e.target.value)}>
            {names.map((n) => (
              <option key={n} value={n}>
                {rows.find((r) => r.name.toLowerCase() === n).name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {last ? (
        <>
          <p>
            {last.date}: {last.max_weight_kg} kg · {last.max_reps} {t("Reps")} ·{" "}
            {last.volume_kg} kg {t("Total volume")}
          </p>
          {previous && (
            <p className="ft-muted">
              {t("Previous")}: {previous.date} · {previous.max_weight_kg} kg ·{" "}
              {previous.max_reps} {t("Reps")} · {previous.volume_kg} kg
            </p>
          )}
          <div className="ft-progress-grid">
            <Chart
              rows={series}
              value={(r) => r.max_weight_kg}
              title="Load (kg)"
              unit="kg"
            />
            <Chart
              rows={series}
              value={(r) => r.max_reps}
              title="Reps"
              unit="reps"
            />
            <Chart
              rows={series}
              value={(r) => r.volume_kg}
              title="Total volume"
              unit="kg"
            />
          </div>
        </>
      ) : (
        <p>{t("No completed sets yet")}</p>
      )}
      <p className="ft-muted">
        {t("Charts group working sets by day. Warm-up sets are excluded.")}
      </p>
    </section>
  );
}
export function TrainingCalendar({ selectedDate, onSelect, onOpenTraining }) {
  const [rows, setRows] = useState([]),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const base = dateString(
    startOfWeek(startOfMonth(dateObject(selectedDate)), { weekStartsOn: 1 }),
  );
  useEffect(() => {
    let alive = true;
    axios
      .get(`${API}/training-calendar`, {
        params: {
          start: dateString(subDays(dateObject(base), 7)),
          end: dateString(addDays(dateObject(base), 41)),
        },
      })
      .then((r) => {
        if (alive) {
          setRows(r.data);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e, t("Could not complete action")));
      });
    return () => {
      alive = false;
    };
  }, [base, revision]);
  const week = startOfWeek(dateObject(selectedDate), { weekStartsOn: 1 });
  const total = (offset) => {
    const start = dateString(addDays(week, offset)),
      end = dateString(addDays(week, offset + 6));
    return rows
      .filter((r) => r.date >= start && r.date <= end)
      .reduce(
        (a, r) => ({
          sessions: a.sessions + r.completed,
          minutes: a.minutes + r.minutes,
          volume: a.volume + r.volume_kg,
        }),
        { sessions: 0, minutes: 0, volume: 0 },
      );
  };
  const current = total(0),
    previous = total(-7);
  return (
    <div className="ft-content">
      <section className="ft-card ft-form" data-testid="training-calendar">
        <div className="ft-section-head">
          <button
            className="ft-secondary"
            aria-label={t("Previous month")}
            onClick={() =>
              onSelect(
                dateString(
                  addMonths(startOfMonth(dateObject(selectedDate)), -1),
                ),
              )
            }
          >
            ‹
          </button>
          <h2>{selectedDate.slice(0, 7)}</h2>
          <button
            className="ft-secondary"
            aria-label={t("Next month")}
            onClick={() =>
              onSelect(
                dateString(
                  addMonths(startOfMonth(dateObject(selectedDate)), 1),
                ),
              )
            }
          >
            ›
          </button>
        </div>
        {error && (
          <p role="alert">
            {error}
            <button onClick={() => setRevision((v) => v + 1)}>
              {t("Retry")}
            </button>
          </p>
        )}
        <div className="ft-calendar-grid">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((k) => (
            <span key={k}>{t(k)}</span>
          ))}
          {rows
            .filter((r) => r.date >= base)
            .map((r) => (
              <button
                key={r.date}
                aria-pressed={r.date === selectedDate}
                aria-label={`${r.date}: ${r.program?.name || t(r.day_type === "training" ? "Training day" : "Rest day")}; ${r.completed} ${t("sessions")}`}
                className={
                  r.date === selectedDate ? "ft-primary" : "ft-secondary"
                }
                onClick={() => onSelect(r.date)}
              >
                <strong>{Number(r.date.slice(-2))}</strong>
                <span>
                  {r.completed
                    ? "✓ " + r.completed
                    : r.day_type === "training"
                      ? "●"
                      : "–"}
                </span>
              </button>
            ))}
        </div>
        <p>{t("● Planned · ✓ Completed · – Rest")}</p>
        <h3>{t("Weekly comparison")}</h3>
        <div className="ft-table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t("Week")}</th>
                <th>{t("sessions")}</th>
                <th>min</th>
                <th>{t("Total volume")} (kg)</th>
              </tr>
            </thead>
            <tbody>
              {[
                [t("Selected week"), current],
                [t("Previous week"), previous],
              ].map(([label, v]) => (
                <tr key={label}>
                  <th>{label}</th>
                  <td>{v.sessions}</td>
                  <td>{v.minutes}</td>
                  <td>{Math.round(v.volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <DayPlanCard
        key={selectedDate + revision}
        selectedDate={selectedDate}
        onChange={() => setRevision((v) => v + 1)}
        onOpenTraining={onOpenTraining}
      />
    </div>
  );
}
export function AccountSecurity({ user, onSignedOut }) {
  const [password, setPassword] = useState(""),
    [next, setNext] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function action(kind) {
    if (
      !window.confirm(
        t(
          kind === "account"
            ? "Permanently delete your account and all live data?"
            : "This signs you out on every device. Pending local entries and the saved workout will be removed. Continue?",
        ),
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      if (kind === "account")
        await axios.delete(`${API}/auth/account`, {
          data: { password, confirm_username: confirm },
        });
      else
        await axios.post(`${API}/auth/${kind}`, {
          password,
          ...(kind === "change-password" ? { new_password: next } : {}),
        });
      await clearOffline(user.id);
      storage.set(`fittrack-workout:${user.id}`, "null");
      setOfflineUser(null);
      onSignedOut();
    } catch (e) {
      setError(errorMessage(e, t("Could not complete action")));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ft-card ft-form">
      <h2>{t("Account security")}</h2>
      <label>
        {t("Current password")}
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        {t("New password")}
        <input
          type="password"
          autoComplete="new-password"
          minLength="12"
          maxLength="128"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <p className="ft-muted">
        {t(
          "Changing your password also invalidates your recovery code. Generate a new code after signing in.",
        )}
      </p>
      <div className="ft-row">
        <button
          className="ft-secondary"
          disabled={busy || password.length < 12 || next.length < 12}
          onClick={() => action("change-password")}
        >
          {t("Change password")}
        </button>
        <button
          className="ft-secondary"
          disabled={busy || password.length < 12}
          onClick={() => action("logout-all")}
        >
          {t("Sign out all devices")}
        </button>
      </div>
      <details>
        <summary>{t("Delete account")}</summary>
        <p>
          {t(
            "Deletion is permanent for live data. Existing private server backups expire under the operator’s retention policy.",
          )}
        </p>
        <label>
          {t("Type your username to confirm")}
          <input
            autoComplete="off"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        <button
          className="ft-danger-text"
          disabled={busy || password.length < 12 || confirm !== user.username}
          onClick={() => action("account")}
        >
          {t("Delete account")}
        </button>
      </details>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function CopyFoodButton({ row, selectedDate, onRefresh }) {
  const [open, setOpen] = useState(false),
    [date, setDate] = useState(selectedDate),
    [category, setCategory] = useState(row.meal_type || "snack"),
    [busy, setBusy] = useState(false);
  return (
    <div>
      <button
        className="ft-secondary"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
      >
        {t("Copy food")}
      </button>
      {open && (
        <form
          className="ft-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await axios.post(`${API}/food/${row.id}/copy`, {
                date,
                meal_type: category,
              });
              setOpen(false);
              await onRefresh();
              toast.success(t("Saved"));
            } catch (err) {
              toast.error(errorMessage(err, t("Could not complete action")));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {t("Copy to date")}
            <input
              required
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <MealType value={category} onChange={setCategory} />
          <button disabled={busy} className="ft-primary">
            {t("Copy portion")}
          </button>
        </form>
      )}
    </div>
  );
}

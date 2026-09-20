import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API, errorMessage } from "@/lib/api";
import { t, storage } from "@/lib/i18n";
import { useDraft } from "@/lib/drafts";
import { ExerciseProgress } from "./DailyTools";
const freshExercise = () => ({
  name: "",
  sets: 3,
  reps: 10,
  weight_kg: 0,
  rest_seconds: 90,
});
export function PlannedExercises({ value, onChange }) {
  return (
    <div>
      {value.map((e, i) => (
        <div className="ft-form ft-exercise-plan" key={i}>
          <label>
            {t("Exercise")}
            <input
              required
              value={e.name}
              maxLength={120}
              onChange={(x) =>
                onChange(
                  value.map((r, j) =>
                    j === i ? { ...r, name: x.target.value } : r,
                  ),
                )
              }
            />
          </label>
          <div className="ft-row">
            {["sets", "reps", "weight_kg", "rest_seconds"].map((k) => (
              <label key={k}>
                {t(
                  {
                    sets: "Sets",
                    reps: "Reps",
                    weight_kg: "Load (kg)",
                    rest_seconds: "Rest (seconds)",
                  }[k],
                )}
                <input
                  type="number"
                  required
                  min={k === "sets" || k === "reps" ? 1 : 0}
                  max={k === "sets" ? 30 : k === "rest_seconds" ? 1800 : 1000}
                  step={k === "weight_kg" ? "any" : 1}
                  value={e[k]}
                  onChange={(x) =>
                    onChange(
                      value.map((r, j) =>
                        j === i ? { ...r, [k]: Number(x.target.value) } : r,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            className="ft-danger-text"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            {t("Remove")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="ft-secondary"
        onClick={() => onChange([...value, freshExercise()])}
      >
        {t("Add exercise")}
      </button>
    </div>
  );
}
export function ProgramEditor({ program, onCancel, onSaved }) {
  const [value, setValue] = useState(
      program || { name: "", weekdays: [], exercises: [freshExercise()] },
    ),
    [busy, setBusy] = useState(false);
  useDraft(
    JSON.stringify(value) !==
      JSON.stringify(
        program || { name: "", weekdays: [], exercises: [freshExercise()] },
      ),
  );
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = {
        name: value.name,
        weekdays: value.weekdays,
        exercises: value.exercises,
      };
      if (program) await axios.put(`${API}/programs/${program.id}`, body);
      else await axios.post(`${API}/programs`, body);
      onSaved();
    } catch (err) {
      toast.error(errorMessage(err, t("Could not complete action")));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="ft-card ft-form" onSubmit={save}>
      <h2>{t(program ? "Edit program" : "New program")}</h2>
      <label>
        {t("Name")}
        <input
          required
          maxLength={100}
          value={value.name}
          onChange={(e) => setValue({ ...value, name: e.target.value })}
        />
      </label>
      <div className="ft-row">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
          <label className="ft-check" key={d}>
            <input
              type="checkbox"
              checked={value.weekdays.includes(i)}
              onChange={(e) =>
                setValue({
                  ...value,
                  weekdays: e.target.checked
                    ? [...value.weekdays, i]
                    : value.weekdays.filter((x) => x !== i),
                })
              }
            />
            {t(d)}
          </label>
        ))}
      </div>
      <PlannedExercises
        value={value.exercises}
        onChange={(exercises) => setValue({ ...value, exercises })}
      />
      <div className="ft-row">
        <button
          disabled={busy || !value.exercises.length}
          className="ft-primary"
        >
          {t("Save")}
        </button>
        <button
          type="button"
          disabled={busy}
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
export function TrainingStudio({
  user,
  selectedDate,
  onRefresh,
  onPlanChange,
}) {
  const key = `fittrack-workout:${user.id}`;
  const [programs, setPrograms] = useState([]),
    [adding, setAdding] = useState(false),
    [localSaved, setLocalSaved] = useState(true),
    [newExercises, setNewExercises] = useState([freshExercise()]),
    [records, setRecords] = useState([]),
    [editing, setEditing] = useState(null),
    [active, setActive] = useState(() => {
      try {
        const saved = JSON.parse(storage.get(key));
        return saved &&
          Array.isArray(saved.sets) &&
          Number.isFinite(saved.started)
          ? saved
          : null;
      } catch {
        return null;
      }
    }),
    [now, setNow] = useState(Date.now()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let alive = true;
    Promise.all([
      axios.get(`${API}/programs`),
      axios.get(`${API}/personal-records`),
    ])
      .then(([a, b]) => {
        if (alive) {
          setPrograms(a.data);
          setRecords(b.data);
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
  useEffect(() => {
    setLocalSaved(storage.set(key, JSON.stringify(active)));
  }, [active, key]);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);
  useEffect(() => {
    if (active?.restUntil && now >= active.restUntil) {
      if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
      setActive((v) => (v ? { ...v, restUntil: null } : v));
    }
  }, [now, active]);
  async function start(program) {
    if (active && !window.confirm(t("Replace the saved workout?"))) return;
    setNow(Date.now());
    setActive({
      date: selectedDate,
      name: program.name,
      started: Date.now(),
      restUntil: null,
      sets: program.exercises.flatMap((e) =>
        Array.from({ length: e.sets }, (_, i) => ({
          ...e,
          set: i + 1,
          done: false,
        })),
      ),
    });
    try {
      await axios.put(`${API}/plan`, {
        date: selectedDate,
        day_type: "training",
        program_id: program.id,
      });
      onPlanChange();
    } catch {
      toast.info(t("Workout saved on this device; plan could not sync"));
    }
  }
  async function finish() {
    const done = active.sets.filter((e) => e.done);
    if (!done.length) return;
    setBusy(true);
    try {
      await axios.post(`${API}/training`, {
        date: active.date,
        training_type: "Strength",
        duration_minutes: Math.max(
          1,
          Math.min(1440, Math.round((Date.now() - active.started) / 60000)),
        ),
        program_name: active.name,
        sets_log: done.map(
          ({
            name,
            reps,
            weight_kg,
            warmup = false,
            superset = "",
            notes = "",
          }) => ({
            warmup,
            superset,
            notes,
            name,
            reps,
            weight_kg,
          }),
        ),
        exercises: [],
      });
      setActive(null);
      setRevision((v) => v + 1);
      await onRefresh();
      toast.success(t("Workout saved"));
    } catch (e) {
      toast.error(errorMessage(e, t("Could not complete action")));
    } finally {
      setBusy(false);
    }
  }
  if (editing)
    return (
      <ProgramEditor
        program={editing === "new" ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          setRevision((v) => v + 1);
          onPlanChange();
        }}
      />
    );
  return (
    <div className="ft-content">
      {error && (
        <p role="alert">
          {error}
          <button
            className="ft-secondary"
            onClick={() => setRevision((x) => x + 1)}
          >
            {t("Retry")}
          </button>
        </p>
      )}
      {active && (
        <section className="ft-card ft-form" data-testid="active-workout">
          <div className="ft-section-head">
            <h2>{active.name}</h2>
            <span>{active.date}</span>
          </div>
          <p className="ft-muted">
            {t(
              localSaved
                ? "Saved on this device"
                : "Local save failed. Keep this page open until the workout is saved.",
            )}{" "}
            · {Math.max(0, Math.floor((now - active.started) / 60000))} min ·{" "}
            {active.sets.filter((x) => x.done).length}/{active.sets.length}
          </p>
          <div className="ft-rest" role="timer" aria-label={t("Rest timer")}>
            {active.restUntil
              ? `${Math.max(0, Math.ceil((active.restUntil - now) / 1000))} s`
              : t("Ready for next set")}
            <button
              className="ft-secondary"
              onClick={() =>
                setActive({
                  ...active,
                  restUntil: active.restUntil ? null : Date.now() + 90000,
                })
              }
            >
              {t(active.restUntil ? "Skip rest" : "Start 90 s rest")}
            </button>
          </div>
          <p className="ft-muted">
            {t(
              "Rename a pending set to replace its exercise. Give paired sets the same superset group; rest begins after the group is complete.",
            )}
          </p>
          <button
            className="ft-secondary"
            disabled={busy}
            onClick={() => setAdding((v) => !v)}
          >
            {t("Add exercise during workout")}
          </button>
          {adding && (
            <form
              className="ft-form"
              onSubmit={(e) => {
                e.preventDefault();
                const extra = newExercises.flatMap((r) =>
                  Array.from({ length: r.sets }, (_, i) => ({
                    ...r,
                    set: i + 1,
                    done: false,
                  })),
                );
                if (active.sets.length + extra.length > 1500) {
                  toast.error(t("Too many sets"));
                  return;
                }
                setActive({ ...active, sets: [...active.sets, ...extra] });
                setNewExercises([freshExercise()]);
                setAdding(false);
              }}
            >
              <PlannedExercises
                value={newExercises}
                onChange={setNewExercises}
              />
              <button
                className="ft-primary"
                disabled={busy || !newExercises.length}
              >
                {t("Add to workout")}
              </button>
            </form>
          )}
          {active.sets.map((e, i) => {
            const previous = records.find(
              (r) => r.name.toLowerCase() === e.name.toLowerCase(),
            );
            return (
              <div
                className={"ft-set-row " + (e.done ? "ft-set-done" : "")}
                key={i}
              >
                <div>
                  <label>
                    {t("Exercise")}
                    <input
                      maxLength={120}
                      disabled={busy || e.done}
                      value={e.name}
                      onChange={(x) =>
                        setActive({
                          ...active,
                          sets: active.sets.map((r, j) =>
                            i === j ? { ...r, name: x.target.value } : r,
                          ),
                        })
                      }
                    />
                  </label>
                  <span>
                    {t("Sets")} {e.set}
                  </span>
                  {previous && (
                    <p className="ft-muted">
                      {t("Previous")}: {previous.last_set.reps} ×{" "}
                      {previous.last_set.weight_kg} kg
                    </p>
                  )}
                </div>
                <label>
                  {t("Reps")}
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    disabled={e.done || busy}
                    value={e.reps}
                    onChange={(x) =>
                      setActive({
                        ...active,
                        sets: active.sets.map((r, j) =>
                          j === i ? { ...r, reps: Number(x.target.value) } : r,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  kg
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    step="any"
                    disabled={e.done || busy}
                    value={e.weight_kg}
                    onChange={(x) =>
                      setActive({
                        ...active,
                        sets: active.sets.map((r, j) =>
                          j === i
                            ? { ...r, weight_kg: Number(x.target.value) }
                            : r,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  className={e.done ? "ft-secondary" : "ft-primary"}
                  disabled={
                    busy ||
                    !e.name.trim() ||
                    !Number.isInteger(e.reps) ||
                    e.reps < 1 ||
                    e.reps > 1000 ||
                    e.weight_kg < 0 ||
                    e.weight_kg > 1000
                  }
                  onClick={() =>
                    setActive({
                      ...active,
                      restUntil: e.done
                        ? active.restUntil
                        : e.superset &&
                            active.sets.some(
                              (r, j) =>
                                j !== i &&
                                !r.done &&
                                r.superset === e.superset &&
                                r.set === e.set &&
                                r.name !== e.name,
                            )
                          ? null
                          : Date.now() + e.rest_seconds * 1000,
                      sets: active.sets.map((r, j) =>
                        j === i ? { ...r, done: !r.done } : r,
                      ),
                    })
                  }
                >
                  {t(e.done ? "Undo" : "Done")}
                </button>
                <div className="ft-set-details">
                  <label className="ft-check">
                    <input
                      type="checkbox"
                      disabled={busy || e.done}
                      checked={e.warmup || false}
                      onChange={(x) =>
                        setActive({
                          ...active,
                          sets: active.sets.map((r, j) =>
                            i === j ? { ...r, warmup: x.target.checked } : r,
                          ),
                        })
                      }
                    />
                    {t("Warm-up")}
                  </label>
                  <label>
                    {t("Superset group")}
                    <input
                      maxLength={20}
                      disabled={busy || e.done}
                      placeholder="A"
                      value={e.superset || ""}
                      onChange={(x) =>
                        setActive({
                          ...active,
                          sets: active.sets.map((r, j) =>
                            i === j ? { ...r, superset: x.target.value } : r,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    {t("Set notes")}
                    <input
                      maxLength={500}
                      disabled={busy || e.done}
                      value={e.notes || ""}
                      onChange={(x) =>
                        setActive({
                          ...active,
                          sets: active.sets.map((r, j) =>
                            i === j ? { ...r, notes: x.target.value } : r,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    className="ft-danger-text"
                    disabled={busy || e.done}
                    onClick={() =>
                      setActive({
                        ...active,
                        sets: active.sets.filter((_, j) => j !== i),
                      })
                    }
                  >
                    {t("Remove")}
                  </button>
                </div>
              </div>
            );
          })}
          <div className="ft-row">
            <button
              className="ft-primary"
              disabled={busy || !active.sets.some((s) => s.done)}
              onClick={finish}
            >
              {t("Finish workout")}
            </button>
            <button
              className="ft-danger-text"
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("Discard workout?"))) setActive(null);
              }}
            >
              {t("Discard workout")}
            </button>
          </div>
        </section>
      )}
      <section className="ft-card ft-form">
        <div className="ft-section-head">
          <h2>{t("Programs")}</h2>
          <button className="ft-primary" onClick={() => setEditing("new")}>
            {t("New program")}
          </button>
        </div>
        {programs.map((p) => (
          <div className="ft-history-row" key={p.id}>
            <div>
              <strong>{p.name}</strong>
              <p className="ft-muted">
                {p.exercises.length} {t("Exercises")} ·{" "}
                {p.weekdays
                  .map((i) =>
                    t(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]),
                  )
                  .join(", ")}
              </p>
            </div>
            <div className="ft-row">
              <button className="ft-primary" onClick={() => start(p)}>
                {t("Start workout")}
              </button>
              <button className="ft-secondary" onClick={() => setEditing(p)}>
                {t("Edit")}
              </button>
              <button
                className="ft-danger-text"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm(t("Delete") + "?")) return;
                  setBusy(true);
                  try {
                    await axios.delete(`${API}/programs/${p.id}`);
                    setRevision((v) => v + 1);
                    onPlanChange();
                  } catch (e) {
                    toast.error(
                      errorMessage(e, t("Could not complete action")),
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("Delete")}
              </button>
            </div>
          </div>
        ))}
        {!programs.length && <p>{t("Create your first training program")}</p>}
      </section>
      <ExerciseProgress key={revision} selectedDate={selectedDate} />
      <section className="ft-card ft-form">
        <h2>{t("Personal records")}</h2>
        <p className="ft-muted">
          {t(
            "Records use completed sets. Volume is load × repetitions across all sessions.",
          )}
        </p>
        {records.map((r) => (
          <div className="ft-history-row" key={r.name}>
            <strong>{r.name}</strong>
            <div>
              {r.max_weight_kg} kg · {r.max_reps} {t("Reps")}
              <p className="ft-muted">
                {t("Total volume")}: {Math.round(r.total_volume_kg)} kg ·{" "}
                {r.total_sets} {t("Sets")}
              </p>
            </div>
          </div>
        ))}
        {!records.length && <p>{t("No completed sets yet")}</p>}
      </section>
    </div>
  );
}
export function DayPlanCard({ selectedDate, onChange, onOpenTraining }) {
  const [plan, setPlan] = useState(null),
    [programs, setPrograms] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([
      axios.get(`${API}/plan`, { params: { date: selectedDate } }),
      axios.get(`${API}/programs`),
    ])
      .then(([a, b]) => {
        if (alive) {
          setPlan(a.data);
          setPrograms(b.data);
        }
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e, t("Could not complete action")));
      });
    return () => {
      alive = false;
    };
  }, [selectedDate]);
  async function update(day_type, program_id = null) {
    setBusy(true);
    try {
      await axios.put(`${API}/plan`, {
        date: selectedDate,
        day_type,
        program_id,
      });
      setPlan(
        (await axios.get(`${API}/plan`, { params: { date: selectedDate } }))
          .data,
      );
      onChange();
      setError("");
    } catch (e) {
      setError(errorMessage(e, t("Could not complete action")));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ft-card ft-form">
      <div className="ft-section-head">
        <h2>{t("Today’s plan")}</h2>
        <button className="ft-secondary" onClick={onOpenTraining}>
          {t("Programs")}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {plan && (
        <>
          <div className="ft-row">
            <label>
              {t("Day type")}
              <select
                disabled={busy}
                value={plan.day_type}
                onChange={(e) => update(e.target.value)}
              >
                <option value="rest">{t("Rest day")}</option>
                <option value="training">{t("Training day")}</option>
              </select>
            </label>
            {plan.day_type === "training" && (
              <label>
                {t("Program")}
                <select
                  disabled={busy}
                  value={plan.program?.id || ""}
                  onChange={(e) => update("training", e.target.value || null)}
                >
                  <option value="">{t("No program")}</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p>
            {plan.program?.name ||
              t(
                plan.day_type === "rest"
                  ? "Recovery day"
                  : "Choose a program or log a workout",
              )}
          </p>
          {plan.program && (
            <button className="ft-primary" onClick={onOpenTraining}>
              {t("Open workout")}
            </button>
          )}
        </>
      )}
    </section>
  );
}

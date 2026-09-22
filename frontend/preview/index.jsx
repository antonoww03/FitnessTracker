import React from "react";
import { createRoot } from "react-dom/client";
import axios from "axios";
import App from "../src/App";

const localDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = localDate(new Date());
const macros = ["calories", "protein", "fat", "carbs", "sugar", "fiber"];
let goals = {
  calories: 2000,
  protein: 150,
  fat: 65,
  carbs: 250,
  sugar: 50,
  fiber: 30,
};
let counter = 10;
let preferences = { water_goal_ml: 3000, theme: "dark", language: "en" };
let profile = {
  first_name: "Demo",
  last_name: "User",
  age: 23,
  height_cm: 180,
  weight_kg: 75,
  gender: "male",
  photo_data_url: null,
};
const trash = {};
const db = {
  food: [
    {
      id: "demo-food-1",
      date: today,
      food_name: "Chicken, rice & vegetables",
      food_description: "Example meal",
      calories: 620,
      protein: 48,
      fat: 14,
      carbs: 74,
      sugar: 8,
      fiber: 7,
    },
    {
      id: "demo-food-2",
      date: today,
      food_name: "Yogurt & fruit",
      food_description: "Example snack",
      calories: 240,
      protein: 22,
      fat: 4,
      carbs: 30,
      sugar: 19,
      fiber: 3,
    },
  ],
  training: [
    {
      id: "demo-training-1",
      date: today,
      training_type: "Strength",
      duration_minutes: 45,
    },
  ],
  water: [{ id: "demo-water-1", date: today, amount_ml: 1500 }],
  weight: [{ id: today, date: today, weight_kg: 74.5 }],
  report: [],
  meal: [],
  favorite_food: [],
  program: [
    {
      id: "demo-program",
      name: "Back · Shoulders · Biceps",
      weekdays: [(new Date().getDay() + 6) % 7],
      exercises: [
        {
          name: "Lat pulldown",
          sets: 3,
          reps: 10,
          weight_kg: 40,
          rest_seconds: 90,
        },
        {
          name: "Shoulder press",
          sets: 3,
          reps: 10,
          weight_kg: 20,
          rest_seconds: 90,
        },
        {
          name: "Biceps curl",
          sets: 3,
          reps: 12,
          weight_kg: 12,
          rest_seconds: 60,
        },
      ],
    },
  ],
  recipe: [],
  measurements: [],
  day_plan: [],
};
for (let i = 1; i < 14; i++) {
  const d = new Date();
  d.setDate(d.getDate() - i);
  const date = localDate(d);
  db.weight.push({
    id: date,
    date,
    weight_kg: Math.round((74.5 + i * 0.04 + Math.sin(i) * 0.2) * 10) / 10,
  });
  db.food.push({
    ...db.food[0],
    id: "seed-" + i,
    date,
    calories: 1900 + (i % 4) * 90,
  });
}
let dayGoals = null;
function plan(day) {
  const explicit = db.day_plan.find((r) => r.date === day);
  const program = explicit
    ? db.program.find((p) => p.id === explicit.program_id)
    : db.program.find((p) =>
        p.weekdays.includes((new Date(day + "T12:00:00").getDay() + 6) % 7),
      );
  const day_type = explicit?.day_type || (program ? "training" : "rest");
  return {
    date: day,
    day_type,
    program: program || null,
    goals: dayGoals?.[day_type] || goals,
  };
}
function recipeValues(r) {
  const totals = Object.fromEntries(
    macros.map((k) => [
      k,
      r.ingredients.reduce((v, i) => v + (i.grams * i.per100[k]) / 100, 0),
    ]),
  );
  return {
    ...r,
    totals,
    per_portion: Object.fromEntries(
      macros.map((k) => [k, totals[k] / r.portions]),
    ),
  };
}
function summary(day) {
  const foods = db.food.filter((x) => x.date === day),
    trainings = db.training.filter((x) => x.date === day);
  return {
    date: day,
    totals: Object.fromEntries(
      macros.map((k) => [k, foods.reduce((sum, x) => sum + Number(x[k]), 0)]),
    ),
    goals: { ...plan(day).goals },
    total_training_minutes: trainings.reduce(
      (sum, x) => sum + x.duration_minutes,
      0,
    ),
    total_water_ml: db.water
      .filter((x) => x.date === day)
      .reduce((sum, x) => sum + x.amount_ml, 0),
    weight_kg: db.weight.find((x) => x.date === day)?.weight_kg ?? null,
    food_count: foods.length,
    training_count: trainings.length,
  };
}
function savedReport(day) {
  const s = summary(day);
  return {
    ...s,
    water_ml: s.total_water_ml,
    training_minutes: s.total_training_minutes,
  };
}
function reportList(period, day) {
  return [
    ...new Set(
      ["food", "training", "weight", "water", "report"].flatMap((k) =>
        db[k].map((r) => r.date),
      ),
    ),
  ]
    .map(savedReport)
    .filter((r) => {
      if (!period || period === "all") return true;
      if (period === "month") return r.date.slice(0, 7) === day.slice(0, 7);
      if (period === "year") return r.date.slice(0, 4) === day.slice(0, 4);
      const start = new Date(day + "T12:00:00");
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return r.date >= localDate(start) && r.date <= localDate(end);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
// All axios requests terminate in this in-memory adapter. No network or real backend.
axios.defaults.adapter = async (config) => {
  const url = new URL(config.url, "https://preview.invalid");
  for (const [k, v] of Object.entries(config.params || {}))
    url.searchParams.set(k, v);
  const path = url.pathname.replace(/^\/api/, "");
  const method = config.method.toUpperCase();
  const day = url.searchParams.get("date") || today;
  const body =
    typeof config.data === "string"
      ? JSON.parse(config.data || "{}")
      : config.data || {};
  let data;
  const fail = (message) => {
    const error = new Error(message);
    error.response = { data: { detail: message }, status: 503 };
    throw error;
  };
  if (path === "/auth/me") data = { id: "demo", username: "Demo" };
  else if (path.startsWith("/auth/"))
    fail(
      "Демо профил. Истинският вход е наличен само в приложението със сървър.",
    );
  else if (path === "/recent-foods")
    data = [
      ...new Map(
        [...db.food].reverse().map((r) => [r.food_name.toLowerCase(), r]),
      ).values(),
    ].slice(0, 20);
  else if (path === "/favorite-foods") {
    if (method === "POST") {
      data = { ...body, id: "favorite-" + ++counter };
      db.favorite_food.push(data);
    } else data = [...db.favorite_food];
  } else if (path.startsWith("/favorite-foods/")) {
    db.favorite_food = db.favorite_food.filter(
      (r) => r.id !== path.split("/")[2],
    );
    data = { ok: true };
  } else if (/^\/food\/[^/]+\/copy$/.test(path)) {
    const source = db.food.find((r) => r.id === path.split("/")[2]);
    if (!source) fail("Entry not found");
    data = { ...source, ...body, id: "copy-" + ++counter };
    db.food.push(data);
  } else if (path === "/exercise-progress") {
    const result = {};
    for (const row of db.training) {
      if (
        row.date < url.searchParams.get("start") ||
        row.date > url.searchParams.get("end")
      )
        continue;
      for (const e of row.sets_log || []) {
        if (e.warmup) continue;
        const key = e.name.toLowerCase() + row.date;
        const r =
          result[key] ||
          (result[key] = {
            name: e.name,
            date: row.date,
            max_weight_kg: 0,
            max_reps: 0,
            volume_kg: 0,
            sets: 0,
          });
        r.max_weight_kg = Math.max(r.max_weight_kg, e.weight_kg);
        r.max_reps = Math.max(r.max_reps, e.reps);
        r.volume_kg += e.weight_kg * e.reps;
        r.sets++;
      }
    }
    data = Object.values(result).sort((a, b) => a.date.localeCompare(b.date));
  } else if (path === "/training-calendar") {
    data = [];
    const d = new Date(url.searchParams.get("start") + "T12:00:00");
    while (localDate(d) <= url.searchParams.get("end")) {
      const date = localDate(d),
        logs = db.training.filter((r) => r.date === date);
      data.push({
        ...plan(date),
        completed: logs.length,
        minutes: logs.reduce((n, r) => n + r.duration_minutes, 0),
        volume_kg: logs
          .flatMap((r) => r.sets_log || [])
          .filter((e) => !e.warmup)
          .reduce((n, e) => n + e.reps * e.weight_kg, 0),
      });
      d.setDate(d.getDate() + 1);
    }
  } else if (path === "/plan") {
    if (method === "PUT") {
      db.day_plan = db.day_plan.filter((r) => r.date !== body.date);
      db.day_plan.push(body);
    }
    data = plan(body.date || day);
  } else if (path === "/day-goals") {
    if (method === "PUT") dayGoals = body;
    data = dayGoals || { training: { ...goals }, rest: { ...goals } };
  } else if (path === "/personal-records") {
    const records = {};
    for (const row of [...db.training].reverse())
      for (const set of [...(row.sets_log || [])].reverse()) {
        if (set.warmup) continue;
        const key = set.name.toLowerCase();
        const r =
          records[key] ||
          (records[key] = {
            name: set.name,
            max_weight_kg: 0,
            max_reps: 0,
            total_volume_kg: 0,
            total_sets: 0,
            last_date: row.date,
            last_set: set,
          });
        r.max_weight_kg = Math.max(r.max_weight_kg, set.weight_kg);
        r.max_reps = Math.max(r.max_reps, set.reps);
        r.total_volume_kg += set.weight_kg * set.reps;
        r.total_sets++;
      }
    data = Object.values(records);
  } else if (/^\/(programs|recipes|measurements)(\/|$)/.test(path)) {
    const [, group, id, action] = path.split("/");
    const kind = {
      programs: "program",
      recipes: "recipe",
      measurements: "measurements",
    }[group];
    if (action === "log") {
      const recipe = recipeValues(db.recipe.find((r) => r.id === id));
      data = {
        id: "recipe-food-" + ++counter,
        date: body.date,
        food_name: recipe.name,
        grams:
          (recipe.ingredients.reduce((v, i) => v + i.grams, 0) *
            body.portions) /
          recipe.portions,
        ...Object.fromEntries(
          macros.map((k) => [k, recipe.per_portion[k] * body.portions]),
        ),
      };
      db.food.push(data);
    } else if (method === "GET")
      data = db[kind].map((r) => (kind === "recipe" ? recipeValues(r) : r));
    else if (method === "DELETE") {
      db[kind] = db[kind].filter(
        (r) => (kind === "measurements" ? r.date : r.id) !== id,
      );
      data = { ok: true };
    } else {
      data = { ...body, id: id || "advanced-" + ++counter };
      if (kind === "measurements")
        db[kind] = db[kind].filter((r) => r.date !== body.date);
      else if (id) db[kind] = db[kind].filter((r) => r.id !== id);
      db[kind].push(data);
      if (kind === "recipe") data = recipeValues(data);
    }
  } else if (path === "/preferences") {
    if (method === "PUT") preferences = { ...body };
    data = { ...preferences };
  } else if (path === "/profile") {
    if (method === "PUT") profile = { ...body };
    data = { ...profile };
  } else if (path === "/history") {
    data = ["food", "training", "water", "weight"]
      .flatMap((kind) => db[kind].map((r) => ({ ...r, kind })))
      .filter(
        (r) =>
          r.date >= url.searchParams.get("start") &&
          r.date <= url.searchParams.get("end") &&
          ["all", r.kind].includes(url.searchParams.get("kind") || "all"),
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  } else if (path === "/progress") {
    data = [];
    const d = new Date(url.searchParams.get("start") + "T12:00:00"),
      end = url.searchParams.get("end");
    while (localDate(d) <= end) {
      const day = localDate(d),
        start = new Date(d);
      start.setDate(start.getDate() - 6);
      const weights = db.weight
        .filter((r) => r.date >= localDate(start) && r.date <= day)
        .map((r) => r.weight_kg);
      data.push({
        ...savedReport(day),
        weight_average_7d: weights.length
          ? Math.round(
              (weights.reduce((a, b) => a + b, 0) / weights.length) * 100,
            ) / 100
          : null,
      });
      d.setDate(d.getDate() + 1);
    }
  } else if (path.startsWith("/entries/")) {
    const [, , kind, id] = path.split("/");
    const row = db[kind].find((r) => r.id === id);
    if (!row) fail("Entry not found");
    if (method === "PUT") {
      Object.assign(row, body);
      data = row;
    } else {
      const token = "undo-" + ++counter;
      trash[token] = { kind, row };
      db[kind] = db[kind].filter((r) => r.id !== id);
      data = { undo_token: token };
    }
  } else if (path.startsWith("/undo/")) {
    const token = path.split("/")[2],
      item = trash[token];
    if (!item) fail("Undo expired");
    db[item.kind].push(item.row);
    delete trash[token];
    data = item.row;
  } else if (path === "/copy-day") {
    let copied = 0;
    for (const kind of body.kinds) {
      const items = db[kind].filter((r) => r.date === body.source);
      for (const r of items) {
        db[kind].push({ ...r, date: body.target, id: "copy-" + ++counter });
        copied++;
      }
    }
    data = { copied };
  } else if (path === "/meals") {
    if (method === "POST") {
      data = { ...body, id: "meal-" + ++counter };
      db.meal.push(data);
    } else data = [...db.meal];
  } else if (path.startsWith("/meals/")) {
    const id = path.split("/")[2],
      meal = db.meal.find((r) => r.id === id);
    if (!meal) fail("Meal not found");
    if (method === "DELETE") {
      db.meal = db.meal.filter((r) => r.id !== id);
      data = { ok: true };
    } else {
      meal.foods.forEach((r) =>
        db.food.push({ ...r, date: day, id: "meal-food-" + ++counter }),
      );
      data = { logged: meal.foods.length };
    }
  } else if (path === "/backup") {
    data = new Blob(
      [
        JSON.stringify({
          version: 1,
          records: { ...db, goals: [goals], preferences: [preferences] },
        }),
      ],
      { type: "application/json" },
    );
  } else if (path === "/backup/restore") {
    fail(
      "Възстановяването на резервно копие е достъпно в приложението със сървър.",
    );
  } else if (path === "/summary") data = summary(day);
  else if (path === "/goals") {
    if (method === "PUT") {
      if (dayGoals) dayGoals[plan(day).day_type] = { ...body };
      else goals = { ...body };
    }
    data = { ...goals };
  } else if (path === "/streak/water") {
    const days = new Set(db.water.map((x) => x.date));
    const d = new Date(day + "T12:00:00");
    if (!days.has(localDate(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(localDate(d))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    data = { streak: n };
  } else if (path === "/coach/tips") {
    const s = summary(day);
    data = {
      tips: macros
        .map((k) => ({
          type: k,
          tip: `${k}: ${s.totals[k]} ${k === "calories" ? "kcal" : "g"} logged against your ${goals[k]} target.`,
        }))
        .concat([
          { type: "water", tip: `Water logged: ${s.total_water_ml} ml.` },
        ]),
    };
  } else if (path.startsWith("/food/barcode/"))
    data = {
      barcode: path.split("/").pop(),
      food_name: "Demo protein pudding",
      source: "Open Food Facts",
      estimated: true,
      grams: 100,
      per100: true,
      missing: [],
      calories: 92,
      protein: 10,
      fat: 1.5,
      carbs: 8,
      sugar: 4,
      fiber: 1,
    };
  else if (path === "/food/analyze")
    fail(
      "В този преглед използвай Enter nutrition manually. USDA изисква работещ backend и API ключ.",
    );
  else if (path === "/reports/save") {
    const r = savedReport(day);
    db.report = db.report.filter((x) => x.date !== day);
    db.report.push(r);
    data = { ok: true, report: r };
  } else if (path === "/reports")
    data = reportList(url.searchParams.get("period"), day);
  else if (path.startsWith("/reports/") && method === "DELETE") {
    db.report = db.report.filter((x) => x.date !== path.split("/")[2]);
    data = { ok: true };
  } else if (path === "/export") {
    if (url.searchParams.get("format") === "pdf")
      fail("PDF export requires the live backend.");
    const fields = [
      "date",
      ...macros,
      "water_ml",
      "weight_kg",
      "training_minutes",
    ];
    const rows = reportList(url.searchParams.get("period"), day);
    const csv = [
      fields.join(","),
      ...rows.map((r) =>
        fields.map((k) => r.totals?.[k] ?? r[k] ?? "").join(","),
      ),
    ].join("\n");
    data = new Blob([csv], { type: "text/csv" });
  } else {
    const [kind, id] = path.split("/").filter(Boolean);
    if (!["food", "training", "water", "weight"].includes(kind))
      fail("This action is not available in the visual preview.");
    if (method === "GET") {
      const values = db[kind].filter((x) => x.date === day);
      data = kind === "weight" ? values[0] || null : values;
    } else if (method === "POST") {
      if (kind === "weight")
        db.weight = db.weight.filter((x) => x.date !== body.date);
      const entry = {
        ...body,
        id: `preview-${++counter}`,
        timestamp: new Date().toISOString(),
      };
      db[kind].push(entry);
      data = entry;
    } else if (method === "DELETE") {
      db[kind] = db[kind].filter((x) => (id ? x.id !== id : x.date !== day));
      data = { ok: true };
    }
  }
  return { data, status: 200, statusText: "OK", headers: {}, config };
};
// Demo-only confirmation: entries here never reach or delete real user data.
window.confirm = () => true;
createRoot(document.getElementById("fittrack-preview-app")).render(<App />);

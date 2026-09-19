import React, { useState, useEffect, useCallback, useRef } from "react";
import "@/App.css";
import axios from "axios";
import { format } from "date-fns";
import { Toaster } from "sonner";
import { Header } from "./components/Header";
import { MacrosDashboard } from "./components/MacrosDashboard";
import { FoodEntry } from "./components/FoodEntry";
import { TrainingLog } from "./components/TrainingLog";
import { DailyGoals } from "./components/DailyGoals";
import { ActivityFeed } from "./components/ActivityFeed";
import { WaterTracker } from "./components/WaterTracker";
import { WeightTracker } from "./components/WeightTracker";
import { CoachTips } from "./components/CoachTips";
import { Reports } from "./components/Reports";

import {
  Plus,
  X,
  LayoutDashboard,
  History,
  ChartNoAxesCombined,
  Scale,
  Dumbbell,
  Utensils,
  Droplets,
} from "lucide-react";

import { API } from "@/lib/api";

const DEFAULT_GOALS = {
  calories: 2000,
  protein: 150,
  fat: 65,
  carbs: 250,
  sugar: 50,
  fiber: 30,
};

const DEFAULT_TOTALS = {
  calories: 0,
  protein: 0,
  fat: 0,
  carbs: 0,
  sugar: 0,
  fiber: 0,
};

import { hasDrafts } from "./lib/drafts";
import { Account } from "./components/Account";
import {
  HistoryView,
  MealsView,
  ProgressView,
  SettingsView,
} from "./components/FeatureHub";
import { setLanguage, t, storage } from "./lib/i18n";
function AppContent({ user, onLogout }) {
  const [preferences, setPreferences] = useState({
    water_goal_ml: 3000,
    language: storage.get("fittrack-language") || "en",
    theme: storage.get("fittrack-theme") || "dark",
  });
  const dirty = useRef(false);
  const leave = () =>
    !(dirty.current || hasDrafts()) ||
    window.confirm(t("Unsaved changes. Discard them?"));
  const applyPreferences = (data) => {
    setLanguage(data.language);
    storage.set("fittrack-theme", data.theme);
    document.documentElement.dataset.theme = data.theme;
    setPreferences(data);
  };
  useEffect(() => {
    axios
      .get(`${API}/preferences`)
      .then((r) => applyPreferences(r.data))
      .catch(() => {});
    const guard = (e) => {
      if (dirty.current || hasDrafts()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  const [selectedDate, setSelectedDate] = useState(
    format(new Date(), "yyyy-MM-dd"),
  );
  const [goals, setGoals] = useState(DEFAULT_GOALS);
  const [totals, setTotals] = useState(DEFAULT_TOTALS);
  const [foods, setFoods] = useState([]);
  const [trainings, setTrainings] = useState([]);
  const [totalTrainingMinutes, setTotalTrainingMinutes] = useState(0);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [totalWaterMl, setTotalWaterMl] = useState(0);
  const [weightKg, setWeightKg] = useState(null);
  const [waterStreak, setWaterStreak] = useState(0);

  const [entryType, setEntryType] = useState(null);
  const currentDate = useRef(selectedDate);
  currentDate.current = selectedDate;
  const requestId = useRef(0);
  const [loading, setLoading] = useState(true);
  const [loadedDate, setLoadedDate] = useState(null);
  const [loadError, setLoadError] = useState(false);

  const fetchData = useCallback(async () => {
    if (selectedDate !== currentDate.current) return;
    const id = ++requestId.current;
    setLoading(true);
    setLoadError(false);
    try {
      const [summaryRes, foodsRes, trainingsRes, streakRes] = await Promise.all(
        [
          axios.get(`${API}/summary?date=${selectedDate}`),
          axios.get(`${API}/food?date=${selectedDate}`),
          axios.get(`${API}/training?date=${selectedDate}`),
          axios.get(`${API}/streak/water?date=${selectedDate}`),
        ],
      );
      if (id !== requestId.current || selectedDate !== currentDate.current)
        return;
      setLoadedDate(selectedDate);
      setTotals(summaryRes.data.totals);
      setGoals(summaryRes.data.goals);
      setTotalTrainingMinutes(summaryRes.data.total_training_minutes);
      setTotalWaterMl(summaryRes.data.total_water_ml || 0);
      setWeightKg(summaryRes.data.weight_kg);
      setFoods(foodsRes.data);
      setTrainings(trainingsRes.data);
      setWaterStreak(streakRes.data.streak || 0);
    } catch (err) {
      if (id === requestId.current && selectedDate === currentDate.current)
        setLoadError(true);
    } finally {
      if (id === requestId.current && selectedDate === currentDate.current)
        setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openEntry = (type = "food") => {
    if (!leave()) return;
    dirty.current = false;
    setEntryType(type);
    setActiveTab("dashboard");
  };
  const afterSave = async () => {
    dirty.current = false;
    await fetchData();
    if (currentDate.current === selectedDate) setEntryType(null);
  };
  const changeDate = (date) => {
    if (!leave()) return;
    dirty.current = false;
    setSelectedDate(date);
    setEntryType(null);
  };
  const waiting = loadedDate !== selectedDate && (loading || !loadError);

  return (
    <div
      className="ft-app"
      data-theme={preferences.theme}
      data-testid="app-root"
    >
      <Toaster theme={preferences.theme} position="top-right" />
      <div className="ft-shell">
        <Header
          selectedDate={selectedDate}
          onDateChange={changeDate}
          totalTrainingMinutes={totalTrainingMinutes}
        />
        <div className="ft-page-heading">
          <div>
            <span className="ft-eyebrow">{t("Your personal dashboard")}</span>
            <h1>
              {t(
                activeTab === "reports"
                  ? "Your reports"
                  : activeTab === "history"
                    ? "Your history"
                    : activeTab === "dashboard"
                      ? "A little better, every day."
                      : activeTab[0].toUpperCase() + activeTab.slice(1),
              )}
            </h1>
          </div>
          <button
            className="ft-primary"
            onClick={() => openEntry()}
            data-testid="add-entry-button"
          >
            <Plus size={18} />
            {t("Add entry")}
          </button>
        </div>
        <nav
          className="ft-nav"
          aria-label="Main navigation"
          data-testid="main-tabs"
        >
          {[
            ["dashboard", "Today", LayoutDashboard],
            ["history", "History", History],
            ["reports", "Reports", ChartNoAxesCombined],
          ].map(([key, label, Icon]) => (
            <button
              key={key}
              aria-current={activeTab === key ? "page" : undefined}
              onClick={() => {
                if (!leave()) return;
                dirty.current = false;
                setActiveTab(key);
                setEntryType(null);
                if (key === "dashboard")
                  setSelectedDate(format(new Date(), "yyyy-MM-dd"));
              }}
              data-testid={`tab-${key}`}
            >
              <Icon size={18} />
              <span>{t(label)}</span>
            </button>
          ))}
        </nav>
        <main>
          <div className="ft-tools">
            {["meals", "progress", "settings"].map((key) => (
              <button
                key={key}
                className={activeTab === key ? "ft-primary" : "ft-secondary"}
                onClick={() => {
                  if (!leave()) return;
                  dirty.current = false;
                  setEntryType(null);
                  setActiveTab(key);
                }}
              >
                {t(key[0].toUpperCase() + key.slice(1))}
              </button>
            ))}
          </div>
          {activeTab === "settings" ? (
            <SettingsView
              preferences={preferences}
              onSave={(data) => {
                applyPreferences(data);
                fetchData();
              }}
              user={user}
              onLogout={() => {
                if (leave()) onLogout();
              }}
            />
          ) : activeTab === "progress" ? (
            <ProgressView selectedDate={selectedDate} />
          ) : activeTab === "meals" ? (
            waiting ? (
              <p role="status">{t("Loading…")}</p>
            ) : loadError ? (
              <p role="alert">
                {t("Could not load this day.")}
                <button onClick={fetchData}>{t("Retry")}</button>
              </p>
            ) : (
              <MealsView
                key={selectedDate}
                selectedDate={selectedDate}
                foods={foods}
                onRefresh={fetchData}
              />
            )
          ) : activeTab === "reports" ? (
            <Reports selectedDate={selectedDate} />
          ) : waiting ? (
            <p role="status" className="ft-status">
              {t("Loading")}
              {selectedDate}…
            </p>
          ) : loadError ? (
            <div role="alert" className="ft-status">
              {t("Could not load this day.")}
              <button onClick={fetchData}>{t("Retry")}</button>
            </div>
          ) : (
            <div key={selectedDate} className="ft-content">
              {entryType && (
                <section
                  className="ft-entry-panel"
                  aria-label={t("Add entry")}
                  data-testid="entry-panel"
                  onChangeCapture={() => {
                    dirty.current = true;
                  }}
                >
                  <div className="ft-section-head">
                    <div>
                      <span className="ft-eyebrow">{selectedDate}</span>
                      <h2>{t("Add an entry")}</h2>
                    </div>
                    <button
                      className="ft-icon-button"
                      aria-label={t("Close entry form")}
                      onClick={() => {
                        if (leave()) {
                          dirty.current = false;
                          setEntryType(null);
                        }
                      }}
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <div className="ft-entry-types" aria-label="Entry type">
                    {[
                      ["food", "Food", Utensils],
                      ["training", "Training", Dumbbell],
                      ["water", "Water", Droplets],
                      ["weight", "Weight", Scale],
                    ].map(([key, label, Icon]) => (
                      <button
                        key={key}
                        aria-pressed={entryType === key}
                        onClick={() => {
                          if (leave()) {
                            dirty.current = false;
                            setEntryType(key);
                          }
                        }}
                        data-testid={`entry-type-${key}`}
                      >
                        <Icon size={17} />
                        {t(label)}
                      </button>
                    ))}
                  </div>
                  {entryType === "food" && (
                    <FoodEntry
                      selectedDate={selectedDate}
                      onFoodLogged={afterSave}
                    />
                  )}
                  {entryType === "training" && (
                    <TrainingLog
                      selectedDate={selectedDate}
                      onTrainingLogged={afterSave}
                    />
                  )}
                  {entryType === "water" && (
                    <WaterTracker
                      goalMl={preferences.water_goal_ml}
                      selectedDate={selectedDate}
                      totalWaterMl={totalWaterMl}
                      onWaterLogged={fetchData}
                      streak={waterStreak}
                      expanded
                    />
                  )}
                  {entryType === "weight" && (
                    <WeightTracker
                      selectedDate={selectedDate}
                      weightKg={weightKg}
                      onWeightLogged={afterSave}
                    />
                  )}
                </section>
              )}
              {activeTab === "dashboard" && (
                <>
                  <MacrosDashboard
                    totals={totals}
                    goals={goals}
                    onOpenGoals={() => setGoalsOpen(true)}
                  />
                  <div className="ft-essentials">
                    <WaterTracker
                      goalMl={preferences.water_goal_ml}
                      selectedDate={selectedDate}
                      totalWaterMl={totalWaterMl}
                      onWaterLogged={fetchData}
                      streak={waterStreak}
                      onExpand={() => openEntry("water")}
                    />
                    <section
                      className="ft-card ft-small-card"
                      data-testid="weight-summary"
                    >
                      <div className="ft-section-head">
                        <h2>
                          <Scale size={18} />
                          {t("Weight")}
                        </h2>
                        <button
                          className="ft-icon-button"
                          aria-label={t("Log weight")}
                          onClick={() => openEntry("weight")}
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                      <div
                        className="ft-stat-number"
                        data-testid="weight-summary-value"
                      >
                        {weightKg ?? "—"}
                        <span> kg</span>
                      </div>
                      <p className="ft-muted">
                        {t(
                          weightKg == null
                            ? "No measurement for this date"
                            : "Measurement for this date",
                        )}
                      </p>
                      <button
                        className="ft-text-button"
                        onClick={() => openEntry("weight")}
                      >
                        {t(
                          weightKg == null
                            ? "Log weight"
                            : "Update measurement",
                        )}
                      </button>
                    </section>
                    <section className="ft-card ft-small-card">
                      <div className="ft-section-head">
                        <h2>
                          <Dumbbell size={18} />
                          {t("Training")}
                        </h2>
                        <button
                          className="ft-icon-button"
                          aria-label={t("Log training")}
                          onClick={() => openEntry("training")}
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                      <div className="ft-stat-number">
                        {totalTrainingMinutes}
                        <span> min</span>
                      </div>
                      <p className="ft-muted">
                        {trainings.length}{" "}
                        {t(trainings.length === 1 ? "session" : "sessions")}{" "}
                        {t("logged")}
                      </p>
                      <button
                        className="ft-text-button"
                        onClick={() => openEntry("training")}
                      >
                        {t("Add a workout")}
                      </button>
                    </section>
                  </div>
                </>
              )}
              {activeTab === "history" ? (
                <HistoryView
                  selectedDate={selectedDate}
                  onRefresh={fetchData}
                />
              ) : (
                <ActivityFeed
                  foods={foods}
                  trainings={trainings}
                  onRefresh={fetchData}
                  selectedDate={selectedDate}
                />
              )}
              {activeTab === "dashboard" && (
                <details className="ft-review">
                  <summary>
                    {t("Daily review")}
                    <span>{t("Compare your intake with your targets")}</span>
                  </summary>
                  <CoachTips
                    key={JSON.stringify([
                      selectedDate,
                      totals,
                      goals,
                      totalWaterMl,
                      totalTrainingMinutes,
                    ])}
                    selectedDate={selectedDate}
                  />
                </details>
              )}
              {activeTab === "history" && (
                <p className="ft-muted">
                  {t(
                    "Use the date picker or arrows above to browse your daily entries.",
                  )}
                </p>
              )}
            </div>
          )}
        </main>
      </div>
      <DailyGoals
        open={goalsOpen}
        onOpenChange={setGoalsOpen}
        goals={goals}
        onGoalsUpdated={(newGoals) => {
          setGoals(newGoals);
          fetchData();
        }}
      />
    </div>
  );
}
function App() {
  return (
    <Account>
      {(user, onLogout) => (
        <AppContent key={user.id} user={user} onLogout={onLogout} />
      )}
    </Account>
  );
}
export default App;

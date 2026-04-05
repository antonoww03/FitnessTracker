import React, { useState, useEffect, useCallback } from "react";
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
import { Reports } from "./components/Reports";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

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

function App() {
  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [goals, setGoals] = useState(DEFAULT_GOALS);
  const [totals, setTotals] = useState(DEFAULT_TOTALS);
  const [foods, setFoods] = useState([]);
  const [trainings, setTrainings] = useState([]);
  const [totalTrainingMinutes, setTotalTrainingMinutes] = useState(0);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [totalWaterMl, setTotalWaterMl] = useState(0);
  const [weightKg, setWeightKg] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, foodsRes, trainingsRes, waterRes] = await Promise.all([
        axios.get(`${API}/summary?date=${selectedDate}`),
        axios.get(`${API}/food?date=${selectedDate}`),
        axios.get(`${API}/training?date=${selectedDate}`),
        axios.get(`${API}/water?date=${selectedDate}`),
      ]);
      setTotals(summaryRes.data.totals);
      setGoals(summaryRes.data.goals);
      setTotalTrainingMinutes(summaryRes.data.total_training_minutes);
      setTotalWaterMl(summaryRes.data.total_water_ml || 0);
      setWeightKg(summaryRes.data.weight_kg);
      setFoods(foodsRes.data);
      setTrainings(trainingsRes.data);
    } catch (err) {
      console.error("Failed to fetch data:", err);
    }
  }, [selectedDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Also fetch goals on mount
  useEffect(() => {
    const fetchGoals = async () => {
      try {
        const res = await axios.get(`${API}/goals`);
        setGoals(res.data);
      } catch (err) {
        console.error("Failed to fetch goals:", err);
      }
    };
    fetchGoals();
  }, []);

  return (
    <div className="min-h-screen bg-[#0A0A0A]" data-testid="app-root">
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: {
            background: "#141414",
            border: "1px solid #2A2A2A",
            color: "#FFFFFF",
            fontFamily: "'DM Sans', sans-serif",
          },
        }}
      />

      <div className="max-w-6xl mx-auto p-4 md:p-6 lg:p-8">
        <Header
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          totalTrainingMinutes={totalTrainingMinutes}
        />

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-[#141414] rounded-md p-1 w-fit border border-[#2A2A2A]" data-testid="main-tabs">
          <button
            onClick={() => setActiveTab("dashboard")}
            className={`px-4 py-1.5 rounded-md text-sm font-heading uppercase tracking-wider transition-all duration-200 ${activeTab === "dashboard" ? "bg-[#007AFF] text-white" : "text-[#A0A0A0] hover:text-white"}`}
            data-testid="tab-dashboard"
          >
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab("reports")}
            className={`px-4 py-1.5 rounded-md text-sm font-heading uppercase tracking-wider transition-all duration-200 ${activeTab === "reports" ? "bg-[#007AFF] text-white" : "text-[#A0A0A0] hover:text-white"}`}
            data-testid="tab-reports"
          >
            Reports
          </button>
        </div>

        {activeTab === "dashboard" ? (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
          {/* Macros Dashboard */}
          <div className="md:col-span-2 lg:col-span-2 animate-slide-up stagger-1">
            <MacrosDashboard
              totals={totals}
              goals={goals}
              onOpenGoals={() => setGoalsOpen(true)}
            />
          </div>

          {/* Water Tracker */}
          <div className="md:col-span-1 lg:col-span-1 animate-slide-up stagger-2">
            <WaterTracker
              selectedDate={selectedDate}
              totalWaterMl={totalWaterMl}
              onWaterLogged={fetchData}
            />
          </div>

          {/* Forms: Food + Training + Weight */}
          <div className="md:col-span-3 lg:col-span-1 space-y-4 md:space-y-6">
            <div className="animate-slide-up stagger-3">
              <FoodEntry selectedDate={selectedDate} onFoodLogged={fetchData} />
            </div>
            <div className="animate-slide-up stagger-4">
              <TrainingLog selectedDate={selectedDate} onTrainingLogged={fetchData} />
            </div>
            <div className="animate-slide-up stagger-5">
              <WeightTracker selectedDate={selectedDate} weightKg={weightKg} onWeightLogged={fetchData} />
            </div>
          </div>

          {/* Activity Feed */}
          <div className="md:col-span-3 lg:col-span-4 animate-slide-up stagger-6">
            <ActivityFeed
              foods={foods}
              trainings={trainings}
              onRefresh={fetchData}
            />
          </div>
        </div>
        ) : (
          <Reports selectedDate={selectedDate} />
        )}
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

export default App;

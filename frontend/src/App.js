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

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, foodsRes, trainingsRes] = await Promise.all([
        axios.get(`${API}/summary?date=${selectedDate}`),
        axios.get(`${API}/food?date=${selectedDate}`),
        axios.get(`${API}/training?date=${selectedDate}`),
      ]);
      setTotals(summaryRes.data.totals);
      setGoals(summaryRes.data.goals);
      setTotalTrainingMinutes(summaryRes.data.total_training_minutes);
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

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
          {/* Macros Dashboard - spans 2 cols on large */}
          <div className="md:col-span-2 lg:col-span-2 animate-slide-up stagger-1">
            <MacrosDashboard
              totals={totals}
              goals={goals}
              onOpenGoals={() => setGoalsOpen(true)}
            />
          </div>

          {/* Right column: Food + Training */}
          <div className="md:col-span-1 lg:col-span-2 space-y-4 md:space-y-6">
            <div className="animate-slide-up stagger-2">
              <FoodEntry selectedDate={selectedDate} onFoodLogged={fetchData} />
            </div>
            <div className="animate-slide-up stagger-3">
              <TrainingLog selectedDate={selectedDate} onTrainingLogged={fetchData} />
            </div>
          </div>

          {/* Activity Feed - full width */}
          <div className="md:col-span-3 lg:col-span-4 animate-slide-up stagger-4">
            <ActivityFeed
              foods={foods}
              trainings={trainings}
              onRefresh={fetchData}
            />
          </div>
        </div>
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

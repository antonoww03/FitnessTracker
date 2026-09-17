import React from "react";
import { CircularProgress } from "./CircularProgress";
import { Settings } from "lucide-react";
import { Button } from "../components/ui/button";

const MACRO_CONFIG = [
  { key: "protein", label: "Protein", color: "#007AFF", unit: "g" },
  { key: "fat", label: "Fat", color: "#FF9F0A", unit: "g" },
  { key: "carbs", label: "Carbs", color: "#FF3B30", unit: "g" },
  { key: "sugar", label: "Sugar", color: "#FF2D55", unit: "g" },
  { key: "fiber", label: "Fiber", color: "#32D74B", unit: "g" },
];

export const MacrosDashboard = ({ totals, goals, onOpenGoals }) => {
  const calorieProgress = goals.calories > 0
    ? (totals.calories / goals.calories) * 100
    : 0;

  return (
    <div className="ft-card p-5 md:p-6" data-testid="macros-dashboard">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-heading text-lg uppercase tracking-widest font-bold text-white">
          Daily Macros
        </h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenGoals}
          className="text-[#A0A0A0] hover:text-white hover:bg-[#2A2A2A]"
          aria-label="Edit daily goals"
          data-testid="open-goals-button"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-col items-center gap-6">
        {/* Main calorie circle */}
        <CircularProgress
          size={180}
          strokeWidth={10}
          progress={calorieProgress}
          color="#FFFFFF"
          label="Calories"
          value={totals.calories}
          unit="kcal"
          goal={goals.calories}
        />

        {/* Macro circles grid */}
        <div className="grid grid-cols-3 xl:grid-cols-5 gap-3 w-full" data-testid="macro-circles-grid">
          {MACRO_CONFIG.map((macro) => {
            const val = totals[macro.key] || 0;
            const goalVal = goals[macro.key] || 0;
            const prog = goalVal > 0 ? (val / goalVal) * 100 : 0;
            return (
              <CircularProgress
                key={macro.key}
                size={72}
                strokeWidth={5}
                progress={prog}
                color={macro.color}
                label={macro.label}
                value={val}
                unit={macro.unit}
                goal={goalVal}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

import React, { useState } from "react";
import { Button } from "../components/ui/button";
import { Trash2, UtensilsCrossed, Dumbbell, Save } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";

import { API } from "@/lib/api";

export const ActivityFeed = ({ foods, trainings, onRefresh, selectedDate }) => {

  const [busy, setBusy] = useState(false);

  const handleSaveDay = async () => {
    if (busy) return;
    const confirmSave = window.confirm("Are you sure you want to save this day?");
    if (!confirmSave) return;

    setBusy(true);
    try {
      await axios.post(`${API}/reports/save`, null, {
        params: { date: selectedDate }
      });

      toast.success("Day saved to reports");
    } catch {
      toast.error("Failed to save report");
    } finally { setBusy(false); }
  };

  const handleDeleteFood = async (id) => {
    setBusy(true);
    try {
      await axios.delete(`${API}/food/${id}`);
      toast.success("Food entry removed");
      onRefresh();
    } catch {
      toast.error("Failed to delete.");
    } finally { setBusy(false); }
  };

  const handleDeleteTraining = async (id) => {
    setBusy(true);
    try {
      await axios.delete(`${API}/training/${id}`);
      toast.success("Training entry removed");
      onRefresh();
    } catch {
      toast.error("Failed to delete.");
    } finally { setBusy(false); }
  };

  const hasItems = foods.length > 0 || trainings.length > 0;

  return (
      <div className="ft-card p-5">

        <div className="flex justify-between items-center mb-4">
          <h2 className="text-white font-bold uppercase">Activity — {selectedDate}</h2>

          <Button disabled={busy} onClick={handleSaveDay} className="bg-green-600 hover:bg-green-700">
            <Save className="h-4 w-4 mr-1" />
            Save Day
          </Button>
        </div>

        {!hasItems && (
            <p className="text-[#555] text-center py-6">
              No entries yet. Start logging your meals and workouts.
            </p>
        )}

        <div className="space-y-1">
          {foods.map((food) => (
              <div key={food.id} className="activity-item flex justify-between px-3 py-2">
                <div className="flex gap-3">
                  <UtensilsCrossed className="text-blue-500" />
                  <div>
                    <p className="text-white">{food.food_name}</p>
                    <p className="text-xs text-gray-400">
                      {Math.round(food.calories)} kcal
                    </p>
                  </div>
                </div>
                <Button disabled={busy} aria-label={`Delete ${food.food_name}`} onClick={() => handleDeleteFood(food.id)}>
                  <Trash2 />
                </Button>
              </div>
          ))}

          {trainings.map((t) => (
              <div key={t.id} className="activity-item flex justify-between px-3 py-2">
                <div className="flex gap-3">
                  <Dumbbell className="text-red-500" />
                  <div>
                    <p className="text-white">{t.training_type}</p>
                    <p className="text-xs text-gray-400">{t.duration_minutes} min</p>
                  </div>
                </div>
                <Button disabled={busy} aria-label={`Delete ${t.training_type}`} onClick={() => handleDeleteTraining(t.id)}>
                  <Trash2 />
                </Button>
              </div>
          ))}
        </div>
      </div>
  );
};
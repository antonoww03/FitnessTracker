import React from "react";
import { Button } from "../components/ui/button";
import { Trash2, UtensilsCrossed, Dumbbell, Clock } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const ActivityFeed = ({ foods, trainings, onRefresh }) => {
  const handleDeleteFood = async (id) => {
    try {
      await axios.delete(`${API}/food/${id}`);
      toast.success("Food entry removed");
      onRefresh();
    } catch (err) {
      toast.error("Failed to delete.");
    }
  };

  const handleDeleteTraining = async (id) => {
    try {
      await axios.delete(`${API}/training/${id}`);
      toast.success("Training entry removed");
      onRefresh();
    } catch (err) {
      toast.error("Failed to delete.");
    }
  };

  const hasItems = foods.length > 0 || trainings.length > 0;

  return (
    <div className="ft-card p-5" data-testid="activity-feed">
      <h2 className="font-heading text-lg uppercase tracking-widest font-bold text-white mb-4">
        Today's Activity
      </h2>

      {!hasItems && (
        <p className="text-[#555] text-sm font-body text-center py-6" data-testid="no-activity-message">
          No entries yet. Start logging your meals and workouts.
        </p>
      )}

      <div className="space-y-1">
        {foods.map((food, i) => (
          <div
            key={food.id}
            className="activity-item flex items-center justify-between px-3 py-2.5 rounded-md group"
            data-testid={`food-item-${i}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-7 h-7 rounded-md bg-[#007AFF]/10 flex items-center justify-center flex-shrink-0">
                <UtensilsCrossed className="h-3.5 w-3.5 text-[#007AFF]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-body font-medium text-white truncate">
                  {food.food_name}
                </p>
                <p className="text-[11px] text-[#A0A0A0] font-body">
                  {Math.round(food.calories)} kcal &middot; {Math.round(food.protein)}p &middot; {Math.round(food.carbs)}c &middot; {Math.round(food.fat)}f
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleDeleteFood(food.id)}
              className="h-7 w-7 opacity-0 group-hover:opacity-100 text-[#555] hover:text-[#FF3B30] hover:bg-[#FF3B30]/10 transition-all duration-150"
              data-testid={`delete-food-${i}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}

        {trainings.map((training, i) => (
          <div
            key={training.id}
            className="activity-item flex items-center justify-between px-3 py-2.5 rounded-md group"
            data-testid={`training-item-${i}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-7 h-7 rounded-md bg-[#FF3B30]/10 flex items-center justify-center flex-shrink-0">
                <Dumbbell className="h-3.5 w-3.5 text-[#FF3B30]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-body font-medium text-white">
                  {training.training_type}
                </p>
                <p className="text-[11px] text-[#A0A0A0] font-body flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {training.duration_minutes} min
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleDeleteTraining(training.id)}
              className="h-7 w-7 opacity-0 group-hover:opacity-100 text-[#555] hover:text-[#FF3B30] hover:bg-[#FF3B30]/10 transition-all duration-150"
              data-testid={`delete-training-${i}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};

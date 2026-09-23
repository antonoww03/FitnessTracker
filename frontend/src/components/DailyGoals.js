import {t} from "@/lib/i18n";
import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Loader2, Target } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";

import { API } from "@/lib/api";

const GOAL_FIELDS = [
  { key: "calories", label: "Calories", unit: "kcal", color: "#FFFFFF" },
  { key: "protein", label: "Protein", unit: "g", color: "#007AFF" },
  { key: "fat", label: "Fat", unit: "g", color: "#FF9F0A" },
  { key: "carbs", label: "Carbs", unit: "g", color: "#FF3B30" },
  { key: "sugar", label: "Sugar", unit: "g", color: "#FF2D55" },
  { key: "fiber", label: "Fiber", unit: "g", color: "#32D74B" },
];

export const DailyGoals = ({ open, onOpenChange, goals, onGoalsUpdated, selectedDate }) => {
  const [formGoals, setFormGoals] = useState(goals);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setFormGoals(goals);
    }
  }, [open, goals]);

  const handleSave = async () => {
    if (saving) return;
    if (Object.values(formGoals).some((value) => value === "" || !Number.isFinite(Number(value)) || Number(value) < 0)) {
      toast.error("Enter a non-negative number for every goal.");
      return;
    }
    setSaving(true);
    try {
      const res = await axios.put(`${API}/goals`, Object.fromEntries(Object.entries(formGoals).map(([key, value]) => [key, Number(value)])), {params:{date:selectedDate}});
      onGoalsUpdated(res.data);
      toast.success("Goals updated");
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to update goals.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#141414] border-[#2A2A2A] text-white max-w-md" data-testid="daily-goals-dialog">
        <DialogHeader>
          <DialogTitle className="font-body text-xl tracking-normal font-bold text-white flex items-center gap-2">
            <Target className="h-5 w-5 text-[#007AFF]" />{t("Daily Goals")}</DialogTitle>
          <DialogDescription className="text-[#A0A0A0] font-body text-sm">{t("Set your daily macro targets")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 mt-2">
          {GOAL_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1">
              <label
                className="text-[11px] tracking-normal font-body font-semibold"
                style={{ color: field.color }}
              >
                {field.label} ({field.unit})
              </label>
              <Input
                type="number"
                value={formGoals[field.key] ?? ""}
                onChange={(e) =>
                  setFormGoals({ ...formGoals, [field.key]: e.target.value })
                }
                min="0"
                className="bg-[#0A0A0A] border-[#2A2A2A] text-white focus:ring-1 focus:ring-[#007AFF] focus:border-[#007AFF] h-9 font-body text-sm"
                data-testid={`goal-input-${field.key}`}
              />
            </div>
          ))}
        </div>

        <Button
          onClick={handleSave}
          disabled={saving}
          className="mt-4 w-full bg-[#007AFF] hover:bg-[#0062CC] text-white font-body tracking-normal text-sm font-bold h-10 rounded-md"
          data-testid="save-goals-button"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}{t("Save Goals")}</Button>
      </DialogContent>
    </Dialog>
  );
};

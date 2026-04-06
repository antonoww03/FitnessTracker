import React, { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Scale, Check } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const WeightTracker = ({ selectedDate, weightKg, onWeightLogged }) => {
  const [weight, setWeight] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const w = parseFloat(weight);
    if (!w || w <= 0) return;
    setSaving(true);
    try {
      await axios.post(`${API}/weight`, { weight_kg: w, date: selectedDate });
      toast.success(`Weight logged: ${w} kg`);
      setWeight("");
      onWeightLogged();
    } catch (err) {
      toast.error("Failed to log weight.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ft-card p-5" data-testid="weight-tracker">
      <h2 className="font-heading text-lg uppercase tracking-widest font-bold text-white mb-3">
        <Scale className="inline h-4 w-4 text-[#A0A0A0] mr-1.5 -mt-0.5" />
        Weight
      </h2>

      {weightKg !== null && weightKg !== undefined && (
        <div className="mb-3 text-center" data-testid="current-weight-display">
          <span className="text-3xl font-bold font-body text-white">{weightKg}</span>
          <span className="text-sm text-[#A0A0A0] font-body ml-1">kg</span>
        </div>
      )}

      <div className="flex gap-2">
        <Input
          type="number"
          placeholder="Enter weight (kg)"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          step="0.1"
          min="0"
          className="bg-[#0A0A0A] border-[#2A2A2A] text-white placeholder:text-[#555] focus:ring-1 focus:ring-[#007AFF] focus:border-[#007AFF] h-9 font-body text-sm flex-1"
          data-testid="weight-input"
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
        <Button
          onClick={handleSave}
          disabled={saving || !weight}
          className="bg-[#007AFF] hover:bg-[#0062CC] text-white h-9 px-4 rounded-md"
          data-testid="save-weight-button"
        >
          <Check className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

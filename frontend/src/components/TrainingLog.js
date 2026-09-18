import React, { useState } from "react";
import axios from "axios";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Loader2, Dumbbell } from "lucide-react";
import { toast } from "sonner";

import { API } from "@/lib/api";

const TRAINING_TYPES = [
  "Strength",
  "Cardio",
  "HIIT",
  "Yoga",
  "Swimming",
  "Cycling",
  "Running",
  "Walking",
];

export const TrainingLog = ({ selectedDate, onTrainingLogged }) => {
  const [trainingType, setTrainingType] = useState("");
  const [duration, setDuration] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (saving) return;
    if (!trainingType || !Number.isInteger(Number(duration)) || Number(duration) <= 0 || Number(duration) > 1440) {
      toast.error("Select a type and enter duration.");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/training`, {
        training_type: trainingType,
        duration_minutes: Number(duration),
        date: selectedDate,
      });
      toast.success(`${trainingType} - ${duration}min logged`);
      setTrainingType("");
      setDuration("");
      onTrainingLogged();
    } catch (err) {
      toast.error("Failed to log training.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ft-card p-5" data-testid="training-log">
      <h2 className="font-body text-lg tracking-normal font-bold text-white mb-4">
        Log Training
      </h2>

      <div className="space-y-3">
        <Select value={trainingType} onValueChange={setTrainingType}>
          <SelectTrigger
            className="bg-[#0A0A0A] border-[#2A2A2A] text-white focus:ring-1 focus:ring-[#007AFF] h-10 font-body text-sm"
            data-testid="training-type-select"
          >
            <SelectValue placeholder="Select training type" />
          </SelectTrigger>
          <SelectContent className="bg-[#141414] border-[#2A2A2A]">
            {TRAINING_TYPES.map((type) => (
              <SelectItem
                key={type}
                value={type}
                className="text-white hover:bg-[#2A2A2A] focus:bg-[#2A2A2A] focus:text-white font-body text-sm cursor-pointer"
                data-testid={`training-type-${type.toLowerCase()}`}
              >
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="number"
          placeholder="Duration (minutes)"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          min="1"
          max="1440"
          step="1"
          className="bg-[#0A0A0A] border-[#2A2A2A] text-white placeholder:text-[#555] focus:ring-1 focus:ring-[#007AFF] focus:border-[#007AFF] h-10 font-body text-sm"
          data-testid="training-duration-input"
        />

        <Button
          onClick={handleSubmit}
          disabled={saving || !trainingType || !duration}
          className="w-full bg-[#007AFF] hover:bg-[#0062CC] text-white font-body tracking-normal text-sm font-bold h-10 rounded-md transition-all duration-200"
          data-testid="log-training-button"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Dumbbell className="h-4 w-4 mr-2" />
          )}
          Log Training
        </Button>
      </div>
    </div>
  );
};

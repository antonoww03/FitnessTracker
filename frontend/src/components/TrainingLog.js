import {t} from "@/lib/i18n";
import React, { useState, useEffect } from "react";
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

import {ExerciseEditor} from "./FeatureHub";
import {format,subDays} from "date-fns";

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
  const [exercises,setExercises]=useState([]);
  const [previous,setPrevious]=useState(null);
  useEffect(()=>{const c=new AbortController();axios.get(`${API}/history`,{params:{start:format(subDays(new Date(selectedDate+'T12:00:00'),366),'yyyy-MM-dd'),end:selectedDate,kind:'training'},signal:c.signal}).then(r=>setPrevious(r.data.find(x=>x.training_type===trainingType)||null)).catch(()=>setPrevious(null));return()=>c.abort()},[selectedDate,trainingType]);
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
        date: selectedDate, exercises,
      });
      toast.success(`${trainingType} - ${duration}min logged`);
      setTrainingType("");
      setDuration(""); setExercises([]);
      onTrainingLogged();
    } catch (err) {
      toast.error("Failed to log training.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ft-card p-5" data-testid="training-log">
      <h2 className="font-body text-lg tracking-normal font-bold text-white mb-4">{t("Log Training")}</h2>

      <div className="space-y-3">
        <Select value={trainingType} onValueChange={setTrainingType}>
          <SelectTrigger
            className="bg-[#0A0A0A] border-[#2A2A2A] text-white focus:ring-1 focus:ring-[#007AFF] h-10 font-body text-sm"
            data-testid="training-type-select"
          >
            <SelectValue placeholder={t("Select training type")} />
          </SelectTrigger>
          <SelectContent className="bg-[#141414] border-[#2A2A2A]">
            {TRAINING_TYPES.map((type) => (
              <SelectItem
                key={t(type)}
                value={t(type)}
                className="text-white hover:bg-[#2A2A2A] focus:bg-[#2A2A2A] focus:text-white font-body text-sm cursor-pointer"
                data-testid={`training-type-${type.toLowerCase()}`}
              >
                {t(type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="number"
          placeholder={t("Duration (minutes)")}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          min="1"
          max="1440"
          step="1"
          className="bg-[#0A0A0A] border-[#2A2A2A] text-white placeholder:text-[#555] focus:ring-1 focus:ring-[#007AFF] focus:border-[#007AFF] h-10 font-body text-sm"
          data-testid="training-duration-input"
        />

        <ExerciseEditor value={exercises} onChange={setExercises}/>
        {trainingType && <div className="ft-muted"><strong>{t("Previous workout")}</strong>{previous?<><p>{previous.date} · {previous.duration_minutes} min</p>{previous.exercises?.map((x,i)=><p key={i}>{x.name}: {x.sets} × {x.reps} · {x.weight_kg} kg</p>)}</>:<p>{t("No previous workout")}</p>}</div>}
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
          )}{t("Log Training")}</Button>
      </div>
    </div>
  );
};

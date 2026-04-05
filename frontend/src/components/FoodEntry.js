import React, { useState } from "react";
import axios from "axios";
import { Textarea } from "../components/ui/textarea";
import { Button } from "../components/ui/button";
import { Loader2, Sparkles, Check, X } from "lucide-react";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const MACRO_DISPLAY = [
  { key: "calories", label: "Cal", color: "#FFFFFF", unit: "kcal" },
  { key: "protein", label: "Protein", color: "#007AFF", unit: "g" },
  { key: "fat", label: "Fat", color: "#FF9F0A", unit: "g" },
  { key: "carbs", label: "Carbs", color: "#FF3B30", unit: "g" },
  { key: "sugar", label: "Sugar", color: "#FF2D55", unit: "g" },
  { key: "fiber", label: "Fiber", color: "#32D74B", unit: "g" },
];

export const FoodEntry = ({ selectedDate, onFoodLogged }) => {
  const [description, setDescription] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [saving, setSaving] = useState(false);

  const handleAnalyze = async () => {
    if (!description.trim()) return;
    setAnalyzing(true);
    setAnalysis(null);
    try {
      const res = await axios.post(`${API}/food/analyze`, { description: description.trim() });
      setAnalysis(res.data);
    } catch (err) {
      toast.error("Failed to analyze food. Try again.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleConfirm = async () => {
    if (!analysis) return;
    setSaving(true);
    try {
      await axios.post(`${API}/food`, {
        food_description: description.trim(),
        food_name: analysis.food_name,
        calories: analysis.calories,
        protein: analysis.protein,
        fat: analysis.fat,
        carbs: analysis.carbs,
        sugar: analysis.sugar,
        fiber: analysis.fiber,
        date: selectedDate,
      });
      toast.success(`${analysis.food_name} logged`);
      setDescription("");
      setAnalysis(null);
      onFoodLogged();
    } catch (err) {
      toast.error("Failed to save food log.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setAnalysis(null);
  };

  return (
    <div className="ft-card p-5" data-testid="food-entry">
      <h2 className="font-heading text-lg uppercase tracking-widest font-bold text-white mb-4">
        Log Food
      </h2>

      <Textarea
        placeholder="What did you eat? e.g. '2 eggs, toast with butter, orange juice'"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="bg-[#0A0A0A] border-[#2A2A2A] text-white placeholder:text-[#555] focus:ring-1 focus:ring-[#007AFF] focus:border-[#007AFF] min-h-[80px] font-body text-sm resize-none"
        data-testid="food-description-input"
      />

      {!analysis && (
        <Button
          onClick={handleAnalyze}
          disabled={analyzing || !description.trim()}
          className="mt-3 w-full bg-[#007AFF] hover:bg-[#0062CC] text-white font-heading uppercase tracking-wider text-sm font-semibold h-10 rounded-md transition-all duration-200"
          data-testid="analyze-food-button"
        >
          {analyzing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              Analyze with AI
            </>
          )}
        </Button>
      )}

      {analysis && (
        <div className="mt-4 animate-slide-up" data-testid="food-analysis-result">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-body font-semibold text-white">
              {analysis.food_name}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-4">
            {MACRO_DISPLAY.map((m) => (
              <div
                key={m.key}
                className="bg-[#0A0A0A] rounded-md p-2 text-center border border-[#2A2A2A]"
              >
                <div className="text-[10px] uppercase tracking-wider font-heading" style={{ color: m.color }}>
                  {m.label}
                </div>
                <div className="text-sm font-bold font-body text-white">
                  {Math.round(analysis[m.key])}<span className="text-[10px] text-[#A0A0A0] ml-0.5">{m.unit}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleConfirm}
              disabled={saving}
              className="flex-1 bg-[#32D74B] hover:bg-[#28B03E] text-black font-heading uppercase tracking-wider text-sm font-bold h-10 rounded-md"
              data-testid="confirm-food-button"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
              Confirm
            </Button>
            <Button
              onClick={handleCancel}
              variant="ghost"
              className="px-4 text-[#A0A0A0] hover:text-white hover:bg-[#2A2A2A] h-10 rounded-md"
              data-testid="cancel-food-button"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

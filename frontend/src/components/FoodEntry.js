import React, { useState } from "react";
import axios from "axios";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { API, errorMessage } from "@/lib/api";

const MACROS = ["calories", "protein", "fat", "carbs", "sugar", "fiber"];
const emptyMacros = () => Object.fromEntries(MACROS.map((key) => [key, ""]));

export const FoodEntry = ({ selectedDate, onFoodLogged }) => {
  const [description, setDescription] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [manual, setManual] = useState(false);
  const [values, setValues] = useState(emptyMacros);
  const [busy, setBusy] = useState(false);
  const analyze = async () => {
    if (busy || !description.trim()) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/food/analyze`, { description: description.trim() });
      setAnalysis(data);
      setValues(Object.fromEntries(MACROS.map((key) => [key, data[key]])));
    } catch (error) {
      toast.error(errorMessage(error, "Food lookup failed. Try again or enter nutrition manually."));
    } finally { setBusy(false); }
  };
  const save = async () => {
    if (busy) return;
    if (!description.trim() || MACROS.some((key) => values[key] === "" || !Number.isFinite(Number(values[key])) || Number(values[key]) < 0)) {
      toast.error("Enter a food description and all six nutrition values. Use 0 where appropriate.");
      return;
    }
    setBusy(true);
    try {
      await axios.post(`${API}/food`, {
        food_description: description.trim(), food_name: analysis?.food_name || description.trim(),
        ...Object.fromEntries(MACROS.map((key) => [key, Number(values[key])])), date: selectedDate,
      });
      toast.success("Food logged");
      setDescription(""); setAnalysis(null); setValues(emptyMacros()); setManual(false);
      await onFoodLogged();
    } catch (error) { toast.error(errorMessage(error, "Could not save food.")); }
    finally { setBusy(false); }
  };
  return <div className="ft-card p-5" data-testid="food-entry">
    <h2 className="font-heading text-lg uppercase tracking-widest font-bold text-white mb-4">Log Food</h2>
    <Textarea aria-label="Food description" disabled={busy} placeholder="200 g chicken breast; 100 g cooked rice" value={description}
      onChange={(e) => { setDescription(e.target.value); setAnalysis(null); if (!manual) setValues(emptyMacros()); }}
      className="bg-[#0A0A0A] border-[#2A2A2A] text-white text-sm" data-testid="food-description-input" />
    <p className="text-xs text-gray-400 mt-2">USDA lookup: English food names with grams per ingredient. Check the matched food and values before saving.</p>
    {!manual && !analysis && <Button disabled={busy || !description.trim()} onClick={analyze} className="mt-3 w-full bg-[#007AFF]" data-testid="analyze-food-button">
      {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Look up nutrition
    </Button>}
    <Button variant="ghost" disabled={busy} className="text-blue-400 mt-2 w-full" onClick={() => { setManual(!manual); setAnalysis(null); setValues(emptyMacros()); }}>
      {manual ? "Use USDA lookup" : "Enter nutrition manually"}
    </Button>
    {(manual || analysis) && <div className="mt-3" data-testid="food-analysis-result">
      {analysis && <p className="text-sm text-white mb-3">Estimated: {analysis.food_name}</p>}
      <p className="text-xs text-gray-400 mb-2">Values for the entire portion being logged.</p>
      <div className="grid grid-cols-2 gap-2">
        {MACROS.map((key) => <label key={key} className="text-xs text-gray-400 capitalize">{key} ({key === "calories" ? "kcal" : "g"})
          <Input aria-label={key} type="number" min="0" step="any" disabled={busy} value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
        </label>)}
      </div>
      <Button onClick={save} disabled={busy} className="mt-3 w-full bg-green-600" data-testid="confirm-food-button">Confirm</Button>
      <Button onClick={() => { setAnalysis(null); setManual(false); }} disabled={busy} variant="ghost" className="w-full text-gray-400" data-testid="cancel-food-button">Cancel</Button>
    </div>}
  </div>;
};

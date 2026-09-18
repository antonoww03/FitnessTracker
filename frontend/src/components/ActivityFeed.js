import React, { useState } from "react";
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
    if (busy) return;
    setBusy(true);
    try {
      await axios.delete(`${API}/food/${id}`);
      toast.success("Food entry removed");
      await onRefresh();
    } catch {
      toast.error("Failed to delete.");
    } finally { setBusy(false); }
  };

  const handleDeleteTraining = async (id) => {
    if (busy) return;
    setBusy(true);
    try {
      await axios.delete(`${API}/training/${id}`);
      toast.success("Training entry removed");
      await onRefresh();
    } catch {
      toast.error("Failed to delete.");
    } finally { setBusy(false); }
  };

  const items = [...foods.map(item=>({...item,kind:'food'})),...trainings.map(item=>({...item,kind:'training'}))].sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
  return <section className="ft-card ft-activity" data-testid="activity-feed">
    <div className="ft-section-head"><div><h2>{selectedDate} · Activity</h2><p className="ft-muted">{items.length} entries logged</p></div><button disabled={busy} onClick={handleSaveDay} className="ft-secondary"><Save size={16}/>Save Day</button></div>
    {!items.length && <div className="ft-empty"><UtensilsCrossed size={24}/><p>No entries for this day yet.</p><span>Add a meal or workout to get started.</span></div>}
    {items.map(item=>{
      const food=item.kind==='food', Icon=food?UtensilsCrossed:Dumbbell, name=food?item.food_name:item.training_type;
      const time=item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : null;
      return <div key={item.id} className="ft-activity-row">
        <div className="ft-activity-icon"><Icon size={18}/></div>
        <div className="ft-activity-description"><strong>{name}</strong><div className="ft-activity-detail">{time && <span>{time}</span>}{food ? <><span>Protein {Math.round(item.protein)} g</span><span>Carbs {Math.round(item.carbs)} g</span><span>Fat {Math.round(item.fat)} g</span></> : <span>Workout session</span>}</div>{food && item.food_description !== item.food_name && <p className="ft-muted">{item.food_description}</p>}</div>
        <div className="ft-activity-value">{food?Math.round(item.calories):item.duration_minutes}<span>{food?'kcal':'min'}</span></div>
        <button className="ft-icon-button ft-delete" disabled={busy} aria-label={`Delete ${name}`} onClick={()=>food?handleDeleteFood(item.id):handleDeleteTraining(item.id)}><Trash2 size={16}/></button>
      </div>;
    })}
  </section>;
};

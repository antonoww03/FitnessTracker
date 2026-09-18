import React from "react";
import { Settings2 } from "lucide-react";

export const MacrosDashboard = ({ totals, goals, onOpenGoals }) => {
  const progress = goals.calories > 0 ? Math.min(totals.calories / goals.calories, 1) : 0;
  const remaining = goals.calories - totals.calories;
  return <section className="ft-card ft-nutrition" data-testid="macros-dashboard">
    <div className="ft-section-head"><div><span className="ft-eyebrow">Daily overview</span><h2>Nutrition</h2></div>
      <button className="ft-secondary" onClick={onOpenGoals} aria-label="Edit daily goals" data-testid="open-goals-button"><Settings2 size={16}/>Goals</button></div>
    <div className="ft-nutrition-body">
      <div className="ft-calorie-block">
        <div className="ft-calorie-ring" role="img" aria-label={`${Math.round(totals.calories)} of ${goals.calories} calories`}>
          <svg viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="86" className="ft-ring-track"/><circle cx="100" cy="100" r="86" className="ft-ring-fill" strokeDasharray={540.35} strokeDashoffset={540.35*(1-progress)}/></svg>
          <div><strong>{Math.round(totals.calories).toLocaleString()}</strong><span>kcal consumed</span></div>
        </div>
        <p>{goals.calories > 0 ? <><b>{Math.abs(Math.round(remaining)).toLocaleString()}</b> kcal {remaining >= 0 ? 'remaining' : 'above target'}</> : 'No calorie target set'}</p>
      </div>
      <div className="ft-macro-list">
        {[['protein','Protein'],['carbs','Carbohydrates'],['fat','Fat']].map(([key,label])=>{
          const pct=goals[key]>0?Math.min(totals[key]/goals[key]*100,100):0;
          return <div className="ft-macro" key={key}><div><span>{label}</span><span><b>{Math.round(totals[key])}</b><small> / {goals[key]} g</small></span></div>
            <div className={`ft-track ft-${key}`} role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${pct}%`}}/></div></div>;
        })}
        <div className="ft-secondary-macros">{[['sugar','Sugar'],['fiber','Fiber']].map(([key,label])=><div key={key}><span>{label}</span><b>{Math.round(totals[key])}<small> / {goals[key]} g</small></b></div>)}</div>
      </div>
    </div>
  </section>;
};

import {t} from "@/lib/i18n";
import React, { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Droplet, Plus } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";

import { API } from "@/lib/api";

export const WaterTracker = ({ selectedDate, totalWaterMl, onWaterLogged, streak, expanded = false, onExpand, goalMl = 3000 }) => {
    const [customAmount, setCustomAmount] = useState("");
    const [saving, setSaving] = useState(false);
    const changeWater = async (amount) => {
        if (saving) return;
        if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
            toast.error("Enter a positive amount in ml.");
            return;
        }
        if (amount === null && !window.confirm("Reset water for this date?")) return;
        setSaving(true);
        try {
            if (amount === null) await axios.delete(`${API}/water`, { params: { date: selectedDate } });
            else await axios.post(`${API}/water`, { amount_ml: amount, date: selectedDate });
            setCustomAmount("");
            toast.success(amount === null ? "Water reset" : `+${amount} ml added`);
            await onWaterLogged();
        } catch {
            toast.error("Could not update water.");
        } finally {
            setSaving(false);
        }
    };
    return <section className="ft-card ft-small-card" data-testid={expanded ? "water-entry" : "water-tracker"}>
      <div className="ft-section-head"><h2><Droplet size={18}/>{t("Water")}</h2>{!expanded && <button className="ft-icon-button" aria-label={t("Water options")} onClick={onExpand}><Plus size={18}/></button>}</div>
      <div className="ft-stat-number">{(totalWaterMl/1000).toFixed(1)}<span> / {(goalMl/1000).toFixed(1)} L</span></div>
      <div className="ft-track ft-water" role="progressbar" aria-label="Water intake" aria-valuenow={Math.min(Math.round(totalWaterMl/goalMl*100),100)} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${Math.min(totalWaterMl/goalMl*100,100)}%`}}/></div>
      <div className="ft-water-actions">{(expanded ? [250,500,1000] : [250,500]).map(amount=><button className="ft-secondary" key={amount} disabled={saving} onClick={()=>changeWater(amount)}>+{amount} ml</button>)}</div>
      <p className="ft-muted" data-testid="water-streak">{streak}{t("day water streak")}</p>
      {expanded && <><div className="flex gap-2 mt-3"><Input aria-label="Water amount in ml" type="number" min="1" placeholder="Custom amount (ml)" value={customAmount} onChange={e=>setCustomAmount(e.target.value)}/><Button aria-label="Add water" disabled={saving || !customAmount} onClick={()=>changeWater(Number(customAmount))}><Plus size={18}/></Button></div><button className="ft-danger-text" disabled={saving || totalWaterMl===0} onClick={()=>changeWater(null)}>{t("Reset water for this date")}</button></>}
    </section>;
};

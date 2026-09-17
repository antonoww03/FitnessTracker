import React, { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Droplet, Plus } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";

import { API } from "@/lib/api";

const WaterBottle = ({ totalMl, maxMl = 3000 }) => {
    const fillPercent = Math.min(totalMl / maxMl, 1);

    const bodyTop = 60;
    const bodyBottom = 260;
    const bodyHeight = bodyBottom - bodyTop;

    const waterHeight = fillPercent * bodyHeight;
    const waterY = bodyBottom - waterHeight;

    return (
        <div className="flex flex-col items-center">

            <svg viewBox="0 0 120 300" width="90">

                <defs>
                    <clipPath id="clipBottle">
                        <rect x="20" y="60" width="80" height="200" rx="40" />
                    </clipPath>
                </defs>

                {/* 💧 WATER WITH CURVE */}
                <path
                    d={`
            M20 ${waterY}
            Q60 ${waterY - 15} 100 ${waterY}
            L100 260
            Q60 280 20 260
            Z
          `}
                    fill="#4AA3DF"
                    clipPath="url(#clipBottle)"
                    style={{ transition: "all 0.6s ease" }}
                />

                {/* 🔥 OUTLINE */}
                <rect
                    x="20"
                    y="60"
                    width="80"
                    height="200"
                    rx="40"
                    fill="none"
                    stroke="#E5E5E5"
                    strokeWidth="3"
                />

                {/* 🧢 CAP */}
                <rect
                    x="35"
                    y="35"
                    width="50"
                    height="12"
                    rx="6"
                    fill="#E5E5E5"
                />

            </svg>

            <div className="text-center mt-2">
        <span className="text-xl font-bold text-white">
          {(totalMl / 1000).toFixed(1)}
        </span>
                <span className="text-sm text-[#A0A0A0] ml-1">/ 3.0 L</span>
            </div>

        </div>
    );
};

export const WaterTracker = ({ selectedDate, totalWaterMl, onWaterLogged, streak }) => {
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
    return (
        <div className="ft-card p-5 flex flex-col" data-testid="water-tracker">
            <h2 className="text-lg font-bold text-white mb-2"><Droplet className="inline h-4 w-4 mr-1 text-[#6EC6FF]" />Water</h2>
            <p className="text-xs text-gray-400 text-center" data-testid="water-streak">{streak} day water streak</p>
            <div className="flex justify-center"><WaterBottle totalMl={totalWaterMl} /></div>
            <div className="grid grid-cols-2 gap-2 mt-4">
                {[250, 500, 1000].map((amount) => <Button key={amount} disabled={saving} onClick={() => changeWater(amount)}>+{amount} ml</Button>)}
                <Button disabled={saving || totalWaterMl === 0} onClick={() => changeWater(null)} className="bg-red-600 hover:bg-red-700 text-white">Reset</Button>
            </div>
            <div className="flex gap-2 mt-2">
                <Input aria-label="Water amount in ml" type="number" min="1" placeholder="ml" value={customAmount} onChange={(e) => setCustomAmount(e.target.value)} />
                <Button aria-label="Add water" disabled={saving || !customAmount} onClick={() => changeWater(Number(customAmount))}><Plus className="h-4 w-4" /></Button>
            </div>
        </div>
    );
};

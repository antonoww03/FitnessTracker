import React, { useState, useEffect } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Droplet, Plus } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

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

export const WaterTracker = ({ selectedDate }) => {
    const [customAmount, setCustomAmount] = useState("");
    const [totalWaterMl, setTotalWaterMl] = useState(0);

    const fetchWater = async () => {
        try {
            const res = await axios.get(`${API}/water`, {
                params: { date: selectedDate }
            });

            const total = res.data.reduce((sum, w) => sum + w.amount_ml, 0);
            setTotalWaterMl(total);
        } catch (err) {
            console.error(err);
        }
    };

    const addWater = async (amountMl) => {
        try {
            await axios.post(`${API}/water`, {
                amount_ml: amountMl,
                date: selectedDate
            });

            toast.success(`+${amountMl}ml added`);
            await fetchWater();
        } catch {
            toast.error("Failed to log water.");
        }
    };

    const resetWater = async () => {
        try {
            await axios.delete(`${API}/water`, {
                params: { date: selectedDate }
            });

            setTotalWaterMl(0);
            toast.success("Water reset");
        } catch {
            toast.error("Failed to reset water");
        }
    };

    const handleCustomAdd = () => {
        const amt = parseInt(customAmount);
        if (!amt || amt <= 0) return;
        addWater(amt);
        setCustomAmount("");
    };

    useEffect(() => {
        fetchWater();
    }, [selectedDate]);

    return (
        <div className="ft-card p-5 flex flex-col">
            <h2 className="text-lg font-bold text-white mb-2">
                <Droplet className="inline h-4 w-4 mr-1 text-[#6EC6FF]" />
                Water
            </h2>

            <div className="flex justify-center">
                <WaterBottle totalMl={totalWaterMl} />
            </div>

            <div className="grid grid-cols-4 gap-2 mt-4">
                {[250, 500, 1000].map((amt) => (
                    <Button key={amt} onClick={() => addWater(amt)}>
                        +{amt >= 1000 ? `${amt / 1000}L` : `${amt}ml`}
                    </Button>
                ))}

                <Button
                    onClick={resetWater}
                    className="bg-red-600 hover:bg-red-700 text-white"
                >
                    Reset
                </Button>
            </div>

            <div className="flex gap-2 mt-2">
                <Input
                    type="number"
                    placeholder="ml"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                />
                <Button onClick={handleCustomAdd}>
                    <Plus className="h-4 w-4" />
                </Button>
            </div>
        </div>
    );
};
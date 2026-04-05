import React, { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Droplet, Plus } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const WaterBottle = ({ totalMl, maxMl = 3000 }) => {
  const fillPercent = Math.min((totalMl / maxMl) * 100, 100);
  const bodyTop = 80;
  const bodyBottom = 260;
  const bodyHeight = bodyBottom - bodyTop;
  const waterHeight = (fillPercent / 100) * bodyHeight;
  const waterY = bodyBottom - waterHeight;

  const mark1Y = bodyTop + (bodyHeight * 2) / 3;
  const mark2Y = bodyTop + bodyHeight / 3;
  const mark3Y = bodyTop;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 130 290" className="w-24 md:w-28" data-testid="water-bottle-svg">
        <defs>
          <linearGradient id="waterGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6EC6FF" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#4AA3DF" stopOpacity="0.9" />
          </linearGradient>
          <clipPath id="bottleClip">
            <path d="M44 55 L44 68 C44 72 32 82 32 90 L32 250 C32 260 44 268 60 268 C76 268 88 260 88 250 L88 90 C88 82 76 72 76 68 L76 55 Z" />
          </clipPath>
        </defs>

        {/* Cap */}
        <rect x="44" y="34" width="32" height="16" rx="5" fill="#333" stroke="#3A3A3A" strokeWidth="1.5" />
        <rect x="41" y="47" width="38" height="8" rx="3" fill="#2A2A2A" stroke="#3A3A3A" strokeWidth="1" />

        {/* Water fill */}
        <rect
          x="30"
          y={waterY}
          width="64"
          height={waterHeight + 20}
          fill="url(#waterGrad)"
          clipPath="url(#bottleClip)"
          style={{ transition: "y 0.6s ease-out, height 0.6s ease-out" }}
        />

        {/* Wave on water surface */}
        {fillPercent > 2 && (
          <path
            d={`M32 ${waterY} Q46 ${waterY - 4} 60 ${waterY} Q74 ${waterY + 4} 88 ${waterY}`}
            fill="none"
            stroke="#8AD4FF"
            strokeWidth="1.5"
            opacity="0.5"
            clipPath="url(#bottleClip)"
            style={{ transition: "d 0.6s ease-out" }}
          />
        )}

        {/* Bottle outline */}
        <path
          d="M44 55 L44 68 C44 72 32 82 32 90 L32 250 C32 260 44 268 60 268 C76 268 88 260 88 250 L88 90 C88 82 76 72 76 68 L76 55 Z"
          fill="none"
          stroke="#2A2A2A"
          strokeWidth="2"
        />

        {/* Liter marks */}
        <line x1="88" y1={mark1Y} x2="96" y2={mark1Y} stroke="#444" strokeWidth="1" />
        <text x="99" y={mark1Y + 3} fill="#555" fontSize="9" fontFamily="DM Sans">1L</text>

        <line x1="88" y1={mark2Y} x2="96" y2={mark2Y} stroke="#444" strokeWidth="1" />
        <text x="99" y={mark2Y + 3} fill="#555" fontSize="9" fontFamily="DM Sans">2L</text>

        <line x1="88" y1={mark3Y} x2="96" y2={mark3Y} stroke="#444" strokeWidth="1" />
        <text x="99" y={mark3Y + 3} fill="#555" fontSize="9" fontFamily="DM Sans">3L</text>
      </svg>

      <div className="text-center mt-2">
        <span className="text-xl font-bold font-body text-white">
          {(totalMl / 1000).toFixed(1)}
        </span>
        <span className="text-sm text-[#A0A0A0] font-body ml-1">/ 3.0 L</span>
      </div>
    </div>
  );
};

export const WaterTracker = ({ selectedDate, totalWaterMl, onWaterLogged }) => {
  const [customAmount, setCustomAmount] = useState("");

  const addWater = async (amountMl) => {
    try {
      await axios.post(`${API}/water`, { amount_ml: amountMl, date: selectedDate });
      toast.success(`+${amountMl}ml added`);
      onWaterLogged();
    } catch (err) {
      toast.error("Failed to log water.");
    }
  };

  const handleCustomAdd = () => {
    const amt = parseInt(customAmount);
    if (!amt || amt <= 0) return;
    addWater(amt);
    setCustomAmount("");
  };

  return (
    <div className="ft-card p-5 flex flex-col" data-testid="water-tracker">
      <h2 className="font-heading text-lg uppercase tracking-widest font-bold text-white mb-2">
        <Droplet className="inline h-4 w-4 text-[#6EC6FF] mr-1.5 -mt-0.5" />
        Water
      </h2>

      <div className="flex-1 flex flex-col items-center justify-center py-2">
        <WaterBottle totalMl={totalWaterMl} />
      </div>

      {/* Quick add */}
      <div className="grid grid-cols-3 gap-1.5 mt-3">
        {[250, 500, 1000].map((amt) => (
          <Button
            key={amt}
            variant="ghost"
            onClick={() => addWater(amt)}
            className="bg-[#0A0A0A] border border-[#2A2A2A] text-[#6EC6FF] hover:bg-[#6EC6FF]/10 hover:border-[#6EC6FF]/30 text-xs font-body h-8 rounded-md transition-all"
            data-testid={`water-quick-${amt}`}
          >
            +{amt >= 1000 ? `${amt / 1000}L` : `${amt}ml`}
          </Button>
        ))}
      </div>

      {/* Custom input */}
      <div className="flex gap-1.5 mt-2">
        <Input
          type="number"
          placeholder="ml"
          value={customAmount}
          onChange={(e) => setCustomAmount(e.target.value)}
          min="1"
          className="bg-[#0A0A0A] border-[#2A2A2A] text-white placeholder:text-[#555] focus:ring-1 focus:ring-[#6EC6FF] focus:border-[#6EC6FF] h-8 font-body text-xs"
          data-testid="water-custom-input"
          onKeyDown={(e) => e.key === "Enter" && handleCustomAdd()}
        />
        <Button
          onClick={handleCustomAdd}
          disabled={!customAmount}
          size="icon"
          className="h-8 w-8 bg-[#4AA3DF] hover:bg-[#3B93CF] text-white flex-shrink-0 rounded-md"
          data-testid="water-custom-add-button"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};

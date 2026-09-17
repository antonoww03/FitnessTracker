import React, { useState } from "react";
import axios from "axios";
import { Button } from "../components/ui/button";
import {
  Loader2,
  Sparkles,
  Flame,
  Dumbbell,
  Droplet,
  Zap,
  Leaf,
  CircleAlert,
  MessageCircle,
} from "lucide-react";
import { toast } from "sonner";

import { API } from "@/lib/api";

const TYPE_CONFIG = {
  calories: { icon: Flame, color: "#FF9F0A" },
  protein: { icon: Dumbbell, color: "#007AFF" },
  fat: { icon: Droplet, color: "#FF9F0A" },
  carbs: { icon: Zap, color: "#FF3B30" },
  sugar: { icon: CircleAlert, color: "#FF2D55" },
  fiber: { icon: Leaf, color: "#32D74B" },
  water: { icon: Droplet, color: "#6EC6FF" },
  general: { icon: Sparkles, color: "#A0A0A0" },
};

export const CoachTips = ({ selectedDate }) => {
  const [tips, setTips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  const generateTips = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/coach/tips?date=${selectedDate}`);
      setTips(res.data.tips || []);
      setHasGenerated(true);
    } catch (err) {
      toast.error("Failed to get coach tips.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ft-card p-5" data-testid="coach-tips">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-heading text-lg uppercase tracking-widest font-bold text-white">
          <MessageCircle className="inline h-4 w-4 text-[#007AFF] mr-1.5 -mt-0.5" />
          Daily Review
        </h2>
        <Button
          onClick={generateTips}
          disabled={loading}
          className="bg-[#007AFF] hover:bg-[#0062CC] text-white font-heading uppercase tracking-wider text-xs font-semibold h-8 px-3 rounded-md"
          data-testid="generate-tips-button"
        >
          {loading ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              Analyzing...
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              {hasGenerated ? "Refresh" : "Get Tips"}
            </>
          )}
        </Button>
      </div>

      {!hasGenerated && !loading && (
        <p
          className="text-[#555] text-sm font-body text-center py-4"
          data-testid="coach-empty-state"
        >
          Review your logged intake against your own targets. These are summaries, not AI-generated recommendations.
        </p>
      )}

      {tips.length > 0 && (
        <div className="space-y-2" data-testid="coach-tips-list">
          {tips.map((tip, i) => {
            const config = TYPE_CONFIG[tip.type] || TYPE_CONFIG.general;
            const Icon = config.icon;
            return (
              <div
                key={i}
                className="flex items-start gap-3 p-3 bg-[#0A0A0A] rounded-md border border-[#2A2A2A] animate-slide-up"
                style={{ animationDelay: `${i * 0.05}s` }}
                data-testid={`coach-tip-${i}`}
              >
                <div
                  className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ backgroundColor: `${config.color}15` }}
                >
                  <Icon className="h-3.5 w-3.5" style={{ color: config.color }} />
                </div>
                <p className="text-sm font-body text-[#CCCCCC] leading-relaxed">{tip.tip}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

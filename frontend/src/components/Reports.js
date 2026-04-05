import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { format } from "date-fns";
import { ChevronDown, ChevronUp, Droplet, Scale, Dumbbell, Flame } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

const PERIODS = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
];

const MACRO_COLORS = {
  calories: "#FFFFFF",
  protein: "#007AFF",
  fat: "#FF9F0A",
  carbs: "#FF3B30",
  sugar: "#FF2D55",
  fiber: "#32D74B",
};

const ReportRow = ({ report }) => {
  const [expanded, setExpanded] = useState(false);

  let dateLabel;
  if (report.is_monthly) {
    dateLabel = format(new Date(report.date + "-01T00:00:00"), "MMMM yyyy");
  } else {
    dateLabel = format(new Date(report.date + "T00:00:00"), "EEE, MMM d");
  }

  return (
    <div className="border-b border-[#2A2A2A] last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#1A1A1A] transition-colors text-left"
        data-testid={`report-row-${report.date}`}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-body font-medium text-white">{dateLabel}</span>
          {report.is_monthly && (
            <span className="text-[10px] text-[#A0A0A0] bg-[#2A2A2A] px-1.5 py-0.5 rounded font-body">
              {report.days_count} days
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Flame className="h-3.5 w-3.5 text-[#FF9F0A]" />
            <span className="text-sm font-body font-semibold text-white">
              {Math.round(report.totals.calories)} kcal
            </span>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-[#A0A0A0]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[#A0A0A0]" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 animate-slide-up" data-testid={`report-detail-${report.date}`}>
          {/* Macros grid */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-3">
            {Object.entries(MACRO_COLORS).map(([key, color]) => (
              <div
                key={key}
                className="bg-[#0A0A0A] rounded-md p-2 text-center border border-[#2A2A2A]"
              >
                <div
                  className="text-[10px] uppercase tracking-wider font-heading font-semibold"
                  style={{ color }}
                >
                  {key}
                </div>
                <div className="text-sm font-bold font-body text-white">
                  {Math.round(report.totals[key])}
                  <span className="text-[10px] text-[#A0A0A0] ml-0.5">
                    {key === "calories" ? "kcal" : "g"}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Water, Weight, Training */}
          <div className="flex gap-4 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Droplet className="h-3.5 w-3.5 text-[#6EC6FF]" />
              <span className="text-sm font-body text-[#A0A0A0]">
                Water:{" "}
                <span className="text-white font-semibold">
                  {report.water_ml ? `${(report.water_ml / 1000).toFixed(1)}L` : "--"}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Scale className="h-3.5 w-3.5 text-[#A0A0A0]" />
              <span className="text-sm font-body text-[#A0A0A0]">
                Weight:{" "}
                <span className="text-white font-semibold">
                  {report.weight_kg ? `${report.weight_kg} kg` : "--"}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Dumbbell className="h-3.5 w-3.5 text-[#FF3B30]" />
              <span className="text-sm font-body text-[#A0A0A0]">
                Training:{" "}
                <span className="text-white font-semibold">{report.training_minutes} min</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const Reports = ({ selectedDate }) => {
  const [period, setPeriod] = useState("week");
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/reports?period=${period}&date=${selectedDate}`);
      setReports(res.data);
    } catch (err) {
      console.error("Failed to fetch reports:", err);
    } finally {
      setLoading(false);
    }
  }, [period, selectedDate]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  return (
    <div data-testid="reports-section">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-heading text-xl uppercase tracking-widest font-bold text-white">
          Reports
        </h2>
        <div className="flex gap-1 bg-[#141414] rounded-md p-1 border border-[#2A2A2A]">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-3 py-1 rounded-md text-xs font-heading uppercase tracking-wider transition-all duration-200 ${
                period === p.key
                  ? "bg-[#007AFF] text-white"
                  : "text-[#A0A0A0] hover:text-white"
              }`}
              data-testid={`period-${p.key}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ft-card overflow-hidden" data-testid="reports-list">
        {loading ? (
          <div className="p-8 text-center text-[#A0A0A0] font-body text-sm animate-pulse-glow">
            Loading reports...
          </div>
        ) : reports.length === 0 ? (
          <div className="p-8 text-center text-[#555] font-body text-sm" data-testid="no-reports">
            No data for this period.
          </div>
        ) : (
          reports.map((report) => <ReportRow key={report.date} report={report} />)
        )}
      </div>
    </div>
  );
};

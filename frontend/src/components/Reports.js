import React, { useEffect, useState } from "react";
import axios from "axios";
import { Trash2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { toast } from "sonner";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const Reports = () => {
  const [reports, setReports] = useState([]);

  useEffect(() => {
    fetchReports();
  }, []);

  const fetchReports = async () => {
    try {
      const res = await axios.get(`${API}/reports`);
      setReports(res.data);
    } catch {
      console.error("Failed to fetch reports");
    }
  };

  const handleDelete = async (date) => {
    const confirmDelete = window.confirm("Delete this report?");
    if (!confirmDelete) return;

    try {
      await axios.delete(`${API}/reports/${date}`);
      toast.success("Report deleted");
      fetchReports();
    } catch {
      toast.error("Failed to delete report");
    }
  };

  return (
      <div className="ft-card p-5">
        <h2 className="text-white text-lg mb-4">Reports</h2>

        {reports.length === 0 && (
            <p className="text-gray-500">No data for this period.</p>
        )}

        {reports.map((r) => (
            <div
                key={r.date}
                className="mb-3 border-b border-[#2A2A2A] pb-2 flex justify-between items-end"
            >
              <div>
                <p className="text-white font-semibold">{r.date}</p>

                <div className="text-sm text-gray-400">
                  {Math.round(r.totals.calories)} kcal |
                  {Math.round(r.totals.protein)} protein |
                  {Math.round(r.totals.carbs)} carbs |
                  {Math.round(r.totals.fat)} fat
                </div>

                <div className="text-xs text-gray-500 mt-1">
                  Training: {r.training_minutes} min | Water: {r.water_ml} ml
                </div>
              </div>

              {/* 🔥 DELETE BUTTON */}
              <Button
                  onClick={() => handleDelete(r.date)}
                  className="bg-red-500/20 hover:bg-red-500/40 text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
        ))}
      </div>
  );
};
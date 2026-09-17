import React, { useEffect, useState } from "react";
import axios from "axios";
import { Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { API } from "@/lib/api";

export const Reports = ({ selectedDate }) => {
  const [reports, setReports] = useState([]);
  const [period, setPeriod] = useState("all");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(false);
    axios.get(`${API}/reports`, { params: { period, date: selectedDate }, signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setReports(data); })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period, selectedDate, refresh]);
  const remove = async (date) => {
    if (busy || !window.confirm("Delete this saved report? The original daily entries will remain.")) return;
    setBusy(true);
    try { await axios.delete(`${API}/reports/${date}`); setRefresh((value) => value + 1); toast.success("Report deleted"); }
    catch { toast.error("Could not delete report"); }
    finally { setBusy(false); }
  };
  const download = async (format) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/export`, { params: { period, date: selectedDate, format }, responseType: "blob" });
      const url = URL.createObjectURL(data);
      const link = document.createElement("a"); link.href = url; link.download = `fittrack-${period}.${format}`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { toast.error("Could not export reports"); }
    finally { setBusy(false); }
  };
  return <div className="ft-card p-5" data-testid="reports">
    <h2 className="text-white text-lg mb-2">Saved Reports</h2>
    <p className="text-gray-400 text-xs mb-4">Use Save Day on the dashboard to create or update a snapshot. Periods use the selected date; weeks start Monday.</p>
    <div className="flex flex-wrap gap-2 mb-4">
      <select aria-label="Report period" value={period} onChange={(e) => setPeriod(e.target.value)} className="bg-[#141414] text-white border rounded p-2">
        {["all", "week", "month", "year"].map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
      <Button disabled={busy || loading || error || !reports.length} onClick={() => download("csv")}>Export CSV</Button>
      <Button disabled={busy || loading || error || !reports.length} onClick={() => download("pdf")}>Export PDF</Button>
    </div>
    {loading ? <p role="status" className="text-gray-400">Loading reports…</p> : error ? <p role="alert" className="text-red-400">Could not load reports. <button className="underline" onClick={() => setRefresh((value) => value + 1)}>Retry</button></p> : !reports.length ? <p className="text-gray-400">No saved reports for this period.</p> : reports.map((report) =>
      <div key={report.date} className="mb-3 border-b border-[#2A2A2A] pb-3 flex gap-3 justify-between items-center">
        <div className="min-w-0">
          <p className="text-white font-semibold">{report.date}</p>
          <div className="text-sm text-gray-400 flex flex-wrap gap-x-3 gap-y-1">
            {Object.entries(report.totals).map(([key, value]) => <span key={key}>{key}: {Math.round(value)} {key === "calories" ? "kcal" : "g"}</span>)}
          </div>
          <div className="text-xs text-gray-400 mt-1">Training: {report.training_minutes} min · Water: {report.water_ml} ml · Weight: {report.weight_kg ?? "—"} kg</div>
        </div>
        <Button aria-label={`Delete report ${report.date}`} disabled={busy} onClick={() => remove(report.date)} className="bg-red-500/20 text-red-500 shrink-0"><Trash2 className="h-4 w-4" /></Button>
      </div>)}
  </div>;
};

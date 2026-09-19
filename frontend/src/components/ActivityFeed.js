import React, { useState } from "react";
import { Trash2, UtensilsCrossed, Dumbbell, Save, Pencil } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";

import { EntryEditor } from "./FeatureHub";
import { t } from "@/lib/i18n";
import { API } from "@/lib/api";

export const ActivityFeed = ({ foods, trainings, onRefresh, selectedDate }) => {
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleSaveDay = async () => {
    if (busy) return;
    const confirmSave = window.confirm(
      "Are you sure you want to save this day?",
    );
    if (!confirmSave) return;

    setBusy(true);
    try {
      await axios.post(`${API}/reports/save`, null, {
        params: { date: selectedDate },
      });

      toast.success("Day saved to reports");
    } catch {
      toast.error("Failed to save report");
    } finally {
      setBusy(false);
    }
  };

  const deleteEntry = async (kind, id) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await axios.delete(`${API}/entries/${kind}/${id}`);
      await onRefresh();
      toast(t("Entry deleted"), {
        duration: 15000,
        action: {
          label: t("Undo"),
          onClick: async () => {
            try {
              await axios.post(`${API}/undo/${data.undo_token}`);
              await onRefresh();
            } catch {
              toast.error(t("Could not complete action"));
            }
          },
        },
      });
    } catch {
      toast.error(t("Could not complete action"));
    } finally {
      setBusy(false);
    }
  };

  const items = [
    ...foods.map((item) => ({ ...item, kind: "food" })),
    ...trainings.map((item) => ({ ...item, kind: "training" })),
  ].sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
  return (
    <section className="ft-card ft-activity" data-testid="activity-feed">
      <div className="ft-section-head">
        <div>
          <h2>
            {selectedDate}
            {t("· Activity")}
          </h2>
          <p className="ft-muted">
            {items.length}
            {t("entries logged")}
          </p>
        </div>
        <button
          disabled={busy}
          onClick={handleSaveDay}
          className="ft-secondary"
        >
          <Save size={16} />
          {t("Save Day")}
        </button>
      </div>
      {edit && (
        <EntryEditor
          key={edit.id}
          entry={edit}
          onClose={() => setEdit(null)}
          onSave={() => {
            setEdit(null);
            onRefresh();
          }}
        />
      )}
      {!items.length && (
        <div className="ft-empty">
          <UtensilsCrossed size={24} />
          <p>{t("No entries for this day yet.")}</p>
          <span>{t("Add a meal or workout to get started.")}</span>
        </div>
      )}
      {items.map((item) => {
        const food = item.kind === "food",
          Icon = food ? UtensilsCrossed : Dumbbell,
          name = food ? item.food_name : item.training_type;
        const time = item.timestamp
          ? new Date(item.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          : null;
        return (
          <div key={item.id} className="ft-activity-row">
            <div className="ft-activity-icon">
              <Icon size={18} />
            </div>
            <div className="ft-activity-description">
              <strong>{name}</strong>
              <div className="ft-activity-detail">
                {time && <span>{time}</span>}
                {food ? (
                  <>
                    <span>
                      {t("Protein")}
                      {Math.round(item.protein)} g
                    </span>
                    <span>
                      {t("Carbs")}
                      {Math.round(item.carbs)} g
                    </span>
                    <span>
                      {t("Fat")}
                      {Math.round(item.fat)} g
                    </span>
                  </>
                ) : (
                  <span>{t("Workout session")}</span>
                )}
              </div>
              {food && item.food_description !== item.food_name && (
                <p className="ft-muted">{item.food_description}</p>
              )}
            </div>
            <div className="ft-activity-value">
              {food ? Math.round(item.calories) : item.duration_minutes}
              <span>{food ? "kcal" : "min"}</span>
            </div>
            <div className="ft-row">
              <button
                className="ft-icon-button"
                aria-label={`Edit ${name}`}
                onClick={() => setEdit(item)}
              >
                <Pencil size={16} />
              </button>
              <button
                className="ft-icon-button ft-delete"
                disabled={busy}
                aria-label={`Delete ${name}`}
                onClick={() => deleteEntry(item.kind, item.id)}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
};

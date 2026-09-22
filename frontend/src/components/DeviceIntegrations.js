import React, { useEffect, useState } from "react";
import { addDays, format } from "date-fns";
import { toast } from "sonner";
import { t } from "@/lib/i18n";
import {
  checkReminders,
  loadReminders,
  notificationPermission,
  notificationSupport,
  requestNotificationPermission,
  refreshNotificationPermission,
  saveReminders,
  showDeviceNotification,
  syncBackgroundPush,
} from "@/lib/reminders";
import {
  connectHealth,
  healthAvailable,
  healthConnected,
  syncHealth,
} from "@/lib/health";

export function useReminderEngine(userId) {
  useEffect(() => {
    const check = () => checkReminders(userId).catch(() => {});
    check();
    const id = setInterval(check, 30000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [userId]);
}

export function DeviceIntegrations({ user }) {
  const [reminders, setReminders] = useState(() => loadReminders(user.id));
  const [permission, setPermission] = useState(
    notificationSupport() ? notificationPermission(user.id) : "unsupported",
  );
  const [connected, setConnected] = useState(() => healthConnected(user.id));
  const [healthSummary, setHealthSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pushStatus, setPushStatus] = useState("unknown");
  useEffect(() => {
    refreshNotificationPermission(user.id).then(setPermission).catch(() => {});
  }, [user.id]);
  const update = (type, patch) =>
    setReminders({
      ...reminders,
      [type]: { ...reminders[type], ...patch },
    });
  async function allowNotifications() {
    const result = await requestNotificationPermission(user.id);
    setPermission(result);
    if (result === "granted")
      await showDeviceNotification(
        t("Notifications are ready"),
        t("FitTrack can now show your device reminders."),
        "fittrack-test",
      );
  }
  async function saveReminderSettings() {
    setBusy(true);
    try {
      if (!saveReminders(user.id, reminders))
        throw new Error(t("Could not save reminder settings"));
      const status = await syncBackgroundPush(reminders);
      setPushStatus(status);
      toast.success(
        t(status === "enabled" ? "Background reminders enabled" : "Reminder settings saved"),
      );
    } catch (error) {
      toast.error(error.message || t("Could not save reminder settings"));
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    setBusy(true);
    try {
      await connectHealth(user.id);
      setConnected(true);
      toast.success(t("Apple Health connected"));
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }
  async function sync() {
    setBusy(true);
    try {
      const today = new Date();
      const result = await syncHealth(
        format(addDays(today, -30), "yyyy-MM-dd"),
        format(today, "yyyy-MM-dd"),
      );
      setHealthSummary(result);
      toast.success(
        t("Apple Health synchronized") +
          (result.sampleCount ? ` · ${result.sampleCount} ${t("samples")}` : ""),
      );
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="ft-card ft-form" data-testid="reminder-settings">
        <h2>{t("Notifications and reminders")}</h2>
        <p className="ft-muted">
          {permission === "granted"
            ? t("Notifications are allowed on this device.")
            : t("Allow notifications before enabling reminders.")}
        </p>
        {permission !== "granted" && (
          <button
            className="ft-primary"
            disabled={permission === "unsupported"}
            onClick={allowNotifications}
          >
            {t("Allow notifications")}
          </button>
        )}
        <fieldset className="ft-form" disabled={permission !== "granted"}>
          <legend>{t("Water reminder")}</legend>
          <label className="ft-check">
            <input
              type="checkbox"
              checked={reminders.water.enabled}
              onChange={(e) => update("water", { enabled: e.target.checked })}
            />
            {t("Remind me to drink water")}
          </label>
          <div className="ft-row">
            <label>
              {t("Every (minutes)")}
              <input
                type="number"
                min="30"
                max="480"
                step="30"
                value={reminders.water.everyMinutes}
                onChange={(e) =>
                  update("water", { everyMinutes: Number(e.target.value) })
                }
              />
            </label>
            <label>
              {t("From")}
              <input
                type="time"
                value={reminders.water.start}
                onChange={(e) => update("water", { start: e.target.value })}
              />
            </label>
            <label>
              {t("Until")}
              <input
                type="time"
                value={reminders.water.end}
                onChange={(e) => update("water", { end: e.target.value })}
              />
            </label>
          </div>
        </fieldset>
        {[
          ["workout", "Workout reminder", "Remind me to train"],
          ["weighIn", "Weigh-in reminder", "Remind me to weigh in"],
        ].map(([key, title, label]) => (
          <fieldset className="ft-form" disabled={permission !== "granted"} key={key}>
            <legend>{t(title)}</legend>
            <label className="ft-check">
              <input
                type="checkbox"
                checked={reminders[key].enabled}
                onChange={(e) => update(key, { enabled: e.target.checked })}
              />
              {t(label)}
            </label>
            <label>
              {t("Time")}
              <input
                type="time"
                value={reminders[key].time}
                onChange={(e) => update(key, { time: e.target.value })}
              />
            </label>
          </fieldset>
        ))}
        <button
          className="ft-primary"
          disabled={permission !== "granted" || busy}
          onClick={saveReminderSettings}
        >
          {t("Save reminders")}
        </button>
        <button
          className="ft-secondary"
          disabled={permission !== "granted"}
          onClick={() =>
            showDeviceNotification(
              t("FitTrack test reminder"),
              t("Your reminders are working."),
              "fittrack-test",
            )
          }
        >
          {t("Send test notification")}
        </button>
        <p className="ft-muted">
          {t(
            pushStatus === "enabled"
              ? "Background reminders are active on this device."
              : "Install FitTrack on your Home Screen and save reminders to enable background delivery when the server supports Web Push.",
          )}
        </p>
      </section>
      <section className="ft-card ft-form" data-testid="apple-health-settings">
        <h2>{t("Apple Health")}</h2>
        <p className="ft-muted">
          {healthAvailable()
            ? connected
              ? t("Connected through the FitTrack iOS app.")
              : t("Connect weight, steps, active energy and workouts.")
            : t(
                "Apple Health requires the signed FitTrack iOS app. Safari and web apps cannot access HealthKit directly.",
              )}
        </p>
        {!connected ? (
          <button
            className="ft-primary"
            disabled={busy || !healthAvailable()}
            onClick={connect}
          >
            {t("Connect Apple Health")}
          </button>
        ) : (
          <button className="ft-primary" disabled={busy} onClick={sync}>
            {t("Sync last 30 days")}
          </button>
        )}
        {healthSummary && (
          <p className="ft-muted" role="status">
            {healthSummary.steps?.toLocaleString()} {t("steps")} ·{" "}
            {Math.round(healthSummary.activeEnergyKcal || 0)} kcal ·{" "}
            {healthSummary.workouts || 0} {t("workouts")} ·{" "}
            {healthSummary.weights || 0} {t("weight records")}
          </p>
        )}
      </section>
    </>
  );
}

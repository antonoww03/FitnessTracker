import { storage } from "./i18n";

export const reminderDefaults = {
  water: { enabled: false, everyMinutes: 120, start: "08:00", end: "22:00" },
  workout: { enabled: false, time: "18:00" },
  weighIn: { enabled: false, time: "08:00" },
};

const settingsKey = (userId) => `fittrack-reminders:${userId}`;
export function loadReminders(userId) {
  try {
    return {
      ...reminderDefaults,
      ...JSON.parse(storage.get(settingsKey(userId)) || "{}"),
    };
  } catch {
    return reminderDefaults;
  }
}
export function saveReminders(userId, value) {
  return storage.set(settingsKey(userId), JSON.stringify(value));
}
export const notificationSupport = () =>
  "Notification" in window && "serviceWorker" in navigator;

export async function requestNotificationPermission() {
  if (!notificationSupport()) return "unsupported";
  return Notification.requestPermission();
}

export async function showDeviceNotification(title, body, tag) {
  if (!notificationSupport() || Notification.permission !== "granted")
    return false;
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, {
    body,
    tag,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: "/" },
  });
  return true;
}

const minutes = (value) => {
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
};
const sentKey = (userId, type, token) =>
  `fittrack-reminder-sent:${userId}:${type}:${token}`;

export async function checkReminders(userId, now = new Date()) {
  if (
    !userId ||
    !notificationSupport() ||
    Notification.permission !== "granted"
  )
    return;
  const settings = loadReminders(userId);
  const day = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const current = now.getHours() * 60 + now.getMinutes();
  const due = [];
  if (settings.water.enabled) {
    const start = minutes(settings.water.start);
    const end = minutes(settings.water.end);
    const every = Math.max(30, Number(settings.water.everyMinutes) || 120);
    if (current >= start && current <= end && (current - start) % every < 2)
      due.push([
        "water",
        `${day}-${Math.floor((current - start) / every)}`,
        "Time for water",
        "Log a glass and keep your daily target moving.",
      ]);
  }
  for (const [type, title, body] of [
    ["workout", "Workout reminder", "Your planned training is ready."],
    ["weighIn", "Weigh-in reminder", "Record your weight for a consistent trend."],
  ]) {
    const item = settings[type];
    if (item.enabled && Math.abs(current - minutes(item.time)) < 2)
      due.push([type, day, title, body]);
  }
  for (const [type, token, title, body] of due) {
    const key = sentKey(userId, type, token);
    if (storage.get(key)) continue;
    if (await showDeviceNotification(title, body, `fittrack-${type}`))
      storage.set(key, "1");
  }
}

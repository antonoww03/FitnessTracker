import { storage } from "./i18n";
import axios from "axios";
import { API } from "./api";

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
const nativeBridge = () =>
  window.FitTrackNotifications ||
  window.webkit?.messageHandlers?.fittrackNotifications ||
  null;
const nativePermissionKey = (userId) =>
  `fittrack-native-notifications:${userId}`;
function nativeNotificationCall(action, payload = {}) {
  const target = nativeBridge();
  if (!target) return Promise.reject(new Error("Native notifications unavailable"));
  if (typeof target[action] === "function")
    return Promise.resolve(target[action](payload));
  if (typeof target.postMessage !== "function")
    return Promise.reject(new Error("Native notifications unavailable"));
  const requestId = crypto.randomUUID
    ? crypto.randomUUID()
    : `notification-${Date.now()}-${Math.random()}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        window.removeEventListener("fittrack-notification-result", receive);
        reject(new Error("Notification service did not respond."));
      },
      30000,
    );
    const receive = (event) => {
      if (event.detail?.requestId !== requestId) return;
      clearTimeout(timeout);
      window.removeEventListener("fittrack-notification-result", receive);
      if (event.detail.ok) resolve(event.detail.data || {});
      else reject(new Error(event.detail.error || "Notification request failed."));
    };
    window.addEventListener("fittrack-notification-result", receive);
    try {
      target.postMessage({ action, requestId, payload });
    } catch (error) {
      clearTimeout(timeout);
      window.removeEventListener("fittrack-notification-result", receive);
      reject(error);
    }
  });
}
export const notificationSupport = () =>
  Boolean(nativeBridge()) ||
  ("Notification" in window && "serviceWorker" in navigator);
export const notificationPermission = (userId) =>
  nativeBridge()
    ? storage.get(nativePermissionKey(userId)) || "default"
    : "Notification" in window
      ? Notification.permission
      : "unsupported";
export async function refreshNotificationPermission(userId) {
  if (!nativeBridge()) return notificationPermission(userId);
  const result = await nativeNotificationCall("status");
  const permission = result.permission || "default";
  storage.set(nativePermissionKey(userId), permission);
  return permission;
}
export const backgroundPushSupport = () =>
  Boolean(nativeBridge()) ||
  (notificationSupport() && "PushManager" in window);

const applicationServerKey = (value) => {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const bytes = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
};

export async function syncBackgroundPush(reminders) {
  if (nativeBridge()) {
    await nativeNotificationCall("schedule", {
      reminders,
      language: document.documentElement.lang === "bg" ? "bg" : "en",
    });
    return "enabled";
  }
  if (!backgroundPushSupport() || Notification.permission !== "granted")
    return "unsupported";
  const { data: capability } = await axios.get(`${API}/push/public-key`);
  if (!capability.enabled) return "unconfigured";
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription)
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(capability.public_key),
    });
  await axios.put(`${API}/push/subscription`, {
    ...subscription.toJSON(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    language: document.documentElement.lang === "bg" ? "bg" : "en",
    reminders,
  });
  return "enabled";
}

export async function removeBackgroundPush() {
  if (nativeBridge()) {
    await nativeNotificationCall("cancel");
    return;
  }
  if (!backgroundPushSupport()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await axios.delete(`${API}/push/subscription`, {
      params: { endpoint: subscription.endpoint },
    });
  } finally {
    await subscription.unsubscribe();
  }
}

export async function requestNotificationPermission(userId) {
  if (!notificationSupport()) return "unsupported";
  if (nativeBridge()) {
    const result = await nativeNotificationCall("requestAuthorization");
    const permission = result.permission || "denied";
    storage.set(nativePermissionKey(userId), permission);
    return permission;
  }
  return Notification.requestPermission();
}

export async function showDeviceNotification(title, body, tag) {
  if (nativeBridge()) {
    await nativeNotificationCall("test", { title, body, tag });
    return true;
  }
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
  if (nativeBridge()) return;
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

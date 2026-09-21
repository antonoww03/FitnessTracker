import { storage } from "./i18n";

const bridge = () =>
  window.FitTrackHealth ||
  window.webkit?.messageHandlers?.fittrackHealth ||
  null;
export const healthAvailable = () => Boolean(bridge());
export const healthConnected = (userId) =>
  storage.get(`fittrack-health-connected:${userId}`) === "1";

function nativeCall(action, payload = {}) {
  const target = bridge();
  if (!target)
    return Promise.reject(
      new Error("Apple Health requires the signed FitTrack iOS app."),
    );
  if (typeof target[action] === "function")
    return Promise.resolve(target[action](payload));
  if (typeof target.postMessage !== "function")
    return Promise.reject(new Error("Apple Health bridge is unavailable."));
  const requestId = crypto.randomUUID
    ? crypto.randomUUID()
    : `health-${Date.now()}-${Math.random()}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Apple Health did not respond.")),
      30000,
    );
    const receive = (event) => {
      if (event.detail?.requestId !== requestId) return;
      clearTimeout(timeout);
      window.removeEventListener("fittrack-health-result", receive);
      if (event.detail.ok) resolve(event.detail.data || {});
      else reject(new Error(event.detail.error || "Apple Health request failed."));
    };
    window.addEventListener("fittrack-health-result", receive);
    target.postMessage({ action, requestId, payload });
  });
}

export async function connectHealth(userId) {
  const data = await nativeCall("requestAuthorization", {
    read: ["weight", "steps", "activeEnergy", "workouts"],
    write: ["weight", "workouts"],
  });
  storage.set(`fittrack-health-connected:${userId}`, "1");
  return data;
}
export const syncHealth = (from, to) => nativeCall("sync", { from, to });
export const writeHealthWeight = (userId, entry) =>
  healthConnected(userId) && healthAvailable()
    ? nativeCall("writeWeight", entry)
    : Promise.resolve();
export const writeHealthWorkout = (userId, entry) =>
  healthConnected(userId) && healthAvailable()
    ? nativeCall("writeWorkout", entry)
    : Promise.resolve();

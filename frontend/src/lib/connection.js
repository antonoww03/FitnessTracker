// Keep only request identities/timers; never persist form contents or credentials.
const pending = new Map();
const listeners = new Set();
let failed = false;
let snapshot = { slow: false, failed: false, pending: 0 };
const publish = () => {
  const next = { slow: [...pending.values()].some(item => item.slow), failed, pending: pending.size };
  if (next.slow === snapshot.slow && next.failed === snapshot.failed && next.pending === snapshot.pending) return;
  snapshot = next;
  listeners.forEach(listener => listener());
};
export const connectionSnapshot = () => snapshot;
export const subscribeConnection = listener => { listeners.add(listener); return () => listeners.delete(listener); };
export function beginRequest(config) {
  const item = { slow: false };
  item.timer = setTimeout(() => { item.slow = true; publish(); }, 8000);
  pending.set(config, item);
  publish();
}
export function endRequest(config, error = false) {
  clearTimeout(pending.get(config)?.timer);
  pending.delete(config);
  if (error) failed = true;
  // Only an explicit connectivity check dismisses a failure, not an unrelated response.
  publish();
}
export function connectionRecovered() { failed = false; publish(); }

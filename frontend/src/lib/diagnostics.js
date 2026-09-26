// Explicit allowlist only: no error messages, stack traces, URLs or form values.
const release = typeof __FITTRACK_BUILD_ID__ === "string" ? __FITTRACK_BUILD_ID__ : "development";
let count = 0;
const sent = new Set();
export function reportDiagnostic(kind, status = 0, requestId) {
  if (!["javascript", "unhandled_rejection", "render", "api"].includes(kind)) return;
  if (!Number.isInteger(status) || status < 0 || status > 599) return;
  const key = `${kind}:${status}`;
  if (typeof fetch !== "function") return;
  if (count >= 10 || sent.has(key) || !navigator.onLine) return;
  count++; sent.add(key);
  const body = {kind, status, release};
  if (/^[a-f0-9]{32}$/.test(requestId || "")) body.request_id = requestId;
  try { fetch("/api/diagnostics/client", {
    method:"POST", credentials:"same-origin", keepalive:true,
    headers:{"Content-Type":"application/json", "X-Requested-With":"FitTrack"},
    body:JSON.stringify(body),
  }).catch(() => {}); } catch { /* Diagnostics must never break application work. */ }
}
let installed = false;
export function installDiagnostics() {
  if (installed) return;
  installed = true;
  window.addEventListener("error", () => reportDiagnostic("javascript"));
  window.addEventListener("unhandledrejection", () => reportDiagnostic("unhandled_rejection"));
}

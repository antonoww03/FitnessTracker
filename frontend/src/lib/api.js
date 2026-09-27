import axios from "axios";
import { invalidateReads } from "./reads";
import { t } from "./i18n";
import { beginRequest, endRequest } from "./connection";
import { reportDiagnostic } from "./diagnostics";

const base = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
export const API = base.endsWith("/api") ? base : `${base}/api`;
// Allow a sleeping free backend to start; never automatically retry writes.
axios.defaults.timeout = 90000;
axios.defaults.withCredentials = true;
axios.defaults.headers.common["X-Requested-With"] = "FitTrack";

export function errorMessage(error, fallback) {
  if (!error.response && !axios.isCancel(error)) return t("Connection interrupted. Your input is still here. Check History before submitting again if a save may have reached the server.");
  if (error.response?.status >= 500) return t("The server is temporarily unavailable. Your input is still here. Try again shortly.");
  const detail = error.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

// A deliberate app refresh must not interrupt a request before the UI receives it.
const requests = new Set();
export const pendingRequests = () => requests.size > 0;
axios.interceptors.request.use(config => { requests.add(config); beginRequest(config); return config; });
axios.interceptors.response.use(
  response => { requests.delete(response.config); endRequest(response.config);
    if (!["get", "head", "options"].includes(response.config.method) && !response.config.url.includes("/auth/")) invalidateReads();
    return response; },
  error => {
    requests.delete(error.config);
    endRequest(error.config, !axios.isCancel(error) && (!error.response || error.response.status >= 500));
    if (error.response?.status >= 500) reportDiagnostic("api", error.response.status, error.response.headers?.["x-request-id"]);
    return Promise.reject(error);
  },
);

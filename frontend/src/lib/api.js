import axios from "axios";

const base = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
export const API = base.endsWith("/api") ? base : `${base}/api`;
// Allow a sleeping free backend to start; never automatically retry writes.
axios.defaults.timeout = 90000;
axios.defaults.withCredentials = true;
axios.defaults.headers.common["X-Requested-With"] = "FitTrack";

export function errorMessage(error, fallback) {
  const detail = error.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

// A deliberate app refresh must not interrupt a request before the UI receives it.
const requests = new Set();
export const pendingRequests = () => requests.size > 0;
axios.interceptors.request.use(config => { requests.add(config); return config; });
axios.interceptors.response.use(
  response => { requests.delete(response.config); return response; },
  error => { requests.delete(error.config); return Promise.reject(error); },
);

import axios from "axios";

const base = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
export const API = base.endsWith("/api") ? base : `${base}/api`;
axios.defaults.timeout = 30000;
axios.defaults.withCredentials = true;
axios.defaults.headers.common["X-Requested-With"] = "FitTrack";

export function errorMessage(error, fallback) {
  const detail = error.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

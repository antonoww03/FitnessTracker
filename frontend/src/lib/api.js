import axios from "axios";

const base = (process.env.REACT_APP_BACKEND_URL || "").replace(/\/+$/, "");
export const API = base.endsWith("/api") ? base : `${base}/api`;
axios.defaults.timeout = 120000;

export function errorMessage(error, fallback) {
  const detail = error.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

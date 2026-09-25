import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import { AppUpdate } from "@/components/AppUpdate";
import App from "@/App";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <AppUpdate />
    <App />
  </React.StrictMode>,
);

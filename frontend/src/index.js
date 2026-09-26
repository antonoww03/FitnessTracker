import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import { AppUpdate } from "@/components/AppUpdate";
import App from "@/App";

import { installDiagnostics } from "@/lib/diagnostics";
import { DiagnosticsBoundary } from "@/components/DiagnosticsBoundary";
installDiagnostics();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <DiagnosticsBoundary>
      <AppUpdate />
      <App />
    </DiagnosticsBoundary>
  </React.StrictMode>,
);

import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import { AppUpdate } from "@/components/AppUpdate";
import { ConnectionStatus } from "@/components/ConnectionStatus";
import App from "@/App";
import { Analytics } from "@vercel/analytics/react";

import { installDiagnostics } from "@/lib/diagnostics";
import { DiagnosticsBoundary } from "@/components/DiagnosticsBoundary";
installDiagnostics();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <DiagnosticsBoundary>
      <ConnectionStatus />
      <AppUpdate />
      <App />
      <Analytics />
    </DiagnosticsBoundary>
  </React.StrictMode>,
);

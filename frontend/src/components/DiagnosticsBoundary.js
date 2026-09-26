import React from "react";
import { reportDiagnostic } from "@/lib/diagnostics";
import { t } from "@/lib/i18n";
export class DiagnosticsBoundary extends React.Component {
  state = {failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  componentDidCatch() { reportDiagnostic("render"); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="ft-card ft-form" role="alert">
      <h2>{t("Something went wrong")}</h2>
      <p>{t("Reload to continue. Unsaved changes may be lost.")}</p>
      <button className="ft-primary" onClick={() => window.location.reload()}>{t("Reload")}</button>
    </section>;
  }
}

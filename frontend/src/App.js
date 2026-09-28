import React, { lazy, Suspense } from "react";
import "@/App.css";
import { Account } from "./components/Account";
import { t } from "./lib/i18n";

// Load dashboard features only after authentication.
const AppContent = lazy(() => import("./AppContent"));
export default function App() {
  return <Account>{(user, onLogout, onSignedOut) => (
    <Suspense fallback={<div className="ft-app ft-auth" role="status">{t("Loading…")}</div>}>
      <AppContent key={user.id} user={user} onLogout={onLogout} onSignedOut={onSignedOut} />
    </Suspense>
  )}</Account>;
}

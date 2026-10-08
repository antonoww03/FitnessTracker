import React, { useState } from "react";
import { t } from "@/lib/i18n";

export function AuthPassword({ name, label, visible, onToggle, minLength, autoComplete, describedBy, busy }) {
  const [caps, setCaps] = useState(false);
  const keyboard = event => setCaps(Boolean(event.getModifierState?.("CapsLock")));
  const id = `auth-${name}`;
  const action = visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`;
  return <div className="ft-auth-password">
    <label htmlFor={id}>{t(label)}</label>
    <div className="ft-auth-password-row">
      <input id={id} name={name} required type={visible ? "text" : "password"}
        autoComplete={autoComplete} minLength={minLength} maxLength={128}
        aria-describedby={[describedBy, caps ? `${id}-caps` : ""].filter(Boolean).join(" ") || undefined}
        onKeyDown={keyboard} onKeyUp={keyboard} onBlur={() => setCaps(false)} disabled={busy} />
      <button type="button" className="ft-secondary" aria-label={t(action)} title={t(action)}
        aria-pressed={visible} onClick={onToggle} disabled={busy}>
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>
          {visible && <path d="m3 3 18 18"/>}
        </svg>
      </button>
    </div>
    {caps && <p id={`${id}-caps`} role="status">{t("Caps Lock is on.")}</p>}
  </div>;
}

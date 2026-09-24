import React, { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";

export function ProfileCamera({ onCapture, onClose }) {
  const video = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let stream;
    const stop = () => stream?.getTracks().forEach((track) => track.stop());
    async function open() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t("Camera is unavailable in this browser. Open the HTTPS site or choose from gallery."));
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!active) { stop(); return; }
        video.current.srcObject = stream;
        await video.current.play();
      } catch (e) {
        stop();
        if (!active) return;
        setError(t(e.name === "NotAllowedError" || e.name === "SecurityError"
          ? "Camera permission denied. Allow camera access in your browser settings and try again."
          : e.name === "NotFoundError"
            ? "No camera found. Connect a camera or choose from gallery."
            : "Could not start the camera. Close other apps using it and try again."));
      }
    }
    open();
    return () => {
      active = false;
      stop();
    };
  }, []);

  function capture() {
    const source = video.current;
    if (!source?.videoWidth || !source.videoHeight) return;
    try {
      const scale = Math.min(1, 512 / Math.max(source.videoWidth, source.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(source.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(source.videoHeight * scale));
      canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
      onCapture(canvas.toDataURL("image/jpeg", 0.82));
    } catch {
      setError(t("The photo could not be read."));
    }
  }

  return (
    <section aria-label={t("Camera preview")} className="ft-card" data-testid="profile-camera">
      <h3>{t("Camera preview")}</h3>
      <video ref={video} autoPlay muted playsInline
        onLoadedData={() => setReady(true)}
        style={{ width: "100%", maxHeight: "50vh", objectFit: "contain", display: error ? "none" : "block" }} />
      {!ready && !error && <p role="status">{t("Waiting for camera permission…")}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="ft-row">
        <button type="button" className="ft-primary" disabled={!ready || !!error} onClick={capture}>{t("Capture photo")}</button>
        <button type="button" className="ft-secondary" onClick={onClose}>{t("Close camera")}</button>
      </div>
    </section>
  );
}

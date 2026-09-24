import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Camera, ImagePlus, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { API, errorMessage } from "@/lib/api";
import { t } from "@/lib/i18n";
import { useDraft } from "@/lib/drafts";

import { ProfileCamera } from "./ProfileCamera";

const EMPTY_PROFILE = {
  first_name: "",
  last_name: "",
  age: "",
  height_cm: "",
  weight_kg: "",
  gender: "",
  photo_data_url: null,
};

function resizePhoto(file) {
  if (!file.type.startsWith("image/"))
    return Promise.reject(new Error(t("Choose an image file.")));
  if (file.size > 10_000_000)
    return Promise.reject(new Error(t("The original photo must be under 10 MB.")));
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      try {
      const scale = Math.min(1, 512 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
      } catch { reject(new Error(t("The photo could not be read."))); }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t("The photo could not be read.")));
    };
    image.src = url;
  });
}

export function Profile({ user }) {
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [saved, setSaved] = useState(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const galleryRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const dirty = JSON.stringify(profile) !== JSON.stringify(saved);
  useDraft(dirty);

  useEffect(() => {
    axios
      .get(`${API}/profile`)
      .then(({ data }) => {
        const normalized = {
          ...EMPTY_PROFILE,
          ...data,
          age: data.age ?? "",
          height_cm: data.height_cm ?? "",
          weight_kg: data.weight_kg ?? "",
        };
        setProfile(normalized);
        setSaved(normalized);
        setLoaded(true);
      })
      .catch((e) => setError(errorMessage(e, t("Could not load profile."))))
      .finally(() => setLoading(false));
  }, []);

  const update = (key, value) => setProfile((current) => ({ ...current, [key]: value }));
  const choosePhoto = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setPhotoBusy(true);
    try {
      update("photo_data_url", await resizePhoto(file));
    } catch (e) {
      setError(e.message);
    } finally {
      setPhotoBusy(false);
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...profile,
        age: profile.age === "" ? null : Number(profile.age),
        height_cm: profile.height_cm === "" ? null : Number(profile.height_cm),
        weight_kg: profile.weight_kg === "" ? null : Number(profile.weight_kg),
      };
      const { data } = await axios.put(`${API}/profile`, payload);
      const normalized = {
        ...data,
        age: data.age ?? "",
        height_cm: data.height_cm ?? "",
        weight_kg: data.weight_kg ?? "",
      };
      setProfile(normalized);
      setSaved(normalized);
      toast.success(t("Profile saved"));
    } catch (e) {
      setError(errorMessage(e, t("Could not save profile.")));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p role="status">{t("Loading…")}</p>;
  if (!loaded) return <div role="alert">{error}<button className="ft-secondary" onClick={() => window.location.reload()}>{t("Retry")}</button></div>;
  const initials = `${profile.first_name?.[0] || ""}${profile.last_name?.[0] || ""}` || user.username.slice(0, 2);
  return (
    <form className="ft-card ft-form ft-profile" onSubmit={submit} data-testid="profile-page">
      <fieldset disabled={busy || photoBusy} className="ft-profile-fields">
      <div className="ft-profile-head">
        <div className="ft-profile-avatar" aria-label={t("Profile photo")}>
          {profile.photo_data_url ? (
            <img src={profile.photo_data_url} alt={t("Profile")} />
          ) : initials ? (
            <span>{initials.toUpperCase()}</span>
          ) : (
            <UserRound size={42} />
          )}
        </div>
        <div>
          <h2>{t("My Profile")}</h2>
          <p className="ft-muted">@{user.username}</p>
          <div className="ft-profile-photo-actions">
            <button type="button" className="ft-secondary" onClick={() => { setCameraOpen(false); galleryRef.current?.click(); }}>
              <ImagePlus size={17} /> {t("Choose from gallery")}
            </button>
            <button type="button" className="ft-secondary" onClick={() => { setError(""); setCameraOpen(true); }}>
              <Camera size={17} /> {t("Take a photo")}
            </button>
            {profile.photo_data_url && (
              <button type="button" className="ft-icon-button" aria-label={t("Remove photo")} onClick={() => update("photo_data_url", null)}>
                <Trash2 size={17} />
              </button>
            )}
          </div>
          <input ref={galleryRef} className="ft-file-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} />

        </div>
      </div>

      {cameraOpen && <ProfileCamera onClose={() => setCameraOpen(false)} onCapture={(photo) => { update("photo_data_url", photo); setCameraOpen(false); }} />}

      <div className="ft-profile-grid">
        <label>{t("First name")}<input name="first_name" maxLength="80" value={profile.first_name} onChange={(e) => update("first_name", e.target.value)} /></label>
        <label>{t("Last name")}<input name="last_name" maxLength="80" value={profile.last_name} onChange={(e) => update("last_name", e.target.value)} /></label>
        <label>{t("Age")}<input name="age" type="number" inputMode="numeric" min="13" max="120" value={profile.age} onChange={(e) => update("age", e.target.value)} /></label>
        <label>{t("Height (cm)")}<input name="height_cm" type="number" inputMode="decimal" min="50" max="280" step="0.1" value={profile.height_cm} onChange={(e) => update("height_cm", e.target.value)} /></label>
        <label>{t("Weight (kg)")}<input name="weight_kg" type="number" inputMode="decimal" min="20" max="500" step="0.1" value={profile.weight_kg} onChange={(e) => update("weight_kg", e.target.value)} /></label>
        <label>{t("Gender")}<select name="gender" value={profile.gender} onChange={(e) => update("gender", e.target.value)}><option value="">{t("Select")}</option><option value="male">{t("Male")}</option><option value="female">{t("Female")}</option><option value="other">{t("Other")}</option><option value="prefer_not_to_say">{t("Prefer not to say")}</option></select></label>
      </div>
      <p className="ft-muted">{t("Your profile details are private and belong only to this account.")}</p>
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="ft-primary" disabled={busy || photoBusy || !dirty}>{busy ? t("Saving…") : t("Save profile")}</button>
      </fieldset>
    </form>
  );
}

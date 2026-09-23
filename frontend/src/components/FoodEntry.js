import { t } from "@/lib/i18n";
import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Camera, Loader2, ScanBarcode, X } from "lucide-react";
import { toast } from "sonner";
import { API, errorMessage } from "@/lib/api";

import { MealType } from "./DailyTools";
const MACROS = ["calories", "protein", "fat", "carbs", "sugar", "fiber"];
const emptyMacros = () => Object.fromEntries(MACROS.map((key) => [key, ""]));

function BarcodeScanner({ busy, onCode }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [cameraError, setCameraError] = useState("");
  const video = useRef(null);
  const controls = useRef(null);
  const stop = () => {
    controls.current?.stop();
    controls.current = null;
    setOpen(false);
  };
  useEffect(() => () => controls.current?.stop(), []);
  async function start() {
    setOpen(true);
    setCameraError("");
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      controls.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        video.current,
        (result, error, scanner) => {
          if (!result) return;
          const value = result.getText();
          scanner.stop();
          controls.current = null;
          setOpen(false);
          setCode(value);
          onCode(value);
        },
      );
    } catch {
      setCameraError(
        t(
          "Camera scanning is unavailable. Allow camera access or enter the barcode.",
        ),
      );
    }
  }
  return (
    <section className="ft-barcode" data-testid="barcode-scanner">
      <div className="ft-row">
        <label className="ft-grow">
          {t("Barcode")}
          <Input
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9]*"
            minLength={8}
            maxLength={14}
            value={code}
            disabled={busy}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="3800014268048"
            aria-label={t("Barcode")}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !/^\d{8,14}$/.test(code)}
          onClick={() => onCode(code)}
        >
          <ScanBarcode className="h-4 w-4 mr-2" />
          {t("Find")}
        </Button>
      </div>
      {!open ? (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={start}
          className="w-full mt-2"
          data-testid="open-barcode-camera"
        >
          <Camera className="h-4 w-4 mr-2" />
          {t("Scan with camera")}
        </Button>
      ) : (
        <div className="ft-camera">
          <video ref={video} muted playsInline aria-label={t("Barcode camera")} />
          <Button
            type="button"
            variant="outline"
            onClick={stop}
            aria-label={t("Close camera")}
          >
            <X className="h-4 w-4 mr-2" />
            {t("Close")}
          </Button>
        </div>
      )}
      {cameraError && <p role="alert">{cameraError}</p>}
      <p className="ft-muted">
        {t("Product data comes from Open Food Facts. Check the label before saving.")}
      </p>
    </section>
  );
}

export const FoodEntry = ({ selectedDate, onFoodLogged }) => {
  const [mealType, setMealType] = useState("snack");
  const [description, setDescription] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [manual, setManual] = useState(false);
  const [values, setValues] = useState(emptyMacros);
  const [grams, setGrams] = useState(100);
  const [per100, setPer100] = useState(false);
  const [busy, setBusy] = useState(false);
  const lookupBarcode = async (barcode) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await axios.get(`${API}/food/barcode/${barcode}`);
      setDescription(data.food_name);
      setAnalysis(data);
      setPer100(true);
      setGrams(100);
      setValues(
        Object.fromEntries(
          MACROS.map((key) => [key, data[key] == null ? "" : data[key]]),
        ),
      );
      if (data.missing?.length)
        toast.warning(
          t("Fill the missing nutrition values from the product label."),
        );
    } catch (error) {
      toast.error(errorMessage(error, t("Product could not be found.")));
    } finally {
      setBusy(false);
    }
  };
  const analyze = async () => {
    if (busy || !description.trim()) return;
    setBusy(true);
    try {
      const { data } = await axios.post(`${API}/food/analyze`, {
        description: description.trim(),
      });
      setAnalysis(data);
      setPer100(true);
      setGrams(data.grams || 100);
      setValues(
        Object.fromEntries(
          MACROS.map((key) => [
            key,
            Math.round(((data[key] * 100) / (data.grams || 100)) * 1000) / 1000,
          ]),
        ),
      );
    } catch (error) {
      toast.error(
        errorMessage(
          error,
          "Food lookup failed. Try again or enter nutrition manually.",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (busy) return;
    if (
      !Number.isFinite(grams) ||
      grams <= 0 ||
      !description.trim() ||
      MACROS.some(
        (key) =>
          values[key] === "" ||
          !Number.isFinite(Number(values[key])) ||
          Number(values[key]) < 0,
      )
    ) {
      toast.error(
        "Enter a food description and all six nutrition values. Use 0 where appropriate.",
      );
      return;
    }
    setBusy(true);
    try {
      await axios.post(`${API}/food`, {
        meal_type: mealType,
        food_description: description.trim(),
        food_name: analysis?.food_name || description.trim(),
        ...Object.fromEntries(
          MACROS.map((key) => [
            key,
            Number(values[key]) * (per100 ? grams / 100 : 1),
          ]),
        ),
        date: selectedDate,
        grams,
      });
      toast.success("Food logged");
      setDescription("");
      setAnalysis(null);
      setValues(emptyMacros());
      setManual(false);
      await onFoodLogged();
    } catch (error) {
      toast.error(errorMessage(error, "Could not save food."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ft-card p-5" data-testid="food-entry">
      <h2 className="font-body text-lg tracking-normal font-bold text-white mb-4">
        {t("Log Food")}
      </h2>
      <MealType value={mealType} onChange={setMealType} />
      <BarcodeScanner busy={busy} onCode={lookupBarcode} />
      <div className="ft-or">{t("or enter food")}</div>
      <Textarea
        aria-label={t("Food description")}
        disabled={busy}
        placeholder="200 g chicken breast; 100 g cooked rice"
        value={description}
        onChange={(e) => {
          setDescription(e.target.value);
          setAnalysis(null);
          if (!manual) setValues(emptyMacros());
        }}
        className="bg-[#0A0A0A] border-[#2A2A2A] text-white text-sm"
        data-testid="food-description-input"
      />
      <p className="text-xs text-gray-400 mt-2">
        {t(
          "USDA lookup: English food names with grams per ingredient. Check the matched food and values before saving.",
        )}
      </p>
      {!manual && !analysis && (
        <Button
          disabled={busy || !description.trim()}
          onClick={analyze}
          className="mt-3 w-full bg-[#007AFF]"
          data-testid="analyze-food-button"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          {t("Look up nutrition")}
        </Button>
      )}
      <Button
        variant="ghost"
        disabled={busy}
        className="text-blue-400 mt-2 w-full"
        onClick={() => {
          setManual(!manual);
          setAnalysis(null);
          setPer100(false);
          setValues(emptyMacros());
        }}
      >
        {t(manual ? "Use USDA lookup" : "Enter nutrition manually")}
      </Button>
      {(manual || analysis) && (
        <div className="mt-3" data-testid="food-analysis-result">
          {analysis && (
            <p className="text-sm text-white mb-3">
              {t("Estimated:")}
              {analysis.food_name}
            </p>
          )}
          <p className="text-xs text-gray-400 mb-2">
            {t("Values for the entire portion being logged.")}
          </p>
          <div className="ft-row">
            <label>
              {t("Grams")}
              <Input
                type="number"
                min="0.1"
                step="any"
                value={grams}
                onChange={(e) => setGrams(Number(e.target.value))}
              />
            </label>
            <label>
              {t("Values")}
              <select
                value={per100 ? "100" : "portion"}
                onChange={(e) => setPer100(e.target.value === "100")}
              >
                <option value="portion">{t("Whole portion")}</option>
                <option value="100">{t("Per 100 g")}</option>
              </select>
            </label>
          </div>
          <p className="ft-muted">
            {Math.round(
              Number(values.calories || 0) * (per100 ? grams / 100 : 1),
            )}{" "}
            kcal · {grams} g
          </p>
          <div className="grid grid-cols-2 gap-2">
            {MACROS.map((key) => (
              <label key={key} className="text-xs text-gray-400 capitalize">
                {t(key)} ({key === "calories" ? "kcal" : "g"})
                <Input
                  aria-label={key}
                  type="number"
                  min="0"
                  step="any"
                  disabled={busy}
                  value={values[key]}
                  onChange={(e) =>
                    setValues({ ...values, [key]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <Button
            onClick={save}
            disabled={busy}
            className="mt-3 w-full bg-[#007AFF]"
            data-testid="confirm-food-button"
          >
            {t("Confirm")}
          </Button>
          <Button
            onClick={() => {
              setAnalysis(null);
              setManual(false);
            }}
            disabled={busy}
            variant="ghost"
            className="w-full text-gray-400"
            data-testid="cancel-food-button"
          >
            {t("Cancel")}
          </Button>
        </div>
      )}
    </div>
  );
};

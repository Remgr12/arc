import { useEffect, useState } from "react";

export type Platform = "windows" | "macos" | "linux";
export type WindowControlsStyle = "auto" | "windows" | "macos" | "linux";

export function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "windows";
  const ua = navigator.userAgent.toLowerCase();
  const plat = (navigator.platform || "").toLowerCase();
  if (plat.includes("mac") || ua.includes("macintosh") || ua.includes("mac os x")) {
    return "macos";
  }
  if (plat.includes("linux") || ua.includes("linux") || ua.includes("x11")) {
    return "linux";
  }
  return "windows";
}

const STORAGE_KEY = "arc:window_controls_style";

export function getWindowControlsPreference(): WindowControlsStyle {
  if (typeof localStorage === "undefined") return "auto";
  const val = localStorage.getItem(STORAGE_KEY);
  if (val === "windows" || val === "macos" || val === "linux" || val === "auto") {
    return val;
  }
  return "auto";
}

export function setWindowControlsPreference(pref: WindowControlsStyle): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, pref);
  window.dispatchEvent(new Event("arc:window_controls_changed"));
}

export function resolveEffectiveControlsStyle(pref: WindowControlsStyle): Platform {
  if (pref === "auto") {
    return detectPlatform();
  }
  return pref;
}

export function useWindowControlsStyle() {
  const [preference, setPreferenceState] = useState<WindowControlsStyle>(() =>
    getWindowControlsPreference(),
  );
  const [effectiveStyle, setEffectiveStyle] = useState<Platform>(() =>
    resolveEffectiveControlsStyle(getWindowControlsPreference()),
  );

  useEffect(() => {
    const handler = () => {
      const nextPref = getWindowControlsPreference();
      setPreferenceState(nextPref);
      setEffectiveStyle(resolveEffectiveControlsStyle(nextPref));
    };
    window.addEventListener("arc:window_controls_changed", handler);
    return () => window.removeEventListener("arc:window_controls_changed", handler);
  }, []);

  const updatePreference = (pref: WindowControlsStyle) => {
    setWindowControlsPreference(pref);
  };

  return { preference, effectiveStyle, setPreference: updatePreference };
}

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type ThemePref = "system" | "paper" | "dark";
export type Theme = "paper" | "dark";

const KEY = "hongsasub.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function loadPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "paper" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function systemDark() {
  return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;
}

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(loadPref);
  const [dark, setDark] = useState(systemDark);

  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = () => setDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const theme: Theme = pref === "system" ? (dark ? "dark" : "paper") : pref;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    try {
      getCurrentWindow()
        .setTheme(pref === "system" ? null : pref === "dark" ? "dark" : "light")
        .catch(() => undefined);
    } catch {
      return;
    }
  }, [pref]);

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      return;
    }
  }, []);

  return { pref, theme, setPref };
}

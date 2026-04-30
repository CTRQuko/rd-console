// Theme persistence + accent palette. Same shape as the legacy shell.jsx
// useThemeState — three knobs (mode/density/accent), all persisted under
// localStorage("cm-theme"). Side effects: toggles `dark` class, sets
// `data-density` on <html>, rewrites the --blue-* CSS vars to whatever
// accent the operator picked.
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export interface AccentDef {
  name: string;
  p500: string;
  p600: string;
  p700: string;
}

export const ACCENTS: Record<string, AccentDef> = {
  blue:   { name: "Blue",   p500: "#3b82f6", p600: "#2563eb", p700: "#1d4ed8" },
  violet: { name: "Violet", p500: "#8b5cf6", p600: "#7c3aed", p700: "#6d28d9" },
  green:  { name: "Green",  p500: "#22c55e", p600: "#16a34a", p700: "#15803d" },
  amber:  { name: "Amber",  p500: "#f59e0b", p600: "#d97706", p700: "#b45309" },
  rose:   { name: "Rose",   p500: "#f43f5e", p600: "#e11d48", p700: "#be123c" },
  slate:  { name: "Slate",  p500: "#64748b", p600: "#475569", p700: "#334155" },
};

export interface ThemeState {
  mode: "light" | "dark";
  density: "default" | "compact" | "comfortable";
  accent: keyof typeof ACCENTS | string;
}

const DEFAULTS: ThemeState = { mode: "light", density: "default", accent: "blue" };

export function useThemeState(
  defaults: ThemeState = DEFAULTS,
): [ThemeState, Dispatch<SetStateAction<ThemeState>>] {
  const [t, setT] = useState<ThemeState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("cm-theme") || "{}") as Partial<ThemeState>;
      return { ...defaults, ...saved };
    } catch {
      return defaults;
    }
  });
  useEffect(() => {
    localStorage.setItem("cm-theme", JSON.stringify(t));
    const root = document.documentElement;
    root.classList.toggle("dark", t.mode === "dark");
    root.dataset.density = t.density;
    const a = ACCENTS[t.accent] || ACCENTS.blue;
    root.style.setProperty("--blue-500", a.p500);
    root.style.setProperty("--blue-600", a.p600);
    root.style.setProperty("--blue-700", a.p700);
  }, [t]);
  return [t, setT];
}

// Палитры (светлая/тёмная) + контекст темы. Экраны строят стили из useTheme().c,
// поэтому переключение темы применяется на лету. Выбор хранится в SecureStore.
import React, { createContext, useContext, useEffect, useState } from "react";
import { getFlag, setFlag } from "./storage";

export type Palette = {
  bg: string; card: string; text: string; muted: string; border: string;
  primary: string; primaryText: string; danger: string; ok: string;
  chipBg: string; chipText: string; inputBg: string;
};

export const LIGHT: Palette = {
  bg: "#f5f7fa", card: "#ffffff", text: "#1e293b", muted: "#64748b",
  border: "#e2e8f0", primary: "#3b82f6", primaryText: "#ffffff",
  danger: "#dc2626", ok: "#16a34a", chipBg: "#eff6ff", chipText: "#1e40af",
  inputBg: "#ffffff",
};

export const DARK: Palette = {
  bg: "#0f172a", card: "#1e293b", text: "#e2e8f0", muted: "#94a3b8",
  border: "#334155", primary: "#3b82f6", primaryText: "#ffffff",
  danger: "#f87171", ok: "#4ade80", chipBg: "#1e3a5f", chipText: "#bfdbfe",
  inputBg: "#0b1220",
};

// Обратная совместимость: статичная светлая палитра для экранов до входа (Login).
export const C = LIGHT;
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

const THEME_KEY = "nm_theme_dark";

type Ctx = { c: Palette; dark: boolean; toggle: () => void };
const ThemeCtx = createContext<Ctx>({ c: LIGHT, dark: false, toggle: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    getFlag(THEME_KEY).then((v) => { if (v === "1") setDark(true); });
  }, []);

  const toggle = () => {
    setDark((d) => {
      const next = !d;
      setFlag(THEME_KEY, next ? "1" : "0");
      return next;
    });
  };

  const value: Ctx = { c: dark ? DARK : LIGHT, dark, toggle };
  return React.createElement(ThemeCtx.Provider, { value }, children);
}

export const useTheme = () => useContext(ThemeCtx);

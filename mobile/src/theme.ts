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
  // Единый стиль с сайтом: accent #5980a6, нейтрали как на веб-версии.
  bg: "#f2f2f3", card: "#ffffff", text: "#1d1f20", muted: "#5d5d60",
  border: "#d4d4d7", primary: "#5980a6", primaryText: "#ffffff",
  danger: "#b3261e", ok: "#2e7d32", chipBg: "#eef6ff", chipText: "#416180",
  inputBg: "#ffffff",
};

export const DARK: Palette = {
  // Тёмная — из навигацкого скейла сайта (accent-900 #1d2d3d и глубже).
  bg: "#12202c", card: "#1d2d3d", text: "#e8eef4", muted: "#8ea6bd",
  border: "#2c455d", primary: "#749dc4", primaryText: "#0f1a24",
  danger: "#e57373", ok: "#66bb6a", chipBg: "#23384c", chipText: "#b5d9fd",
  inputBg: "#16232f",
};

// Обратная совместимость: статичная светлая палитра для экранов до входа (Login).
export const C = LIGHT;
// Шкала отступов + радиусов (минимализм сайта: небольшой радиус).
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, r: 10, rSm: 6 };

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

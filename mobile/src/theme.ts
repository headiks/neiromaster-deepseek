// Тема Glass для приложения: палитры и размеры — из общих токенов (shared/tokens.ts),
// те же, что у сайта. Экраны строят стили из useTheme().c, поэтому смена темы — на лету.
// Выбор темы хранится на устройстве; по умолчанию — как в системе.
import React, { createContext, useContext, useEffect, useState } from "react";
import { useColorScheme, type TextStyle } from "react-native";
import { DARK, LIGHT, FONT_BY_WEIGHT, S, T, type Palette } from "../../shared/tokens";
import { getFlag, setFlag } from "./storage";

export { DARK, LIGHT, S, T };
export type { Palette };

const THEME_KEY = "nm_theme_dark";

type Ctx = { c: Palette; dark: boolean; toggle: () => void; fonts: boolean };
const ThemeCtx = createContext<Ctx>({ c: LIGHT, dark: false, toggle: () => {}, fonts: false });

export function ThemeProvider({ children, fonts }: { children: React.ReactNode; fonts: boolean }) {
  const system = useColorScheme();
  const [saved, setSaved] = useState<boolean | null>(null);
  useEffect(() => { getFlag(THEME_KEY).then((v) => { if (v === "1" || v === "0") setSaved(v === "1"); }); }, []);
  const dark = saved ?? system === "dark";
  const toggle = () => { const next = !dark; setSaved(next); setFlag(THEME_KEY, next ? "1" : "0"); };
  return React.createElement(ThemeCtx.Provider, { value: { c: dark ? DARK : LIGHT, dark, toggle, fonts } }, children);
}

export const useTheme = () => useContext(ThemeCtx);

/** Шрифт нужного веса: на Android fontWeight у своего шрифта не работает — нужен свой
 *  fontFamily на каждое начертание. Пока Manrope не загрузился — системный шрифт. */
export function font(weight: "400" | "500" | "600" | "700", loaded: boolean): TextStyle {
  return loaded ? { fontFamily: FONT_BY_WEIGHT[weight] } : { fontWeight: weight };
}

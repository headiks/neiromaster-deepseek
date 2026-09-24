// НейроМастер · Glass — палитры и размеры приложения (mobile/src/theme.ts берёт их отсюда).
// Значения совпадают с веб-токенами frontend/src/styles/glass.css и shared/tokens.json:
// один акцент, стеклянные поверхности, светлая и тёмная темы.
export type Palette = {
  // существующие ключи
  bg: string; card: string; text: string; muted: string; border: string;
  primary: string; primaryText: string; danger: string; ok: string;
  chipBg: string; chipText: string; inputBg: string;
  // новые ключи Glass
  gradient: [string, string, string];   // фон экрана, сверху вниз
  blobs: [string, string];              // цветные пятна фона
  fill: string;                         // сегменты, поля, выделение
  soft: string; softInk: string;        // подложка акцента и текст на ней
  okSoft: string; warn: string; warnSoft: string; dangerSoft: string;
  tabBar: string;                       // плавающий таб-бар
  blur: number;                         // intensity для expo-blur
  shadow: string;
  lineStrong: string;                   // контур элементов управления (контраст ≥ 3:1)
  knob: string;                         // ручка переключателя
  backdrop: string;                     // затемнение под модальным окном
};

export const LIGHT: Palette = {
  bg: "#f1f3f9", card: "rgba(255,255,255,0.60)", text: "#0f1222", muted: "#565d78",
  border: "rgba(255,255,255,0.90)", primary: "#4c6fff", primaryText: "#ffffff",
  danger: "#cf2e2e", ok: "#157a4c", chipBg: "rgba(76,111,255,0.13)", chipText: "#2a45c9",
  inputBg: "rgba(255,255,255,0.50)",
  gradient: ["#e6eaff", "#f1f3f9", "#f4ebff"], blobs: ["#d6f2ef", "#dde3ff"],
  fill: "rgba(255,255,255,0.50)", soft: "rgba(76,111,255,0.13)", softInk: "#2a45c9",
  okSoft: "rgba(21,122,76,0.12)", warn: "#8f5d00", warnSoft: "rgba(230,160,20,0.16)",
  dangerSoft: "rgba(207,46,46,0.10)", tabBar: "rgba(255,255,255,0.62)", blur: 40,
  shadow: "rgba(40,50,110,0.12)", lineStrong: "rgba(15,18,34,0.26)", knob: "#ffffff",
  backdrop: "rgba(10,12,25,0.38)",
};

export const DARK: Palette = {
  bg: "#0b0d16", card: "rgba(255,255,255,0.07)", text: "#eef0ff", muted: "#a0a7c6",
  border: "rgba(255,255,255,0.13)", primary: "#8ea2ff", primaryText: "#0a0c14",
  danger: "#ff8080", ok: "#63e0a3", chipBg: "rgba(142,162,255,0.18)", chipText: "#bfcaff",
  inputBg: "rgba(255,255,255,0.07)",
  gradient: ["#1a2150", "#0b0d16", "#26143f"], blobs: ["#0e4b4b", "#28327a"],
  fill: "rgba(255,255,255,0.07)", soft: "rgba(142,162,255,0.18)", softInk: "#bfcaff",
  okSoft: "rgba(99,224,163,0.13)", warn: "#ffcc66", warnSoft: "rgba(255,204,102,0.13)",
  dangerSoft: "rgba(255,128,128,0.13)", tabBar: "rgba(30,34,56,0.55)", blur: 30,
  shadow: "rgba(0,0,0,0.35)", lineStrong: "rgba(255,255,255,0.34)", knob: "#ffffff",
  backdrop: "rgba(0,0,0,0.55)",
};

// Отступы, радиусы, типографика (веб: --nm-r 26, --nm-r-s 16, пилюли 999).
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, r: 26, rSm: 16, pill: 999 };
export const T = {
  font: "Manrope",           // @expo-google-fonts/manrope: 400/500/600/700
  display: { fontSize: 31, fontWeight: "700" as const, letterSpacing: -0.9, lineHeight: 34 },
  h2: { fontSize: 20, fontWeight: "700" as const, letterSpacing: -0.5 },
  body: { fontSize: 15, lineHeight: 22 },
  small: { fontSize: 13 },
  micro: { fontSize: 12 },
  tab: { fontSize: 11, fontWeight: "600" as const },
};

// Начертания Manrope по весу: на Android fontWeight у своего шрифта не работает —
// нужен отдельный fontFamily на каждый вес (имена из @expo-google-fonts/manrope).
export const FONT_BY_WEIGHT = {
  "400": "Manrope_400Regular",
  "500": "Manrope_500Medium",
  "600": "Manrope_600SemiBold",
  "700": "Manrope_700Bold",
} as const;

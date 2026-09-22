// Минималистичные линейные иконки таб-бара (единый штрих, tintable через color).
// Стиль — Feather: viewBox 24, stroke 2, круглые концы/стыки, без заливки.
import React from "react";
import Svg, { Path, Circle, Line, Polyline } from "react-native-svg";

type P = { color: string; size?: number; strokeWidth?: number };

const base = (size = 24, sw = 2) => ({
  width: size, height: size, viewBox: "0 0 24 24",
  fill: "none", stroke: undefined as unknown as string,
  strokeWidth: sw, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
});

export function ChatIcon({ color, size = 24, strokeWidth = 2 }: P) {
  return (
    <Svg {...base(size, strokeWidth)} stroke={color}>
      <Path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </Svg>
  );
}

export function HistoryIcon({ color, size = 24, strokeWidth = 2 }: P) {
  return (
    <Svg {...base(size, strokeWidth)} stroke={color}>
      <Circle cx="12" cy="12" r="9" />
      <Polyline points="12 7 12 12 16 14" />
    </Svg>
  );
}

export function AskIcon({ color, size = 24, strokeWidth = 2 }: P) {
  return (
    <Svg {...base(size, strokeWidth)} stroke={color}>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M9.2 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.8 2.5-2.8 2.5" />
      <Line x1="12" y1="17" x2="12.01" y2="17" />
    </Svg>
  );
}

export function SettingsIcon({ color, size = 24, strokeWidth = 2 }: P) {
  // «слайдеры» — читается как настройки, минималистичнее шестерёнки
  return (
    <Svg {...base(size, strokeWidth)} stroke={color}>
      <Line x1="4" y1="8" x2="20" y2="8" />
      <Line x1="4" y1="16" x2="20" y2="16" />
      <Circle cx="9" cy="8" r="2.2" fill={color} stroke="none" />
      <Circle cx="15" cy="16" r="2.2" fill={color} stroke="none" />
    </Svg>
  );
}

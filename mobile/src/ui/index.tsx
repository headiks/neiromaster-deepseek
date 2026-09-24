// UI-кит Glass для приложения (COMPONENTS.md): фон, стеклянная карточка, текст, кнопка,
// бейдж, сегмент, чип, прогресс, переключатель. Цвета — только из useTheme().c.
import React, { createContext, useContext, useRef } from "react";
import {
  ActivityIndicator, Platform, Pressable, StyleSheet, Text, View,
  type PressableProps, type StyleProp, type TextProps, type TextStyle, type View as RNView, type ViewStyle,
} from "react-native";
import { BlurView, BlurTargetView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import type { Tone } from "../../../shared/status";
import { font, S, T, useTheme } from "../theme";

// ---------- Фон: градиент + два размытых пятна ----------
// На Android размытие в SDK 57 работает только относительно BlurTargetView: фон экрана
// обёрнут в него, а стеклянные элементы берут его как blurTarget (см. GlassCard/TabBar).
const BlurTargetCtx = createContext<React.RefObject<RNView | null> | null>(null);

export function GlassBackground({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  const target = useRef<RNView | null>(null);
  return (
    <BlurTargetCtx.Provider value={target}>
      <View style={{ flex: 1, backgroundColor: c.bg, overflow: "hidden" }}>
        <BlurTargetView ref={target} style={[StyleSheet.absoluteFill, { overflow: "hidden" }]} pointerEvents="none">
          <LinearGradient colors={c.gradient} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} />
          <Blob color={c.blobs[0]} style={{ top: -120, right: -140 }} />
          <Blob color={c.blobs[1]} style={{ bottom: 40, left: -160 }} />
        </BlurTargetView>
        {children}
      </View>
    </BlurTargetCtx.Provider>
  );
}

/** Мягкое цветное пятно фона: радиальный градиент к прозрачности (без дорогого blur). */
function Blob({ color, style }: { color: string; style: ViewStyle }) {
  const id = `b${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <Svg width={420} height={420} style={[st.blob, style]}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity={0.9} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="420" height="420" fill={`url(#${id})`} />
    </Svg>
  );
}

/** Стекло: размытие фона + полупрозрачная заливка и светлая кромка. */
export function Glass({ style, children, intensity, radius = S.r, fill }: {
  style?: StyleProp<ViewStyle>; children?: React.ReactNode; intensity?: number; radius?: number; fill?: string;
}) {
  const { c, dark } = useTheme();
  const target = useContext(BlurTargetCtx);
  const android = Platform.OS === "android";
  return (
    <View style={[{ borderRadius: radius, overflow: "hidden", borderWidth: 1, borderColor: c.border }, shadow(c.shadow), style]}>
      <BlurView intensity={intensity ?? c.blur} tint={dark ? "dark" : "light"} style={StyleSheet.absoluteFill}
                blurTarget={android && target ? target : undefined}
                blurMethod={android && target ? "dimezisBlurViewSdk31Plus" : undefined} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: fill ?? c.card }]} />
      {children}
    </View>
  );
}

export function GlassCard({ style, children }: { style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  return <Glass style={style}><View style={{ padding: S.lg, gap: S.sm }}>{children}</View></Glass>;
}

const shadow = (color: string): ViewStyle => ({
  shadowColor: color, shadowOpacity: 1, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 0,
});

// ---------- Текст ----------
type Variant = "display" | "h2" | "body" | "small" | "micro" | "tab";
export function Txt({ v = "body", w, color, style, ...rest }: TextProps & {
  v?: Variant; w?: "400" | "500" | "600" | "700"; color?: string;
}) {
  const { c, fonts } = useTheme();
  const base = T[v] as TextStyle;
  const weight = w || ((base.fontWeight as "400" | "600" | "700" | undefined) ?? "400");
  const { fontWeight: _fw, ...size } = base;
  return <Text style={[size, font(weight, fonts), { color: color || c.text }, style]} {...rest} />;
}

// ---------- Кнопка ----------
export function Button({ title, onPress, variant = "primary", loading, disabled, icon, style, big }: {
  title: string; onPress: () => void; variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean; disabled?: boolean; icon?: React.ReactNode; style?: StyleProp<ViewStyle>; big?: boolean;
}) {
  const { c } = useTheme();
  const bg = variant === "primary" ? c.primary : variant === "secondary" ? c.card : variant === "danger" ? c.dangerSoft : "transparent";
  const fg = variant === "primary" ? c.primaryText : variant === "danger" ? c.danger : variant === "ghost" ? c.muted : c.text;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || loading, busy: loading }}
               onPress={onPress} disabled={disabled || loading}
               style={({ pressed }) => [{
                 height: big ? 52 : 46, minWidth: 44, borderRadius: S.pill, backgroundColor: bg, paddingHorizontal: S.xl,
                 flexDirection: "row", alignItems: "center", justifyContent: "center", gap: S.sm,
                 borderWidth: variant === "secondary" ? 1 : 0, borderColor: c.border,
                 opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed ? 0.98 : 1 }],
               }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : icon}
      <Txt w="600" color={fg} style={{ fontSize: big ? 16 : 15 }}>{title}</Txt>
    </Pressable>
  );
}

// ---------- Бейдж ----------
export function Badge({ tone = "muted", children }: { tone?: Tone; children: React.ReactNode }) {
  const { c } = useTheme();
  const map: Record<Tone, [string, string]> = {
    ok: [c.okSoft, c.ok], warn: [c.warnSoft, c.warn], danger: [c.dangerSoft, c.danger], accent: [c.soft, c.softInk], muted: [c.fill, c.muted],
  };
  const [bg, fg] = map[tone];
  return (
    <View style={{ alignSelf: "flex-start", backgroundColor: bg, borderRadius: S.pill, paddingHorizontal: 10, paddingVertical: 3 }}>
      <Txt v="micro" w="600" color={fg}>{children}</Txt>
    </View>
  );
}

// ---------- Сегмент ----------
export function Segmented<V extends string>({ value, options, onChange }: {
  value: V; options: { value: V; label: string }[]; onChange: (v: V) => void;
}) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", backgroundColor: c.fill, borderRadius: S.pill, padding: 3, alignSelf: "flex-start" }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(o.value)}
                     style={{ minHeight: 36, justifyContent: "center", paddingHorizontal: 16, borderRadius: S.pill, backgroundColor: on ? c.card : "transparent" }}>
            <Txt v="small" w="600" color={on ? c.text : c.muted}>{o.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- Чип ----------
export function Chip({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean } & Pick<PressableProps, "accessibilityLabel">) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
               style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 14, justifyContent: "center", borderRadius: S.pill, borderWidth: 1, borderColor: c.border, backgroundColor: pressed ? c.fill : "transparent", opacity: disabled ? 0.45 : 1 })}>
      <Txt v="small" w="500">{label}</Txt>
    </Pressable>
  );
}

// ---------- Прогресс ----------
export function Progress({ value, tone, height = 6 }: { value: number; tone?: "ok"; height?: number }) {
  const { c } = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
          style={{ height, borderRadius: S.pill, backgroundColor: c.fill, overflow: "hidden" }}>
      <View style={{ width: `${pct * 100}%`, height: "100%", borderRadius: S.pill, backgroundColor: tone === "ok" ? c.ok : c.primary }} />
    </View>
  );
}

// ---------- Переключатель 50×30 ----------
export function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value, disabled }}
               disabled={disabled} onPress={() => onChange(!value)} hitSlop={8}
               style={{ width: 50, height: 30, borderRadius: 15, padding: 3, backgroundColor: value ? c.ok : c.lineStrong, opacity: disabled ? 0.5 : 1 }}>
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.knob, transform: [{ translateX: value ? 20 : 0 }] }} />
    </Pressable>
  );
}

/** Крупный заголовок экрана (T.display) с подписью сверху. */
export function ScreenTitle({ kicker, title }: { kicker?: string; title: string }) {
  const { c } = useTheme();
  return (
    <View style={{ marginBottom: S.xs }}>
      {kicker ? <Txt v="small" color={c.muted}>{kicker}</Txt> : null}
      <Txt v="display" accessibilityRole="header">{title}</Txt>
    </View>
  );
}

const st = StyleSheet.create({
  blob: { position: "absolute" },
});

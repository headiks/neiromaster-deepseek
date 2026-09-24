// Вход: знак, «НейроМастер», поля-пилюли, «Войти», подсказка про временный пароль.
// Первый вход по временному паролю — сразу здесь же задать свой (как /setup на сайте).
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path, Rect } from "react-native-svg";
import { font, S, useTheme } from "../theme";
import { login, setupPassword } from "../api";
import { Button, Glass, Txt } from "../ui";

export function Mark({ size = 52 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22">
      <Rect width="22" height="22" rx="7" fill={c.primary} />
      <Path d="M7 15.5V6.5L15 15.5V6.5" fill="none" stroke={c.primaryText} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { label: string }) {
  const { c, fonts } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Txt v="small" color={c.muted}>{label}</Txt>
      <TextInput accessibilityLabel={label} placeholderTextColor={c.muted} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
                 style={[{ height: 50, borderRadius: S.pill, paddingHorizontal: 18, fontSize: 16, color: c.text, backgroundColor: c.fill,
                           borderWidth: 1, borderColor: focus ? c.primary : c.border }, font("400", fonts)]} {...props} />
    </View>
  );
}

export default function Login({ onDone }: { onDone: () => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<string | null>(null);     // логин, если нужен свой пароль
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!username.trim() || !password) { setErr("Введите логин и пароль"); return; }
    setBusy(true); setErr(null);
    try {
      const r = await login(username.trim(), password);
      if (r.must_change_credentials) setSetup(r.username || username.trim());
      else onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось войти");
    } finally { setBusy(false); }
  }

  async function savePassword() {
    if (pw1.length < 8) { setErr("Пароль — от 8 символов"); return; }
    if (pw1 !== pw2) { setErr("Пароли не совпадают"); return; }
    setBusy(true); setErr(null);
    try { await setupPassword(setup!, pw1); onDone(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Не удалось сохранить пароль"); }
    finally { setBusy(false); }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: S.lg, paddingTop: insets.top + S.xl, paddingBottom: insets.bottom + S.xl }}
                  keyboardShouldPersistTaps="handled">
        <Glass>
          <View style={{ padding: S.xl, gap: S.lg }}>
            <View style={{ alignItems: "center", gap: S.md }}>
              <Mark />
              <Txt v="display" style={{ textAlign: "center" }}>НейроМастер</Txt>
              <Txt v="small" color={c.muted} style={{ textAlign: "center" }}>
                {setup ? "Первый вход: задайте свой пароль — временный перестанет действовать." : "Ассистент адаптации: план, сообщения и ответы на вопросы"}
              </Txt>
            </View>
            {err ? <View style={{ backgroundColor: c.dangerSoft, borderRadius: S.rSm, padding: S.md }}><Txt v="small" color={c.danger}>{err}</Txt></View> : null}
            {setup ? (
              <>
                <Field label="Новый пароль (от 8 символов)" value={pw1} onChangeText={setPw1} secureTextEntry autoComplete="new-password" />
                <Field label="Повторите пароль" value={pw2} onChangeText={setPw2} secureTextEntry autoComplete="new-password" onSubmitEditing={savePassword} />
                <Button big title="Сохранить и войти" onPress={savePassword} loading={busy} />
              </>
            ) : (
              <>
                <Field label="Логин" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} autoComplete="username" placeholder="ivanov.i" />
                <Field label="Пароль" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={submit} />
                <Button big title="Войти" onPress={submit} loading={busy} />
                <Txt v="small" color={c.muted} style={{ textAlign: "center" }}>Логин и временный пароль выдаёт администратор. Забыли пароль — обратитесь к нему.</Txt>
              </>
            )}
          </View>
        </Glass>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

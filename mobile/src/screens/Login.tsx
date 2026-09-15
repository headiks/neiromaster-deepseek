import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform,
} from "react-native";
import { C, S } from "../theme";
import * as api from "../api";

export default function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!username.trim() || !password) {
      setErr("Введите логин и пароль");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.login(username.trim(), password);
      onDone();
    } catch (e: any) {
      setErr(e?.message || "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={st.wrap}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={st.card}>
        <Text style={st.logo}>НейроМастер</Text>
        <Text style={st.sub}>Личный кабинет сотрудника</Text>

        <Text style={st.label}>Логин</Text>
        <TextInput
          style={st.input}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Логин"
          placeholderTextColor={C.muted}
        />
        <Text style={st.label}>Пароль</Text>
        <TextInput
          style={st.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="Пароль"
          placeholderTextColor={C.muted}
          onSubmitEditing={submit}
        />

        {err ? <Text style={st.err}>{err}</Text> : null}

        <TouchableOpacity style={[st.btn, busy && st.btnOff]} onPress={submit} disabled={busy}>
          {busy ? <ActivityIndicator color={C.primaryText} /> : <Text style={st.btnText}>Войти</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg, justifyContent: "center", padding: S.lg },
  card: {
    backgroundColor: C.card, borderRadius: 16, padding: S.xl,
    maxWidth: 420, width: "100%", alignSelf: "center",
    shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 12, elevation: 2,
  },
  logo: { fontSize: 26, fontWeight: "700", color: C.text, textAlign: "center" },
  sub: { fontSize: 14, color: C.muted, textAlign: "center", marginTop: S.xs, marginBottom: S.lg },
  label: { fontSize: 13, color: C.muted, marginTop: S.md, marginBottom: S.xs },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: S.md, paddingVertical: S.md, fontSize: 16, color: C.text, backgroundColor: "#fff",
  },
  err: { color: C.danger, marginTop: S.md, fontSize: 14 },
  btn: {
    backgroundColor: C.primary, borderRadius: 10, paddingVertical: 14,
    alignItems: "center", marginTop: S.lg,
  },
  btnOff: { opacity: 0.6 },
  btnText: { color: C.primaryText, fontSize: 16, fontWeight: "600" },
});

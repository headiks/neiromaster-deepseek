import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, StyleSheet, Alert,
} from "react-native";
import { C, S } from "../theme";
import * as api from "../api";

export default function Account({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [me, setMe] = useState<any>(null);
  const [oldp, setOldp] = useState("");
  const [newp, setNewp] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.me().then(setMe).catch(() => {});
  }, []);

  async function changePw() {
    if (!oldp || !newp) {
      setMsg({ text: "Заполните оба поля", ok: false });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api.changePassword(oldp, newp);
      // Смена пароля разлогинивает все сессии — выходим.
      setMsg({ text: "Пароль изменён. Войдите заново.", ok: true });
      setTimeout(async () => {
        await api.logout();
        onLoggedOut();
      }, 1200);
    } catch (e: any) {
      setMsg({ text: e?.message || "Не удалось сменить пароль", ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function doLogout() {
    await api.logout();
    onLoggedOut();
  }

  return (
    <ScrollView style={st.wrap} contentContainerStyle={{ padding: S.lg, paddingBottom: 40 }}>
      <Text style={st.h}>Профиль</Text>
      <View style={st.card}>
        <Row k="Имя" v={me?.name || me?.full_name || "—"} />
        <Row k="Логин" v={me?.username || "—"} />
        <Row k="Роль" v={roleRu(me?.role)} />
        {me?.position ? <Row k="Должность" v={me.position} /> : null}
        {me?.department ? <Row k="Отдел" v={me.department} /> : null}
      </View>

      <Text style={[st.h, { marginTop: S.xl }]}>Смена пароля</Text>
      <View style={st.card}>
        <TextInput style={st.input} value={oldp} onChangeText={setOldp} secureTextEntry
          placeholder="Текущий пароль" placeholderTextColor={C.muted} />
        <TextInput style={[st.input, { marginTop: S.sm }]} value={newp} onChangeText={setNewp} secureTextEntry
          placeholder="Новый пароль" placeholderTextColor={C.muted} />
        {msg ? <Text style={[st.msg, { color: msg.ok ? C.ok : C.danger }]}>{msg.text}</Text> : null}
        <TouchableOpacity style={[st.btn, busy && st.off]} onPress={changePw} disabled={busy}>
          {busy ? <ActivityIndicator color={C.primaryText} /> : <Text style={st.btnText}>Сменить пароль</Text>}
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={[st.btn, st.logout]} onPress={doLogout}>
        <Text style={[st.btnText, { color: C.danger }]}>Выйти</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={st.row}>
      <Text style={st.k}>{k}</Text>
      <Text style={st.v}>{v}</Text>
    </View>
  );
}
function roleRu(r?: string) {
  return r === "owner" ? "Владелец" : r === "admin" ? "Администратор" : r === "employee" ? "Сотрудник" : r || "—";
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  h: { fontSize: 18, fontWeight: "700", color: C.text, marginBottom: S.sm },
  card: { backgroundColor: C.card, borderRadius: 12, padding: S.md, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 6, elevation: 1 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: S.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  k: { color: C.muted, fontSize: 14 },
  v: { color: C.text, fontSize: 14, fontWeight: "500", flexShrink: 1, textAlign: "right", marginLeft: S.md },
  input: { borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: S.md, paddingVertical: S.md, fontSize: 15, color: C.text, backgroundColor: "#fff" },
  msg: { marginTop: S.sm, fontSize: 14 },
  btn: { backgroundColor: C.primary, borderRadius: 10, paddingVertical: 13, alignItems: "center", marginTop: S.md },
  off: { opacity: 0.6 },
  btnText: { color: C.primaryText, fontSize: 15, fontWeight: "600" },
  logout: { backgroundColor: "#fff", borderWidth: 1, borderColor: C.danger, marginTop: S.xl },
});

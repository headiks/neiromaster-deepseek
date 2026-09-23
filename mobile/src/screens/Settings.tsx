// «Настройки»: тема, переключатель «на больничном» (пауза плана адаптации),
// профиль, смена пароля, выход.
import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
  StyleSheet, Switch,
} from "react-native";
import { S, useTheme, Palette } from "../theme";
import * as api from "../api";
import { unregisterForPush } from "../notifications";

export default function Settings({ onLoggedOut }: { onLoggedOut: () => void }) {
  const { c, dark, toggle } = useTheme();
  const st = useMemo(() => makeStyles(c), [c]);
  const [me, setMe] = useState<any>(null);
  const [sick, setSick] = useState(false);
  const [sickBusy, setSickBusy] = useState(false);
  const [oldp, setOldp] = useState("");
  const [newp, setNewp] = useState("");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);

  useEffect(() => {
    api.me().then((u: any) => { setMe(u); setSick(u?.status === "paused"); }).catch(() => {});
  }, []);

  async function toggleSick(v: boolean) {
    setSick(v);           // оптимистично
    setSickBusy(true);
    try {
      const r = await api.setSick(v);
      setSick(r.sick);
    } catch {
      setSick(!v);        // откат при ошибке
    } finally {
      setSickBusy(false);
    }
  }

  async function changePw() {
    if (!oldp || !newp) { setMsg({ text: "Заполните оба поля", ok: false }); return; }
    setBusy(true); setMsg(null);
    try {
      await api.changePassword(oldp, newp);
      setMsg({ text: "Пароль изменён. Войдите заново.", ok: true });
      setTimeout(async () => { await api.logout(); onLoggedOut(); }, 1200);
    } catch (e: any) {
      setMsg({ text: e?.message || "Не удалось сменить пароль", ok: false });
    } finally {
      setBusy(false);
    }
  }

  // Тест: сервер присылает по сообщению каждого типа — сразу в «Чат» и пушем на телефон.
  async function testKinds() {
    setTestBusy(true); setTestMsg(null);
    try {
      const r = await api.testAllKinds();
      setTestMsg(`Отправлено сообщений: ${r.sent}. Откройте «Чат» — там по одному каждого типа.`);
    } catch (e: any) {
      setTestMsg(e?.message || "Не удалось отправить");
    } finally {
      setTestBusy(false);
    }
  }

  async function doLogout() {
    await unregisterForPush();
    await api.logout();
    onLoggedOut();
  }

  return (
    <ScrollView style={st.wrap} contentContainerStyle={{ padding: S.lg, paddingBottom: 40 }}>
      <Text style={st.h}>Оформление</Text>
      <View style={st.card}>
        <View style={st.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={st.tTitle}>Тёмная тема</Text>
            <Text style={st.tSub}>Светлое / тёмное оформление приложения</Text>
          </View>
          <Switch value={dark} onValueChange={toggle}
            trackColor={{ true: c.primary, false: c.border }} thumbColor="#fff" />
        </View>
      </View>

      <Text style={[st.h, { marginTop: S.xl }]}>План адаптации</Text>
      <View style={st.card}>
        <View style={st.toggleRow}>
          <View style={{ flex: 1 }}>
            <Text style={st.tTitle}>Я на больничном</Text>
            <Text style={st.tSub}>Пока включено, сообщения плана не приходят.
              Выключите после выхода — накопившееся придёт.</Text>
          </View>
          {sickBusy ? <ActivityIndicator color={c.primary} />
            : <Switch value={sick} onValueChange={toggleSick}
                trackColor={{ true: c.primary, false: c.border }} thumbColor="#fff" />}
        </View>
      </View>

      <Text style={[st.h, { marginTop: S.xl }]}>Уведомления</Text>
      <View style={st.card}>
        <Text style={st.tTitle}>Проверить все типы сообщений</Text>
        <Text style={st.tSub}>Придёт по одному сообщению каждого типа: текст, напоминание,
          чек-лист, проверка, опрос, мини-тест, передача наставнику.</Text>
        {testMsg ? <Text style={[st.msg, { color: c.muted }]}>{testMsg}</Text> : null}
        <TouchableOpacity style={[st.btn, testBusy && st.off]} onPress={testKinds} disabled={testBusy}>
          {testBusy ? <ActivityIndicator color={c.primaryText} /> : <Text style={st.btnText}>Прислать тестовые сообщения</Text>}
        </TouchableOpacity>
      </View>

      <Text style={[st.h, { marginTop: S.xl }]}>Профиль</Text>
      <View style={st.card}>
        <Row st={st} k="Имя" v={me?.full_name || "—"} />
        <Row st={st} k="Логин" v={me?.username || "—"} />
        {me?.position ? <Row st={st} k="Должность" v={me.position} /> : null}
        {me?.department ? <Row st={st} k="Отдел" v={me.department} /> : null}
      </View>

      <Text style={[st.h, { marginTop: S.xl }]}>Смена пароля</Text>
      <View style={st.card}>
        <TextInput style={st.input} value={oldp} onChangeText={setOldp} secureTextEntry
          placeholder="Текущий пароль" placeholderTextColor={c.muted} />
        <TextInput style={[st.input, { marginTop: S.sm }]} value={newp} onChangeText={setNewp} secureTextEntry
          placeholder="Новый пароль" placeholderTextColor={c.muted} />
        {msg ? <Text style={[st.msg, { color: msg.ok ? c.ok : c.danger }]}>{msg.text}</Text> : null}
        <TouchableOpacity style={[st.btn, busy && st.off]} onPress={changePw} disabled={busy}>
          {busy ? <ActivityIndicator color={c.primaryText} /> : <Text style={st.btnText}>Сменить пароль</Text>}
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={[st.btn, st.logout]} onPress={doLogout}>
        <Text style={[st.btnText, { color: c.danger }]}>Выйти</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Row({ st, k, v }: { st: Styles; k: string; v: string }) {
  return (
    <View style={st.row}>
      <Text style={st.k}>{k}</Text>
      <Text style={st.v}>{v}</Text>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;
const makeStyles = (c: Palette) => StyleSheet.create({
  wrap: { flex: 1, backgroundColor: c.bg },
  h: { fontSize: 18, fontWeight: "700", color: c.text, marginBottom: S.sm },
  card: { backgroundColor: c.card, borderRadius: 12, padding: S.md, borderWidth: 1, borderColor: c.border },
  toggleRow: { flexDirection: "row", alignItems: "center" },
  tTitle: { fontSize: 15, fontWeight: "600", color: c.text },
  tSub: { fontSize: 13, color: c.muted, marginTop: 2, marginRight: S.md, lineHeight: 18 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: S.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
  k: { color: c.muted, fontSize: 14 },
  v: { color: c.text, fontSize: 14, fontWeight: "500", flexShrink: 1, textAlign: "right", marginLeft: S.md },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: S.md,
    paddingVertical: S.md, fontSize: 15, color: c.text, backgroundColor: c.inputBg },
  msg: { marginTop: S.sm, fontSize: 14 },
  btn: { backgroundColor: c.primary, borderRadius: 10, paddingVertical: 13, alignItems: "center", marginTop: S.md },
  off: { opacity: 0.6 },
  btnText: { color: c.primaryText, fontSize: 15, fontWeight: "600" },
  logout: { backgroundColor: c.card, borderWidth: 1, borderColor: c.danger, marginTop: S.xl },
});

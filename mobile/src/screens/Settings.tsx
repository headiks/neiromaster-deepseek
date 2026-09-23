// «Настройки»: тема, переключатель «на больничном» (пауза плана адаптации + уведомление
// наставнику), профиль, выход. Пароль сотрудник не меняет — только администратор.
import React, { useEffect, useMemo, useState } from "react";
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator,
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
            <Text style={st.tSub}>Пока включено, сообщения плана не приходят, а наставник получит
              уведомление. Выключите после выхода — накопившееся придёт.</Text>
          </View>
          {sickBusy ? <ActivityIndicator color={c.primary} />
            : <Switch value={sick} onValueChange={toggleSick}
                trackColor={{ true: c.primary, false: c.border }} thumbColor="#fff" />}
        </View>
      </View>

      <Text style={[st.h, { marginTop: S.xl }]}>Профиль</Text>
      <View style={st.card}>
        <Row st={st} k="Имя" v={me?.full_name || "—"} />
        <Row st={st} k="Логин" v={me?.username || "—"} />
        {me?.position ? <Row st={st} k="Должность" v={me.position} /> : null}
        {me?.department ? <Row st={st} k="Отдел" v={me.department} /> : null}
      </View>

      <Text style={[st.tSub, { marginTop: S.md }]}>Забыли пароль или нужно его сменить — обратитесь к администратору.</Text>

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
  btn: { backgroundColor: c.primary, borderRadius: 10, paddingVertical: 13, alignItems: "center", marginTop: S.md },
  btnText: { color: c.primaryText, fontSize: 15, fontWeight: "600" },
  logout: { backgroundColor: c.card, borderWidth: 1, borderColor: c.danger, marginTop: S.xl },
});

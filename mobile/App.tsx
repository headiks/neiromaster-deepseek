import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, SafeAreaView, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import { S, ThemeProvider, useTheme, Palette } from "./src/theme";
import { getToken, me, myMessages } from "./src/api";
import { registerForPush, addNotificationListeners, presentLocal } from "./src/notifications";
import Login from "./src/screens/Login";
import Inbox from "./src/screens/Inbox";
import Ask from "./src/screens/Ask";
import Settings from "./src/screens/Settings";

type Tab = "today" | "history" | "ask" | "settings";
const TITLES: Record<Tab, string> = {
  today: "Сегодняшний чат",
  history: "История сообщений",
  ask: "Задать вопрос",
  settings: "Настройки",
};

export default function App() {
  return (
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  );
}

function Root() {
  const { c, dark } = useTheme();
  const st = useMemo(() => makeStyles(c), [c]);
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>("today");

  async function boot() {
    const token = await getToken();
    if (token) {
      try { await me(); setAuthed(true); } catch { setAuthed(false); }
    }
    setReady(true);
  }
  useEffect(() => { boot(); }, []);

  // После входа: запрашиваем разрешение на уведомления + канал (registerForPush),
  // тап по уведомлению -> сегодняшний чат.
  useEffect(() => {
    if (!authed) return;
    registerForPush();
    const off = addNotificationListeners(() => setTab("today"));
    return off;
  }, [authed]);

  // Локальные уведомления в шторке: опрашиваем инбокс и на КАЖДОЕ новое доставленное
  // сообщение показываем уведомление. Работает без FCM, пока приложение живо.
  // При первом проходе только запоминаем текущие id (не спамим историей).
  useEffect(() => {
    if (!authed) return;
    const seen = new Set<string>();
    let first = true;
    let stop = false;
    const tick = async () => {
      try {
        const res = await myMessages();
        const list: any[] = res?.messages || [];
        const fresh = list.filter((m) => m?.id && !seen.has(m.id));
        list.forEach((m) => m?.id && seen.add(m.id));
        if (!first) {
          for (const m of fresh) {
            if (stop) break;
            await presentLocal(m.title || "НейроМастер", m.body || "", { message_row_id: m.id });
          }
        }
        first = false;
      } catch { /* офлайн/ошибка — пропускаем проход */ }
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => { stop = true; clearInterval(id); };
  }, [authed]);

  if (!ready) {
    return <View style={st.center}><ActivityIndicator size="large" color={c.primary} /></View>;
  }

  if (!authed) {
    return (
      <>
        <StatusBar style={dark ? "light" : "dark"} />
        <Login onDone={() => { setTab("today"); setAuthed(true); }} />
      </>
    );
  }

  return (
    <SafeAreaView style={st.app}>
      <StatusBar style={dark ? "light" : "dark"} />
      <View style={st.header}>
        <Text style={st.brand}>НейроМастер</Text>
        <Text style={st.headerTab}>{TITLES[tab]}</Text>
      </View>

      <View style={{ flex: 1 }}>
        {tab === "today" && <Inbox scope="today" />}
        {tab === "history" && <Inbox scope="history" />}
        {tab === "ask" && <Ask />}
        {tab === "settings" && <Settings onLoggedOut={() => setAuthed(false)} />}
      </View>

      <View style={st.tabbar}>
        <TabBtn label="Сегодня" icon="💬" active={tab === "today"} onPress={() => setTab("today")} st={st} c={c} />
        <TabBtn label="История" icon="🗂️" active={tab === "history"} onPress={() => setTab("history")} st={st} c={c} />
        <TabBtn label="Вопрос" icon="❓" active={tab === "ask"} onPress={() => setTab("ask")} st={st} c={c} />
        <TabBtn label="Настройки" icon="⚙️" active={tab === "settings"} onPress={() => setTab("settings")} st={st} c={c} />
      </View>
    </SafeAreaView>
  );
}

function TabBtn({ label, icon, active, onPress, st, c }: {
  label: string; icon: string; active: boolean; onPress: () => void;
  st: ReturnType<typeof makeStyles>; c: Palette;
}) {
  return (
    <TouchableOpacity style={st.tab} onPress={onPress} activeOpacity={0.7}>
      <Text style={[st.tabIcon, active && { opacity: 1 }]}>{icon}</Text>
      <Text style={[st.tabLabel, active && { color: c.primary, fontWeight: "700" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  app: { flex: 1, backgroundColor: c.bg, paddingTop: Platform.OS === "android" ? 28 : 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },
  header: { paddingHorizontal: S.lg, paddingVertical: S.md, backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand: { fontSize: 18, fontWeight: "800", color: c.primary },
  headerTab: { fontSize: 14, color: c.muted },
  tabbar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: c.border, backgroundColor: c.card },
  tab: { flex: 1, alignItems: "center", paddingVertical: S.sm },
  tabIcon: { fontSize: 20, opacity: 0.5 },
  tabLabel: { fontSize: 11, color: c.muted, marginTop: 2 },
});

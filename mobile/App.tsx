import React, { useEffect, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, SafeAreaView, Platform, StatusBar as RNStatusBar } from "react-native";
import { StatusBar } from "expo-status-bar";
import { S, ThemeProvider, useTheme, Palette } from "./src/theme";
import { ChatIcon, HistoryIcon, AskIcon, SettingsIcon } from "./src/icons";

// Высота системной строки состояния (Android). iOS обрабатывает SafeAreaView.
const STATUSBAR_H = Platform.OS === "android" ? (RNStatusBar.currentHeight ?? 24) : 0;

type IconCmp = React.ComponentType<{ color: string; size?: number }>;
import { getToken, me, myMessages } from "./src/api";
import { registerForPush, addNotificationListeners, presentLocal, hasRemotePush } from "./src/notifications";
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

  // Локальные уведомления в шторке — запасной путь, когда FCM-токена нет: опрашиваем
  // инбокс и на КАЖДОЕ новое доставленное сообщение показываем уведомление (пока приложение живо).
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
        // Сервер уже шлёт пуш через FCM — локально не дублируем (иначе два уведомления).
        if (!first && !hasRemotePush()) {
          for (const m of fresh) {
            if (stop) break;
            await presentLocal(m.title || "НейроМастер", m.body || "", { message_row_id: m.id, kind: m.kind || "message" });
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
        <TabBtn label="Чат" Icon={ChatIcon} active={tab === "today"} onPress={() => setTab("today")} st={st} c={c} />
        <TabBtn label="История" Icon={HistoryIcon} active={tab === "history"} onPress={() => setTab("history")} st={st} c={c} />
        <TabBtn label="Вопрос" Icon={AskIcon} active={tab === "ask"} onPress={() => setTab("ask")} st={st} c={c} />
        <TabBtn label="Настройки" Icon={SettingsIcon} active={tab === "settings"} onPress={() => setTab("settings")} st={st} c={c} />
      </View>
    </SafeAreaView>
  );
}

function TabBtn({ label, Icon, active, onPress, st, c }: {
  label: string; Icon: IconCmp; active: boolean; onPress: () => void;
  st: ReturnType<typeof makeStyles>; c: Palette;
}) {
  const tint = active ? c.primary : c.muted;
  return (
    <TouchableOpacity style={st.tab} onPress={onPress} activeOpacity={0.7}>
      <Icon color={tint} size={24} />
      <Text style={[st.tabLabel, { color: tint }, active && { fontWeight: "700" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  // paddingTop = высота статус-бара: шапка не заходит под часы/иконки системы.
  app: { flex: 1, backgroundColor: c.bg, paddingTop: STATUSBAR_H },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg },
  header: { paddingHorizontal: S.lg, paddingVertical: S.md, backgroundColor: c.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand: { fontSize: 19, fontWeight: "800", color: c.primary, letterSpacing: 0.2 },
  headerTab: { fontSize: 13, color: c.muted },
  tabbar: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, backgroundColor: c.card, paddingBottom: Platform.OS === "android" ? 6 : 0 },
  tab: { flex: 1, alignItems: "center", paddingTop: S.sm, paddingBottom: S.xs },
  tabLabel: { fontSize: 11, marginTop: 4, letterSpacing: 0.1 },
});

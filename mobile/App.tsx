// НейроМастер · приложение сотрудника (Glass). Без верхней шапки: у каждого экрана крупный
// заголовок, внизу — плавающий таб-бар «Чат / История / Вопрос / Настройки».
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFonts, Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold } from "@expo-google-fonts/manrope";
import { S, ThemeProvider, useTheme } from "./src/theme";
import { api, getToken, setUnauthorizedHandler } from "./src/api";
import { getFlag, setFlag } from "./src/storage";
import { addNotificationListeners, registerForPush } from "./src/notifications";
import { DataProvider, useData } from "./src/data";
import { Glass, GlassBackground, Txt } from "./src/ui";
import { AskIcon, ChatIcon, HistoryIcon, SettingsIcon } from "./src/icons";
import Login from "./src/screens/Login";
import Today from "./src/screens/Today";
import History from "./src/screens/History";
import Ask from "./src/screens/Ask";
import Settings from "./src/screens/Settings";
import Help from "./src/screens/Help";

type Tab = "today" | "history" | "ask" | "settings";
const TABS: { id: Tab; label: string; Icon: typeof ChatIcon }[] = [
  { id: "today", label: "Чат", Icon: ChatIcon },
  { id: "history", label: "История", Icon: HistoryIcon },
  { id: "ask", label: "Вопрос", Icon: AskIcon },
  { id: "settings", label: "Настройки", Icon: SettingsIcon },
];
const HELP_SEEN = "nm_help_seen";

export default function App() {
  const [fontsLoaded, fontError] = useFonts({ Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold });
  return (
    <SafeAreaProvider>
      <ThemeProvider fonts={fontsLoaded && !fontError}>
        {fontsLoaded || fontError ? <Root /> : null}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const { c, dark } = useTheme();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    (async () => {
      if (await getToken()) {
        try { await api.me(); setAuthed(true); } catch { setAuthed(false); }
      }
      setReady(true);
    })();
    return () => setUnauthorizedHandler(null);
  }, []);

  return (
    <GlassBackground>
      <StatusBar style={dark ? "light" : "dark"} />
      {!ready ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator size="large" color={c.primary} /></View>
      ) : !authed ? (
        <Login onDone={() => setAuthed(true)} />
      ) : (
        <DataProvider><Main onLoggedOut={() => setAuthed(false)} /></DataProvider>
      )}
    </GlassBackground>
  );
}

function Main({ onLoggedOut }: { onLoggedOut: () => void }) {
  const [tab, setTab] = useState<Tab>("today");
  const [help, setHelp] = useState(false);
  useEffect(() => {
    getFlag("nm_push_off").then((off) => { if (off !== "1") registerForPush(); });
    const off = addNotificationListeners(() => setTab("today"));
    getFlag(HELP_SEEN).then((v) => { if (v !== "1") { setHelp(true); setFlag(HELP_SEEN, "1"); } });
    return off;
  }, []);
  return (
    <View style={{ flex: 1 }}>
      {tab === "today" && <Today />}
      {tab === "history" && <History />}
      {tab === "ask" && <Ask />}
      {tab === "settings" && <Settings onLoggedOut={onLoggedOut} onHelp={() => setHelp(true)} />}
      <TabBar tab={tab} onTab={setTab} />
      <Help visible={help} onClose={() => setHelp(false)} />
    </View>
  );
}

/** Плавающий таб-бар: пилюля с отступами 14/22, стекло, активная вкладка — подложка и акцент. */
function TabBar({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { unread } = useData();
  return (
    <View style={{ position: "absolute", left: 14, right: 14, bottom: insets.bottom + 22 }} accessibilityRole="tablist">
      <Glass radius={S.pill} fill={c.tabBar}>
        <View style={{ flexDirection: "row", padding: 6, gap: 4 }}>
          {TABS.map(({ id, label, Icon }) => {
            const on = tab === id;
            const tint = on ? c.primary : c.muted;
            return (
              <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={label}
                         onPress={() => onTab(id)}
                         style={{ flex: 1, minHeight: 54, borderRadius: S.pill, alignItems: "center", justifyContent: "center", gap: 3,
                                  backgroundColor: on ? c.fill : "transparent" }}>
                <Icon color={tint} size={23} />
                <Txt v="tab" color={tint}>{label}</Txt>
                {id === "today" && unread > 0 ? (
                  <View style={{ position: "absolute", top: 4, left: "55%", minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5,
                                 backgroundColor: c.primary, alignItems: "center", justifyContent: "center" }}>
                    <Txt v="micro" w="700" color={c.primaryText} style={{ fontSize: 10 }}>{unread > 99 ? "99+" : unread}</Txt>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}

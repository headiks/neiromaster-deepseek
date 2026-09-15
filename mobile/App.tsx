import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, SafeAreaView, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import { C, S } from "./src/theme";
import { getToken, me } from "./src/api";
import Login from "./src/screens/Login";
import Home from "./src/screens/Home";
import Chat from "./src/screens/Chat";
import Account from "./src/screens/Account";

type Tab = "home" | "chat" | "account";

export default function App() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>("home");

  async function boot() {
    const token = await getToken();
    if (token) {
      try {
        await me(); // валидируем токен
        setAuthed(true);
      } catch {
        setAuthed(false);
      }
    }
    setReady(true);
  }

  useEffect(() => {
    boot();
  }, []);

  if (!ready) {
    return (
      <View style={st.center}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  if (!authed) {
    return (
      <>
        <StatusBar style="dark" />
        <Login onDone={() => { setTab("home"); setAuthed(true); }} />
      </>
    );
  }

  return (
    <SafeAreaView style={st.app}>
      <StatusBar style="dark" />
      <View style={st.header}>
        <Text style={st.brand}>НейроМастер</Text>
        <Text style={st.headerTab}>{tab === "home" ? "Инбокс" : tab === "chat" ? "Вопрос ассистенту" : "Профиль"}</Text>
      </View>

      <View style={{ flex: 1 }}>
        {tab === "home" && <Home />}
        {tab === "chat" && <Chat />}
        {tab === "account" && <Account onLoggedOut={() => setAuthed(false)} />}
      </View>

      <View style={st.tabbar}>
        <TabBtn label="Инбокс" icon="🏠" active={tab === "home"} onPress={() => setTab("home")} />
        <TabBtn label="Ассистент" icon="💬" active={tab === "chat"} onPress={() => setTab("chat")} />
        <TabBtn label="Профиль" icon="👤" active={tab === "account"} onPress={() => setTab("account")} />
      </View>
    </SafeAreaView>
  );
}

function TabBtn({ label, icon, active, onPress }: { label: string; icon: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={st.tab} onPress={onPress} activeOpacity={0.7}>
      <Text style={[st.tabIcon, active && { opacity: 1 }]}>{icon}</Text>
      <Text style={[st.tabLabel, active && { color: C.primary, fontWeight: "700" }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.bg, paddingTop: Platform.OS === "android" ? 28 : 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
  header: { paddingHorizontal: S.lg, paddingVertical: S.md, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand: { fontSize: 18, fontWeight: "800", color: C.primary },
  headerTab: { fontSize: 14, color: C.muted },
  tabbar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.card },
  tab: { flex: 1, alignItems: "center", paddingVertical: S.sm },
  tabIcon: { fontSize: 20, opacity: 0.5 },
  tabLabel: { fontSize: 11, color: C.muted, marginTop: 2 },
});

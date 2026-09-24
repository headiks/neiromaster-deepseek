// «Настройки»: аватар с инициалами, план/дата выхода/наставник, переключатели (тема,
// уведомления, больничный), «Как пользоваться», выход. Пароль сотрудник не меняет —
// только администратор.
import React, { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { initials, ruDate } from "../../../shared/format";
import { useData } from "../data";
import { S, useTheme } from "../theme";
import { api, logout } from "../api";
import { getFlag, setFlag } from "../storage";
import { registerForPush, unregisterForPush } from "../notifications";
import { Button, GlassCard, ScreenTitle, Toggle, Txt } from "../ui";
import { HelpIcon, LogOutIcon } from "../icons";
import { Screen } from "./Screen";

const PUSH_OFF = "nm_push_off";

function Row({ title, sub, value, onChange, disabled }: { title: string; sub: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: S.md, paddingVertical: S.sm }}>
      <View style={{ flex: 1 }}>
        <Txt w="600">{title}</Txt>
        <Txt v="small" color={c.muted}>{sub}</Txt>
      </View>
      <Toggle label={title} value={value} onChange={onChange} disabled={disabled} />
    </View>
  );
}

export default function Settings({ onLoggedOut, onHelp }: { onLoggedOut: () => void; onHelp: () => void }) {
  const { c, dark, toggle } = useTheme();
  const { me, setMe, schedule } = useData();
  const [sickBusy, setSickBusy] = useState(false);
  const [push, setPush] = useState(true);
  useEffect(() => { getFlag(PUSH_OFF).then((v) => setPush(v !== "1")); }, []);
  const sick = me?.status === "paused";
  const setSick = async (v: boolean) => {
    if (!me) return;
    setSickBusy(true);
    try { const r = await api.setSick(v); setMe({ ...me, status: r.status }); } catch { /* останется как было */ } finally { setSickBusy(false); }
  };
  const setPushOn = async (v: boolean) => {
    setPush(v);
    await setFlag(PUSH_OFF, v ? "0" : "1");
    if (v) registerForPush(); else unregisterForPush();
  };
  const kv: [string, string][] = [
    ["План", schedule?.plan_title || "—"], ["Дата выхода", ruDate(me?.start_date)], ["Наставник", me?.mentor || "—"],
    ...(me?.manager ? [["Руководитель", me.manager] as [string, string]] : []), ["Логин", me?.username || "—"],
  ];
  return (
    <Screen>
      <ScreenTitle title="Настройки" />
      <GlassCard>
        <View style={{ flexDirection: "row", alignItems: "center", gap: S.lg }}>
          <View style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: c.soft, alignItems: "center", justifyContent: "center" }}>
            <Txt v="h2" color={c.softInk}>{initials(me?.full_name || me?.username)}</Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt v="h2">{me?.full_name || "—"}</Txt>
            <Txt v="small" color={c.muted}>{[me?.position, me?.department].filter(Boolean).join(" · ")}</Txt>
          </View>
        </View>
      </GlassCard>
      <GlassCard>
        {kv.map(([k, v]) => (
          <View key={k} style={{ flexDirection: "row", gap: S.md, paddingVertical: 4 }}>
            <Txt v="small" color={c.muted} style={{ width: 110 }}>{k}</Txt>
            <Txt v="small" style={{ flex: 1 }}>{v}</Txt>
          </View>
        ))}
      </GlassCard>
      <GlassCard>
        <Row title="Тёмная тема" sub="Светлое или тёмное оформление" value={dark} onChange={toggle} />
        {Platform.OS !== "web" ? <Row title="Уведомления" sub="Сообщать о новых сообщениях плана" value={push} onChange={setPushOn} /> : null}
        <Row title="Я на больничном" sub="Сообщения плана не приходят, наставник получит уведомление. Выключите после выхода — накопившееся придёт."
             value={sick} onChange={setSick} disabled={sickBusy} />
      </GlassCard>
      <Button title="Как пользоваться" variant="secondary" icon={<HelpIcon color={c.text} size={19} />} onPress={onHelp} />
      <Button title="Выйти" variant="danger" icon={<LogOutIcon color={c.danger} size={19} />}
              onPress={async () => { await unregisterForPush(); await logout(); onLoggedOut(); }} />
      <Txt v="small" color={c.muted} style={{ textAlign: "center" }}>Забыли пароль или нужно его сменить — обратитесь к администратору.</Txt>
    </Screen>
  );
}

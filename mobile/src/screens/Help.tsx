// «Как пользоваться» в приложении: короткий пошаговый рассказ о вкладках — тот же порядок,
// что у тура на сайте. Показывается при первом входе и из «Настроек».
import React, { useState } from "react";
import { Modal, View } from "react-native";
import { S, useTheme } from "../theme";
import { Button, Glass, Progress, Txt } from "../ui";
import { AskIcon, ChatIcon, HistoryIcon, SettingsIcon } from "../icons";

const STEPS = [
  { icon: ChatIcon, title: "Чат — сообщения на сегодня", text: "Здесь приходят сообщения плана адаптации: что сделать до выхода, в первый день и дальше. Старые — сверху, новые — снизу. Чек-листы отмечаются нажатием, в тестах выбирается ответ." },
  { icon: HistoryIcon, title: "История", text: "Сообщения прошлых дней, по датам. Ответы на чек-листы и тесты сохраняются — их видно и на сайте." },
  { icon: AskIcon, title: "Вопрос", text: "Спросите ассистента про пропуск, спецодежду, график или зарплату — ответ придёт по документам компании. Если ответа нет или вопрос срочный, его увидит специалист, а ответ появится в «Моих вопросах»." },
  { icon: SettingsIcon, title: "Настройки", text: "Тёмная тема, уведомления и «Я на больничном»: пока включено, сообщения плана на паузе, а наставник получит уведомление." },
];

export default function Help({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c } = useTheme();
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const close = () => { setI(0); onClose(); };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: "flex-end", padding: S.lg, paddingBottom: 40, backgroundColor: c.backdrop }}>
        <Glass fill={c.bg}>
          <View style={{ padding: S.xl, gap: S.md }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Txt v="small" w="600" color={c.softInk}>Как пользоваться</Txt>
              <Txt v="micro" color={c.muted}>{i + 1} из {STEPS.length}</Txt>
            </View>
            <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: c.soft, alignItems: "center", justifyContent: "center" }}>
              <step.icon color={c.softInk} />
            </View>
            <Txt v="h2">{step.title}</Txt>
            <Txt color={c.muted}>{step.text}</Txt>
            <Progress value={(i + 1) / STEPS.length} height={4} />
            <View style={{ flexDirection: "row", gap: S.sm, justifyContent: "flex-end" }}>
              <Button title={last ? "Закрыть" : "Пропустить"} variant="ghost" onPress={close} />
              {!last ? <Button title="Далее" onPress={() => setI(i + 1)} /> : <Button title="Понятно" onPress={close} />}
            </View>
          </View>
        </Glass>
      </View>
    </Modal>
  );
}

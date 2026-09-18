// Push-уведомления (Expo). Разрешение -> Expo push-token -> регистрация на бэке
// (POST /api/my/push-token). Бэк шлёт пуш при доставке сообщений плана.
// API сверен с docs.expo.dev v57 (см. mobile/AGENTS.md).
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { registerPushToken, removePushToken } from "./api";

// Как показывать уведомление, когда приложение на переднем плане.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;
  // Канал обязателен на Android 13+ до получения токена.
  await Notifications.setNotificationChannelAsync("default", {
    name: "Уведомления НейроМастер",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  });
}

let currentToken: string | null = null;

// Запросить разрешение, получить Expo push-token и зарегистрировать на сервере.
// Возвращает токен или null (веб / нет разрешения / офлайн). Ошибки не бросает.
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === "web") return null; // веб-пуш не настраиваем
  try {
    await ensureAndroidChannel();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return null;
    // projectId нужен getExpoPushTokenAsync; появляется после `eas init`
    // (Constants.expoConfig.extra.eas.projectId). Если нет — пробуем без него.
    const projectId =
      (Constants as any)?.expoConfig?.extra?.eas?.projectId ||
      (Constants as any)?.easConfig?.projectId;
    const res = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    currentToken = res.data;
    await registerPushToken(res.data, Platform.OS);
    return res.data;
  } catch (e) {
    console.warn("[push] регистрация не удалась", e);
    return null;
  }
}

// Отвязать токен на сервере (вызывать ДО logout — нужен живой Bearer).
export async function unregisterForPush(): Promise<void> {
  try {
    if (currentToken) await removePushToken(currentToken);
  } catch {
    // не критично: мёртвый токен бэк вычистит по ответу Expo (DeviceNotRegistered)
  }
  currentToken = null;
}

// Слушатели: приход уведомления (foreground) и тап по нему. Возвращает функцию отписки.
export function addNotificationListeners(onTap?: (data: any) => void): () => void {
  const recv = Notifications.addNotificationReceivedListener(() => {});
  const resp = Notifications.addNotificationResponseReceivedListener((r: any) => {
    onTap?.(r.notification.request.content.data);
  });
  return () => {
    recv.remove();
    resp.remove();
  };
}

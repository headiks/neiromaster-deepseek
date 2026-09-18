// Push-уведомления. Разрешение -> нативный FCM-токен устройства -> регистрация на
// бэке (POST /api/my/push-token). Бэк шлёт пуш через FCM HTTP v1 при доставке
// сообщений плана/ответов. API сверен с docs.expo.dev v57 (см. mobile/AGENTS.md).
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
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

// Запросить разрешение, получить нативный FCM-токен устройства и зарегистрировать
// на сервере. Прямой FCM (без Expo push-сервиса): бэкенд шлёт через FCM HTTP v1.
// Токен FCM даёт getDevicePushTokenAsync (нужен google-services.json в сборке).
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
    const res = await Notifications.getDevicePushTokenAsync(); // { type, data: <FCM token> }
    currentToken = res.data;
    await registerPushToken(res.data, res.type || Platform.OS);
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

// Показать локальное уведомление в шторке немедленно (без сервера/FCM). Работает,
// пока приложение живо (foreground/фон до выгрузки ОС). Для доставки при закрытом
// приложении нужен remote push (FCM + EAS-сборка).
export async function presentLocal(title: string, body: string, data: any = {}): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await ensureAndroidChannel();
    await Notifications.scheduleNotificationAsync({
      content: { title: title || "НейроМастер", body: body || "", data, sound: true },
      trigger: null, // немедленно
    });
  } catch (e) {
    console.warn("[local-notif] не показано", e);
  }
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

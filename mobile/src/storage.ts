// Кросс-платформенное хранилище токена сессии.
// Нативно (iOS/Android) — expo-secure-store (Keychain/Keystore, шифрование).
// В вебе SecureStore недоступен — падаем на localStorage.
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const KEY = "nm_session_token";

export async function getToken(): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      return typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    }
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  try {
    if (Platform.OS === "web") {
      localStorage.setItem(KEY, token);
    } else {
      await SecureStore.setItemAsync(KEY, token);
    }
  } catch {
    // не критично: без сохранения токена пользователь просто перелогинится
  }
}

export async function clearToken(): Promise<void> {
  try {
    if (Platform.OS === "web") {
      localStorage.removeItem(KEY);
    } else {
      await SecureStore.deleteItemAsync(KEY);
    }
  } catch {
    // ignore
  }
}

// Прочие мелкие настройки (тема и т.п.). Не секреты — но храним там же, чтобы не тащить
// ещё одну зависимость. Ключи SecureStore должны быть [A-Za-z0-9._-].
export async function getFlag(key: string): Promise<string | null> {
  try {
    if (Platform.OS === "web") {
      return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    }
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

export async function setFlag(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === "web") localStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  } catch {
    // не критично
  }
}

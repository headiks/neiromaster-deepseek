// API приложения: общий клиент сотрудника (shared/api.ts) поверх Bearer-токена из
// защищённого хранилища. Вход сохраняет токен, выход — удаляет.
import { createClient, ApiError, answerText, SUGGESTIONS } from "../../shared/api";
import { API_BASE } from "./config";
import { getToken, setToken, clearToken } from "./storage";

let onUnauthorized: (() => void) | null = null;
/** Что делать, если сервер ответил 401 (сессию отозвали) — вернуть на экран входа. */
export function setUnauthorizedHandler(fn: (() => void) | null) { onUnauthorized = fn; }

export const api = createClient({
  base: API_BASE,
  token: getToken,
  credentials: "omit",
  onUnauthorized: () => { clearToken().finally(() => onUnauthorized?.()); },
});

export async function login(username: string, password: string) {
  const data = await api.login(username, password);
  if (data?.token) await setToken(data.token);
  return data;
}

export async function logout() {
  try { await api.logout(); } catch { /* сервер мог уже погасить сессию */ }
  await clearToken();
}

/** Первый вход: заменить временный пароль своим. Сессии сбрасываются — после этого
 *  входим заново уже с новым паролем. */
export async function setupPassword(username: string, password: string) {
  await api.post("/api/setup-credentials", { password });
  await clearToken();
  return login(username, password);
}

export { ApiError, answerText, SUGGESTIONS, getToken };

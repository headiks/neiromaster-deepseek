// Клиент API: базовый URL + Bearer-токен из хранилища. Один вход для всех экранов.
import { API_BASE } from "./config";
import { getToken, setToken, clearToken } from "./storage";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T = any>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string> | undefined),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  } catch (e: any) {
    throw new ApiError(0, "Нет связи с сервером");
  }
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const detail = (data && (data.detail || data.message)) || `Ошибка ${res.status}`;
    throw new ApiError(res.status, typeof detail === "string" ? detail : "Ошибка запроса");
  }
  return data as T;
}

function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ---- Методы ----
export async function login(username: string, password: string) {
  const data = await request<{ token: string; username: string; role: string; must_change_credentials: boolean }>(
    "/api/login",
    { method: "POST", body: JSON.stringify({ username, password }) }
  );
  if (data?.token) await setToken(data.token);
  return data;
}

export async function logout() {
  try {
    await request("/api/logout", { method: "POST" });
  } catch {
    // сервер мог уже погасить сессию — всё равно чистим токен локально
  }
  await clearToken();
}

export const me = () => request("/api/me");
export const mySchedule = () => request("/api/my/schedule");
export const myMessages = () => request<{ messages: any[]; unread: number }>("/api/my/messages");
export const myQuestions = () => request<{ questions: any[] }>("/api/my/questions");
export const markRead = (id: string) =>
  request(`/api/my/messages/${encodeURIComponent(id)}/read`, { method: "POST" });
export const ask = (question: string, session_id?: string | null) =>
  request("/ask", { method: "POST", body: JSON.stringify({ question, session_id }) });
export const changePassword = (old_password: string, new_password: string) =>
  request("/api/password", { method: "POST", body: JSON.stringify({ old_password, new_password }) });

// Push: регистрация/отвязка токена устройства (Expo). Требуют авторизации (Bearer),
// поэтому removePushToken вызывается ДО logout, пока токен сессии ещё жив.
export const registerPushToken = (token: string, platform: string) =>
  request("/api/my/push-token", { method: "POST", body: JSON.stringify({ token, platform }) });
export const removePushToken = (token: string) =>
  request("/api/my/push-token", { method: "DELETE", body: JSON.stringify({ token }) });

export { getToken };

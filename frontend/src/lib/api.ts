// Клиент API сайта: общий клиент (shared/api.ts) поверх сессионной куки.
// 401 на любой странице, кроме входа, — сессия истекла: на форму входа.
import { ApiError, createClient, errorText } from '@shared/api';

const PUBLIC = ['/login', '/register'];

export const api = createClient({
  base: '',
  credentials: 'same-origin',
  onUnauthorized: () => {
    if (!PUBLIC.includes(location.pathname)) location.assign('/login');
  },
});

export { ApiError };

/** Загрузка файла (multipart). Возвращает данные ответа; ошибка — ApiError со status и data. */
export async function upload<T = any>(path: string, file: File, query: Record<string, string | boolean | undefined> = {}): Promise<T> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== false && v !== '') params.set(k, String(v)); });
  const body = new FormData();
  body.append('file', file);
  return api.request<T>(path + (params.toString() ? `?${params}` : ''), { method: 'POST', body });
}

/** Скачивание файла по ссылке (Excel с паролями, выгрузки) — браузер сам сохранит. */
export function download(href: string, name?: string) {
  const a = document.createElement('a');
  a.href = href;
  if (name) a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Текст ошибки для показа человеку. */
export function messageOf(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return errorText(null, 0);
}

export const enc = encodeURIComponent;

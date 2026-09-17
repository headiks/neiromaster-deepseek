// Тонкая обёртка над fetch. Session-cookie авторизация (как в исходном фронте):
// на 401 — единая переброска на форму входа. Прокси Vite/nginx отдаёт эти пути
// на FastAPI с того же origin, поэтому cookie ходит сама.

export async function api(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options);
  if (res.status === 401) {
    if (window.location.pathname !== '/login') window.location.href = '/login';
    throw new Error('Сессия истекла');
  }
  return res;
}

export interface JsonResult<T = any> {
  ok: boolean;
  data: T;
}

export async function apiJson<T = any>(url: string, options?: RequestInit): Promise<JsonResult<T>> {
  const res = await api(url, options);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

/** GET → распарсенный JSON (или бросает на !ok). */
export async function getJson<T = any>(url: string): Promise<T> {
  const res = await api(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const jsonHeaders = { 'Content-Type': 'application/json' };

export function postJson<T = any>(url: string, body?: unknown): Promise<JsonResult<T>> {
  return apiJson<T>(url, {
    method: 'POST',
    headers: body === undefined ? undefined : jsonHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function putJson<T = any>(url: string, body: unknown): Promise<JsonResult<T>> {
  return apiJson<T>(url, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(body) });
}

export function del<T = any>(url: string): Promise<JsonResult<T>> {
  return apiJson<T>(url, { method: 'DELETE' });
}

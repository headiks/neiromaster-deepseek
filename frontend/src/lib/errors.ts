// Ошибки интерфейса — в «Журнал действий» (тип client_error): текст, где случилась, стек.
// Так видно, что именно сломалось у пользователя, даже если он не открывал консоль.
let sent = 0;
const MAX_PER_PAGE = 10;               // не засыпать журнал, если ошибка повторяется в цикле
const seen = new Set<string>();

const BUILD = (() => {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]');
  return s?.src.split('/').pop() || '';
})();

function clip(text: unknown, n: number): string {
  const s = String(text ?? '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return clip(typeof error === 'string' ? error : JSON.stringify(error), 300);
}

/** Текст для «Подробностей»: ошибка, начало стека вызовов, страница и сборка. */
export function errorDetails(error: unknown): string {
  const stack = error instanceof Error && error.stack
    ? error.stack.split('\n').slice(1, 9).map((l) => l.trim()).join('\n')
    : '';
  return [describeError(error), stack, `${location.pathname} · ${BUILD}`].filter(Boolean).join('\n');
}

export function reportError(error: unknown, where: string, componentStack?: string | null) {
  const message = describeError(error);
  const key = `${where}|${message}`;
  if (sent >= MAX_PER_PAGE || seen.has(key) || ['/login', '/register'].includes(location.pathname)) return;
  seen.add(key);
  sent += 1;
  const detail = {
    where,
    message: clip(message, 400),
    stack: clip(error instanceof Error ? error.stack : '', 1400),
    component: clip(componentStack?.trim(), 800),
    build: BUILD,
    online: navigator.onLine,
  };
  try {
    fetch('/api/events', {
      method: 'POST', credentials: 'same-origin', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client_error', path: location.pathname + location.search, detail }),
    }).catch(() => {});
  } catch { /* отчёт об ошибке не должен ломать страницу */ }
}

let installed = false;

/** Необработанные ошибки и отклонённые промисы — тоже в журнал. */
export function installErrorReporting() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => {
    // Ошибка загрузки ресурса (картинка, скрипт) приходит без error — её не шлём.
    if (e.error) reportError(e.error, 'window.onerror');
  });
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'unhandledrejection'));
}

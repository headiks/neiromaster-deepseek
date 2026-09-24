// Журнал действий: клики по кнопкам и ссылкам (просмотры страниц пишет сервер).
// Одна подписка на весь сайт; ошибки логирования интерфейсу не мешают.
let installed = false;

export function installActivityLog() {
  if (installed) return;
  installed = true;
  document.addEventListener('click', (ev) => {
    const el = (ev.target as Element | null)?.closest?.('button, a, [data-log]') as HTMLElement | null;
    if (!el || el.closest('[data-nolog]') || ['/login', '/register', '/setup'].includes(location.pathname)) return;
    const text = (el.innerText || el.getAttribute('aria-label') || '').trim();
    const detail = { tag: el.tagName.toLowerCase(), id: el.id || null, name: el.getAttribute('data-log'), text: text ? text.slice(0, 80) : null };
    try {
      fetch('/api/events', {
        method: 'POST', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'click', path: location.pathname, detail }),
      }).catch(() => {});
    } catch { /* не мешаем интерфейсу */ }
  }, true);
}

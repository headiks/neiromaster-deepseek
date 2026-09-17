// Клиентское логирование кликов (порт static/activity.js). Просмотры страниц пишет сервер.
let started = false;

export function initActivityLogging(): void {
  if (started) return;
  started = true;
  document.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    const el = target?.closest?.('button, a, [data-log], input[type=submit], input[type=button]') as HTMLElement | null;
    if (!el) return;
    const text = (el.innerText || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '').trim();
    const detail = {
      tag: el.tagName ? el.tagName.toLowerCase() : '',
      id: el.id || null,
      name: el.getAttribute('data-log') || null,
      text: text ? text.slice(0, 80) : null,
    };
    try {
      fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
        body: JSON.stringify({ type: 'click', path: location.pathname, detail }),
      }).catch(() => {});
    } catch { /* логирование не мешает интерфейсу */ }
  }, true);
}

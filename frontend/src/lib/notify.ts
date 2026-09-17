// Клиент уведомлений плана адаптации (порт static/notify.js).
// Опрашивает инбокс, показывает всплывашки по одной (очередь) + браузерные уведомления.
// Реализация императивная (DOM), как в оригинале — самодостаточна, стартует один раз.

const POLL_MS = 20000;
const AUTO_MS = 8000;
const GAP_MS = 900;

let started = false;
const queue: { id: string; title: string; body: string }[] = [];
const seen: Record<string, boolean> = {};
let showing = false;

function napi(url: string, opts?: RequestInit): Promise<Response> {
  return fetch(url, opts).then((r) => { if (r.status === 401) throw new Error('401'); return r; });
}

function ensurePermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') { try { Notification.requestPermission(); } catch { /* старый API */ } }
}

function browserNotify(title: string, body: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title || 'НейроМастер', { body: (body || '').slice(0, 300), tag: 'neiromaster-plan' }); } catch { /* нужен SW */ }
}

function ensureContainer(): HTMLElement {
  let el = document.getElementById('nm-toast-wrap');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'nm-toast-wrap';
  el.style.cssText = "position:fixed;top:16px;right:16px;z-index:99999;display:flex;flex-direction:column;gap:10px;max-width:360px;width:calc(100vw - 32px);font-family:'Segoe UI',system-ui,-apple-system,sans-serif;";
  document.body.appendChild(el);
  return el;
}

function esc(s: unknown): string {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function showToast(msg: { title: string; body: string }, onClose: () => void) {
  const wrap = ensureContainer();
  const card = document.createElement('div');
  card.style.cssText = 'background:#fff;color:#1e293b;border-radius:12px;padding:14px 16px;box-shadow:0 10px 30px rgba(15,23,42,.22);border-left:4px solid #3b82f6;opacity:0;transform:translateY(-8px);transition:opacity .2s,transform .2s;';
  card.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">' +
    '  <strong style="font-size:14px;color:#0f172a;">' + esc(msg.title || 'Новое сообщение') + '</strong>' +
    '  <button aria-label="Закрыть" style="border:none;background:none;cursor:pointer;color:#94a3b8;font-size:18px;line-height:1;">&times;</button>' +
    '</div>' +
    '<div style="white-space:pre-wrap;font-size:13px;color:#334155;margin-top:6px;max-height:180px;overflow:auto;">' + esc(msg.body || '') + '</div>' +
    '<div style="text-align:right;margin-top:10px;">' +
    '  <button style="border:1px solid #cbd5e1;background:#f8fafc;color:#334155;border-radius:8px;padding:6px 14px;font-size:13px;cursor:pointer;">Прочитано</button>' +
    '</div>';
  wrap.appendChild(card);
  requestAnimationFrame(() => { card.style.opacity = '1'; card.style.transform = 'translateY(0)'; });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    card.style.opacity = '0';
    card.style.transform = 'translateY(-8px)';
    setTimeout(() => card.remove(), 200);
    onClose();
  };
  card.querySelector('button[aria-label="Закрыть"]')!.addEventListener('click', close);
  card.querySelectorAll('button')[1].addEventListener('click', close);
  const timer = setTimeout(close, AUTO_MS);
}

function pump() {
  if (showing || !queue.length) return;
  showing = true;
  const msg = queue.shift()!;
  browserNotify(msg.title, msg.body);
  showToast(msg, () => {
    napi(`/api/my/messages/${encodeURIComponent(msg.id)}/read`, { method: 'POST' }).catch(() => {});
    showing = false;
    setTimeout(pump, GAP_MS);
  });
}

export function pollNow(): void {
  napi('/api/my/messages')
    .then((r) => r.json())
    .then((d) => {
      (d.messages || []).forEach((m: any) => {
        if (m.status !== 'delivered' || seen[m.id]) return;
        seen[m.id] = true;
        queue.push({ id: m.id, title: m.title, body: m.body });
      });
      pump();
    })
    .catch(() => {});
}

export function testNotification(title?: string, body?: string): Promise<void> {
  ensurePermission();
  return napi('/api/my/messages/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title || '', body: body || '' }),
  }).then(() => { setTimeout(pollNow, 300); });
}

export function startNotifications(): void {
  if (started) return;
  started = true;
  ensurePermission();
  if ('Notification' in window && Notification.permission === 'default') {
    document.addEventListener('click', ensurePermission, { once: true });
  }
  pollNow();
  setInterval(pollNow, POLL_MS);
}

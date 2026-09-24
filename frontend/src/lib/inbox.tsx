// Входящие сообщения плана — общий источник для кабинета и счётчика в меню.
// Опрос раз в 30 с; новые сообщения — уведомление браузера (если разрешено) и тост.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Answers, Msg } from '@shared/types';
import { oldestFirst } from '@shared/format';
import { applyAnswer } from '@shared/progress';
import { api } from './api';
import { usePolling } from './poll';
import { useToast } from './toast';

export const NOTIFY_KEY = 'nm_notify';

export function notifyEnabled(): boolean {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  try { return localStorage.getItem(NOTIFY_KEY) !== '0'; } catch { return true; }
}

type Ctx = {
  messages: Msg[];
  unread: number;
  loaded: boolean;
  error: string | null;
  reload: () => Promise<void>;
  answer: (m: Msg, key: string, value: string | null) => void;
  markRead: (list: Msg[]) => void;
};

const InboxCtx = createContext<Ctx | null>(null);

export function InboxProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const toast = useToast();
  const navigate = useNavigate();

  const reload = useCallback(async () => {
    try {
      const d = await api.myMessages();
      const list = oldestFirst(d.messages || []);
      // Первый проход только запоминает, что уже есть, — историей не спамим.
      if (seen.current) {
        const fresh = list.filter((m) => m.id && !seen.current!.has(m.id) && m.status === 'delivered');
        fresh.slice(-3).forEach((m) => {
          if (notifyEnabled() && document.hidden) {
            try {
              const n = new Notification(m.title || 'НейроМастер', { body: (m.body || '').slice(0, 200), tag: m.id });
              n.onclick = () => { window.focus(); navigate('/'); };
            } catch { /* браузер без Notification */ }
          }
          toast.push({ tone: 'accent', title: m.title || 'Новое сообщение', text: (m.body || '').slice(0, 140),
                       action: location.pathname === '/' ? undefined : { label: 'Открыть', onClick: () => navigate('/') } });
        });
      }
      seen.current = new Set(list.map((m) => m.id));
      setMessages(list);
      setUnread(d.unread || 0);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoaded(true);
    }
  }, [navigate, toast]);

  usePolling(reload, enabled ? 30000 : 0, [enabled]);

  const answer = useCallback((m: Msg, key: string, value: string | null) => {
    const next: Answers | null = applyAnswer(m, key, value);
    if (!next) return;
    setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, answers: next } : x)));
    api.answer(m.id, next).catch(() => toast.error('Ответ не сохранился — проверьте связь и отметьте ещё раз.'));
  }, [toast]);

  const markRead = useCallback((list: Msg[]) => {
    const ids = list.filter((m) => m.status === 'delivered').map((m) => m.id);
    if (!ids.length) return;
    setMessages((all) => all.map((x) => (ids.includes(x.id) ? { ...x, status: 'read' } : x)));
    setUnread((n) => Math.max(0, n - ids.length));
    ids.forEach((id) => api.markRead(id).catch(() => {}));
  }, []);

  return (
    <InboxCtx.Provider value={{ messages, unread, loaded, error, reload, answer, markRead }}>{children}</InboxCtx.Provider>
  );
}

export function useInbox(): Ctx {
  const ctx = useContext(InboxCtx);
  if (!ctx) throw new Error('useInbox вне InboxProvider');
  return ctx;
}

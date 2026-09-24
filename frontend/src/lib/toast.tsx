// Всплывающие уведомления в углу экрана (вместо alert).
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import type { Tone } from '@shared/status';

type Toast = { id: number; tone: Tone; title?: string; text: string; action?: { label: string; onClick: () => void } };
type Push = (t: Omit<Toast, 'id'> & { timeout?: number }) => void;

const ToastCtx = createContext<Push>(() => {});

const ICON = { ok: CircleCheck, danger: CircleAlert, warn: TriangleAlert, accent: Info, muted: Info };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const seq = useRef(0);
  const close = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback<Push>(({ timeout, ...t }) => {
    const id = ++seq.current;
    setItems((l) => [...l.slice(-3), { ...t, id }]);
    window.setTimeout(() => close(id), timeout ?? (t.tone === 'danger' ? 8000 : 5000));
  }, [close]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="nm-toasts" role="status" aria-live="polite">
        {items.map((t) => {
          const Icon = ICON[t.tone] || Info;
          return (
            <div className="nm-toast" key={t.id} data-tone={t.tone}>
              <Icon aria-hidden />
              <div className="nm-grow">
                {t.title && <b>{t.title}</b>}
                <div className="nm-pre">{t.text}</div>
                {t.action && (
                  <button className="nm-link nm-small" onClick={() => { t.action!.onClick(); close(t.id); }}>{t.action.label}</button>
                )}
              </div>
              <button className="nm-btn nm-btn-ghost nm-btn-icon" aria-label="Закрыть" onClick={() => close(t.id)}><X /></button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

/** Стабильный объект (один на всё приложение): его можно класть в зависимости эффектов. */
export function useToast() {
  const push = useContext(ToastCtx);
  return useMemo(() => ({
    push,
    ok: (text: string, title?: string) => push({ tone: 'ok', text, title }),
    error: (text: string, title?: string) => push({ tone: 'danger', text, title }),
    info: (text: string, title?: string) => push({ tone: 'accent', text, title }),
    warn: (text: string, title?: string) => push({ tone: 'warn', text, title }),
  }), [push]);
}

// Примитивы Glass (COMPONENTS.md): кнопка, бейдж, карточка, поля, сегмент, чип, прогресс,
// переключатель, счётчик, пустое состояние, подсказка. Экраны собираются только из них.
import {
  forwardRef, useEffect, useId, useLayoutEffect, useRef,
  type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import type { StatusView, Tone } from '@shared/status';

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');
export { cx };

// ---------- Кнопка ----------
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  loading?: boolean;
  block?: boolean;
  iconOnly?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, loading, block, iconOnly, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('nm-btn', `nm-btn-${variant}`, size !== 'md' && `nm-btn-${size}`, block && 'nm-btn-block', iconOnly && 'nm-btn-icon', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="nm-spin" aria-hidden /> : Icon ? <Icon aria-hidden /> : null}
      {children}
    </button>
  );
});

// ---------- Бейдж ----------
export function Badge({ tone = 'muted', icon: Icon, children, title }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; title?: string }) {
  return <span className={`nm-badge nm-badge-${tone}`} title={title}>{Icon && <Icon aria-hidden />}{children}</span>;
}

export function StatusBadge({ view }: { view: StatusView }) {
  return <Badge tone={view.tone}>{view.label}</Badge>;
}

// ---------- Карточка ----------
type CardProps = HTMLAttributes<HTMLDivElement> & { as?: 'div' | 'section' | 'article'; pad?: boolean };
export function Card({ as: Tag = 'div', className, pad = true, ...rest }: CardProps) {
  return <Tag className={cx('nm-glass', pad ? 'nm-card' : 'nm-card-flat', className)} {...rest} />;
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="nm-row-between" style={{ paddingInline: 4 }}>
      <div className="nm-section-label">{children}</div>
      {action}
    </div>
  );
}

// ---------- Поля ----------
export function Field({ label, help, error, children, className }: { label?: ReactNode; help?: string; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cx('nm-field', className)}>
      {label && <span>{label}{help && <Help text={help} />}</span>}
      {children}
      {error && <div className="nm-error" role="alert">{error}</div>}
    </label>
  );
}

export function Help({ text }: { text: string }) {
  return <span className="nm-help" title={text} aria-label={text} role="img">?</span>;
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { small?: boolean }>(function Input(
  { className, small, ...rest }, ref,
) {
  return <input ref={ref} className={cx('nm-input', small && 'nm-input-sm', className)} {...rest} />;
});

export function Select({ className, small, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { small?: boolean }) {
  return <select className={cx('nm-select', small && 'nm-select-sm', className)} {...rest}>{children}</select>;
}

/** Многострочное поле; autosize — высота по содержимому, без внутренней прокрутки. */
export function Textarea({ className, autosize, value, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { autosize?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!autosize || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [autosize, value]);
  return <textarea ref={ref} className={cx('nm-textarea', autosize && 'nm-autosize', className)} value={value} {...rest} />;
}

export function Checkbox({ label, checked, onChange, disabled, id }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; id?: string }) {
  return (
    <label className="nm-checkbox">
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// ---------- Сегмент / чип ----------
export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label?: string;
}) {
  return (
    <div className="nm-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Chip({ pressed, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean }) {
  return <button type="button" className="nm-chip" aria-pressed={pressed === undefined ? undefined : pressed} {...rest}>{children}</button>;
}

// ---------- Прогресс / переключатель / счётчик ----------
export function Progress({ value, tone, small, indeterminate, label }: { value: number; tone?: 'ok' | 'danger'; small?: boolean; indeterminate?: boolean; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className={cx('nm-progress', small && 'nm-progress-sm')} data-tone={tone} data-indeterminate={indeterminate || undefined}
         role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={indeterminate ? undefined : pct} aria-label={label}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" className="nm-toggle" aria-checked={checked} aria-label={label} disabled={disabled}
            onClick={() => onChange(!checked)} />
  );
}

export function Count({ n }: { n?: number }) {
  return n ? <span className="nm-count" aria-label={`${n} новых`}>{n > 99 ? '99+' : n}</span> : null;
}

// ---------- Состояния ----------
export function Empty({ icon: Icon, children, action }: { icon?: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return <div className="nm-empty">{Icon && <Icon aria-hidden />}<div>{children}</div>{action}</div>;
}

export function Spinner({ label = 'Загрузка…' }: { label?: string }) {
  return <div className="nm-empty"><span className="nm-spin" aria-hidden /><div>{label}</div></div>;
}

export function Callout({ tone = 'accent', icon: Icon, children, action }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="nm-callout" data-tone={tone === 'accent' ? undefined : tone} role={tone === 'danger' ? 'alert' : undefined}>
      {Icon && <Icon aria-hidden />}
      <div className="nm-grow">{children}</div>
      {action}
    </div>
  );
}

export function Avatar({ text, large }: { text: string; large?: boolean }) {
  return <span className={cx('nm-avatar', large && 'nm-avatar-lg')} aria-hidden>{text}</span>;
}

// ---------- Логотип ----------
/** Знак: скруглённый квадрат акцента 22×22 (rx 7) с буквой N. */
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden focusable="false">
      <rect width="22" height="22" rx="7" fill="var(--nm-accent)" />
      <path d="M7 15.5V6.5L15 15.5V6.5" fill="none" stroke="var(--nm-on-accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------- Заголовок экрана ----------
export function PageHeader({ kicker, title, subtitle, actions, display }: {
  kicker?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; display?: boolean;
}) {
  return (
    <header className="nm-page-head" style={{ marginBottom: 0 }}>
      <div className="nm-grow">
        {kicker && <div className="nm-kicker">{kicker}</div>}
        {display ? <h1 className="nm-display">{title}</h1> : <h1>{title}</h1>}
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="nm-row">{actions}</div>}
    </header>
  );
}

/** Уникальный id для связки подписи и поля. */
export const useUid = useId;

/** Закрытие по клику вне элемента и по Escape. */
export function useDismiss(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>,
                           extra?: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const inside = (n: Node) => !!(ref.current?.contains(n) || extra?.current?.contains(n));
    const onDown = (e: MouseEvent) => { if (ref.current && !inside(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, [open, onClose, ref, extra]);
}

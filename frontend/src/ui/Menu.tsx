// Всплывающее меню (профиль, действия строки). Закрывается кликом вне и Escape.
// Рисуется поверх страницы (портал) и ставится по кнопке так, чтобы целиком влезть в окно:
// не хватает места с нужной стороны — открывается с другой, у края — прижимается к нему.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDismiss } from './index';

export type MenuEntry =
  | { label: string; icon?: LucideIcon; onClick: () => void; danger?: boolean; hidden?: boolean; href?: never }
  | { label: string; icon?: LucideIcon; href: string; hidden?: boolean; onClick?: never; danger?: never }
  | { section: string; hidden?: boolean }
  | { separator: true; hidden?: boolean };

const GAP = 8;      // от кнопки до меню
const EDGE = 8;     // от меню до края окна

type Pos = { top: number; left: number; maxHeight: number };

/** Место для меню размером w×h у элемента anchor: side — желаемая сторона. */
export function placeMenu(anchor: DOMRect, w: number, h: number, side: 'top' | 'bottom',
                          vw: number, vh: number): Pos {
  const left = Math.max(EDGE, Math.min(anchor.right - w, vw - w - EDGE));
  const above = anchor.top - GAP - EDGE;
  const below = vh - anchor.bottom - GAP - EDGE;
  const up = side === 'top' ? h <= above || above >= below : h > below && above > below;
  const maxHeight = Math.max(120, up ? above : below);
  const top = up ? anchor.top - GAP - Math.min(h, maxHeight) : anchor.bottom + GAP;
  return { top: Math.max(EDGE, top), left, maxHeight };
}

export function Menu({ trigger, items, side = 'bottom-end', label, anchor }: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode;
  items: MenuEntry[]; side?: 'top' | 'bottom-end'; label?: string;
  /** Селектор блока-родителя, к которому прикладывается меню (по умолчанию — сама кнопка). */
  anchor?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const navigate = useNavigate();
  const wrap = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, wrap, menu);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const box = ((anchor && wrap.current?.closest(anchor)) || wrap.current)?.getBoundingClientRect();
      const m = menu.current;
      if (!box || !m) return;
      setPos(placeMenu(box, m.offsetWidth, m.scrollHeight, side === 'top' ? 'top' : 'bottom',
                       document.documentElement.clientWidth, window.innerHeight));
    };
    place();
    const trigger = wrap.current;
    const el = menu.current;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      // Фокус был в меню (закрыли Escape или выбрали пункт) — возвращаем его на кнопку меню.
      const active = document.activeElement;
      if (!active || active === document.body || el?.contains(active)) trigger?.querySelector<HTMLElement>('button')?.focus();
    };
  }, [open, side, anchor]);

  // Фокус на первый пункт, когда меню уже видно: сразу работают стрелки и Enter.
  const shown = open && pos !== null;
  useEffect(() => {
    if (shown) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [shown]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || []);
    const i = list.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    list[next]?.focus();
  };

  // Внутри открытого модального окна меню должно жить в нём (иначе окажется под ним).
  const host = open ? (wrap.current?.closest('dialog') as HTMLElement | null) ?? document.body : null;
  return (
    <div className="nm-menu-wrap" ref={wrap}>
      {trigger({ onClick: () => setOpen((v) => !v), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && host && createPortal(
        <div className="nm-menu" role="menu" aria-label={label} ref={menu} onKeyDown={onKey}
             style={pos ? { top: pos.top, left: pos.left, maxHeight: pos.maxHeight } : { top: 0, left: 0, visibility: 'hidden' }}>
          {items.filter((i) => !i.hidden).map((item, i) => {
            if ('separator' in item) return <div key={i} className="nm-menu-sep" role="separator" />;
            if ('section' in item) return <div key={i} className="nm-menu-label">{item.section}</div>;
            const Icon = item.icon;
            const content = <>{Icon && <Icon aria-hidden />}<span className={item.danger ? 'nm-danger-text' : undefined}>{item.label}</span></>;
            return item.href ? (
              <a key={i} role="menuitem" className="nm-menu-item" href={item.href}
                 onClick={(e) => { e.preventDefault(); close(); navigate(item.href!); }}>{content}</a>
            ) : (
              <button key={i} role="menuitem" type="button" className="nm-menu-item" onClick={() => { close(); item.onClick!(); }}>{content}</button>
            );
          })}
        </div>,
        host,
      )}
    </div>
  );
}

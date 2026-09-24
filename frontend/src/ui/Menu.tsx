// Всплывающее меню (профиль, действия строки). Закрывается кликом вне и Escape.
import { useCallback, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useDismiss } from './index';

export type MenuEntry =
  | { label: string; icon?: LucideIcon; onClick: () => void; danger?: boolean; hidden?: boolean; href?: never }
  | { label: string; icon?: LucideIcon; href: string; hidden?: boolean; onClick?: never; danger?: never }
  | { section: string; hidden?: boolean }
  | { separator: true; hidden?: boolean };

export function Menu({ trigger, items, side = 'bottom-end', label }: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode;
  items: MenuEntry[]; side?: 'top' | 'bottom-end'; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  return (
    <div className="nm-menu-wrap" ref={ref}>
      {trigger({ onClick: () => setOpen((v) => !v), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div className="nm-menu" role="menu" aria-label={label} data-side={side}>
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
        </div>
      )}
    </div>
  );
}

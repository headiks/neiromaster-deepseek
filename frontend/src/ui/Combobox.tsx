// Поле с выпадающим списком и поиском: должность, подразделение, наставник, руководитель.
// free — можно добавить своё значение (нет в списке). mark/onDelete — пометка ✓ и удаление
// у пунктов (должности, для которых уже сгенерированы сообщения плана).
import { useCallback, useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useDismiss } from './index';

export function Combobox({ value, onChange, options, placeholder, free, disabled, marked, markTitle, onDelete, id }: {
  value: string; onChange: (v: string) => void; options: string[]; placeholder?: string; free?: boolean; disabled?: boolean;
  marked?: Set<string>; markTitle?: string; onDelete?: (v: string) => void; id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref);
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(needle));
  }, [options, q]);
  const raw = q.trim();
  const exact = items.some((o) => o.toLowerCase() === raw.toLowerCase());
  const pick = (v: string) => { onChange(v); setOpen(false); setQ(''); };
  return (
    <div className="nm-combo" ref={ref}>
      <input id={id} className="nm-input" readOnly value={value} placeholder={placeholder} disabled={disabled}
             onClick={() => !disabled && setOpen(true)}
             onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
             role="combobox" aria-expanded={open} aria-haspopup="listbox" style={{ cursor: disabled ? 'not-allowed' : 'pointer' }} />
      {open && (
        <div className="nm-combo-panel">
          <input className="nm-input" autoFocus placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter') { e.preventDefault(); if (free && raw) pick(raw); else if (items[0]) pick(items[0]); }
                 }} />
          <ul className="nm-combo-list" role="listbox">
            {value && <li className="nm-combo-note" onMouseDown={(e) => { e.preventDefault(); pick(''); }} style={{ cursor: 'pointer' }}>— очистить —</li>}
            {free && raw && !exact && <li className="nm-combo-add" onMouseDown={(e) => { e.preventDefault(); pick(raw); }}>Добавить: «{raw}»</li>}
            {items.map((o) => (
              <li key={o} role="option" aria-selected={o === value} onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                  title={marked?.has(o) ? markTitle : undefined}>
                {marked?.has(o) && <Check aria-label={markTitle} style={{ color: 'var(--nm-ok)', width: 15, height: 15 }} />}
                <span>{o}</span>
                {onDelete && marked?.has(o) && (
                  <button type="button" className="nm-combo-del" title="Удалить сообщения плана для должности"
                          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(o); }}><X style={{ width: 14, height: 14 }} /></button>
                )}
              </li>
            ))}
            {!items.length && !(free && raw) && <li className="nm-combo-note">ничего не найдено</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

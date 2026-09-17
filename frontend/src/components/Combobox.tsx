import { useEffect, useRef, useState } from 'react';

/**
 * Поле с поиском по списку значений (должности, ФИО наставника/руководителя).
 * Разрешает и свободный ввод. Клик/фокус открывает выпадающий список с фильтром.
 */
export default function Combobox({
  value, onChange, options, placeholder, id,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = options.filter((v) => v.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="combo-wrap" ref={wrapRef} style={{ position: 'relative' }}>
      <input
        id={id}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { setQuery(''); setOpen(true); }}
        onClick={() => { setQuery(''); setOpen(true); }}
      />
      {open && (
        <div className="combo-panel open" style={{ position: 'absolute', left: 0, top: '100%', width: '100%', zIndex: 50 }}>
          <input
            className="combo-search"
            type="text"
            placeholder="Поиск…"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          />
          <ul className="combo-list">
            {!filtered.length ? (
              <li className="empty">ничего не найдено</li>
            ) : (
              filtered.map((v) => (
                <li
                  key={v}
                  onMouseDown={(e) => { e.preventDefault(); onChange(v); setOpen(false); }}
                >
                  {v}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

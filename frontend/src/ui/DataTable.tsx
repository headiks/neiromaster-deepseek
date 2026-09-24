// Таблица на CSS-grid (COMPONENTS.md → DataTable): шапка micro/muted, строки 11×18.
// На узком экране строки превращаются в карточки (responsive="cards").
import type { ReactNode } from 'react';
import { cx } from './index';

export type Column<T> = { key: string; title: ReactNode; width: string; render: (row: T) => ReactNode; className?: string };

export function DataTable<T>({ columns, rows, rowKey, selectedKey, onRowClick, empty, className, label }: {
  columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; selectedKey?: string | null;
  onRowClick?: (row: T) => void; empty?: ReactNode; className?: string; label?: string;
}) {
  const template = columns.map((c) => c.width).join(' ');
  return (
    <div className={cx('nm-table nm-glass', className)} data-responsive="cards" role="table" aria-label={label}>
      <div className="nm-table-row nm-table-head" role="row" style={{ gridTemplateColumns: template }}>
        {columns.map((c) => <div key={c.key} role="columnheader">{c.title}</div>)}
      </div>
      <div className="nm-table-body" role="rowgroup">
        {rows.length ? rows.map((row) => {
          const key = rowKey(row);
          const click = onRowClick ? () => onRowClick(row) : undefined;
          return (
            <div key={key} className="nm-table-row" role={click ? 'button' : 'row'} tabIndex={click ? 0 : undefined}
                 aria-selected={selectedKey === key || undefined} style={{ gridTemplateColumns: template }}
                 onClick={click}
                 onKeyDown={click ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(); } } : undefined}>
              {columns.map((c) => <div key={c.key} role="cell" className={c.className}>{c.render(row)}</div>)}
            </div>
          );
        }) : <div className="nm-empty">{empty || 'Пусто'}</div>}
      </div>
    </div>
  );
}

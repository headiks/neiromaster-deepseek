// Простые графики «Сводки» на CSS без библиотек: полосы, полосы с долями, столбцы по неделям.
// Цвета — токены темы: статусы (--nm-ok/warn/danger) для состояний, --nm-series-* для категорий.
// Подсказка при наведении — title у каждой метки; числа подписаны текстом, не только цветом.

export type Seg = { key: string; label: string; value: number; color: string };

/** Горизонтальные полосы одного ряда: value 0..max, text — подпись справа. */
export function BarList({ items, max, label }: {
  items: { label: string; value: number; text: string; hint?: string }[]; max?: number; label: string;
}) {
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="nm-bars" role="list" aria-label={label}>
      {items.map((i) => (
        <div key={i.label} className="nm-bar-row" role="listitem" title={i.hint || `${i.label}: ${i.text}`}>
          <span className="nm-bar-label">{i.label}</span>
          <span className="nm-bar-track"><span className="nm-bar-fill" style={{ width: `${(100 * i.value) / top}%` }} /></span>
          <span className="nm-bar-value">{i.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Одна полоса долей (100%) — сегменты с промежутком 2px. */
export function Stack({ segs, total }: { segs: Seg[]; total?: number }) {
  const sum = total ?? segs.reduce((n, s) => n + s.value, 0);
  return (
    <span className="nm-stack-bar">
      {sum > 0 && segs.filter((s) => s.value > 0).map((s) => (
        <span key={s.key} style={{ flexGrow: s.value, background: s.color }} title={`${s.label}: ${s.value} (${Math.round((100 * s.value) / sum)}%)`} />
      ))}
    </span>
  );
}

export function Legend({ segs }: { segs: Seg[] }) {
  return (
    <div className="nm-legend">
      {segs.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label} · <b>{s.value}</b></span>)}
    </div>
  );
}

/** Полоса долей с легендой — распределение одной величины. */
export function Share({ segs, label }: { segs: Seg[]; label: string }) {
  return (
    <div className="nm-stack" style={{ gap: 8 }} role="group" aria-label={label}>
      <Stack segs={segs} />
      <Legend segs={segs} />
    </div>
  );
}

/** Строки с долями (например, решения наставников по подразделениям); легенда — одна на все строки. */
export function ShareRows({ rows, legend, label }: { rows: { label: string; segs: Seg[] }[]; legend: Seg[]; label: string }) {
  return (
    <div className="nm-stack" style={{ gap: 10 }} role="group" aria-label={label}>
      <div className="nm-bars">
        {rows.map((r) => (
          <div key={r.label} className="nm-bar-row">
            <span className="nm-bar-label">{r.label}</span>
            <Stack segs={r.segs} />
            <span className="nm-bar-value">{r.segs.reduce((n, s) => n + s.value, 0)}</span>
          </div>
        ))}
      </div>
      <Legend segs={legend} />
    </div>
  );
}

/** Столбцы по неделям, сложенные из рядов series. */
export function Columns({ cols, series, label }: {
  cols: { label: string; values: Record<string, number> }[]; series: { key: string; label: string; color: string }[]; label: string;
}) {
  const top = Math.max(1, ...cols.map((c) => series.reduce((n, s) => n + (c.values[s.key] || 0), 0)));
  const totals = series.map((s) => ({ ...s, value: cols.reduce((n, c) => n + (c.values[s.key] || 0), 0) }));
  return (
    <div className="nm-stack" style={{ gap: 8 }} role="group" aria-label={label}>
      <div className="nm-cols">
        {cols.map((c) => {
          const sum = series.reduce((n, s) => n + (c.values[s.key] || 0), 0);
          return (
            <div key={c.label} className="nm-col" title={`${c.label}: ${series.map((s) => `${s.label} ${c.values[s.key] || 0}`).join(', ')}`}>
              <span className="nm-col-sum">{sum || ''}</span>
              <span className="nm-col-bar" style={{ height: `${(100 * sum) / top}%` }}>
                {series.map((s) => (c.values[s.key] ? <span key={s.key} style={{ flexGrow: c.values[s.key], background: s.color }} /> : null))}
              </span>
              <span className="nm-col-label">{c.label}</span>
            </div>
          );
        })}
      </div>
      <Legend segs={totals} />
    </div>
  );
}

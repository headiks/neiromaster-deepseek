import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, RotateCcw, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import Header from '../components/Header';
import type { DocItem } from '../lib/types';

function fmtSize(v?: number) {
  if (!v) return '—';
  if (v < 1024) return v + ' Б';
  if (v < 1048576) return (v / 1024).toFixed(1) + ' КБ';
  return (v / 1048576).toFixed(1) + ' МБ';
}

const COLS: { k: string; t: string; fmt?: (v: any, r?: any) => React.ReactNode }[] = [
  { k: 'filename', t: 'Файл' },
  { k: 'mime', t: 'Тип', fmt: (v) => (v ? String(v).toUpperCase() : '—') },
  { k: 'size_bytes', t: 'Размер', fmt: (v) => fmtSize(v) },
  { k: 'status', t: 'Статус', fmt: (v) => <span className={`status-badge ${v || ''}`}>{v || '—'}</span> },
  { k: 'uploaded_at', t: 'Загружен', fmt: (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '—') },
  { k: 'folders', t: 'Папки', fmt: (v) => <Tags v={v} /> },
  { k: 'stage_ids', t: 'Этапы', fmt: (v) => (v?.length ? v.length : 0) },
  { k: 'substages', t: 'Подэтапы', fmt: (v) => (v?.length ? v.length : 0) },
  { k: 'keywords', t: 'Ключевые слова', fmt: (v) => <Tags v={v} /> },
  { k: 'embedding_dim', t: 'Вектор', fmt: (v) => (v ? v + 'D' : '—') },
];

function Tags({ v }: { v?: string[] }) {
  if (!v || !v.length) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return <div className="tags">{v.slice(0, 4).map((x) => <span className="tag" key={x}>{x}</span>)}{v.length > 4 && <span className="tag">+{v.length - 4}</span>}</div>;
}

export default function DocumentsTable() {
  const [data, setData] = useState<DocItem[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortK, setSortK] = useState('uploaded_at');
  const [sortDir, setSortDir] = useState(-1);
  const [drawer, setDrawer] = useState<any>(null);
  const [toast, setToast] = useState('');

  const load = () => {
    setData(null); setError('');
    api('/documents/table').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((d) => setData(d.documents || [])).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const showToast = (t: string) => { setToast(t); setTimeout(() => setToast(''), 2600); };

  const del = (fn: string) => {
    if (!confirm(`Удалить документ «${fn}» из базы знаний? Это уберёт его чанки, оригинал и метаданные.`)) return;
    api('/documents/' + encodeURIComponent(fn), { method: 'DELETE' }).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(() => { showToast('Удалено'); setDrawer(null); load(); }).catch((e) => showToast('Ошибка: ' + e.message));
  };
  const reindex = (fn: string) => {
    showToast('Переиндексация…');
    api('/documents/' + encodeURIComponent(fn) + '/reindex', { method: 'POST' }).then((r) => (r.ok ? r.json() : r.json().then((d) => { throw new Error(d.detail || 'HTTP ' + r.status); })))
      .then(() => { showToast('Переиндексировано'); setDrawer(null); load(); }).catch((e) => showToast('Ошибка: ' + e.message));
  };

  const view = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = (data || []).filter((r: any) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!q) return true;
      return `${r.filename || ''} ${(r.keywords || []).join(' ')}`.toLowerCase().includes(q);
    });
    return filtered.sort((a: any, b: any) => {
      let x = a[sortK], y = b[sortK];
      if (Array.isArray(x)) x = x.length;
      if (Array.isArray(y)) y = y.length;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x > y ? 1 : x < y ? -1 : 0) * sortDir;
    });
  }, [data, search, statusFilter, sortK, sortDir]);

  const counts: Record<string, number> = {};
  (data || []).forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
  const setSort = (k: string) => { if (sortK === k) setSortDir(-sortDir); else { setSortK(k); setSortDir(1); } };

  return (
    <div className="admin-page">
      <Header title="Реестр документов" actions={<><a className="ghost-btn" href="/documents-board">Этапы ↔ документы</a><button className="ghost-btn" onClick={load}><RefreshCw /> Обновить</button><a className="ghost-btn" href="/admin">← Админка</a></>} />
      <div className="toolbar" style={{ margin: '18px 0 14px' }}>
        <input type="text" placeholder="Поиск по имени файла или ключевым словам…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <button className="ghost-btn" style={statusFilter === '' ? activeChip : undefined} onClick={() => setStatusFilter('')}>Все</button>
        {Object.entries(counts).map(([s, n]) => (
          <button key={s} className="ghost-btn" style={statusFilter === s ? activeChip : undefined} onClick={() => setStatusFilter(s)}>{s} ({n})</button>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 14 }}>{data ? `${view.length} из ${data.length}` : ''}</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="schedule" style={{ minWidth: 1040 }}>
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.k} style={{ cursor: 'pointer' }} onClick={() => setSort(c.k)}>{c.t} {sortK === c.k ? (sortDir > 0 ? '▲' : '▼') : ''}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {error ? <tr><td colSpan={COLS.length + 1} className="empty-hint">Не удалось загрузить: {error}</td></tr>
              : !data ? <tr><td colSpan={COLS.length + 1} className="empty-hint">Загрузка…</td></tr>
              : !view.length ? <tr><td colSpan={COLS.length + 1} className="empty-hint">Ничего не найдено</td></tr>
              : view.map((row: any, i: number) => (
                <tr key={i} style={{ cursor: 'pointer' }} onClick={() => setDrawer(row)}>
                  {COLS.map((c) => <td key={c.k}>{c.fmt ? c.fmt(row[c.k], row) : (row[c.k] ?? '—')}</td>)}
                  <td style={{ color: 'var(--muted)' }}>›</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {drawer && <Drawer row={drawer} onClose={() => setDrawer(null)} onReindex={reindex} onDelete={del} />}
      {toast && <div className="toast-msg" style={toastStyle}>{toast}</div>}
    </div>
  );
}

function Drawer({ row, onClose, onReindex, onDelete }: { row: any; onClose: () => void; onReindex: (fn: string) => void; onDelete: (fn: string) => void }) {
  const subs = (row.substages || []).map((s: any) => `${s.substage_id} · ${Number(s.score || 0).toFixed(2)}`);
  const RL = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--muted)', fontWeight: 700, margin: '15px 0 4px' }}>{children}</div>;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(10,16,25,.5)', zIndex: 40 }} />
      <aside style={{ position: 'fixed', top: 0, right: 0, height: '100%', width: 'min(430px,94vw)', background: 'var(--color-bg)', borderLeft: '1px solid var(--color-divider)', zIndex: 41, display: 'flex', flexDirection: 'column', boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--color-divider)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div><div style={{ fontWeight: 700 }}>{row.filename}</div><div className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{(row.mime || '').toUpperCase()} · {fmtSize(row.size_bytes)}</div></div>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose}><X /></button>
        </div>
        <div style={{ padding: '4px 20px 22px', overflow: 'auto' }}>
          <RL>Статус</RL><span className={`status-badge ${row.status || ''}`}>{row.status || '—'}</span>
          <RL>sha256 (ключ дедупликации)</RL><div className="mono" style={{ wordBreak: 'break-all', color: 'var(--muted)' }}>{row.sha256}</div>
          <RL>Загружен</RL><div>{(row.uploaded_at || '—').replace('T', ' ')}{row.uploaded_by ? ' · ' + row.uploaded_by : ''}</div>
          <RL>Краткое описание</RL><div>{row.summary || '—'}</div>
          <RL>Смысловые папки</RL><Tags v={row.folders} />
          <RL>Этапы</RL><div className="mono">{(row.stage_ids || []).join(', ') || '—'}</div>
          <RL>Подэтапы (score)</RL><div className="tags">{subs.length ? subs.map((s: string) => <span className="tag" key={s}>{s}</span>) : <span style={{ color: 'var(--muted)' }}>—</span>}</div>
          <RL>Ключевые слова</RL><Tags v={row.keywords} />
          <RL>Эмбеддинг-вектор</RL><div>{row.embedding_dim ? row.embedding_dim + ' измерений' : '—'}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--color-divider)' }}>
            <button className="ghost-btn" style={{ flex: 1 }} onClick={() => onReindex(row.filename)}><RotateCcw /> Переиндексировать</button>
            <button className="del-btn" style={{ flex: 1 }} onClick={() => onDelete(row.filename)}><Trash2 /> Удалить</button>
          </div>
        </div>
      </aside>
    </>
  );
}

const activeChip: React.CSSProperties = { background: 'var(--color-accent)', color: 'var(--color-bg)', borderColor: 'var(--color-accent)' };
const toastStyle: React.CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: 'var(--color-text)', color: 'var(--color-bg)', padding: '10px 18px', fontSize: 14, fontWeight: 600, zIndex: 50 };

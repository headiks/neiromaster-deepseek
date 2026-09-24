// Реестр документов: сортируемая таблица метаданных (sha256, папки, привязка к подэтапам),
// карточка документа с переиндексацией и удалением.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react';
import { docStatus } from '@shared/status';
import { ruDateTime } from '@shared/format';
import { api, enc, messageOf } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Badge, Button, Callout, Card, Chip, Empty, Input, PageHeader, Spinner, StatusBadge } from '../../ui';
import { Dialog } from '../../ui/Dialog';
import { useConfirm } from '../../ui/confirm';
import { formatSize } from '../admin/Documents';

type Row = { filename: string; sha256?: string; mime?: string; size_bytes?: number; status?: string; uploaded_at?: string; uploaded_by?: string;
  summary?: string; folders?: string[]; substages?: { substage_id: string; score?: number }[]; stage_ids?: string[] };
type Key = 'filename' | 'mime' | 'size_bytes' | 'status' | 'uploaded_at' | 'folders' | 'stage_ids' | 'substages';
const COLS: { k: Key; t: string }[] = [
  { k: 'filename', t: 'Файл' }, { k: 'mime', t: 'Тип' }, { k: 'size_bytes', t: 'Размер' }, { k: 'status', t: 'Статус' },
  { k: 'uploaded_at', t: 'Загружен' }, { k: 'folders', t: 'Папки' }, { k: 'stage_ids', t: 'Этапы' }, { k: 'substages', t: 'Подэтапы' },
];

export default function DocumentsTable() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [data, setData] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: 'uploaded_at', dir: -1 });
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Row | null>(null);
  useEffect(() => { document.title = 'Реестр документов · НейроМастер'; }, []);
  const load = useCallback(() => { setError(null); api.get<{ documents: Row[] }>('/documents/table').then((d) => setData(d.documents || [])).catch((e) => setError(messageOf(e))); }, []);
  useEffect(load, [load]);
  const counts = useMemo(() => (data || []).reduce<Record<string, number>>((m, r) => { const s = r.status || '—'; m[s] = (m[s] || 0) + 1; return m; }, {}), [data]);
  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const val = (r: Row) => { const v = r[sort.k]; return Array.isArray(v) ? v.length : v ?? null; };
    return (data || []).filter((r) => (!status || r.status === status) && (!needle || `${r.filename} ${r.summary || ''}`.toLowerCase().includes(needle)))
      .sort((a, b) => { const x = val(a), y = val(b); if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
  }, [data, status, q, sort]);
  const reindex = async (r: Row) => {
    try { await api.post(`/documents/${enc(r.filename)}/reindex`); toast.ok('Переиндексация запущена'); setOpen(null); load(); } catch (e) { toast.error(messageOf(e)); }
  };
  const remove = async (r: Row) => {
    if (!(await confirm({ title: 'Удалить документ?', text: `«${r.filename}» — разметка, оригинал и метаданные будут удалены.`, ok: 'Удалить', danger: true }))) return;
    try { await api.del(`/documents/${enc(r.filename)}`); toast.ok('Удалено'); setOpen(null); load(); } catch (e) { toast.error(messageOf(e)); }
  };
  return (
    <div className="nm-page">
      <PageHeader title="Реестр документов" subtitle="Метаданные обработанных файлов и их привязка к подэтапам (разметка ИИ)."
                  actions={<Button variant="ghost" icon={RefreshCw} onClick={load}>Обновить</Button>} />
      <div className="nm-row">
        <div className="nm-search" style={{ minWidth: 240 }}><Search aria-hidden /><Input small aria-label="Поиск" placeholder="Имя файла или описание" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="nm-chips">
          <Chip pressed={!status} onClick={() => setStatus('')}>Все</Chip>
          {Object.entries(counts).map(([s, n]) => <Chip key={s} pressed={status === s} onClick={() => setStatus(s)}>{docStatus(s).label} ({n})</Chip>)}
        </div>
        {data && <span className="nm-small nm-muted">{view.length} из {data.length}</span>}
      </div>
      {error && <Callout tone="danger">Не удалось загрузить: {error}</Callout>}
      {!data && !error ? <Spinner /> : data && !view.length ? <Card pad={false}><Empty>{data.length ? 'Ничего не найдено' : 'В реестре пока нет документов'}</Empty></Card> : data && (
        <Card pad={false}><div className="nm-table-wrap"><table className="nm-edit-table">
          <thead><tr>{COLS.map((c) => (
            <th key={c.k}><button type="button" className="nm-link nm-micro" style={{ color: 'inherit' }} onClick={() => setSort((s) => ({ k: c.k, dir: s.k === c.k ? (s.dir === 1 ? -1 : 1) : 1 }))}>
              {c.t} {sort.k === c.k && (sort.dir > 0 ? <ArrowUp style={{ width: 12, height: 12 }} /> : <ArrowDown style={{ width: 12, height: 12 }} />)}</button></th>
          ))}</tr></thead>
          <tbody>{view.map((r) => (
            <tr key={r.filename} onClick={() => setOpen(r)} style={{ cursor: 'pointer' }}>
              <td><button type="button" className="nm-link" onClick={(e) => { e.stopPropagation(); setOpen(r); }}>{r.filename}</button></td>
              <td>{(r.mime || '—').toUpperCase()}</td><td style={{ whiteSpace: 'nowrap' }}>{formatSize(r.size_bytes) || '—'}</td>
              <td><StatusBadge view={docStatus(r.status)} /></td><td className="nm-muted" style={{ whiteSpace: 'nowrap' }}>{ruDateTime(r.uploaded_at)}</td>
              <td>{(r.folders || []).slice(0, 3).map((f) => <Badge key={f} tone="accent">{f}</Badge>)}{(r.folders || []).length > 3 && ` +${r.folders!.length - 3}`}</td>
              <td>{(r.stage_ids || []).length}</td><td>{(r.substages || []).length}</td>
            </tr>
          ))}</tbody>
        </table></div></Card>
      )}
      <Dialog open={!!open} onClose={() => setOpen(null)} title={open?.filename || ''} subtitle={open ? `${(open.mime || '').toUpperCase()} · ${formatSize(open.size_bytes)}` : undefined}
              footer={open && <><Button icon={RotateCcw} onClick={() => reindex(open)}>Переиндексировать</Button><Button variant="danger" icon={Trash2} onClick={() => remove(open)}>Удалить</Button></>}>
        {open && (
          <dl className="nm-kv">
            <dt>Статус</dt><dd><StatusBadge view={docStatus(open.status)} /></dd>
            <dt>sha256</dt><dd><code className="nm-code" style={{ wordBreak: 'break-all' }}>{open.sha256 || '—'}</code></dd>
            <dt>Загружен</dt><dd>{ruDateTime(open.uploaded_at)}{open.uploaded_by ? ` · ${open.uploaded_by}` : ''}</dd>
            <dt>Описание</dt><dd>{open.summary || '—'}</dd>
            <dt>Папки</dt><dd>{(open.folders || []).join(', ') || '—'}</dd>
            <dt>Этапы</dt><dd>{(open.stage_ids || []).join(', ') || '—'}</dd>
            <dt>Подэтапы</dt><dd className="nm-row" style={{ gap: 4 }}>{(open.substages || []).length ? open.substages!.map((s) => <Badge key={s.substage_id} tone="muted">{s.substage_id} · {Number(s.score || 0).toFixed(2)}</Badge>) : '—'}</dd>
          </dl>
        )}
      </Dialog>
    </div>
  );
}

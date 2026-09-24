// Документы (база знаний): загрузка с проверкой новой версии и флагом «не отправлять в ИИ»,
// покрытие планов документами, доска «этапы ↔ документы», список с прогрессом обработки.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Eye, FileText, FolderOpen, Lock, LockOpen, RefreshCw, Search, Trash2, TriangleAlert, User } from 'lucide-react';
import { docStatus } from '@shared/status';
import { plural, ruDateTime } from '@shared/format';
import { api, ApiError, enc, messageOf, upload } from '../../lib/api';
import { useMe } from '../../lib/me';
import { useToast } from '../../lib/toast';
import type { Board, BoardDoc, Coverage, Doc } from '../../lib/types';
import {
  Badge, Button, Callout, Card, Checkbox, Chip, Empty, Help, Input, PageHeader, Progress, Select, Spinner, StatusBadge,
} from '../../ui';
import { Dropzone } from '../../ui/Dropzone';
import { useConfirm } from '../../ui/confirm';
import { NextStep } from '../../blocks/NextStep';
import { DocLabelsDialog } from '../../blocks/DocLabels';

const ACTIVE = ['uploaded', 'processing', 'reanalyzing'];
const LABEL: Record<string, string> = { pdf: 'PDF', docx: 'DOCX', doc: 'DOC', pptx: 'PPTX', html: 'HTML', htm: 'HTM', md: 'MD', txt: 'TXT', xlsx: 'XLSX', xls: 'XLS', csv: 'CSV' };
const KIND: Record<string, string> = { pdf: 'pdf', pptx: 'ppt', xlsx: 'xls', xls: 'xls', csv: 'xls' };

export function docFormat(d: { filename?: string; mime?: string }) {
  const raw = (d.mime || (d.filename || '').split('.').pop() || '').toLowerCase();
  return { kind: KIND[raw] || 'doc', label: LABEL[raw] || (raw ? raw.toUpperCase().slice(0, 4) : 'ФАЙЛ') };
}

export function formatSize(bytes?: number) {
  if (bytes == null) return '';
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(0)} КБ` : `${(kb / 1024).toFixed(1)} МБ`;
}

function DocProgress({ d }: { d: Doc }) {
  if (d.status === 'indexed' || d.status === 'confidential') return null;
  if (d.status === 'error') return <Progress small value={1} tone="danger" label="Ошибка обработки" />;
  const pct = Number(d.progress);
  const label = d.status === 'uploaded' ? 'В очереди на обработку' : d.phase || docStatus(d.status).label;
  return (
    <div className="nm-stack" style={{ gap: 4 }}>
      <div className="nm-row-between nm-micro nm-muted"><span>{label}</span>{Number.isFinite(pct) && pct > 0 && <span>{pct}%</span>}</div>
      <Progress small value={Number.isFinite(pct) && pct > 0 ? pct / 100 : 0} indeterminate={!(Number.isFinite(pct) && pct > 0)} label={label} />
    </div>
  );
}

function DocRow({ d, canEdit, folderName, onView, onToggle, onDelete }: {
  d: Doc; canEdit: boolean; folderName: (s: string) => string; onView: () => void; onToggle: () => void; onDelete: () => void;
}) {
  const fmt = docFormat(d);
  const meta = [formatSize(d.size_bytes), d.chunks ? `${d.chunks} ${plural(d.chunks, 'блок', 'блока', 'блоков')}` : '', d.uploaded_at ? ruDateTime(d.uploaded_at) : ''].filter(Boolean).join(' · ');
  const view = d.confidential ? docStatus('confidential') : docStatus(d.status);
  return (
    <div className="nm-doc">
      <div className="nm-doc-main">
        <span className="nm-fmt" data-kind={fmt.kind}>{fmt.label}</span>
        <div className="nm-grow">
          <div className="nm-row-between">
            <div className="nm-cell-title" title={d.filename} style={{ whiteSpace: 'nowrap' }}>{d.filename}</div>
            <StatusBadge view={view} />
          </div>
          {d.summary && <div className="nm-small nm-muted" style={{ marginTop: 2 }}>{d.summary.length > 200 ? `${d.summary.slice(0, 200)}…` : d.summary}</div>}
          <div className="nm-micro nm-muted" style={{ marginTop: 4 }}>{meta}</div>
          {(d.folders || []).length > 0 && <div className="nm-row" style={{ gap: 6, marginTop: 6 }}>{d.folders!.map((f) => <Badge key={f} tone="accent">{folderName(f)}</Badge>)}</div>}
          {d.uploaded_by_name && <div className="nm-micro nm-muted" style={{ marginTop: 4 }}><User aria-hidden style={{ width: 12, height: 12, verticalAlign: '-2px' }} /> {d.uploaded_by_name}{d.department ? ` · ${d.department}` : ''}</div>}
          {d.clarification && <div className="nm-micro" style={{ color: 'var(--nm-soft-ink)', marginTop: 4 }}>Уточнение: {d.clarification}</div>}
          {d.status === 'error' && d.error && <div className="nm-micro nm-danger-text" style={{ marginTop: 4 }}>{d.error}</div>}
        </div>
      </div>
      <DocProgress d={d} />
      <div className="nm-row" style={{ gap: 6, justifyContent: 'flex-end' }}>
        {d.status === 'indexed' && <Button size="sm" variant="ghost" icon={Eye} onClick={onView} title="Что ИИ нашёл в документе и к каким этапам отнёс">Посмотреть</Button>}
        {canEdit ? (
          <>
            <Button size="sm" variant="ghost" icon={d.confidential ? LockOpen : Lock} onClick={onToggle}
                    title={d.confidential ? 'Отправить документ на обычную обработку ИИ' : 'Чувствительный документ: хранится, но в ИИ не отправляется'}>
              {d.confidential ? 'Разрешить ИИ' : 'Не отправлять в ИИ'}</Button>
            <Button size="sm" variant="danger" icon={Trash2} onClick={onDelete}>Удалить</Button>
          </>
        ) : <span className="nm-micro nm-muted" title="Документ суперадмина доступен всем администраторам">общий · только чтение</span>}
      </div>
    </div>
  );
}

export function StageBoard({ planId, plans, onPlan, onOpenDoc }: { planId: string; plans: Coverage[]; onPlan: (id: string) => void; onOpenDoc: (f: string) => void }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    api.get<Board>(`/documents/board${planId ? `?plan_id=${enc(planId)}` : ''}`).then(setBoard).catch((e) => setError(messageOf(e)));
  }, [planId]);
  useEffect(() => { setBoard(null); load(); }, [load]);
  const chip = (d: BoardDoc) => (
    <button key={d.filename} type="button" className="nm-doc-chip" onClick={() => onOpenDoc(d.filename)} title="Показать куски текста и критерий попадания">
      <span className="nm-fmt" data-kind={docFormat(d).kind} style={{ width: 22, height: 22, fontSize: 8, borderRadius: 6 }}>{docFormat(d).label}</span>
      <span>{d.filename}</span>{d.score != null && <small className="nm-muted">{Math.round(Number(d.score) * 100)}%</small>}
    </button>
  );
  return (
    <div className="nm-stack">
      <div className="nm-row">
        <Select small value={planId} onChange={(e) => onPlan(e.target.value)} aria-label="План адаптации" style={{ width: 'auto', minWidth: 260 }}>
          <option value="">Все этапы (каталог)</option>
          {plans.map((p) => <option key={p.plan_id} value={p.plan_id}>{p.title || p.plan_id}</option>)}
        </Select>
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={load}>Обновить</Button>
      </div>
      <p className="nm-small nm-muted" style={{ margin: 0 }}>Этапы и подэтапы и закреплённые за ними документы (разметка ИИ). «Нет документа» — по этой теме нужно догрузить документ, иначе сообщение не сгенерируется.</p>
      {error && <Callout tone="danger">{error}</Callout>}
      {!board && !error && <Spinner />}
      {board && (
        <Card pad={false}>
          {(board.stages || []).map((s, i) => {
            const gaps = (s.substages || []).filter((x) => !(x.documents || []).length).length;
            return (
              <div className="nm-board-stage" key={s.id || i}>
                <div className="nm-row-between">
                  <div className="nm-row"><span className="nm-stage-num" style={{ width: 26, height: 26, fontSize: 12 }}>{i + 1}</span><b>{s.title}</b></div>
                  {gaps ? <Badge tone="warn">не хватает: {gaps}</Badge> : <Badge tone="ok">все подэтапы с документами</Badge>}
                </div>
                {(s.substages || []).map((x, j) => (
                  <div className="nm-board-sub" key={x.id || j}>
                    <div>{x.title}</div>
                    <div className="nm-board-docs">{(x.documents || []).length ? x.documents!.map(chip) : <Badge tone="warn">Нет документа</Badge>}</div>
                  </div>
                ))}
                {(s.documents || []).length > 0 && <div className="nm-board-sub"><div className="nm-muted">В этапе (без подэтапа)</div><div className="nm-board-docs">{s.documents!.map(chip)}</div></div>}
              </div>
            );
          })}
          {(board.unassigned || []).length > 0 && (
            <div className="nm-board-stage">
              <b>{planId ? 'Не относятся к этому плану' : 'Без уверенной привязки'}</b>
              <div className="nm-small nm-muted">{planId ? 'Документы по темам, которых нет в выбранном плане' : 'Загружены, но не отнесены к этапу — проверьте вручную'}</div>
              <div className="nm-board-docs">{board.unassigned!.map(chip)}</div>
            </div>
          )}
          {!(board.stages || []).length && !(board.unassigned || []).length && <Empty>Пока нет ни этапов, ни документов.</Empty>}
        </Card>
      )}
    </div>
  );
}

type Filter = 'all' | 'ready' | 'active' | 'error' | 'private';

export default function Documents() {
  const { me, isOwner } = useMe();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [folders, setFolders] = useState<{ slug: string; name: string }[]>([]);
  const [coverage, setCoverage] = useState<Coverage[] | null>(null);
  const [uploads, setUploads] = useState<Record<string, string>>({});
  const [confidential, setConfidential] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [boardPlan, setBoardPlan] = useState('');
  const [labels, setLabels] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const pending = useRef(new Set<string>());
  const boardRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => { document.title = 'Документы · НейроМастер'; }, []);
  const loadCoverage = useCallback(() => api.get<{ plans: Coverage[] }>('/plans/coverage').then((d) => setCoverage(d.plans || [])).catch(() => setCoverage([])), []);
  const loadDocs = useCallback(async () => {
    try {
      const d = await api.get<{ documents: Doc[] }>('/documents');
      const list = d.documents || [];
      setDocs(list);
      // Загруженные в этой сессии: статус из реестра, по завершении — убрать строку.
      let settled = false;
      setUploads((u) => {
        const next = { ...u };
        pending.current.forEach((name) => {
          const doc = list.find((x) => x.filename === name);
          if (!doc) return;
          if (doc.status === 'indexed' || doc.status === 'error') { delete next[name]; pending.current.delete(name); settled = true; }
          else next[name] = doc.status === 'processing' ? 'разбор документа и разметка по этапам…' : 'в очереди на обработку…';
        });
        return next;
      });
      if (settled) loadCoverage();
    } catch { /* повторим на следующем опросе */ }
  }, [loadCoverage]);

  // Опрос: чаще, пока есть незавершённые загрузки, иначе редко.
  const busy = (docs || []).some((d) => ACTIVE.includes(d.status)) || pending.current.size > 0;
  useEffect(() => {
    loadDocs();
    loadCoverage();
    api.get<{ folders: { slug: string; name: string }[] }>('/folders').then((d) => setFolders(d.folders || [])).catch(() => {});
  }, [loadDocs, loadCoverage]);
  useEffect(() => {
    const t = window.setTimeout(loadDocs, busy ? 2000 : 8000);
    return () => window.clearTimeout(t);
  }, [docs, busy, loadDocs]);

  const setLine = (name: string, text: string | null) => setUploads((u) => { const n = { ...u }; if (text === null) delete n[name]; else n[name] = text; return n; });

  const uploadOne = async (file: File, mode?: 'replace' | 'separate'): Promise<void> => {
    setLine(file.name, 'загрузка…');
    try {
      const d = await upload<{ filename?: string; status?: string; message?: string; duplicate?: boolean }>('/documents/upload', file, { mode, confidential });
      if (d.duplicate || d.status === 'confidential') {
        setLine(file.name, d.message || 'готово');
        setTimeout(() => setLine(file.name, null), 6000);
        loadDocs(); loadCoverage();
        return;
      }
      const canonical = d.filename || file.name;
      setLine(file.name, null);
      setLine(canonical, 'в очереди на обработку…');
      pending.current.add(canonical);
      loadDocs();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data?.conflict === 'same_name') {
        const c = e.data;
        const who = c.uploaded_by_name ? `, загрузил ${c.uploaded_by_name}` : '';
        if (c.can_replace && await confirm({ title: 'Такой документ уже есть', ok: 'Заменить старую версию', cancel: 'Другое действие',
          text: `«${c.filename}» загружен ${ruDateTime(c.uploaded_at)}${who}.\n\nЗаменить старую версию новой? Старая удалится, сообщения по ней обновятся.` })) {
          return uploadOne(file, 'replace');
        }
        if (await confirm({ title: 'Сохранить как отдельный документ?', ok: 'Сохранить рядом',
          text: `Новый файл сохранится под похожим именем (например, «${String(c.filename).replace(/(\.[^.]+)$/, ' (2)$1')}»).` })) {
          return uploadOne(file, 'separate');
        }
        setLine(file.name, null);
        return;
      }
      setLine(file.name, messageOf(e));
    }
  };

  const toggleConfidential = async (d: Doc) => {
    const on = !d.confidential;
    const ok = await confirm(on
      ? { title: 'Не отправлять в ИИ?', ok: 'Не отправлять', text: `«${d.filename}» останется в базе, но ИИ не будет его читать: разметка удалится, сообщения и ответы, которые на него опирались, обновятся без него. Подходит для положения об оплате труда и т.п.` }
      : { title: 'Разрешить ИИ обработать документ?', ok: 'Разрешить', text: `«${d.filename}» уйдёт на разметку (персональные данные при этом маскируются).` });
    if (!ok) return;
    try { await api.post(`/documents/${enc(d.filename)}/confidential`, { confidential: on }); loadDocs(); loadCoverage(); }
    catch (e) { toast.error(messageOf(e)); }
  };

  const remove = async (d: Doc) => {
    if (!(await confirm({ title: 'Удалить документ?', text: `«${d.filename}» будет удалён. Сообщения, написанные по нему, обновятся автоматически.`, ok: 'Удалить', danger: true }))) return;
    try { await api.del(`/documents/${enc(d.filename)}`); toast.ok('Документ удалён'); loadDocs(); loadCoverage(); }
    catch (e) { toast.error(messageOf(e)); }
  };

  const showGaps = (planId: string) => {
    setBoardPlan(planId);
    setBoardOpen(true);
    setTimeout(() => boardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const list = useMemo(() => docs || [], [docs]);
  const ready = list.filter((d) => d.status === 'indexed').length;
  const active = list.filter((d) => ['processing', 'reanalyzing'].includes(d.status));
  const queued = list.filter((d) => d.status === 'uploaded');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((d) => (!q || d.filename.toLowerCase().includes(q) || (d.summary || '').toLowerCase().includes(q))
      && (filter === 'all' || (filter === 'ready' && d.status === 'indexed') || (filter === 'active' && ACTIVE.includes(d.status))
        || (filter === 'error' && d.status === 'error') || (filter === 'private' && !!d.confidential)));
  }, [list, query, filter]);
  const groups = useMemo(() => {
    if (!isOwner) return [['', shown] as [string, Doc[]]];
    const m = new Map<string, Doc[]>();
    shown.forEach((d) => { const k = d.uploaded_by_name || 'Без владельца (загружено до разделения прав)'; m.set(k, [...(m.get(k) || []), d]); });
    return [...m.entries()];
  }, [shown, isOwner]);
  const folderName = (slug: string) => folders.find((f) => f.slug === slug)?.name || slug;
  const canEdit = (d: Doc) => isOwner || d.uploaded_by === me?.id;

  return (
    <div className="nm-page">
      <PageHeader title="Документы" subtitle="Регламенты, инструкции, положения — по ним ИИ пишет сообщения плана и отвечает сотрудникам." />
      <NextStep here="/admin/documents" />
      <div className="nm-two-pane">
        <div className="nm-stack">
          <div data-tour="doc-drop">
            <Dropzone multiple accept=".pdf,.docx,.doc,.pptx,.html,.htm,.md,.txt" onFiles={(fs) => fs.forEach((f) => uploadOne(f))}
                      title="Перетащите документы сюда или нажмите, чтобы выбрать"
                      hint="PDF, DOCX, DOC, PPTX, HTML, MD, TXT · до 50 МБ · ИИ сам разнесёт документ по этапам адаптации" />
          </div>
          <div className="nm-row" data-tour="doc-confidential">
            <Checkbox label="Конфиденциальный документ — не отправлять в ИИ" checked={confidential} onChange={setConfidential} />
            <Help text="Для чувствительных документов (положение об оплате труда и т.п.): файл хранится в базе, но ИИ его не читает — ни для сообщений, ни для ответов." />
          </div>
          {Object.keys(uploads).length > 0 && (
            <Card style={{ gap: 4 }} role="status">
              {Object.entries(uploads).map(([name, line]) => <div key={name} className="nm-small"><b>{name}</b>: <span className="nm-muted">{line}</span></div>)}
            </Card>
          )}
        </div>
        <Card data-tour="coverage">
          <div className="nm-card-kicker"><span>Покрытие планов документами</span></div>
          <div className="nm-small">Загружено: <b>{list.length} {plural(list.length, 'документ', 'документа', 'документов')}</b>{ready !== list.length ? ` · готовы к работе: ${ready}` : ''}</div>
          {coverage === null ? <Spinner label="Считаем покрытие…" /> : !coverage.length
            ? <div className="nm-small nm-muted">Планов адаптации пока нет — создайте план в разделе «Планы», и здесь появится, хватает ли ему документов.</div>
            : coverage.map((p) => {
              const pct = p.total ? p.covered / p.total : 0, gaps = p.total - p.covered;
              return (
                <div key={p.plan_id} className="nm-stack" style={{ gap: 6, marginTop: 6 }}>
                  <div className="nm-row-between nm-small"><b>{p.title}</b><span className={gaps ? 'nm-muted' : 'nm-ok-text'}>{p.covered} из {p.total}</span></div>
                  <Progress small value={pct} tone={gaps ? undefined : 'ok'} label={`Покрытие плана ${p.title}`} />
                  {gaps ? <button type="button" className="nm-link nm-small" style={{ textAlign: 'left' }} onClick={() => showGaps(p.plan_id)}>
                    Нет материалов для {gaps} {plural(gaps, 'подэтапа', 'подэтапов', 'подэтапов')} — показать по этапам</button>
                    : <div className="nm-micro nm-ok-text">Документов достаточно для всего плана.</div>}
                </div>
              );
            })}
        </Card>
      </div>

      <details className="nm-details nm-glass" style={{ borderRadius: 'var(--nm-r)' }} open={boardOpen} ref={boardRef}
               onToggle={(e) => setBoardOpen((e.target as HTMLDetailsElement).open)} data-tour="stage-board">
        <summary><ChevronRight aria-hidden />Документы по этапам и подэтапам{boardPlan ? '' : ''}</summary>
        {boardOpen && <div className="nm-details-body"><StageBoard planId={boardPlan} plans={coverage || []} onPlan={setBoardPlan} onOpenDoc={setLabels} /></div>}
      </details>

      <section className="nm-section" data-tour="doc-list">
        <div className="nm-row-between">
          <h2 style={{ fontSize: 22 }}>Все документы</h2>
          {(active.length > 0 || queued.length > 0) && (
            <span className="nm-small nm-warn-text" role="status">
              {active.length > 0 && <>Обрабатывается: {active.map((d) => d.filename).join(', ')}</>}{active.length > 0 && queued.length > 0 && ' · '}{queued.length > 0 && `в очереди: ${queued.length}`}
            </span>
          )}
        </div>
        <div className="nm-row">
          <div className="nm-search nm-grow" style={{ minWidth: 220, maxWidth: 360 }}>
            <Search aria-hidden />
            <Input small aria-label="Поиск документа" placeholder="Поиск по названию и описанию" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="nm-chips" role="group" aria-label="Фильтр">
            {([['all', 'Все'], ['ready', 'Готовы'], ['active', 'В обработке'], ['error', 'Ошибки'], ['private', 'Не в ИИ']] as [Filter, string][]).map(([v, t]) => (
              <Chip key={v} pressed={filter === v} onClick={() => setFilter(v)}>{t}</Chip>
            ))}
          </div>
        </div>
        {docs === null ? <Spinner /> : !list.length ? (
          <Card pad={false}><Empty icon={FileText}>{isOwner ? 'Пока никто из администраторов не загрузил документы.' : 'Пока нет ваших документов — добавьте первый регламент выше.'}</Empty></Card>
        ) : !shown.length ? <Card pad={false}><Empty icon={Search}>Ничего не найдено.</Empty></Card> : (
          <Card pad={false}>
            {groups.map(([owner, items]) => (
              <div key={owner || 'all'}>
                {owner && <div className="nm-owner-head"><FolderOpen aria-hidden style={{ width: 16, height: 16 }} /><b>{owner}</b>
                  {items.find((d) => d.department)?.department ? ` · ${items.find((d) => d.department)!.department}` : ''}<span className="nm-grow" />{items.length} док.</div>}
                {items.map((d) => (
                  <DocRow key={d.filename} d={d} canEdit={canEdit(d)} folderName={folderName}
                          onView={() => setLabels(d.filename)} onToggle={() => toggleConfidential(d)} onDelete={() => remove(d)} />
                ))}
              </div>
            ))}
          </Card>
        )}
        {list.some((d) => d.status === 'error') && filter !== 'error' && (
          <Callout tone="danger" icon={TriangleAlert} action={<Button size="sm" onClick={() => setFilter('error')}>Показать</Button>}>Есть документы с ошибкой обработки.</Callout>
        )}
      </section>
      <DocLabelsDialog filename={labels} onClose={() => setLabels(null)} />
    </div>
  );
}

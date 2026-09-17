import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FileText, Folder, HardDrive, Info, Layers, RefreshCw, RotateCcw,
  ScanText, Table, TriangleAlert, Upload, UploadCloud, User,
} from 'lucide-react';
import { api, apiJson } from '../../lib/api';
import { pollJob } from '../../lib/jobs';
import type { DocItem, Folder as FolderT } from '../../lib/types';
import Dropzone from '../../components/Dropzone';

const BEXT: Record<string, string> = { pdf: 'pdf', docx: 'docx', doc: 'docx', pptx: 'ppt', html: 'web', htm: 'web', md: 'md', txt: 'txt' };
const BLABEL: Record<string, string> = { pdf: 'PDF', docx: 'DOCX', doc: 'DOC', pptx: 'PPTX', html: 'HTML', htm: 'HTM', md: 'MD', txt: 'TXT' };

function docFormat(doc: DocItem) {
  const raw = (doc.mime || (doc.filename || '').split('.').pop() || '').toLowerCase();
  return { cls: BEXT[raw] || 'gen', label: BLABEL[raw] || (raw ? raw.toUpperCase().slice(0, 4) : 'ФАЙЛ') };
}
function statusLabel(s: string): string {
  return { uploaded: 'Загружен', processing: 'Обрабатывается (docling)...', indexed: 'Готов к поиску', reanalyzing: 'Переанализ…', error: 'Ошибка' }[s] || s;
}
function formatSize(bytes?: number): string {
  if (bytes == null) return '';
  const kb = bytes / 1024;
  return kb < 1024 ? `${kb.toFixed(0)} КБ` : `${(kb / 1024).toFixed(1)} МБ`;
}
const smapClass = (s: number) => (s >= 0.6 ? 'hi' : s >= 0.5 ? 'mid' : 'lo');

export default function Knowledge({ isOwner }: { isOwner: boolean }) {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [folders, setFolders] = useState<FolderT[]>([]);
  const [board, setBoard] = useState<any>(null);
  const [uploadStatus, setUploadStatus] = useState<Record<string, string>>({});
  const [clarify, setClarify] = useState<Record<string, string>>({});
  const [smap, setSmap] = useState<{ filename: string; data: any } | null>(null);
  const [overall, setOverall] = useState<{ label: string; pct: number } | null>(null);
  const [reanalyzeBusy, setReanalyzeBusy] = useState(false);

  const pendingRef = useRef<Set<string>>(new Set());
  const docsRef = useRef<DocItem[]>([]);
  const reanalyzeJobActive = useRef(false);
  const anyActive = useRef(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const folderName = useCallback((slug: string) => folders.find((f) => f.slug === slug)?.name || slug, [folders]);

  const loadFolders = () => api('/folders').then((r) => r.json()).then((d) => setFolders(d.folders || [])).catch(() => {});
  const loadBoard = () => api('/documents/board').then((r) => (r.ok ? r.json() : null)).then(setBoard).catch(() => {});

  const reconcile = (list: DocItem[]) => {
    const pend = pendingRef.current;
    if (!pend.size) return;
    const byName: Record<string, DocItem> = {};
    list.forEach((d) => { byName[d.filename] = d; });
    let settled = false;
    setUploadStatus((prev) => {
      const next = { ...prev };
      pend.forEach((name) => {
        const doc = byName[name];
        if (!doc) return;
        if (doc.status === 'indexed' || doc.status === 'error') { delete next[name]; pend.delete(name); settled = true; }
        else if (doc.status === 'processing') next[name] = 'разбор docling → классификация по блокам (docpipe)...';
        else next[name] = 'в очереди на обработку...';
      });
      return next;
    });
    if (settled) loadFolders();
  };

  const loadDocuments = useCallback(() => api('/documents').then((r) => r.json()).then((d) => {
    const list: DocItem[] = d.documents || [];
    docsRef.current = list;
    anyActive.current = list.some((doc) => ['reanalyzing', 'processing', 'uploaded'].includes(doc.status));
    setDocs(list);
    reconcile(list);
  }).catch(() => {}), []);

  const scheduleDocPoll = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = setTimeout(() => {
      loadDocuments().finally(scheduleDocPoll);
    }, pendingRef.current.size || anyActive.current ? 2000 : 8000);
  }, [loadDocuments]);

  useEffect(() => {
    loadDocuments();
    loadFolders();
    loadBoard();
    scheduleDocPoll();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [loadDocuments, scheduleDocPoll]);

  const uploadFiles = (files: FileList) => {
    Array.from(files).forEach((file) => {
      setUploadStatus((s) => ({ ...s, [file.name]: 'загрузка...' }));
      const fd = new FormData();
      fd.append('file', file);
      apiJson('/documents/upload', { method: 'POST', body: fd }).then(({ ok, data }) => {
        if (!ok) { setUploadStatus((s) => ({ ...s, [file.name]: data.detail || 'ошибка загрузки' })); return; }
        const canonical = data.filename || file.name;
        setUploadStatus((s) => { const n = { ...s }; delete n[file.name]; n[canonical] = 'в очереди на обработку...'; return n; });
        pendingRef.current.add(canonical);
        scheduleDocPoll();
      }).catch((err) => setUploadStatus((s) => ({ ...s, [file.name]: err.message })));
    });
  };

  const reanalyzeDoc = (fn: string) => api(`/documents/${encodeURIComponent(fn)}/reanalyze`, { method: 'POST' }).then(() => { anyActive.current = true; loadDocuments(); scheduleDocPoll(); });
  const reprocessDoc = (fn: string) => api(`/documents/${encodeURIComponent(fn)}/reprocess`, { method: 'POST' }).then(() => { pendingRef.current.add(fn); loadDocuments(); scheduleDocPoll(); }).catch((e) => alert('Не удалось переиндексировать: ' + e.message));
  const doClarify = (fn: string) => {
    const val = (clarify[fn] || '').trim();
    if (!val) return;
    api(`/documents/${encodeURIComponent(fn)}/clarify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clarification: val }) }).then(() => loadDocuments());
  };
  const deleteDoc = (fn: string) => {
    if (!confirm(`Удалить документ "${fn}" и все его данные из индекса?`)) return;
    api(`/documents/${encodeURIComponent(fn)}`, { method: 'DELETE' }).then(() => { loadDocuments(); loadFolders(); }).catch((e) => alert(`Ошибка удаления: ${e.message}`));
  };

  const reanalyzeAll = () => {
    if (!confirm('Запустить повторный анализ всей базы под текущую структуру папок?')) return;
    setReanalyzeBusy(true);
    apiJson('/documents/reanalyze', { method: 'POST' }).then(({ ok, data }) => {
      if (!ok || !data.job_id) { setReanalyzeBusy(false); return; }
      reanalyzeJobActive.current = true;
      anyActive.current = true; loadDocuments(); scheduleDocPoll();
      pollJob(`/documents/jobs/${encodeURIComponent(data.job_id)}`, {
        onProgress: (job: any) => {
          const cur = docsRef.current.find((d) => d.filename === job.current && d.status === 'reanalyzing');
          const frac = cur ? (Number(cur.progress) || 0) / 100 : 0;
          const pct = job.total ? Math.min(100, Math.round((100 * (job.done + frac)) / job.total)) : 0;
          setOverall({ label: `Переклассификация: документ ${Math.min(job.done + 1, job.total)} из ${job.total}${job.current ? ' · ' + job.current : ''}`, pct });
        },
        onDone: (job: any) => {
          reanalyzeJobActive.current = false;
          setReanalyzeBusy(false);
          setOverall({ label: job.status === 'done' ? 'Переклассификация завершена' : `Ошибка: ${job.error || ''}`, pct: 100 });
          loadDocuments(); loadFolders();
          setTimeout(() => setOverall(null), 4000);
        },
      });
    }).catch(() => setReanalyzeBusy(false));
  };

  const openSubstageMap = (filename: string) => {
    if (!filename) return;
    setSmap({ filename, data: 'loading' });
    api(`/documents/${encodeURIComponent(filename)}/labels`)
      .then((r) => (r.status === 404 ? null : r.ok ? r.json() : Promise.reject(new Error('labels'))))
      .then((d) => setSmap({ filename, data: d || 'none' }))
      .catch(() => setSmap({ filename, data: 'error' }));
  };

  const active = docs.filter((d) => d.status === 'processing' || d.status === 'reanalyzing');
  const queued = docs.filter((d) => d.status === 'uploaded');
  const uploads = docs.filter((d) => d.status === 'uploaded' || d.status === 'processing');
  const uploadRows = Object.entries(uploadStatus);

  // общий бар только для загрузок (во время полной переклассификации его ведёт задача)
  let uploadOverall: { label: string; pct: number } | null = null;
  if (!reanalyzeJobActive.current && uploads.length) {
    const done = docs.filter((d) => d.status === 'indexed' || d.status === 'error').length;
    const total = uploads.length + done;
    const doneUnits = done + docs.filter((d) => d.status === 'processing').reduce((a, d) => a + (Number(d.progress) || 0) / 100, 0);
    uploadOverall = { label: `Обработка загрузок: в очереди/идёт ${uploads.length}`, pct: Math.max(0, Math.min(100, Math.round((doneUnits / (total || 1)) * 100))) };
  }
  const shownOverall = overall || uploadOverall;

  return (
    <div className="tab-pane active">
      <h2 className="section-title"><UploadCloud /> Загрузка регламентов</h2>
      <Dropzone onFiles={uploadFiles} multiple accept=".pdf,.docx,.doc,.pptx,.html,.htm,.md,.txt">
        <div><Upload style={{ width: 28, height: 28, display: 'block', margin: '0 auto 8px', color: 'var(--color-accent)' }} /> Перетащите PDF или DOCX сюда, или нажмите, чтобы выбрать файл</div>
        <small>PDF, DOCX, DOC, PPTX, HTML, MD, TXT · до 50 МБ · папку по содержанию выберет ассистент</small>
      </Dropzone>
      <div className="upload-progress">
        {uploadRows.map(([name, line]) => <div key={name}>{name}: {line}</div>)}
      </div>

      <div className="section-head-row">
        <h2 className="section-title"><Layers /> Этапы и подэтапы</h2>
        <button className="ghost-btn" onClick={loadBoard}><RefreshCw /> Обновить</button>
      </div>
      <div className="stage-hint">Этапы и подэтапы адаптации и закреплённые за ними документы. Привязка — по классификации DeepSeek (docpipe).</div>
      <div className="stage-board">
        {!board ? <div className="empty-hint">Загрузка структуры...</div> : <StageBoard board={board} onDoc={openSubstageMap} />}
      </div>

      <div className="section-head-row" style={{ marginTop: 34 }}>
        <h2 className="section-title"><FileText /> Документы</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="ghost-btn" href="/documents-table"><Table /> Реестр (таблица)</a>
          <a className="ghost-btn" href="/doc-breakdown"><ScanText /> Разбор (блоки и метки)</a>
          <a className="ghost-btn" href="/s3"><HardDrive /> S3-хранилище</a>
          {isOwner && <button className="ghost-btn" disabled={reanalyzeBusy} onClick={reanalyzeAll}><RefreshCw /> Переклассифицировать всё</button>}
        </div>
      </div>
      <div className="stage-hint">DeepSeek классифицирует документы по этапам и подэтапам при загрузке.</div>

      {(active.length > 0 || queued.length > 0) && (
        <div style={{ margin: '6px 0 2px', fontSize: 13, fontWeight: 600 }}>
          {active.length > 0 && <span style={{ color: '#78350f' }}>⏳ Обрабатывается: {active.map((d) => d.filename).join(', ')}</span>}
          {queued.length > 0 && <span style={{ color: '#475569' }}> · в очереди: {queued.length}</span>}
        </div>
      )}
      {shownOverall && (
        <div className="doc-overall">
          <div className="doc-overall-head"><span>{shownOverall.label}</span><span>{shownOverall.pct}%</span></div>
          <div className="pbar"><div className="pbar-fill" style={{ width: `${shownOverall.pct}%` }} /></div>
        </div>
      )}

      <div className="doc-list">
        {!docs.length ? (
          <div className="empty-hint">Пока нет документов — добавьте первый регламент выше.</div>
        ) : (
          docs.map((doc) => (
            <DocCard key={doc.filename} doc={doc} folderName={folderName} clarify={clarify[doc.filename] || ''}
              onClarifyChange={(v) => setClarify((c) => ({ ...c, [doc.filename]: v }))}
              onClarify={() => doClarify(doc.filename)} onReanalyze={() => reanalyzeDoc(doc.filename)}
              onReprocess={() => reprocessDoc(doc.filename)} onDelete={() => deleteDoc(doc.filename)} />
          ))
        )}
      </div>

      {smap && <SubstageMapDialog filename={smap.filename} data={smap.data} onClose={() => setSmap(null)} />}
    </div>
  );
}

function StageBoard({ board, onDoc }: { board: any; onDoc: (fn: string) => void }) {
  const DocCardMini = (d: any) => {
    const fmt = docFormat(d);
    return (
      <div className="bdoc" key={d.filename} onClick={() => onDoc(d.filename)} title="Показать куски текста и критерий попадания">
        <div className={`ext ${fmt.cls}`}>{fmt.label}</div>
        <div><div className="nm">{d.filename || ''}</div>{d.score != null && <div className="sc">уверенность {Number(d.score).toFixed(2)}</div>}</div>
      </div>
    );
  };
  const countDocs = (s: any) => (s.documents || []).length + (s.substages || []).reduce((n: number, x: any) => n + (x.documents || []).length, 0);
  const stages = board.stages || [];
  if (!stages.length && !(board.unassigned || []).length) return <div className="empty-hint">Пока нет ни этапов, ни документов.</div>;
  return (
    <>
      {stages.map((s: any, i: number) => (
        <section className="stg" key={i}>
          <header className="stg-head">
            <div className="stg-n">{i + 1}</div>
            <div><div className="stg-tt">{s.title || ''}</div><div className="stg-dd">{s.description || ''}</div></div>
            <span className="stg-count">{countDocs(s)} док.</span>
          </header>
          {(s.substages || []).map((sub: any, j: number) => (
            <div className="sub-r" key={j}>
              <div><div className="sub-t">{sub.title || ''}</div><div className="sub-c">{(sub.documents || []).length} док.</div></div>
              <div className="sub-docs">{(sub.documents || []).length ? sub.documents.map(DocCardMini) : <div className="bempty">— нет документов —</div>}</div>
            </div>
          ))}
          {(s.documents || []).length > 0 && (
            <div className="sub-r"><div><div className="sub-t">В этапе (без подэтапа)</div></div><div className="sub-docs">{s.documents.map(DocCardMini)}</div></div>
          )}
          {!(s.substages || []).length && <div className="sub-r"><div className="bempty">нет подэтапов</div></div>}
        </section>
      ))}
      {(board.unassigned || []).length > 0 && (
        <section className="stg unassigned">
          <header className="stg-head">
            <div className="stg-n">?</div>
            <div><div className="stg-tt">Без уверенной привязки</div><div className="stg-dd">Загружены, но не отнесены к этапу — проверьте вручную</div></div>
            <span className="stg-count">{board.unassigned.length} док.</span>
          </header>
          <div className="sub-r"><div><div className="sub-t">Требует решения</div></div><div className="sub-docs">{board.unassigned.map(DocCardMini)}</div></div>
        </section>
      )}
    </>
  );
}

function DocProgress({ doc }: { doc: DocItem }) {
  const s = doc.status;
  if (s === 'indexed') return null;
  if (s === 'error') return <div className="doc-prog"><div className="pbar"><div className="pbar-fill error" style={{ width: '100%' }} /></div></div>;
  if (s === 'uploaded') return <div className="doc-prog"><div className="doc-prog-line"><span>В очереди на обработку</span></div><div className="pbar"><div className="pbar-fill indet" /></div></div>;
  const pct = Number(doc.progress);
  const phase = doc.phase || statusLabel(s);
  return (
    <div className="doc-prog">
      <div className="doc-prog-line"><span>{phase}</span>{Number.isFinite(pct) && pct > 0 && <span>{pct}%</span>}</div>
      <div className="pbar">{Number.isFinite(pct) && pct > 0 ? <div className="pbar-fill" style={{ width: `${Math.min(100, pct)}%` }} /> : <div className="pbar-fill indet" />}</div>
    </div>
  );
}

function DocCard({ doc, folderName, clarify, onClarifyChange, onClarify, onReanalyze, onReprocess, onDelete }: {
  doc: DocItem; folderName: (s: string) => string; clarify: string;
  onClarifyChange: (v: string) => void; onClarify: () => void; onReanalyze: () => void; onReprocess: () => void; onDelete: () => void;
}) {
  const fmt = docFormat(doc);
  const meta = [doc.size_bytes !== undefined ? formatSize(doc.size_bytes) : null, doc.chunks ? `${doc.chunks} блоков` : null, doc.uploaded_at ? doc.uploaded_at.replace('T', ' ') : null].filter(Boolean).join(' · ');
  const folderSlugs = doc.folders || [];
  const similar = doc.similar || [];
  return (
    <div className="doc-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div className="doc-info">
          <div className="doc-name" title={doc.filename}><span className={`fmt-tag ${fmt.cls}`}>{fmt.label}</span> {doc.filename}</div>
          {folderSlugs.length ? (
            <div className="chips">{folderSlugs.map((s) => <span className="folder-tag" key={s}><Folder /> {folderName(s)}</span>)}</div>
          ) : doc.status === 'indexed' ? (
            <div className="doc-meta">Общая база «Все документы» (без папки)</div>
          ) : null}
          {doc.summary && <div className="doc-meta" style={{ color: '#475569', marginTop: 4 }}>{doc.summary.slice(0, 200)}{doc.summary.length > 200 ? '…' : ''}</div>}
          <div className="doc-meta">{meta}</div>
          {doc.uploaded_by_name && <div className="doc-meta"><User /> Загрузил: {doc.uploaded_by_name}{doc.department ? ' · ' + doc.department : ''}{doc.storage_path ? <> · <code>{doc.storage_path}</code></> : ''}</div>}
          {doc.clarification && <div className="doc-meta" style={{ color: '#0369a1', marginTop: 4 }}><Info /> Уточнение: {doc.clarification}</div>}
          {doc.status === 'error' && doc.error && <div className="doc-meta" style={{ color: '#dc2626' }}>{doc.error}</div>}
        </div>
        <div className="doc-status">
          <span className={`status-badge ${doc.status}`}>{statusLabel(doc.status)}</span>
          {doc.chunks ? <button className="icon-btn" title="Переклассифицировать" onClick={onReanalyze}><RefreshCw /></button> : null}
          {(doc.status === 'error' || doc.status === 'uploaded') && <button className="icon-btn" title="Переиндексировать заново" onClick={onReprocess}><RotateCcw /></button>}
          <button className="del-btn" onClick={onDelete}>Удалить</button>
        </div>
      </div>
      <DocProgress doc={doc} />
      {similar.length > 0 && (
        <>
          <div className="warn" style={{ marginTop: 8 }}><TriangleAlert /> Похоже на: {similar.map((s) => s.filename).join(', ')} — возможен дубль/обновление. Удалите устаревший документ или дайте уточнение.</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input type="text" placeholder="Уточнение для ассистента (напр.: старый документ неактуален)" style={{ flex: 1 }} value={clarify} onChange={(e) => onClarifyChange(e.target.value)} />
            <button className="ghost-btn" onClick={onClarify}><Info /> Сохранить</button>
          </div>
        </>
      )}
    </div>
  );
}

function SubstageMapDialog({ filename, data, onClose }: { filename: string; data: any; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const secs = data && typeof data === 'object' ? data.sections || [] : [];
  return (
    <dialog ref={ref} onClose={onClose} style={{ maxWidth: 920, width: '94vw' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h3 style={{ margin: 0 }}>Куски документа: {filename}</h3>
        <button className="ghost-btn" onClick={onClose}>Закрыть</button>
      </div>
      <div style={{ marginTop: 12, maxHeight: '74vh', overflow: 'auto' }}>
        {data === 'loading' && <div className="empty-hint">Загрузка…</div>}
        {data === 'error' && <div className="empty-hint">Ошибка загрузки.</div>}
        {data === 'none' && <div className="empty-hint">Документ ещё не размечен LLM — разметка идёт в фоне после загрузки. Обновите через минуту.</div>}
        {typeof data === 'object' && (
          <>
            <div className="plan-note" style={{ marginBottom: 10 }}><ScanText /> Точная разметка (LLM, temp=0). Подробнее — на странице <a href="/doc-breakdown">Разбор документа</a>.</div>
            {!secs.length ? <div className="empty-hint">Документ размечен, но блоков нет.</div> : secs.map((s: any, i: number) => {
              const head = `Кусок ${i + 1}${s.heading_path?.length ? ' · ' + s.heading_path.join(' / ') : ''}${s.page != null ? ' · стр. ' + s.page : ''}`;
              if (s.is_meaningful === false) {
                return <div className="smap-chunk smap-junk" key={i}><div className="smap-sec">{head} · служебный текст (в подэтапы не идёт)</div><div className="txt">{(s.text || '').slice(0, 400)}</div></div>;
              }
              return (
                <div className="smap-chunk" key={i}>
                  <div className="smap-sec">{head}</div>
                  <div className="txt">{(s.text || '').slice(0, 600)}</div>
                  {s.is_general ? (
                    <div className="smap-subs"><span className="smap-chip hi">общий для всех</span></div>
                  ) : (s.substages || []).length ? (
                    <div className="smap-subs">{s.substages.map((su: any, k: number) => (
                      <span className={`smap-chip ${smapClass(su.confidence)}`} title={su.description || ''} key={k}>
                        {(s.stages?.[0]?.title) || ''} → {su.title || su.id} <small>{su.confidence != null ? Math.round(su.confidence * 100) + '%' : ''}</small>
                      </span>
                    ))}</div>
                  ) : (
                    <div className="smap-none">— ни одному подэтапу не соответствует —</div>
                  )}
                  {!s.is_general && (s.professions || []).length > 0 && <div className="smap-sec">Профессии: {s.professions.join(', ')}</div>}
                  {s.why && <div className="smap-sec" style={{ color: '#1e40af' }}>Почему: {s.why}</div>}
                </div>
              );
            })}
          </>
        )}
      </div>
    </dialog>
  );
}

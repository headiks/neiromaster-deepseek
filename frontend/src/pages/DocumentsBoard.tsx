import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import Header from '../components/Header';

const EXT: Record<string, string> = { pdf: 'pdf', docx: 'docx', doc: 'docx', xls: 'xls', xlsx: 'xls', ppt: 'ppt', pptx: 'ppt' };
const LABEL: Record<string, string> = { pdf: 'PDF', docx: 'DOCX', doc: 'DOCX', xls: 'XLSX', xlsx: 'XLSX', ppt: 'PPTX', pptx: 'PPTX' };
const extOf = (m?: string) => EXT[(m || '').toLowerCase()] || 'gen';
const labelOf = (m?: string) => LABEL[(m || '').toLowerCase()] || ((m ? m.toUpperCase().slice(0, 4) : 'ФАЙЛ'));

function DocCard(d: any) {
  const kw = (d.keywords || []).slice(0, 3);
  return (
    <div className="doc" key={d.filename}>
      <div className={`ext ${extOf(d.mime)}`}>{labelOf(d.mime)}</div>
      <div>
        <div className="nm">{d.filename}</div>
        {kw.length > 0 && <div className="kw">{kw.map((k: string) => <span key={k}>{k}</span>)}</div>}
        {d.score != null && <div className="score">уверенность {Number(d.score).toFixed(2)}</div>}
      </div>
    </div>
  );
}
const countDocs = (s: any) => (s.documents || []).length + (s.substages || []).reduce((n: number, x: any) => n + (x.documents || []).length, 0);

export default function DocumentsBoard() {
  const [board, setBoard] = useState<any>(null);
  const [error, setError] = useState('');
  const load = () => {
    setBoard(null); setError('');
    api('/documents/board').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(setBoard).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const st = board?.stats || {};
  return (
    <div className="admin-page">
      <Header title="Этапы и документы" actions={<button className="ghost-btn" onClick={load}><RefreshCw /> Обновить</button>} />
      <p className="stage-hint">Какие документы закреплены за каждым этапом и подэтапом адаптации.</p>
      {board && (
        <div className="board-stats" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '18px 0 22px' }}>
          {[['этапов', st.stages], ['подэтапов', st.substages], ['документов', st.documents], ['без привязки', st.unassigned]].map(([l, v]) => (
            <div className="card" style={{ padding: '8px 13px', minWidth: 78 }} key={l as string}>
              <b style={{ fontSize: '1.15rem', display: 'block' }}>{(v as number) || 0}</b>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{l as string}</span>
            </div>
          ))}
        </div>
      )}
      <div className="stage-board">
        {error ? <div className="empty-hint">Не удалось загрузить данные: {error}</div>
          : !board ? <div className="empty-hint">Загрузка…</div>
          : (
            <>
              {(board.stages || []).map((s: any, i: number) => (
                <section className="stg" key={i}>
                  <header className="stg-head">
                    <div className="stg-n">{i + 1}</div>
                    <div><div className="stg-tt">{s.title}</div><div className="stg-dd">{s.description || ''}</div></div>
                    <span className="stg-count">{countDocs(s)} док.</span>
                  </header>
                  {(s.substages || []).map((sub: any, j: number) => (
                    <div className="sub-r" key={j}>
                      <div><div className="sub-t">{sub.title}</div><div className="sub-c">{(sub.documents || []).length} док.</div></div>
                      <div className="sub-docs">{(sub.documents || []).length ? sub.documents.map(DocCard) : <div className="bempty">— нет документов —</div>}</div>
                    </div>
                  ))}
                  {(s.documents || []).length > 0 && (
                    <div className="sub-r"><div><div className="sub-t">В этапе (без подэтапа)</div></div><div className="sub-docs">{s.documents.map(DocCard)}</div></div>
                  )}
                </section>
              ))}
              {(board.unassigned || []).length > 0 && (
                <section className="stg unassigned">
                  <header className="stg-head">
                    <div className="stg-n">?</div>
                    <div><div className="stg-tt">Без уверенной привязки</div><div className="stg-dd">Загружены, но не отнесены к этапу — нужна проверка человека</div></div>
                    <span className="stg-count">{board.unassigned.length} док.</span>
                  </header>
                  <div className="sub-r"><div><div className="sub-t">Требует решения</div></div><div className="sub-docs">{board.unassigned.map(DocCard)}</div></div>
                </section>
              )}
            </>
          )}
      </div>
    </div>
  );
}

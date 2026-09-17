import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, apiJson } from '../lib/api';
import Header from '../components/Header';

export default function DocBreakdown() {
  const [docs, setDocs] = useState<string[]>([]);
  const [pick, setPick] = useState('');
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api('/documents/labeled').then((r) => r.json()).then((d) => setDocs((d.documents || []).filter(Boolean))).catch(() => {});
  }, []);

  const load = () => {
    if (!pick) { setData(null); setMsg(''); return; }
    setData(null); setMsg('Загрузка разбора…');
    apiJson(`/documents/${encodeURIComponent(pick)}/labels`).then(({ ok, data: d }) => {
      if (!ok) { setMsg(d.detail || 'Документ не размечен. Загрузите его заново — разметка идёт в фоне.'); return; }
      setMsg(''); setData(d);
    });
  };
  useEffect(load, [pick]);

  const c = data?.doc_card || {};
  const secs = data?.sections || [];

  return (
    <div className="app-page">
      <Header title="Разбор документа" actions={<button className="ghost-btn" onClick={load}><RefreshCw /> Обновить</button>} />
      <div className="card">
        <label className="muted" style={{ color: 'var(--muted)' }}>Документ (размеченные docpipe)</label>
        <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
          <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ minWidth: 280 }}>
            <option value="">— выберите документ —</option>
            {docs.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div className="stage-hint" style={{ marginTop: 8 }}>Блок = раздел документа по заголовкам. Чанк наследует метки блока.</div>
      </div>

      {msg && <div className="card empty-hint">{msg}</div>}
      {data && (
        <>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>📄 {data.filename}</h3>
            <div className="lbl" style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)' }}>Описание документа</div>
            <div>{c.summary || '—'}</div>
            <div style={{ marginTop: 8 }}>
              <span className="badge">тип: {c.doc_type || '—'}</span>{' '}
              <span className="badge">охват: {c.scope || '—'}</span>{' '}
              <span className="badge">аудитория: {(c.audience || []).join(', ') || '—'}</span>
            </div>
          </div>
          <div className="muted" style={{ margin: '6px 4px', color: 'var(--muted)' }}>Блоков: {secs.length}</div>
          {secs.map((s: any, i: number) => {
            const junk = s.is_meaningful === false;
            return (
              <div className={`card${junk ? '' : ''}`} style={{ borderLeft: `4px solid ${junk ? 'var(--color-neutral-400)' : 'var(--color-accent)'}`, opacity: junk ? 0.7 : 1 }} key={i}>
                <h3 style={{ marginTop: 0 }}>Блок {i + 1}{s.heading_path?.length ? ': ' + s.heading_path.join(' / ') : ''} {s.page ? <span className="muted" style={{ color: 'var(--muted)' }}>стр. {s.page}</span> : null}</h3>
                <div style={{ fontSize: 13, color: '#475569', margin: '4px 0' }}><b>ID блока:</b> {s.section_id || ''} · <b>источник метки:</b> {s.source || '—'} · <b>содержательный:</b> {junk ? 'нет' : 'да'}</div>
                {junk ? (
                  <div className="muted" style={{ color: 'var(--muted)' }}>Служебный фрагмент (не размечается): {s.reject_reason || ''}</div>
                ) : (
                  <>
                    {s.why && <div className="note" style={{ margin: '8px 0' }}><b>Почему так размечено:</b> {s.why}</div>}
                    <div className="lbl" style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)', marginTop: 10 }}>Этапы</div>
                    {(s.stages || []).length ? s.stages.map((st: any, k: number) => (
                      <div key={k}><span className="badge general">{st.title || st.id}</span><div style={{ fontSize: 13, color: '#475569', margin: '2px 0 8px 4px' }}>{st.description || ''}</div></div>
                    )) : <span className="muted" style={{ color: 'var(--muted)' }}>—</span>}
                    <div className="lbl" style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)', marginTop: 10 }}>Подэтапы</div>
                    {(s.substages || []).length ? s.substages.map((su: any, k: number) => (
                      <div key={k}><span className="badge rag">{su.title || su.id}</span> <span className="muted" style={{ color: 'var(--muted)' }}>уверенность {su.confidence != null ? Math.round(su.confidence * 100) + '%' : '—'} · id {su.id || ''}</span><div style={{ fontSize: 13, color: '#475569', margin: '2px 0 8px 4px' }}>{su.description || ''}</div></div>
                    )) : <span className="muted" style={{ color: 'var(--muted)' }}>—</span>}
                    <div className="lbl" style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)', marginTop: 10 }}>Профессии</div>
                    {s.is_general ? <span className="badge">общий для всех</span>
                      : (s.professions || []).length ? <>{s.professions.map((p: string) => <span className="badge scenario" key={p}>{p}</span>)}{s.prof_conf != null && <span className="muted" style={{ color: 'var(--muted)' }}> уверенность {Math.round(s.prof_conf * 100)}%</span>}</>
                      : <span className="muted" style={{ color: 'var(--muted)' }}>—</span>}
                  </>
                )}
                <div className="lbl" style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--muted)', marginTop: 10 }}>Текст блока</div>
                <div className="msg-text" style={{ whiteSpace: 'pre-wrap', background: 'var(--color-surface)', border: '1px solid var(--color-divider)', padding: 10, marginTop: 8 }}>{s.text || ''}</div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// Что ИИ нашёл в документе: куски текста и подэтапы, к которым они отнесены (разметка docpipe).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ScanText } from 'lucide-react';
import { api, enc, messageOf } from '../lib/api';
import { Dialog } from '../ui/Dialog';
import { Badge, Callout, Spinner } from '../ui';

type Section = {
  text?: string; heading_path?: string[]; page?: number | null; is_meaningful?: boolean; is_general?: boolean;
  stages?: { title?: string }[]; substages?: { id?: string; title?: string; confidence?: number; description?: string }[];
  professions?: string[]; why?: string;
};

const tone = (c?: number) => (c == null ? 'muted' : c >= 0.6 ? 'ok' : c >= 0.5 ? 'warn' : 'muted');

export function DocLabelsDialog({ filename, onClose }: { filename: string | null; onClose: () => void }) {
  const [sections, setSections] = useState<Section[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setSections(null); setError(null);
    if (!filename) return;
    api.get<{ sections?: Section[] }>(`/documents/${enc(filename)}/labels`)
      .then((d) => setSections(d.sections || []))
      .catch((e) => setError(e?.status === 404
        ? 'Документ ещё не размечен — разметка идёт в фоне после загрузки. Обновите через минуту.' : messageOf(e)));
  }, [filename]);
  return (
    <Dialog open={!!filename} onClose={onClose} wide title="Что ИИ нашёл в документе" subtitle={filename || undefined}>
      <Callout icon={ScanText}>Каждый кусок текста показан с подэтапами, к которым он отнесён, и уверенностью модели.
        Подробнее — на странице <Link to={`/doc-breakdown?filename=${enc(filename || '')}`} onClick={onClose}>«Разбор документа»</Link>.</Callout>
      {error && <Callout tone="warn">{error}</Callout>}
      {!sections && !error && <Spinner />}
      {sections && !sections.length && <div className="nm-muted">Документ размечен, но блоков нет.</div>}
      {sections?.map((s, i) => {
        const head = `Кусок ${i + 1}${s.heading_path?.length ? ` · ${s.heading_path.join(' / ')}` : ''}${s.page != null ? ` · стр. ${s.page}` : ''}`;
        if (s.is_meaningful === false) {
          return <div className="nm-chunk" data-junk key={i}><div className="nm-chunk-head">{head} · служебный текст (в подэтапы не идёт)</div>
            <div className="nm-pre">{(s.text || '').slice(0, 400)}</div></div>;
        }
        return (
          <div className="nm-chunk" key={i}>
            <div className="nm-chunk-head">{head}</div>
            <div className="nm-pre">{(s.text || '').slice(0, 600)}</div>
            <div className="nm-row" style={{ gap: 6 }}>
              {s.is_general ? <Badge tone="ok">общий для всех</Badge>
                : (s.substages || []).length ? (s.substages || []).map((su, j) => (
                  <Badge key={j} tone={tone(su.confidence)} title={su.description}>
                    {(s.stages?.[0]?.title || '')} → {su.title || su.id}{su.confidence != null ? ` · ${Math.round(su.confidence * 100)}%` : ''}
                  </Badge>)) : <span className="nm-micro nm-muted">— ни одному подэтапу не соответствует —</span>}
            </div>
            {!s.is_general && (s.professions || []).length > 0 && <div className="nm-micro nm-muted">Профессии: {s.professions!.join(', ')}</div>}
            {s.why && <div className="nm-micro" style={{ color: 'var(--nm-soft-ink)' }}>Почему: {s.why}</div>}
          </div>
        );
      })}
    </Dialog>
  );
}

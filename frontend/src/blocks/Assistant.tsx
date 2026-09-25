// Ассистент: диалог (AnswerTurn), подсказки-чипы, композер «пилюля» с круглой кнопкой.
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, RotateCcw, TriangleAlert, UserRound } from 'lucide-react';
import { SUGGESTIONS } from '@shared/api';
import { useCabinet, type Turn } from '../lib/cabinet';
import { Badge, Button, Chip } from '../ui';

function AnswerTurn({ t, onRetry }: { t: Turn; onRetry: () => void }) {
  return (
    <>
      <div className="nm-bubble-me">{t.q}</div>
      <div className="nm-answer" aria-live="polite">
        {t.status === 'pending' && <span className="nm-typing"><span className="nm-spin" aria-hidden />Ищу ответ…</span>}
        {t.status === 'error' && (
          <>
            <Badge tone="danger" icon={TriangleAlert}>Ошибка</Badge>
            <div className="nm-muted">{t.a}</div>
            <Button size="sm" variant="secondary" icon={RotateCcw} onClick={onRetry}>Повторить</Button>
          </>
        )}
        {t.status === 'done' && (
          <>
            <div className="nm-pre">{t.a}</div>
            {t.escalated && <Badge tone="warn" icon={UserRound}>Передано специалисту</Badge>}
          </>
        )}
      </div>
    </>
  );
}

export function Composer({ onSend, busy, autoFocus }: { onSend: (q: string) => void; busy: boolean; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  const send = () => { if (!q.trim() || busy) return; onSend(q); setQ(''); };
  return (
    <form className="nm-composer" data-tour="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
      <label className="nm-sr" htmlFor="nm-question">Ваш вопрос</label>
      <input id="nm-question" value={q} maxLength={2000} autoComplete="off" autoFocus={autoFocus}
             placeholder="Например: что положено из спецодежды?" onChange={(e) => setQ(e.target.value)} />
      <Button type="submit" variant="primary" className="nm-send" icon={ArrowUp} aria-label="Отправить" disabled={!q.trim() || busy} />
    </form>
  );
}

export function Assistant({ compact }: { compact?: boolean }) {
  const { turns, asking, ask, retry, newDialog } = useCabinet();
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);
  return (
    <div className="nm-chat">
      <div className="nm-chat-log" ref={log} style={compact ? { maxHeight: 'none', overflow: 'visible' } : undefined}>
        {turns.length ? turns.map((t) => <AnswerTurn key={t.id} t={t} onRetry={() => retry(t)} />)
          : <div className="nm-chat-hello">Спросите про работу, адаптацию или порядки в компании. Если я не знаю ответа — передам вопрос специалисту.</div>}
      </div>
      {!turns.length && (
        <div className="nm-chips" aria-label="Подсказки">
          {SUGGESTIONS.map((s) => <Chip key={s} onClick={() => ask(s)} disabled={asking}>{s}</Chip>)}
        </div>
      )}
      {!compact && <Composer onSend={ask} busy={asking} />}
      {turns.length > 0 && (
        <div><Button variant="ghost" size="sm" onClick={newDialog} disabled={asking}>Новый диалог</Button></div>
      )}
    </div>
  );
}

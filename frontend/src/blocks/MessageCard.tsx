// Карточка сообщения плана (COMPONENTS.md → MessageCard): «Этап · Подэтап» + время, тело по
// типу: текст, чек-лист (отметка сохраняется сразу), мини-тест (верно/неверно, пояснение),
// опрос. Та же логика, что в приложении (shared/progress.ts).
import { Check } from 'lucide-react';
import type { Msg } from '@shared/types';
import { msgKicker, msgTime } from '@shared/format';
import { isChecklist, isQuestions, msgStats } from '@shared/progress';
import { Card, Progress } from '../ui';

export function MessageCard({ m, onAnswer, wide }: { m: Msg; onAnswer: (m: Msg, key: string, value: string | null) => void; wide?: boolean }) {
  const p = m.payload, a = m.answers || {};
  const stats = msgStats(m);
  const intro = (p as { intro?: string } | null)?.intro;
  let body;
  if (isChecklist(p)) {
    body = (
      <>
        {intro && <div className="nm-card-body nm-pre">{intro}</div>}
        <div className="nm-checklist" data-cols={wide && p.items.length > 3 ? 2 : undefined} role="group" aria-label="Чек-лист">
          {p.items.map((it) => (
            <button key={it.id} type="button" role="checkbox" className="nm-check" aria-checked={!!a[it.id]} onClick={() => onAnswer(m, it.id, null)}>
              <span className="nm-check-box">{a[it.id] && <Check aria-hidden />}</span>
              <span className="nm-check-text">{it.text}</span>
            </button>
          ))}
        </div>
      </>
    );
  } else if (isQuestions(p)) {
    const quiz = p.type === 'quiz';
    body = (
      <>
        {intro && <div className="nm-card-body nm-pre">{intro}</div>}
        {p.questions.map((q, qi) => {
          const chosen = a[q.id] as string | undefined;
          const long = (q.options || []).some((o) => o.text.length > 28);
          return (
            <div className="nm-q" key={q.id}>
              <div className="nm-q-text">{p.questions.length > 1 ? `${qi + 1}. ` : ''}{q.text}</div>
              <div className="nm-options" data-stack={long || undefined}>
                {(q.options || []).map((o) => {
                  const picked = chosen === o.id;
                  const state = quiz && chosen ? (o.correct ? 'right' : picked ? 'wrong' : undefined) : undefined;
                  return (
                    <button key={o.id} type="button" className="nm-option" data-state={state}
                            aria-pressed={!quiz ? picked : undefined} disabled={quiz && !!chosen}
                            onClick={() => onAnswer(m, q.id, o.id)}>
                      {o.text}
                    </button>
                  );
                })}
              </div>
              {quiz && chosen && q.explanation && <div className="nm-expl">{q.explanation}</div>}
            </div>
          );
        })}
      </>
    );
  } else {
    body = m.body ? <div className="nm-card-body nm-pre">{m.body}</div> : null;
  }
  const ratio = stats.kind === 'checklist' ? stats.done / (stats.total || 1)
    : stats.kind === 'quiz' || stats.kind === 'survey' ? stats.answered / (stats.total || 1) : 0;
  return (
    <Card as="article" aria-label={msgKicker(m)}>
      <div className="nm-card-kicker"><span>{msgKicker(m)}</span><time>{msgTime(m)}</time></div>
      {body}
      {stats.label && (
        <div className="nm-card-foot">
          {stats.kind !== 'text' && <Progress value={ratio} tone="ok" small label={stats.label} />}
          <span>{stats.label}</span>
        </div>
      )}
    </Card>
  );
}

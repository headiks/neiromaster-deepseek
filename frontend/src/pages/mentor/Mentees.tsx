// «Подопечные» наставника: ход адаптации каждого новичка и оценка по завершении этапа.
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, UserCheck } from 'lucide-react';
import { api, messageOf } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Badge, Button, Card, Empty, PageHeader, Progress, Spinner } from '../../ui';
import { DECISION_TONE, ReviewDialog, useReviewForm, type Metric, type ReviewStage } from '../../blocks/ReviewDialog';

type Mentee = {
  id: string; full_name: string; position?: string; department?: string; start_date?: string;
  stats?: { stage: string; progress: number; tests: { percent: number | null }; engagement: number | null } | null;
  stages: ReviewStage[]; metrics: Metric[];
};

const avg = (s?: Record<string, number> | null) => {
  const v = Object.values(s || {});
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '—';
};

export function MenteeStages({ m, onReview }: { m: Mentee; onReview: (s: ReviewStage) => void }) {
  const form = useReviewForm();
  const label = (k?: string | null) => form?.decisions.find((d) => d.key === k)?.label || '';
  return (
    <div className="nm-stack" style={{ gap: 6 }}>
      {m.stages.map((s) => {
        const r = s.review;
        return (
          <div key={s.id} className="nm-row-between" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span className="nm-row" style={{ gap: 6 }}>
              {s.completed ? <CheckCircle2 aria-hidden style={{ width: 16, height: 16 }} /> : <Clock aria-hidden style={{ width: 16, height: 16, opacity: .5 }} />}
              <span className={s.completed ? '' : 'nm-muted'}>{s.title}</span>
            </span>
            {r?.status === 'done' ? (
              <span className="nm-row" style={{ gap: 6 }}>
                <Badge tone="muted">{avg(r.scores)} из 5</Badge>
                {r.decision && <Badge tone={DECISION_TONE[r.decision]}>{label(r.decision)}</Badge>}
                <Button size="sm" variant="ghost" onClick={() => onReview(s)}>Изменить</Button>
              </span>
            ) : s.completed ? (
              <Button size="sm" variant="primary" onClick={() => onReview(s)}>Оценить этап</Button>
            ) : <span className="nm-small nm-muted">ещё идёт</span>}
          </div>
        );
      })}
    </div>
  );
}

export default function Mentees() {
  const toast = useToast();
  const [items, setItems] = useState<Mentee[] | null>(null);
  const [open, setOpen] = useState<{ m: Mentee; s: ReviewStage } | null>(null);
  const load = useCallback(() => {
    api.get<{ mentees: Mentee[] }>('/api/mentor/mentees').then((d) => setItems(d.mentees || []))
      .catch((e) => { toast.error(messageOf(e)); setItems([]); });
  }, [toast]);
  useEffect(() => { document.title = 'Подопечные · НейроМастер'; load(); }, [load]);
  const waiting = (items || []).reduce((n, m) => n + m.stages.filter((s) => s.completed && s.review?.status !== 'done').length, 0);
  return (
    <div className="nm-page">
      <PageHeader title="Подопечные" subtitle="Новички, у которых вы наставник. Когда новичок завершает этап, оцените его работу — это займёт пару минут." />
      {waiting > 0 && <Card><b>Ждут оценки: {waiting}</b> <span className="nm-muted">— кнопка «Оценить этап» у новичка.</span></Card>}
      {items === null ? <Spinner /> : !items.length ? (
        <Card pad={false}><Empty icon={UserCheck}>Подопечных пока нет. Администратор указывает наставника в карточке новичка.</Empty></Card>
      ) : items.map((m) => (
        <Card key={m.id}>
          <div className="nm-row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div className="nm-cell-title">{m.full_name}</div>
              <div className="nm-cell-sub">{[m.position, m.department].filter(Boolean).join(' · ') || '—'}</div>
            </div>
            {m.stats && (
              <span className="nm-row" style={{ gap: 6 }}>
                <Badge tone="muted">{m.stats.stage || '—'}</Badge>
                <Badge tone="muted">тесты {m.stats.tests.percent ?? '—'}{m.stats.tests.percent != null ? '%' : ''}</Badge>
                <Badge tone="muted">вовлечённость {m.stats.engagement ?? '—'}</Badge>
              </span>
            )}
          </div>
          {m.stats && <Progress small value={m.stats.progress} label="Пройдено по плану" />}
          {m.stages.length ? <MenteeStages m={m} onReview={(s) => setOpen({ m, s })} /> : <span className="nm-small nm-muted">План адаптации не назначен.</span>}
        </Card>
      ))}
      <ReviewDialog employee={open?.m || { id: '', full_name: '' }} stage={open?.s || null} metrics={open?.m.metrics || []}
                    onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} />
    </div>
  );
}

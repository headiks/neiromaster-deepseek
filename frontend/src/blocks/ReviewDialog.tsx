// Оценка новичка наставником по завершении этапа (backend/reviews.py): 5 критериев 1–5,
// производственные показатели должности, решение и комментарий.
import { useEffect, useState } from 'react';
import { api, enc, messageOf } from '../lib/api';
import { useToast } from '../lib/toast';
import { Button, Callout, Field, Input, Segmented, Textarea } from '../ui';
import { Dialog } from '../ui/Dialog';

export type Metric = { key: string; label: string; unit: string };
export type Review = {
  id: string; stage_id: string; stage_title: string; status: 'requested' | 'done';
  scores?: Record<string, number> | null; metrics?: Record<string, number> | null;
  decision?: string | null; comment?: string | null; done_at?: string;
};
export type ReviewStage = { id: string; title: string; completed: boolean; review?: Review | null };
type Form = { criteria: { key: string; label: string }[]; decisions: { key: string; label: string }[] };

let formCache: Form | null = null;
export function useReviewForm() {
  const [form, setForm] = useState<Form | null>(formCache);
  useEffect(() => {
    if (!formCache) api.get<Form>('/api/review-form').then((f) => { formCache = f; setForm(f); }).catch(() => {});
  }, []);
  return form;
}

export const DECISION_TONE: Record<string, 'ok' | 'warn' | 'danger'> = { ready: 'ok', more_time: 'warn', risk: 'danger' };

export function ReviewDialog({ employee, stage, metrics, onClose, onSaved }: {
  employee: { id: string; full_name: string }; stage: ReviewStage | null; metrics: Metric[];
  onClose: () => void; onSaved: () => void;
}) {
  const form = useReviewForm();
  const toast = useToast();
  const [scores, setScores] = useState<Record<string, number>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [decision, setDecision] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const r = stage?.review;
    setScores(r?.scores || {});
    setValues(Object.fromEntries(Object.entries(r?.metrics || {}).map(([k, v]) => [k, String(v)])));
    setDecision(r?.decision || '');
    setComment(r?.comment || '');
    setError(null);
  }, [stage]);
  if (!stage || !form) return null;
  const save = async () => {
    if (form.criteria.some((c) => !scores[c.key])) { setError('Оцените все критерии'); return; }
    if (!decision) { setError('Выберите решение по этапу'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/reviews/${enc(employee.id)}/${enc(stage.id)}`, { scores, metrics: values, decision, comment });
      toast.ok('Оценка сохранена');
      onSaved();
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} wide title={`Оценка: ${employee.full_name}`} subtitle={`Этап «${stage.title}». 1 — плохо, 5 — отлично.`}
            footer={<><Button variant="ghost" onClick={onClose}>Отмена</Button><Button variant="primary" loading={busy} onClick={save}>Сохранить оценку</Button></>}>
      <div className="nm-stack" style={{ gap: 14 }}>
        {error && <Callout tone="danger">{error}</Callout>}
        {form.criteria.map((c) => (
          <div key={c.key} className="nm-row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span>{c.label}</span>
            <Segmented label={c.label} value={String(scores[c.key] || '')} onChange={(v) => setScores((s) => ({ ...s, [c.key]: Number(v) }))}
                       options={['1', '2', '3', '4', '5'].map((v) => ({ value: v, label: v }))} />
          </div>
        ))}
        {metrics.length > 0 && (
          <div className="nm-field-row">
            {metrics.map((m) => (
              <Field key={m.key} label={m.unit ? `${m.label}, ${m.unit}` : m.label}>
                <Input type="number" inputMode="decimal" value={values[m.key] || ''} onChange={(e) => setValues((v) => ({ ...v, [m.key]: e.target.value }))} />
              </Field>
            ))}
          </div>
        )}
        <Field label="Решение по этапу">
          <Segmented label="Решение" value={decision} onChange={setDecision} options={form.decisions.map((d) => ({ value: d.key, label: d.label }))} />
        </Field>
        <Field label="Комментарий"><Textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder="Что получается, над чем поработать" /></Field>
      </div>
    </Dialog>
  );
}

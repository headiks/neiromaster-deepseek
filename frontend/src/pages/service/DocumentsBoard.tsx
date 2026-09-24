// Доска «этапы ↔ документы»: какие документы закреплены за этапами и подэтапами.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { Board, Coverage } from '../../lib/types';
import { Card, PageHeader } from '../../ui';
import { StageBoard } from '../admin/Documents';
import { DocLabelsDialog } from '../../blocks/DocLabels';

export default function DocumentsBoard() {
  const [plan, setPlan] = useState('');
  const [plans, setPlans] = useState<Coverage[]>([]);
  const [stats, setStats] = useState<Board['stats']>();
  const [labels, setLabels] = useState<string | null>(null);
  useEffect(() => {
    document.title = 'Этапы и документы · НейроМастер';
    api.get<{ plans: Coverage[] }>('/plans/coverage').then((d) => setPlans(d.plans || [])).catch(() => {});
  }, []);
  useEffect(() => { api.get<Board>(`/documents/board${plan ? `?plan_id=${encodeURIComponent(plan)}` : ''}`).then((b) => setStats(b.stats)).catch(() => {}); }, [plan]);
  return (
    <div className="nm-page">
      <PageHeader title="Этапы и документы" subtitle="Какие документы закреплены за этапами и подэтапами (разметка ИИ) и где их не хватает." />
      {stats && (
        <div className="nm-grid-3" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          {([['stages', 'этапов'], ['substages', 'подэтапов'], ['documents', 'документов'], ['unassigned', 'без привязки']] as const).map(([k, l]) => (
            <Card key={k} className="nm-stat"><b className={k === 'unassigned' && stats[k] ? 'nm-warn-text' : undefined}>{stats[k] || 0}</b><span>{l}</span></Card>
          ))}
        </div>
      )}
      <StageBoard planId={plan} plans={plans} onPlan={setPlan} onOpenDoc={setLabels} />
      <DocLabelsDialog filename={labels} onClose={() => setLabels(null)} />
    </div>
  );
}

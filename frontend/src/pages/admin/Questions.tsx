import { useEffect, useState } from 'react';
import { Check, HelpCircle, Link2, PartyPopper, RefreshCw, SearchX, SendHorizontal, TriangleAlert } from 'lucide-react';
import { api, apiJson } from '../../lib/api';
import type { Question } from '../../lib/types';

// Причина попадания в очередь (почему ассистент не ответил сам) — не путать со статусом ответа.
function ReasonBadge({ r }: { r?: string }) {
  return r === 'escalate'
    ? <span className="badge escalate"><TriangleAlert /> ЧС</span>
    : <span className="badge"><SearchX /> нет автоответа</span>;
}

export default function Questions({ onBadge }: { onBadge: (n: number) => void }) {
  const [showAll, setShowAll] = useState(false);
  const [items, setItems] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const load = () => {
    const url = showAll ? '/questions?status=' : '/questions?status=open';
    api(url).then((r) => r.json()).then((d) => {
      onBadge(d.open_count || 0);
      setItems(d.questions || []);
    }).catch(() => {});
  };
  useEffect(load, [showAll]);

  const resolve = async (qid: string) => {
    const answer = (answers[qid] || '').trim();
    if (!answer) { alert('Введите ответ'); return; }
    const { ok, data } = await apiJson(`/questions/${encodeURIComponent(qid)}/resolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answer }),
    });
    if (!ok) { alert(data.detail || 'Не удалось сохранить ответ'); return; }
    load();
  };

  return (
    <div className="tab-pane active">
      <h2 className="section-title"><HelpCircle /> Вопросы, на которые ассистент не ответил</h2>
      <div className="stage-hint">
        Сюда попадают вопросы сотрудников с пометкой ЧС и те, на которые в регламентах не нашлось
        ответа. Ответьте — сотрудник увидит ответ в личном кабинете.
      </div>
      <div className="toolbar" style={{ marginTop: 12 }}>
        <label style={{ fontSize: 14, color: '#475569' }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Показать отвеченные
        </label>
        <button className="ghost-btn" onClick={load}><RefreshCw /> Обновить</button>
      </div>
      <div id="questions-list">
        {!items ? (
          <div className="empty-hint">Загрузка вопросов...</div>
        ) : !items.length ? (
          <div className="empty-hint">Открытых вопросов нет <PartyPopper /></div>
        ) : (
          items.map((q) => {
            const who = [q.user_name, q.position].filter(Boolean).join(', ');
            const contact = q.contact ? ` · ${q.contact}` : '';
            const resolvedNote = q.resolved_question && q.resolved_question !== q.question
              ? <div className="context-note"><Link2 /> Понято как: «{q.resolved_question}»</div> : null;
            if (q.status === 'resolved') {
              return (
                <div className="card" style={{ opacity: 0.85 }} key={q.id}>
                  <div>
                    <span className="badge" style={{ background: '#dcfce7', color: '#16a34a' }}><Check /> отвечено</span>{' '}
                    <ReasonBadge r={q.reason} /> <small style={{ color: '#94a3b8' }}>{q.created_at}</small>
                  </div>
                  <div style={{ margin: '6px 0' }}><strong><HelpCircle /> {q.question}</strong> — {who}{contact}</div>
                  <div className="answer"><Check /> {q.answer}</div>
                  <small style={{ color: '#94a3b8' }}>Ответил: {q.answered_by || ''} · {q.answered_at || ''}</small>
                </div>
              );
            }
            return (
              <div className="card" key={q.id}>
                <div><ReasonBadge r={q.reason} /> <small style={{ color: '#94a3b8' }}>{q.created_at}</small></div>
                <div style={{ margin: '6px 0' }}><strong><HelpCircle /> {q.question}</strong></div>
                <div style={{ fontSize: 13, color: '#475569' }}>От: {who}{contact}{q.mentor ? ` · наставник: ${q.mentor}` : ''}</div>
                {resolvedNote}
                <textarea
                  rows={3}
                  style={{ width: '100%', marginTop: 8 }}
                  placeholder="Ответ сотруднику (можно после консультации со специалистом)"
                  value={answers[q.id] || ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                />
                <button className="primary-btn" style={{ marginTop: 6 }} onClick={() => resolve(q.id)}>
                  <SendHorizontal /> Отправить ответ
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays, Check, Clock, History, MessageSquare, MessagesSquare,
  RefreshCw, SendHorizontal, Shield, TriangleAlert, UserRound,
} from 'lucide-react';
import { api } from '../lib/api';
import { useMe } from '../lib/useMe';
import { startNotifications } from '../lib/notify';
import Header, { whoamiLabel } from '../components/Header';

const UPCOMING_LIMIT = 5;

function whenLabel(msg: any): string {
  if (msg.schedule.send_at) return msg.schedule.send_at.replace('T', ' ');
  const anchor = msg.schedule.anchor === 'before_start' ? 'до выхода' : 'от выхода';
  const offset = msg.schedule.offset_days;
  return `${offset >= 0 ? '+' : ''}${offset} дн. (${anchor}), ${msg.schedule.time}`;
}

function getSessionId(): string {
  let sid = localStorage.getItem('ragSessionId');
  if (!sid) {
    sid = crypto.randomUUID ? crypto.randomUUID() : `sid-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem('ragSessionId', sid);
  }
  return sid;
}

interface HistItem { question: string; answer: string; }

export default function Employee() {
  const me = useMe();
  const [schedule, setSchedule] = useState<any>(null);
  const [planError, setPlanError] = useState('');
  const [showAllPlan, setShowAllPlan] = useState(false);
  const [questions, setQuestions] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [result, setResult] = useState<any>(null);
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState<HistItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadMyPlan = () => {
    api('/api/my/schedule')
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => (ok ? setSchedule(data) : setPlanError(data.detail || '')))
      .catch(() => {});
  };
  const loadMyQuestions = () => {
    api('/api/my/questions').then((r) => r.json()).then((d) => setQuestions(d.questions || [])).catch(() => {});
  };

  useEffect(() => { loadMyPlan(); loadMyQuestions(); startNotifications(); }, []);

  const startNewDialog = () => {
    const sid = localStorage.getItem('ragSessionId');
    if (sid) fetch(`/session/${encodeURIComponent(sid)}`, { method: 'DELETE' }).catch(() => {});
    localStorage.removeItem('ragSessionId');
    setHistory([]);
    setResult(null);
    inputRef.current?.focus();
  };

  const ask = () => {
    const question = input.trim();
    if (!question) return;
    setAsking(true);
    setResult('loading');
    setInput('');
    api('/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, session_id: getSessionId() }),
    })
      .then((res) => res.json())
      .then((data) => {
        setResult(data);
        const answerText = data.answer || (data.route === 'escalate' ? 'Передано специалисту' : 'Ответ не найден');
        setHistory((h) => [{ question: data.question, answer: answerText }, ...h]);
        if (data.escalated) loadMyQuestions();
        setAsking(false);
      })
      .catch((err) => {
        setResult({ error: err.message });
        setAsking(false);
      });
  };

  const today = new Date().toISOString().slice(0, 10);
  const all = schedule?.messages || [];
  const upcoming = all.filter((m: any) => (m.schedule.send_at || '') >= today);
  const shownPlan = showAllPlan ? all : upcoming.slice(0, UPCOMING_LIMIT);
  const isAdmin = me?.role === 'owner' || me?.role === 'admin';

  return (
    <div className="app-page">
      <Header
        title="НейроМастер"
        whoami={whoamiLabel(me)}
        actions={isAdmin && <a className="admin-link" href="/admin"><Shield /> Админка</a>}
      />

      <div className="chat-header" style={{ marginTop: 28 }}>
        <h2 className="section-title"><CalendarDays /> Мой план адаптации</h2>
        {schedule && (
          <button className="toggle-btn" onClick={() => setShowAllPlan((v) => !v)}>
            {showAllPlan ? 'Показать только ближайшее' : 'Показать весь план'}
          </button>
        )}
      </div>
      <div id="my-plan">
        {planError && (
          <div className="plan-note">{planError}. Обратитесь к своему администратору или наставнику.</div>
        )}
        {!planError && !schedule && <div className="empty-hint">Загрузка плана...</div>}
        {schedule && (
          <>
            <div className="plan-note">
              План «{schedule.plan_title}» · дата выхода {schedule.start_date} · всего сообщений: {all.length}
              {!showAllPlan && ` · ближайших: ${upcoming.length}`}
            </div>
            {!shownPlan.length ? (
              <div className="empty-hint">Ближайших сообщений нет — программа адаптации пройдена.</div>
            ) : (
              <table className="schedule">
                <thead><tr><th>Когда</th><th>Этап</th><th>Сообщение</th></tr></thead>
                <tbody>
                  {shownPlan.map((msg: any, i: number) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: 'nowrap' }}>{whenLabel(msg)}</td>
                      <td>{msg.stage.title}<div className="msg-meta">{msg.substage.title}</div></td>
                      <td><div className="msg-text">{msg.content.text || 'Текст пока не подготовлен'}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {questions.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h2 className="section-title"><MessagesSquare /> Мои вопросы специалисту</h2>
          <div id="my-questions">
            {questions.map((q: any) => {
              const answered = q.status === 'resolved';
              return (
                <div className="card" style={{ marginBottom: 10 }} key={q.id}>
                  <div>
                    {answered
                      ? <span className="status-badge indexed"><Check /> отвечено</span>
                      : <span className="status-badge processing"><Clock /> ждёт ответа</span>}
                  </div>
                  <div style={{ margin: '6px 0' }}><strong>{q.question}</strong></div>
                  {answered ? (
                    <>
                      <div className="answer">{q.answer}</div>
                      <small style={{ color: '#94a3b8' }}>{q.answered_by || ''} · {q.answered_at || ''}</small>
                    </>
                  ) : (
                    <div style={{ color: '#64748b', fontSize: 14 }}>Передано специалисту, ответ появится здесь.</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="chat-header">
        <h2 className="section-title"><MessageSquare /> Задать вопрос</h2>
        <button className="new-dialog-btn" onClick={startNewDialog} title="Забыть историю текущего диалога">
          <RefreshCw /> Новый диалог
        </button>
      </div>
      <div className="input-area">
        <input
          ref={inputRef}
          id="question-input"
          type="text"
          placeholder="Например: что положено из спецодежды?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
        />
        <button id="ask-btn" onClick={ask} disabled={asking}><SendHorizontal /> Отправить</button>
      </div>

      <div id="result">
        {result === 'loading' && <div className="empty-hint">Обработка...</div>}
        {result && result !== 'loading' && <AskResult data={result} />}
      </div>

      <div id="history" style={{ marginTop: 30 }}>
        <h3><History /> История</h3>
        <div id="history-list">
          {history.map((h, i) => (
            <div className="history-item" key={i}>
              <div className="q">{h.question}</div>
              <div className="a">{h.answer}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AskResult({ data }: { data: any }) {
  if (data.error) {
    return <div className="error"><TriangleAlert /> {data.error}</div>;
  }
  return (
    <div className="card">
      <h3>{data.question}</h3>
      {data.answer ? (
        <div style={{ marginTop: 12 }}><div className="answer">{data.answer}</div></div>
      ) : data.route === 'escalate' ? (
        <p style={{ marginTop: 12 }}><UserRound /> Вопрос передан специалисту — ответ появится в разделе «Мои вопросы специалисту».</p>
      ) : data.route === 'general' ? (
        <p style={{ marginTop: 12 }}>Здравствуйте! Задайте вопрос по работе, регламентам или безопасности.</p>
      ) : (
        <p style={{ marginTop: 12 }}>Не нашёл точного ответа в базе. Уточните вопрос или обратитесь к наставнику — при необходимости он передаст его специалисту.</p>
      )}
    </div>
  );
}

// Тестовые сообщения любого типа (текст, чек-лист, опрос, мини-тест): приходят в приложение
// и кабинет так же, как сообщения плана. Вопросы — текстом: блоки через пустую строку,
// «- вариант», «- * верный», «> пояснение».
import { useEffect, useState } from 'react';
import { Layers, SendHorizontal, X } from 'lucide-react';
import { api, enc, messageOf } from '../../lib/api';
import type { AdminUser } from '../../lib/types';
import { Button, Callout, Card, Field, Input, PageHeader, Select, Textarea } from '../../ui';

const KINDS: Record<string, string> = { message: 'Сообщение', reminder: 'Напоминание', checklist: 'Чек-лист', system_check: 'Проверка', survey: 'Опрос', quiz: 'Мини-тест', handover: 'Передача наставнику' };
const FORMAT: Record<string, 'text' | 'list' | 'questions'> = { message: 'text', reminder: 'text', handover: 'text', checklist: 'list', system_check: 'list', survey: 'questions', quiz: 'questions' };
type Q = { text: string; options: { text: string; correct?: boolean }[]; explanation?: string };
type M = { kind: string; title: string; intro: string; body: string; checklist: string[]; questions: Q[]; delay: number };

const qToText = (qs: Q[]) => (qs || []).map((q) => [q.text, ...(q.options || []).map((o) => `- ${o.correct ? '* ' : ''}${o.text}`), ...(q.explanation ? [`> ${q.explanation}`] : [])].join('\n')).join('\n\n');
const textToQ = (text: string): Q[] => text.split(/\n\s*\n/).map((block) => {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const q: Q = { text: lines[0], options: [], explanation: '' };
  lines.slice(1).forEach((l) => {
    if (l.startsWith('>')) q.explanation = l.slice(1).trim();
    else if (l.startsWith('-')) { let t = l.slice(1).trim(); const correct = t.startsWith('*'); if (correct) t = t.slice(1).trim(); if (t) q.options.push({ text: t, correct }); }
  });
  return q;
}).filter(Boolean) as Q[];

function Editor({ m, onChange, onRemove }: { m: M; onChange: (p: Partial<M>) => void; onRemove: () => void }) {
  const fmt = FORMAT[m.kind] || 'text';
  const [qText, setQText] = useState(() => qToText(m.questions));
  const [list, setList] = useState(() => m.checklist.join('\n'));
  return (
    <Card>
      <div className="nm-row">
        <Select small value={m.kind} onChange={(e) => onChange({ kind: e.target.value })} aria-label="Тип" style={{ width: 'auto', minWidth: 170 }}>
          {Object.entries(KINDS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </Select>
        <Input small className="nm-grow" placeholder="Заголовок" value={m.title} onChange={(e) => onChange({ title: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
        <span className="nm-small nm-muted">через</span>
        <Input small type="number" min={0} step={10} value={m.delay} onChange={(e) => onChange({ delay: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 90 }} aria-label="Задержка, сек" />
        <span className="nm-small nm-muted">сек</span>
        <Button size="sm" variant="ghost" iconOnly icon={X} aria-label="Убрать сообщение" onClick={onRemove} />
      </div>
      {fmt === 'text' ? <Field label="Текст"><Textarea value={m.body} onChange={(e) => onChange({ body: e.target.value })} style={{ minHeight: 90 }} /></Field> : (
        <>
          <Field label="Вступление"><Input small value={m.intro} onChange={(e) => onChange({ intro: e.target.value })} /></Field>
          {fmt === 'list'
            ? <Field label="Пункты (по одному в строке)"><Textarea value={list} onChange={(e) => { setList(e.target.value); onChange({ checklist: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) }); }} /></Field>
            : <Field label="Вопросы" help={`Вопросы разделяйте пустой строкой. Первая строка — вопрос, затем варианты «- вариант».${m.kind === 'quiz' ? ' Верный вариант: «- * вариант». Пояснение после ответа: «> текст».' : ''}`}>
                <Textarea value={qText} style={{ minHeight: 160 }} onChange={(e) => { setQText(e.target.value); onChange({ questions: textToQ(e.target.value) }); }} />
              </Field>}
        </>
      )}
    </Card>
  );
}

export default function MessageTest() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userId, setUserId] = useState('');
  const [msgs, setMsgs] = useState<(M & { key: number })[]>([]);
  const [status, setStatus] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [seq, setSeq] = useState(0);
  const samples = () => api.get<{ messages: M[] }>('/test-messages/samples').then((d) => {
    setMsgs((d.messages || []).map((m, i) => ({ ...m, intro: m.intro || '', body: m.body || '', checklist: m.checklist || [], questions: m.questions || [], delay: m.delay || 0, key: Date.now() + i })));
  }).catch(() => {});
  useEffect(() => {
    document.title = 'Тестовые сообщения · НейроМастер';
    api.get<{ users: AdminUser[] }>('/users').then((d) => { const list = (d.users || []).filter((u) => u.username); setUsers(list); setUserId(list[0]?.id || ''); }).catch(() => {});
    samples();
  }, []);
  const add = (kind: string) => { if (!kind) return; setSeq(seq + 1); setMsgs([...msgs, { kind, title: KINDS[kind], intro: '', body: '', checklist: [], questions: [], delay: 0, key: seq + 1 }]); };
  const send = async () => {
    if (!userId) { setStatus({ tone: 'danger', text: 'Выберите пользователя.' }); return; }
    if (!msgs.length) { setStatus({ tone: 'danger', text: 'Добавьте хотя бы одно сообщение.' }); return; }
    setBusy(true); setStatus(null);
    try {
      const d = await api.post<{ sent: number; target: string }>(`/users/${enc(userId)}/test-messages`, { messages: msgs.map(({ key: _k, ...m }) => m) });
      const later = msgs.filter((m) => m.delay > 0).length;
      setStatus({ tone: 'ok', text: `Отправлено ${d.sent} для «${d.target}»${later ? ` (из них ${later} — с задержкой, выпустит планировщик)` : ''}. Смотрите «Чат» в приложении или кабинете.` });
    } catch (e) { setStatus({ tone: 'danger', text: messageOf(e) }); } finally { setBusy(false); }
  };
  return (
    <div className="nm-page">
      <PageHeader title="Тестовые сообщения" subtitle="Сообщения любого типа придут в приложение (пушем) и в кабинет точно так же, как сообщения плана адаптации." />
      <Card>
        <div className="nm-row" style={{ alignItems: 'flex-end' }}>
          <Field label="Кому" className="nm-grow">
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              {!users.length && <option value="">— нет пользователей с логином —</option>}
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name} (@{u.username})</option>)}
            </Select>
          </Field>
          <Button icon={Layers} onClick={samples}>Примеры всех типов</Button>
          <Field label="Добавить сообщение">
            <Select value="" onChange={(e) => add(e.target.value)}>
              <option value="">— тип —</option>
              {Object.entries(KINDS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </Select>
          </Field>
        </div>
      </Card>
      {msgs.map((m, i) => (
        <Editor key={m.key} m={m} onChange={(p) => setMsgs(msgs.map((x, j) => (j === i ? { ...x, ...p } : x)))} onRemove={() => setMsgs(msgs.filter((_, j) => j !== i))} />
      ))}
      {!msgs.length && <Callout>Сообщений нет — загрузите примеры или добавьте своё.</Callout>}
      <div className="nm-row">
        <Button variant="primary" icon={SendHorizontal} loading={busy} onClick={send}>Отправить</Button>
        {status && <span className={status.tone === 'danger' ? 'nm-danger-text nm-small' : 'nm-small nm-muted'} role="status">{status.text}</span>}
      </div>
    </div>
  );
}

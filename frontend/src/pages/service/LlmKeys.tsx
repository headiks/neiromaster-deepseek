// Суперадмин: пул ключей DeepSeek (backend/llmkeys.py). Каждый вызов модели — ответ
// ассистента, разметка документа, генерация плана — берёт свободный ключ (меньше всего
// запросов в полёте). Ключ с ошибкой оплаты или доступа сам встаёт на паузу.
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, RefreshCw, Trash2, Wallet } from 'lucide-react';
import { api, messageOf } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Badge, Button, Card, Empty, Field, Input, Spinner, Toggle } from '../../ui';
import { useConfirm } from '../../ui/confirm';

type Key = {
  id: string; label: string; tail: string; active: boolean; source: 'db' | 'env'; calls: number;
  inflight: number; cooling: boolean; last_error?: string | null; disabled_until?: string; last_used_at?: string;
  balance?: { total?: number; currency?: string; available?: boolean; error?: string };
};

export function LlmKeys() {
  const toast = useToast();
  const { confirm } = useConfirm();
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback((balance = false) => {
    api.get<{ keys: Key[] }>(`/api/llm-keys${balance ? '?balance=1' : ''}`).then((d) => setKeys(d.keys || []))
      .catch((e) => { toast.error(messageOf(e)); setKeys([]); });
  }, [toast]);
  useEffect(() => { load(true); }, [load]);

  const add = async () => {
    setBusy(true);
    try {
      await api.post('/api/llm-keys', { label, key: key.trim() });
      setLabel(''); setKey('');
      toast.ok('Ключ добавлен — он сразу участвует в выборе свободного');
      load(true);
    } catch (e) { toast.error(messageOf(e)); } finally { setBusy(false); }
  };
  const toggle = (k: Key, active: boolean) =>
    api.put(`/api/llm-keys/${k.id}`, { active }).then(() => load()).catch((e) => toast.error(messageOf(e)));
  const remove = async (k: Key) => {
    if (!(await confirm({ title: `Удалить ключ «${k.label || '…' + k.tail}»?`, text: 'Запросы перейдут на остальные ключи пула.', ok: 'Удалить', danger: true }))) return;
    api.del(`/api/llm-keys/${k.id}`).then(() => load()).catch((e) => toast.error(messageOf(e)));
  };

  const state = (k: Key) => (!k.active ? <Badge tone="muted">выключен</Badge>
    : k.cooling ? <Badge tone="warn">пауза</Badge> : <Badge tone="ok">в работе</Badge>);

  return (
    <Card>
      <div className="nm-row" style={{ justifyContent: 'space-between' }}>
        <b className="nm-row" style={{ gap: 8 }}><KeyRound aria-hidden style={{ width: 18, height: 18 }} />Ключи DeepSeek</b>
        <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => load(true)}>Обновить с балансом</Button>
      </div>
      <p className="nm-small nm-muted" style={{ margin: 0 }}>
        Каждый запрос к модели — ответ ассистента, разбор документа, генерация плана — берёт свободный ключ: с наименьшим
        числом запросов в полёте. Ключ, на который DeepSeek ответил «нет денег» или «неверный ключ», встаёт на паузу на час,
        при лимите запросов — на минуту; работу подхватывают остальные.
      </p>
      {keys === null ? <Spinner /> : !keys.length ? <Empty icon={KeyRound}>Ключей нет — добавьте первый.</Empty> : (
        <div className="nm-table-wrap">
          <table className="nm-edit-table" style={{ fontSize: 13 }}>
            <thead><tr><th>Ключ</th><th>Состояние</th><th>В полёте</th><th>Вызовов</th><th>Баланс</th><th>Ошибка</th><th /></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td><b>{k.label || 'Без названия'}</b><div className="nm-micro nm-muted">sk-…{k.tail}</div></td>
                  <td>{state(k)}</td>
                  <td>{k.inflight}</td>
                  <td>{k.calls}</td>
                  <td>{!k.balance ? '—' : k.balance.error ? <span className="nm-danger-text nm-micro">{k.balance.error}</span>
                    : <span className="nm-row" style={{ gap: 4 }}><Wallet aria-hidden style={{ width: 14, height: 14 }} />{k.balance.total} {k.balance.currency}</span>}</td>
                  <td className="nm-micro nm-muted" style={{ maxWidth: 260 }}>{k.last_error || ''}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {k.source === 'db' ? (
                      <span className="nm-row" style={{ gap: 6 }}>
                        <Toggle checked={k.active} onChange={(v) => toggle(k, v)} label="Ключ включён" />
                        <Button size="sm" variant="ghost" iconOnly icon={Trash2} aria-label="Удалить ключ" onClick={() => remove(k)} />
                      </span>
                    ) : <span className="nm-micro nm-muted">из .env</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="nm-row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Field label="Название"><Input small value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Например: ключ 2" maxLength={100} /></Field>
        <Field label="Ключ API" className="nm-grow"><Input small type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" /></Field>
        <Button type="submit" size="sm" variant="primary" icon={Plus} loading={busy} disabled={!key.trim()}>Добавить</Button>
      </form>
    </Card>
  );
}

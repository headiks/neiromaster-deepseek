// Суперадмин: заявки с демо-сайта — кто оставил контакты после знакомства с системой.
import { useCallback, useEffect, useState } from 'react';
import { Inbox, RefreshCw } from 'lucide-react';
import { api, messageOf } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { Badge, Button, Card, Empty, PageHeader, Spinner } from '../../ui';

type Lead = { id: string; created_at: string; name: string; company: string; contact: string; comment: string; status: 'new' | 'done' };

const date = (s: string) => {
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export default function Leads() {
  const toast = useToast();
  const [items, setItems] = useState<Lead[] | null>(null);
  const load = useCallback(() => {
    api.get<{ leads: Lead[] }>('/api/companies/leads').then((d) => setItems(d.leads || []))
      .catch((e) => { toast.error(messageOf(e)); setItems([]); });
  }, [toast]);
  useEffect(() => { document.title = 'Заявки · НейроМастер'; load(); }, [load]);
  const mark = async (l: Lead) => {
    try {
      await api.post(`/api/companies/leads/${encodeURIComponent(l.id)}`, { status: l.status === 'new' ? 'done' : 'new' });
      load();
    } catch (e) { toast.error(messageOf(e)); }
  };
  return (
    <div className="nm-page">
      <PageHeader title="Заявки" subtitle="Контакты, оставленные на демо-сайте после знакомства с системой."
                  actions={<Button variant="ghost" icon={RefreshCw} onClick={load}>Обновить</Button>} />
      {items === null ? <Spinner /> : !items.length ? (
        <Card pad={false}><Empty icon={Inbox}>Заявок пока нет.</Empty></Card>
      ) : (
        <Card pad={false}>
          <div className="nm-table-wrap">
            <table className="nm-edit-table" style={{ fontSize: 13 }}>
              <thead><tr><th>Когда</th><th>Имя</th><th>Компания</th><th>Контакт</th><th>Комментарий</th><th>Статус</th><th /></tr></thead>
              <tbody>
                {items.map((l) => (
                  <tr key={l.id}>
                    <td className="nm-muted" style={{ whiteSpace: 'nowrap' }}>{date(l.created_at)}</td>
                    <td>{l.name || '—'}</td>
                    <td>{l.company || '—'}</td>
                    <td><b>{l.contact}</b></td>
                    <td className="nm-pre">{l.comment || '—'}</td>
                    <td><Badge tone={l.status === 'new' ? 'accent' : 'muted'}>{l.status === 'new' ? 'Новая' : 'Обработана'}</Badge></td>
                    <td><Button size="sm" variant="ghost" onClick={() => mark(l)}>{l.status === 'new' ? 'Обработана' : 'Вернуть в новые'}</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

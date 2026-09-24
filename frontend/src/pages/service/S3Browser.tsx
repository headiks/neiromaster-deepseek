// Обозреватель S3-хранилища оригиналов (только чтение). Администратор видит свою папку.
import { useCallback, useEffect, useState } from 'react';
import { File, Folder, RefreshCw } from 'lucide-react';
import { ruDateTime } from '@shared/format';
import { api, enc, messageOf } from '../../lib/api';
import { Button, Callout, Card, Checkbox, Empty, PageHeader, Spinner } from '../../ui';

type Listing = { enabled: boolean; endpoint?: string; bucket?: string; region?: string; prefix?: string; home?: string; scope?: string;
  folders?: { name: string; prefix: string }[]; files?: { name: string; size?: number; last_modified?: string }[]; total_size?: number; truncated?: boolean };

function size(n?: number) {
  if (n == null) return '—';
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']; let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i ? v.toFixed(1) : v} ${u[i]}`;
}

export default function S3Browser() {
  const [prefix, setPrefix] = useState('');
  const [recursive, setRecursive] = useState(false);
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { document.title = 'Хранилище S3 · НейроМастер'; }, []);
  const load = useCallback(() => {
    setData(null); setError(null);
    api.get<Listing>(`/api/s3/list?prefix=${enc(prefix)}&recursive=${recursive}`).then((d) => { setData(d); if (d.prefix !== undefined && d.prefix !== prefix) setPrefix(d.prefix); })
      .catch((e) => setError(messageOf(e)));
  }, [prefix, recursive]);
  useEffect(load, [load]);
  const home = data?.home || '';
  const parts = prefix.split('/').filter(Boolean);
  return (
    <div className="nm-page">
      <PageHeader title="Хранилище S3" subtitle={data?.enabled ? <>Хранилище <code className="nm-code">{data.endpoint}</code> · бакет <code className="nm-code">{data.bucket}</code> · регион <code className="nm-code">{data.region || '—'}</code></> : 'Оригиналы загруженных документов'}
                  actions={<><Checkbox label="Рекурсивно" checked={recursive} onChange={setRecursive} /><Button variant="ghost" icon={RefreshCw} onClick={load}>Обновить</Button></>} />
      {error && <Callout tone="danger">Ошибка листинга: {error}</Callout>}
      {!data && !error && <Spinner />}
      {data && !data.enabled && <Callout tone="warn">S3 выключен (не заданы NEIROMASTER_S3_ENDPOINT / NEIROMASTER_S3_BUCKET). Оригиналы хранятся только локально в data/documents/.</Callout>}
      {data?.enabled && (
        <Card pad={false}>
          <div className="nm-row" style={{ padding: '14px 18px', gap: 6 }}>
            <button type="button" className="nm-link" onClick={() => setPrefix(home)}>{home ? 'моя папка' : 'bucket'}</button>
            {parts.map((p, i) => {
              const acc = `${parts.slice(0, i + 1).join('/')}/`;
              const locked = home && acc.length < home.length;
              return <span key={acc}>/ {locked ? p : <button type="button" className="nm-link" onClick={() => setPrefix(acc)}>{p}</button>}</span>;
            })}
          </div>
          {!(data.folders || []).length && !(data.files || []).length ? <Empty>Пусто в этом префиксе.</Empty> : (
            <div className="nm-table-wrap"><table className="nm-edit-table">
              <thead><tr><th>Ключ</th><th>Размер</th><th>Изменён</th></tr></thead>
              <tbody>
                {!recursive && (data.folders || []).map((f) => (
                  <tr key={f.prefix}><td><button type="button" className="nm-link" onClick={() => setPrefix(f.prefix)}><Folder aria-hidden style={{ width: 15, height: 15, verticalAlign: '-3px' }} /> {f.name}/</button></td><td className="nm-muted">папка</td><td className="nm-muted">—</td></tr>
                ))}
                {(data.files || []).map((f) => (
                  <tr key={f.name}><td><File aria-hidden style={{ width: 15, height: 15, verticalAlign: '-3px' }} /> {f.name}</td><td>{size(f.size)}</td><td className="nm-muted">{ruDateTime(f.last_modified)}</td></tr>
                ))}
              </tbody>
            </table></div>
          )}
          <div className="nm-row-between nm-small nm-muted" style={{ padding: '12px 18px' }}>
            <span>{data.scope === 'own' ? 'Видна только ваша папка · ' : ''}{recursive ? 'файлов (рекурсивно)' : `папок ${(data.folders || []).length} · файлов`}: {(data.files || []).length}</span>
            <span>суммарно: <b>{size(data.total_size)}</b>{data.truncated ? ' · показаны первые 1000' : ''}</span>
          </div>
        </Card>
      )}
    </div>
  );
}

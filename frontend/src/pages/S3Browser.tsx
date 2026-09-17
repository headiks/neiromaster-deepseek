import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getJson } from '../lib/api';
import Header from '../components/Header';

function fmtSize(n?: number) {
  if (n == null) return '—';
  const u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i ? v.toFixed(1) : v) + ' ' + u[i];
}
function fmtDate(s?: string) {
  if (!s) return '—';
  const d = new Date(s);
  return isNaN(+d) ? s : d.toLocaleString('ru-RU', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function S3Browser() {
  const [prefix, setPrefix] = useState('');
  const [recursive, setRecursive] = useState(false);
  const [home, setHome] = useState('');
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState('');

  const load = () => {
    setData(null); setError('');
    getJson(`/api/s3/list?prefix=${encodeURIComponent(prefix)}&recursive=${recursive}`)
      .then((d) => { setData(d); if (d.enabled) { if (d.prefix != null) setPrefixSilent(d.prefix); setHome(d.home || ''); } })
      .catch((e) => setError(e.message));
  };
  // сервер может подменить префикс на разрешённый — обновляем без повторного запроса-цикла
  const setPrefixSilent = (p: string) => setPrefix((cur) => (cur === p ? cur : p));
  useEffect(load, [prefix, recursive]);

  const crumbs = (pfx: string) => {
    const parts = pfx.split('/').filter(Boolean);
    let acc = '';
    const nodes: React.ReactNode[] = [<a key="root" onClick={() => setPrefix(home)} style={linkStyle}>{home ? 'моя папка' : 'bucket'}</a>];
    parts.forEach((p, i) => {
      acc += p + '/';
      const a = acc;
      const locked = home && a.length < home.length;
      nodes.push(<span key={'s' + i} style={{ color: 'var(--muted)' }}> / </span>);
      nodes.push(locked ? <span key={'p' + i}>{p}</span> : <a key={'p' + i} onClick={() => setPrefix(a)} style={linkStyle}>{p}</a>);
    });
    return nodes;
  };

  const folders = data?.folders || [];
  const files = data?.files || [];

  return (
    <div className="app-page">
      <Header title="S3-хранилище оригиналов" actions={<a className="ghost-btn" href="/admin">← Админка</a>} />
      <div className="stage-hint">
        {!data ? 'Загрузка…' : data.enabled ? <>Хранилище: <code>{data.endpoint || '—'}</code> · бакет <code>{data.bucket || '—'}</code> · регион <code>{data.region || '—'}</code></> : 'S3 не настроен на этом сервере.'}
      </div>

      {error && <div className="warn" style={{ marginTop: 16 }}>Ошибка листинга: {error}</div>}
      {data && !data.enabled && (
        <div className="warn" style={{ marginTop: 16 }}>S3 выключен (не заданы NEIROMASTER_S3_ENDPOINT / NEIROMASTER_S3_BUCKET). Оригиналы хранятся только локально в <code>data/documents/</code>.</div>
      )}
      {data && data.enabled && (
        <div className="card" style={{ padding: 0, marginTop: 16 }}>
          <div className="toolbar" style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-divider)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>{crumbs(data.prefix || '')}</div>
            <label style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={recursive} onChange={(e) => setRecursive(e.target.checked)} /> рекурсивно
            </label>
            <button className="ghost-btn" onClick={load}><RefreshCw /> Обновить</button>
          </div>
          <table className="schedule">
            <thead><tr><th>Ключ</th><th style={{ textAlign: 'right' }}>Размер</th><th>Изменён</th></tr></thead>
            <tbody>
              {!recursive && folders.map((f: any) => (
                <tr key={f.prefix} style={{ cursor: 'pointer' }} onClick={() => setPrefix(f.prefix)}>
                  <td><span style={{ marginRight: 8 }}>📁</span><span className="mono">{f.name}/</span></td>
                  <td style={{ textAlign: 'right', color: 'var(--muted)' }}>папка</td><td style={{ color: 'var(--muted)' }}>—</td>
                </tr>
              ))}
              {files.map((f: any) => (
                <tr key={f.name}><td><span style={{ marginRight: 8 }}>📄</span><span className="mono">{f.name}</span></td><td style={{ textAlign: 'right' }}>{fmtSize(f.size)}</td><td>{fmtDate(f.last_modified)}</td></tr>
              ))}
              {!folders.length && !files.length && <tr><td colSpan={3} className="empty-hint">Пусто в этом префиксе.</td></tr>}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 16px', color: 'var(--muted)', fontSize: 13 }}>
            <span>{data.scope === 'own' ? 'Видна только ваша папка · ' : ''}{recursive ? 'файлов (рекурсивно)' : 'папок ' + folders.length + ' · файлов'}: {files.length}</span>
            <span>суммарно: <b>{fmtSize(data.total_size)}</b>{data.truncated ? ' · показаны первые 1000' : ''}</span>
          </div>
        </div>
      )}
    </div>
  );
}

const linkStyle: React.CSSProperties = { color: 'var(--color-accent)', textDecorationLine: 'none', cursor: 'pointer' };

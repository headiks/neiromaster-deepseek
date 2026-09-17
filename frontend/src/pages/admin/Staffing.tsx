import { useState } from 'react';
import { Download, FileSpreadsheet, Table, TriangleAlert, UserPlus, X } from 'lucide-react';
import { apiJson } from '../../lib/api';
import Dropzone from '../../components/Dropzone';

const KEYS = ['full_name', 'position', 'department', 'start_date'] as const;
const LABELS: Record<string, string> = {
  full_name: 'ФИО', position: 'Должность', department: 'Отдел', start_date: 'Дата приёма/выхода',
};
type Rec = Record<string, string>;
interface Created { full_name: string; username: string; password: string; position?: string }
interface ImportResult { profiles: Created[]; vacancies: { position: string; department?: string }[]; skipped: { full_name: string; reason: string }[] }

export default function Staffing() {
  const [records, setRecords] = useState<Rec[]>([]);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const preview = async (files: FileList) => {
    const file = files[0];
    if (!file) return;
    setResult(null);
    setRecords([]);
    setStatus(`ИИ разбирает «${file.name}»…`);
    const fd = new FormData();
    fd.append('file', file);
    const { ok, data } = await apiJson('/staffing/preview', { method: 'POST', body: fd });
    if (!ok) { setStatus(data.detail || 'ошибка разбора'); return; }
    const recs: Rec[] = data.records || [];
    setRecords(recs);
    const withName = recs.filter((r) => (r.full_name || '').trim()).length;
    setStatus(`Найдено строк: ${data.count} (с ФИО: ${withName}, вакансий: ${data.count - withName}). Поля можно отредактировать.`);
  };

  const setCell = (i: number, k: string, v: string) => setRecords((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const removeRow = (i: number) => setRecords((rs) => rs.filter((_, j) => j !== i));

  const doImport = async () => {
    if (!records.length) return;
    if (!confirm(`Создать ${records.length} записей? Строки с ФИО — профили (существующие по ФИО пропускаются), без ФИО — вакансии.`)) return;
    setStatus('Создаём…');
    const { ok, data } = await apiJson('/staffing/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records }),
    });
    if (!ok) { setStatus(data.detail || 'ошибка создания'); return; }
    const res: ImportResult = { profiles: data.profiles || [], vacancies: data.vacancies || [], skipped: data.skipped || [] };
    setResult(res);
    setStatus(`Профилей: ${res.profiles.length}, вакансий: ${res.vacancies.length}, пропущено: ${res.skipped.length}.`);
  };

  const downloadCsv = () => {
    const created = result?.profiles || [];
    if (!created.length) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['ФИО', 'Логин', 'Пароль', 'Должность'].join(';')]
      .concat(created.map((c) => [c.full_name, c.username, c.password, c.position || ''].map(esc).join(';')));
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'staffing_credentials.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="tab-pane active">
      <h2><Table /> Штатное расписание</h2>
      <p className="muted" style={{ color: '#64748b', fontSize: 14 }}>
        Первичный инструмент: загрузите штатку (xlsx, xls, csv) — ИИ сам определит структуру.
        Если в файле есть ФИО — создаются профили сотрудников (логин по ФИО, временный пароль).
        Если это расписание должностей без людей — создаются профили-вакансии.
      </p>
      <Dropzone onFiles={preview} accept=".xlsx,.xls,.csv,.tsv">
        <div><FileSpreadsheet style={{ width: 28, height: 28, display: 'block', margin: '0 auto 8px', color: 'var(--color-accent)' }} /> Перетащите штатку (xlsx или csv) сюда или нажмите, чтобы выбрать файл</div>
        <small>Форматы .xlsx, .xls, .csv · ИИ сам определит структуру таблицы</small>
      </Dropzone>
      <div className="muted" style={{ marginTop: 10, color: '#64748b', fontSize: 14 }}>{status}</div>

      {records.length > 0 && (
        <>
          <div className="section-head-row" style={{ margin: '14px 0 6px' }}>
            <div className="doc-meta muted">Строки с ФИО станут профилями, без ФИО — вакансиями.</div>
            <button className="ghost-btn" onClick={doImport}><UserPlus /> Создать ({records.length})</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tst" style={{ fontSize: 13 }}>
              <thead><tr>{KEYS.map((k) => <th key={k}>{LABELS[k]}</th>)}<th></th></tr></thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={i}>
                    {KEYS.map((k) => (
                      <td key={k}><input type="text" style={{ width: '100%', boxSizing: 'border-box' }} value={r[k] || ''} onChange={(e) => setCell(i, k, e.target.value)} /></td>
                    ))}
                    <td><button className="icon-btn danger" title="Убрать строку" onClick={() => removeRow(i)}><X /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {result && (
        <div>
          {result.profiles.length > 0 && (
            <>
              <div className="warn" style={{ margin: '12px 0' }}><TriangleAlert /> Пароли показываются один раз — выгрузите их сейчас.</div>
              <button className="ghost-btn" onClick={downloadCsv}><Download /> Скачать логины и пароли (CSV)</button>
              <div style={{ overflowX: 'auto', marginTop: 10 }}>
                <table className="tst" style={{ fontSize: 13 }}>
                  <thead><tr><th>ФИО</th><th>Логин</th><th>Пароль</th><th>Должность</th></tr></thead>
                  <tbody>{result.profiles.map((c, i) => (
                    <tr key={i}><td>{c.full_name}</td><td className="mono">{c.username}</td><td className="mono">{c.password}</td><td>{c.position || ''}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
          {result.vacancies.length > 0 && (
            <>
              <div style={{ marginTop: 14, fontWeight: 600 }}>Вакансии ({result.vacancies.length}):</div>
              <div style={{ overflowX: 'auto', marginTop: 6 }}>
                <table className="tst" style={{ fontSize: 13 }}>
                  <thead><tr><th>Должность</th><th>Отдел</th></tr></thead>
                  <tbody>{result.vacancies.map((v, i) => <tr key={i}><td>{v.position}</td><td>{v.department || ''}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          )}
          {result.skipped.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <strong>Пропущены:</strong>
              {result.skipped.map((s, i) => <div className="muted" key={i}>{s.full_name} — {s.reason}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

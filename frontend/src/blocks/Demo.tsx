// Демо-сайт (backend/demo.py): подсказка «только просмотр», запуск тура при первом входе с
// устройства и плашка «Оставить контакты» после тура. Повторный визит с того же устройства —
// ни тура, ни плашки (флаги хранит сервер по куке устройства).
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api, DEMO_DENIED, messageOf, onDemoDenied } from '../lib/api';
import { useMe } from '../lib/me';
import { useToast } from '../lib/toast';
import { startDemoTour, startTour } from '../tour';
import { tourRunning } from '../tour/engine';
import { Button, Checkbox, Field, Input, Textarea } from '../ui';

type DemoState = { tour_done: boolean; lead_done: boolean };

export function DemoLayer() {
  const { demo, me, isAdmin } = useMe();
  const toast = useToast();
  const [lead, setLead] = useState(false);

  useEffect(() => {
    if (!demo) return;
    onDemoDenied(() => toast.info('Здесь можно всё посмотреть, но не изменить.', DEMO_DENIED));
    return () => onDemoDenied(null);
  }, [demo, toast]);

  useEffect(() => {
    if (!demo || !me) return;
    let timer: number | undefined;
    api.get<DemoState>('/api/demo/state').then((s) => {
      if (!s.tour_done) {
        timer = window.setTimeout(() => {
          if (tourRunning()) return;                 // тур кабинета уже идёт (?tour=1)
          if (isAdmin) startDemoTour(); else startTour();
        }, 900);
      } else if (!s.lead_done) {
        setLead(true);
      }
    }).catch(() => {});
    const onDone = () => api.get<DemoState>('/api/demo/state').then((s) => setLead(!s.lead_done)).catch(() => {});
    window.addEventListener('nm-demo-tour-done', onDone);
    return () => { window.clearTimeout(timer); window.removeEventListener('nm-demo-tour-done', onDone); };
  }, [demo, me?.id, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!demo) return null;
  return (
    <>
      <div className="nm-demo-pill" role="note">Демо-версия · только просмотр</div>
      {lead && <LeadCard onClose={() => setLead(false)} />}
    </>
  );
}

function LeadCard({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', company: '', contact: '', comment: '', consent: false });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const dismiss = () => { api.post('/api/demo/lead', { dismiss: true }).catch(() => {}); onClose(); };
  const send = async () => {
    if (!f.contact.trim()) { toast.warn('Укажите телефон или e-mail'); return; }
    if (!f.consent) { toast.warn('Нужно согласие на обработку персональных данных'); return; }
    setBusy(true);
    try {
      await api.post('/api/demo/lead', f);
      toast.ok('Спасибо! Мы свяжемся с вами.');
      onClose();
    } catch (e) {
      toast.error(messageOf(e));
      setBusy(false);
    }
  };
  return (
    <aside className="nm-lead" aria-label="Оставить контакты">
      <div className="nm-lead-head">
        <b>Понравилось? Оставьте контакты</b>
        <Button variant="ghost" iconOnly size="sm" icon={X} aria-label="Закрыть" onClick={dismiss} />
      </div>
      <p className="nm-small nm-muted">Покажем НейроМастер на ваших документах и ответим на вопросы.</p>
      <Field label="Как к вам обращаться"><Input small value={f.name} onChange={(e) => set('name')(e.target.value)} maxLength={200} /></Field>
      <Field label="Компания"><Input small value={f.company} onChange={(e) => set('company')(e.target.value)} maxLength={200} /></Field>
      <Field label="Телефон или e-mail"><Input small value={f.contact} onChange={(e) => set('contact')(e.target.value)} maxLength={200} /></Field>
      <Field label="Комментарий"><Textarea value={f.comment} onChange={(e) => set('comment')(e.target.value)} maxLength={2000} rows={2} /></Field>
      <Checkbox label="Согласен на обработку персональных данных" checked={f.consent} onChange={set('consent')} />
      <Button variant="primary" block loading={busy} onClick={send}>Отправить</Button>
    </aside>
  );
}

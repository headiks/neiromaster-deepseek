// Подсказка «что дальше»: первый незавершённый шаг пути пользователи → планы → документы →
// сообщения, с кнопкой перехода. Нужна тому, кто видит систему впервые.
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Footprints } from 'lucide-react';
import { api } from '../lib/api';
import { usePolling } from '../lib/poll';
import type { AdminUser, Doc, PlanSummary } from '../lib/types';
import { Button, Callout } from '../ui';

type Step = { to: string; text: string } | null;

export function useNextStep() {
  const [step, setStep] = useState<Step>(null);
  const load = useCallback(async () => {
    try {
      const [p, u, d] = await Promise.all([
        api.get<{ plans: PlanSummary[] }>('/plans'),
        api.get<{ users: AdminUser[] }>('/users'),
        api.get<{ documents: Doc[] }>('/documents'),
      ]);
      const plans = p.plans || [], people = (u.users || []).filter((x) => x.role === 'employee'), docs = d.documents || [];
      const ready = docs.filter((x) => x.status === 'indexed').length;
      let s: Step = null;
      if (!people.length) s = { to: '/admin/users', text: 'Шаг 1 из 4. Добавьте сотрудников: загрузите штатное расписание или добавьте человека вручную.' };
      else if (!plans.length) s = { to: '/admin/plans', text: 'Шаг 2 из 4. Создайте план адаптации: этапы и подэтапы с датами отправки.' };
      else if (!docs.length) s = { to: '/admin/documents', text: 'Шаг 3 из 4. Загрузите документы компании (регламенты, инструкции) — по ним ИИ напишет сообщения и будет отвечать на вопросы.' };
      else if (ready && !plans.some((x) => x.generated)) s = { to: '/admin/messages', text: 'Шаг 4 из 4. Сгенерируйте сообщения плана — кнопка «Обновить сообщения плана».' };
      else if (people.some((x) => !x.plan_id || !x.start_date)) s = { to: '/admin/users', text: 'Осталось: назначьте сотрудникам план и дату выхода («Изменить» у сотрудника) — с даты выхода начнут приходить сообщения.' };
      setStep(s);
    } catch { /* подсказка не критична */ }
  }, []);
  usePolling(load, 20000);
  return { step, reload: load };
}

export function NextStep({ here }: { here: string }) {
  const { step } = useNextStep();
  const navigate = useNavigate();
  if (!step) return null;
  return (
    <div data-tour="next-step">
      <Callout tone="warn" icon={Footprints}
               action={step.to !== here ? <Button size="sm" variant="secondary" icon={ArrowRight} onClick={() => navigate(step.to)}>Перейти</Button> : undefined}>
        {step.text}
      </Callout>
    </div>
  );
}

// ProgressCard: «День 3 из 30», этап, прогресс и что дальше. На сайте — одна строка,
// в мобильной раскладке — карточка в столбик (как в приложении).
import { CalendarClock } from 'lucide-react';
import type { MySchedule } from '@shared/types';
import { ruDate, shortWhen, fromYmd, plural } from '@shared/format';
import type { Progress as P } from '@shared/progress';
import { Card, Progress } from '../ui';

export function ProgressCard({ progress, schedule, missing, stacked }: {
  progress: P | null; schedule: MySchedule | null; missing?: string | null; stacked?: boolean;
}) {
  if (missing) {
    return (
      <Card className={stacked ? 'nm-progress-stack' : 'nm-progress-card'} data-tour="progress">
        <div className="nm-row"><CalendarClock aria-hidden style={{ color: 'var(--nm-muted)' }} />
          <div><b>План адаптации ещё не назначен</b><div className="nm-small nm-muted">{missing} Обратитесь к администратору или наставнику.</div></div>
        </div>
      </Card>
    );
  }
  if (!progress || !schedule) return <div className="nm-skeleton" style={{ minHeight: stacked ? 110 : 74 }} aria-hidden />;
  const start = fromYmd(schedule.start_date);
  const daysLeft = start ? Math.ceil((start.getTime() - Date.now()) / 86400000) : 0;
  const title = !progress.started
    ? (daysLeft > 0 ? `До выхода ${daysLeft} ${plural(daysLeft, 'день', 'дня', 'дней')}` : 'Скоро старт')
    : progress.finished ? 'План пройден' : `День ${progress.day} из ${progress.total}`;
  const next = progress.next ? `Дальше: ${progress.next.substage || progress.next.title} — ${shortWhen(progress.next.at)}` : '';
  const meta = `План «${schedule.plan_title || 'адаптации'}» · выход ${ruDate(schedule.start_date)}`;
  if (stacked) {
    return (
      <Card className="nm-progress-stack" data-tour="progress">
        <div className="nm-row-between"><h2>{title}</h2>{progress.stage && <span className="nm-small nm-muted">{progress.stage}</span>}</div>
        <Progress value={progress.started ? progress.ratio : 0} label="Прогресс плана адаптации" />
        <div className="nm-small nm-muted">{next || meta}</div>
      </Card>
    );
  }
  return (
    <Card className="nm-progress-card" data-tour="progress">
      <h2>{title}</h2>
      <Progress value={progress.started ? progress.ratio : 0} label="Прогресс плана адаптации" />
      <div className="nm-meta">{meta}{progress.stage ? <><br />Сейчас: {progress.stage}</> : null}</div>
    </Card>
  );
}

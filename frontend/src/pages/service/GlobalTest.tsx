// Диагностика: все служебные инструменты в одном месте.
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Database, FlaskConical, HardDrive, LayoutGrid, ListChecks, ScanText, ScrollText, Table2, type LucideIcon } from 'lucide-react';
import { PageHeader } from '../../ui';

const DATA: [string, LucideIcon, string, string][] = [
  ['/documents-table', Table2, 'Реестр документов', 'Таблица метаданных обработанных файлов.'],
  ['/documents-board', LayoutGrid, 'Этапы ↔ документы', 'Какие документы закреплены за этапами и подэтапами.'],
  ['/doc-breakdown', ScanText, 'Разбор документа', 'Блоки, метки этапов и обоснования разметки.'],
  ['/s3', HardDrive, 'Хранилище S3', 'Обозреватель оригиналов документов (только чтение).'],
  ['/plans-db', Database, 'База планов', 'Структура планов и расписаний (JSONB).'],
];
const TOOLS: [string, LucideIcon, string, string][] = [
  ['/notify-test', Bell, 'Тест уведомлений', 'Отправка сообщений пользователю, проверка пушей.'],
  ['/message-test', FlaskConical, 'Тестовые сообщения', 'Сообщения всех типов: чек-лист, опрос, мини-тест.'],
  ['/queue-test', ListChecks, 'Очереди (RQ/Redis)', 'Статус воркеров, длина очереди, тест-задача.'],
  ['/logs', ScrollText, 'Журнал действий', 'Действия пользователей (по отделам / все).'],
];

function Grid({ items }: { items: typeof DATA }) {
  return (
    <div className="nm-grid-3">
      {items.map(([to, Icon, title, text]) => (
        <Link key={to} to={to} className="nm-tool nm-glass"><Icon aria-hidden /><span><b>{title}</b><span>{text}</span></span></Link>
      ))}
    </div>
  );
}

export default function GlobalTest() {
  useEffect(() => { document.title = 'Диагностика · НейроМастер'; }, []);
  return (
    <div className="nm-page">
      <PageHeader title="Диагностика" subtitle="Служебные инструменты: тесты и просмотр внутренних данных. Вынесены сюда, чтобы не мешать основной работе." />
      <div className="nm-section-label">Данные и документы</div>
      <Grid items={DATA} />
      <div className="nm-section-label">Диагностика и тесты</div>
      <Grid items={TOOLS} />
    </div>
  );
}

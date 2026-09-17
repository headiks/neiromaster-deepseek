# НейроМастер — фронтенд (React + Vite + TypeScript)

Полный перепис прежнего `static/*.html` (vanilla JS) на React. Поведение и все
API-вызовы сохранены 1:1; авторизация прежняя — session-cookie (на 401 — переброс на `/login`).

## Запуск (разработка)

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
```

Dev-сервер проксирует API-пути (`/api`, `/ask`, `/documents`, `/folders`, `/plans`,
`/catalog`, `/jobs`, `/chunks`, `/users`, `/questions`, `/staffing`, `/session`, `/sse`)
на FastAPI. Цель по умолчанию `http://localhost:8000`, меняется переменной `NM_API_TARGET`.

## Сборка

```bash
npm run build      # tsc (typecheck) + vite build → dist/
```

## Прод-раздача

Это SPA. Бэкенд/nginx должны:
1. отдавать `index.html` для клиентских маршрутов (`/`, `/admin`, `/login`, `/register`,
   `/setup`, `/logs`, `/plans-db`, `/queue-test`, `/s3`, `/documents-table`,
   `/documents-board`, `/doc-breakdown`, `/notify-test`) — SPA-fallback;
2. проксировать API-пути (см. выше) на приложение.

## Структура

```
src/
  main.tsx, App.tsx            точка входа + роутинг
  styles/                      app.css + admin.css (перенесены как есть) + pages.css
  lib/       api, useMe, jobs (поллинг), notify, activity, types
  components/ Header, PasswordDialog, Logo, Combobox, Dropzone
  pages/     Login, Register, Setup, Employee, Admin, Logs, PlansDb,
             QueueTest, S3Browser, DocumentsTable, DocumentsBoard, DocBreakdown, NotifyTest
  pages/admin/ Staffing, PlanBuilder, PlanTexts, Knowledge, Questions, Accounts
```

## Заметки по дизайну

- Основные экраны (вход, кабинет, админка) сохраняют дизайн-систему Industry —
  `app.css`/`admin.css` перенесены дословно, стили не переписаны.
- Иконки — `lucide-react` вместо UMD-скрипта Lucide + MutationObserver.
- Вспомогательные страницы (журнал, база планов, реестр/доска документов, разбор,
  S3, очереди, тест уведомлений) в оригинале имели ОТДЕЛЬНУЮ тёмную тему (Manrope).
  Здесь они унифицированы под дизайн-систему проекта (app.css) — так консистентнее и
  без конфликтов глобальных стилей; вся логика и API сохранены.
```

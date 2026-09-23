# Промт: коммит → GitHub → деплой на сервер

Вставь этот блок как задачу ассистенту. Он описывает готовый воркфлоу выката НейроМастера.

---

## Задача

Закоммить текущие изменения, влей в `master`, запушь на GitHub и задеплой на прод-сервер.

## Контекст (факты проекта — не выдумывать)

- **Репозиторий:** git, ветка разработки `feature/push-notifications`, основная `master`.
- **Прод-сервер:** `89.223.68.9`, пользователь `deploy`, доступ по ключу `~/.ssh/neiro_deploy` (пароль root не использовать — только ключ).
- **Путь приложения на сервере:** `/home/deploy/neiromaster-ds`.
- **Сервисы (systemd):** `rag-app` (gunicorn+uvicorn), `rag-worker@N` (RQ). Sudo у `deploy` — через NOPASSWD.
- **Домен/HTTPS:** `smarta-office.ru` (Caddy → 127.0.0.1:8000, Let's Encrypt авто).
- **Статика (`static/*.html`, `static/*.js`, `static/*.css`)** читается с диска на каждый запрос → **рестарт не нужен**, только `git pull`.
- **Python-код (`*.py`)** → нужен `sudo systemctl restart rag-app`.
- **Провайдер троттлит частые SSH-подключения** (banner timeout / reset) → все SSH-команды в retry-цикле с паузой.

## Шаги

### 1. Коммит + мердж + пуш (локально)

**Стейджить явными путями, а НЕ `git add -A`.** `git add -A` сметёт в коммит и файлы,
которые агент создал сам (черновики, промты, заметки в `docs/`, временные скрипты), и
чужие незакоммиченные правки — они уедут в репо без спроса. Сначала `git status`, затем
добавлять только те пути, что относятся к задаче.

```bash
git status                              # посмотреть, что изменилось
git add <путь1> <путь2> ...             # только файлы задачи; НЕ "git add -A"
git commit -m "<суть изменения>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git checkout master
git merge --no-ff feature/push-notifications -m "Merge: <суть>"
git push origin master feature/push-notifications
```

Правила стейджинга:
- Файлы, которые агент сгенерировал для пользователя (промты, планы, доки), коммитить
  **только по явной просьбе** — отдельным коммитом, не подмешивая к правкам кода.
- Секреты/ключи (DeepSeek, S3, пароли, `.env`) не коммитить никогда.
- Сообщение коммита — по-русски, по сути.

### 2. Деплой на сервер (retry-цикл)
```bash
# backend менялся (*.py) → с рестартом:
until ssh -i ~/.ssh/neiro_deploy -o StrictHostKeyChecking=no -o ConnectTimeout=20 \
  deploy@89.223.68.9 'cd ~/neiromaster-ds && git fetch origin -q && \
  git reset --hard origin/master -q && git log --oneline -1 && \
  sudo systemctl restart rag-app && sleep 3 && systemctl is-active rag-app'; \
do echo "retry..."; sleep 15; done
```
```bash
# только статика (html/js/css) → без рестарта:
until ssh -i ~/.ssh/neiro_deploy -o StrictHostKeyChecking=no -o ConnectTimeout=20 \
  deploy@89.223.68.9 'cd ~/neiromaster-ds && git fetch origin -q && \
  git reset --hard origin/master -q && git log --oneline -1'; \
do echo "retry..."; sleep 15; done
```

### 3. Проверка live
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://smarta-office.ru/      # ждём 200/303
curl -s https://smarta-office.ru/static/admin.js | grep -c "<маркер новой правки>"
```
Маркер — любая уникальная строка из свежего изменения (класс, функция, id).

## Правила

- Рестарт `rag-app` — **только** если менялся Python. Статика — без рестарта.
- Все SSH — в `until … do sleep 15; done` (троттлинг провайдера).
- После деплоя обязательно проверить код ответа сайта и наличие маркера в live-файле.
- Не логировать и не коммитить секреты (DeepSeek/S3-ключи, пароли).
- `git reset --hard origin/master` на сервере безопасен: сервер — зеркало origin, локальных правок там нет.

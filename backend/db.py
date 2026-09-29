"""
Хранилище на PostgreSQL — единая база структурированных данных приложения
(аккаунты; далее сюда же переносятся вопросы, реестр документов, планы).

Почему PostgreSQL:
  - рассчитан на большое число пользователей и одновременных подключений
    (несколько uvicorn-воркеров / серверов приложения работают с одной БД);
  - ACID-транзакции, честные типы (BOOLEAN, TIMESTAMP), внешние ключи, индексы;
  - пул соединений (psycopg_pool) держит подключения открытыми — не платим за
    установку соединения на каждый запрос.

Подключение — через DSN из окружения. По умолчанию — локальный Postgres:
    postgresql://neiromaster:neiromaster@localhost:5432/neiromaster
Переопределяется переменной NEIROMASTER_DB_DSN (или DATABASE_URL).

Схема идемпотентна (CREATE TABLE IF NOT EXISTS) — init_schema() безопасно звать при
каждом старте.
"""

import os
import re
import threading
import contextlib
import contextvars
import functools

from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row

DSN = (
    os.environ.get("NEIROMASTER_DB_DSN")
    or os.environ.get("DATABASE_URL")
    or "postgresql://neiromaster:neiromaster@localhost:5432/neiromaster"
)

# Верхняя граница пула. Для многих пользователей упирается не в число людей, а в
# число одновременных запросов; при нескольких воркерах учитывайте суммарный лимит
# max_connections у Postgres. Настраивается переменной NEIROMASTER_DB_POOL.
import sizing  # noqa: E402 — по железу; NEIROMASTER_DB_POOL в окружении главнее
POOL_MAX = sizing.db_pool()

_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()

# --- Мультитенантность «схема на компанию» ---
# У каждой компании своя схема cab_<slug> со всеми таблицами; в public — суперадмин,
# реестр компаний и справочник логинов (provisioning.py). Текущая схема — ContextVar:
# middleware выставляет её на запрос по токену сессии, и она сама переходит в пул
# потоков FastAPI (anyio копирует контекст). Свои потоки и задачи очереди переносят её
# явно — bind_schema / jobs.py. Без схемы всё идёт в public, как раньше.
# search_path компании — ТОЛЬКО её схема: без «провала» в public, иначе таблица, которой
# нет в схеме компании, молча читалась бы из общей. Общие таблицы — явно через public.
# ponytail: SET search_path на каждый вызов query/execute; станет узким местом —
# pool reset-hook или пул на схему.
_schema: contextvars.ContextVar = contextvars.ContextVar("nm_schema", default=None)
_SCHEMA_RE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")   # валидное и безопасное имя схемы


def _checked(name: str) -> str:
    if not _SCHEMA_RE.match(name or ""):
        raise ValueError(f"Недопустимое имя схемы: {name!r}")
    return name


@contextlib.contextmanager
def use_schema(name: str):
    """В пределах блока все query/execute/init_schema идут в указанную схему."""
    token = _schema.set(_checked(name))
    try:
        yield
    finally:
        _schema.reset(token)


def set_schema(name: str | None):
    """Схема до конца текущего контекста (запрос целиком): middleware и вход по логину."""
    _schema.set(_checked(name) if name else None)


def current_schema() -> str | None:
    """Схема компании текущего запроса/задачи; None — общая (public)."""
    return _schema.get()


def bind_schema(fn):
    """fn, которая выполнится в схеме текущей компании, — для своих потоков и пулов:
    обычный threading.Thread / ThreadPoolExecutor контекст не наследует."""
    schema = _schema.get()
    if not schema:
        return fn

    @functools.wraps(fn)
    def run(*args, **kwargs):
        with use_schema(schema):
            return fn(*args, **kwargs)
    return run


def _apply_schema(conn):
    """Выставить search_path соединения под текущую схему (или public по умолчанию)."""
    schema = _schema.get()
    conn.execute(f'SET search_path TO "{schema}"' if schema else "SET search_path TO public")

# Общие таблицы — всегда в public (имена с явной схемой): реестр компаний и справочник
# «логин -> схема компании» для входа по одному адресу (см. provisioning.py). Создаются при
# любом init_schema, чтобы проверка уникальности логина работала и в скриптах, и в тестах.
PUBLIC_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS public.cabinets (
        slug        TEXT PRIMARY KEY,
        schema_name TEXT UNIQUE NOT NULL,
        company     TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS public.logins (
        username    TEXT PRIMARY KEY,
        schema_name TEXT NOT NULL,
        user_id     TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_logins_user ON public.logins(schema_name, user_id)",
    # Пул ключей DeepSeek (llmkeys.py): суперадмин добавляет на /globaltest, вызовы берут свободный.
    """
    CREATE TABLE IF NOT EXISTS public.llm_keys (
        id             SERIAL PRIMARY KEY,
        label          TEXT NOT NULL DEFAULT '',
        key_enc        TEXT NOT NULL,
        tail           TEXT NOT NULL DEFAULT '',
        active         BOOLEAN NOT NULL DEFAULT TRUE,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at   TIMESTAMPTZ,
        calls          BIGINT NOT NULL DEFAULT 0,
        last_error     TEXT,
        disabled_until TIMESTAMPTZ
    )
    """,
    # Заявки с демо-сайта («оставить контакты»), раздел суперадмина «Заявки» (leads.py).
    """
    CREATE TABLE IF NOT EXISTS public.leads (
        id          TEXT PRIMARY KEY,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        name        TEXT NOT NULL DEFAULT '',
        company     TEXT NOT NULL DEFAULT '',
        contact     TEXT NOT NULL DEFAULT '',
        comment     TEXT NOT NULL DEFAULT '',
        source      TEXT NOT NULL DEFAULT 'demo',
        status      TEXT NOT NULL DEFAULT 'new',
        handled_at  TIMESTAMPTZ
    )
    """,
)

SCHEMA_STATEMENTS = (
    """
    CREATE TABLE IF NOT EXISTS users (
        id                       TEXT PRIMARY KEY,
        username                 TEXT UNIQUE,
        full_name                TEXT    NOT NULL DEFAULT '',
        role                     TEXT    NOT NULL DEFAULT 'employee',
        active                   BOOLEAN NOT NULL DEFAULT TRUE,
        salt                     TEXT,
        hash                     TEXT,
        must_change_credentials  BOOLEAN NOT NULL DEFAULT FALSE,
        created_at               TEXT,
        updated_at               TEXT,
        password_changed_at      TEXT,
        position                 TEXT DEFAULT '',
        department               TEXT DEFAULT '',
        contact                  TEXT DEFAULT '',
        mentor                   TEXT DEFAULT '',
        manager                  TEXT DEFAULT '',
        plan_id                  TEXT,
        plan_profession          TEXT NOT NULL DEFAULT '',
        start_date               TEXT,
        status                   TEXT DEFAULT 'planned',
        notes                    TEXT DEFAULT '',
        created_by               TEXT
    )
    """,
    # Для БД, созданных до появления поля «план по профессии» — добавляем колонку идемпотентно.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_profession TEXT NOT NULL DEFAULT ''",
    # Раздельные контакты и временный пароль до первого входа (см. users._blank_user).
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password TEXT DEFAULT ''",
    # Больничные: [{"start": ISO UTC, "end": ISO UTC | null}] — по ним расписание сдвигается,
    # и план после выхода продолжается с того места, где сотрудник остановился.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS pauses TEXT NOT NULL DEFAULT '[]'",
    # Пароль сотрудника меняет только администратор: флага «сменить при входе» у
    # сотрудников нет. Раньше он стоял у всех из штатки и блокировал /api/my/* (403) —
    # приложение не получало сообщений и не регистрировало push-токен.
    "UPDATE users SET must_change_credentials = FALSE WHERE role = 'employee' AND must_change_credentials",
    "CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)",
    "CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role)",
    # Сессии входа. В БД, а не в памяти процесса: переживают перезапуск приложения
    # (пользователей не разлогинивает) и общие для всех uvicorn-воркеров.
    """
    CREATE TABLE IF NOT EXISTS sessions (
        token       TEXT PRIMARY KEY,
        user_id     TEXT             NOT NULL,
        created_at  DOUBLE PRECISION NOT NULL,
        seen_at     DOUBLE PRECISION NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
    # Смысловые папки — логические категории базы знаний, которыми управляет
    # ТОЛЬКО человек (ИИ классифицирует документы внутрь, но не создаёт папки).
    # Папка не хранит файлов: criteria — набор смысловых критериев отнесения,
    # stage_ids — связанные этапы обучения. Оба поля JSONB-массивы строк.
    """
    CREATE TABLE IF NOT EXISTS folders (
        id          TEXT PRIMARY KEY,
        slug        TEXT UNIQUE NOT NULL,
        name        TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        criteria    JSONB   NOT NULL DEFAULT '[]',
        stage_ids   JSONB   NOT NULL DEFAULT '[]',
        enabled     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TEXT,
        updated_at  TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_folders_enabled ON folders(enabled)",
    # Этапы обучения (блоки) — «структура обучения» из ТЗ. Задаёт контекст текущего
    # этапа пользователя и цель для связей папок (folders.stage_ids). Подэтапы вынесены
    # в отдельную таблицу substages (связь по stage_id), а не JSONB внутри строки.
    """
    CREATE TABLE IF NOT EXISTS stages (
        id          TEXT PRIMARY KEY,
        title       TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        position    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT,
        updated_at  TEXT
    )
    """,
    # Подэтапы этапа. Отдельная таблица (а не JSONB в stages): на подэтап по id
    # ссылаются documents.substages и планировщик, поэтому нужен стабильный PK и FK.
    # ON DELETE CASCADE — удаление этапа уносит его подэтапы (как было при JSONB).
    """
    CREATE TABLE IF NOT EXISTS substages (
        id          TEXT PRIMARY KEY,
        stage_id    TEXT    NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
        title       TEXT    NOT NULL,
        position    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT,
        updated_at  TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_substages_stage ON substages(stage_id, position)",
    # Материализованные сообщения расписания = инбокс сотрудника + статус доставки.
    # Считать расписание на лету дёшево, но чтобы доставлять по времени и не слать
    # дважды, нужна персистентная строка на сообщение. id = <employee_id>:<message_id>
    # (идемпотентно при повторной материализации). send_at — абсолютный момент (UTC),
    # локализованный из времени плана. status: pending|delivered|read|failed|canceled.
    """
    CREATE TABLE IF NOT EXISTS scheduled_messages (
        id           TEXT PRIMARY KEY,
        employee_id  TEXT        NOT NULL,
        plan_id      TEXT,
        message_id   TEXT        NOT NULL,
        stage_id     TEXT,
        substage_id  TEXT,
        title        TEXT        NOT NULL DEFAULT '',
        body         TEXT        NOT NULL DEFAULT '',
        send_at      TIMESTAMPTZ NOT NULL,
        status       TEXT        NOT NULL DEFAULT 'pending',
        delivered_at TIMESTAMPTZ,
        read_at      TIMESTAMPTZ,
        error        TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_sched_due ON scheduled_messages(status, send_at)",
    "CREATE INDEX IF NOT EXISTS idx_sched_emp ON scheduled_messages(employee_id, send_at)",
    # Тип сообщения (message/checklist/survey/quiz/…), его структура для показа
    # (msgconvert: пункты чек-листа, вопросы теста/опроса) и ответы сотрудника.
    "ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'message'",
    "ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS payload JSONB",
    "ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS answers JSONB",
    # Вовлечённость (stats.py): первый показ на экране и суммарное время на экране, мс.
    "ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS first_view_at TIMESTAMPTZ",
    "ALTER TABLE scheduled_messages ADD COLUMN IF NOT EXISTS view_ms INT NOT NULL DEFAULT 0",
    # Push-токены устройств сотрудника (Expo Push): одно устройство = один токен.
    # По ним шлём пуш при доставке сообщения плана. token — PK (при переустановке
    # приложения приходит новый; старый протухнет и будет вычищен по ответу Expo).
    """
    CREATE TABLE IF NOT EXISTS push_tokens (
        token       TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        platform    TEXT NOT NULL DEFAULT '',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id)",
    # Журнал действий пользователей: вход/выход, просмотры страниц, клики, ключевые
    # действия. detail — произвольные подробности события (id элемента, имя файла и т.п.).
    """
    CREATE TABLE IF NOT EXISTS activity_log (
        id         BIGSERIAL PRIMARY KEY,
        ts         TIMESTAMPTZ NOT NULL DEFAULT now(),
        user_id    TEXT,
        username   TEXT,
        role       TEXT,
        event_type TEXT        NOT NULL,
        path       TEXT,
        detail     JSONB       NOT NULL DEFAULT '{}',
        ip         TEXT,
        user_agent TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_activity_ts   ON activity_log(ts DESC)",
    "CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id, ts DESC)",
    "CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_log(event_type, ts DESC)",
    # Планы адаптации. Раньше лежали файлами (data/plans/<id>/plan.json). Теперь — в БД
    # как JSONB: один канонический план (структура этапов/подэтапов) на строку.
    """
    CREATE TABLE IF NOT EXISTS plans (
        plan_id    TEXT PRIMARY KEY,
        data       JSONB NOT NULL,
        updated_at TEXT
    )
    """,
    # Сгенерированные расписания плана. Один план — много расписаний: по одному на
    # профессию/разряд (profession = полная строка должности, разряд внутри неё).
    # profession='' — общее расписание (фолбэк для не перечисленных должностей).
    """
    CREATE TABLE IF NOT EXISTS plan_schedules (
        plan_id    TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
        profession TEXT NOT NULL DEFAULT '',
        data       JSONB NOT NULL,
        updated_at TEXT,
        PRIMARY KEY (plan_id, profession)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_plan_sched_plan ON plan_schedules(plan_id)",
    # Простые настройки приложения (ключ-значение). Напр. default_plan_id — активный
    # общий план, который автоматически назначается сотрудникам по их должности.
    """
    CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT
    )
    """,
)


def _get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = ConnectionPool(
                    DSN, min_size=1, max_size=POOL_MAX,
                    kwargs={"row_factory": dict_row}, open=True,
                )
    return _pool


def configure(dsn: str):
    """Переключить БД (используется в тестах). Закрывает прежний пул."""
    global _pool, DSN
    with _pool_lock:
        if _pool is not None:
            _pool.close()
            _pool = None
        DSN = dsn


@contextlib.contextmanager
def startup_lock():
    """Старт приложения по одному процессу: воркеры gunicorn поднимаются одновременно, и
    параллельные CREATE TABLE/INDEX IF NOT EXISTS падают на pg_class (UniqueViolation) —
    воркер не загружается. Блокировка сессионная, снимается и при обрыве соединения."""
    import psycopg
    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute("SELECT pg_advisory_lock(hashtext('neiromaster.startup'))")
        yield


def init_schema():
    """Создаёт таблицы и индексы, если их ещё нет (в текущей схеме, см. use_schema)."""
    with _get_pool().connection() as conn:
        _apply_schema(conn)
        for stmt in (*PUBLIC_STATEMENTS, *SCHEMA_STATEMENTS):
            conn.execute(stmt)
    _migrate_substages_from_jsonb()


def _migrate_substages_from_jsonb():
    """Однократный перенос подэтапов из старой колонки stages.substages (JSONB) в
    таблицу substages. Идемпотентно: как только колонка удалена — ничего не делает.
    Ограничен ТЕКУЩЕЙ схемой (current_schema) — важно для мультитенантности."""
    with _get_pool().connection() as conn:
        _apply_schema(conn)
        has_col = conn.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = current_schema() "
            "AND table_name = 'stages' AND column_name = 'substages'"
        ).fetchone()
        if not has_col:
            return
        for r in conn.execute("SELECT id, substages FROM stages").fetchall():
            for pos, s in enumerate(r["substages"] or []):
                if not isinstance(s, dict) or not s.get("id"):
                    continue
                conn.execute(
                    "INSERT INTO substages (id, stage_id, title, position, created_at, updated_at) "
                    "VALUES (%s, %s, %s, %s, now()::text, now()::text) ON CONFLICT (id) DO NOTHING",
                    (s["id"], r["id"], s.get("title", ""), pos),
                )
        conn.execute("ALTER TABLE stages DROP COLUMN substages")


def query(sql: str, params: tuple = (), fetch: str = "all"):
    """SELECT-запрос. fetch: 'all' -> список строк, 'one' -> одна строка/None."""
    with _get_pool().connection() as conn:
        _apply_schema(conn)
        cur = conn.execute(sql, params)
        if fetch == "one":
            return cur.fetchone()
        if fetch == "all":
            return cur.fetchall()
        return None


def execute(sql: str, params: tuple = ()):
    """INSERT/UPDATE/DELETE. Коммит — при выходе из контекста соединения."""
    with _get_pool().connection() as conn:
        _apply_schema(conn)
        conn.execute(sql, params)

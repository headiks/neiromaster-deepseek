"""
provisioning.py — компании (мультитенантность «схема на компанию»).

Каждая компания — своя PostgreSQL-схема cab_<slug> с полным набором таблиц: сотрудники,
кураторы, документы, планы, сообщения, вопросы, журнал. В public — только общее:
    public.cabinets — реестр компаний;
    public.logins   — справочник «логин -> схема компании»: вход по одному адресу, логины
                      уникальны во всей системе;
    суперадмин (и данные, заведённые до разделения на компании).

Вне БД компании разделены так же: файлы — data/documents/<схема>/ (config.docs_dir), ключи
S3 и raw-БД — с префиксом схемы (storage), кэш ответов и блокировки в Redis — с суффиксом
схемы (tenant_key), задачи очереди выполняются в схеме поставившей их компании (jobs.py).

    python provisioning.py <slug> --company "ООО Ромашка" [--admin "Иванов Иван"]
    python provisioning.py --list
"""
import json
import re
import sys
import threading
import time
from pathlib import Path

import config
import db

BASE_DIR = Path(__file__).resolve().parents[1]   # корень проекта (код — в backend/)

SCHEMA_PREFIX = "cab_"
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_]{0,40}$")



def schema_for(slug: str) -> str:
    """slug компании -> имя схемы. Валидирует slug (латиница/цифры/подчёркивание)."""
    slug = (slug or "").strip().lower()
    if not _SLUG_RE.match(slug):
        raise ValueError("Код компании: латиница, цифры и подчёркивание, начинается с буквы или цифры")
    return f"{SCHEMA_PREFIX}{slug}"


def s3_prefix_for(slug: str) -> str:
    """Префикс компании в бакете: cab_<slug>/<глобальный S3_PREFIX>."""
    return f"{schema_for(slug)}/{config.S3_PREFIX}"


def slug_from(name: str) -> str:
    """Код компании из названия: «ООО Ромашка» -> «ooo_romashka» (без кавычек и знаков)."""
    from staffing import _translit
    words = [_translit(w) for w in re.split(r"[\s\-]+", name or "")]
    slug = "_".join(w for w in words if w)[:40].strip("_")
    return slug or f"c{int(time.time())}"


def ensure_registry():
    """Реестр компаний и справочник логинов (DDL — db.PUBLIC_STATEMENTS)."""
    for stmt in db.PUBLIC_STATEMENTS:
        db.execute(stmt)


# ---------- Реестр компаний (кэш) ----------
_cache = {"at": 0.0, "schemas": frozenset()}
_cache_lock = threading.Lock()


def schemas(fresh: bool = False, max_age: float = 30) -> list:
    """Схемы всех компаний. Кэш на процесс — проверка токена идёт на каждый запрос."""
    with _cache_lock:
        if fresh or time.time() - _cache["at"] > max_age:
            try:
                rows = db.query("SELECT schema_name FROM public.cabinets ORDER BY created_at") or []
            except Exception:
                rows = []                         # реестра ещё нет — компаний нет
            _cache["schemas"] = frozenset(r["schema_name"] for r in rows)
            _cache["at"] = time.time()
        return sorted(_cache["schemas"])


def is_company(schema: str) -> bool:
    """Незнакомая схема — перечитать реестр (компанию могли создать в другом процессе), но
    не чаще раза в 5 с: иначе токены с выдуманным префиксом дёргали бы БД на каждый запрос."""
    return bool(schema) and (schema in schemas() or schema in schemas(max_age=5))


def list_companies() -> list:
    ensure_registry()
    return db.query("SELECT slug, schema_name, company, created_at FROM public.cabinets "
                    "ORDER BY created_at") or []


def company_name(schema: str) -> str:
    row = db.query("SELECT company FROM public.cabinets WHERE schema_name = %s", (schema,), "one")
    return (row or {}).get("company") or ""


def tenant_key(name: str) -> str:
    """Ключ Redis/кэша, свой у каждой компании: общие имена не пересекаются между ними."""
    schema = db.current_schema()
    return f"{name}:{schema}" if schema else name


# ---------- Справочник логинов ----------
def schema_of_login(username: str):
    """Схема компании, где заведён логин; None — общая (суперадмин, старые данные)."""
    try:
        row = db.query("SELECT schema_name FROM public.logins WHERE username = %s", (username,), "one")
    except Exception:
        return None
    return row["schema_name"] if row else None


def login_taken_elsewhere(username: str, user_id=None) -> bool:
    """Логин занят в другой компании или в общей схеме (логины уникальны во всей системе)."""
    schema = db.current_schema()
    row = db.query("SELECT 1 FROM public.logins WHERE username = %s "
                   "AND NOT (schema_name = %s AND user_id = %s)",
                   (username, schema or "", user_id or ""), "one")
    if row:
        return True
    if schema:     # из компании общая таблица users не видна — проверяем явно
        return db.query("SELECT 1 FROM public.users WHERE username = %s", (username,), "one") is not None
    return False


def taken_logins() -> set:
    """Все логины системы — для генерации нового уникального логина."""
    rows = db.query("SELECT username FROM public.logins UNION SELECT username FROM public.users "
                    "WHERE username IS NOT NULL") or []
    return {r["username"] for r in rows}


def sync_login(user: dict):
    """Запись пользователя компании изменилась — справочник логинов следом."""
    schema = db.current_schema()
    if not schema:
        return
    db.execute("DELETE FROM public.logins WHERE schema_name = %s AND user_id = %s", (schema, user["id"]))
    if user.get("username"):
        db.execute("INSERT INTO public.logins (username, schema_name, user_id) VALUES (%s, %s, %s)",
                   (user["username"], schema, user["id"]))


def drop_login(user_id: str):
    schema = db.current_schema()
    if schema:
        db.execute("DELETE FROM public.logins WHERE schema_name = %s AND user_id = %s", (schema, user_id))


# ---------- Таблицы компании ----------
def init_tables():
    """Все таблицы и стартовая структура в ТЕКУЩЕЙ схеме. Идемпотентно: при старте
    приложения прогоняется по всем компаниям — так до них доезжают новые миграции."""
    import docregistry
    import documents
    import folders
    import qacache
    import questions
    import stages
    db.init_schema()
    docregistry.init()
    questions.init()
    qacache.init()
    documents.init()
    try:
        import docpipe
        docpipe.init_schema()
        docpipe.sync_plan_from_catalog()
    except Exception as e:
        print(f"[warn] docpipe в {db.current_schema() or 'public'}: {e}")
    seed_path = BASE_DIR / "data" / "knowledge_seed.json"
    if seed_path.exists():
        seed = json.loads(seed_path.read_text(encoding="utf-8"))
        stages.seed_if_empty(seed.get("stages", []))
        folders.seed_if_empty(seed.get("folders", []))


def _provision_s3(slug: str):
    """Маркер префикса компании в бакете. No-op без S3; сбой не мешает созданию компании —
    префикс появится с первым оригиналом."""
    if not config.S3_ENABLED:
        return
    try:
        import storage
        storage._s3().put_object(Bucket=config.S3_BUCKET, Key=f"{s3_prefix_for(slug)}.keep", Body=b"")
    except Exception as e:
        print(f"[warn] S3-префикс компании {slug}: {e}")


def create_company(company: str, slug: str = "", admin_full_name: str = "") -> dict:
    """Компания = схема со всеми таблицами + её администратор (один на компанию).
    Возвращает логин и временный пароль администратора — показать один раз."""
    import staffing
    import users
    company = (company or "").strip()
    if not company:
        raise ValueError("Укажите название компании")
    slug = (slug or "").strip().lower() or slug_from(company)
    schema = schema_for(slug)
    ensure_registry()
    if db.query("SELECT 1 FROM public.cabinets WHERE slug = %s OR schema_name = %s",
                (slug, schema), "one") or \
            db.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = %s", (schema,), "one"):
        raise ValueError(f"Компания с кодом «{slug}» уже есть")

    db.execute(f'CREATE SCHEMA "{schema}"')
    try:
        with db.use_schema(schema):
            init_tables()
            full_name = (admin_full_name or "").strip() or f"Администратор {company}"
            password = staffing.temp_password()
            admin = users.create_user(
                {"full_name": full_name, "username": f"admin_{slug}"[:40], "password": password},
                role=users.ROLE_ADMIN, must_change_credentials=True)
        db.execute("INSERT INTO public.cabinets (slug, schema_name, company, created_at) "
                   "VALUES (%s, %s, %s, %s)", (slug, schema, company, time.strftime("%Y-%m-%dT%H:%M:%S")))
    except Exception:
        # Не оставляем полусозданную компанию: схему и её логины — обратно.
        db.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        db.execute("DELETE FROM public.logins WHERE schema_name = %s", (schema,))
        raise
    schemas(fresh=True)
    _provision_s3(slug)
    return {"slug": slug, "schema": schema, "company": company,
            "admin": {"id": admin["id"], "full_name": admin["full_name"],
                      "username": admin["username"], "password": password}}


def _main(argv):
    if "--list" in argv:
        rows = list_companies()
        if not rows:
            print("Компаний пока нет.")
        for r in rows:
            print(f"  {r['slug']:<20} {r['schema_name']:<24} {r['company']}  ({r['created_at']})")
        return
    args = [a for a in argv if not a.startswith("--")]
    opt = lambda k: argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else ""  # noqa: E731
    company = opt("--company")
    slug = args[0] if args and args[0] not in (company, opt("--admin")) else ""
    if not company:
        print(__doc__)
        return
    r = create_company(company, slug=slug, admin_full_name=opt("--admin"))
    print(f"Компания создана: {r['company']} (схема {r['schema']})")
    print(f"  Администратор: {r['admin']['username']}  пароль: {r['admin']['password']}")


if __name__ == "__main__":
    ensure_registry()
    _main(sys.argv[1:])

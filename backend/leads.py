"""
leads.py — заявки посетителей демо-сайта («Оставить контакты»), раздел суперадмина «Заявки».

Таблица public.leads — в ОСНОВНОЙ базе (DDL — db.PUBLIC_STATEMENTS). Демо-экземпляр живёт
в своей PostgreSQL и пишет сюда отдельным подключением NEIROMASTER_LEADS_DSN под ролью
leads_writer: у неё только INSERT на public.leads — ни прочитать заявки, ни дотянуться до
данных компаний она не может. Роль заводит основной web при старте, если задан
LEADS_DB_PASSWORD (ensure_writer). Без NEIROMASTER_LEADS_DSN демо пишет в свою базу.

ponytail: контакты хранятся открытым текстом (человек сам оставил их для связи, с согласием);
шифровать на демо ключом основной базы нельзя — ключа там нет. Нужно — асимметричный ключ.
"""
import os
import uuid

import db

MAX = {"name": 200, "company": 200, "contact": 200, "comment": 2000}
_INSERT = ("INSERT INTO public.leads (id, name, company, contact, comment, source) "
           "VALUES (%s, %s, %s, %s, %s, %s)")


def save(lead: dict, source: str = "demo") -> str:
    lid = str(uuid.uuid4())
    params = (lid, *(str(lead.get(k) or "").strip()[:n] for k, n in MAX.items()), source)
    dsn = os.environ.get("NEIROMASTER_LEADS_DSN", "").strip()
    if dsn:
        try:
            import psycopg
            with psycopg.connect(dsn, connect_timeout=5, autocommit=True) as conn:
                conn.execute(_INSERT, params)
            return lid
        except Exception as e:          # основная база недоступна — заявка не теряется
            print(f"[leads] основная база недоступна, заявка сохранена в демо: {e}")
    db.execute(_INSERT, params)
    return lid


def list_all(limit: int = 500) -> list:
    rows = db.query("SELECT * FROM public.leads ORDER BY created_at DESC LIMIT %s", (limit,)) or []
    return [{**r, "created_at": str(r["created_at"]), "handled_at": str(r["handled_at"] or "")} for r in rows]


def count_new() -> int:
    return (db.query("SELECT count(*) AS n FROM public.leads WHERE status = 'new'", (), "one") or {}).get("n", 0)


def set_status(lead_id: str, status: str) -> bool:
    if status not in ("new", "done"):
        raise ValueError("status: new или done")
    rows = db.query("UPDATE public.leads SET status = %s, handled_at = CASE WHEN %s = 'done' "
                    "THEN now() END WHERE id = %s RETURNING id", (status, status, lead_id))
    return bool(rows)


def ensure_writer() -> bool:
    """Роль leads_writer (только INSERT на public.leads) для демо-экземпляра."""
    password = os.environ.get("LEADS_DB_PASSWORD", "").strip()
    if not password:
        return False
    from psycopg import sql
    exists = db.query("SELECT 1 FROM pg_roles WHERE rolname = 'leads_writer'", (), "one")
    verb = "ALTER" if exists else "CREATE"
    db.execute(sql.SQL(verb + " ROLE leads_writer LOGIN PASSWORD {}").format(sql.Literal(password)))
    db.execute("GRANT USAGE ON SCHEMA public TO leads_writer")
    db.execute("REVOKE ALL ON public.leads FROM leads_writer")
    db.execute("GRANT INSERT ON public.leads TO leads_writer")
    return True

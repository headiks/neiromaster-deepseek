"""
demo.py — демо-экземпляр для показа клиентам: своя PostgreSQL и свой сайт (web-demo в
docker-compose.yml), к данным клиентов доступа нет.

NEIROMASTER_DEMO=1 включает:
  - при старте — «Демо-компания» с постоянными учётками (админ, куратор, сотрудник) и
    предзагруженными документами из data/demo/ и examples/ (разбор — в worker-demo);
  - быстрые уведомления: после назначения плана первые NEIROMASTER_DEMO_MESSAGES (5) сообщений
    приходят каждые NEIROMASTER_DEMO_INTERVAL (30) секунд, а не по дням плана;
  - учётки демо на странице входа (/api/config).

Сброс демо в исходное состояние (всё, что создали посетители, удаляется):
    docker compose exec web-demo python backend/demo.py reset
"""
import os
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import config  # noqa: F401 — первым: .env до подключения к БД
import db

BASE_DIR = Path(__file__).resolve().parents[1]
SLUG = "demo"
COMPANY = "Демо-компания"
DEPARTMENT = "Производство"
# (роль, логин, ФИО)
ACCOUNTS = (("admin", "demo", "Демо Администратор"),
            ("curator", "demo-curator", "Демо Куратор"),
            ("employee", "demo-employee", "Демо Сотрудник"))
DOCS_DIRS = (BASE_DIR / "data" / "demo", BASE_DIR / "examples")
DOC_EXT = {".pdf", ".docx", ".doc", ".pptx", ".html", ".htm", ".md", ".txt"}


def enabled() -> bool:
    return os.environ.get("NEIROMASTER_DEMO", "").lower() in ("1", "true", "yes")


def password() -> str:
    return os.environ.get("NEIROMASTER_DEMO_PASSWORD") or "demo12345"


def protected(user: dict | None) -> bool:
    """Общая демо-учётка: её нельзя удалить, заблокировать, сменить ей роль или пароль —
    иначе один посетитель сломает демо остальным."""
    return enabled() and bool(user) and user.get("username") in {a[1] for a in ACCOUNTS}


def accounts() -> list:
    """Учётки для страницы входа демо (пароль общий — это витрина, не данные клиентов)."""
    if not enabled():
        return []
    return [{"role": role, "username": login, "password": password()} for role, login, _ in ACCOUNTS]


# ---------- Быстрые уведомления ----------
def compress(rows: list) -> list:
    """Первые N сообщений плана — «сейчас + интервал·i» вместо дат плана: посетитель видит
    уведомления за пару минут. Остальные идут за ними с теми же промежутками, что в плане
    (и не раньше своей даты в плане) — иначе просроченные по плану (выход сегодня, этап
    «до выхода») пришли бы пачкой сразу. Вне демо — без изменений."""
    if not enabled() or not rows:
        return rows
    interval = int(os.environ.get("NEIROMASTER_DEMO_INTERVAL", "30"))
    count = int(os.environ.get("NEIROMASTER_DEMO_MESSAGES", "5"))
    now = datetime.now(timezone.utc)
    ordered = sorted(rows, key=lambda r: r["send_at"])
    fast, rest = ordered[:count], ordered[count:]
    if rest:
        gap = rest[0]["send_at"] - fast[-1]["send_at"]
    for i, row in enumerate(fast):
        row["send_at"] = now + timedelta(seconds=interval * (i + 1))
    if rest:
        shift = max(timedelta(0), fast[-1]["send_at"] + gap - rest[0]["send_at"])
        for row in rest:
            row["send_at"] += shift
    return ordered


# ---------- Посев и сброс ----------
def _schema() -> str:
    import provisioning
    return provisioning.schema_for(SLUG)


def _documents() -> list:
    files = []
    for folder in DOCS_DIRS:
        if folder.is_dir():
            files += sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in DOC_EXT)
    return files


def ensure_seeded() -> bool:
    """Демо-компания есть — ничего не делаем; нет — создаём целиком. True — только что создана."""
    import indexing
    import provisioning
    import users
    if not enabled() or provisioning.is_company(_schema()):
        return False
    created = provisioning.create_company(COMPANY, slug=SLUG, admin_full_name=ACCOUNTS[0][2])
    with db.use_schema(created["schema"]):
        admin_id = created["admin"]["id"]
        users.set_username(admin_id, ACCOUNTS[0][1])
        users.set_password(admin_id, password())          # общая учётка — без смены при входе
        admin = users.get_user(admin_id)
        users.create_user({"full_name": ACCOUNTS[1][2], "username": ACCOUNTS[1][1], "password": password(),
                           "department": DEPARTMENT}, actor=admin, role=users.ROLE_CURATOR)
        users.create_user({"full_name": ACCOUNTS[2][2], "username": ACCOUNTS[2][1], "password": password(),
                           "department": DEPARTMENT, "position": "Водитель",
                           "start_date": datetime.now().date().isoformat()},
                          actor=admin, role=users.ROLE_EMPLOYEE)
        for path in _documents():
            filepath = indexing.save_uploaded_file(path.name, path.read_bytes(), uploader=admin)
            indexing.enqueue_document(filepath)           # разбор и разметка — в worker-demo
    print(f"[demo] создана {COMPANY}: учётки {', '.join(a[1] for a in ACCOUNTS)}, "
          f"документов {len(_documents())}")
    return True


def reset():
    """Удалить демо-компанию со всем, что в ней создали, и засеять заново."""
    import config
    import provisioning
    schema = _schema()
    db.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
    db.execute("DELETE FROM public.logins WHERE schema_name = %s", (schema,))
    db.execute("DELETE FROM public.cabinets WHERE schema_name = %s", (schema,))
    provisioning.schemas(fresh=True)
    for base in (config.DOCS_DIR, config.CONVERTED_DIR):
        shutil.rmtree(base / schema, ignore_errors=True)
    ensure_seeded()


if __name__ == "__main__":
    if not enabled():
        raise SystemExit("Это не демо-экземпляр (NEIROMASTER_DEMO не задан) — сбрасывать нечего.")
    db.init_schema()
    if "reset" in sys.argv[1:]:
        reset()
        print("[demo] сброшено в исходное состояние")
    else:
        print("created" if ensure_seeded() else "уже засеяно")

"""
demo.py — демо-экземпляр для показа клиентам: своя PostgreSQL и свой сайт (web-demo в
docker-compose.yml), к данным клиентов доступа нет. Включается NEIROMASTER_DEMO=1.

Что видит посетитель:
  - кнопка «Войти в демо» (POST /api/demo/enter) — сразу администратор «Демо-компании», без
    пароля; тур по центру экрана проводит от админки до кабинета сотрудника;
  - только просмотр: любой изменяющий запрос — 403 «В демо-версии изменения недоступны»
    (Guard). Исключения: вход/выход, журнал событий, /api/demo/*, вопрос ассистенту (не
    больше ASK_PER_HOUR в час с устройства) и ответы своего сотрудника-песочницы;
  - у каждого устройства (кука nm_demo_device) свой сотрудник-песочница: после тура ему
    по одному приходят сообщения всех типов с шагом 30 с (POST /api/demo/tour-done);
  - плашка «Оставить контакты» -> заявка суперадмину основного сайта (leads.py);
  - повторный визит с того же устройства: ни тура, ни плашки (флаги в public.demo_devices).

Готовые данные (первый старт, фоновый поток prepare()): документы из examples/, план
адаптации из каталога, сгенерированный под должность «Водитель», пять сотрудников с разной
историей (прочитано, время на экране, ответы на тесты) — для статистики, и вопросы.

Сброс в исходное состояние (всё, что появилось у посетителей, удаляется); перезапуск
web-demo запускает подготовку заново:
    docker compose exec web-demo python backend/demo.py reset && docker compose restart web-demo
"""
import os
import random
import re
import secrets
import shutil
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

import config  # noqa: F401 — первым: .env до подключения к БД
import db

BASE_DIR = Path(__file__).resolve().parents[1]
SLUG = "demo"
COMPANY = "Демо-компания"
DEPARTMENT = "Производство"
POSITION = "Водитель"
# (роль, логин, ФИО) — общие учётки, вход — кнопкой, без пароля.
ACCOUNTS = (("admin", "demo", "Демо Администратор"),
            ("curator", "demo-curator", "Демо Куратор"))
SANDBOX_PREFIX = "demo-d"
DOCS_DIRS = (BASE_DIR / "data" / "demo", BASE_DIR / "examples", BASE_DIR / "examples" / "adaptation_90")
DOC_EXT = {".pdf", ".docx", ".doc", ".pptx", ".html", ".htm", ".md", ".txt"}
DEVICE_COOKIE = "nm_demo_device"
ASK_PER_HOUR = 10
LEADS_PER_HOUR = 3
MESSAGE_STEP_S = 30
SANDBOX_TTL_DAYS = 30
DENIED = "В демо-версии изменения недоступны"

# Сотрудники с историей для статистики: (ФИО, дней с выхода, доля прочитанных,
# реакция в часах, время на экране к ожидаемому (от, до), доля верных в тестах).
PROFILES = (
    ("Иванов Алексей Петрович", 45, 0.95, 0.5, (0.7, 1.4), 0.9),
    ("Петрова Мария Сергеевна", 30, 0.85, 3, (0.3, 0.9), 0.75),
    ("Сидоров Павел Андреевич", 20, 0.6, 20, (0.05, 0.3), 0.5),
    ("Кузнецова Анна Игоревна", 10, 1.0, 0.3, (0.8, 1.5), 1.0),
    ("Орлов Дмитрий Олегович", 5, 0.35, 40, (0.02, 0.15), 0.34),
)
QUESTIONS = (
    ("Иванов Алексей Петрович", "Можно ли поменяться сменой с напарником?",
     "Да, по согласованию с мастером участка: подайте заявление за 2 дня до смены."),
    ("Петрова Мария Сергеевна", "Когда выдают зимнюю спецодежду?",
     "Зимний комплект выдают с 1 октября на складе СИЗ, корпус 3, с 8:00 до 16:00."),
    ("Сидоров Павел Андреевич", "Что делать, если путевой лист не подписан медиком?", None),
    ("Орлов Дмитрий Олегович", "Положена ли компенсация за личный телефон?", None),
)


def enabled() -> bool:
    return os.environ.get("NEIROMASTER_DEMO", "").lower() in ("1", "true", "yes")


def schema() -> str:
    import provisioning
    return provisioning.schema_for(SLUG)


# ---------- Только просмотр ----------
_OPEN = ("/api/login", "/api/logout", "/api/events", "/api/demo/")
_SANDBOX = re.compile(r"^/api/my/messages/[^/]+/(read|answer|view)$")


def verdict(method: str, path: str) -> str:
    """'ok' | 'ask' (лимит) | 'sandbox' (только сотрудник-песочница) | 'deny'."""
    if method in ("GET", "HEAD", "OPTIONS") or path.startswith(_OPEN):
        return "ok"
    if path == "/ask":
        return "ask"
    return "sandbox" if _SANDBOX.match(path) else "deny"


def is_sandbox(user: dict | None) -> bool:
    return bool(user) and str(user.get("username") or "").startswith(SANDBOX_PREFIX)


class Guard:
    """ASGI-слой демо (внутри TenantMiddleware — схема уже выбрана): изменения запрещены."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            from starlette.concurrency import run_in_threadpool
            from starlette.requests import HTTPConnection
            from starlette.responses import JSONResponse
            import security
            conn = HTTPConnection(scope)
            v = verdict(scope["method"], scope["path"])
            deny = None
            if v == "ask":
                who = conn.cookies.get(DEVICE_COOKIE) or security.client_ip(conn)
                if not security.hit(f"demo-ask:{who}", ASK_PER_HOUR, 3600):
                    deny = (429, f"В демо-версии — не больше {ASK_PER_HOUR} вопросов в час")
            elif v == "sandbox":
                import auth
                token = conn.cookies.get(auth.COOKIE_NAME)
                if not is_sandbox(await run_in_threadpool(auth.get_session_user, token)):
                    deny = (403, DENIED)
            elif v == "deny":
                deny = (403, DENIED)
            if deny:
                await JSONResponse({"detail": deny[1], "demo": True}, status_code=deny[0])(scope, receive, send)
                return
        await self.app(scope, receive, send)


# ---------- Устройства посетителей ----------
_DDL = """
    CREATE TABLE IF NOT EXISTS public.demo_devices (
        id           TEXT PRIMARY KEY,
        employee_id  TEXT,
        tour_done_at TIMESTAMPTZ,
        messages_at  TIMESTAMPTZ,
        lead_at      TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        seen_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )"""


def _device(device_id: str | None) -> dict:
    """Запись устройства (новое — если куки нет или она незнакомая)."""
    if device_id and re.fullmatch(r"[A-Za-z0-9_-]{16,64}", device_id):
        row = db.query("UPDATE public.demo_devices SET seen_at = now() WHERE id = %s RETURNING *",
                       (device_id,), "one")
        if row:
            return row
    return db.query("INSERT INTO public.demo_devices (id) VALUES (%s) RETURNING *",
                    (secrets.token_urlsafe(24),), "one")


def _flags(dev: dict) -> dict:
    return {"tour_done": bool(dev.get("tour_done_at")), "lead_done": bool(dev.get("lead_at"))}


def _sandbox(dev: dict) -> dict:
    """Сотрудник-песочница устройства: должность и план демо, выход — сегодня."""
    import messaging
    import users
    user = users.get_user(dev["employee_id"]) if dev.get("employee_id") else None
    if user:
        return user
    user = users.create_user({"full_name": "Вы (демо-сотрудник)",
                              "username": f"{SANDBOX_PREFIX}{secrets.token_hex(4)}",
                              "password": secrets.token_urlsafe(16), "department": DEPARTMENT,
                              "position": POSITION, "start_date": datetime.now().date().isoformat()},
                             role=users.ROLE_EMPLOYEE)
    db.execute("UPDATE public.demo_devices SET employee_id = %s WHERE id = %s", (user["id"], dev["id"]))
    messaging.materialize_employee(user)
    return user


def _cleanup():
    """Песочницы устройств, не заходивших SANDBOX_TTL_DAYS дней, — удалить (флаги остаются)."""
    import users
    rows = db.query("UPDATE public.demo_devices SET employee_id = NULL WHERE employee_id IS NOT NULL "
                    "AND seen_at < now() - make_interval(days => %s) "
                    "RETURNING employee_id AS id", (SANDBOX_TTL_DAYS,)) or []
    ids = [r["id"] for r in rows]
    if ids:
        for table, col in (("scheduled_messages", "employee_id"), ("sessions", "user_id"),
                           ("questions", "user_id")):
            db.execute(f"DELETE FROM {table} WHERE {col} = ANY(%s)", (ids,))
        for uid in ids:
            users.delete_user(uid)


# ---------- API посетителя ----------
router = APIRouter(prefix="/api/demo")


class EnterRequest(BaseModel):
    role: str = Field(default="admin", pattern="^(admin|curator|employee)$")


class LeadRequest(BaseModel):
    dismiss: bool = False
    name: str = Field(default="", max_length=200)
    company: str = Field(default="", max_length=200)
    contact: str = Field(default="", max_length=200)
    comment: str = Field(default="", max_length=2000)
    consent: bool = False


def _on():
    if not enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def _set_device(response: Response, dev: dict):
    import auth
    response.set_cookie(DEVICE_COOKIE, dev["id"], httponly=True, samesite="lax",
                        secure=auth.COOKIE_SECURE, max_age=365 * 24 * 3600, path="/")


@router.post("/enter")
def enter(req: EnterRequest, request: Request, response: Response):
    """Вход в демо без пароля: администратор, куратор или свой сотрудник-песочница."""
    _on()
    import auth
    import security
    import users
    from deps import _set_session_cookie
    security.limit(request, "demo-enter", 30, 60)
    with db.use_schema(schema()):
        dev = _device(request.cookies.get(DEVICE_COOKIE))
        _cleanup()
        if req.role == "employee":
            user = _sandbox(dev)
        else:
            user = users.get_by_username(dict((r, login) for r, login, _ in ACCOUNTS)[req.role])
        if not user:
            raise HTTPException(status_code=503, detail="Демо ещё готовится — зайдите через пару минут")
        token = auth.new_session(user, schema())
    _set_session_cookie(response, token)
    _set_device(response, dev)
    return {"role": user["role"], **_flags(dev)}


@router.get("/state")
def state(request: Request):
    """Флаги устройства: тур пройден, контакты оставлены или плашка закрыта."""
    _on()
    dev = _device(request.cookies.get(DEVICE_COOKIE))
    return _flags(dev)


@router.post("/tour-done")
def tour_done(request: Request, response: Response):
    """Тур пройден или закрыт: отметить и один раз на устройство запустить сообщения всех
    типов сотруднику-песочнице — по одному каждые MESSAGE_STEP_S секунд."""
    _on()
    import messaging
    with db.use_schema(schema()):
        dev = _device(request.cookies.get(DEVICE_COOKIE))
        first = db.query("UPDATE public.demo_devices SET tour_done_at = COALESCE(tour_done_at, now()), "
                         "messages_at = now() WHERE id = %s AND messages_at IS NULL RETURNING id",
                         (dev["id"],), "one")
        sent = 0
        if first:
            items = [{**it, "delay": MESSAGE_STEP_S * (i + 1)}
                     for i, it in enumerate(messaging.test_samples())]
            sent = len(messaging.send_test_messages(_sandbox(dev)["id"], items))
    _set_device(response, dev)
    return {"messages": sent, "step_s": MESSAGE_STEP_S}


@router.post("/lead")
def lead(req: LeadRequest, request: Request):
    """Контакты посетителя -> заявка суперадмину. dismiss — плашку закрыли без контактов."""
    _on()
    import leads
    import security
    dev = _device(request.cookies.get(DEVICE_COOKIE))
    if not req.dismiss:
        if not req.consent:
            raise HTTPException(status_code=400, detail="Нужно согласие на обработку персональных данных")
        if not req.contact.strip():
            raise HTTPException(status_code=400, detail="Укажите телефон или e-mail")
        if not security.hit(f"demo-lead:{dev['id']}", LEADS_PER_HOUR, 3600):
            raise HTTPException(status_code=429, detail="Заявка уже отправлена — мы свяжемся с вами")
        leads.save(req.model_dump(exclude={"dismiss", "consent"}))
    db.execute("UPDATE public.demo_devices SET lead_at = now() WHERE id = %s", (dev["id"],))
    return {"ok": True}


# ---------- Посев ----------
def _documents() -> list:
    files = []
    for folder in DOCS_DIRS:
        if folder.is_dir():
            files += sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in DOC_EXT)
    return files


def ensure_seeded(background: bool = True) -> bool:
    """Демо-компания есть — только дозапуск подготовки; нет — создаём целиком.
    background — подготовка (план, история) фоновым потоком; из консоли — нет: её подхватит
    web-demo при перезапуске."""
    import indexing
    import provisioning
    import users
    if not enabled():
        return False
    db.execute(_DDL)
    if provisioning.is_company(schema()):
        if background:
            start_prepare()
        return False
    created = provisioning.create_company(COMPANY, slug=SLUG, admin_full_name=ACCOUNTS[0][2])
    with db.use_schema(created["schema"]):
        admin_id = created["admin"]["id"]
        users.set_username(admin_id, ACCOUNTS[0][1])
        users.set_password(admin_id, secrets.token_urlsafe(16))   # вход — кнопкой, пароль не нужен
        admin = users.get_user(admin_id)
        users.create_user({"full_name": ACCOUNTS[1][2], "username": ACCOUNTS[1][1],
                           "password": secrets.token_urlsafe(16), "department": DEPARTMENT},
                          actor=admin, role=users.ROLE_CURATOR)
        today = datetime.now().date()
        for name, days, *_ in PROFILES:
            users.create_user({"full_name": name, "department": DEPARTMENT, "position": POSITION,
                               "start_date": (today - timedelta(days=days)).isoformat()},
                              actor=admin, role=users.ROLE_EMPLOYEE)
        for path in _documents():
            filepath = indexing.save_uploaded_file(path.name, path.read_bytes(), uploader=admin)
            indexing.enqueue_document(filepath)           # разбор и разметка — в worker-demo
    print(f"[demo] создана {COMPANY}: документов {len(_documents())}, план и история — фоном")
    if background:
        start_prepare()
    return True


def start_prepare():
    threading.Thread(target=prepare, daemon=True, name="demo-prepare").start()


def prepare(poll: float = 20, timeout: float = 6 * 3600):
    """Документы разобраны -> план из каталога -> тексты под «Водителя» -> расписания и история
    сотрудников -> вопросы. Один раз (метка demo_prepared), под замком Redis: воркеров web
    несколько. Переживает перезапуск: незаконченная подготовка продолжится со старта."""
    from redis_conn import get_redis
    r = get_redis()
    lock = r.lock("nm:demo:prepare", timeout=timeout, blocking=False) if r is not None else None
    if lock is not None and not lock.acquire():
        return
    try:
        with db.use_schema(schema()):
            if db.query("SELECT 1 FROM app_settings WHERE key = 'demo_prepared'", (), "one"):
                return
            _prepare(poll, time.time() + timeout)
    except Exception as e:
        print(f"[demo] подготовка не закончена: {e}")
    finally:
        if lock is not None:
            lock.release()


def _wait(ready, poll: float, deadline: float, what: str):
    while not ready():
        if time.time() > deadline:
            raise TimeoutError(what)
        time.sleep(poll)


def _prepare(poll: float, deadline: float):
    import autoplan
    import indexing
    import messaging
    import planner
    pending = ("uploaded", "queued", "processing", "reanalyzing")
    _wait(lambda: not any(d.get("status") in pending for d in indexing.list_documents()),
          poll, deadline, "документы не разобраны")
    plan = planner.load_plan(autoplan.get_default_plan_id() or "")
    if plan is None:
        plan = planner.build_full_template("План адаптации: водитель")
        planner.save_plan(plan)
        autoplan.set_default_plan_id(plan["plan_id"])
    autoplan.assign_unassigned()
    job = planner.start_generation(plan, positions=[POSITION])
    if job.get("job_id"):
        _wait(lambda: (planner.get_job(job["job_id"]) or {}).get("status") not in ("queued", "running"),
              poll, deadline, "генерация плана не закончилась")
    messaging.ensure_all()
    _history()
    _questions()
    db.execute("INSERT INTO app_settings (key, value) VALUES ('demo_prepared', '1') "
               "ON CONFLICT (key) DO NOTHING")
    print("[demo] готово: план, сообщения, история и вопросы")


def _history():
    """Прошедшие сообщения плана у сотрудников PROFILES: доставлено, прочитано, время на экране,
    ответы на тесты и чек-листы — по характеру сотрудника (детерминированно)."""
    import stats
    from psycopg.types.json import Json
    import users
    now = datetime.now(timezone.utc)
    people = {u["full_name"]: u for u in users.list_users() if u["role"] == users.ROLE_EMPLOYEE}
    for name, _days, read_share, react_h, view, accuracy in PROFILES:
        user = people.get(name)
        if not user:
            continue
        rnd = random.Random(name)
        rows = db.query("SELECT id, kind, body, payload, send_at FROM scheduled_messages "
                        "WHERE employee_id = %s AND plan_id IS NOT NULL AND send_at <= now() "
                        "ORDER BY send_at", (user["id"],)) or []
        for r in rows:
            if rnd.random() >= read_share:
                db.execute("UPDATE scheduled_messages SET status = 'delivered', delivered_at = send_at "
                           "WHERE id = %s", (r["id"],))
                continue
            opened = min(now, r["send_at"] + timedelta(hours=rnd.expovariate(1 / react_h)))
            view_ms = int(stats.expected_ms(r["body"]) * rnd.uniform(*view))
            db.execute("UPDATE scheduled_messages SET status = 'read', delivered_at = send_at, "
                       "read_at = %s, first_view_at = %s, view_ms = %s, answers = %s WHERE id = %s",
                       (opened, opened, view_ms, Json(_answers(r["payload"], accuracy, rnd)), r["id"]))


def _answers(payload: dict | None, accuracy: float, rnd: random.Random) -> dict:
    p = payload or {}
    if p.get("items"):                                        # чек-лист
        return {it["id"]: True for it in p["items"] if rnd.random() < accuracy + 0.1}
    out = {}
    for q in p.get("questions") or []:
        opts = q.get("options") or []
        if not opts:
            continue
        right = [o for o in opts if o.get("correct")]
        wrong = [o for o in opts if not o.get("correct")]
        pick = right if (right and (rnd.random() < accuracy or not wrong)) else (wrong or opts)
        out[q["id"]] = rnd.choice(pick)["id"]
    return out


def _questions():
    import questions
    import users
    people = {u["full_name"]: u for u in users.list_users()}
    for name, text, answer in QUESTIONS:
        if not people.get(name):
            continue
        q = questions.record(people[name], text, None, questions.REASON_NO_ANSWER)
        if answer:
            questions.resolve(q["id"], answer, ACCOUNTS[1][2])


def reset():
    """Удалить демо-компанию со всем, что в ней создали, и засеять заново."""
    import provisioning
    s = schema()
    db.execute(f'DROP SCHEMA IF EXISTS "{s}" CASCADE')
    db.execute("DELETE FROM public.logins WHERE schema_name = %s", (s,))
    db.execute("DELETE FROM public.cabinets WHERE schema_name = %s", (s,))
    db.execute("UPDATE public.demo_devices SET employee_id = NULL, messages_at = NULL")
    provisioning.schemas(fresh=True)
    for base in (config.DOCS_DIR, config.CONVERTED_DIR):
        shutil.rmtree(base / s, ignore_errors=True)
    ensure_seeded(background=False)


if __name__ == "__main__":
    if not enabled():
        raise SystemExit("Это не демо-экземпляр (NEIROMASTER_DEMO не задан) — сбрасывать нечего.")
    db.init_schema()
    if "reset" in sys.argv[1:]:
        reset()
        print("[demo] сброшено — перезапустите web-demo: план и история готовятся при старте")
    else:
        print("created" if ensure_seeded() else "уже засеяно")

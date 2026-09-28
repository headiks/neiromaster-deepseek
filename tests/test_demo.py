"""Демо-сайт (backend/demo.py): только просмотр, песочница на устройство, рассылка после тура
один раз, заявки. Чистые правила — без БД; сквозные проверки — с тестовой PostgreSQL."""
import os
import random
import shutil
import sys
import tempfile
from pathlib import Path

import pytest
from test_stubs import superadmin_hash

TEST_DSN = (os.environ.get("NEIROMASTER_TEST_DSN")
            or "postgresql://neiromaster:neiromaster@localhost:5432/neiromaster_test")
os.environ.update({
    "NEIROMASTER_DB_DSN": TEST_DSN,
    "NEIROMASTER_INSECURE_COOKIE": "1",
    "NEIROMASTER_SCHEDULER": "0",
    "REDIS_URL": "",
    "DEEPSEEK_API_KEY": "",
    "NEIROMASTER_RAW_DB_DSN": "",
    "NEIROMASTER_S3_ENDPOINT": "",
    "NEIROMASTER_LEADS_DSN": "",
    "NEIROMASTER_DEMO": "1",
    "NEIROMASTER_SUPERADMIN_HASH": superadmin_hash("owner-strong-pass"),
    "NEIROMASTER_PII_KEY": "",
    "NEIROMASTER_PII_KEY_FILE": os.path.join(tempfile.mkdtemp(), "secrets", "pii.key"),
})
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

try:
    import psycopg
    with psycopg.connect(TEST_DSN, connect_timeout=3, autocommit=True) as _c:
        for (_s,) in _c.execute("SELECT schema_name FROM information_schema.schemata "
                                "WHERE schema_name LIKE 'cab\\_%'").fetchall():
            _c.execute(f'DROP SCHEMA "{_s}" CASCADE')
        _c.execute("DROP SCHEMA public CASCADE")
        _c.execute("CREATE SCHEMA public")
    DB_OK = True
except Exception:                    # noqa: BLE001 — любая причина = нет БД
    DB_OK = False

needs_db = pytest.mark.skipif(not DB_OK, reason="тестовая PostgreSQL недоступна")
ORIGIN = {"Origin": "http://testserver"}


# ---------- Правила без БД ----------
def test_verdict_read_only():
    import demo
    assert demo.verdict("GET", "/users") == "ok"
    for path in ("/api/login", "/api/logout", "/api/events", "/api/demo/enter", "/api/demo/lead"):
        assert demo.verdict("POST", path) == "ok", path
    assert demo.verdict("POST", "/ask") == "ask"
    assert demo.verdict("POST", "/api/my/messages/x:y/answer") == "sandbox"
    assert demo.verdict("POST", "/api/my/messages/x/view") == "sandbox"
    for method, path in (("POST", "/users"), ("PUT", "/plans/p1"), ("DELETE", "/documents/a.pdf"),
                         ("POST", "/documents/upload"), ("POST", "/api/password"), ("POST", "/api/my/status")):
        assert demo.verdict(method, path) == "deny", path
    assert demo.is_sandbox({"username": "demo-dabc123"}) and not demo.is_sandbox({"username": "demo"})


def test_seed_answers_follow_accuracy():
    import demo
    quiz = {"questions": [{"id": f"q{i}", "options": [{"id": "r", "correct": True}, {"id": "w"}]} for i in range(200)]}
    good = demo._answers(quiz, 0.9, random.Random(1))
    bad = demo._answers(quiz, 0.3, random.Random(1))
    assert sum(v == "r" for v in good.values()) > 160 and sum(v == "r" for v in bad.values()) < 80
    checklist = {"items": [{"id": "a"}, {"id": "b"}]}
    assert set(demo._answers(checklist, 1.0, random.Random(1))) == {"a", "b"}


# ---------- Сквозные проверки ----------
@pytest.fixture(scope="module")
def client():
    tmp = Path(tempfile.mkdtemp())
    import config
    config.DOCS_DIR = tmp / "documents"
    config.DOCS_DIR.mkdir()
    import demo
    demo.DOCS_DIRS = ()                          # без docling и DeepSeek
    demo.start_prepare = lambda: None
    import jobs
    jobs.enqueue_index = lambda job_id: True
    from fastapi.testclient import TestClient
    import app
    with TestClient(app.app) as c:
        yield c
    shutil.rmtree(tmp, ignore_errors=True)


@needs_db
def test_enter_and_read_only(client):
    c = client
    r = c.post("/api/demo/enter", json={"role": "admin"}, headers=ORIGIN)
    assert r.status_code == 200 and r.json() == {"role": "admin", "tour_done": False, "lead_done": False}
    assert c.get("/api/me").json()["username"] == "demo"
    assert c.get("/users").status_code == 200                                  # смотреть — можно
    r = c.post("/users", json={"full_name": "Посетитель Пётр"}, headers=ORIGIN)
    assert r.status_code == 403 and r.json()["demo"]                          # менять — нет
    assert c.post("/api/demo/enter", json={"role": "curator"}, headers=ORIGIN).json()["role"] == "curator"


@needs_db
def test_sandbox_per_device_and_messages_once(client):
    c = client
    c.cookies.clear()
    c.post("/api/demo/enter", json={"role": "employee"}, headers=ORIGIN)
    me = c.get("/api/me").json()
    assert me["role"] == "employee" and me["username"].startswith("demo-d")
    device = c.cookies.get("nm_demo_device")
    r = c.post("/api/demo/tour-done", headers=ORIGIN).json()
    assert r["messages"] >= 4 and r["step_s"] == 30                          # все типы, шаг 30 с
    assert c.post("/api/demo/tour-done", headers=ORIGIN).json()["messages"] == 0   # один раз
    assert c.get("/api/demo/state").json()["tour_done"]
    import db
    import demo
    with db.use_schema(demo.schema()):
        kinds = {r["kind"] for r in db.query("SELECT kind FROM scheduled_messages WHERE employee_id = %s",
                                             (me["id"],))}
    assert {"message", "checklist", "survey", "quiz"} <= kinds
    # статистика по тем же строкам (как если бы это были сообщения плана): SQL сводки работает
    import stats
    with db.use_schema(demo.schema()):
        db.execute("UPDATE scheduled_messages SET plan_id = 'p', status = 'delivered', delivered_at = now() "
                   "- interval '2 hours' WHERE employee_id = %s", (me["id"],))
        quiz = db.query("SELECT id, payload FROM scheduled_messages WHERE employee_id = %s AND kind = 'quiz'",
                        (me["id"],), "one")
        q = quiz["payload"]["questions"][0]
        right = next(o["id"] for o in q["options"] if o.get("correct"))
        import messaging
        assert messaging.save_answers(me["id"], quiz["id"], {q["id"]: right})
        assert messaging.add_view(me["id"], quiz["id"], 60_000)
        s = stats.summary([me["id"]])[me["id"]]
        assert s["delivered"] == s["total"] >= 4 and s["read"] == 1
        assert s["tests"]["percent"] == 100 and s["reading"]["read"] == 1 and s["engagement"] is not None
        d = stats.detail(me["id"])
        assert any(m.get("quiz") for m in d["messages"])
    # то же устройство — тот же сотрудник; другое устройство — свой
    c.post("/api/demo/enter", json={"role": "employee"}, headers=ORIGIN)
    assert c.get("/api/me").json()["id"] == me["id"]
    c.cookies.clear()
    c.post("/api/demo/enter", json={"role": "employee"}, headers=ORIGIN)
    assert c.get("/api/me").json()["id"] != me["id"] and c.cookies.get("nm_demo_device") != device


@needs_db
def test_sandbox_may_answer_admin_may_not(client):
    c = client
    c.cookies.clear()
    c.post("/api/demo/enter", json={"role": "employee"}, headers=ORIGIN)
    assert c.post("/api/my/messages/nope/view", json={"ms": 1000}, headers=ORIGIN).status_code == 200
    c.post("/api/demo/enter", json={"role": "admin"}, headers=ORIGIN)
    assert c.post("/api/my/messages/nope/view", json={"ms": 1000}, headers=ORIGIN).status_code == 403


@needs_db
def test_lead_saved_and_flag_set(client):
    c = client
    c.cookies.clear()
    c.post("/api/demo/enter", json={"role": "admin"}, headers=ORIGIN)
    assert c.post("/api/demo/lead", json={"contact": "a@b.ru"}, headers=ORIGIN).status_code == 400   # без согласия
    r = c.post("/api/demo/lead", json={"name": "Анна", "company": "ООО Дельта", "contact": "a@b.ru",
                                       "consent": True}, headers=ORIGIN)
    assert r.status_code == 200
    assert c.get("/api/demo/state").json()["lead_done"]
    import leads
    assert any(l["company"] == "ООО Дельта" for l in leads.list_all())


@needs_db
def test_ask_limited(client):
    c = client
    c.cookies.clear()
    c.post("/api/demo/enter", json={"role": "employee"}, headers=ORIGIN)
    import demo
    codes = [c.post("/ask", json={"question": "Где столовая?"}, headers=ORIGIN).status_code
             for _ in range(demo.ASK_PER_HOUR + 1)]
    assert codes[-1] == 429 and 429 not in codes[:-1]

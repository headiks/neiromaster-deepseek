"""
Компании (схема на компанию) и роли: суперадмин -> админ компании -> куратор -> сотрудник.

Сквозь настоящий FastAPI и PostgreSQL:
  - суперадмин создаёт компании, админ компании получает логин и при входе меняет пароль;
  - данные компаний не пересекаются: люди, документы (и файлы на диске), журнал;
  - логины уникальны во всей системе, подделка схемы в токене не даёт доступа;
  - админ компании заводит кураторов и сотрудников, куратор — только сотрудников своего отдела;
  - суперадмин видит сводку по компаниям и журнал всех компаний;
  - схема компании переходит в свои потоки и задачи очереди.

Нужна тестовая PostgreSQL (NEIROMASTER_TEST_DSN); нет БД — тесты пропускаются.
"""
import os
import shutil
import sys
import tempfile
import threading
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
    "NEIROMASTER_SUPERADMIN_HASH": superadmin_hash("owner-strong-pass"),
    "NEIROMASTER_PII_KEY": "",
    "NEIROMASTER_PII_KEY_FILE": os.path.join(tempfile.mkdtemp(), "secrets", "pii.key"),
})

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

pytestmark = pytest.mark.skipif(not DB_OK, reason="тестовая PostgreSQL недоступна")

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
ORIGIN = {"Origin": "http://testserver"}


@pytest.fixture(scope="module")
def env():
    tmp = Path(tempfile.mkdtemp())
    import config
    import users
    users.DATA_DIR = tmp
    config.DOCS_DIR = tmp / "documents"
    config.DOCS_DIR.mkdir()
    import jobs
    jobs.enqueue_index = lambda job_id: True        # без docling/DeepSeek: только постановка
    from fastapi.testclient import TestClient
    import app
    with TestClient(app.app) as client:
        yield {"client": client, "tmp": tmp}
    shutil.rmtree(tmp, ignore_errors=True)


def _login(c, username, password):
    c.cookies.clear()
    r = c.post("/api/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def _first_login(c, username, temp_password, new_password):
    """Роль с админ-панелью: вход по выданному паролю -> свой пароль -> вход заново."""
    assert _login(c, username, temp_password)["must_change_credentials"]
    assert c.post("/api/setup-credentials", json={"password": new_password}, headers=ORIGIN).status_code == 200
    _login(c, username, new_password)


@pytest.fixture(scope="module")
def world(env):
    """Суперадмин и две компании с админами (вошли и сменили пароль)."""
    import users
    c = env["client"]
    owner = users.get_owner()
    _login(c, owner["username"], "owner-strong-pass")
    alfa = c.post("/api/companies", json={"company": "ООО Альфа", "slug": "alfa"}, headers=ORIGIN)
    assert alfa.status_code == 200, alfa.text
    beta = c.post("/api/companies", json={"company": "ООО Бета"}, headers=ORIGIN)  # код — из названия
    assert beta.status_code == 200, beta.text
    alfa, beta = alfa.json(), beta.json()
    assert alfa["schema"] == "cab_alfa" and beta["schema"] == "cab_ooo_beta"
    for comp in (alfa, beta):
        _first_login(c, comp["admin"]["username"], comp["admin"]["password"], "company-admin-pass")
    return {"owner": {"username": owner["username"], "password": "owner-strong-pass"},
            "alfa": alfa, "beta": beta}


def _as(env, world, who):
    c = env["client"]
    if who == "owner":
        _login(c, world["owner"]["username"], world["owner"]["password"])
    else:
        _login(c, world[who]["admin"]["username"], "company-admin-pass")
    return c


def test_company_admin_session_is_bound_to_company(env, world):
    c = _as(env, world, "alfa")
    assert c.cookies.get("nm_session").startswith("cab_alfa.")
    me = c.get("/api/me").json()
    assert me["role"] == "admin"
    # подделка схемы в токене: та же случайная часть с префиксом другой компании — не сессия
    token = c.cookies.get("nm_session")
    c.cookies.clear()
    forged = "cab_ooo_beta." + token.split(".", 1)[1]
    assert c.get("/api/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    assert c.get("/api/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_people_are_isolated_and_logins_unique(env, world):
    a = _as(env, world, "alfa")
    emp_a = a.post("/users", json={"full_name": "Иванов Иван Иванович"}, headers=ORIGIN).json()
    b = _as(env, world, "beta")
    emp_b = b.post("/users", json={"full_name": "Иванов Иван Иванович"}, headers=ORIGIN).json()
    assert emp_a["username"] != emp_b["username"], "логины уникальны во всей системе"
    ids_b = {u["id"] for u in b.get("/users").json()["users"]}
    assert emp_b["id"] in ids_b and emp_a["id"] not in ids_b
    assert b.get(f"/users/{emp_a['id']}").status_code == 404        # чужого не найти и по id
    # сотрудник компании входит по одному адресу — сессия в схеме его компании
    pw = b.post(f"/users/{emp_b['id']}/credentials", json={"password": "employee-pass-1"},
                headers=ORIGIN).json()
    _login(b, pw["username"], "employee-pass-1")
    assert b.cookies.get("nm_session").startswith("cab_ooo_beta.")


def test_documents_and_files_are_isolated(env, world):
    a = _as(env, world, "alfa")
    r = a.post("/documents/upload", files={"file": ("Регламент.md", "Альфа: пропуск на КПП-1".encode(), "text/markdown")},
               headers=ORIGIN)
    assert r.status_code in (200, 201, 202), r.text
    b = _as(env, world, "beta")
    r = b.post("/documents/upload", files={"file": ("Регламент.md", "Бета: пропуск на КПП-7".encode(), "text/markdown")},
               headers=ORIGIN)
    assert r.status_code in (200, 201, 202), r.text
    docs = env["tmp"] / "documents"
    assert (docs / "cab_alfa" / "Регламент.md").read_text(encoding="utf-8").startswith("Альфа")
    assert (docs / "cab_ooo_beta" / "Регламент.md").read_text(encoding="utf-8").startswith("Бета")
    import db
    import docregistry
    with db.use_schema("cab_alfa"):
        assert docregistry.get("Регламент.md")["storage_path"].startswith(world["alfa"]["admin"]["username"])


def test_role_rules(env, world):
    a = _as(env, world, "alfa")
    adm2 = a.post("/users", json={"full_name": "Админов Андрей Андреевич", "role": "admin"}, headers=ORIGIN)
    assert adm2.status_code == 200 and adm2.json()["role"] == "admin", adm2.text   # админ заводит админа
    assert a.post("/users", json={"full_name": "Без Отдела", "role": "curator"}, headers=ORIGIN).status_code == 400
    cur = a.post("/users", json={"full_name": "Кураторов Кирилл Кириллович", "role": "curator",
                                 "department": "Цех 1"}, headers=ORIGIN).json()
    assert cur["role"] == "curator"
    other = a.post("/users", json={"full_name": "Складской Семён", "department": "Склад"}, headers=ORIGIN).json()

    _first_login(a, cur["username"], cur["temp_password"], "curator-pass-123")
    # куратор заводит кураторов и сотрудников — только в свой отдел; админа — нет
    assert a.post("/users", json={"full_name": "Админ От Куратора", "role": "admin"}, headers=ORIGIN).status_code == 403
    cur2 = a.post("/users", json={"full_name": "Ещё Куратор", "role": "curator", "department": "Склад"},
                  headers=ORIGIN).json()
    assert cur2["role"] == "curator" and cur2["department"] == "Цех 1"
    mine = a.post("/users", json={"full_name": "Рабочий Роман", "department": "Склад"}, headers=ORIGIN).json()
    assert mine["department"] == "Цех 1", "куратор заводит только в свой отдел"
    ids = {u["id"] for u in a.get("/users").json()["users"]}
    assert mine["id"] in ids and other["id"] not in ids
    assert a.post(f"/users/{mine['id']}/role", json={"role": "admin"}, headers=ORIGIN).status_code == 403
    assert a.post(f"/users/{other['id']}/role", json={"role": "curator"}, headers=ORIGIN).status_code == 403
    r = a.post(f"/users/{mine['id']}/role", json={"role": "curator"}, headers=ORIGIN)
    assert r.status_code == 200 and r.json()["role"] == "curator", r.text


def test_superadmin_sees_companies_and_their_logs(env, world):
    c = _as(env, world, "owner")
    companies = {x["schema"]: x for x in c.get("/api/companies").json()["companies"]}
    assert set(companies) == {"cab_alfa", "cab_ooo_beta"}
    assert companies["cab_alfa"]["admins"] == 2 and companies["cab_alfa"]["curators"] == 3
    assert companies["cab_ooo_beta"]["employees"] == 1 and companies["cab_alfa"]["documents"] == 1
    events = c.get("/api/activity?limit=500").json()["events"]
    assert {"cab_alfa", "cab_ooo_beta", "public"} <= {e["company"] for e in events}
    only = c.get("/api/activity?company=cab_alfa&limit=500").json()["events"]
    assert only and {e["company"] for e in only} == {"cab_alfa"}
    # админ компании не видит список компаний
    a = _as(env, world, "alfa")
    assert a.get("/api/companies").status_code == 403


def test_schema_follows_threads_and_jobs(env, world):
    import db
    import jobs
    seen = []
    with db.use_schema("cab_alfa"):
        t = threading.Thread(target=db.bind_schema(lambda: seen.append(db.current_schema())))
        t.start(); t.join()
        jobs._run_or_thread(None, lambda: seen.append(db.current_schema()))
    for _ in range(50):
        if len(seen) == 2:
            break
        threading.Event().wait(0.05)
    assert seen == ["cab_alfa", "cab_alfa"]
    assert db.current_schema() is None


def test_superadmin_opens_company(env, world):
    """«Открыть» компанию: разделы — в её схеме с правами админа; документы — только от имени админа."""
    c = _as(env, world, "owner")
    assert c.post("/api/companies/alfa/enter", headers=ORIGIN).status_code == 200
    me = c.get("/api/me").json()
    assert me["role"] == "owner" and me["company"] == "cab_alfa" and me["company_name"] == "ООО Альфа"
    names = {u["full_name"] for u in c.get("/users").json()["users"]}
    assert "Рабочий Роман" in names and "Складской Семён" in names
    # страницы админки открываются (раньше серверная проверка страниц уводила на /login)
    assert c.get("/admin/users", follow_redirects=False).status_code == 200
    r = c.post("/documents/upload", files={"file": ("x.md", b"x", "text/markdown")}, headers=ORIGIN)
    assert r.status_code == 403
    assert c.post("/api/companies/exit", headers=ORIGIN).status_code == 200
    c.cookies.delete("nm_company")
    assert c.get("/api/me").json()["company"] == ""
    # новый вход сбрасывает открытую компанию
    c.cookies.set("nm_company", "cab_alfa")
    r = c.post("/api/login", json={"username": world["owner"]["username"], "password": world["owner"]["password"]})
    assert "nm_company" in r.headers.get("set-cookie", "")


def test_company_cookie_needs_owner_session(env, world):
    """Кука nm_company у админа другой компании ничего не даёт."""
    b = _as(env, world, "beta")
    b.cookies.set("nm_company", "cab_alfa")
    assert b.get("/api/me").json()["company"] == "cab_ooo_beta"
    names = {u["full_name"] for u in b.get("/users").json()["users"]}
    assert "Рабочий Роман" not in names


def test_superadmin_login_as_admin_and_back(env, world):
    c = _as(env, world, "owner")
    admins = c.get("/api/companies/alfa/admins").json()["admins"]
    target = next(a for a in admins if a["username"] == world["alfa"]["admin"]["username"])
    assert c.post(f"/api/companies/alfa/login-as/{target['id']}", headers=ORIGIN).status_code == 200
    me = c.get("/api/me").json()
    assert me["role"] == "admin" and me["owner_return"] and me["company"] == "cab_alfa"
    r = c.post("/documents/upload", files={"file": ("От админа.md", "Альфа: график".encode(), "text/markdown")},
               headers=ORIGIN)
    assert r.status_code in (200, 201, 202), r.text
    r = c.post("/api/return-to-owner", headers=ORIGIN)
    assert r.status_code == 200 and r.json()["role"] == "owner"
    c.cookies.delete("nm_owner_return")
    assert c.get("/api/me").json()["role"] == "owner"


def test_leads_for_superadmin_only(env, world):
    import leads
    leads.save({"name": "Пётр", "company": "ООО Гамма", "contact": "+7 900 000-00-00", "comment": "демо"})
    c = _as(env, world, "owner")
    d = c.get("/api/companies/leads").json()
    assert d["new"] >= 1 and any(l["company"] == "ООО Гамма" for l in d["leads"])
    lid = next(l["id"] for l in d["leads"] if l["company"] == "ООО Гамма")
    assert c.post(f"/api/companies/leads/{lid}", json={"status": "done"}, headers=ORIGIN).status_code == 200
    a = _as(env, world, "alfa")
    assert a.get("/api/companies/leads").status_code == 403


def test_first_login_shown_then_company_deleted(env, world):
    c = _as(env, world, "owner")
    gamma = c.post("/api/companies", json={"company": "ООО Гамма", "slug": "gamma"}, headers=ORIGIN).json()
    row = next(x for x in c.get("/api/companies").json()["companies"] if x["slug"] == "gamma")
    assert row["first_logins"] == [{"full_name": gamma["admin"]["full_name"],
                                    "username": gamma["admin"]["username"], "password": gamma["admin"]["password"]}]
    alfa = next(x for x in c.get("/api/companies").json()["companies"] if x["slug"] == "alfa")
    assert alfa["first_logins"] == []                       # сменил пароль — не показываем
    assert c.delete("/api/companies/gamma", headers=ORIGIN).status_code == 400          # без подтверждения
    r = c.delete("/api/companies/gamma?confirm=gamma", headers=ORIGIN)
    assert r.status_code == 200 and r.json()["schema"] == "cab_gamma", r.text
    assert "gamma" not in {x["slug"] for x in c.get("/api/companies").json()["companies"]}
    r = c.post("/api/login", json={"username": gamma["admin"]["username"], "password": gamma["admin"]["password"]})
    assert r.status_code == 401                              # логина больше нет
    import db
    assert not db.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'cab_gamma'")


def test_llm_key_pool_for_superadmin(env, world):
    """Суперадмин ведёт пул ключей DeepSeek на /globaltest; ключ наружу не отдаётся; вызовы
    берут свободный; ключ с «нет денег» встаёт на паузу."""
    c = _as(env, world, "owner")
    assert c.get("/api/globaltest").json()["unlocked"]                 # без пароля раздела
    assert c.get("/globaltest", follow_redirects=False).status_code == 200
    for n in (1, 2):
        r = c.post("/api/llm-keys", json={"label": f"k{n}", "key": f"sk-test-key-number-{n}-abcdef"}, headers=ORIGIN)
        assert r.status_code == 200, r.text
    listed = c.get("/api/llm-keys").json()["keys"]
    assert {k["tail"] for k in listed if k["source"] == "db"} >= {"cdef"}
    assert "sk-test" not in str(listed)
    import llmkeys
    llmkeys._cache["at"] = 0
    ids = {k["id"] for k in listed if k["source"] == "db"}
    with llmkeys.lease() as (a, key_a):
        with llmkeys.lease() as (b, _):
            assert a != b and {a, b} <= ids and key_a.startswith("sk-test-key")
    llmkeys.report(a, 402, "Insufficient Balance")
    assert all(llmkeys.pick()[0] != a for _ in range(5))                 # на паузе — не выбирается
    for k in ids:
        assert c.delete(f"/api/llm-keys/{k}", headers=ORIGIN).status_code == 200
    a = _as(env, world, "alfa")
    assert a.get("/api/llm-keys").status_code == 403

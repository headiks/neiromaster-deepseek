"""
Самопроверка бэкенда аккаунтов: регистрация -> модерация -> вход -> роли.
Гоняет реальные users.py и auth.py против ОТДЕЛЬНОЙ тестовой БД PostgreSQL
(таблица users чистится в начале). Без FastAPI и тяжёлых зависимостей (docling/qdrant).

Нужен доступный Postgres. DSN тестовой БД:
    NEIROMASTER_TEST_DSN (по умолчанию postgresql://neiromaster:neiromaster@localhost:5432/neiromaster_test)
Если БД недоступна — тест не падает, а печатает SKIP.

Запуск: python test_accounts.py
"""
import os
import tempfile

os.environ.setdefault("REDIS_URL", "")   # лок-аут — в памяти процесса, тест не зависит от Redis
from pathlib import Path

from test_stubs import superadmin_hash

os.environ["NEIROMASTER_SUPERADMIN_HASH"] = superadmin_hash("super-test-pass")

import psycopg
from psycopg_pool import PoolTimeout

import db
import users
import auth

TEST_DSN = (os.environ.get("NEIROMASTER_TEST_DSN")
            or "postgresql://neiromaster:neiromaster@localhost:5432/neiromaster_test")


def _isolate(tmp: Path):
    """Файловые артефакты — во временную папку; БД — в отдельную тестовую, с чистой таблицей."""
    users.DATA_DIR = tmp
    users.USERS_PATH = tmp / "users.json"
    users.LEGACY_EMPLOYEES_PATH = tmp / "employees.json"
    db.configure(TEST_DSN)
    db.init_schema()
    db.execute("DELETE FROM sessions")
    db.execute("DELETE FROM users")


def run():
    with tempfile.TemporaryDirectory() as d:
        _isolate(Path(d))

        # 1. Суперадмин из кода: создаётся один раз и выравнивается на каждом старте;
        # прежний владелец (до суперадмина) становится администратором
        legacy = users.create_user({"username": "director", "password": "s3cret-pass",
                                    "full_name": "Прежний владелец"}, role=users.ROLE_OWNER)
        users.ensure_owner()
        users.ensure_owner()
        owner = users.get_owner()
        assert owner["username"] == users.SUPERADMIN_USERNAME and owner["role"] == users.ROLE_OWNER
        assert not owner["must_change_credentials"]
        assert users.get_user(legacy["id"])["role"] == users.ROLE_ADMIN
        assert len([u for u in users.list_users() if u["role"] == users.ROLE_OWNER]) == 1

        # 2. Суперадмин входит паролем из кода; пароль, логин, роль и доступ через интерфейс
        # не меняются
        token, u = auth.login(users.SUPERADMIN_USERNAME, "super-test-pass")
        assert u["id"] == owner["id"]
        for change in (lambda: users.set_password(owner["id"], "other-pass-1"),
                       lambda: users.set_credentials(owner["id"], None, "other-pass-1"),
                       lambda: users.set_role(owner["id"], users.ROLE_ADMIN),
                       lambda: users.set_active(owner["id"], False),
                       lambda: users.delete_user(owner["id"])):
            try:
                change()
                assert False, "учётка суперадмина не должна меняться"
            except ValueError:
                pass

        # 3. Самостоятельная регистрация сотрудника -> ждёт подтверждения (active=False)
        emp = users.register_employee("ivanov", "employee-pass", "Иванов Иван", position="Водитель")
        assert emp["active"] is False, "регистрация должна требовать модерации"

        # 4. Пока не подтверждён — вход запрещён
        try:
            auth.login("ivanov", "employee-pass")
            assert False, "неподтверждённый сотрудник не должен входить"
        except ValueError as e:
            assert "подтвержд" in str(e).lower()

        # 5. Owner подтверждает -> сотрудник входит
        users.set_active(emp["id"], True)
        token, u = auth.login("ivanov", "employee-pass")
        assert u["role"] == users.ROLE_EMPLOYEE

        # 6. Неверный пароль отклоняется, публичное представление без секретов
        try:
            auth.login("ivanov", "wrong")
            assert False
        except ValueError:
            pass
        assert "hash" not in users.public_view(u) and "salt" not in users.public_view(u)

        # 7. Лок-аут перебора: после LOCKOUT_ATTEMPTS попыток — блокировка
        for _ in range(auth.LOCKOUT_ATTEMPTS):
            try:
                auth.login("ivanov", "nope", client="1.2.3.4")
            except ValueError:
                pass
        try:
            auth.login("ivanov", "employee-pass", client="1.2.3.4")
            assert False, "после серии неудач вход должен быть временно заблокирован"
        except ValueError as e:
            assert "много" in str(e).lower()

        # 8. Роли: куратор правит сотрудников СВОЕГО подразделения, но не других
        # кураторов и не чужой отдел; owner — всех
        admin = users.create_user({"username": "hrdept", "password": "hr-pass-123",
                                    "full_name": "HR", "department": "Цех"}, role=users.ROLE_CURATOR)
        assert not users.can_manage(admin, users.get_user(emp["id"]))   # сотрудник без отдела: нет
        users.update_profile(emp["id"], {**users.get_user(emp["id"]), "department": "Цех"})
        assert users.can_manage(admin, users.get_user(emp["id"]))       # свой отдел: да
        assert not users.can_manage(admin, users.get_owner())           # куратор -> owner: нет
        assert users.can_manage(owner, admin)                           # owner -> куратор: да

        # 9. Смена собственного пароля рвёт старые сессии (лок-аут из шага 7 снимаем, как
        # это делает выдача нового пароля администратором)
        auth.clear_failures("ivanov")
        auth.change_own_password(users.get_user(emp["id"]), "employee-pass", "new-pass-999")
        assert auth.get_session_user(token) is None
        auth.login("ivanov", "new-pass-999")  # новый пароль работает

    print("OK: регистрация, модерация, вход, лок-аут и роли работают")


if __name__ == "__main__":
    try:
        run()
    except (psycopg.OperationalError, PoolTimeout) as e:
        print(f"SKIP: PostgreSQL недоступен ({TEST_DSN}). {e}")

"""
Единое хранилище пользователей: аккаунт + роль + профиль адаптации.

Одна запись описывает и вход в систему, и то, что нужно для адаптации:

    аккаунт   — username, scrypt-хэш пароля, роль, активность
    профиль   — ФИО, должность, подразделение, контакт
    адаптация — наставник, руководитель, назначенный план, дата выхода, статус

Роли:
    owner    — главный администратор. Один. Может всё: удалять пользователей,
               назначать и снимать администраторов, передавать роль главного.
    admin    — администратор. База знаний, конструктор планов, заведение сотрудников
               и назначение им планов. Не может трогать других администраторов,
               удалять пользователей и раздавать права.
    employee — сотрудник. Чат с ассистентом и своё расписание адаптации.

Хранилище: таблица users в PostgreSQL (см. db.py). Открытых паролей нет — только соль
и scrypt-хэш. Со старого data/users.json данные переносятся автоматически при старте.
"""

import os
import re
import json
import time
import hmac
import uuid
import secrets
import hashlib
import threading
from pathlib import Path
from typing import Optional

import db
import pii_key
import provisioning

BASE_DIR = Path(__file__).resolve().parents[1]   # корень проекта (код — в backend/)
DATA_DIR = BASE_DIR / "data"
USERS_PATH = DATA_DIR / "users.json"          # старое хранилище — источник разовой миграции
LEGACY_EMPLOYEES_PATH = DATA_DIR / "employees.json"
# Роли (сверху вниз):
#   owner    — суперадмин разработчика, один на систему (учётка superadmin), живёт в public:
#              компании, статистика, заявки, журнал всех компаний; открывает любую компанию.
#   admin    — администратор компании: вся компания, заводит админов, кураторов, сотрудников.
#   curator  — куратор отдела: только свой отдел, заводит кураторов и сотрудников отдела.
#   employee — сотрудник: свой кабинет.

# Суперадмин: логин и пароль заданы жёстко, в коде — только scrypt-хэш «соль:хэш» пароля.
# Сменить пароль — посчитать новый хэш (hash_password) и заменить строку. Через интерфейс
# пароль, логин и роль суперадмина не меняются. NEIROMASTER_SUPERADMIN_HASH — замена хэша
# для тестов и стендов разработки.
SUPERADMIN_USERNAME = "superadmin"
SUPERADMIN_HASH = "f5433e89ab3860d5230b947bbe679536:3e7d4e91f9abed9543cde7f83158751079413d6efcdf74d48f34bf4e62c0df69"
ROLE_OWNER = "owner"
ROLE_ADMIN = "admin"
ROLE_CURATOR = "curator"
ROLE_EMPLOYEE = "employee"
ROLES = (ROLE_OWNER, ROLE_ADMIN, ROLE_CURATOR, ROLE_EMPLOYEE)
ADMIN_ROLES = (ROLE_OWNER, ROLE_ADMIN, ROLE_CURATOR)     # есть админ-панель
FULL_ACCESS_ROLES = (ROLE_OWNER, ROLE_ADMIN)             # видят всю свою схему, не только отдел

ADAPTATION_STATUSES = {"planned", "active", "done", "paused"}

MIN_PASSWORD_LENGTH = 8
MIN_USERNAME_LENGTH = 3
USERNAME_ALLOWED = set("abcdefghijklmnopqrstuvwxyz0123456789._-")

# Самостоятельно зарегистрировавшийся сотрудник ждёт подтверждения администратора.
# Поставьте False, если сервер стоит в закрытом контуре и модерация не нужна.
REQUIRE_REGISTRATION_APPROVAL = True

# Параметры scrypt (RFC 7914): подбор пароля дорогой, проверка при входе — миллисекунды
SCRYPT_N = 2 ** 14
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_DKLEN = 32

_lock = threading.RLock()

# Порядок колонок таблицы users (см. db.SCHEMA). Совпадает с ключами _blank_user.
_COLUMNS = (
    "id", "username", "full_name", "role", "active", "salt", "hash",
    "must_change_credentials", "created_at", "updated_at", "password_changed_at",
    "position", "department", "contact", "mentor", "manager", "plan_id",
    "plan_profession", "start_date", "status", "notes", "created_by",
    "phone", "email", "temp_password", "pauses",
)
_BOOL_COLUMNS = ("active", "must_change_credentials")
_JSON_COLUMNS = ("pauses",)


# ---------- Пароли ----------
def hash_password(password: str, salt: Optional[bytes] = None) -> tuple:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt,
                            n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=SCRYPT_DKLEN)
    return salt.hex(), digest.hex()


def verify_password(password: str, salt_hex: Optional[str], hash_hex: Optional[str]) -> bool:
    if not salt_hex or not hash_hex:
        return False
    try:
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False
    _, digest = hash_password(password, salt)
    return hmac.compare_digest(digest, hash_hex)


def validate_password(password: str):
    if not password or len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Пароль должен быть не короче {MIN_PASSWORD_LENGTH} символов")


def normalize_username(username: str) -> str:
    """Логины приводим к нижнему регистру: «Ivanov» и «ivanov» — один человек."""
    username = (username or "").strip().lower()
    if len(username) < MIN_USERNAME_LENGTH:
        raise ValueError(f"Логин должен быть не короче {MIN_USERNAME_LENGTH} символов")
    if not set(username) <= USERNAME_ALLOWED:
        raise ValueError("Логин может содержать только латинские буквы, цифры, точку, дефис и подчёркивание")
    return username


# ---------- Шифрование ПДн в БД (at rest) ----------
# Свободный текст профиля (ФИО, должность, контакты, наставник, руководитель,
# заметки, временный пароль) шифруется в БД ключом Fernet. Ключ создаётся сам при
# первом старте (pii_key.py: файл data/secrets/pii.key, права 600) или берётся из
# NEIROMASTER_PII_KEY. Шифртекст помечается префиксом «enc:», поэтому старые
# открытые строки и новые зашифрованные уживаются в одной таблице; оставшиеся
# открытые строки шифрует encrypt_plaintext() на старте.
#
# Защищает утёкший дамп/бэкап БД (pg_dump, украденный том): ключ лежит отдельно от
# базы. От полной компрометации хоста не спасает — для этого нужно ещё шифрование
# диска (LUKS). Логин/поиск не затрагиваются: username/role/id остаются открытыми,
# сортировка по ФИО идёт уже по расшифрованным значениям в Python (list_users).
_ENCRYPTED_COLUMNS = ("full_name", "position", "department", "contact", "mentor", "manager", "notes",
                      "phone", "email", "temp_password")
_PII_PREFIX = "enc:"
_fernet_cache: dict = {}


def _fernet():
    key = pii_key.current()
    if not key:
        return None                       # шифрование выключено явно (NEIROMASTER_PII_KEY=off)
    f = _fernet_cache.get(key)
    if f is None:
        from cryptography.fernet import Fernet
        f = _fernet_cache[key] = Fernet(key.encode())
    return f


def _encrypt_field(value):
    f = _fernet()
    if f is None or not value or not isinstance(value, str) or value.startswith(_PII_PREFIX):
        return value
    return _PII_PREFIX + f.encrypt(value.encode("utf-8")).decode("ascii")


def _decrypt_field(value):
    if not isinstance(value, str) or not value.startswith(_PII_PREFIX):
        return value                      # старое поле открытым текстом — вернуть как есть
    f = _fernet()
    if f is None:
        return value                      # ключ убрали — не падать, отдать хотя бы шифртекст
    from cryptography.fernet import InvalidToken
    try:
        return f.decrypt(value[len(_PII_PREFIX):].encode("ascii")).decode("utf-8")
    except InvalidToken:
        return value


def encrypt_plaintext_rows(table: str, columns, key_col: str = "id") -> int:
    """Шифрует строки, оставшиеся открытым текстом (данные, записанные до появления
    ключа). Идемпотентно: зашифрованные значения (с префиксом) не трогает."""
    if _fernet() is None:
        return 0
    cond = " OR ".join(f"({c} <> '' AND {c} NOT LIKE 'enc:%%')" for c in columns)
    rows = db.query(f"SELECT {key_col}, {', '.join(columns)} FROM {table} WHERE {cond}", (), "all") or []
    for r in rows:
        db.execute(f"UPDATE {table} SET {', '.join(c + ' = %s' for c in columns)} WHERE {key_col} = %s",
                   [_encrypt_field(r[c]) for c in columns] + [r[key_col]])
    return len(rows)


def encrypt_plaintext() -> int:
    """Открытые ПДн в users -> зашифрованные (разово после появления ключа)."""
    return encrypt_plaintext_rows("users", _ENCRYPTED_COLUMNS)


# ---------- Хранилище (PostgreSQL) ----------
def _row_to_user(row) -> dict:
    user = {col: row[col] for col in _COLUMNS}
    for col in _BOOL_COLUMNS:
        user[col] = bool(user[col])
    for col in _ENCRYPTED_COLUMNS:
        user[col] = _decrypt_field(user[col])
    for col in _JSON_COLUMNS:
        try:
            user[col] = json.loads(user[col] or "[]")
        except (TypeError, ValueError):
            user[col] = []
    # Старое единое поле «Контакт» -> раздельные телефон/email (до первого сохранения).
    if not (user.get("phone") or user.get("email")) and user.get("contact"):
        user["phone"], user["email"] = split_contact(user["contact"])
    return user


def from_row(row) -> dict:
    """Запись пользователя из строки SELECT * FROM users (с расшифровкой ПДн)."""
    return _row_to_user(row)


def split_contact(contact: str) -> tuple:
    """«+7 900 …, ivan@corp.ru» -> (телефон, email). Прочее (telegram и т.п.) — в телефон."""
    email = next((p.strip() for p in re.split(r"[,;\s]+", contact or "") if "@" in p and "." in p), "")
    phone = (contact or "").replace(email, "").strip(" ,;")
    return phone, email


def join_contact(user: dict) -> str:
    """Поле contact для совместимости (вопросы, расписание): телефон и email одной строкой."""
    return ", ".join(p for p in (user.get("phone"), user.get("email")) if p)


def _db_value(col: str, value):
    if col in _ENCRYPTED_COLUMNS:
        return _encrypt_field(value)
    if col in _JSON_COLUMNS:
        return json.dumps(value or [], ensure_ascii=False)
    return value


def _insert(user: dict):
    values = [_db_value(c, user.get(c)) for c in _COLUMNS]
    placeholders = ", ".join("%s" for _ in _COLUMNS)
    db.execute(f"INSERT INTO users ({', '.join(_COLUMNS)}) VALUES ({placeholders})", values)
    provisioning.sync_login(user)     # вход по одному адресу: логин -> схема компании


def _save_user(user: dict):
    """Перезапись всех колонок записи по id (аналог прежнего load->mutate->save)."""
    cols = [c for c in _COLUMNS if c != "id"]
    values = [_db_value(c, user.get(c)) for c in cols]
    values.append(user["id"])
    db.execute(f"UPDATE users SET {', '.join(c + ' = %s' for c in cols)} WHERE id = %s", values)
    provisioning.sync_login(user)


def public_view(user: dict) -> dict:
    """Запись пользователя без секретов — всё, что можно отдать в API. Временный пароль
    отдаёт только админский список (api_people.get_users) — тем, кто вправе его видеть."""
    return {k: v for k, v in user.items() if k not in ("salt", "hash", "temp_password")}


def _blank_user(**fields) -> dict:
    now = time.strftime("%Y-%m-%dT%H:%M:%S")
    user = {
        "id": str(uuid.uuid4()),
        "username": None,
        "full_name": "",
        "role": ROLE_EMPLOYEE,
        "active": True,
        "salt": None,
        "hash": None,
        "must_change_credentials": False,
        "created_at": now,
        "updated_at": now,
        "password_changed_at": None,
        # Профиль и адаптация
        "position": "",
        "department": "",
        "contact": "",
        "mentor": "",
        "manager": "",
        "plan_id": None,
        # План по профессии: какое сгенерированное расписание использовать для рассылки.
        # Пусто — берётся по должности сотрудника (position).
        "plan_profession": "",
        "start_date": None,
        "status": "planned",
        "notes": "",
        "created_by": None,
        "phone": "",
        "email": "",
        "pauses": [],
        # Выданный администратором пароль — хранится (шифруется при NEIROMASTER_PII_KEY),
        # пока сотрудник не задаст свой, чтобы админ мог показать/выгрузить его повторно.
        "temp_password": "",
    }
    user.update(fields)
    return user


# ---------- Чтение ----------
def list_users(with_secrets: bool = False) -> list:
    """with_secrets — оставить временный пароль (только для админского списка)."""
    rows = db.query("SELECT * FROM users", (), "all")
    users = [_row_to_user(r) for r in rows]
    view = (lambda u: {k: v for k, v in u.items() if k not in ("salt", "hash")}) if with_secrets else public_view
    return sorted((view(u) for u in users),
                  key=lambda u: (ROLES.index(u["role"]) if u["role"] in ROLES else len(ROLES),
                                 u.get("full_name") or ""))


def get_user(user_id: str) -> Optional[dict]:
    row = db.query("SELECT * FROM users WHERE id = %s", (user_id,), "one")
    return _row_to_user(row) if row else None


def get_by_username(username: str) -> Optional[dict]:
    try:
        username = normalize_username(username)
    except ValueError:
        return None
    row = db.query("SELECT * FROM users WHERE username = %s", (username,), "one")
    return _row_to_user(row) if row else None


def get_owner() -> Optional[dict]:
    """«Корень» хранилища documents/<корень>/<загрузивший>/: в общей схеме — суперадмин,
    в компании — её администратор (стабильно: первый по дате создания)."""
    row = db.query("SELECT * FROM users WHERE role IN (%s, %s) "
                   "ORDER BY (role = %s) DESC, created_at, id LIMIT 1",
                   (ROLE_OWNER, ROLE_ADMIN, ROLE_OWNER), "one")
    return _row_to_user(row) if row else None


def count_users() -> int:
    return db.query("SELECT COUNT(*) AS n FROM users", (), "one")["n"]


def _username_taken(username: str, exclude_id: Optional[str] = None) -> bool:
    """Логины уникальны во всей системе: вход по одному адресу ищет компанию по логину."""
    row = db.query("SELECT id FROM users WHERE username = %s", (username,), "one")
    if row and row["id"] != exclude_id:
        return True
    return provisioning.login_taken_elsewhere(username, exclude_id)


# ---------- Права ----------
def is_admin(user: dict) -> bool:
    """Есть админ-панель: суперадмин, админ компании, куратор."""
    return bool(user) and user.get("role") in ADMIN_ROLES


def is_owner(user: dict) -> bool:
    """Суперадмин (разработчик): компании, статистика, журнал всех компаний."""
    return bool(user) and user.get("role") == ROLE_OWNER


def is_full_access(user: dict) -> bool:
    """Видит всю свою схему, а не только отдел: админ компании (и суперадмин в общей)."""
    return bool(user) and user.get("role") in FULL_ACCESS_ROLES


def is_curator(user: dict) -> bool:
    return bool(user) and user.get("role") == ROLE_CURATOR


def assignable_roles(actor: dict) -> tuple:
    """Какие роли актор вправе выдавать. Админ компании (и суперадмин) — админов, кураторов и
    сотрудников; куратор — кураторов и сотрудников своего отдела. Роль owner не выдаётся."""
    if is_full_access(actor):
        return (ROLE_ADMIN, ROLE_CURATOR, ROLE_EMPLOYEE)
    if is_curator(actor):
        return (ROLE_CURATOR, ROLE_EMPLOYEE)
    return ()


def dir_slug(user) -> str:
    """
    Имя ПАПКИ пользователя в хранилище оригиналов (S3). Логин уже ограничен набором
    [a-z0-9._-] (normalize_username), поэтому безопасен как сегмент ключа и не даёт
    выйти из своего префикса. Без логина — по id, чтобы папка была у любого владельца.
    """
    if not user:
        return "_common"
    name = user.get("username") or f"user-{str(user.get('id') or 'unknown')[:8]}"
    # Страховка: логин уже нормализован, но id приходит извне — вычищаем всё,
    # что не входит в разрешённый набор, чтобы «/» или «..» не увели из префикса.
    safe = "".join(c if c in USERNAME_ALLOWED else "_" for c in name.lower())
    return safe.strip(".") or "_common"


def same_department(actor: dict, target: dict) -> bool:
    """Один ли отдел. Пустой отдел у куратора не считается совпадением —
    иначе «безотдельный» куратор увидел бы всех, у кого отдел тоже не заполнен."""
    dep = (actor.get("department") or "").strip().lower()
    return bool(dep) and dep == (target.get("department") or "").strip().lower()


def can_see_doc(actor: dict, doc: dict) -> bool:
    """
    Виден ли документ. Админ компании (суперадмин в общей схеме) видит всё. Куратор — свои
    загрузки и ОБЩИЕ документы админа (только чтение): иначе каждый куратор грузил и оплачивал
    обработку одних и тех же общих регламентов заново. Документы других кураторов и «ничьи»
    (залиты до разделения прав или через CLI) — только админу.
    """
    if is_full_access(actor):
        return True
    if doc.get("uploaded_by_role") in FULL_ACCESS_ROLES:
        return True
    return bool(doc.get("uploaded_by")) and doc.get("uploaded_by") == actor.get("id")


def can_edit_doc(actor: dict, doc: dict) -> bool:
    """Удалять/переразбирать/уточнять: админ — любой документ, куратор — только свой."""
    if is_full_access(actor):
        return True
    return bool(doc.get("uploaded_by")) and doc.get("uploaded_by") == actor.get("id")


def visible_docs(actor: dict, docs: list) -> list:
    return [d for d in docs if can_see_doc(actor, d)]


def visible_users(actor: dict, all_users: list) -> list:
    """
    Кого актор видит в списке людей. Админ компании — всех. Куратор — только свой отдел
    (и себя самого, даже если отдел ему не проставили).
    """
    if is_full_access(actor):
        return list(all_users)
    return [u for u in all_users
            if u.get("id") == actor.get("id") or same_department(actor, u)]


def can_manage(actor: dict, target: dict) -> bool:
    """
    Кого актор вправе редактировать. Суперадмин — всех, кроме себя-учётки из кода (её
    защищает _fixed). Админ компании — себя, админов, кураторов и сотрудников. Куратор — себя,
    кураторов и сотрудников СВОЕГО отдела: админа он не тронет.
    """
    if not is_admin(actor) or not target:
        return False
    if is_owner(actor) or target.get("id") == actor.get("id"):
        return True
    if is_full_access(actor):
        return target.get("role") in (ROLE_ADMIN, ROLE_CURATOR, ROLE_EMPLOYEE)
    return target.get("role") in (ROLE_CURATOR, ROLE_EMPLOYEE) and same_department(actor, target)


def ensure_can_manage(actor: dict, target: dict):
    if not can_manage(actor, target):
        raise PermissionError(
            "Недостаточно прав: куратор работает только с кураторами и сотрудниками своего отдела, "
            "остальное — у администратора компании")


# ---------- Запись ----------
_DATE_FORMATS = ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%y", "%Y.%m.%d", "%Y/%m/%d")
# Длина свободных полей профиля: защита от мусора в БД и раздутых ответов API.
FIELD_MAX = 300
NOTES_MAX = 5000


def normalize_date(value) -> Optional[str]:
    """Дата выхода в ISO (ГГГГ-ММ-ДД) из того, что приходит на практике: поле формы
    (ISO), xlsx (datetime -> «2026-05-15 00:00:00»), xls/csv («15.05.2026», «15/05/2026»).
    Нераспознанное -> None: без даты расписание просто не строится, а мусорная строка
    ломала расчёт дат, и сообщения сотруднику не приходили вовсе."""
    from datetime import date, datetime
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip().split(" ")[0].split("T")[0]
    for fmt in _DATE_FORMATS:
        try:
            parsed = datetime.strptime(text, fmt).date()
        except ValueError:
            continue
        if 1900 <= parsed.year <= 2200:
            return parsed.isoformat()
    return None


def _text(raw: dict, key: str, limit: int = FIELD_MAX) -> str:
    return str(raw.get(key) or "").strip()[:limit]


def _apply_profile(user: dict, raw: dict) -> dict:
    """Профильные и адаптационные поля. Роль, логин, пароль и статус сюда не входят:
    статус адаптации считается сам (adaptation_status), пауза — set_status."""
    phone, email = _text(raw, "phone", 64), _text(raw, "email", 254)
    if not (phone or email) and raw.get("contact"):          # старые клиенты шлют одно поле
        phone, email = split_contact(_text(raw, "contact"))
    user.update({
        "full_name": (_text(raw, "full_name") or (user.get("full_name") or "").strip()) or "Без имени",
        "position": _text(raw, "position"),
        "department": _text(raw, "department"),
        "phone": phone,
        "email": email,
        "contact": join_contact({"phone": phone, "email": email}),
        "mentor": _text(raw, "mentor"),
        "manager": _text(raw, "manager"),
        "plan_id": _text(raw, "plan_id", 64) or None,
        "plan_profession": _text(raw, "plan_profession"),
        "start_date": normalize_date(raw.get("start_date")),
        "notes": _text(raw, "notes", NOTES_MAX),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    })
    return user


def create_user(raw: dict, actor: Optional[dict] = None, role: str = ROLE_EMPLOYEE,
                active: bool = True, must_change_credentials: bool = False,
                issued_password: bool = False) -> dict:
    """
    Создаёт пользователя. Логин и пароль необязательны: администратор может завести
    профиль заранее, а логин выдать позже — войти без пароля всё равно нельзя.
    issued_password — пароль выдал администратор: храним, чтобы показать/выгрузить.
    Сотрудник пароль не меняет (только через администратора), поэтому флага
    «сменить при входе» у сотрудника не бывает.
    """
    if role == ROLE_EMPLOYEE:
        must_change_credentials = False
    username = raw.get("username")
    password = raw.get("password")

    with _lock:
        if username:
            username = normalize_username(username)
            if _username_taken(username):
                raise ValueError(f"Логин «{username}» уже занят")
        if password:
            validate_password(password)

        user = _blank_user(role=role if role in ROLES else ROLE_EMPLOYEE,
                           active=active,
                           username=username or None,
                           created_by=(actor or {}).get("id"))
        _apply_profile(user, raw)
        # Автоназначение активного общего плана: новый сотрудник без явного плана
        # сразу получает план по своей должности (неактивен, пока нет даты выхода).
        if user.get("role") == ROLE_EMPLOYEE and not user.get("plan_id"):
            try:
                import autoplan
                user["plan_id"] = autoplan.default_for_new() or None
            except Exception:
                pass
        if password:
            user["salt"], user["hash"] = hash_password(password)
            user["password_changed_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            user["must_change_credentials"] = must_change_credentials
            user["temp_password"] = password if (must_change_credentials or issued_password) else ""

        _insert(user)
    return dict(user)


def update_profile(user_id: str, raw: dict) -> Optional[dict]:
    with _lock:
        user = get_user(user_id)
        if not user:
            return None
        before = (user.get("plan_id") or "", user.get("start_date") or "")
        _apply_profile(user, raw)
        if (user.get("plan_id") or "", user.get("start_date") or "") != before:
            # Новый план или дата выхода — новое расписание: прошлые больничные к нему не
            # относятся (идущий больничный продолжается, но считается с этого момента).
            user["pauses"] = [{"start": _utc_now(), "end": None}] if user.get("status") == "paused" else []
        _save_user(user)
    return dict(user)


def set_username(user_id: str, username: str) -> dict:
    username = normalize_username(username)
    with _lock:
        user = get_user(user_id)
        if not user:
            raise ValueError("Пользователь не найден")
        _fixed(user)
        if _username_taken(username, exclude_id=user_id):
            raise ValueError(f"Логин «{username}» уже занят")
        user["username"] = username
        user["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        _save_user(user)
    return dict(user)


def set_password(user_id: str, password: str, must_change: bool = False,
                 issued: bool = False) -> dict:
    """issued — пароль выдал администратор (виден ему в списке и в Excel). Сотруднику
    флаг «сменить при входе» не ставится: пароль сотрудника меняет только администратор."""
    validate_password(password)
    salt_hex, hash_hex = hash_password(password)
    with _lock:
        user = get_user(user_id)
        if not user:
            raise ValueError("Пользователь не найден")
        _fixed(user)
        user["salt"] = salt_hex
        user["hash"] = hash_hex
        user["password_changed_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        if user.get("role") == ROLE_EMPLOYEE:
            must_change = False
        user["must_change_credentials"] = must_change
        # Выдан администратором — помним, чтобы показать; свой (админ сменил себе) — забываем.
        user["temp_password"] = password if (must_change or issued) else ""
        user["updated_at"] = user["password_changed_at"]
        _save_user(user)
    return dict(user)


def set_status(user_id: str, status: str) -> dict:
    """Сменить статус адаптации (planned/active/done/paused). Пауза = сотрудник на
    больничном: планировщик не доставляет ему сообщения плана, пока статус paused.
    Начало и конец больничного записываются в pauses — по ним сдвигается расписание
    (employees.shift_for_pauses). Снимать больничный — через messaging.set_sick: там
    расписание сдвигается раньше, чем снимается пауза."""
    if status not in ADAPTATION_STATUSES:
        raise ValueError(f"Недопустимый статус: {status}")
    with _lock:
        user = get_user(user_id)
        if not user:
            raise ValueError("Пользователь не найден")
        now = _utc_now()
        pauses = [dict(p) for p in user.get("pauses") or []]
        if status == "paused" and user.get("status") != "paused":
            pauses.append({"start": now, "end": None})
        elif status != "paused":
            pauses = _close_pauses(pauses, now)
        user.update({"status": status, "pauses": pauses, "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S")})
        _save_user(user)
    return dict(user)


def close_pause(user_id: str) -> dict:
    """Закрыть текущий больничный (конец = сейчас), не снимая статус paused: пока статус
    не снят, планировщик сотруднику ничего не выпускает — можно спокойно сдвинуть расписание."""
    with _lock:
        user = get_user(user_id)
        if not user:
            raise ValueError("Пользователь не найден")
        user["pauses"] = _close_pauses(user.get("pauses") or [], _utc_now())
        _save_user(user)
    return dict(user)


def _utc_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _close_pauses(pauses: list, now: str) -> list:
    return [{**p, "end": p.get("end") or now} for p in pauses]


def pause_periods(user: dict, now=None) -> list:
    """Больничные сотрудника [(начало, конец)] в UTC по порядку; у текущего конец = now."""
    from datetime import datetime, timezone
    now = now or datetime.now(timezone.utc)
    out = []
    for p in user.get("pauses") or []:
        try:
            start = datetime.fromisoformat(p["start"])
            end = datetime.fromisoformat(p["end"]) if p.get("end") else now
        except (KeyError, TypeError, ValueError):
            continue
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        if end > start:
            out.append((start, end))
    return sorted(out)


def paused_days(user: dict, now=None) -> int:
    """Сколько дней (с округлением вверх) сотрудник провёл на больничных."""
    seconds = sum((end - start).total_seconds() for start, end in pause_periods(user, now))
    return int(-(-seconds // 86400))


def set_credentials(user_id: str, username: Optional[str], password: str) -> dict:
    """
    Первичная настройка после входа по выданным данным: свой пароль. Логин по умолчанию
    остаётся выданным (генерируется из ФИО один раз); username передают только явно.
    """
    validate_password(password)
    salt_hex, hash_hex = hash_password(password)
    with _lock:
        user = get_user(user_id)
        if not user:
            raise ValueError("Пользователь не найден")
        _fixed(user)
        username = normalize_username(username) if username else user.get("username")
        if not username:
            raise ValueError("У пользователя нет логина — обратитесь к администратору")
        if _username_taken(username, exclude_id=user_id):
            raise ValueError(f"Логин «{username}» уже занят")
        now = time.strftime("%Y-%m-%dT%H:%M:%S")
        user.update({"username": username, "salt": salt_hex, "hash": hash_hex,
                     "must_change_credentials": False, "temp_password": "",
                     "password_changed_at": now, "updated_at": now})
        _save_user(user)
    return dict(user)


def adaptation_status(user: dict, plan: Optional[dict] = None, today=None) -> str:
    """Статус адаптации считается сам — руками его не ставят:
    приостановлен (paused: больничный, ставит сотрудник или админ) -> как есть;
    нет даты выхода или она впереди -> «Запланирован»; идёт план -> «Проходит адаптацию»;
    план (этапы от даты выхода) закончился -> «Завершил»."""
    from datetime import date, timedelta
    if user.get("status") == "paused":
        return "paused"
    try:
        start = date.fromisoformat(str(user.get("start_date") or "")[:10])
    except ValueError:
        return "planned"
    today = today or date.today()
    if today < start:
        return "planned"
    if plan:
        import planner
        days = sum(planner.stage_span_days(s.get("duration") or {})
                   for s in plan.get("stages") or [] if s.get("anchor") != "before_start")
        # Больничные продлевают план: он продолжается с того места, где остановился.
        if days and today >= start + timedelta(days=days + paused_days(user)):
            return "done"
    return "active"


def set_active(user_id: str, active: bool) -> Optional[dict]:
    with _lock:
        user = get_user(user_id)
        if not user:
            return None
        _fixed(user)
        user["active"] = bool(active)
        user["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        _save_user(user)
    return dict(user)


def set_role(user_id: str, role: str) -> dict:
    """
    Смена роли. Кто какую роль вправе выдать, решает API (assignable_roles). Здесь —
    инварианты: суперадмин один (роль owner не выдаётся и не снимается), последнего админа
    компании не понизить, роль с админ-панелью требует заданного пароля.
    """
    if role not in ROLES or role == ROLE_OWNER:
        raise ValueError("Недопустимая роль")
    with _lock:
        user = get_user(user_id)
        if not user:
            raise ValueError("Пользователь не найден")
        _fixed(user)
        if role in ADMIN_ROLES and not user.get("hash"):
            raise ValueError("У пользователя нет пароля — сначала выдайте ему логин и пароль")
        if user["role"] == ROLE_ADMIN and role != ROLE_ADMIN and _last_admin(user):
            raise ValueError("Это последний администратор компании — сначала назначьте другого")
        user["role"] = role
        user["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        _save_user(user)
    return dict(user)


def delete_user(user_id: str) -> bool:
    with _lock:
        user = get_user(user_id)
        if not user:
            return False
        _fixed(user)
        if user["role"] == ROLE_ADMIN and _last_admin(user):
            raise ValueError("Это последний администратор компании — сначала назначьте другого")
        db.execute("DELETE FROM users WHERE id = %s", (user_id,))
        provisioning.drop_login(user_id)
    return True


def is_superadmin(user: Optional[dict]) -> bool:
    return bool(user) and user.get("role") == ROLE_OWNER and user.get("username") == SUPERADMIN_USERNAME


def _fixed(user: dict):
    """Учётка суперадмина задана в коде: логин, пароль, роль и доступ через интерфейс не меняются."""
    if is_superadmin(user):
        raise ValueError("Учётная запись суперадмина задана на сервере и не меняется")


def _last_admin(user: dict) -> bool:
    """Последний активный администратор компании (без него компанией некому управлять).
    В общей схеме админы — наследие до компаний, там суперадмин и так есть."""
    if not db.current_schema():
        return False
    row = db.query("SELECT count(*) AS n FROM users WHERE role = %s AND active AND id <> %s",
                   (ROLE_ADMIN, user["id"]), "one")
    return not (row or {}).get("n")


# ---------- Регистрация сотрудника ----------
def register_employee(username: str, password: str, full_name: str,
                      position: str = "", contact: str = "") -> dict:
    """
    Самостоятельная регистрация сотрудника. По умолчанию аккаунт создаётся
    неактивным: пока администратор его не подтвердит, войти нельзя — иначе
    доступ к внутренним регламентам получил бы любой, кто открыл страницу.
    """
    return create_user(
        {"username": username, "password": password, "full_name": full_name,
         "position": position, "contact": contact},
        role=ROLE_EMPLOYEE,
        active=not REQUIRE_REGISTRATION_APPROVAL,
    )


# ---------- Суперадмин ----------
def superadmin_hash() -> tuple:
    salt, _, digest = (os.environ.get("NEIROMASTER_SUPERADMIN_HASH") or SUPERADMIN_HASH).partition(":")
    return salt, digest


def ensure_owner() -> dict:
    """
    Учётка суперадмина в общей схеме — на каждом старте приводится к заданной в коде:
    логин superadmin, хэш пароля SUPERADMIN_HASH, активна, без смены пароля при входе.
    Прочие владельцы (до появления суперадмина владелец был у каждой установки) становятся
    администраторами: данные общей схемы остаются под их управлением.
    """
    salt, digest = superadmin_hash()
    with _lock:
        user = get_by_username(SUPERADMIN_USERNAME)
        if user is None:
            user = _blank_user(role=ROLE_OWNER, active=True, username=SUPERADMIN_USERNAME)
            user["full_name"] = "Суперадмин"
            _insert(user)
        user.update({"role": ROLE_OWNER, "active": True, "salt": salt, "hash": digest,
                     "must_change_credentials": False, "temp_password": ""})
        _save_user(user)
        db.execute("UPDATE users SET role = %s WHERE role = %s AND id <> %s",
                   (ROLE_ADMIN, ROLE_OWNER, user["id"]))
    return dict(user)


# ---------- Миграции со старых форматов ----------
def _import_records(records) -> int:
    """Вставляет записи пользователей, пропуская те, чей id уже есть в БД."""
    existing = {r["id"] for r in db.query("SELECT id FROM users", (), "all")}
    moved = 0
    for rec in records:
        uid = rec.get("id") or str(uuid.uuid4())
        if uid in existing:
            continue
        user = _blank_user()
        # Переносим все известные колонки как есть (включая salt/hash/role), профиль — нормализуем
        for col in _COLUMNS:
            if col in rec and rec[col] is not None:
                user[col] = rec[col]
        user["id"] = uid
        user["active"] = bool(rec.get("active", user["active"]))
        user["must_change_credentials"] = bool(rec.get("must_change_credentials", False))
        _insert(user)
        existing.add(uid)
        moved += 1
    return moved


def migrate_admins_to_curators() -> int:
    """До разделения на компании «администратор» был админом ОТДЕЛА. Теперь это куратор, а
    admin — администратор компании. Только общая схема и один раз (метка в app_settings):
    потом админы в общей схеме законны — ими становятся прежние владельцы (ensure_owner)."""
    if db.current_schema():
        return 0
    done = db.query("INSERT INTO app_settings (key, value) VALUES ('migrated_admins_to_curators', '1') "
                    "ON CONFLICT (key) DO NOTHING RETURNING key", (), "one")
    if not done:
        return 0
    rows = db.query("UPDATE users SET role = %s WHERE role = %s RETURNING id",
                    (ROLE_CURATOR, ROLE_ADMIN)) or []
    return len(rows)


def migrate_start_dates() -> int:
    """Разово приводит даты выхода к ISO. Штатка из .xls/.csv записывала «15.05.2026» —
    такие сотрудники навсегда оставались «Запланирован» и не получали сообщений плана."""
    fixed = 0
    rows = db.query("SELECT id, start_date FROM users WHERE start_date IS NOT NULL "
                    "AND start_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'", (), "all") or []
    for r in rows:
        db.execute("UPDATE users SET start_date = %s WHERE id = %s",
                   (normalize_date(r["start_date"]), r["id"]))
        fixed += 1
    return fixed


def migrate_legacy_json_users() -> int:
    """Перенос аккаунтов из старого data/users.json в БД (разово)."""
    if not USERS_PATH.exists():
        return 0
    try:
        with open(USERS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return 0
    with _lock:
        moved = _import_records(list(data.values()))
    USERS_PATH.replace(USERS_PATH.with_suffix(".json.migrated"))
    return moved


def migrate_legacy_employees() -> int:
    """
    Переносит записи из старого data/employees.json (сотрудники без аккаунтов)
    в общее хранилище. Логин и пароль администратор выдаёт им уже в админке.
    """
    if not LEGACY_EMPLOYEES_PATH.exists():
        return 0
    try:
        with open(LEGACY_EMPLOYEES_PATH, "r", encoding="utf-8") as f:
            legacy = json.load(f)
    except (json.JSONDecodeError, OSError):
        return 0
    if not legacy:
        LEGACY_EMPLOYEES_PATH.unlink(missing_ok=True)
        return 0

    with _lock:
        existing = {r["id"] for r in db.query("SELECT id FROM users", (), "all")}
        moved = 0
        for employee in legacy.values():
            if employee.get("id") in existing:
                continue
            user = _blank_user(id=employee.get("id") or str(uuid.uuid4()), role=ROLE_EMPLOYEE)
            _apply_profile(user, employee)
            user["created_at"] = employee.get("created_at") or user["created_at"]
            _insert(user)
            moved += 1

    LEGACY_EMPLOYEES_PATH.replace(LEGACY_EMPLOYEES_PATH.with_suffix(".json.migrated"))
    return moved


if __name__ == "__main__":
    # Проверка шифрования ПДн без БД: round-trip, префикс, обратная совместимость.
    from cryptography.fernet import Fernet as _F
    _key = _F.generate_key().decode()
    os.environ["NEIROMASTER_PII_KEY"] = _key
    _ct = _encrypt_field("Иванов Иван")
    assert _ct.startswith(_PII_PREFIX) and _ct != "Иванов Иван"
    assert _decrypt_field(_ct) == "Иванов Иван"
    assert _decrypt_field("открытый текст") == "открытый текст"   # старое поле не трогаем
    assert _encrypt_field("") == "" and _decrypt_field("") == ""  # пустое не шифруем
    assert _encrypt_field(_ct) == _ct        # повторно не шифруем
    os.environ["NEIROMASTER_PII_KEY"] = "off"
    assert _decrypt_field(_ct) == _ct        # без ключа не падаем, отдаём шифртекст
    os.environ["NEIROMASTER_PII_KEY"] = _key
    print("OK: шифрование ПДн — round-trip, префикс, совместимость со старыми строками")

    # Папки хранилища и видимость по отделу
    assert dir_slug({"username": "ivanov", "id": "x"}) == "ivanov"
    assert dir_slug({"id": "abcdef123456"}) == "user-abcdef12"
    assert dir_slug(None) == "_common"
    _owner = {"id": "o", "role": ROLE_OWNER, "department": ""}
    _adm = {"id": "a", "role": ROLE_CURATOR, "department": "Логистика"}   # куратор отдела
    _all = [_owner, _adm, {"id": "e1", "role": ROLE_EMPLOYEE, "department": "логистика"},
            {"id": "e2", "role": ROLE_EMPLOYEE, "department": "Сварка"},
            {"id": "e3", "role": ROLE_EMPLOYEE, "department": ""}]
    assert len(visible_users(_owner, _all)) == 5
    assert {u["id"] for u in visible_users(_adm, _all)} == {"a", "e1"}   # свой отдел + сам
    assert {u["id"] for u in visible_users({"id": "a2", "role": ROLE_CURATOR, "department": ""}, _all)} == set()
    # управление: свой отдел (сотрудники и кураторы) — да, чужой отдел и админ — нет, себя — да
    assert can_manage(_adm, _all[2]) and not can_manage(_adm, _all[3])
    assert can_manage(_adm, {"id": "a9", "role": ROLE_CURATOR, "department": "Логистика"})
    assert not can_manage(_adm, {"id": "a8", "role": ROLE_CURATOR, "department": "Сварка"})
    assert not can_manage(_adm, {"id": "a7", "role": ROLE_ADMIN, "department": "Логистика"})
    assert can_manage(_adm, _adm) and can_manage(_owner, _all[3])
    # админ компании: вся компания; кураторы и сотрудники — да, суперадмин — нет
    _cadm = {"id": "c", "role": ROLE_ADMIN, "department": ""}
    assert len(visible_users(_cadm, _all)) == 5
    assert can_manage(_cadm, _adm) and can_manage(_cadm, _all[3]) and not can_manage(_cadm, _owner)
    assert can_manage(_cadm, {"id": "c2", "role": ROLE_ADMIN})
    assert assignable_roles(_cadm) == (ROLE_ADMIN, ROLE_CURATOR, ROLE_EMPLOYEE)
    assert assignable_roles(_adm) == (ROLE_CURATOR, ROLE_EMPLOYEE) and assignable_roles(_all[2]) == ()
    # суперадмин из кода: хэш разбирается, учётку через интерфейс не поменять
    assert all(len(x) in (32, 64) for x in superadmin_hash())
    _sa = {"id": "s", "role": ROLE_OWNER, "username": SUPERADMIN_USERNAME}
    assert is_superadmin(_sa) and not is_superadmin(_owner)
    try:
        _fixed(_sa)
        assert False
    except ValueError:
        pass
    # документы: свои — да, чужие и «ничьи» — только суперадмину
    _docs = [{"filename": "own.pdf", "uploaded_by": "a"},
             {"filename": "alien.pdf", "uploaded_by": "a2"},
             {"filename": "legacy.pdf"}]
    assert [d["filename"] for d in visible_docs(_adm, _docs)] == ["own.pdf"]
    assert len(visible_docs(_owner, _docs)) == 3 and len(visible_docs(_cadm, _docs)) == 3
    # общие документы админа компании куратор видит, но не правит
    _shared = {"filename": "common.pdf", "uploaded_by": "c", "uploaded_by_role": ROLE_ADMIN}
    assert can_see_doc(_adm, _shared) and not can_edit_doc(_adm, _shared)
    print("OK: dir_slug, видимость людей и документов, управление по отделу")

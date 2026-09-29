"""
llmkeys.py — пул ключей DeepSeek: их может быть несколько, каждый вызов модели (ответ
ассистента, разметка документа, генерация плана — всё идёт через deepseek.chat) берёт
СВОБОДНЫЙ ключ — с наименьшим числом запросов в полёте. Так компании не ждут друг друга
на одном ключе и не упираются в его лимит.

Ключи добавляет суперадмин на /globaltest. Хранятся в public.llm_keys зашифрованными тем же
ключом, что ПДн (users._encrypt_field); наружу отдаётся только хвост «…abcd». DEEPSEEK_API_KEY
из окружения — тоже ключ пула (id «env»), не удаляется из интерфейса.

Ключ, на который DeepSeek ответил 401/402 (неверный, кончились деньги), выключается на час,
429 (лимит) — на минуту; остальные подхватывают работу. Ошибка видна на /globaltest.
Запросы в полёте считаются в Redis (общий счёт на все процессы), без Redis — в процессе.
"""
import contextlib
import os
import threading
import time

import db

ENV_ID = "env"
COOLDOWN = {401: 3600, 402: 3600, 403: 3600, 429: 60}
_CACHE_TTL = 20
_cache = {"at": 0.0, "keys": []}
_local_inflight: dict = {}
_lock = threading.Lock()

# Таблица public.llm_keys — db.PUBLIC_STATEMENTS.


def _env_key() -> str:
    key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    return "" if (not key or key.startswith("sk-клю") or key in ("sk-ключ", "sk-key")) else key


def _redis():
    try:
        from redis_conn import get_redis
        return get_redis()
    except Exception:
        return None


def _q(sql: str, params: tuple = (), fetch: str = "all"):
    """Пул общий на систему — таблица в public, из какой бы компании ни шёл вызов."""
    return db.query(sql, params, fetch)


# ---------- Управление (суперадмин) ----------
def add(label: str, key: str) -> dict:
    import users
    key = (key or "").strip()
    if not key.startswith("sk-") or len(key) < 20 or len(key) > 200:
        raise ValueError("Ключ DeepSeek начинается с «sk-»")
    row = _q("INSERT INTO public.llm_keys (label, key_enc, tail) VALUES (%s, %s, %s) RETURNING id",
             ((label or "").strip()[:100], users._encrypt_field(key), key[-4:]), "one")
    _cache["at"] = 0
    return {"id": row["id"]}


def update(key_id: int, active: bool | None = None, label: str | None = None) -> bool:
    sets, params = [], []
    if active is not None:
        sets += ["active = %s", "disabled_until = NULL", "last_error = NULL"] if active else ["active = %s"]
        params.append(bool(active))
    if label is not None:
        sets.append("label = %s")
        params.append(label.strip()[:100])
    if not sets:
        return False
    rows = _q(f"UPDATE public.llm_keys SET {', '.join(sets)} WHERE id = %s RETURNING id", (*params, key_id))
    _cache["at"] = 0
    return bool(rows)


def remove(key_id: int) -> bool:
    rows = _q("DELETE FROM public.llm_keys WHERE id = %s RETURNING id", (key_id,))
    _cache["at"] = 0
    return bool(rows)


def listing(with_balance: bool = False) -> list:
    """Ключи для /globaltest — без самих ключей: подпись, хвост, состояние, нагрузка, баланс."""
    rows = _q("SELECT id, label, tail, active, created_at, last_used_at, calls, last_error, "
              "disabled_until, disabled_until > now() AS cooling FROM public.llm_keys ORDER BY id") or []
    out = [{**r, "id": str(r["id"]), "created_at": str(r["created_at"]), "last_used_at": str(r["last_used_at"] or ""),
            "disabled_until": str(r["disabled_until"] or ""), "cooling": bool(r["cooling"]), "source": "db"}
           for r in rows]
    env = _env_key()
    if env:
        st = _env_state()
        out.insert(0, {"id": ENV_ID, "label": "DEEPSEEK_API_KEY (.env)", "tail": env[-4:], "active": True,
                       "source": "env", "calls": st.get("calls", 0), "last_error": st.get("error"),
                       "cooling": st.get("until", 0) > time.time(), "created_at": "", "last_used_at": "",
                       "disabled_until": ""})
    for k in out:
        k["inflight"] = _inflight(k["id"])
    if with_balance:
        import deepseek
        keys = {k: v for k, v in _all_keys()}
        for k in out:
            try:
                k["balance"] = deepseek.balance(api_key=keys.get(k["id"]))
            except Exception as e:
                k["balance"] = {"error": str(e)[:200]}
    return out


# ---------- Выбор ключа ----------
def _all_keys() -> list:
    """[(id, ключ)] всех ключей, включая выключенные — для баланса."""
    import users
    out = [(ENV_ID, _env_key())] if _env_key() else []
    for r in _q("SELECT id, key_enc FROM public.llm_keys ORDER BY id") or []:
        out.append((str(r["id"]), users._decrypt_field(r["key_enc"])))
    return out


def _usable() -> list:
    """[(id, ключ)] рабочих ключей: включён и не на паузе. Кэш на процесс — на каждый вызов не ходим в БД."""
    now = time.time()
    with _lock:
        if now - _cache["at"] > _CACHE_TTL:
            import users
            try:
                rows = _q("SELECT id, key_enc FROM public.llm_keys WHERE active "
                          "AND (disabled_until IS NULL OR disabled_until < now()) ORDER BY id") or []
            except Exception:
                rows = []                          # таблицы ещё нет — только ключ из окружения
            _cache["keys"] = [(str(r["id"]), users._decrypt_field(r["key_enc"])) for r in rows]
            _cache["at"] = now
        keys = list(_cache["keys"])
    if _env_key() and _env_state().get("until", 0) <= now:
        keys.insert(0, (ENV_ID, _env_key()))
    return keys


def _inflight(key_id: str) -> int:
    r = _redis()
    if r is not None:
        try:
            return int(r.hget("nm:llm:inflight", key_id) or 0)
        except Exception:
            pass
    return _local_inflight.get(key_id, 0)


def _bump(key_id: str, delta: int):
    r = _redis()
    if r is not None:
        try:
            r.hincrby("nm:llm:inflight", key_id, delta)
            return
        except Exception:
            pass
    with _lock:
        _local_inflight[key_id] = max(0, _local_inflight.get(key_id, 0) + delta)


def pick(exclude: set = frozenset()) -> tuple:
    """(id, ключ) — свободный: наименьше запросов в полёте, при равенстве — дольше не
    использовался (по кругу). Нет ни одного рабочего — RuntimeError."""
    keys = [k for k in _usable() if k[0] not in exclude] or _usable()
    if not keys:
        raise RuntimeError("Нет рабочего ключа DeepSeek: добавьте ключ на /globaltest или DEEPSEEK_API_KEY в .env")
    return min(keys, key=lambda k: (_inflight(k[0]), _last_used(k[0])))


def _last_used(key_id: str) -> float:
    return _local_last.get(key_id, 0.0)


_local_last: dict = {}


@contextlib.contextmanager
def lease(exclude: set = frozenset()):
    """Взять свободный ключ на время одного запроса."""
    key_id, key = pick(exclude)
    _bump(key_id, 1)
    _local_last[key_id] = time.time()
    try:
        yield key_id, key
    finally:
        _bump(key_id, -1)


def report(key_id: str, status: int, text: str = ""):
    """Итог запроса: 200 — счётчик вызовов; 401/402/403/429 — ключ на паузу (COOLDOWN)."""
    pause = COOLDOWN.get(status)
    if key_id == ENV_ID:
        st = _env_state()
        st["calls"] = st.get("calls", 0) + (status == 200)
        if pause:
            st.update(until=time.time() + pause, error=f"{status}: {text[:200]}")
        return
    try:
        if pause:
            _q("UPDATE public.llm_keys SET disabled_until = now() + make_interval(secs => %s), "
               "last_error = %s WHERE id = %s RETURNING id", (pause, f"{status}: {text[:200]}", int(key_id)))
            with _lock:
                _cache["at"] = 0
        elif status == 200:
            _q("UPDATE public.llm_keys SET calls = calls + 1, last_used_at = now() WHERE id = %s RETURNING id",
               (int(key_id),))
    except Exception:
        pass                                   # учёт не мешает ответу


_env = {}


def _env_state() -> dict:
    return _env


if __name__ == "__main__":
    # Выбор без БД и Redis: свободнее тот, у кого меньше запросов в полёте.
    _redis = lambda: None                      # noqa: E731
    _cache.update(at=time.time() + 3600, keys=[("1", "sk-a"), ("2", "sk-b")])
    os.environ.pop("DEEPSEEK_API_KEY", None)
    with lease() as (a, _):
        with lease() as (b, _):
            assert {a, b} == {"1", "2"}, "второй запрос — на другой ключ"
    assert _inflight("1") == _inflight("2") == 0
    _cache["keys"] = []
    try:
        pick()
        assert False
    except RuntimeError:
        pass
    print("OK: llmkeys")

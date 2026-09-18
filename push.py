"""
Push-уведомления на устройства сотрудников через Expo Push API.

Приложение сотрудника — на Expo (mobile/), поэтому шлём не напрямую в APNs/FCM, а
через шлюз Expo (https://exp.host/--/api/v2/push/send): один HTTP-вызов, Expo сам
доставляет в нужную платформу. Токен устройства (ExponentPushToken[...]) клиент
получает через expo-notifications и регистрирует у нас (POST /api/my/push-token).

Отправка — best-effort: сбой сети/Expo НЕ должен ронять доставку в инбокс (инбокс —
источник правды, пуш лишь дублирует). Протухшие токены (DeviceNotRegistered) чистим.

ponytail: без внешней очереди/ретраев — прямой вызов пачками по 100 из планировщика.
Понадобится надёжность — вынести в RQ-задачу.
"""

import requests

import db

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
_BATCH = 100
_TIMEOUT = 15


# ---------- Хранилище токенов ----------
def register_token(user_id: str, token: str, platform: str = "") -> bool:
    """Привязать/обновить push-токен устройства к сотруднику. token уникален (PK):
    если он уже был у другого пользователя (сменили аккаунт на устройстве) —
    переназначаем на текущего."""
    token = (token or "").strip()
    if not token:
        return False
    db.execute(
        "INSERT INTO push_tokens (token, user_id, platform) VALUES (%s, %s, %s) "
        "ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, "
        "platform = EXCLUDED.platform, updated_at = now()",
        (token, user_id, (platform or "")[:32]),
    )
    return True


def remove_token(token: str) -> None:
    token = (token or "").strip()
    if token:
        db.execute("DELETE FROM push_tokens WHERE token = %s", (token,))


def tokens_for_users(user_ids) -> dict:
    """{user_id: [token, ...]} для набора сотрудников. Пустой набор -> {}."""
    ids = [u for u in set(user_ids or []) if u]
    if not ids:
        return {}
    rows = db.query("SELECT user_id, token FROM push_tokens WHERE user_id = ANY(%s)", (ids,)) or []
    out: dict = {}
    for r in rows:
        out.setdefault(r["user_id"], []).append(r["token"])
    return out


# ---------- Отправка ----------
def _post_batch(messages: list) -> list:
    """Один POST в Expo (<=100 сообщений). Возвращает список тикетов data[] (или [] при сбое)."""
    try:
        resp = requests.post(EXPO_PUSH_URL, json=messages, timeout=_TIMEOUT,
                             headers={"Content-Type": "application/json",
                                      "Accept": "application/json"})
        resp.raise_for_status()
        return (resp.json() or {}).get("data") or []
    except Exception as e:
        print(f"[push] отправка не удалась ({len(messages)} шт.): {e}")
        return []


def notify(items: list) -> int:
    """items — [{user_id, title, body, data?}]. Разворачивает в токены устройств и шлёт
    пачками. Протухшие токены (DeviceNotRegistered) удаляет. Возвращает число успешных
    тикетов. Ошибки не поднимает — доставка в инбокс важнее пуша."""
    if not items:
        return 0
    by_user = tokens_for_users([it.get("user_id") for it in items])
    if not by_user:
        return 0

    messages, token_of = [], []
    for it in items:
        for tok in by_user.get(it.get("user_id"), []):
            messages.append({
                "to": tok,
                "title": (it.get("title") or "НейроМастер")[:120],
                "body": (it.get("body") or "")[:400],
                "sound": "default",
                "data": it.get("data") or {},
            })
            token_of.append(tok)
    if not messages:
        return 0

    ok = 0
    for start in range(0, len(messages), _BATCH):
        chunk = messages[start:start + _BATCH]
        toks = token_of[start:start + _BATCH]
        tickets = _post_batch(chunk)
        for i, ticket in enumerate(tickets):
            if ticket.get("status") == "ok":
                ok += 1
            elif (ticket.get("details") or {}).get("error") == "DeviceNotRegistered" and i < len(toks):
                remove_token(toks[i])   # приложение удалено/токен мёртв — чистим
    return ok

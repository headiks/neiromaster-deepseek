"""
Проверка сборки payload и обработки тикетов push.notify без сети и БД.
Заглушки db/requests ставятся ДО импорта push (см. test_stubs).
Запуск: python test_push.py
"""
import sys
import test_stubs

test_stubs.install()   # db (пустышка) + requests(.exceptions) + config

import push

# Управляемый db-стаб: notify берёт токены через tokens_for_users -> db.query.
_removed = []
sys.modules["db"].query = lambda *a, **k: [{"user_id": "u1", "token": "ExponentPushToken[AAA]"}]
sys.modules["db"].execute = lambda *a, **k: _removed.append(a)


def test_notify_builds_payload_and_counts():
    sent = {}
    push._post_batch = lambda msgs: (sent.update(msgs=msgs), [{"status": "ok"}])[1]
    n = push.notify([{"user_id": "u1", "title": "T", "body": "B", "data": {"id": "x"}}])
    assert n == 1, n
    m = sent["msgs"][0]
    assert m["to"] == "ExponentPushToken[AAA]"
    assert m["title"] == "T" and m["body"] == "B" and m["data"] == {"id": "x"}
    assert m["sound"] == "default"


def test_notify_prunes_dead_token():
    _removed.clear()
    push._post_batch = lambda msgs: [{"status": "error", "details": {"error": "DeviceNotRegistered"}}]
    push.notify([{"user_id": "u1", "title": "T", "body": "B"}])
    # мёртвый токен вычищен (db.execute вызван с DELETE и токеном)
    assert any("DELETE FROM push_tokens" in a[0] for a in _removed), _removed


def test_notify_empty():
    assert push.notify([]) == 0


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn(); print("OK ", name)
    print("test_push: все проверки пройдены")

"""Доставка сообщений плана: тестовые уведомления больше не блокируют рассылку плана,
несгенерированные сообщения не уходят пустыми, тип и структура сообщения сохраняются.
Без БД: db подменён записывающей заглушкой."""
import test_stubs
test_stubs.install(psycopg=True, stub_modules=())
import sys  # noqa: E402

import messaging  # noqa: E402

MSG = {"message_id": "st1.s1", "schedule": {"send_at": "2026-09-10T09:00"},
       "stage": {"id": "st1", "title": "Первый день"},
       "substage": {"id": "s1", "title": "Чек-лист", "kind": "checklist"},
       "content": {"text": "Сделайте:", "converted": {"type": "checklist", "items": [{"id": "i1", "text": "Пропуск"}]}}}


def test_row_keeps_kind_and_structure():
    row = messaging._message_row("e1", "p1", MSG, "Europe/Moscow")
    assert row["kind"] == "checklist" and row["payload"]["items"][0]["text"] == "Пропуск"


def test_not_generated_message_is_not_sent_empty():
    empty = {**MSG, "content": {"text": ""}}
    assert messaging._message_row("e1", "p1", empty, "Europe/Moscow") is None


def test_test_notification_does_not_block_plan(monkeypatch):
    # у сотрудника есть только строка теста (plan_id NULL) -> план всё равно материализуется
    monkeypatch.setattr(messaging.db, "query", lambda sql, *a, **k: [], raising=False)
    made = []
    monkeypatch.setattr(messaging, "materialize_employee", lambda u, force=False: made.append(u["id"]) or 1)
    monkeypatch.setattr(messaging.users, "list_users", lambda: [
        {"id": "e1", "role": "employee", "plan_id": "p1", "start_date": "2026-09-10"},
        {"id": "e2", "role": "employee", "plan_id": None, "start_date": "2026-09-10"}])
    assert messaging.ensure_all() == 1 and made == ["e1"]
    # запрос «кто уже материализован» учитывает только строки плана
    seen = []
    monkeypatch.setattr(messaging.db, "query", lambda sql, *a, **k: seen.append(sql) or [])
    messaging.ensure_all()
    assert "plan_id IS NOT NULL" in seen[0]


def test_push_body_hints_interactive_kinds():
    assert messaging.push_body("quiz", "Вопросы").startswith("Мини-тест")
    assert messaging.push_body("message", "Привет") == "Привет"


def test_every_kind_has_sample():
    import json
    cat = json.load(open("data/stage_catalog.json", encoding="utf-8"))
    assert {k["id"] for k in cat["substage_kinds"]} <= set(messaging._SAMPLE)

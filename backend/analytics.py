"""
analytics.py — контроль мини-тестов адаптации и аналитика вопросов сотрудников.

Тесты: по каждому доставленному мини-тесту плана — сдан (верных ≥ PASS), не сдан, не пройден
(нет ответов дольше OVERDUE_DAYS) или ждёт ответа. Пересдача — администратор очищает ответы.

Вопросы: каждый вопрос ассистенту и кнопкам «Написать…» пишется в ask_log (текст зашифрован).
Категория — организационный или рабочий вопрос: сначала по ключевым словам, неясные — пачкой
через модель (обезличивание — в deepseek.chat), при недоступности модели остаются «не определено».
"""
import json
import re
from datetime import datetime, timedelta, timezone

import db
import users

PASS = 0.7
OVERDUE_DAYS = 2
CATEGORIES = {"org": "Организационные", "work": "Рабочие"}
OUTCOMES = {"answered": "Ответил ассистент", "escalated": "Передан специалисту",
            "no_answer": "Нет ответа", "to_person": "Написал наставнику / руководителю / в отдел кадров"}

_ORG = re.compile(
    r"зарплат|аванс|оклад|преми|выплат|отпуск|больнич|график|смен[аыуе]\b|выходн|пропуск|проходн|"
    r"столов|обед|питани|спецодежд|\bсиз\b|документ|справк|договор|трудов\w* книж|оформ|кадр|"
    r"медосмотр|медкомисс|страхов|парковк|автобус|транспорт|доехать|добрат|раздевалк|шкафчик|"
    r"общежит|льгот|компенсац|отгул|опоздан|увольн|испытательн|где наход|кому обрати|телефон")
_WORK = re.compile(
    r"станок|станк|оборуд|инструмент|технолог|операци|чертеж|чертёж|детал|наряд|норм[аыу]\b|выработ|"
    r"брак|качеств|сварк|сварн|ремонт|маршрут|рейс|погрузк|разгрузк|материал|сырь|наладк|настрой|"
    r"режим работ|охран\w* труда|техник\w* безопасн|инструктаж|допуск|аттестац|экзамен|обязанност|"
    r"как правильно|порядок работ|процесс|смазк|электр|кран\b|погрузчик|пульт|программ")


# ---------- Тесты ----------
def quiz_status(right: int, answered: int, total: int, delivered_at, now=None) -> str:
    """'passed' | 'failed' | 'overdue' (не пройден) | 'waiting'."""
    if answered and total:
        return "passed" if right / total >= PASS else "failed"
    now = now or datetime.now(timezone.utc)
    if delivered_at and now - delivered_at > timedelta(days=OVERDUE_DAYS):
        return "overdue"
    return "waiting"


def tests(employee_ids: list) -> list:
    """Мини-тесты плана сотрудников: [{id, employee_id, title, delivered_at, right, total, status}]."""
    import stats
    ids = [i for i in set(employee_ids or []) if i]
    if not ids:
        return []
    rows = db.query("SELECT id, employee_id, title, payload, answers, delivered_at FROM scheduled_messages "
                    "WHERE kind = 'quiz' AND plan_id IS NOT NULL AND status IN ('delivered', 'read') "
                    "AND employee_id = ANY(%s) ORDER BY delivered_at", (ids,)) or []
    out = []
    for r in rows:
        right, answered, total = stats.quiz_score(r["payload"], r["answers"])
        out.append({"id": r["id"], "employee_id": r["employee_id"],
                    "title": " · ".join(p for p in str(r["title"] or "").split(" — ") if p),
                    "delivered_at": str(r["delivered_at"] or ""), "right": right, "answered": answered,
                    "total": total, "status": quiz_status(right, answered, total, r["delivered_at"])})
    return out


def retake(row_id: str) -> str | None:
    """Пересдача: ответы теста очищаются. -> employee_id или None (не тест / не найден)."""
    row = db.query("UPDATE scheduled_messages SET answers = NULL, updated_at = now() "
                   "WHERE id = %s AND kind = 'quiz' RETURNING employee_id", (row_id,), "one")
    return row["employee_id"] if row else None


# ---------- Вопросы ----------
def log_question(user: dict, question: str, outcome: str):
    """Сбой журнала не мешает ответу сотруднику."""
    try:
        db.execute("INSERT INTO ask_log (user_id, question, outcome, category) VALUES (%s, %s, %s, %s)",
                   (user.get("id"), users._encrypt_field((question or "").strip()[:2000]),
                    outcome if outcome in OUTCOMES else "answered", classify(question)))
    except Exception as e:
        print(f"[analytics] вопрос не записан: {e}")


def classify(text: str) -> str | None:
    """По ключевым словам: 'org' | 'work' | None (неясно — решит модель)."""
    low = (text or "").lower().replace("ё", "е")
    org, work = len(_ORG.findall(low)), len(_WORK.findall(low))
    return "org" if org > work else "work" if work > org else None


_CLASSIFY_SYSTEM = """Раздели вопросы новых сотрудников завода на две группы:
org — организационные: оформление, документы, зарплата, график, пропуск, питание, транспорт,
спецодежда, льготы, к кому обратиться;
work — рабочие: как выполнять работу, оборудование, технология, нормы, качество, охрана труда
на рабочем месте, обучение профессии.
Верни JSON: {"1": "org", "2": "work", ...} — по номеру каждого вопроса."""


def classify_pending(limit: int = 100) -> int:
    """Вопросы без категории -> модель, пачкой. -> сколько размечено."""
    rows = db.query("SELECT id, question FROM ask_log WHERE category IS NULL ORDER BY id DESC LIMIT %s",
                    (limit,)) or []
    if not rows:
        return 0
    texts = [users._decrypt_field(r["question"]) or "" for r in rows]
    try:
        import deepseek
        raw = deepseek.chat(_CLASSIFY_SYSTEM, "\n".join(f"{i + 1}. {t[:300]}" for i, t in enumerate(texts)),
                            json_mode=True, max_tokens=20 * len(rows) + 50, retries=1)
        picks = json.loads(raw)
    except Exception as e:
        print(f"[analytics] вопросы не размечены моделью: {e}")
        return 0
    n = 0
    for i, r in enumerate(rows):
        cat = picks.get(str(i + 1))
        if cat in CATEGORIES:
            db.execute("UPDATE ask_log SET category = %s WHERE id = %s", (cat, r["id"]))
            n += 1
    return n


def questions(employee_ids: list, days: int = 30) -> dict:
    """Сводка и список вопросов сотрудников за days дней."""
    ids = [i for i in set(employee_ids or []) if i]
    if not ids:
        return {"total": 0, "by_category": {}, "by_outcome": {}, "by_employee": {}, "items": []}
    classify_pending()
    rows = db.query("SELECT id, ts, user_id, question, outcome, category FROM ask_log "
                    "WHERE user_id = ANY(%s) AND ts > now() - make_interval(days => %s) ORDER BY ts DESC",
                    (ids, max(1, min(int(days), 365)))) or []
    by_cat, by_out, by_emp, items = {}, {}, {}, []
    for r in rows:
        cat = r["category"] or "unknown"
        by_cat[cat] = by_cat.get(cat, 0) + 1
        by_out[r["outcome"]] = by_out.get(r["outcome"], 0) + 1
        e = by_emp.setdefault(r["user_id"], {"total": 0, "org": 0, "work": 0, "unknown": 0, "unanswered": 0})
        e["total"] += 1
        e[cat] = e.get(cat, 0) + 1
        e["unanswered"] += r["outcome"] in ("escalated", "no_answer")
        if len(items) < 300:
            items.append({"id": r["id"], "ts": str(r["ts"]), "user_id": r["user_id"], "category": cat,
                          "outcome": r["outcome"], "question": users._decrypt_field(r["question"]) or ""})
    return {"total": len(rows), "by_category": by_cat, "by_outcome": by_out, "by_employee": by_emp,
            "items": items}


if __name__ == "__main__":
    now = datetime(2026, 1, 10, tzinfo=timezone.utc)
    assert quiz_status(3, 3, 3, now, now) == "passed" and quiz_status(2, 3, 3, now, now) == "failed"
    assert quiz_status(7, 10, 10, now, now) == "passed"                  # ровно порог — сдан
    assert quiz_status(0, 0, 3, now - timedelta(days=3), now) == "overdue"
    assert quiz_status(0, 0, 3, now - timedelta(hours=5), now) == "waiting"
    assert classify("Когда выдают аванс и зарплату?") == "org"
    assert classify("Как правильно настроить станок перед сменой работы?") == "work"
    assert classify("Где получить спецодежду?") == "org"
    assert classify("Что делать при нарушении техники безопасности на участке?") == "work"
    assert classify("Привет") is None
    print("OK: analytics")

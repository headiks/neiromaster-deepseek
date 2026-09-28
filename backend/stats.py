"""
stats.py — статистика сотрудника для администратора и куратора: какой этап он проходит,
как сдаёт тесты и насколько вовлечён (как быстро открывает новые сообщения и читает ли их
или только пролистывает).

Источник — строки инбокса scheduled_messages (только сообщения плана, plan_id не пустой):
  - status/delivered_at/read_at — доставлено и когда отмечено прочитанным;
  - first_view_at/view_ms — когда сообщение впервые оказалось на экране и сколько всего мс
    оно там провело (кабинет на сайте и приложение шлют POST /api/my/messages/{id}/view);
  - payload/answers — вопросы теста с правильными вариантами и ответы сотрудника.

Качество чтения: время на экране против ожидаемого времени чтения текста (≈180 слов в
минуту, слово ≈ 6,5 символа, не меньше 3 с): ≥ 50 % — «читает», 20–50 % — «бегло»,
меньше — «пролистывает».
"""
import db

WPM = 180
CHARS_PER_WORD = 6.5
MIN_EXPECTED_MS = 3000
MAX_VIEW_MS = 600_000            # одна отправка просмотра не засчитывает больше 10 минут
READ_OK, READ_SKIM = 0.5, 0.2
FAST_H, SLOW_H = 1, 48           # реакция за час — отлично, за двое суток и дольше — ноль

_EXPECTED = (f"greatest({MIN_EXPECTED_MS}, length(body) * 60000.0 / ({WPM} * {CHARS_PER_WORD}))")
_SHOWN = "status IN ('delivered', 'read')"


def expected_ms(text: str) -> int:
    return int(max(MIN_EXPECTED_MS, len(text or "") * 60000 / (WPM * CHARS_PER_WORD)))


def reading(view_ms: int, expected: int) -> str | None:
    """'read' | 'skim' | 'scroll'; None — сообщение ещё не было на экране."""
    if not view_ms:
        return None
    ratio = view_ms / max(1, expected)
    return "read" if ratio >= READ_OK else "skim" if ratio >= READ_SKIM else "scroll"


def quiz_score(payload: dict | None, answers: dict | None) -> tuple:
    """(верных, отвечено, всего вопросов) по одному тесту."""
    qs = (payload or {}).get("questions") or []
    answers = answers or {}
    right = answered = 0
    for q in qs:
        chosen = answers.get(q.get("id"))
        if not chosen:
            continue
        answered += 1
        right += any(o.get("id") == chosen and o.get("correct") for o in q.get("options") or [])
    return right, answered, len(qs)


def engagement(delivered: int, read: int, viewed: int, read_well: int, skimmed: int,
               reaction_s: float | None) -> int | None:
    """Балл 0–100: доля прочитанных (40), качество чтения (30), скорость реакции (30)."""
    if not delivered:
        return None
    share = read / delivered
    quality = (read_well + 0.5 * skimmed) / viewed if viewed else share
    if reaction_s is None:
        speed = 0.0
    else:
        hours = reaction_s / 3600
        speed = 1.0 if hours <= FAST_H else max(0.0, 1 - (hours - FAST_H) / (SLOW_H - FAST_H))
    return round(100 * (0.4 * share + 0.3 * quality + 0.3 * speed))


def _stage(title: str | None) -> str:
    return " · ".join(p for p in str(title or "").split(" — ") if p)


def summary(employee_ids: list) -> dict:
    """{employee_id: сводка} — одной выборкой на всех (список людей в админке)."""
    ids = [i for i in set(employee_ids or []) if i]
    if not ids:
        return {}
    rows = db.query(f"""
        SELECT employee_id,
               count(*) AS total,
               count(*) FILTER (WHERE {_SHOWN}) AS delivered,
               count(*) FILTER (WHERE status = 'read') AS read,
               count(*) FILTER (WHERE view_ms > 0) AS viewed,
               count(*) FILTER (WHERE view_ms > 0 AND view_ms >= {READ_OK} * {_EXPECTED}) AS read_well,
               count(*) FILTER (WHERE view_ms > 0 AND view_ms < {READ_OK} * {_EXPECTED}
                                AND view_ms >= {READ_SKIM} * {_EXPECTED}) AS skimmed,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM
                   coalesce(first_view_at, read_at) - delivered_at))
                   FILTER (WHERE {_SHOWN} AND coalesce(first_view_at, read_at) IS NOT NULL
                           AND delivered_at IS NOT NULL) AS reaction_s,
               (array_agg(title ORDER BY send_at DESC) FILTER (WHERE {_SHOWN}))[1] AS current
        FROM scheduled_messages
        WHERE plan_id IS NOT NULL AND employee_id = ANY(%s)
        GROUP BY employee_id""", (ids,)) or []
    quizzes = db.query("SELECT employee_id, payload, answers FROM scheduled_messages "
                       f"WHERE plan_id IS NOT NULL AND kind = 'quiz' AND {_SHOWN} "
                       "AND employee_id = ANY(%s)", (ids,)) or []
    tests: dict = {}
    for q in quizzes:
        right, answered, _ = quiz_score(q["payload"], q["answers"])
        t = tests.setdefault(q["employee_id"], {"given": 0, "passed": 0, "right": 0, "answered": 0})
        t["given"] += 1
        t["passed"] += answered > 0
        t["right"] += right
        t["answered"] += answered
    out = {}
    for r in rows:
        t = tests.get(r["employee_id"]) or {"given": 0, "passed": 0, "right": 0, "answered": 0}
        reaction = float(r["reaction_s"]) if r["reaction_s"] is not None else None
        out[r["employee_id"]] = {
            "stage": _stage(r["current"]),
            "progress": round(r["delivered"] / r["total"], 3) if r["total"] else 0,
            "delivered": r["delivered"], "total": r["total"], "read": r["read"],
            "reaction_min": round(reaction / 60) if reaction is not None else None,
            "reading": {"read": r["read_well"], "skim": r["skimmed"],
                        "scroll": r["viewed"] - r["read_well"] - r["skimmed"]},
            "tests": {"given": t["given"], "passed": t["passed"],
                      "percent": round(100 * t["right"] / t["answered"]) if t["answered"] else None},
            "engagement": engagement(r["delivered"], r["read"], r["viewed"], r["read_well"],
                                     r["skimmed"], reaction),
        }
    return out


def detail(employee_id: str, limit: int = 30) -> dict:
    """Сводка + последние доставленные сообщения: когда открыл, сколько читал, тесты."""
    rows = db.query(f"SELECT id, title, kind, body, payload, answers, status, delivered_at, read_at, "
                    f"first_view_at, view_ms FROM scheduled_messages WHERE plan_id IS NOT NULL "
                    f"AND employee_id = %s AND {_SHOWN} ORDER BY send_at DESC LIMIT %s",
                    (employee_id, max(1, min(int(limit), 200)))) or []
    messages = []
    for r in rows:
        exp = expected_ms(r["body"])
        opened = r["first_view_at"] or r["read_at"]
        item = {"id": r["id"], "title": _stage(r["title"]), "kind": r["kind"],
                "delivered_at": str(r["delivered_at"] or ""), "opened_at": str(opened or ""),
                "reaction_min": round((opened - r["delivered_at"]).total_seconds() / 60)
                if opened and r["delivered_at"] else None,
                "view_s": round((r["view_ms"] or 0) / 1000), "expected_s": round(exp / 1000),
                "reading": reading(r["view_ms"] or 0, exp)}
        if r["kind"] == "quiz":
            right, answered, total = quiz_score(r["payload"], r["answers"])
            item["quiz"] = {"right": right, "answered": answered, "total": total}
        messages.append(item)
    return {**(summary([employee_id]).get(employee_id) or {}), "messages": messages}


if __name__ == "__main__":
    assert reading(0, 10_000) is None
    assert reading(6_000, 10_000) == "read" and reading(3_000, 10_000) == "skim"
    assert reading(1_000, 10_000) == "scroll"
    assert expected_ms("") == MIN_EXPECTED_MS and expected_ms("x" * 1170) == 60_000
    quiz = {"questions": [{"id": "q1", "options": [{"id": "o1", "correct": True}, {"id": "o2"}]},
                          {"id": "q2", "options": [{"id": "o1"}, {"id": "o2", "correct": True}]},
                          {"id": "q3", "options": [{"id": "o1", "correct": True}]}]}
    assert quiz_score(quiz, {"q1": "o1", "q2": "o1"}) == (1, 2, 3)
    assert quiz_score(None, None) == (0, 0, 0)
    assert engagement(0, 0, 0, 0, 0, None) is None
    assert engagement(10, 10, 10, 10, 0, 600) == 100             # всё прочитал, быстро
    assert engagement(10, 10, 10, 0, 0, 600) == 70               # всё пролистал, быстро
    assert engagement(10, 5, 0, 0, 0, 48 * 3600) == 35           # половина, медленно
    print("OK: stats")

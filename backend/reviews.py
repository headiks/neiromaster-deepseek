"""
reviews.py — оценка новичка наставником по завершении этапа адаптации.

Этап завершён, когда все его сообщения плана доставлены. Тогда планировщик (dispatch_all)
создаёт запрос оценки (stage_reviews, status=requested) и шлёт наставнику уведомление.
Наставник — пользователь, чьё ФИО указано у новичка в поле «Наставник» (users.mentor_of).

Оценка: 5 критериев по шкале 1–5 (CRITERIA), производственные показатели этапа — числа,
набор которых администратор задаёт под должность (app_settings.review_metrics), решение
(готов к следующему этапу / нужно время / есть риск) и комментарий.
Этапы «до выхода на работу» не оцениваются — работы ещё не было.
"""
import json
import uuid

import db
import users

CRITERIA = (
    ("safety", "Охрана труда"),
    ("quality", "Качество работы"),
    ("independence", "Самостоятельность"),
    ("pace", "Темп"),
    ("discipline", "Дисциплина"),
)
DECISIONS = {"ready": "Готов к следующему этапу", "more_time": "Нужно ещё время", "risk": "Есть риск"}
# Показатели по умолчанию — если для должности администратор свои не задал.
DEFAULT_METRICS = [
    {"key": "norm", "label": "Выполнение нормы", "unit": "%"},
    {"key": "defects", "label": "Брак / ошибки", "unit": "шт"},
    {"key": "violations", "label": "Нарушения охраны труда", "unit": "шт"},
]
RECENT_DAYS = 14          # запрос оценки — только по недавно завершённым этапам (не по всей истории)
_SETTINGS_KEY = "review_metrics"


# ---------- Показатели под должность ----------
def metrics_config() -> dict:
    """{должность: [{key, label, unit}], "": по умолчанию}."""
    row = db.query("SELECT value FROM app_settings WHERE key = %s", (_SETTINGS_KEY,), "one")
    try:
        cfg = json.loads(row["value"]) if row else {}
    except ValueError:
        cfg = {}
    cfg.setdefault("", DEFAULT_METRICS)
    return cfg


def metrics_for(position: str | None) -> list:
    cfg = metrics_config()
    pos = (position or "").strip().lower()
    return next((v for k, v in cfg.items() if k and k.strip().lower() == pos), cfg[""])


def save_metrics_config(cfg: dict) -> dict:
    """Проверка и сохранение: у показателя название (до 80), единица (до 16), key — из названия."""
    clean = {}
    for pos, items in (cfg or {}).items():
        out, seen = [], set()
        for i, m in enumerate(items or []):
            label = str((m or {}).get("label") or "").strip()[:80]
            if not label:
                continue
            key = str((m or {}).get("key") or "").strip()[:40] or f"m{i}"
            while key in seen:
                key += "_"
            seen.add(key)
            out.append({"key": key, "label": label, "unit": str(m.get("unit") or "").strip()[:16]})
        clean[str(pos).strip()[:120]] = out
    clean.setdefault("", DEFAULT_METRICS)
    db.execute("INSERT INTO app_settings (key, value) VALUES (%s, %s) "
               "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
               (_SETTINGS_KEY, json.dumps(clean, ensure_ascii=False)))
    return clean


# ---------- Этапы сотрудника ----------
def stages_of(employee: dict) -> list:
    """Этапы плана сотрудника (без «до выхода»): [{id, title, completed}] по порядку плана."""
    import planner
    plan = planner.load_plan(employee.get("plan_id") or "") if employee.get("plan_id") else None
    if not plan:
        return []
    done = {r["stage_id"] for r in db.query(
        "SELECT stage_id FROM scheduled_messages WHERE employee_id = %s AND plan_id IS NOT NULL "
        "AND stage_id IS NOT NULL GROUP BY stage_id "
        "HAVING count(*) = count(*) FILTER (WHERE status IN ('delivered', 'read'))",
        (employee["id"],)) or []}
    return [{"id": s["id"], "title": s.get("title") or "", "completed": s["id"] in done}
            for s in plan.get("stages") or [] if s.get("anchor") != "before_start"]


# ---------- Запросы оценки (планировщик) ----------
def ensure_requests() -> int:
    """Недавно завершённые этапы без оценки -> запрос + уведомление наставнику. -> число новых."""
    import messaging
    import planner
    rows = db.query(
        "SELECT m.employee_id, m.stage_id FROM scheduled_messages m "
        "WHERE m.plan_id IS NOT NULL AND m.stage_id IS NOT NULL "
        "AND NOT EXISTS (SELECT 1 FROM stage_reviews r WHERE r.employee_id = m.employee_id "
        "                AND r.stage_id = m.stage_id) "
        "GROUP BY m.employee_id, m.stage_id "
        "HAVING count(*) = count(*) FILTER (WHERE m.status IN ('delivered', 'read')) "
        "AND max(m.delivered_at) > now() - make_interval(days => %s)", (RECENT_DAYS,)) or []
    if not rows:
        return 0
    people = users.list_users()
    by_id = {u["id"]: u for u in people}
    plans, created = {}, 0
    for r in rows:
        emp = by_id.get(r["employee_id"])
        if not emp or not emp.get("plan_id"):
            continue
        if emp["plan_id"] not in plans:
            plans[emp["plan_id"]] = planner.load_plan(emp["plan_id"]) or {}
        stage = next((s for s in plans[emp["plan_id"]].get("stages") or [] if s["id"] == r["stage_id"]), None)
        if not stage or stage.get("anchor") == "before_start":
            continue
        mentor = users.mentor_of(emp, people)
        new = db.query("INSERT INTO stage_reviews (id, employee_id, stage_id, stage_title, mentor_id) "
                       "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (employee_id, stage_id) DO NOTHING "
                       "RETURNING id", (str(uuid.uuid4()), emp["id"], stage["id"], stage.get("title") or "",
                                        mentor["id"] if mentor else None), "one")
        if new:
            created += 1
            if mentor:
                who = emp.get("full_name") or "Новичок"
                messaging.deliver_now(
                    mentor["id"], f"Оцените: {who}",
                    f"{who} завершил(а) этап «{stage.get('title')}». Оцените его работу — раздел "
                    f"«Подопечные» на сайте НейроМастера. Это займёт пару минут.",
                    data={"kind": "review", "employee_id": emp["id"], "stage_id": stage["id"]})
    return created


# ---------- Оценка ----------
def _row(r: dict) -> dict:
    return {**r, "requested_at": str(r["requested_at"] or ""), "done_at": str(r["done_at"] or "")}


def for_employee(employee_id: str) -> list:
    rows = db.query("SELECT * FROM stage_reviews WHERE employee_id = %s ORDER BY requested_at",
                    (employee_id,)) or []
    return [_row(r) for r in rows]


def validate(scores: dict, metrics: dict, decision: str, allowed_metrics: list) -> tuple:
    """-> (scores, metrics) в каноническом виде; ValueError — что не так."""
    keys = {k for k, _ in CRITERIA}
    clean_scores = {}
    for k, v in (scores or {}).items():
        if k not in keys:
            continue
        if not isinstance(v, int) or isinstance(v, bool) or not 1 <= v <= 5:
            raise ValueError("Оценка критерия — целое от 1 до 5")
        clean_scores[k] = v
    if set(clean_scores) != keys:
        raise ValueError("Оцените все критерии")
    if decision not in DECISIONS:
        raise ValueError("Выберите решение по этапу")
    mkeys = {m["key"] for m in allowed_metrics}
    clean_metrics = {}
    for k, v in (metrics or {}).items():
        if k in mkeys and v not in (None, ""):
            try:
                clean_metrics[k] = float(v)
            except (TypeError, ValueError):
                raise ValueError("Показатель — число")
    return clean_scores, clean_metrics


def save(employee: dict, stage: dict, actor: dict, scores: dict, metrics: dict,
         decision: str, comment: str = "") -> dict:
    s, m = validate(scores, metrics, decision, metrics_for(employee.get("position")))
    row = db.query(
        "INSERT INTO stage_reviews (id, employee_id, stage_id, stage_title, mentor_id, status, scores, "
        "metrics, decision, comment, done_at) VALUES (%s, %s, %s, %s, %s, 'done', %s, %s, %s, %s, now()) "
        "ON CONFLICT (employee_id, stage_id) DO UPDATE SET mentor_id = EXCLUDED.mentor_id, status = 'done', "
        "scores = EXCLUDED.scores, metrics = EXCLUDED.metrics, decision = EXCLUDED.decision, "
        "comment = EXCLUDED.comment, done_at = now() RETURNING *",
        (str(uuid.uuid4()), employee["id"], stage["id"], stage.get("title") or "", actor["id"],
         json.dumps(s), json.dumps(m), decision, (comment or "").strip()[:2000]), "one")
    return _row(row)


def average(scores: dict | None) -> float | None:
    vals = [v for v in (scores or {}).values() if isinstance(v, (int, float))]
    return round(sum(vals) / len(vals), 1) if vals else None


if __name__ == "__main__":
    allowed = [{"key": "norm", "label": "Норма", "unit": "%"}]
    full = {k: 4 for k, _ in CRITERIA}
    assert validate(full, {"norm": "85", "чужой": 1}, "ready", allowed) == (full, {"norm": 85.0})
    for bad in ({**full, "pace": 6}, {**full, "pace": True}, {"safety": 5}):
        try:
            validate(bad, {}, "ready", allowed)
            assert False, bad
        except ValueError:
            pass
    try:
        validate(full, {}, "maybe", allowed)
        assert False
    except ValueError:
        pass
    assert average({"a": 4, "b": 5}) == 4.5 and average(None) is None
    print("OK: reviews")

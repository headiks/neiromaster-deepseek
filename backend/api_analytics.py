"""Наставник (подопечные, оценка этапа) и раздел «Аналитика»: оценки, тесты, вопросы.

Доступ: оценку ставит наставник новичка (users.mentor_of) или администратор/куратор, который
вправе им управлять. Аналитику видят администраторы и кураторы — по видимым им сотрудникам
(куратор — свой отдел)."""
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

import activitylog
import analytics
import demo
import reviews
import stats
import users
from deps import logged_in, require_admin, require_full_access, require_setup_done

router = APIRouter()


class ReviewRequest(BaseModel):
    scores: dict = Field(default_factory=dict)
    metrics: dict = Field(default_factory=dict)
    decision: str = Field(max_length=20)
    comment: str = Field(default="", max_length=2000)


FILTERS = {"department": "Подразделение", "mentor": "Наставник", "position": "Должность", "q": "ФИО содержит"}


def filters(department: str = "", mentor: str = "", position: str = "", q: str = "") -> dict:
    """Выборка аналитики и отчёта: подразделение / наставник / должность — точное совпадение
    (без регистра), q — часть ФИО."""
    return {k: v.strip()[:200] for k, v in
            {"department": department, "mentor": mentor, "position": position, "q": q}.items() if v.strip()}


def _people(actor: dict, f: dict | None = None) -> list:
    """Сотрудники (новички), которых актор видит в аналитике, — с фильтром выборки."""
    f = f or {}
    same = lambda a, b: (a or "").strip().casefold() == b.casefold()
    # песочницы посетителей демо — не новички компании, в аналитике только мешают
    return [u for u in users.visible_users(actor, users.list_users()) if u.get("role") == users.ROLE_EMPLOYEE
            and not demo.is_sandbox(u) and all(same(u.get(k), f[k]) for k in ("department", "mentor", "position") if k in f)
            and (f.get("q", "").casefold() in (u.get("full_name") or "").casefold())]


def _brief(u: dict) -> dict:
    return {k: u.get(k) for k in ("id", "full_name", "position", "department", "start_date", "mentor", "plan_id")}


def _review_target(actor: dict, employee_id: str, write: bool = False) -> dict:
    """Сотрудник, если актор — его наставник или администратор/куратор с доступом. Иначе 404."""
    all_users = users.list_users()
    emp = next((u for u in all_users if u["id"] == employee_id and u.get("role") == users.ROLE_EMPLOYEE), None)
    if emp:
        mentor = users.mentor_of(emp, all_users)
        if mentor and mentor["id"] == actor["id"]:
            return emp
        if users.is_admin(actor) and (users.can_manage(actor, emp) if write else emp in users.visible_users(actor, [emp])):
            return emp
    raise HTTPException(status_code=404, detail="Сотрудник не найден")


def _card(emp: dict) -> dict:
    """Новичок для наставника: ход адаптации, этапы с оценками, показатели его должности."""
    done = {r["stage_id"]: r for r in reviews.for_employee(emp["id"])}
    return {**_brief(emp), "status": users.adaptation_status(emp),
            "stats": stats.summary([emp["id"]]).get(emp["id"]),
            "stages": [{**s, "review": done.get(s["id"])} for s in reviews.stages_of(emp)],
            "metrics": reviews.metrics_for(emp.get("position"))}


@router.get("/api/review-form", dependencies=logged_in)
def review_form():
    """Критерии и варианты решения — для формы оценки."""
    return {"criteria": [{"key": k, "label": v} for k, v in reviews.CRITERIA],
            "decisions": [{"key": k, "label": v} for k, v in reviews.DECISIONS.items()]}


@router.get("/api/mentor/mentees", dependencies=logged_in)
def my_mentees(user: dict = Depends(require_setup_done)):
    """Подопечные текущего пользователя (он указан у них наставником)."""
    return {"mentees": [_card(e) for e in users.mentees(user)]}


@router.get("/api/reviews/{employee_id}", dependencies=logged_in)
def employee_reviews(employee_id: str, user: dict = Depends(require_setup_done)):
    return _card(_review_target(user, employee_id))


@router.post("/api/reviews/{employee_id}/{stage_id}", dependencies=logged_in)
def save_review(employee_id: str, stage_id: str, req: ReviewRequest, user: dict = Depends(require_setup_done)):
    emp = _review_target(user, employee_id, write=True)
    stage = next((s for s in reviews.stages_of(emp) if s["id"] == stage_id), None)
    if not stage:
        raise HTTPException(status_code=404, detail="Этап не найден в плане сотрудника")
    try:
        row = reviews.save(emp, stage, user, req.scores, req.metrics, req.decision, req.comment)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    activitylog.log("action", user=user, path=f"/api/reviews/{employee_id}/{stage_id}",
                    detail={"action": "stage_review", "employee": employee_id, "decision": req.decision})
    return row


# ---------- Раздел «Аналитика» ----------
@router.get("/api/analytics/reviews")
def analytics_reviews(f: dict = Depends(filters), actor: dict = Depends(require_admin)):
    """Оценки наставников по видимым новичкам: последняя оценка, решения, ждущие оценки."""
    people = _people(actor, f)
    all_users = users.list_users()
    out = []
    for emp in people:
        revs = reviews.for_employee(emp["id"])
        done = [r for r in revs if r["status"] == "done"]
        last = done[-1] if done else None
        mentor = users.mentor_of(emp, all_users)
        out.append({**_brief(emp), "mentor_user": bool(mentor),
                    "reviews": revs, "pending": [r for r in revs if r["status"] == "requested"],
                    "last": {"stage_title": last["stage_title"], "avg": reviews.average(last["scores"]),
                             "decision": last["decision"], "metrics": last["metrics"]} if last else None})
    return {"employees": out, "decisions": reviews.DECISIONS,
            "criteria": [{"key": k, "label": v} for k, v in reviews.CRITERIA]}


@router.get("/api/analytics/metrics", dependencies=[Depends(require_admin)])
def get_metrics():
    return {"metrics": reviews.metrics_config()}


class MetricsRequest(BaseModel):
    metrics: dict


@router.put("/api/analytics/metrics")
def put_metrics(req: MetricsRequest, actor: dict = Depends(require_full_access)):
    """Показатели этапа под должность: {должность: [{label, unit}], "": по умолчанию}."""
    cfg = reviews.save_metrics_config(req.metrics)
    activitylog.log("action", user=actor, path="/api/analytics/metrics", detail={"action": "review_metrics"})
    return {"metrics": cfg}


@router.get("/api/analytics/tests")
def analytics_tests(f: dict = Depends(filters), actor: dict = Depends(require_admin)):
    people = _people(actor, f)
    return {"tests": analytics.tests([u["id"] for u in people]), "people": {u["id"]: _brief(u) for u in people},
            "pass_percent": round(analytics.PASS * 100)}


@router.post("/api/analytics/tests/{row_id}/retake")
def retake_test(row_id: str, actor: dict = Depends(require_admin)):
    """Разрешить пересдачу: ответы теста очищаются, сотрудник проходит его заново."""
    row = next((t for t in analytics.tests([u["id"] for u in _people(actor)]) if t["id"] == row_id), None)
    if not row or not users.can_manage(actor, users.get_user(row["employee_id"]) or {}):
        raise HTTPException(status_code=404, detail="Тест не найден")
    analytics.retake(row_id)
    activitylog.log("action", user=actor, path=f"/api/analytics/tests/{row_id}/retake",
                    detail={"action": "quiz_retake", "employee": row["employee_id"]})
    return {"ok": True}


@router.get("/api/analytics/questions")
def analytics_questions(days: int = 30, f: dict = Depends(filters), actor: dict = Depends(require_admin)):
    people = _people(actor, f)
    return {**analytics.questions([u["id"] for u in people], days),
            "people": {u["id"]: _brief(u) for u in people},
            "categories": analytics.CATEGORIES, "outcomes": analytics.OUTCOMES}


@router.get("/api/analytics/filters")
def analytics_filters(actor: dict = Depends(require_admin)):
    """Значения для фильтров выборки — из видимых актору новичков."""
    people = _people(actor)
    pick = lambda k: sorted({(u.get(k) or "").strip() for u in people} - {""}, key=str.casefold)
    return {"departments": pick("department"), "mentors": pick("mentor"), "positions": pick("position")}


def _overview(people: list) -> dict:
    """Строка на новичка: этап, тесты, вовлечённость, оценка наставника, вопросы, зона риска."""
    all_users = users.list_users()
    ids = [u["id"] for u in people]
    summ = stats.summary(ids)
    tests_of, by_title = analytics.tests_by(ids)
    asked = analytics.questions(ids, 365)
    zero_t = {"given": 0, "passed": 0, "failed": 0, "overdue": 0, "waiting": 0}
    zero_q = {"total": 0, "org": 0, "work": 0, "unknown": 0, "unanswered": 0}
    rows = []
    for emp in people:
        s = summ.get(emp["id"]) or {}
        # shortcut: оценки — запрос на новичка (как в analytics_reviews); на тысячах людей — одной выборкой
        revs = reviews.for_employee(emp["id"])
        done = [r for r in revs if r["status"] == "done"]
        last = done[-1] if done else None
        row = {**_brief(emp), "mentor_user": bool(users.mentor_of(emp, all_users)),
               "stage": s.get("stage"), "progress": s.get("progress"), "delivered": s.get("delivered", 0),
               "engagement": s.get("engagement"), "reading": s.get("reading"),
               "tests": {**(tests_of.get(emp["id"]) or zero_t), "percent": (s.get("tests") or {}).get("percent")},
               "review": {"stage_title": last["stage_title"], "avg": reviews.average(last["scores"]),
                          "decision": last["decision"],
                          "decision_label": reviews.DECISIONS.get(last["decision"] or "")} if last else None,
               "pending_reviews": sum(r["status"] == "requested" for r in revs),
               "questions": asked["by_employee"].get(emp["id"]) or zero_q}
        row["risks"] = analytics.risks(row)
        rows.append(row)
    return {"employees": rows, "tests_by_title": by_title, "weeks": asked["by_week"],
            "decisions": reviews.DECISIONS, "low_engagement": analytics.LOW_ENGAGEMENT}


@router.get("/api/analytics/overview")
def analytics_overview(f: dict = Depends(filters), actor: dict = Depends(require_admin)):
    """«Сводка»: данные по новичкам выборки для графиков и списка «в зоне риска»."""
    return _overview(_people(actor, f))


@router.get("/api/analytics/report.xlsx")
def analytics_report(f: dict = Depends(filters), actor: dict = Depends(require_admin)):
    """Excel-отчёт по выборке: вся компания, подразделение, подопечные наставника, должность."""
    import db
    import provisioning
    rows = _overview(_people(actor, f))["employees"]
    scope = "; ".join(f"{FILTERS[k]}: {v}" for k, v in f.items()) or (
        "вся компания" if users.is_full_access(actor) else f"отдел {actor.get('department') or ''}".strip())
    schema = db.current_schema()
    company = provisioning.company_name(schema) if schema else ""
    activitylog.log("action", user=actor, path="/api/analytics/report.xlsx",
                    detail={"action": "analytics_report", "rows": len(rows), **f})
    disposition = 'attachment; filename="report.xlsx"; filename*=UTF-8''' + quote("отчёт_по_адаптации.xlsx")
    return Response(content=analytics.report_xlsx(rows, scope, company),
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": disposition})


@router.get("/api/analytics/employee/{employee_id}")
def analytics_employee(employee_id: str, actor: dict = Depends(require_admin)):
    """Карточка новичка: статистика, оценки наставника по этапам, тесты, вопросы, зона риска."""
    emp = next((u for u in _people(actor) if u["id"] == employee_id), None)
    if emp is None:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    row = _overview([emp])["employees"][0]
    return {**_card(emp), "stats": stats.detail(employee_id), "overview": row,
            "tests": analytics.tests([employee_id]),
            "questions": analytics.questions([employee_id], 365)["items"],
            "categories": analytics.CATEGORIES, "outcomes": analytics.OUTCOMES}

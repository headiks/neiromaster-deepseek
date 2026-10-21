"""Наставник (подопечные, оценка этапа) и раздел «Аналитика»: оценки, тесты, вопросы.

Доступ: оценку ставит наставник новичка (users.mentor_of) или администратор/куратор, который
вправе им управлять. Аналитику видят администраторы и кураторы — по видимым им сотрудникам
(куратор — свой отдел)."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import activitylog
import analytics
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


def _people(actor: dict) -> list:
    """Сотрудники (новички), которых актор видит в аналитике."""
    return [u for u in users.visible_users(actor, users.list_users()) if u.get("role") == users.ROLE_EMPLOYEE]


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
def analytics_reviews(actor: dict = Depends(require_admin)):
    """Оценки наставников по видимым новичкам: последняя оценка, решения, ждущие оценки."""
    people = _people(actor)
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
def analytics_tests(actor: dict = Depends(require_admin)):
    people = _people(actor)
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
def analytics_questions(days: int = 30, actor: dict = Depends(require_admin)):
    people = _people(actor)
    return {**analytics.questions([u["id"] for u in people], days),
            "people": {u["id"]: _brief(u) for u in people},
            "categories": analytics.CATEGORIES, "outcomes": analytics.OUTCOMES}

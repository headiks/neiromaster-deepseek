"""Конструктор плана адаптации: планы, генерация сообщений, экспорт, фоновые задачи."""

import json

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from fastapi.responses import Response

import db
import users
import planner
import indexing
import messaging
import activitylog
from deps import _bg, admin_only, require_admin

router = APIRouter()


# ---------- Конструктор плана адаптации ----------
class PlanRequest(BaseModel):
    title: str | None = None
    role: str | None = None
    description: str | None = None
    start_date: str | None = None
    timezone: str | None = None
    stages: list = []


@router.get("/catalog", dependencies=admin_only)
async def get_catalog():
    """Каталог этапов и шаблонов подэтапов — из него человек собирает план."""
    return planner.load_catalog()


@router.get("/plans", dependencies=admin_only)
async def get_plans():
    import autoplan
    return {"plans": planner.list_plans(), "default_plan_id": autoplan.get_default_plan_id()}


@router.post("/plans/{plan_id}/set-default")
async def set_default_plan(plan_id: str, user: dict = Depends(require_admin)):
    """Сделать план активным общим: он будет автоматически назначаться новым сотрудникам
    по должности, а также сразу назначается всем сотрудникам БЕЗ плана (ручные не трогаем).
    Пока у сотрудника нет даты выхода — план неактивен (сообщения не идут)."""
    import autoplan
    if planner.load_plan(plan_id) is None:
        raise HTTPException(status_code=404, detail="План не найден")
    autoplan.set_default_plan_id(plan_id)
    assigned = autoplan.assign_unassigned()
    activitylog.log("action", user=user, path=f"/plans/{plan_id}/set-default",
                    detail={"action": "plan_set_default", "plan_id": plan_id, "assigned": assigned})
    return {"plan_id": plan_id, "default": True, "assigned": assigned}


@router.post("/plans")
async def create_plan(req: PlanRequest, user: dict = Depends(require_admin)):
    plan = planner.normalize_plan(req.model_dump())
    planner.save_plan(plan)
    activitylog.log("action", user=user, path="/plans",
                    detail={"action": "plan_create", "plan_id": plan.get("id"),
                            "title": plan.get("title")})
    return plan


@router.post("/plans/template", dependencies=admin_only)
async def create_full_template(title: str | None = None):
    """Создаёт полный универсальный шаблон плана из всего каталога (все этапы и подэтапы),
    единый для всех профессий. Дальше редактируется как обычный план."""
    plan = planner.build_full_template(title or "Универсальный план адаптации")
    planner.save_plan(plan)
    return plan


# Раскладка чанков по этапам была нужна для векторного поиска (payload.plan_stages).
# Векторов больше нет: привязка к этапам/подэтапам идёт из LLM-разметки docpipe при
# классификации документа. Отдельный шаг «разложить чанки» не нужен — эндпоинт удалён.


@router.get("/plans/{plan_id}", dependencies=admin_only)
async def get_plan(plan_id: str):
    plan = planner.load_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="План не найден")
    return {"plan": plan, "schedule_preview": planner.resolve_schedule(plan)}


@router.put("/plans/{plan_id}", dependencies=admin_only)
async def update_plan(plan_id: str, req: PlanRequest):
    existing = planner.load_plan(plan_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="План не найден")
    payload = req.model_dump()
    payload["created_at"] = existing.get("created_at")
    plan = planner.normalize_plan(payload, plan_id=plan_id)
    planner.save_plan(plan)
    return plan


@router.delete("/plans/{plan_id}", dependencies=admin_only)
async def remove_plan(plan_id: str):
    if not planner.delete_plan(plan_id):
        raise HTTPException(status_code=404, detail="План не найден")
    return {"plan_id": plan_id, "deleted": True}


@router.post("/plans/{plan_id}/duplicate", dependencies=admin_only)
async def duplicate_plan(plan_id: str, title: str | None = None):
    """Копия плана под смежную должность — дальше редактируется как обычно."""
    plan = planner.duplicate_plan(plan_id, title)
    if plan is None:
        raise HTTPException(status_code=404, detail="План не найден")
    return plan


def _staffing_positions() -> list:
    """Уникальные должности сотрудников из штатки — под каждую генерируется свой контент плана."""
    seen = []
    for u in users.list_users():
        pos = (u.get("position") or "").strip()
        if pos and pos not in seen:
            seen.append(pos)
    return seen


def _plan_positions(plan_id: str) -> list:
    """Должности сотрудников, которым НАЗНАЧЕН этот план (users.plan_id = plan_id) — под них
    и генерируем контент. Так план готовится под должности реальных адресатов, а не под всю
    штатку. Если план ещё никому не назначен (генерация до раскатки) — фолбэк на всю штатку,
    чтобы админ мог подготовить контент заранее."""
    seen = []
    for u in users.list_users():
        if (u.get("plan_id") or "") != plan_id:
            continue
        pos = (u.get("position") or "").strip()
        if pos and pos not in seen:
            seen.append(pos)
    return seen or _staffing_positions()


@router.post("/plans/{plan_id}/generate", dependencies=admin_only)
async def generate_plan(plan_id: str, profession: str | None = None):
    """
    Запускает фоновую генерацию контента плана. Прогресс — через GET /jobs/{job_id}.
    profession задан — перегенерировать только это расписание (одна должность, либо общее
    при profession=""). Без profession — под КАЖДУЮ должность из штатки плюс общее.
    """
    plan = planner.load_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="План не найден")
    if not any(s.get("substages") for s in plan.get("stages") or []):
        raise HTTPException(status_code=400, detail="В плане нет ни одного подэтапа")
    if profession is not None:
        prof = profession.strip()
        return planner.start_generation(plan, positions=[prof] if prof else None,
                                        include_general=not prof)
    return planner.start_generation(plan, positions=_plan_positions(plan_id))


@router.post("/plans/{plan_id}/generate-missing", dependencies=admin_only)
async def generate_missing(plan_id: str, profession: str | None = None):
    """Догенерация: заново прогоняет только пропущенные/ошибочные подэтапы (после того как
    админ загрузил недостающие документы), уже готовые тексты не трогает. profession как в
    /generate: задан — одно расписание; без него — под каждую должность плюс общее."""
    plan = planner.load_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="План не найден")
    if not any(s.get("substages") for s in plan.get("stages") or []):
        raise HTTPException(status_code=400, detail="В плане нет ни одного подэтапа")
    if profession is not None:
        prof = profession.strip()
        return planner.start_generation(plan, positions=[prof] if prof else None,
                                        include_general=not prof, only_missing=True)
    return planner.start_generation(plan, positions=_plan_positions(plan_id), only_missing=True)


@router.post("/plans/{plan_id}/refresh-catalog", dependencies=admin_only)
async def refresh_plan_catalog(plan_id: str):
    """Подтянуть в существующий план свежие описания этапов и брифы подэтапов из каталога
    (по catalog_id). Обновляет только тексты; расписание, порядок, заголовки и ручные
    подэтапы не трогает. После этого содержимое перегенерируется по кнопке «Догенерировать»."""
    plan = planner.refresh_from_catalog(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="План не найден")
    return {"plan_id": plan_id, "updated_fields": plan.pop("_refreshed", 0), "plan": plan}


@router.post("/plans/{plan_id}/rollout")
async def rollout_plan(plan_id: str, user: dict = Depends(require_admin)):
    """Применить готовый план ко всем сотрудникам: назначить план каждому сотруднику и
    запустить фоновую генерацию содержания под каждую уникальную должность из штатки.
    Прогресс — через GET /jobs/{job_id}. Сотрудник дальше видит план своей профессии."""
    plan = planner.load_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="План не найден")
    if not any(s.get("substages") for s in plan.get("stages") or []):
        raise HTTPException(status_code=400, detail="В плане нет ни одного подэтапа")
    # Назначаем план всем сотрудникам, чтобы каждый увидел его в кабинете (расписание
    # подставляется под его должность). Роли админа/владельца не трогаем.
    db.execute("UPDATE users SET plan_id = %s WHERE role = %s", (plan_id, users.ROLE_EMPLOYEE))
    # Этот план становится активным общим — новые сотрудники получат его автоматически.
    import autoplan
    autoplan.set_default_plan_id(plan_id)
    activitylog.log("action", user=user, path=f"/plans/{plan_id}/rollout",
                    detail={"action": "plan_rollout", "plan_id": plan_id})
    # Материализуем расписание-инстансы сразу (у кого есть дата выхода), не дожидаясь
    # следующего тика планировщика — фоново, чтобы не держать ответ.
    _bg(messaging.ensure_all)
    # План только что назначен всем сотрудникам — генерируем под их фактические должности.
    return planner.start_generation(plan, positions=_plan_positions(plan_id))


@router.get("/jobs/{job_id}", dependencies=admin_only)
async def get_job(job_id: str):
    job = planner.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    return job


@router.post("/jobs/{job_id}/cancel", dependencies=admin_only)
async def cancel_generation(job_id: str):
    """Отмена фоновой генерации: уже сгенерированные подэтапы сохраняются, дальше не идём."""
    job = planner.cancel_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    return job


@router.get("/plans/{plan_id}/schedule", dependencies=admin_only)
async def get_schedule(plan_id: str, profession: str | None = None):
    """Расписание плана. profession — показать вариант под конкретную должность (иначе общий)."""
    schedule = planner.load_schedule(plan_id, profession or "")
    if schedule is None:
        raise HTTPException(status_code=404, detail="Расписание ещё не сгенерировано")
    return schedule


@router.get("/plans/{plan_id}/professions", dependencies=admin_only)
async def get_plan_professions(plan_id: str):
    """Должности для селектора генерации:
    - professions — под которые УЖЕ сгенерированы отдельные расписания;
    - available — все известные должности (из профилей сотрудников и штатки), чтобы
      админ мог выбрать введённую вручную/загруженную должность и сгенерировать под неё;
    - generated_names — плоский список уже сгенерированных (для пометки в списке)."""
    generated = planner.list_schedule_professions(plan_id)
    return {
        "professions": generated,
        "available": _staffing_positions(),
        "generated_names": sorted({g["profession"] for g in generated}),
    }


@router.post("/plans/{plan_id}/messages/{message_id}/regenerate", dependencies=admin_only)
def regenerate_message(plan_id: str, message_id: str, profession: str | None = None):
    """Перегенерация одного подэтапа — без прогона всего плана. profession — какое расписание."""
    plan = planner.load_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="План не найден")
    message = planner.regenerate_one(plan, message_id, profession or "")
    if message is None:
        raise HTTPException(status_code=404, detail="Подэтап не найден в плане")
    return message


class MessageEdit(BaseModel):
    text: str
    profession: str | None = None


@router.put("/plans/{plan_id}/messages/{message_id}", dependencies=admin_only)
def edit_message(plan_id: str, message_id: str, req: MessageEdit):
    """Ручная правка текста одного сообщения плана в расписании нужной профессии."""
    message = planner.edit_message_text(plan_id, message_id, req.text, req.profession or "")
    if message is None:
        raise HTTPException(status_code=404, detail="Сообщение не найдено")
    return message


EXPORT_FILES = {
    "plan.md": ("text/markdown; charset=utf-8", "План в формате для LLM"),
    "plan.json": ("application/json", "Канонический план"),
    "schedule.md": ("text/markdown; charset=utf-8", "Расписание с готовыми ответами"),
    "schedule.json": ("application/json", "Расписание для мессенджеров и приложения"),
}


@router.get("/plans/{plan_id}/export/{name}", dependencies=admin_only)
async def export_plan(plan_id: str, name: str, profession: str | None = None):
    """Экспорт плана/расписания из БД. profession — какое расписание отдать (пустой = общее)."""
    if name not in EXPORT_FILES:
        raise HTTPException(status_code=400, detail=f"Доступны: {', '.join(EXPORT_FILES)}")
    plan = planner.load_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="План не найден")

    if name == "plan.json":
        content = json.dumps(plan, ensure_ascii=False, indent=2)
    elif name == "plan.md":
        content = planner.render_plan_md(plan)
    else:
        schedule = planner.load_schedule(plan_id, profession or "")
        if schedule is None:
            raise HTTPException(status_code=404, detail="Расписание ещё не сгенерировано")
        content = (json.dumps(schedule, ensure_ascii=False, indent=2) if name == "schedule.json"
                   else planner.render_schedule_md(schedule))

    media_type, _ = EXPORT_FILES[name]
    return Response(content=content, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{plan_id}_{name}"'})

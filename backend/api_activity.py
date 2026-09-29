"""Логирование действий: приём клиентских событий (клики) и просмотр журнала админом."""

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

import contextlib

import activitylog
import db
import provisioning
import security
import users
from fastapi import HTTPException
from deps import current_user, require_admin, require_owner, logged_in, owner_only

router = APIRouter()


class EventRequest(BaseModel):
    type: str = Field(max_length=32)          # только из activitylog.CLIENT_EVENTS
    path: str | None = Field(default=None, max_length=512)
    detail: dict | None = None


@router.post("/api/events", dependencies=logged_in)
def ingest_event(req: EventRequest, request: Request, user: dict = Depends(current_user)):
    """Событие от фронта (клик, просмотр). Тип — только из белого списка; лишнее игнорируем.
    Не больше 120 событий в минуту от пользователя: журнал в БД не должен засыпаться скриптом."""
    if not security.hit(f"events:{user['id']}", 120, 60):
        return {"ok": False, "throttled": True}
    event_type = req.type if req.type in activitylog.CLIENT_EVENTS else "click"
    activitylog.log(event_type, user=user, request=request,
                    path=req.path, detail=activitylog.clean_client_detail(req.detail))
    return {"ok": True}


@router.get("/api/activity")
def list_activity(event_type: str | None = None, user_id: str | None = None,
                  company: str | None = None, limit: int = 200,
                  actor: dict = Depends(require_admin)):
    """
    Журнал действий. Суперадмин — события ВСЕХ компаний (у каждого — поле company, фильтр
    company=<схема>). Админ компании — вся компания, куратор — только свой отдел (и свои).
    Фильтры: тип, пользователь.
    """
    if users.is_owner(actor) and not db.current_schema():
        return {"events": _all_companies(limit, event_type, company)}
    if users.is_full_access(actor):
        allowed = None
    else:
        allowed = [u["id"] for u in users.visible_users(actor, users.list_users())]

    if user_id:
        if allowed is not None and user_id not in allowed:
            raise HTTPException(status_code=403, detail="Пользователь не из вашего отдела")
        return {"events": activitylog.recent(limit=limit, event_type=event_type, user_id=user_id,
                                             hide_superadmin=not users.is_owner(actor))}
    return {"events": activitylog.recent(limit=limit, event_type=event_type, user_ids=allowed,
                                         hide_superadmin=not users.is_owner(actor))}


def _all_companies(limit: int, event_type: str | None, company: str | None) -> list:
    """Последние события по общей схеме и всем компаниям — одной лентой, новые сверху."""
    names = {r["schema_name"]: r["company"] for r in provisioning.list_companies()}
    targets = [company] if company in names or company == "public" else [None, *names]
    events = []
    for schema in targets:
        schema = None if schema == "public" else schema
        with db.use_schema(schema) if schema else contextlib.nullcontext():
            for e in activitylog.recent(limit=limit, event_type=event_type) or []:
                events.append({**e, "company": schema or "public",
                               "company_name": names.get(schema, "Суперадмин / общая")})
    events.sort(key=lambda e: e["ts"], reverse=True)
    return events[:max(1, min(int(limit), 1000))]


class LlmKeyRequest(BaseModel):
    label: str = Field(default="", max_length=100)
    key: str = Field(min_length=20, max_length=200)


class LlmKeyUpdate(BaseModel):
    active: bool | None = None
    label: str | None = Field(default=None, max_length=100)


@router.get("/api/llm-keys", dependencies=owner_only)
def llm_keys(balance: bool = False):
    """Пул ключей DeepSeek (суперадмин, /globaltest): без самих ключей — хвост, состояние,
    запросы в полёте, баланс (balance=1 — по запросу к DeepSeek на каждый ключ)."""
    import llmkeys
    return {"keys": llmkeys.listing(with_balance=balance)}


@router.post("/api/llm-keys")
def llm_key_add(req: LlmKeyRequest, actor: dict = Depends(require_owner)):
    import llmkeys
    try:
        res = llmkeys.add(req.label, req.key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    activitylog.log("action", user=actor, path="/api/llm-keys",
                    detail={"action": "llm_key_add", "id": res["id"], "label": req.label})
    return res


@router.put("/api/llm-keys/{key_id}")
def llm_key_update(key_id: int, req: LlmKeyUpdate, actor: dict = Depends(require_owner)):
    import llmkeys
    if not llmkeys.update(key_id, active=req.active, label=req.label):
        raise HTTPException(status_code=404, detail="Ключ не найден")
    return {"ok": True}


@router.delete("/api/llm-keys/{key_id}")
def llm_key_delete(key_id: int, actor: dict = Depends(require_owner)):
    import llmkeys
    if not llmkeys.remove(key_id):
        raise HTTPException(status_code=404, detail="Ключ не найден")
    activitylog.log("action", user=actor, path=f"/api/llm-keys/{key_id}",
                    detail={"action": "llm_key_delete", "id": key_id})
    return {"ok": True}


@router.get("/api/llm-usage", dependencies=owner_only)
def llm_usage(days: int = 14):
    """Расход токенов DeepSeek по дням (вызовы, prompt/completion, попадания в кэш DeepSeek)."""
    import deepseek
    return {"days": deepseek.usage_by_day(max(1, min(days, 90)))}

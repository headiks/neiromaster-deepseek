"""Суперадмин: компании-клиенты, их статистика и баланс DeepSeek.

Компания = своя схема PostgreSQL + её администратор (provisioning.create_company).
Суперадмин «открывает» компанию (кука nm_company, см. app.TenantMiddleware) и работает в ней
с правами админа: люди, документы, планы, вопросы. Документы при этом грузит только «войдя
как администратор» компании — его сессией; вернуться — /api/return-to-owner.
"""
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

import activitylog
import auth
import db
import provisioning
import users
from deps import _session_token, _set_session_cookie, owner_only, require_owner

router = APIRouter(prefix="/api/companies", dependencies=owner_only)


class CompanyRequest(BaseModel):
    company: str = Field(min_length=1, max_length=200)
    slug: str | None = Field(default=None, max_length=41)
    admin_full_name: str | None = Field(default=None, max_length=200)


def company_stats(tokens: dict) -> dict:
    """Сводка по ТЕКУЩЕЙ схеме: люди по ролям, документы, планы, сообщения, вопросы, активность."""
    one = lambda sql, params=(): (db.query(sql, params, "one") or {}).get("n") or 0  # noqa: E731
    roles = {r["role"]: r["n"] for r in db.query("SELECT role, count(*) AS n FROM users GROUP BY role") or []}
    last = db.query("SELECT max(ts) AS ts FROM activity_log", (), "one") or {}
    return {
        "admins": roles.get("admin", 0),
        "curators": roles.get("curator", 0),
        "employees": roles.get("employee", 0),
        "employees_with_plan": one("SELECT count(*) AS n FROM users WHERE role = 'employee' AND plan_id IS NOT NULL"),
        "documents": one("SELECT count(*) AS n FROM doc_registry"),
        "plans": one("SELECT count(*) AS n FROM plans"),
        "messages_delivered": one("SELECT count(*) AS n FROM scheduled_messages WHERE status IN ('delivered', 'read')"),
        "messages_read": one("SELECT count(*) AS n FROM scheduled_messages WHERE status = 'read'"),
        "questions_open": one("SELECT count(*) AS n FROM questions WHERE status = 'open'"),
        "active_users_30d": one("SELECT count(DISTINCT user_id) AS n FROM activity_log "
                                "WHERE event_type = 'login' AND ts > now() - interval '30 days'"),
        "last_activity": str(last.get("ts") or ""),
        "deepseek_tokens_30d": tokens.get(db.current_schema() or "public", 0),
        # данные первого входа админов, ещё не сменивших пароль (суперадмин передаёт клиенту)
        "first_logins": provisioning.first_logins(),
    }


@router.get("")
def list_companies():
    import deepseek
    tokens = deepseek.tokens_by_company(30)
    out = []
    for c in provisioning.list_companies():
        try:
            with db.use_schema(c["schema_name"]):
                stats = company_stats(tokens)
        except Exception as e:                  # одна сломанная схема не прячет остальные
            stats = {"error": str(e)}
        out.append({"slug": c["slug"], "schema": c["schema_name"], "company": c["company"],
                    "created_at": c["created_at"], **stats})
    return {"companies": out}


@router.post("")
def create_company(req: CompanyRequest, actor: dict = Depends(require_owner)):
    """Новая компания + её администратор. Логин и временный пароль — в ответе, один раз."""
    try:
        result = provisioning.create_company(req.company, slug=req.slug or "",
                                             admin_full_name=req.admin_full_name or "")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    activitylog.log("action", user=actor, path="/api/companies",
                    detail={"action": "company_create", "company": result["company"],
                            "schema": result["schema"], "admin": result["admin"]["username"]})
    return result


@router.delete("/{slug}")
def delete_company(slug: str, confirm: str = "", actor: dict = Depends(require_owner)):
    """Удалить компанию безвозвратно. confirm — код компании ещё раз: защита от случайного вызова."""
    if confirm != slug:
        raise HTTPException(status_code=400, detail="Подтвердите удаление кодом компании")
    if db.current_schema() == provisioning.schema_for(slug):
        raise HTTPException(status_code=400, detail="Сначала выйдите из этой компании")
    company = provisioning.company_name(provisioning.schema_for(slug))
    try:
        result = provisioning.delete_company(slug)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    activitylog.log("action", user=actor, path=f"/api/companies/{slug}",
                    detail={"action": "company_delete", "company": company, "schema": result["schema"],
                            "raw": result["raw"], "s3": result["s3"]})
    return result


class LeadStatus(BaseModel):
    status: str = Field(pattern="^(new|done)$")


@router.get("/leads")
def list_leads():
    """Заявки с демо-сайта: кто оставил контакты. new — ещё не обработана."""
    import leads
    return {"leads": leads.list_all(), "new": leads.count_new()}


@router.post("/leads/{lead_id}")
def set_lead_status(lead_id: str, req: LeadStatus):
    import leads
    if not leads.set_status(lead_id, req.status):
        raise HTTPException(status_code=404, detail="Заявка не найдена")
    return {"ok": True}


def _schema_of(slug: str) -> str:
    try:
        schema = provisioning.schema_for(slug)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not provisioning.is_company(schema):
        raise HTTPException(status_code=404, detail="Компания не найдена")
    return schema


def _cookie(response: Response, name: str, value: str):
    response.set_cookie(name, value, httponly=True, samesite="strict", secure=auth.COOKIE_SECURE,
                        max_age=auth.SESSION_TTL, path="/")


@router.post("/{slug}/enter")
def enter_company(slug: str, response: Response, actor: dict = Depends(require_owner)):
    """Открыть компанию: дальше все разделы панели — в её схеме, с правами её админа."""
    schema = _schema_of(slug)
    _cookie(response, auth.COMPANY_COOKIE, schema)
    with db.use_schema(schema):
        activitylog.log("action", user=actor, path=f"/api/companies/{slug}/enter",
                        detail={"action": "owner_enter_company"})
    return {"schema": schema, "company": provisioning.company_name(schema)}


@router.post("/exit")
def exit_company(response: Response):
    response.delete_cookie(auth.COMPANY_COOKIE, path="/")
    return {"ok": True}


@router.get("/{slug}/admins")
def company_admins(slug: str):
    """Администраторы компании — для «Войти как администратор»."""
    with db.use_schema(_schema_of(slug)):
        return {"admins": [{"id": u["id"], "full_name": u.get("full_name"), "username": u.get("username")}
                           for u in users.list_users()
                           if u["role"] == users.ROLE_ADMIN and u.get("active") and u.get("username")]}


@router.post("/{slug}/login-as/{user_id}")
def login_as_admin(slug: str, user_id: str, request: Request, response: Response,
                   actor: dict = Depends(require_owner)):
    """Войти как администратор компании (загрузка документов — только от его имени). Сессия
    суперадмина откладывается в куку nm_owner_return — вернуться: /api/return-to-owner."""
    schema = _schema_of(slug)
    with db.use_schema(schema):
        target = users.get_user(user_id)
        if not target or target.get("role") != users.ROLE_ADMIN or not target.get("active"):
            raise HTTPException(status_code=400, detail="Это не действующий администратор компании")
        token = auth.new_session(target, schema)
        activitylog.log("action", user=actor, path=f"/api/companies/{slug}/login-as",
                        detail={"action": "owner_login_as", "target": target.get("username")})
    _cookie(response, auth.OWNER_RETURN_COOKIE, _session_token(request) or "")
    _set_session_cookie(response, token)
    response.delete_cookie(auth.COMPANY_COOKIE, path="/")
    return {"username": target.get("username"), "company": provisioning.company_name(schema)}


@router.get("/deepseek-balance")
def deepseek_balance():
    """Баланс DeepSeek и доля «сколько осталось». 100 % — NEIROMASTER_DEEPSEEK_BUDGET, если
    задан, иначе наибольший виденный баланс (обновляется после каждого пополнения)."""
    import deepseek
    import llmkeys
    bals, errors = [], []
    for _kid, key in llmkeys._all_keys():             # сумма по всему пулу ключей
        try:
            bals.append(deepseek.balance(api_key=key))
        except Exception as e:
            errors.append(str(e)[:200])
    if not bals:
        return {"ok": False, "error": f"Баланс недоступен: {'; '.join(errors) or 'нет ключей DeepSeek'}"}
    bal = {"total": round(sum(b["total"] for b in bals), 2), "currency": bals[0]["currency"],
           "available": any(b["available"] for b in bals), "keys": len(bals)}
    budget = float(os.environ.get("NEIROMASTER_DEEPSEEK_BUDGET") or 0)
    if not budget:
        row = db.query("SELECT value FROM app_settings WHERE key = 'deepseek_balance_max'", (), "one")
        budget = max(float((row or {}).get("value") or 0), bal["total"])
        db.execute("INSERT INTO app_settings (key, value) VALUES ('deepseek_balance_max', %s) "
                   "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", (str(budget),))
    percent = round(100 * bal["total"] / budget, 1) if budget > 0 else 0.0
    return {"ok": True, **bal, "budget": budget, "percent_left": min(percent, 100.0),
            "tokens_30d": deepseek.tokens_by_company(30)}

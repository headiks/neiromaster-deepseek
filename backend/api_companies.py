"""Суперадмин: компании-клиенты, их статистика и баланс DeepSeek.

Компания = своя схема PostgreSQL + её администратор (provisioning.create_company). Суперадмин
видит только сводные цифры по компаниям, а не их документы и людей поимённо.
"""
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import activitylog
import db
import provisioning
from deps import owner_only, require_owner

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


@router.get("/deepseek-balance")
def deepseek_balance():
    """Баланс DeepSeek и доля «сколько осталось». 100 % — NEIROMASTER_DEEPSEEK_BUDGET, если
    задан, иначе наибольший виденный баланс (обновляется после каждого пополнения)."""
    import deepseek
    try:
        bal = deepseek.balance()
    except Exception as e:
        return {"ok": False, "error": f"Баланс недоступен: {e}"}
    budget = float(os.environ.get("NEIROMASTER_DEEPSEEK_BUDGET") or 0)
    if not budget:
        row = db.query("SELECT value FROM app_settings WHERE key = 'deepseek_balance_max'", (), "one")
        budget = max(float((row or {}).get("value") or 0), bal["total"])
        db.execute("INSERT INTO app_settings (key, value) VALUES ('deepseek_balance_max', %s) "
                   "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", (str(budget),))
    percent = round(100 * bal["total"] / budget, 1) if budget > 0 else 0.0
    return {"ok": True, **bal, "budget": budget, "percent_left": min(percent, 100.0),
            "tokens_30d": deepseek.tokens_by_company(30)}

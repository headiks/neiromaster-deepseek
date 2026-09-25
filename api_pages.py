"""
HTML-страницы приложения. Логики нет — только проверка доступа и отдача файла.

Сайт — одностраничное приложение (frontend/, собирается в static/app/): каждая страница
отдаёт один и тот же static/app/index.html, дальше маршрут разбирает React Router.
Проверки доступа остаются на сервере: без входа — /login, с временным паролем — /setup,
админские страницы — только администраторам (deps.page_for_admin).
"""

import os
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse

import auth
import users
from deps import BASE_DIR, STATIC_DIR, page_for_admin, spa_html

router = APIRouter()

# Разделы админки (/admin/<раздел>) и служебные страницы — все внутри SPA.
ADMIN_SECTIONS = ("users", "plans", "documents", "messages", "questions")
SERVICE_PAGES = ("/s3", "/documents-board", "/documents-table", "/logs", "/plans-db", "/notify-test",
                 "/doc-breakdown", "/queue-test", "/globaltest", "/message-test")


@router.get("/", response_class=HTMLResponse)
def root(request: Request):
    """Личный кабинет сотрудника: сообщения плана, прогресс, ассистент."""
    user = auth.get_session_user(request.cookies.get(auth.COOKIE_NAME))
    if user is None:
        return RedirectResponse(url="/login", status_code=303)
    if user.get("must_change_credentials"):
        return RedirectResponse(url="/setup", status_code=303)
    return spa_html()


@router.get("/login", response_class=HTMLResponse)
def login_page():
    return spa_html()


@router.get("/register", response_class=HTMLResponse)
def register_page():
    return spa_html()


@router.get("/setup", response_class=HTMLResponse)
def setup_page(request: Request):
    """Первичная настройка: замена выданного пароля своим."""
    user = auth.get_session_user(request.cookies.get(auth.COOKIE_NAME))
    if user is None:
        return RedirectResponse(url="/login", status_code=303)
    if not user.get("must_change_credentials"):
        return RedirectResponse(url="/admin" if users.is_admin(user) else "/", status_code=303)
    return spa_html()


@router.get("/admin", response_class=HTMLResponse)
def admin_page(request: Request):
    """Админка: пользователи, планы, документы, сообщения, вопросы."""
    return page_for_admin(request)


@router.get("/admin/{section}", response_class=HTMLResponse)
def admin_section(section: str, request: Request):
    if section not in ADMIN_SECTIONS:
        return RedirectResponse(url="/admin", status_code=303)
    return page_for_admin(request)


def _service_page(path: str):
    def page(request: Request):
        return page_for_admin(request)
    page.__name__ = "page_" + path.strip("/").replace("-", "_")
    router.add_api_route(path, page, methods=["GET"], response_class=HTMLResponse)


for _path in SERVICE_PAGES:
    _service_page(_path)


@router.get("/favicon.ico", include_in_schema=False)
def favicon():
    """Браузеры просят /favicon.ico сами — отдаём логотип, а не 404 в консоли."""
    return FileResponse(STATIC_DIR / "favicon.svg", media_type="image/svg+xml",
                        headers={"Cache-Control": "public, max-age=86400"})


# ---------- Приложение для Android ----------
# APK кладётся на сервер при выкатке (в git не хранится). Страница и файл открыты без входа:
# сотрудник скачивает приложение прямо на телефон, а войти можно уже в самом приложении.
def _apk_path() -> Path:
    return Path(os.environ.get("NEIROMASTER_APK") or BASE_DIR / "data" / "app" / "NeiroMaster.apk")


@router.get("/app", response_class=HTMLResponse)
def app_page():
    return spa_html()


@router.get("/api/app/android")
def android_app_info():
    """Есть ли APK, размер и дата сборки — для страницы «Приложение»."""
    try:
        st = _apk_path().stat()
    except FileNotFoundError:
        return {"available": False}
    return {"available": True, "url": "/app/android.apk", "size": st.st_size,
            "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(st.st_mtime))}


@router.get("/app/android.apk", include_in_schema=False)
def android_apk():
    path = _apk_path()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Приложение пока не загружено на сервер")
    return FileResponse(path, media_type="application/vnd.android.package-archive", filename="NeiroMaster.apk")

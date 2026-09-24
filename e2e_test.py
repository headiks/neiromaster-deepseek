"""
E2E-проверка в настоящем браузере (Playwright + Chromium): админка, тур «Как пользоваться»,
кабинет сотрудника на телефоне. Ловит ошибки JS в консоли, делает скриншоты.

Нужен запущенный сервер на ЧИСТОЙ базе с известным начальным паролем владельца:
    NEIROMASTER_ADMIN_PASSWORD=Owner-start-2026 NEIROMASTER_INSECURE_COOKIE=1 uvicorn app:app
Затем:
    E2E_BASE=http://127.0.0.1:8000 E2E_OWNER_PASSWORD=Owner-start-2026 python e2e_test.py
Скриншоты — в E2E_SHOTS (по умолчанию ./e2e_shots). Браузер — Chromium из Playwright или
путь в E2E_CHROMIUM. Модель DeepSeek не нужна.
"""
import os
import re
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.environ.get("E2E_BASE", "http://127.0.0.1:8000")
OWNER_START = os.environ.get("E2E_OWNER_PASSWORD", "Owner-start-2026")
OWNER_PASS = "Owner-e2e-pass-2026"
SHOTS = Path(os.environ.get("E2E_SHOTS", "e2e_shots"))
CHROMIUM = os.environ.get("E2E_CHROMIUM") or None

errors: list = []
checks: list = []


def check(cond, what):
    checks.append((bool(cond), what))
    print(("  ok   " if cond else "  FAIL ") + what)


def watch(page, label):
    page.on("console", lambda m: m.type == "error" and errors.append(f"[{label}] console: {m.text}"))
    page.on("pageerror", lambda e: errors.append(f"[{label}] pageerror: {e}"))


def shot(page, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"), full_page=False)


def owner_username():
    import psycopg
    dsn = os.environ.get("NEIROMASTER_DB_DSN", "postgresql://neiromaster:neiromaster@localhost:5432/neiromaster_dev")
    with psycopg.connect(dsn) as c:
        return c.execute("SELECT username FROM users WHERE role='owner' ORDER BY created_at LIMIT 1").fetchone()[0]


def api(page, method, url, body=None):
    """Запрос из страницы (кука сессии + свой Origin)."""
    return page.evaluate("""async ([m, u, b]) => {
        const r = await fetch(u, {method: m, headers: {'Content-Type': 'application/json'},
                                  body: b === null ? undefined : JSON.stringify(b)});
        let d = null; try { d = await r.json(); } catch (e) {}
        return {status: r.status, data: d};
    }""", [method, url, body])


def login(page, username, password):
    page.goto(f"{BASE}/login")
    page.fill("#username", username)
    page.fill("#password", password)
    with page.expect_navigation(timeout=15000):
        page.click("#submit-btn")
    page.wait_for_load_state("load")
    page.wait_for_timeout(700)


def tour_run(page, label, expect_min_steps):
    """Проходит тур кнопкой «Далее», проверяя, что каждый шаг показан, и закрывает его."""
    page.click("#btn-tour")
    page.wait_for_selector(".nmt-card.nmt-in", timeout=8000)
    total = int(re.search(r"из (\d+)", page.inner_text(".nmt-count")).group(1))
    check(total >= expect_min_steps, f"{label}: в туре {total} шагов (ожидалось ≥ {expect_min_steps})")
    seen_titles = []
    for i in range(total):
        page.wait_for_function("() => document.querySelector('.nmt-card.nmt-in')", timeout=10000)
        title = page.inner_text(".nmt-title")
        seen_titles.append(title)
        # Шаги самодостаточны: даже при быстром пролистывании нужный элемент подсвечен.
        if title in ("Карточка сотрудника", "План и дата выхода"):
            page.wait_for_timeout(400)
            check(page.is_visible("#employee-dialog"), f"{label}: «{title}» — карточка сотрудника открыта")
        if title in ("Название плана", "Этапы"):
            page.wait_for_timeout(400)
            check(page.locator("#stages-container .stage-card").count() >= 1, f"{label}: «{title}» — демо-план в редакторе")
        if title == "Напишите вопрос своими словами":
            check(page.is_visible("#question-input"), f"{label}: поле вопроса видно")
        if i in (0, 3, 6, total // 2, total - 1):
            time.sleep(0.9)
            shot(page, f"{label}-tour-{i + 1:02d}")
        if i < total - 1:
            count_before = page.inner_text(".nmt-count")
            page.click('.nmt-card [data-act="next"]')
            page.wait_for_function("(c) => document.querySelector('.nmt-count').textContent !== c "
                                   "&& document.querySelector('.nmt-card.nmt-in')", arg=count_before, timeout=15000)
    check(len(set(seen_titles)) == total, f"{label}: все {total} шагов тура показаны без повторов")
    page.click('.nmt-card [data-act="next"]')          # «Готово ✓» закрывает тур
    page.wait_for_function("() => document.querySelector('.nmt-root').hidden", timeout=5000)
    return seen_titles


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM)

        # ---------------------------------------------------------- владелец
        ctx = browser.new_context(viewport={"width": 1366, "height": 860}, locale="ru-RU")
        page = ctx.new_page()
        watch(page, "admin")
        print("Вход владельца и первичная настройка")
        login(page, owner_username(), OWNER_START)
        check(page.url.endswith("/setup"), "первый вход ведёт на /setup")
        page.fill("#password", OWNER_PASS)
        page.fill("#password2", OWNER_PASS)
        page.click("#submit-btn")
        page.wait_for_url(re.compile(r".*/login$"), timeout=15000)
        check(True, "свой пароль задан, сессия сброшена — снова вход")
        login(page, owner_username(), OWNER_PASS)
        check(page.url.endswith("/admin"), "после смены пароля — админка")

        print("Подготовка данных через API")
        plan = api(page, "POST", "/plans/template")["data"]
        check(plan and plan.get("plan_id"), "стандартный план создан")
        e1 = api(page, "POST", "/users", {"full_name": "Петров Пётр Петрович", "position": "Оператор",
                                          "department": "Цех 1", "plan_id": plan["plan_id"],
                                          "start_date": time.strftime("%Y-%m-%d")})["data"]
        api(page, "POST", "/users", {"full_name": "Сидорова Анна Сергеевна", "position": "Мастер",
                                     "department": "Цех 1"})
        r = api(page, "POST", "/users/" + e1["id"] + "/test-messages", {})
        check(r["status"] == 200, "тестовые сообщения всех типов отправлены сотруднику")
        page.reload()
        page.wait_for_load_state("load")
        page.wait_for_timeout(800)

        print("Вкладки админки")
        for tab in ("employees", "builder", "docs", "plantexts", "questions"):
            page.click(f'.tab[data-tab="{tab}"]')
            page.wait_for_timeout(900)
            check(page.is_visible(f"#pane-{tab}"), f"вкладка {tab} открывается")
            shot(page, f"admin-{tab}")
        page.click('.tab[data-tab="employees"]')
        page.wait_for_timeout(500)
        check(page.locator("#employee-list tbody tr").count() >= 3, "в списке пользователей есть строки")

        print("Конструктор: выбор сохранённого плана и снимок состояния")
        page.click('.tab[data-tab="builder"]')
        page.wait_for_timeout(800)
        page.select_option("#plan-select", plan["plan_id"])
        page.wait_for_timeout(800)
        title_before = page.input_value("#plan-title")
        stages_before = page.locator("#stages-container .stage-card").count()
        check(stages_before == 8, f"стандартный план: 8 этапов в редакторе (есть {stages_before})")
        page.click('.tab[data-tab="employees"]')
        page.wait_for_timeout(400)

        print("Тур по админке")
        titles = tour_run(page, "admin", 25)
        check(any("Стандартный" in t or "С чего начать" in t for t in titles), "тур показывает выбор плана")
        page.wait_for_timeout(600)
        check(page.locator('.tab.active').get_attribute("data-tab") == "employees", "после тура — та же вкладка")
        check(not page.is_visible("#employee-dialog"), "окно карточки закрыто после тура")
        page.click('.tab[data-tab="builder"]')
        page.wait_for_timeout(500)
        check(page.input_value("#plan-title") == title_before, "редактируемый план вернулся после тура")
        check(page.locator("#stages-container .stage-card").count() == stages_before, "этапы плана не изменились")
        plans_after = api(page, "GET", "/plans")["data"]["plans"]
        check(len(plans_after) == 1, "тур ничего не сохранил (план один)")

        print("Автопросмотр: тур идёт сам")
        page.click('.tab[data-tab="employees"]')
        page.click("#btn-tour")
        page.wait_for_selector(".nmt-card.nmt-in")
        first = page.inner_text(".nmt-count")
        page.wait_for_function("(c) => document.querySelector('.nmt-count').textContent !== c",
                               arg=first, timeout=20000)
        check(True, f"автопросмотр сам перешёл к следующему шагу ({first} → {page.inner_text('.nmt-count')})")
        page.keyboard.press("Escape")
        page.wait_for_function("() => document.querySelector('.nmt-root').hidden", timeout=5000)
        check(True, "Esc закрывает тур")

        print("Служебные страницы")
        for path in ("/globaltest", "/logs", "/plans-db", "/s3", "/documents-board", "/documents-table",
                     "/doc-breakdown", "/notify-test", "/queue-test", "/message-test"):
            before = len(errors)
            resp = page.goto(f"{BASE}{path}")
            page.wait_for_timeout(1200)
            check(resp.status == 200 and len(errors) == before, f"{path} открывается без ошибок JS")
        page.goto(f"{BASE}/admin")
        page.wait_for_timeout(800)

        print("Безопасность в браузере")
        hdr = page.evaluate("async () => (await fetch('/admin')).headers.get('content-security-policy')")
        check(hdr and "frame-ancestors 'none'" in hdr, "CSP на страницах")
        creds = api(page, "POST", f"/users/{e1['id']}/credentials", {"password": "Employee-pass-1"})
        check(creds["status"] == 200, "администратор выдал сотруднику пароль")

        # ---------------------------------------------------------- сотрудник на телефоне
        m = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                                locale="ru-RU", device_scale_factor=2)
        mp = m.new_page()
        watch(mp, "cabinet")
        print("Кабинет сотрудника (мобильный Chrome)")
        login(mp, creds["data"]["username"], "Employee-pass-1")
        check(mp.url.rstrip("/").endswith(":8000") or mp.url.endswith("/"), "сотрудник попадает в кабинет")
        mp.wait_for_timeout(1500)
        cards = mp.locator("#today-list .bubble")
        check(cards.count() >= 5, f"в чате сегодняшние сообщения ({cards.count()})")
        # старые сверху, новые снизу: время карточек не убывает
        times = mp.eval_on_selector_all("#today-list .b-time", "els => els.map(e => e.textContent)")
        check(times == sorted(times), "сообщения: старые сверху, новые снизу")
        box = mp.eval_on_selector("#today-list", "el => el.scrollHeight - el.scrollTop - el.clientHeight")
        check(box < 60, "лента прокручена к последнему сообщению")
        shot(mp, "cabinet-today")
        # чек-лист: отметка пункта сохраняется
        item = mp.locator("#today-list .check").first
        if item.count():
            item.click()
            mp.wait_for_timeout(600)
            check(mp.locator("#today-list .check.on").count() >= 1, "пункт чек-листа отмечается")
        tour_run(mp, "cabinet", 10)
        check(mp.locator('.tab.active').get_attribute("data-tab") == "today", "после тура кабинет на вкладке «Чат»")
        check(mp.input_value("#question-input") == "", "напечатанный туром вопрос стёрт")
        for tab in ("history", "ask", "settings"):
            mp.click(f'.tab[data-tab="{tab}"]')
            mp.wait_for_timeout(500)
            shot(mp, f"cabinet-{tab}")
        overflow = mp.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        check(overflow <= 1, "нет горизонтальной прокрутки на телефоне")

        # Админка на телефоне — тур читаем (карточка-шторка)
        ap = m.new_page()
        watch(ap, "admin-mobile")
        login(ap, owner_username(), OWNER_PASS)
        ap.click("#btn-tour")
        ap.wait_for_selector(".nmt-card.nmt-in")
        ap.wait_for_timeout(900)
        shot(ap, "admin-mobile-tour")
        rect = ap.eval_on_selector(".nmt-card", "e => { const r = e.getBoundingClientRect(); return [r.left, r.right, r.bottom]; }")
        check(rect[0] >= 0 and rect[1] <= 390 and rect[2] <= 844, "карточка тура помещается в экран телефона")
        ap.keyboard.press("Escape")
        browser.close()

    print("\nОшибки JS:" if errors else "\nОшибок JS нет")
    for e in errors:
        print("  " + e)
    bad = [w for ok, w in checks if not ok]
    print(f"Проверок: {len(checks)}, провалено: {len(bad)}")
    return 1 if bad or errors else 0


if __name__ == "__main__":
    sys.exit(main())

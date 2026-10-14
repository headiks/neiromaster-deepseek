"""
Обновляет описания этапов и брифы подэтапов ВО ВСЕХ существующих планах из каталога
(data/stage_catalog.json). Нужно после расширения каталога: планы хранят свою копию
текстов с момента создания, поэтому правка каталога сама их не меняет.

Обновляются только тексты (описание этапа, brief и tags подэтапа с source='template'
и известным catalog_id). Расписание, порядок, заголовки и ручные подэтапы не трогаются.
Сгенерированные ответы не меняются — после обновления запусти «Догенерировать».

Обходит общую схему и все компании (у каждой свои планы).

Запуск на сервере:
    docker compose exec web python scripts/refresh_plans.py
"""
import _path  # noqa: F401,E402 — backend/ в sys.path
# ВАЖНО: config импортируется ПЕРВЫМ — при импорте он читает .env.production/.env в
# окружение. Иначе db.py (импортируется из planner) зафиксирует DSN по умолчанию
# (neiromaster:neiromaster) ещё до загрузки секретов и упрётся в ошибку пароля.
import config  # noqa: F401  (нужен ради побочного эффекта: загрузка .env)
import db
import planner
import provisioning


def main():
    refresh_schema("общая схема")
    for schema in provisioning.schemas(fresh=True):
        with db.use_schema(schema):
            refresh_schema(schema)


def refresh_schema(where: str):
    print(f"== {where}")
    plans = planner.list_plans()
    if not plans:
        print("Планов нет.")
        return
    total_fields = 0
    for p in plans:
        pid = p.get("plan_id")
        res = planner.refresh_from_catalog(pid)
        n = (res or {}).get("_refreshed", 0)
        total_fields += n
        print(f"  {pid} ({p.get('title')}): обновлено полей {n}")
    print(f"Готово: планов {len(plans)}, всего обновлений {total_fields}.")
    print("Дальше: для нужных планов нажми «Догенерировать», чтобы тексты перегенерились.")


if __name__ == "__main__":
    main()

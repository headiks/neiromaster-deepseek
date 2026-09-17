"""
Обновляет описания этапов и брифы подэтапов ВО ВСЕХ существующих планах из каталога
(data/stage_catalog.json). Нужно после расширения каталога: планы хранят свою копию
текстов с момента создания, поэтому правка каталога сама их не меняет.

Обновляются только тексты (описание этапа, brief и tags подэтапа с source='template'
и известным catalog_id). Расписание, порядок, заголовки и ручные подэтапы не трогаются.
Сгенерированные ответы не меняются — после обновления запусти «Догенерировать».

Запуск на сервере:
    source .venv/bin/activate
    python refresh_plans.py
"""
import planner


def main():
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

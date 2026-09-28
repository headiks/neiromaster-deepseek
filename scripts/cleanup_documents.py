"""
Очистка базы документов: оставить только демонстрационные (имя файла начинается с цифры),
остальные удалить — той же логикой, что кнопка «Удалить» в админке: запись в реестре,
разметка docpipe, оригинал на диске и в S3, markdown и кэш разбора.

Запуск — на сервере, из папки приложения, тем же Python, что и сайт:

    .venv/bin/python scripts/cleanup_documents.py --pull     # 1. подтянуть из S3 все оригиналы (для бэкапа)
    .venv/bin/python scripts/cleanup_documents.py            # 2. пробный прогон: только список
    .venv/bin/python scripts/cleanup_documents.py --apply    # 3. удалить (ТОЛЬКО после бэкапа БД и файлов)

По умолчанию — общая схема (данные, заведённые до разделения на компании). Документы
конкретной компании: --company <код> (например --company alfa).

После удаления сообщения планов, опиравшиеся на удалённые документы, обновятся сами
(как после удаления в админке) — это запросы к DeepSeek.
"""
import contextlib
import sys

import _path  # noqa: F401,E402 — backend/ в sys.path
import config  # noqa: F401 — первым: грузит .env.production (DSN БД, S3) до импорта db
import db
import docregistry
import documents
import indexing
import provisioning
import storage
from config import docs_dir


def is_demo(filename: str) -> bool:
    return bool(filename) and filename[0].isdigit()


def known_documents() -> set:
    """Все документы, о которых знает приложение: реестр + метаданные v1."""
    names = {d.get("filename") for d in docregistry.list_documents()}
    names |= {d.get("filename") for d in documents.list_meta()}
    return {n for n in names if n}


def disk_orphans(known: set) -> list:
    """Файлы в data/documents, которых нет ни в реестре, ни в метаданных, и не демо."""
    if not docs_dir().exists():
        return []
    return sorted(p.name for p in docs_dir().iterdir()
                  if p.is_file() and p.name not in known and not is_demo(p.name))


def pull_all() -> int:
    """Скачать из S3 оригиналы, которых нет на диске, — чтобы бэкап data/documents был полным."""
    pulled = 0
    for entry in docregistry.list_documents():
        rel = entry.get("path") or entry.get("filename")
        path = docs_dir() / rel
        if path.exists():
            continue
        try:
            if storage.pull(path, entry.get("s3_key") or ""):
                pulled += 1
                print(f"  скачан: {rel}")
            else:
                print(f"  НЕТ ни на диске, ни в S3: {rel}")
        except Exception as e:
            print(f"  ошибка скачивания {rel}: {e}")
    return pulled


def main(argv):
    if "--pull" in argv:
        print(f"Скачано из S3: {pull_all()}")
        return

    known = known_documents()
    keep = sorted(n for n in known if is_demo(n))
    drop = sorted(n for n in known if not is_demo(n))
    orphans = disk_orphans(known)

    print(f"ОСТАНУТСЯ (демо, имя начинается с цифры) — {len(keep)}:")
    for n in keep:
        print(f"  + {n}")
    print(f"\nБУДУТ УДАЛЕНЫ (реальные документы) — {len(drop)}:")
    for n in drop:
        print(f"  - {n}")
    if orphans:
        print(f"\nФайлы на диске без записи в реестре, тоже будут удалены — {len(orphans)}:")
        for n in orphans:
            print(f"  - {n}")

    if "--apply" not in argv:
        print("\nПробный прогон: ничего не удалено. Удалить — с флагом --apply.")
        return
    if not keep:
        # Защита: если демо-файлы названы иначе, --apply снёс бы всю базу документов.
        raise SystemExit("\nОтмена: не найдено ни одного демо-документа (имя с цифры) — "
                         "удалять всё подряд не буду.")

    failed = []
    for n in drop:
        try:
            indexing.delete_document(n)
            try:
                documents.remove_by_filename(n)
            except Exception:
                pass                          # метаданных v1 у документа может не быть
            print(f"  удалён: {n}")
        except Exception as e:
            failed.append(n)
            print(f"  ОШИБКА {n}: {e}")
    for n in orphans:
        (docs_dir() / n).unlink(missing_ok=True)
        print(f"  удалён файл: {n}")

    indexing.docs_changed()                   # как после удаления в админке
    print(f"\nГотово: удалено документов {len(drop) - len(failed)}, файлов-сирот {len(orphans)}, "
          f"осталось демо {len(keep)}." + (f" Не удалось: {failed}" if failed else ""))


if __name__ == "__main__":
    argv = sys.argv[1:]
    slug = argv[argv.index("--company") + 1] if "--company" in argv else ""
    with db.use_schema(provisioning.schema_for(slug)) if slug else contextlib.nullcontext():
        main(argv)

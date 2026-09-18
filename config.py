"""
Общие пути и низкоуровневые константы. Никакой бизнес-логики — только то,
что нужно и indexing.py, и topics.py, и rag.py одновременно.
Вынесено отдельно, чтобы indexing.py <-> topics.py не импортировали друг друга по кругу.
"""
import os
import threading
from pathlib import Path

try:
    import fcntl   # POSIX (Linux/macOS). На Windows недоступен — см. FileGuard.
except ImportError:
    fcntl = None


class FileGuard:
    """Блокировка безопасного read-modify-write для файловых хранилищ (реестр
    документов, очередь вопросов). threading.Lock синхронизирует потоки одного
    процесса, flock — параллельные uvicorn-воркеры (`--workers N`): без него две
    одновременные записи в один JSON затирают друг друга (потерянное обновление).
    fcntl есть только на POSIX; на Windows тихо деградируем до внутрипроцессной
    блокировки (там multi-worker uvicorn и не применяется)."""

    def __init__(self, lock_path):
        self._tlock = threading.Lock()
        self._path = str(lock_path)
        self._fh = None

    def __enter__(self):
        self._tlock.acquire()
        if fcntl is not None:
            try:
                self._fh = open(self._path, "w")
                fcntl.flock(self._fh, fcntl.LOCK_EX)
            except OSError:
                if self._fh is not None:
                    self._fh.close()
                self._fh = None
        return self

    def __exit__(self, *exc):
        try:
            if self._fh is not None:
                try:
                    fcntl.flock(self._fh, fcntl.LOCK_UN)
                finally:
                    self._fh.close()
                    self._fh = None
        finally:
            self._tlock.release()

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"

# Локальная загрузка .env (без зависимостей): построчно KEY=VALUE. НЕ перетирает уже
# заданные переменные окружения (env приоритетнее файла) — на сервере их обычно задаёт
# systemd, тогда файл можно не держать. Файлы в .gitignore, секреты в git не попадают.
# Грузим и .env.production (на нём же работает systemd-сервис), чтобы CLI-скрипты
# (provisioning, storage, migrate) видели те же секреты S3/БД, что и приложение —
# .env.production берёт верх над .env.
for _name in (".env.production", ".env"):
    _env_file = BASE_DIR / _name
    if not _env_file.exists():
        continue
    for _line in _env_file.read_text(encoding="utf-8").splitlines():
        _line = _line.strip()
        if not _line or _line.startswith("#") or "=" not in _line:
            continue
        _k, _, _v = _line.partition("=")
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

# data/documents/<topic_slug>/<файл>   — оригиналы, разложенные по темам (папкам)
# data/converted/<topic_slug>/<файл>.md — то же самое в виде markdown (таблицы читаемы для ИИ)
# data/processed/<hash>.json            — кэш разобранного docling-документа (техническое, для ускорения повторной обработки)
DOCS_DIR = DATA_DIR / "documents"
CONVERTED_DIR = DATA_DIR / "converted"
CACHE_DIR = DATA_DIR / "processed"
REGISTRY_PATH = DATA_DIR / "registry.json"

for d in (DOCS_DIR, CONVERTED_DIR, CACHE_DIR):
    d.mkdir(parents=True, exist_ok=True)

SUPPORTED_EXT = {".pdf", ".docx", ".doc", ".pptx", ".html", ".htm", ".md", ".txt"}
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 МБ на файл

# S3-совместимое хранилище оригиналов (Timeweb и т.п.). Если заданы и endpoint, и
# bucket — оригиналы дублируются в S3, а data/documents/ работает как локальный кэш
# (его можно очистить и восстановить из S3, см. storage.py). Производные (converted/,
# processed/) остаются локальными — они регенерируются из оригинала.
# ВАЖНО: ключи берутся ТОЛЬКО из окружения, в код и git не попадают.
S3_ENDPOINT = os.environ.get("NEIROMASTER_S3_ENDPOINT", "")
S3_BUCKET   = os.environ.get("NEIROMASTER_S3_BUCKET", "")
S3_KEY      = os.environ.get("NEIROMASTER_S3_KEY", "")
S3_SECRET   = os.environ.get("NEIROMASTER_S3_SECRET", "")
S3_REGION   = os.environ.get("NEIROMASTER_S3_REGION", "ru-1")
S3_PREFIX   = os.environ.get("NEIROMASTER_S3_PREFIX", "documents/")  # префикс ключей в бакете
S3_ENABLED  = bool(S3_ENDPOINT and S3_BUCKET)

# Эмбеддинги и векторный стор (Qdrant) удалены целиком: классификацию документов
# (этапы/подэтапы/профессии) и поиск/генерацию делает DeepSeek через docpipe (LLM-метки
# в Postgres, см. docpipe.pipeline и rag.route_substages). Косинуса/векторов больше нет.

"""
Общее подключение к Redis для высоконагруженного режима (много web-воркеров +
отдельные worker-процессы). Redis нужен, чтобы разделяемое состояние (очереди
задач, прогресс/отмена генерации и индексации, история диалогов, глобальный
лимитер вызовов DeepSeek) было видно ВСЕМ процессам, а не жило в памяти одного.

Если REDIS_URL не задан или Redis недоступен — get_redis() вернёт None, и весь код
откатывается на прежнее одно-процессное поведение (in-memory очереди/словари). Так
dev-машина и тесты работают без Redis, а прод включает его одной переменной.
"""
import os
import threading

_client = None
_checked = False
_lock = threading.Lock()

# По умолчанию пробуем локальный Redis. Пустая строка в REDIS_URL — явно выключить.
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")


def get_redis():
    """Возвращает общий redis-клиент или None, если Redis не настроен/недоступен.
    Результат кэшируется: недоступность проверяется один раз (ping), чтобы каждый
    запрос не платил за коннект к мёртвому Redis."""
    global _client, _checked
    if _checked:
        return _client
    with _lock:
        if _checked:
            return _client
        _checked = True
        url = os.environ.get("REDIS_URL", REDIS_URL)
        if not url:
            _client = None
            return None
        try:
            import redis
            c = redis.from_url(url, decode_responses=True,
                               socket_connect_timeout=2, socket_timeout=5,
                               health_check_interval=30)
            c.ping()
            _client = c
            print(f"[redis] подключён: {url}")
        except Exception as e:
            print(f"[redis] недоступен ({e}) — режим одного процесса (in-memory)")
            _client = None
        return _client


def redis_available() -> bool:
    return get_redis() is not None


def reset():
    """Сброс кэша коннекта (для тестов)."""
    global _client, _checked
    with _lock:
        _client = None
        _checked = False

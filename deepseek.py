"""
Единый клиент онлайн-модели DeepSeek (OpenAI-совместимый /chat/completions).

Заменяет прежний оффлайн-LLM (Ollama qwen). Один источник вызова для rag.py и
docpipe/llm.py: детерминированный вывод (temperature=0), строгий JSON-режим
(response_format), повтор при сетевых сбоях и таймауте — то, что нужно для
скорости и надёжности запросов к облачной модели.

Ключ/модель/URL — из окружения (или из config, который грузит .env):
  DEEPSEEK_API_KEY   — ключ (обязателен)
  DEEPSEEK_MODEL     — модель для генерации/разметки (по умолчанию deepseek-chat)
  DEEPSEEK_BASE_URL  — базовый URL (по умолчанию https://api.deepseek.com)

Почему deepseek-chat, а не deepseek-reasoner: reasoner тратит бюджет вывода на
цепочку рассуждений и не отдаёт объёмный структурированный JSON (пустой/обрезанный
ответ), а json-режим не поддерживает. Для нашей разметки/генерации нужен именно
компактный строгий JSON — его даёт deepseek-chat.
"""
import os
import time

import requests

API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")

# Таймауты (сек). Генерация/разметка длинных ответов бывает медленной под нагрузкой.
TIMEOUT = int(os.environ.get("DEEPSEEK_TIMEOUT", "300"))
MAX_RETRIES = int(os.environ.get("DEEPSEEK_MAX_RETRIES", "3"))
_RETRYABLE = (requests.exceptions.Timeout, requests.exceptions.ConnectionError,
              requests.exceptions.SSLError)


def chat(system: str, user: str, *, json_mode: bool = False, model: str = None,
         temperature: float = 0.0, max_tokens: int = 8192, timeout: int = None) -> str:
    """Один запрос к DeepSeek, возвращает message.content.

    json_mode=True — response_format=json_object (строгий JSON без ```-заборов).
    Слово «JSON» должно присутствовать в промпте (требование API) — в наших
    системных промптах оно есть. При обрыве по длине или пустом ответе — ошибка.
    """
    if not API_KEY or API_KEY.startswith("sk-клю") or API_KEY in ("sk-ключ", "sk-key"):
        raise RuntimeError("DEEPSEEK_API_KEY не задан (env или .env).")
    body = {
        "model": model or MODEL,
        "messages": [{"role": "system", "content": system},
                     {"role": "user", "content": user}],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}

    # 429/5xx у DeepSeek транзиентны (их API часто отдаёт 503 «Service is too busy»)
    # — повторяем с нарастающей паузой, как и сетевые сбои.
    RETRY_STATUS = {429, 500, 502, 503, 504}
    r = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.post(
                f"{BASE_URL}/chat/completions",
                headers={"Authorization": f"Bearer {API_KEY}",
                         "Content-Type": "application/json"},
                json=body, timeout=timeout or TIMEOUT,
            )
        except _RETRYABLE as e:
            if attempt == MAX_RETRIES:
                raise RuntimeError(f"DeepSeek: сеть недоступна после {MAX_RETRIES} попыток: {e}")
            time.sleep(2 * attempt)
            continue
        if r.status_code in RETRY_STATUS and attempt < MAX_RETRIES:
            time.sleep(2 * attempt)          # перегрузка/лимит — ждём и повторяем
            continue
        break
    if r.status_code >= 400:
        hint = " (DeepSeek перегружен — повторите позже)" if r.status_code in RETRY_STATUS else ""
        raise RuntimeError(f"DeepSeek API {r.status_code}{hint}: {r.text[:300]}")
    ch = r.json()["choices"][0]
    content = (ch.get("message") or {}).get("content") or ""
    if ch.get("finish_reason") == "length":
        raise RuntimeError("DeepSeek: ответ обрезан по лимиту (увеличь max_tokens "
                           "или уменьши входной фрагмент).")
    if not content.strip():
        raise RuntimeError("DeepSeek: пустой ответ модели.")
    return content

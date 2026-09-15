"""
Индексация документов по модели «человек управляет структурой, ИИ классифицирует
внутрь неё» (см. ТЗ). Используется CLI (index_documents.py) и веб-приложением (app.py).

Путь документа от загрузки до готовности к нейропоиску:

    оригинал (pdf/docx/...), хранится ОДИН раз плоско в data/documents/
        -> DocumentConverter (docling): разбор макета, таблиц, заголовков
           (DoclingDocument кэшируется как JSON в data/processed)
        -> classify.summarize_document(): краткое смысловое описание документа
        -> classify.find_similar_docs(): поиск похожих (дубли/противоречия)
        -> classify.classify_document(): отнесение к СУЩЕСТВУЮЩИМ папкам (по смыслу)
        -> HybridChunker + перекрытие: смысловые чанки с сохранением контекста границ
        -> classify.classify_chunk(): мульти-лейбл метки папок и этапов у каждого чанка
        -> эмбеддинг (bge-m3) -> Qdrant, payload: folders[], stage_ids[], summary, uploaded_at

Папка — логическая метка, а не физическая директория: документ и его чанки могут
относиться к нескольким папкам сразу, а все документы всегда попадают в общую базу
«Все документы» (вся коллекция) независимо от папок.
"""

from __future__ import annotations  # аннотации-строки: тип DoclingDocument не грузит docling при импорте

import re
import time
import uuid
import queue
import hashlib
import threading
from pathlib import Path
from typing import Optional

from qdrant_client import QdrantClient
from qdrant_client.models import (
    VectorParams, Distance, PointStruct, Filter, FieldCondition, MatchValue, MatchAny,
    PayloadSchemaType,
)

# docling НЕ импортируем на уровне модуля: он тяжёлый (модели разметки, ~ГБ RAM), а
# нужен только при разборе документа, что теперь делают worker-процессы, а не web.
# Ленивая загрузка ниже (_converter) — web-воркеры не платят за docling памятью/стартом.

import classify
import folders
import documents
import storage
import docregistry
from config import (
    DOCS_DIR, CONVERTED_DIR, CACHE_DIR,
    SUPPORTED_EXT, MAX_UPLOAD_BYTES,
    QDRANT_HOST, QDRANT_PORT, EMBED_DIM, get_embedding, cosine,
)

# Символическое перекрытие между соседними чанками (ТЗ §12): в текст для эмбеддинга
# следующего чанка добавляется «хвост» предыдущего, чтобы информация на границе не
# терялась. Доля от чанка, а не жёсткое число — грубая, но рабочая эвристика.
# ponytail: фиксированная доля; при желании стратегию можно усложнить под модель/структуру.
OVERLAP_CHARS = 240

# ---------- Qdrant (основная коллекция чанков) ----------
COLLECTION_NAME = "reglaments"

MAX_TOKENS = 512     # бюджет токенов на чанк (под окно эмбеддинг-модели)
MERGE_PEERS = True   # склеивать соседние мелкие чанки одного уровня иерархии
UPSERT_BATCH = 64

client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
_converter = None
_chunker = None
_docling_lock = threading.Lock()


def _get_converter():
    """Ленивый singleton docling — грузится при первом разборе (в worker-процессе)."""
    global _converter, _chunker
    if _converter is None:
        with _docling_lock:
            if _converter is None:
                from docling.document_converter import DocumentConverter
                from docling.chunking import HybridChunker
                _chunker = HybridChunker(max_tokens=MAX_TOKENS, merge_peers=MERGE_PEERS)
                _converter = DocumentConverter()
    return _converter

# Межпроцессная блокировка реестра: read-modify-write registry.json безопасен и при
# нескольких uvicorn-воркерах (см. config.FileGuard). Раньше был обычный threading.Lock,
# который между процессами не действует — параллельные записи теряли обновления.
def _log(step, msg):
    print(f"[INDEX:{step}] {msg}")


# ---------- Реестр документов ----------
# Само хранилище вынесено в docregistry.py (файловый store под блокировкой). Здесь —
# только реэкспорт публичных имён (indexing.list_documents и т.п. зовут снаружи).
_update_registry = docregistry.update
_load_registry = docregistry.load
list_documents = docregistry.list_documents
set_clarification = docregistry.set_clarification
folder_doc_counts = docregistry.folder_doc_counts


# ---------- Вспомогательные функции ----------
def safe_filename(filename: str) -> str:
    """Убираем путь и опасные символы — защита от path traversal при загрузке."""
    name = Path(filename).name
    name = re.sub(r"[^\w\-. а-яА-ЯёЁ]", "_", name)
    return name or f"document_{uuid.uuid4().hex[:8]}"


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()[:16]


# Поля payload, по которым идёт фильтрация при поиске. Без явного индекса Qdrant
# фильтрует полным перебором точек — на 100-200 документах (тысячи чанков) это
# заметно медленнее. Индекс делает отбор по теме/источнику почти бесплатным,
# поэтому двухступенчатый поиск (сначала темы, потом чанки внутри них) масштабируется.
PAYLOAD_INDEXES = {
    "folders": PayloadSchemaType.KEYWORD,        # массив slug'ов — MatchAny фильтрует по папкам
    "stage_ids": PayloadSchemaType.KEYWORD,      # массив id блоков знаний — приоритет по текущему этапу
    "plan_stages": PayloadSchemaType.KEYWORD,    # id этапов каталога — «папки этапов» для генерации плана
    "plan_substages": PayloadSchemaType.KEYWORD, # id подэтапов каталога — «папки подэтапов» (тоньше этапа)
    "meaningful": PayloadSchemaType.BOOL,        # содержательный чанк (мусор в распределение не идёт)
    "source": PayloadSchemaType.KEYWORD,
    "section": PayloadSchemaType.KEYWORD,
}


def ensure_payload_indexes():
    for field, schema in PAYLOAD_INDEXES.items():
        try:
            client.create_payload_index(COLLECTION_NAME, field_name=field, field_schema=schema)
        except Exception as exc:
            # Индекс уже есть — Qdrant отвечает ошибкой, это не фатально.
            _log("INDEX", f"payload-индекс {field}: {exc}")


def create_collection(recreate: bool = False):
    collections = [c.name for c in client.get_collections().collections]
    if COLLECTION_NAME in collections:
        if recreate:
            client.delete_collection(COLLECTION_NAME)
        else:
            ensure_payload_indexes()
            classify.ensure_collections()
            return
    client.create_collection(
        collection_name=COLLECTION_NAME,
        vectors_config=VectorParams(size=EMBED_DIM, distance=Distance.COSINE),
    )
    ensure_payload_indexes()
    classify.ensure_collections()


def extract_page_no(chunk) -> Optional[int]:
    try:
        return chunk.meta.doc_items[0].prov[0].page_no
    except (AttributeError, IndexError, TypeError):
        return None


# ---------- Конвертация с кэшированием ----------
def _detect_rotated_pages(path: Path) -> dict:
    """{индекс_страницы: угол_текста°} для страниц, где текст нарисован боком
    (ландшафтные таблицы без флага /Rotate). Угол — из pdfium (FPDFText_GetCharAngle,
    против часовой). Ровные страницы (0°) в результат не попадают."""
    import math
    import statistics
    import pypdfium2 as pdfium
    import pypdfium2.raw as pdfium_c
    out = {}
    pdf = pdfium.PdfDocument(str(path))
    try:
        for i in range(len(pdf)):
            tp = pdf[i].get_textpage()
            try:
                n = tp.count_chars()
                if n < 20:          # мало текста — угол ненадёжен, пропускаем
                    continue
                step = max(1, n // 200)   # выборка символов, не весь текст
                angs = [pdfium_c.FPDFText_GetCharAngle(tp.raw, k) for k in range(0, n, step)]
                angs = [a for a in angs if a is not None and a >= 0]
                if not angs:
                    continue
                deg = round(math.degrees(statistics.median(angs))) % 360
                if deg in (90, 270):
                    out[i] = deg
            finally:
                tp.close()
    finally:
        pdf.close()
    return out


def _normalize_rotation(filepath: Path):
    """Разворачивает страницы с боком-нарисованным текстом, чтобы docling читал их
    правильно (иначе таблица приходит перемешанной). Возвращает (путь_для_docling,
    временный_ли_файл). Не-PDF и любой сбой -> исходный файл (индексацию не роняем)."""
    if filepath.suffix.lower() != ".pdf":
        return filepath, False
    try:
        rotated = _detect_rotated_pages(filepath)
        if not rotated:
            return filepath, False
        from pypdf import PdfReader, PdfWriter
        reader = PdfReader(str(filepath))
        writer = PdfWriter()
        for i, page in enumerate(reader.pages):
            if i in rotated:
                page.rotate((360 - rotated[i]) % 360)   # компенсируем угол текста
            writer.add_page(page)
        tmp = CACHE_DIR / f"{filepath.stem}__norot_{file_hash(filepath)}.pdf"
        with open(tmp, "wb") as f:
            writer.write(f)
        print(f"[index] {filepath.name}: развёрнуто повёрнутых страниц: {len(rotated)}")
        return tmp, True
    except Exception as e:
        print(f"[index] нормализация поворота не удалась ({filepath.name}): {e}")
        return filepath, False


def convert_document(filepath: Path) -> DoclingDocument:
    """
    Гоняем файл через docling. Разбор PDF/DOCX (особенно PDF с layout-моделью)
    — самая тяжёлая часть пайплайна, поэтому результат кэшируется в JSON:
    при повторной обработке того же файла (переезд между папками, смена
    параметров чанкинга) можно переиспользовать готовую структуру документа.
    """
    # если локальной копии нет — тянем оригинал из S3 по ключу из реестра
    # (структура <суперадмин>/<админ>/<файл>; у старых записей ключа нет — плоский)
    from docling_core.types.doc.document import DoclingDocument
    storage.pull(filepath, _load_registry().get(filepath.name, {}).get("s3_key") or "")
    cache_path = CACHE_DIR / f"{filepath.stem}__{file_hash(filepath)}.json"
    if cache_path.exists():
        return DoclingDocument.load_from_json(str(cache_path))

    # Повёрнутые страницы (боком-нарисованные таблицы) выправляем до docling.
    src, is_tmp = _normalize_rotation(filepath)
    try:
        result = _get_converter().convert(str(src))
    finally:
        if is_tmp:
            try:
                src.unlink()
            except OSError:
                pass
    doc = result.document
    doc.save_as_json(str(cache_path))
    return doc


# Номер пункта регламента в начале строки: «5», «5.1», «5.1.2», с точкой или скобкой.
# Регламенты часто нумеруют пункты цифрами без стилей заголовков — docling такой
# документ отдаёт сплошным текстом, и без этого деления один пункт не отделить от другого.
CLAUSE_RE = re.compile(r"(?m)^[ \t]*(\d+(?:\.\d+){0,3})[.)]?[ \t]+(?=\S)")


def sectionize_by_clause(text: str) -> list:
    """
    Делит текст чанка на пункты по номерам в начале строки («5.1 ...»).
    Возвращает [(section_label, segment_text), ...]. Меньше двух номеров —
    возвращаем чанк целиком (section = единственный номер или None).
    Применяется только когда у чанка нет заголовков от docling (см. index_document).
    """
    marks = [(m.start(), m.group(1)) for m in CLAUSE_RE.finditer(text)]
    if len(marks) < 2:
        label = marks[0][1] if marks else None
        return [(label, text.strip())]
    segments = []
    for i, (pos, num) in enumerate(marks):
        end = marks[i + 1][0] if i + 1 < len(marks) else len(text)
        seg = text[pos:end].strip()
        if seg:
            segments.append((num, seg))
    return segments


# ---------- Индексация одного документа ----------
def _docpipe_progress_cb(filename: str):
    """Колбэк прогресса docpipe-разметки -> прогресс-бар на карточке документа.
    Троттлинг раз в секунду; секции маппим в 10..95%, чтобы бар двигался и не выглядел
    зависшим на больших документах (десятки секций × вызов DeepSeek на секцию)."""
    last = [0.0]
    def cb(done, total):
        now = time.time()
        if done < total and now - last[0] < 1.0:
            return
        last[0] = now
        pct = min(95, 10 + int(85 * done / max(total, 1)))
        _update_registry(filename, progress=pct, phase=f"Классификация docpipe: {done}/{total}")
    return cb


def index_document(filepath: Path) -> dict:
    """Приём документа: docling-разбор + классификация/разметка через docpipe
    (этапы/подэтапы, метки в Postgres). Векторов/эмбеддингов нет — ретрив идёт по
    LLM-меткам docpipe (см. rag.route_substages, planner через docpipe.chunks_for_substage)."""
    filename = filepath.name
    _update_registry(filename, status="processing", error=None,
                     phase="Классификация (docpipe)", progress=10)
    try:
        import docpipe
        start = time.time()
        res = docpipe.ingest(str(filepath), filename=filename, force=True,
                             progress_cb=_docpipe_progress_cb(filename))
        sections = res.get("sections") or 0
        elapsed = round(time.time() - start, 2)
        _update_registry(filename, status="indexed", chunks=sections, error=None,
                         indexed_in_seconds=elapsed, phase=None, progress=100, path=filename)
        _log("DONE", f"{filename}: классифицирован docpipe, секций {sections} за {elapsed} с")
        return {"filename": filename, "status": "indexed", "chunks": sections, "elapsed": elapsed}
    except Exception as e:
        _update_registry(filename, status="error", error=str(e))
        return {"filename": filename, "status": "error", "error": str(e)}


def _query_chunks(vector, query_filter, limit: int):
    """Векторный поиск чанков в Qdrant с (опциональным) фильтром payload. Возвращает
    список точек (у каждой .score и .payload). query_filter=None — без фильтра."""
    return client.query_points(
        collection_name=COLLECTION_NAME, query=vector, limit=limit,
        with_payload=True, query_filter=query_filter,
    ).points


def search_chunks(query_text: str, topic_slugs: Optional[list] = None, limit: int = 6,
                  plan_stage: Optional[str] = None, plan_substage: Optional[str] = None,
                  position: str = "") -> list:
    """
    Поиск чанков с сужением до тем (папок) и до ЭТАПА каталога адаптации (plan_stage —
    «папка этапа»: чанки, разложенные по этому этапу). Из двух похожих чанков приоритет
    получает тот, чья профессия ближе к должности плана (position) — механика приоритета
    по должности из rag. Если по этапу ничего нет (чанки ещё не разложены) — фолбэк без него.
    Возвращает [{"text", "source", "folders", "section", "page", "score"}].
    """
    vector = get_embedding(query_text)
    # Только содержательные чанки (мусор — заголовки/номера страниц — в генерацию не идёт).
    # meaningful != False ловит и старые чанки без поля (там его просто нет).
    base = [FieldCondition(key="meaningful", match=MatchValue(value=True))]
    if topic_slugs:
        base.append(FieldCondition(key="folders", match=MatchAny(any=list(topic_slugs))))

    fetch = max(limit * 3, limit) if position else limit
    # Сужение сверху вниз: подэтап -> этап -> без сужения. Первый непустой уровень выигрывает,
    # чтобы генерация работала и до полной раскладки «папок подэтапов».
    scope_filters = []
    if plan_substage:
        scope_filters.append(FieldCondition(key="plan_substages", match=MatchValue(value=plan_substage)))
    if plan_stage:
        scope_filters.append(FieldCondition(key="plan_stages", match=MatchValue(value=plan_stage)))
    hits = []
    for scope in scope_filters:
        hits = _query_chunks(vector, Filter(must=base + [scope]), fetch)
        if hits:
            break
    if not hits:
        hits = _query_chunks(vector, Filter(must=base) if base else None, fetch)
    # Совсем пусто (старые чанки без meaningful) — ищем без базового фильтра.
    if not hits:
        hits = _query_chunks(vector, None, fetch)

    if position:
        from rag import profession_delta, _prof_vec
        try:
            pv = _prof_vec(position)
        except Exception:
            pv = None
        hits = sorted(hits, key=lambda h: h.score + profession_delta((h.payload or {}).get("profession") or "", pv),
                      reverse=True)[:limit]

    return [{
        "text": h.payload.get("text", ""),
        "source": h.payload.get("source"),
        "folders": h.payload.get("folders") or [],
        "section": h.payload.get("section"),
        "page": h.payload.get("page"),
        "score": h.score,
    } for h in hits]


# ---------- Материализация «папок этапов»: раскладка чанков по этапам каталога ----------
PLAN_STAGE_MATCH = 0.45   # нижняя граница ПОКАЗА кандидата в обосновании (не привязки)
# bge-m3 на русском даёт высокий «пол» косинуса (0.45–0.55 у любых двух текстов),
# поэтому по абсолютному порогу документ цепляется к десяткам подэтапов. Привязку делаем
# ОТНОСИТЕЛЬНОЙ: держим только подэтапы, близкие к лучшему для этого чанка, и не ниже пола.
PLAN_SUBSTAGE_FLOOR = 0.55   # ниже — точно шум (канцелярит/метаданные), не привязываем
PLAN_SUBSTAGE_MARGIN = 0.04  # отставание от лучшего для чанка, дальше — обрыв
PLAN_SUBSTAGE_TOPK = 2       # максимум подэтапов на чанк


def _select_substages(scored):
    """Из [(stage_id, sub_id, score)] оставляет только уверенные привязки чанка:
    топ по score, в пределах MARGIN от лучшего и не ниже FLOOR, максимум TOPK.
    Так один чанк ложится в 0–3 подэтапа, а не в половину каталога."""
    scored = sorted(scored, key=lambda x: x[2], reverse=True)
    if not scored or scored[0][2] < PLAN_SUBSTAGE_FLOOR:
        return []
    best = scored[0][2]
    out = []
    for stid, sub_id, sc in scored:
        if sc < PLAN_SUBSTAGE_FLOOR or sc < best - PLAN_SUBSTAGE_MARGIN:
            break
        out.append((stid, sub_id, sc))
        if len(out) >= PLAN_SUBSTAGE_TOPK:
            break
    return out


_CATALOG_STAGE_VECS = None   # ((stage_id, vec)...), ((stage_id, sub_id, vec)...)


def _catalog_stage_vectors():
    """Эмбеддинги «запросов» этапов и подэтапов каталога. Кэш на время процесса.
    ponytail: сброс кэша — рестарт или reset_stage_vectors(); каталог меняется редко."""
    global _CATALOG_STAGE_VECS
    if _CATALOG_STAGE_VECS is None:
        import planner
        cat = planner.load_catalog()
        sv, subv = [], []
        for st in cat.get("stages") or []:
            sv.append((st["id"], get_embedding(planner.catalog_stage_query(st))))
            for sub in st.get("substage_templates") or []:
                subv.append((st["id"], sub["id"], get_embedding(planner.catalog_substage_query(st, sub))))
        _CATALOG_STAGE_VECS = (sv, subv)
    return _CATALOG_STAGE_VECS


def reset_stage_vectors():
    global _CATALOG_STAGE_VECS
    _CATALOG_STAGE_VECS = None


def _stage_tags(vec):
    """(plan_stages[], plan_substages[]) для вектора чанка. Привязка ОТНОСИТЕЛЬНАЯ
    (см. _select_substages): 0–3 самых близких подэтапа, а не всё подряд по порогу.
    Этапы выводятся из принятых подэтапов."""
    _, subv = _catalog_stage_vectors()
    scored = [(stid, sub_id, cosine(vec, sv)) for stid, sub_id, sv in subv]
    accepted = _select_substages(scored)
    subs = sorted({s for _, s, _ in accepted})
    stages = sorted({st for st, _, _ in accepted})
    return stages, subs


def assign_chunks_to_stages(job_id: str = None) -> dict:
    """Раскладывает содержательные чанки по этапам И подэтапам каталога адаптации: каждому
    чанку проставляет payload.plan_stages и payload.plan_substages — id, смыслу которых он
    соответствует (по близости к «запросу этапа/подэтапа»). Мульти-лейбл: один чанк (и один
    документ) может относиться к нескольким этапам и подэтапам. Служебный мусор (meaningful=False)
    пропускается — метки пустые. Дёшево: эмбеддинги этапов/подэтапов + косинус к готовым векторам.

    job_id — если задан, прогресс пишется в стор задач (_index_jobs), фронт тянет его
    через GET /documents/jobs/{job_id} и рисует живой прогресс-бар."""
    try:
        reset_stage_vectors()                   # каталог мог измениться — пересчитать векторы
        stage_vecs, sub_vecs = _catalog_stage_vectors()
        for field in ("plan_stages", "plan_substages"):
            try:
                client.create_payload_index(COLLECTION_NAME, field_name=field,
                                             field_schema=PayloadSchemaType.KEYWORD)
            except Exception:
                pass

        try:
            total = client.count(collection_name=COLLECTION_NAME).count or 0
        except Exception:
            total = 0
        if job_id:
            _set_index_job(job_id, status="processing", done=0, total=total,
                           started_at=time.strftime("%Y-%m-%dT%H:%M:%S"))

        offset = None
        touched = 0
        while True:
            batch, offset = client.scroll(
                collection_name=COLLECTION_NAME, limit=256,
                with_payload=True, with_vectors=True, offset=offset,
            )
            for p in batch:
                if (p.payload or {}).get("meaningful") is False:   # мусор не распределяем
                    client.set_payload(collection_name=COLLECTION_NAME,
                                       payload={"plan_stages": [], "plan_substages": []}, points=[p.id])
                    touched += 1
                    continue
                plan_stages, plan_substages = _stage_tags(p.vector)
                client.set_payload(collection_name=COLLECTION_NAME,
                                   payload={"plan_stages": plan_stages, "plan_substages": plan_substages},
                                   points=[p.id])
                touched += 1
            if job_id:
                _set_index_job(job_id, done=touched, total=max(total, touched))
            if offset is None:
                break
        _log("STAGES", f"чанков разложено: {touched} (этапов {len(stage_vecs)}, подэтапов {len(sub_vecs)})")
        result = {"chunks": touched, "stages": len(stage_vecs), "substages": len(sub_vecs)}
        if job_id:
            _set_index_job(job_id, status="done", done=touched, total=touched, result=result)
        return result
    except Exception as e:
        if job_id:
            _set_index_job(job_id, status="error", error=str(e))
        raise


def delete_document_vectors(filename: str):
    """Удаляет из Qdrant все точки данного документа (по полю source)."""
    client.delete(
        collection_name=COLLECTION_NAME,
        points_selector=Filter(
            must=[FieldCondition(key="source", match=MatchValue(value=filename))]
        ),
    )


def delete_document(filename: str, remove_file: bool = True) -> bool:
    """Полное удаление документа: разметка docpipe (Postgres) + оригинал + markdown +
    кэш + запись в реестре. Векторов больше нет."""
    try:
        from docpipe import store as _dp_store
        doc = _dp_store.find_by_filename(filename)
        if doc:
            _dp_store.delete_document(doc["id"])   # каскадом снесёт секции/метки/чанки
    except Exception as e:
        _log("DELETE", f"docpipe-разметка {filename}: {e}")

    entry = docregistry.get(filename)

    if entry and remove_file:
        rel_path = entry.get("path", filename)
        filepath = DOCS_DIR / rel_path
        # убираем оригинал из S3 по ключу владельца (no-op, если S3 выключен)
        storage.delete(rel_path, entry.get("s3_key") or "")
        if filepath.exists():
            filepath.unlink()
            for cache_file in CACHE_DIR.glob(f"{filepath.stem}__*.json"):
                cache_file.unlink()
        md_rel = entry.get("markdown_path")
        if md_rel:
            md_path = CONVERTED_DIR / md_rel
            if md_path.exists():
                md_path.unlink()

    existed = docregistry.remove(filename)

    # Синхронно убираем строку из реестра метаданных, чтобы экран не показывал удалённое.
    try:
        documents.remove_by_filename(filename)
    except Exception as e:
        _log("DELETE", f"метаданные {filename} из БД: {e}")
    return existed


# ---------- Снятие метки папки с чанков (при удалении/выключении папки) ----------
def strip_folder_from_chunks(slug: str):
    """Убирает slug папки из payload всех чанков и из реестра документов. Документы
    остаются в общей базе — удаляется только принадлежность к категории (ТЗ §3)."""
    offset = None
    while True:
        batch, offset = client.scroll(
            collection_name=COLLECTION_NAME,
            scroll_filter=Filter(must=[FieldCondition(key="folders", match=MatchValue(value=slug))]),
            limit=256, with_payload=True, offset=offset,
        )
        for p in batch:
            payload = p.payload or {}
            new_folders = [s for s in (payload.get("folders") or []) if s != slug]
            client.set_payload(collection_name=COLLECTION_NAME, payload={"folders": new_folders},
                               points=[p.id])
        if offset is None:
            break
    docregistry.strip_folder(slug)


# ---------- Приём загруженного файла (используется веб-ручкой upload) ----------
def owner_dirs(uploader: Optional[dict] = None) -> tuple:
    """
    Пара папок хранилища для загрузки: (папка суперадмина, папка загрузившего).
    Структура в S3 — <суперадмин>/<администратор>/<файл>: всё, что грузят
    администраторы, лежит внутри папки суперадмина. Если загрузивший неизвестен
    (CLI-индексация), кладём в папку суперадмина как в общую.
    """
    import users
    top = users.dir_slug(users.get_owner())
    return top, (users.dir_slug(uploader) if uploader else top)


def save_uploaded_file(filename: str, content: bytes, uploader: Optional[dict] = None) -> Path:
    filename = safe_filename(filename)
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXT:
        raise ValueError(f"Неподдерживаемый формат файла: {ext or '(нет расширения)'}")
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError(f"Файл превышает лимит {MAX_UPLOAD_BYTES // (1024*1024)} МБ")

    # Локально файл лежит плоско в data/documents/ — это КЭШ для конвейера docling
    # (папки — логические метки, физических копий не создают, ТЗ §2). Структура
    # «суперадмин/администратор» живёт в durable-хранилище S3: см. storage.doc_key.
    filepath = DOCS_DIR / filename
    with open(filepath, "wb") as f:
        f.write(content)
    try:
        top, own = owner_dirs(uploader)
    except Exception as e:            # БД недоступна — не срываем загрузку
        _log("STORAGE", f"не удалось определить папку владельца: {e}")
        top = own = ""
    s3_key = storage.doc_key(filename, top, own)
    storage.put(filename, content, s3_key)   # дублируем оригинал в S3 (no-op, если S3 выключен)

    _update_registry(
        filename,
        size_bytes=len(content),
        uploaded_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
        status="uploaded",
        chunks=0,
        folders=[],
        stage_ids=[],
        summary=None,
        error=None,
        # Владелец документа: по нему работает разграничение видимости (админ видит
        # только свои загрузки, суперадмин — все) и строится путь в хранилище.
        uploaded_by=(uploader or {}).get("id"),
        uploaded_by_name=(uploader or {}).get("full_name") or (uploader or {}).get("username") or "",
        uploaded_by_role=(uploader or {}).get("role"),
        department=(uploader or {}).get("department") or "",
        storage_path=f"{top}/{own}/{filename}" if top and own else filename,
        s3_key=s3_key,
    )
    return filepath


# ---------- Фоновая очередь индексации (используется веб-ручкой upload) ----------
# docling-разбор тяжёлый (layout PDF — секунды-минуты), поэтому загрузка через сайт
# не ждёт обработку синхронно, а ставит файл в очередь. Один воркер обрабатывает файлы
# по очереди (FIFO): параллельный docling на нескольких файлах съел бы всю память.
# ponytail: один глобальный воркер; если понадобится пропускная способность —
# несколько воркеров + семафор под память.
# Состояние задач индексации — в общем jobstore (Redis при мультипроцессе, иначе
# in-memory), чтобы прогресс был виден и web-воркеру, и worker-процессу.
import jobstore

_JOB_NS = "index"


def _set_index_job(job_id: str, **fields):
    return jobstore.set_job(_JOB_NS, job_id, **fields)


def get_index_job(job_id: str) -> Optional[dict]:
    return jobstore.get_job(_JOB_NS, job_id)


def process_index_job(job_id: str):
    """Обрабатывает одну задачу индексации. Выполняется в worker-процессе (RQ) или
    в daemon-потоке-фолбэке. Тяжёлый docling+LLM не держит web-воркер."""
    try:
        job = get_index_job(job_id)
        if not job:
            return
        filepath = Path(job["filepath"])
        _set_index_job(job_id, status="processing", started_at=time.strftime("%Y-%m-%dT%H:%M:%S"))
        _update_registry(filepath.name, status="processing", error=None)
        result = index_document(filepath)
        _set_index_job(job_id, status=result["status"], result=result,
                       finished_at=time.strftime("%Y-%m-%dT%H:%M:%S"))
    except Exception as e:
        _set_index_job(job_id, status="error", result={"status": "error", "error": str(e)})


def enqueue_document(filepath: Path) -> dict:
    """Ставит уже сохранённый файл в очередь на индексацию. Возвращает запись задачи."""
    import jobs
    job_id = str(uuid.uuid4())
    filename = Path(filepath).name
    _set_index_job(job_id, filename=filename, filepath=str(filepath),
                   status="queued", queued_at=time.strftime("%Y-%m-%dT%H:%M:%S"))
    jobs.enqueue_index(job_id)
    return get_index_job(job_id)


def requeue_stranded() -> int:
    """Возвращает в очередь документы, зависшие в 'uploaded'/'processing'. Очередь — в
    памяти процесса, поэтому рестарт приложения (или потерянная задача) оставлял бы такие
    файлы навсегда «Загружен», не индексируя. Зовётся при старте. Возвращает число."""
    n = 0
    for entry in _load_registry().values():
        if entry.get("status") in ("uploaded", "processing"):
            enqueue_document(DOCS_DIR / entry["filename"])
            n += 1
    if n:
        print(f"[index] возвращено в очередь зависших документов: {n}")
    return n


# ---------- Массовая индексация папки (используется CLI-скриптом) ----------
def index_all_documents(docs_dir: Optional[Path] = None, recreate: bool = False):
    docs_dir = Path(docs_dir) if docs_dir else DOCS_DIR
    create_collection(recreate=recreate)

    # Рекурсивно: файлы и в корне (ещё не отсортированы), и уже разложенные по
    # подпапкам тем (вручную или из прошлого запуска) — index_document() сам
    # разбирается, что с чем делать.
    files = sorted(
        p for p in docs_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXT and CACHE_DIR not in p.parents
    )
    if not files:
        print(f"В папке {docs_dir} не найдено поддерживаемых файлов ({', '.join(sorted(SUPPORTED_EXT))}).")
        return

    # Векторы папок должны существовать до классификации чанков.
    try:
        classify.sync_folder_vectors()
    except Exception as e:
        print(f"Предупреждение: не удалось построить векторы папок: {e}")

    for filepath in files:
        if filepath.name not in _load_registry():
            _update_registry(
                filepath.name,
                size_bytes=filepath.stat().st_size,
                uploaded_at=time.strftime("%Y-%m-%dT%H:%M:%S"),
                status="uploaded",
                chunks=0,
                folders=[],
                stage_ids=[],
                error=None,
            )
        print(f"\n=== Обработка файла: {filepath.name} ===")
        result = index_document(filepath)
        if result["status"] == "indexed":
            print(f"  Загружено {result['chunks']} чанков за {result['elapsed']:.2f} сек -> папки: {result['folders'] or '(общая база)'}")
        else:
            print(f"  ОШИБКА: {result.get('error')}")

    print("\nИндексация завершена.")


# ---------- Повторный анализ (ТЗ §8, §26) ----------
def reanalyze_document(filename: str) -> dict:
    """Переклассифицировать документ заново через docpipe (docling + LLM-разметка
    этапов/подэтапов, метки в Postgres). Векторов больше нет. Статус ведём по ходу
    (reanalyzing -> indexed/error), чтобы был виден в списке документов."""
    _update_registry(filename, status="reanalyzing", error=None,
                     phase="Переклассификация (docpipe)", progress=10)
    try:
        import docpipe
        fp = DOCS_DIR / filename
        if not fp.exists():
            raise FileNotFoundError(f"нет оригинала {filename} в data/documents")
        res = docpipe.ingest(str(fp), filename=filename, force=True,
                             progress_cb=_docpipe_progress_cb(filename))
        sections = res.get("sections") or 0
        _update_registry(filename, status="indexed", chunks=sections, error=None,
                         phase=None, progress=100)
        return {"filename": filename, "sections": sections}
    except Exception as e:
        _log("REANALYZE", f"{filename}: ошибка переклассификации ({e})")
        _update_registry(filename, status="error", error=str(e))
        return {"filename": filename, "error": str(e)}


def reanalyze_all(job_id: str = None) -> dict:
    """Полный повторный анализ всей базы (ТЗ §8 — «запустить повторный анализ всей базы»).

    job_id — если задан, прогресс ПАКЕТА (документ i из N + имя текущего) пишется в стор
    задач, фронт тянет его через GET /documents/jobs/{job_id} и рисует общий прогресс.
    Прогресс ВНУТРИ документа пишет reanalyze_document в реестр (бар на карточке).
    Векторов/папок больше нет — переклассификация идёт через docpipe (LLM)."""
    todo = [d["filename"] for d in list_documents() if d.get("status") == "indexed"]
    total = len(todo)
    if job_id:
        _set_index_job(job_id, status="processing", done=0, total=total, current="",
                       started_at=time.strftime("%Y-%m-%dT%H:%M:%S"))
    results = []
    try:
        for i, filename in enumerate(todo):
            if job_id:
                _set_index_job(job_id, done=i, total=total, current=filename)
            results.append(reanalyze_document(filename))
        if job_id:
            _set_index_job(job_id, status="done", done=total, total=total, current="")
        return {"reanalyzed": len(results), "documents": results}
    except Exception as e:
        if job_id:
            _set_index_job(job_id, status="error", error=str(e))
        raise


def reanalyze_for_folder(slug: str) -> dict:
    """Точечный реанализ под изменившуюся/новую папку (ТЗ §8): по вектору папки
    находим потенциально релевантные документы и переанализируем только их, а не всю базу."""
    classify.sync_folder_vectors()
    folder = folders.get_by_slug(slug)
    if not folder:
        return {"reanalyzed": 0, "documents": []}
    # Кандидаты — документы, чьи чанки близки к вектору папки (+ уже помеченные ею).
    candidates = set()
    try:
        vec = get_embedding(classify.folder_tag_text(folder))
        hits = client.query_points(collection_name=COLLECTION_NAME, query=vec,
                                   limit=200, with_payload=True).points
        for h in hits:
            src = (h.payload or {}).get("source")
            if src:
                candidates.add(src)
    except Exception as e:
        _log("REANALYZE", f"векторный отбор кандидатов не удался ({e}) — беру все документы")
        candidates = {d["filename"] for d in list_documents() if d.get("status") == "indexed"}
    for doc in list_documents():
        if slug in (doc.get("folders") or []):
            candidates.add(doc["filename"])
    results = [reanalyze_document(name) for name in sorted(candidates)]
    return {"reanalyzed": len(results), "documents": results}

"""
pii.py — обезличивание персональных данных перед отправкой текста в DeepSeek.

Всё, что уходит в модель, проходит через deepseek.chat — там текст пользователя
маскируется (Masker.mask), а ответ модели восстанавливается (Masker.unmask). Модель видит
только метки вида [ФИО_1], [ТЕЛ_2], реальные данные не покидают сервер.

Что маскируем (regex + словарь ФИО из data/name_dict, без ML):
  ФИО          «Иванов Иван Иванович», «Иванов И.И.», «И.И. Иванов» (слово из словаря имён);
  телефоны     +7/8 (XXX) XXX-XX-XX в любых разделителях;
  email;
  ИНН/КПП/ОГРН/БИК/ОКПО — число после ключевого слова;
  СНИЛС        XXX-XXX-XXX XX;
  счета        20 цифр (р/с, к/с);
  паспорт      «паспорт 45 12 123456»;
  организации  ООО/АО/ПАО/ЗАО/ОАО/ИП/ФГУП/МУП «Название».

ponytail: regex + словарь ловят типовые форматы документов; ФИО без словарного слова и
названия без кавычек пройдут. Нужна полнота выше — подключить NER (Natasha/Slovnet) в
_find_spans, остальной код не меняется. Выключить: NEIROMASTER_PII_MASK=0.
"""
import os
import re
from pathlib import Path

_NAME_DIR = Path(__file__).resolve().parent / "data" / "name_dict"
_NAME_SET = None


def name_set() -> set:
    """Имена/отчества/фамилии в нижнем регистре (общий словарь со штаткой)."""
    global _NAME_SET
    if _NAME_SET is None:
        s = set()
        for fn in ("first_names.txt", "middle_names.txt", "last_names.txt"):
            try:
                with open(_NAME_DIR / fn, encoding="utf-8") as f:
                    s.update(ln.strip().lower() for ln in f if ln.strip())
            except OSError:
                pass
        _NAME_SET = s
    return _NAME_SET


def enabled() -> bool:
    return os.environ.get("NEIROMASTER_PII_MASK", "1") != "0"


_W = r"[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?"
_I = r"[А-ЯЁ]\.\s?"
# (метка, regex, номер группы с данными). Порядок важен: длинные/специфичные — раньше.
_PATTERNS = [
    ("EMAIL", re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"), 0),
    ("ОРГ", re.compile(r"\b(?:ООО|АО|ПАО|ЗАО|ОАО|ИП|НКО|ФГУП|МУП|ГУП)\s*[«\"“][^»\"”\n]{1,80}[»\"”]"), 0),
    ("РЕКВ", re.compile(r"(?i)\b(?:ИНН|КПП|ОГРНИП|ОГРН|БИК|ОКПО)\s*[:№]?\s*(\d{8,15})\b"), 1),
    ("СЧЁТ", re.compile(r"(?<!\d)\d{20}(?!\d)"), 0),
    ("СНИЛС", re.compile(r"(?<!\d)\d{3}-\d{3}-\d{3}[ -]\d{2}(?!\d)"), 0),
    ("ПАСПОРТ", re.compile(r"(?i)паспорт\w*[^\d\n]{0,20}(\d{2}\s?\d{2}\s?№?\s?\d{6})"), 1),
    ("ТЕЛ", re.compile(r"(?<![\d\w])(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)"), 0),
    # «Иванов И.И.» / «И.И. Иванов» — два инициала, иначе «Приложение А.» сошло бы за ФИО
    ("ФИО", re.compile(rf"\b{_W}\s{_I}{_I}(?!\w)|(?<!\w){_I}{_I}{_W}\b"), 0),
]
_FIO_RUN = re.compile(rf"\b{_W}(?:\s{_W}){{1,3}}\b")
_SURNAME_END = re.compile(r"(?:ов|ев|ёв|ин|ын|ский|цкий|ская|цкая|ова|ева|ина|ына|ко|ук|юк|ян|дзе|швили|ых|их)$")
_TOKEN = re.compile(r"\[(EMAIL|ОРГ|РЕКВ|СЧЁТ|СНИЛС|ПАСПОРТ|ТЕЛ|ФИО)_(\d+)\]")


def _find_spans(text: str) -> list:
    """[(start, end, метка)] без пересечений: сначала форматы, потом ФИО по словарю."""
    spans = []

    def free(a, b):
        return all(b <= s or a >= e for s, e, _ in spans)

    for label, rx, grp in _PATTERNS:
        for m in rx.finditer(text):
            a, b = m.span(grp)
            if free(a, b):
                spans.append((a, b, label))
    names = name_set()
    for m in _FIO_RUN.finditer(text):
        words, a = m.group(0).split(), m.start()
        # «Звонить Сидоров Пётр Петрович»: слово начала фразы не имя — отрезаем его,
        # если оно не в словаре и не похоже на фамилию по окончанию.
        while len(words) > 2 and words[0].lower() not in names and not _SURNAME_END.search(words[0]):
            a += len(words[0]) + 1
            words = words[1:]
        if any(w.lower() in names for w in words) and free(a, m.end()):
            spans.append((a, m.end(), "ФИО"))
    return sorted(spans)


class Masker:
    """Одна замена на один вызов модели: одинаковое значение -> одна и та же метка."""

    def __init__(self):
        self.by_token: dict = {}
        self._by_value: dict = {}
        self._n: dict = {}

    def mask(self, text: str) -> str:
        if not text or not enabled():
            return text
        out, pos = [], 0
        for a, b, label in _find_spans(text):
            value = text[a:b]
            token = self._by_value.get((label, value))
            if token is None:
                self._n[label] = self._n.get(label, 0) + 1
                token = f"[{label}_{self._n[label]}]"
                self._by_value[(label, value)] = token
                self.by_token[token] = value
            out.append(text[pos:a])
            out.append(token)
            pos = b
        out.append(text[pos:])
        return "".join(out)

    def unmask(self, text: str) -> str:
        if not text or not self.by_token:
            return text
        return _TOKEN.sub(lambda m: self.by_token.get(m.group(0), m.group(0)), text)


def mask(text: str) -> str:
    """Разовое маскирование без обратной подстановки (для логов/хранения)."""
    return Masker().mask(text)

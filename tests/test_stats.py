"""Статистика сотрудника (backend/stats.py): чтение, тесты, балл вовлечённости — без БД."""
import sys
from pathlib import Path

from test_stubs import install

install()
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import stats  # noqa: E402


def test_reading_classes():
    assert stats.reading(0, 10_000) is None
    assert stats.reading(5_000, 10_000) == "read"
    assert stats.reading(2_000, 10_000) == "skim"
    assert stats.reading(1_999, 10_000) == "scroll"


def test_expected_time_grows_with_text():
    assert stats.expected_ms("") == stats.MIN_EXPECTED_MS
    assert stats.expected_ms("x" * 2340) == 120_000          # ~360 слов — 2 минуты


def test_quiz_score_counts_only_answered():
    quiz = {"questions": [{"id": "a", "options": [{"id": "1", "correct": True}, {"id": "2"}]},
                          {"id": "b", "options": [{"id": "1"}, {"id": "2", "correct": True}]}]}
    assert stats.quiz_score(quiz, {"a": "1"}) == (1, 1, 2)
    assert stats.quiz_score(quiz, {"a": "2", "b": "2"}) == (1, 2, 2)


def test_engagement_score():
    assert stats.engagement(0, 0, 0, 0, 0, None) is None
    fast_reader = stats.engagement(20, 20, 20, 20, 0, 300)
    slow_scroller = stats.engagement(20, 8, 8, 0, 0, 40 * 3600)
    assert fast_reader == 100 and slow_scroller < 30
    assert stats.engagement(10, 10, 10, 10, 0, 24 * 3600) < fast_reader    # медленнее — ниже

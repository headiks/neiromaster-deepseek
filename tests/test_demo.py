"""Демо: после назначения плана первые 5 сообщений приходят каждые 30 с, остальные — по плану."""
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from test_stubs import install  # noqa: E402

install()
import demo  # noqa: E402


def _rows(n):
    start = datetime(2030, 1, 1, 9, tzinfo=timezone.utc)
    return [{"id": f"m{i}", "send_at": start + timedelta(days=i)} for i in range(n)]


def test_compress_only_in_demo():
    os.environ.pop("NEIROMASTER_DEMO", None)
    rows = _rows(7)
    assert demo.compress([dict(r) for r in rows]) == rows
    assert demo.accounts() == []


def test_first_messages_every_interval():
    os.environ.update({"NEIROMASTER_DEMO": "1", "NEIROMASTER_DEMO_INTERVAL": "30", "NEIROMASTER_DEMO_MESSAGES": "5"})
    try:
        before = datetime.now(timezone.utc)
        out = demo.compress(list(reversed(_rows(7))))          # порядок — по send_at, не по входу
        gaps = [(r["send_at"] - before).total_seconds() for r in out[:5]]
        assert [r["id"] for r in out[:5]] == ["m0", "m1", "m2", "m3", "m4"]
        assert all(abs(g - 30 * (i + 1)) < 5 for i, g in enumerate(gaps)), gaps
        assert out[5]["send_at"].year == 2030 and out[6]["send_at"].year == 2030   # остальные — по плану
        assert {a["username"] for a in demo.accounts()} == {"demo", "demo-curator", "demo-employee"}
    finally:
        os.environ.pop("NEIROMASTER_DEMO", None)


def test_overdue_rest_follows_without_burst():
    """Дата выхода сегодня, этапы «до выхода» уже в прошлом: остальные не приходят пачкой,
    а идут после пятого с промежутками плана."""
    os.environ.update({"NEIROMASTER_DEMO": "1", "NEIROMASTER_DEMO_INTERVAL": "30", "NEIROMASTER_DEMO_MESSAGES": "5"})
    try:
        start = datetime.now(timezone.utc) - timedelta(days=10)
        rows = [{"id": f"m{i}", "send_at": start + timedelta(hours=i)} for i in range(8)]
        out = demo.compress(rows)
        fifth = out[4]["send_at"]
        assert out[5]["send_at"] - fifth == timedelta(hours=1)                 # промежуток плана
        assert out[7]["send_at"] - out[5]["send_at"] == timedelta(hours=2)
    finally:
        os.environ.pop("NEIROMASTER_DEMO", None)


def test_shared_accounts_protected_only_in_demo():
    assert not demo.protected({"username": "demo"})                        # не демо — обычный логин
    os.environ["NEIROMASTER_DEMO"] = "1"
    try:
        assert demo.protected({"username": "demo-employee"})
        assert not demo.protected({"username": "ivanov_i_i"}) and not demo.protected(None)
    finally:
        os.environ.pop("NEIROMASTER_DEMO", None)

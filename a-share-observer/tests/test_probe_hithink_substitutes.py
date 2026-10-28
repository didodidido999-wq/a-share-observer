import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import probe_hithink_substitutes as p


def test_checked_quote_summary_skips_null_rows():
    rows = {"item": [
        {"date_ms": 1780108800000, "close_price": None},
        {"date_ms": 1780195200000, "close_price": 1.25},
    ]}
    x = p.history_data(rows, "date_ms")
    assert x["bars"] == 1
    assert x["first"] == x["last"]
    assert x["first"]


def test_not_found_is_not_a_verified_daily_quote():
    assert p.history_data({"item": []}, "timestamp")["bars"] == 0
    assert p.history_data(None, "timestamp")["bars"] == 0
    assert "513310.SH" == p.ETF["korea_chip_mixed"][0]
    assert "SC" in p.FUTURES

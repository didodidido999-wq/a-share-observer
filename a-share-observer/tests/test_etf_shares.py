import sys
from pathlib import Path
import pandas as pd
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import etf_shares as f


def test_sse_requires_real_dated_rows_and_normalizes_10000_shares():
    data = {"result": [
        {"SEC_CODE": "510300", "TOT_VOL": "3,272,988.77", "STAT_DATE": "2026-10-22"},
        {"SEC_CODE": "510050", "TOT_VOL": "1,298,316.68", "STAT_DATE": "2026-10-21"},
        {"SEC_CODE": "588000", "TOT_VOL": None, "STAT_DATE": "2026-10-22"},
        {"SEC_CODE": "000001", "TOT_VOL": 300, "STAT_DATE": "2026-10-22"},
    ]}
    out = f.parse_sse(data, "2026-10-22")
    assert set(out) == {"510300.SH"}
    assert out["510300.SH"]["shares"] == 32729887700
    assert out["510300.SH"]["stat_date"] == "2026-10-22"
    assert out["510300.SH"]["exchange"] == "SSE"
    try:
        f.parse_sse({}, "2026-10-22")
        assert False, "Incorrect API response should raise"
    except ValueError:
        pass


def test_szse_requires_dated_workbook_and_retains_actual_share_units():
    table = pd.DataFrame({
        "日期": ["2026-10-22", "2026-10-23", "2026-10-23", "2026-10-24"],
        "基金代码": [159919, 159919, 159915, 159919],
        "基金规模(份)": ["9,768,000,000", 10100000000, -1, 10200000000],
    })
    result = f.parse_szse(table, {"2026-10-22", "2026-10-23"})
    assert result["2026-10-22"]["159919.SZ"]["shares"] == 9768000000
    assert result["2026-10-23"]["159919.SZ"]["shares"] == 10100000000
    assert "159915.SZ" not in result["2026-10-23"]
    assert "2026-10-24" not in result
    try:
        f.parse_szse(table.drop(columns=["基金规模(份)"]), {"2026-10-22"})
        assert False
    except ValueError:
        pass


def test_merge_no_fake_zero_or_inferred_state_team_flow():
    prev = {"rows": [{"date": "2026-10-21", "funds": {
        "510300.SH": {"shares": 300, "stat_date": "2026-10-21", "exchange": "SSE"}
    }}]}
    rows = {"2026-10-22": {"510300.SH": {
        "shares": 320, "stat_date": "2026-10-22", "exchange": "SSE"
    }}}
    obj = f.merge(prev, ["2026-10-21", "2026-10-22", "2026-10-23"], rows, {})
    assert [r["date"] for r in obj["rows"]] == ["2026-10-21", "2026-10-22"]
    assert obj["rows"][0]["funds"]["510300.SH"]["shares"] == 300
    assert "national_team" not in obj
    assert "net_buy" not in str(obj)


def test_missing_or_bad_shares_are_not_zero():
    for val in (None, "", "abc", 0, -1, float("inf"), True):
        assert f.safe_shares(val) is None

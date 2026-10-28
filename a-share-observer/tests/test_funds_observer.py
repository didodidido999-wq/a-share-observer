import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import funds_observer as f


def epoch_ms(day):
    return int(datetime.fromisoformat(day).replace(tzinfo=ZoneInfo("Asia/Shanghai")).timestamp() * 1000)


def test_margin_requires_true_evidence_and_keeps_missing_values_null():
    response = {"success": True, "result": {"data": [
        {"DIM_DATE": "2026-10-26 00:00:00", "RZYE": 2500000000000,
         "RQYE": 25000000000, "RZRQYE": 2525000000000},
        {"DIM_DATE": "2026-10-27 00:00:00", "RZYE": 2510000000000,
         "RQYE": 25000000000, "RZRQYE": 2535000000000},
        {"DIM_DATE": "2026-10-28", "RZYE": "no quote"},
    ]}}
    rows = f.parse_margin_rows(response)
    assert [x["date"] for x in rows] == ["2026-10-26", "2026-10-27"]
    assert rows[-1]["financing_balance_100m"] == 25100
    assert rows[-1]["financing_buy_100m"] is None
    assert rows[-1]["short_balance_100m"] == 250


def test_margin_rejects_wrong_table():
    for payload in ({}, {"success": True, "result": {}},
                    {"success": False, "result": {"data": []}}):
        try:
            f.parse_margin_rows(payload)
            assert False, "Invalid response was accepted"
        except ValueError:
            pass


def test_public_holder_disclosure_keeps_report_date_and_explicit_holder_name():
    top = {"item": [{"holder_name": "中央汇金投资有限责任公司",
                    "rank": 1, "hold_rate_pct": 28.5,
                    "report_date_ms": epoch_ms("2026-06-30"),
                    "publish_date_ms": epoch_ms("2026-08-28")},
                   {"holder_name": "某其他机构", "rank": 2, "hold_rate_pct": 5}]}
    holder = {"item": [{"merge_scope": "merged",
                        "report_date_ms": epoch_ms("2026-06-30"),
                        "ins_position": 70.2,
                        "psnl_rate": 29.8}]}
    d = f.parse_disclosures("510300.SH", "沪深300ETF", top, holder, "2026-10-28")
    assert d["holders_top"][0]["explicit_public_institution_name"] is True
    assert d["holders_top"][1]["explicit_public_institution_name"] is False
    assert d["holders_top"][0]["publish_date"] == "2026-08-28"
    assert d["holder_structure"][0]["report_date"] == "2026-06-30"
    assert d["is_daily_flow"] is False
    assert d["identity_is_inferred"] is False


def test_missing_disclosures_are_not_current_national_buying():
    assert f.parse_disclosures("510300.SH", "test", {"item": []},
                                {"item": []}, "2026-10-28") is None


def test_merge_preserves_old_data_and_does_not_zero_fill():
    p = {"financing": {"rows": [{"date": "2026-10-27",
                                "financing_balance_100m": 24999,
                                "short_balance_100m": 200}]},
         "disclosures": [{"code": "510050.SH", "name": "上证50ETF",
                           "holders_top": [{"holder": "old"}],
                           "holder_structure": []}]}
    m = [{"date": "2026-10-27", "financing_balance_100m": 25020,
          "short_balance_100m": None}]
    res = f.build(p, m, [], "2026-10-28")
    assert res["financing"]["rows"] == [{"date": "2026-10-27",
             "financing_balance_100m": 25020, "short_balance_100m": 200}]
    assert len(res["disclosures"]) == 1
    assert res["financing"]["is_retail_only"] is False
    assert res["disclosure_is_daily_capital_flow"] is False


def test_margin_history_within_reasonable_balance_units():
    assert f.numeric(None) is None
    assert f.numeric("not-data") is None
    assert f.numeric(-10) is None

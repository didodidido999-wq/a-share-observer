"""Archive observed ETF shares from SSE/SZSE dated official public tables.

Daily issuer-neutral shares indicate total net creations/redemptions, not state
institution trades. The collection day is BEFORE today's SSE/SZSE trading day:
never backdate a future session or fill a missing official observation with zero.
All numeric source shares are normalized to *individual fund units (份)*.
"""
from __future__ import annotations
import argparse
import io
import json
import math
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs/data"
OUTPUT = DATA / "etf-shares.json"
DATE_INDEX = DATA / "dates.json"
ASIA = ZoneInfo("Asia/Shanghai")
SSE = "https://query.sse.com.cn/commonQuery.do"
SZSE = "https://www.szse.cn/api/report/ShowReport"
WATCH = {
    "510300.SH": "沪深300ETF华泰柏瑞",
    "510310.SH": "沪深300ETF易方达",
    "510330.SH": "沪深300ETF华夏",
    "159919.SZ": "沪深300ETF嘉实",
    "510050.SH": "上证50ETF华夏",
    "510500.SH": "中证500ETF南方",
    "588000.SH": "科创50ETF华夏",
    "159915.SZ": "创业板ETF易方达",
}


def safe_shares(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        n = float(str(value).replace(",", "").strip())
        return n if math.isfinite(n) and 0 < n < 1e15 else None
    except (ValueError, TypeError):
        return None


def day_string(value):
    try:
        d = pd.to_datetime(value, errors="coerce")
        if pd.isna(d):
            return None
        return d.strftime("%Y-%m-%d")
    except (ValueError, TypeError, OverflowError):
        return None


def parse_sse(payload, expected_date):
    if not isinstance(payload, dict) or not isinstance(payload.get("result"), list):
        raise ValueError("Unrecognized SSE table")
    out = {}
    for r in payload["result"]:
        if not isinstance(r, dict):
            continue
        code = str(r.get("SEC_CODE") or "").strip()
        key = code + ".SH"
        observed = day_string(r.get("STAT_DATE"))
        shares_10000 = safe_shares(r.get("TOT_VOL"))
        if key in WATCH and observed == expected_date and shares_10000 is not None:
            out[key] = {"shares": round(shares_10000 * 10000, 2),
                        "stat_date": observed, "exchange": "SSE"}
    return out


def parse_szse(table, expected_dates):
    cols = {"日期", "基金代码", "基金规模(份)"}
    if not isinstance(table, pd.DataFrame) or not cols.issubset(table.columns):
        raise ValueError("Unrecognized SZSE historical fund scale workbook")
    result = {d: {} for d in expected_dates}
    for _, item in table.iterrows():
        code = str(item["基金代码"]).strip().split(".")[0].zfill(6)
        key = code + ".SZ"
        day = day_string(item["日期"])
        quantity = safe_shares(item["基金规模(份)"])
        if day in result and key in WATCH and quantity is not None:
            result[day][key] = {"shares": round(quantity, 2), "stat_date": day, "exchange": "SZSE"}
    return result


def fetch_sse(day, get=requests.get):
    resp = get(SSE, params={
        "isPagination": "true", "pageHelp.pageSize": "10000",
        "pageHelp.pageNo": "1", "pageHelp.beginPage": "1",
        "pageHelp.cacheSize": "1", "pageHelp.endPage": "1",
        "sqlId": "COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L", "STAT_DATE": day
    }, headers={"Referer": "https://www.sse.com.cn/",
                "User-Agent": "Mozilla/5.0"}, timeout=(8, 25))
    resp.raise_for_status()
    return parse_sse(resp.json(), day)


def fetch_szse(start, end, get=requests.get):
    resp = get(SZSE, params={
        "SHOWTYPE": "xlsx", "CATALOGID": "scsj_fund_jjgm", "TABKEY": "tab1",
        "txtStart": start, "txtEnd": end, "jjlb": "ETF",
    }, headers={"Referer": "https://www.szse.cn/market/fund/volume/etf/index.html",
                "User-Agent": "Mozilla/5.0"}, timeout=(8, 35))
    resp.raise_for_status()
    if not resp.content.startswith(b"PK"):
        raise ValueError("SZSE did not return an xlsx file")
    return pd.read_excel(io.BytesIO(resp.content), engine="openpyxl")


def merge(previous, days, sse_records, szse_records):
    original = {r["date"]: dict(r["funds"]) for r in previous.get("rows", [])
                if isinstance(r, dict) and isinstance(r.get("funds"), dict)
                and isinstance(r.get("date"), str)}
    for d in days:
        updates = {**sse_records.get(d, {}), **szse_records.get(d, {})}
        if updates:
            original.setdefault(d, {}).update(updates)
    return {"schema_version": 1, "share_unit": "shares",
            "sources": {"SSE": "https://www.sse.com.cn/market/funddata/volumn/etfvolumn/",
                        "SZSE": "https://www.szse.cn/market/fund/volume/etf/index.html"},
            "note": "These are dated total ETF shares, not national-team buys or investor identities.",
            "watch": WATCH, "rows": [{"date": d, "funds": original[d]}
                                    for d in sorted(original) if original[d]]}


def target_days(today=None, lookback=12):
    today = today or datetime.now(ASIA).date()
    records = json.loads(DATE_INDEX.read_text(encoding="utf-8"))
    dates = records.get("dates", [])
    # Only sessions strictly older than today's trading day; safely T+1.
    return [d for d in dates if isinstance(d, str) and d < today.isoformat()][-lookback:]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lookback", type=int, default=12)
    args = parser.parse_args()
    days = target_days(lookback=max(2, min(args.lookback, 95)))
    if not days:
        print("No historical sessions to collect")
        return
    prior = json.loads(OUTPUT.read_text("utf-8")) if OUTPUT.exists() else {}
    existing = {r["date"]: r["funds"] for r in prior.get("rows", [])}
    sse, szse, issues = {}, {}, []
    for day in days:
        if all(code in existing.get(day, {}) for code in WATCH if code.endswith(".SH")):
            continue
        try:
            rows = fetch_sse(day)
            if rows:
                sse[day] = rows
        except (requests.RequestException, ValueError) as e:
            issues.append(f"SSE:{day}:{type(e).__name__}")
    if any(not all(code in existing.get(d, {}) for code in WATCH if code.endswith(".SZ")) for d in days):
        try:
            table = fetch_szse(days[0], days[-1])
            szse = parse_szse(table, set(days))
        except (requests.RequestException, ValueError, ImportError) as e:
            issues.append(f"SZSE:{type(e).__name__}")
    result = merge(prior, days, sse, szse)
    if result["rows"] and result != prior:
        OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
                          encoding="utf-8")
    print(json.dumps({"observations": len(result["rows"]), "latest": result["rows"][-1]["date"]
                      if result["rows"] else None, "issues": issues}, ensure_ascii=False))


if __name__ == "__main__":
    main()

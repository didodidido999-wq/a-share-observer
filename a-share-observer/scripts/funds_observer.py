"""Daily financing-balance observations + point-in-time institutional ETF disclosures.

Source boundaries:
* Eastmoney web public market-margin historical table: a secondary republication
  of exchange disclosures. Unavailable or stale upstream -> no fabricated values.
* hithink-finance fund holders are periodic reports, NOT daily flow or national
  team buy/sell records. Public site never receives the HITHINK API key.
"""
from __future__ import annotations

import json
import os
import argparse
import sys
from datetime import datetime, timedelta, date
from pathlib import Path
from zoneinfo import ZoneInfo
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import update as api

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs/data"
OUTPUT = DATA / "funds-observer.json"
SOURCE = "https://datacenter-web.eastmoney.com/api/data/v1/get"
ASIA = ZoneInfo("Asia/Shanghai")
START = "2026-06-10"
# Small, stable set of widely-followed index ETFs. Do not call them all "state team".
ETF_FOCUS = {
    "510300.SH": "沪深300ETF华泰柏瑞",
    "510050.SH": "上证50ETF华夏",
    "510500.SH": "中证500ETF南方",
    "159919.SZ": "沪深300ETF嘉实",
    "588000.SH": "科创50ETF华夏",
}
WATCHED_TEXT = ("中央汇金", "中国证券金融", "全国社会保障基金", "全国社保基金",
                "中国投资有限责任公司")


def numeric(v):
    if v is None or isinstance(v, bool):
        return None
    try:
        import math
        x = float(str(v).replace(",", ""))
        return x if math.isfinite(x) and x >= 0 else None
    except (ValueError, TypeError):
        return None


def valid_day(raw):
    try:
        s = str(raw or "")[:10]
        date.fromisoformat(s)
        return s if START <= s <= datetime.now(ASIA).date().isoformat() else None
    except ValueError:
        return None


def parse_margin_rows(obj):
    """Require known financing balance field AND a valid date for each row."""
    if not isinstance(obj, dict) or obj.get("success") is not True:
        raise ValueError("Margin response not successful")
    page = obj.get("result")
    if not isinstance(page, dict) or not isinstance(page.get("data"), list):
        raise ValueError("Margin rows absent")
    parsed = []
    for entry in page["data"]:
        if not isinstance(entry, dict):
            continue
        dt = valid_day(entry.get("DIM_DATE"))
        balance = numeric(entry.get("RZYE"))
        if dt is None or balance is None:
            continue
        # Old report only guarantees these balance fields; optional ones stay null.
        parsed.append({"date": dt, "financing_balance_100m": round(balance / 1e8, 3),
                       "short_balance_100m": round(numeric(entry["RQYE"]) / 1e8, 3)
                           if numeric(entry.get("RQYE")) is not None else None,
                       "margin_balance_100m": round(numeric(entry["RZRQYE"]) / 1e8, 3)
                           if numeric(entry.get("RZRQYE")) is not None else None,
                       "financing_buy_100m": round(numeric(entry["RZMRE"]) / 1e8, 3)
                           if numeric(entry.get("RZMRE")) is not None else None,
                       "financing_repay_100m": round(numeric(entry["RZCHE"]) / 1e8, 3)
                           if numeric(entry.get("RZCHE")) is not None else None})
    # Never mistake unrelated report fields for a financing balance.
    return sorted({x["date"]: x for x in parsed}.values(), key=lambda x: x["date"])


def get_margin(get=None):
    get = get or requests.get
    res = get(SOURCE,
              params={"reportName": "RPTA_RZRQ_LSHJ", "columns": "ALL",
                      "source": "WEB", "sortColumns": "dim_date", "sortTypes": "-1",
                      "pageNumber": "1", "pageSize": "260"},
              headers={"User-Agent": "Mozilla/5.0", "Referer": "https://data.eastmoney.com/"},
              timeout=(8, 24))
    res.raise_for_status()
    rows = parse_margin_rows(res.json())
    if not rows:
        raise ValueError("No verified financing history")
    return rows


def disclosure_day(ms):
    try:
        return datetime.fromtimestamp(int(ms)/1000, ASIA).date().isoformat() if ms is not None else None
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def parse_disclosures(code, name, tops, holder, observed_at):
    """No inferred holder identity. Explicit name only; report dates never inferred."""
    top_rows = []
    for item in (tops or {}).get("item", [])[:10]:
        raw = item.get("holder_name")
        if not isinstance(raw, str) or not raw.strip():
            continue
        top_rows.append({"holder": raw.strip(),
                         "rank": item.get("rank") if isinstance(item.get("rank"), int) else None,
                         "hold_share": numeric(item.get("hold_share")),
                         "hold_rate_pct": numeric(item.get("hold_rate_pct")),
                         "report_date": disclosure_day(item.get("report_date_ms")),
                         "publish_date": disclosure_day(item.get("publish_date_ms")),
                         "explicit_public_institution_name": any(word in raw for word in WATCHED_TEXT)})
    top_rows.sort(key=lambda x: (x["rank"] is None, x["rank"] or 999))
    holder_rows = []
    for item in (holder or {}).get("item", []):
        if item.get("merge_scope") not in ("merged", "separate"):
            continue
        holder_rows.append({"scope": item["merge_scope"],
                            "report_date": disclosure_day(item.get("report_date_ms")),
                            "institution_pct": numeric(item.get("ins_position")),
                            "individual_pct": numeric(item.get("psnl_rate"))})
    if not top_rows and not holder_rows:
        return None
    return {"code": code, "name": name, "observed_at": observed_at,
            "holders_top": top_rows, "holder_structure": holder_rows,
            "is_daily_flow": False, "identity_is_inferred": False}


def get_disclosures(client=None, today=None):
    client = client or api.client_get
    today = today or datetime.now(ASIA).date().isoformat()
    out, failed = [], []
    for code, name in ETF_FOCUS.items():
        top = structure = None
        try:
            top = client("/api/fund/holders/top", {"thscode": code, "limit": 10}, attempts=1)
        except Exception as e:
            failed.append(f"{code}:top:{type(e).__name__}")
        try:
            structure = client("/api/fund/holders/detail",
                               {"thscode": code, "merge_scope": "all"}, attempts=1)
        except Exception as e:
            failed.append(f"{code}:structure:{type(e).__name__}")
        parsed = parse_disclosures(code, name, top, structure, today)
        if parsed:
            out.append(parsed)
    return out, failed


def build(prev, margin_rows, disclosures, collected_at):
    old_margin = {x["date"]: x for x in prev.get("financing", {}).get("rows", [])
                  if isinstance(x, dict) and x.get("date")}
    for row in margin_rows:
        # On a partial update, do not overwrite known metrics with nulls.
        prior = old_margin.get(row["date"], {})
        old_margin[row["date"]] = {**prior, **{k: v for k, v in row.items()
                                                 if v is not None}}
    all_rows = [old_margin[k] for k in sorted(old_margin) if k >= START]
    prior_disclosures = {x["code"]: x for x in prev.get("disclosures", [])
                         if isinstance(x, dict) and x.get("code")}
    for row in disclosures:
        before = prior_disclosures.get(row["code"])
        # Do not delete verified older records because this fetch was partial.
        if row["holders_top"] or row["holder_structure"]:
            old_holders = before.get("holders_top", []) if before else []
            old_structure = before.get("holder_structure", []) if before else []
            if not row["holders_top"]:
                row["holders_top"] = old_holders
            if not row["holder_structure"]:
                row["holder_structure"] = old_structure
            prior_disclosures[row["code"]] = row
    return {"schema_version": 1,
            "financing": {"source": "Eastmoney republication of exchange margin summaries",
                          "source_url": "https://data.eastmoney.com/rzrq/total.html",
                          "time_basis": "trade_date; typically available next trading day",
                          "is_retail_only": False,
                          "financing_change_is_balance_difference": True,
                          "rows": all_rows},
            "disclosures": list(prior_disclosures.values()),
            "disclosure_source": "hithink-finance periodic fund holder filings",
            "disclosure_is_daily_capital_flow": False,
            "updated_at": collected_at if (margin_rows or disclosures) else prev.get("updated_at")}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("all","margin","disclosure"), default="all")
    args = parser.parse_args()
    prev = json.loads(OUTPUT.read_text("utf-8")) if OUTPUT.exists() else {}
    now = datetime.now(ASIA).isoformat()
    problems = []
    margin, disclosures = [], []
    if args.mode in ("all","margin"):
        try:
            margin = get_margin()
        except (requests.RequestException, ValueError) as e:
            problems.append("margin:" + type(e).__name__)
    if args.mode in ("all","disclosure"):
        if os.getenv("HITHINK_FINANCE_API_KEY"):
            disclosures, failed = get_disclosures()
            problems.extend(failed)
        else:
            problems.append("fund-holder:missing-existing-key")
    data = build(prev, margin, disclosures, now)
    # Do not manufacture empty "success" data or timestamp-only commits.
    if not data["financing"]["rows"] and not data["disclosures"]:
        print(json.dumps({"result": "no_verified_data", "issues": problems}, ensure_ascii=False))
        return
    comparable = lambda x: {k:v for k,v in x.items() if k != "updated_at"}
    if comparable(data) != comparable(prev):
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        temp = OUTPUT.with_suffix(".json.tmp")
        temp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"),
                                  allow_nan=False), "utf-8")
        temp.replace(OUTPUT)
    print(json.dumps({"margin_trading_days": len(data["financing"]["rows"]),
                      "funds_with_disclosures": len(data["disclosures"]),
                      "issues": problems}, ensure_ascii=False))


if __name__ == "__main__":
    main()

"""Directly readable MarketScope cross-asset data: Treasury rates and listed ETF proxies.

No foreign index data is synthesized. ETF close prices are Chinese onshore
listed fund prices, NOT underlying foreign index values. Writes only observed
rows to independent static JSON; historical publication times are unverified.
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from xml.etree import ElementTree as ET

import requests
import update as hithink

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs/data/global/series"
START = date(2026, 6, 10)
SHANGHAI = ZoneInfo("Asia/Shanghai")
TREASURY_URL = ("https://home.treasury.gov/resource-center/data-chart-center/"
                "interest-rates/pages/xml")
TREASURY_FIELDS = {
    "BC_1YEAR": ("ust_1y", "美债1年收益率"),
    "BC_2YEAR": ("ust_2y", "美债2年收益率"),
    "BC_5YEAR": ("ust_5y", "美债5年收益率"),
    "BC_10YEAR": ("ust_10y", "美债10年收益率"),
    "BC_30YEAR": ("ust_30y", "美债30年收益率"),
}
# Codes are *candidates*, not verified until meta search confirms a listed ETF.
ETF_CANDIDATES = (
    ("nasdaq100_etf", "513100.SH", "A股上市纳斯达克100 ETF代理"),
    ("sp500_etf", "513500.SH", "A股上市标普500 ETF代理"),
    ("nikkei225_etf", "513520.SH", "A股上市日经225 ETF代理"),
    ("dax_etf", "513030.SH", "A股上市德国DAX ETF代理"),
    ("hstech_etf", "513130.SH", "A股上市恒生科技 ETF代理"),
    ("gold_etf", "518880.SH", "A股上市黄金 ETF代理"),
    ("hsi_etf", "159920.SZ", "A股上市恒生指数 ETF代理"),
) 
ETF_NAME_RULES = {
    "nasdaq100_etf": ("纳斯达克", "纳指"),
    "sp500_etf": ("标普", "S&P"),
    "nikkei225_etf": ("日经",),
    "dax_etf": ("德国", "DAX"),
    "hstech_etf": ("恒生科技",),
    "gold_etf": ("黄金",),
    "hsi_etf": ("恒生",),
}


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def parse_treasury(payload):
    """Parse dated Atom/OData properties, ignoring empty/unpublished tenors."""
    root = ET.fromstring(payload)
    rows = []
    for entry in root.iter():
        if _local(entry.tag) != "entry":
            continue
        fields = {_local(el.tag): (el.text or "").strip() for el in entry.iter()}
        raw_date = fields.get("NEW_DATE", "")[:10]
        try:
            session = date.fromisoformat(raw_date)
        except ValueError:
            continue
        if session < START or session > date.today() + timedelta(days=1):
            continue
        rates = {}
        for field in TREASURY_FIELDS:
            val = fields.get(field, "")
            if not val:
                continue
            try:
                x = float(val)
                if not -5 < x < 35:
                    continue
                rates[field] = x
            except ValueError:
                continue
        if rates:
            rows.append((session.isoformat(), rates))
    return sorted(rows)


def write_series(series_id, name, kind, unit, source, rows, symbol=None, extra=None):
    """Idempotent per-asset historical merge. Null never overwrites observed data."""
    file = OUT / (series_id + ".json")
    prior = json.loads(file.read_text("utf-8")) if file.exists() else {}
    previous = {r["date"]: r for r in prior.get("rows", [])}
    for row in rows:
        if row.get("value") is not None and row.get("date"):
            previous[row["date"]] = row
    record = {
        "schema_version": 1,
        "asset_id": series_id, "name": name, "kind": kind, "unit": unit,
        "source": source, "symbol": symbol,
        "market_timezone": "America/New_York" if kind == "treasury_yield" else "Asia/Shanghai",
        "point_in_time_publication": "unverified",
        "rows": [previous[k] for k in sorted(previous)],
    }
    if extra:
        record.update(extra)
    if record == prior:
        return False
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = file.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(record, ensure_ascii=False, separators=(",", ":"), allow_nan=False), "utf-8")
    tmp.replace(file)
    return True


def treasury(client=None, today=None):
    """Fetch the official annual no-key Treasury feed (one request/year)."""
    today = today or datetime.now(SHANGHAI).date()
    client = client or requests.get
    total = 0
    for year in range(START.year, today.year + 1):
        response = client(TREASURY_URL, params={
            "data": "daily_treasury_yield_curve", "field_tdr_date_value": year
        }, timeout=(12, 40), headers={"User-Agent": "MarketScope/1.0 (daily research)"})
        response.raise_for_status()
        entries = parse_treasury(response.content)
        if not entries:
            raise ValueError(f"US Treasury {year}: empty or invalid response, refusing overwrite")
        series = {field: [] for field in TREASURY_FIELDS}
        for day, rates in entries:
            if day > today.isoformat():
                continue
            for field, value in rates.items():
                series[field].append({"date": day, "value": value})
        for field, (asset_id, name) in TREASURY_FIELDS.items():
            total += int(write_series(asset_id, name, "treasury_yield", "%", TREASURY_URL,
                                      series[field], symbol=field))
        # A spread must be computed ONLY when both tenors have the same session date.
        spread = [{"date": day, "value": round((rates["BC_10YEAR"] - rates["BC_2YEAR"]) * 100, 3)}
                  for day, rates in entries if day <= today.isoformat()
                  and "BC_10YEAR" in rates and "BC_2YEAR" in rates]
        total += int(write_series("ust_10y2y", "美债10年−2年期限利差", "treasury_spread", "bp",
                                  TREASURY_URL, spread, symbol="BC_10YEAR-BC_2YEAR"))
    return total


def _verified_etf(code, caller):
    result = caller("/api/meta/tickers/search", {
        "q": code, "asset_type": "fund-etf", "limit": 10
    })
    matches = [x for x in result.get("item", [])
               if x.get("thscode") == code and x.get("asset_type") == "fund-etf"]
    if len(matches) != 1:
        return None
    return matches[0].get("name") or code


def _date_ms(day):
    return hithink.since_ms(day)


def etfs(caller=None, today=None):
    """Use already-configured HITHINK API only. Never show proxy as native index."""
    caller = caller or hithink.client_get
    today = today or datetime.now(SHANGHAI).date()
    if today < START:
        return {"updated": 0, "verified": 0, "failed": []}
    updated, verified, failed = 0, 0, []
    for asset_id, code, label in ETF_CANDIDATES:
        existing = OUT / (asset_id + ".json")
        prior = json.loads(existing.read_text("utf-8")) if existing.exists() else {}
        # Only trust identity already verified by the exact meta endpoint.
        display = prior.get("verified_fund_name") if prior.get("symbol") == code else None
        try:
            if not display:
                display = _verified_etf(code, caller)
            if not display or not any(word.casefold() in display.casefold()
                                       for word in ETF_NAME_RULES[asset_id]):
                failed.append(f"{code}:fund_name_or_type_unverified")
                continue
            verified += 1
            last = (prior.get("rows") or [{}])[-1].get("date")
            begin = max(START, date.fromisoformat(last) - timedelta(days=2)) if last else START
            if begin > today:
                continue
            obj = caller("/api/fund/market/historical", {
                "thscode": code, "interval": "1d", "start": _date_ms(begin),
                "end": _date_ms(today + timedelta(days=1)) - 1
            })
            rows = []
            for item in obj.get("item", []):
                raw_ms = item.get("date_ms")
                value = hithink.num(item.get("close_price"))
                if raw_ms is None or value is None or value <= 0:
                    continue
                day = hithink.trading_date(raw_ms)
                if day < START.isoformat() or day > today.isoformat():
                    continue
                rows.append({"date": day, "value": value,
                             "turnover": hithink.num(item.get("turnover"))})
            if not rows and not prior.get("rows"):
                failed.append(f"{code}:no_verified_daily_bars")
                continue
            updated += int(write_series(
                asset_id, label, "listed_etf_proxy", "CNY", "hithink-finance",
                rows, symbol=code, extra={"verified_fund_name": display,
                "underlying_is_direct_quote": False,
                "price_adjustment": "forward"}))
        except (ValueError, requests.RequestException, hithink.ApiError) as exc:
            # No secrets, query strings or upstream response dumped into logs.
            failed.append(f"{code}:{type(exc).__name__}")
    return {"updated": updated, "verified": verified, "failed": failed}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["treasury", "etf", "all"], default="all")
    args = parser.parse_args()
    done = {}
    if args.mode in ("treasury", "all"):
        done["treasury_files_changed"] = treasury()
    if args.mode in ("etf", "all"):
        if not os.getenv("HITHINK_FINANCE_API_KEY"):
            done["etf"] = "skipped: missing existing HITHINK_FINANCE_API_KEY"
        else:
            done["etf"] = etfs()
    print(json.dumps(done, ensure_ascii=False))


if __name__ == "__main__":
    main()

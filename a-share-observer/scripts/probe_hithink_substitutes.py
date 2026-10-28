"""One-shot capability discovery using the EXISTING HITHINK_FINANCE_API_KEY.

Saves metadata/status only (no raw upstream payload, keys, or made-up quotes).
Do not treat an ETF/Chinese futures series as a direct foreign index.
"""
from __future__ import annotations
import json
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import update as api

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "docs/data/global/substitute-discovery.json"
TZ = ZoneInfo("Asia/Shanghai")
ETF = {
    "korea_chip_mixed": ("513310.SH", "中韩芯片/韩国半导体"),
    "us_nasdaq_tech": ("159509.SZ", "美国科技/间接半导体"),
    "us_oil_gas_equities": ("513350.SH", "美国石油天然气股票"),
    "china_oil_gas_equities": ("159148.SZ", "国内油气股票"),
    "china_oil_gas_etf": ("159588.SZ", "国内油气股票备选"),
    "china_semiconductor": ("512480.SH", "A股半导体对照"),
    "china_chip": ("159995.SZ", "A股芯片对照"),
    "us_nasdaq100_second": ("159941.SZ", "美国纳指100另一ETF"),
}
SEARCH = ("罗素2000", "韩国", "中韩", "波动率", "美元指数", "原油", "布伦特", "WTI")
FUTURES = {"SC": "国内原油期货", "CU": "国内铜期货", "AU": "国内黄金期货", "AG": "国内白银期货"}

def safe_get(path, params=None):
    try:
        return api.client_get(path, params or {}, attempts=1), "ok"
    except Exception as e:
        # Do not expose provider body, upstream URL, or security context.
        return None, type(e).__name__

def history_data(obj, timefield):
    rows = obj.get("item", []) if isinstance(obj, dict) else []
    valid = [x for x in rows if x.get(timefield) is not None and
             api.num(x.get("close_price")) is not None]
    return {"bars": len(valid),
            "first": api.trading_date(valid[0][timefield]) if valid else None,
            "last": api.trading_date(valid[-1][timefield]) if valid else None}

def main():
    now = datetime.now(TZ)
    start = api.since_ms((now - timedelta(days=28)).date())
    end = api.since_ms((now + timedelta(days=1)).date()) - 1
    report = {"asof": now.isoformat(), "source": "hithink-finance existing GitHub Actions secret",
              "mode": "one-time-discovery", "etfs": {}, "search": {}, "futures": {}}
    for asset, (symbol, use) in ETF.items():
        meta, code = safe_get("/api/meta/tickers/search", {"q": symbol, "limit": 10})
        exact = [x for x in (meta or {}).get("item", []) if x.get("thscode") == symbol
                 and x.get("asset_type") == "fund-etf"]
        item = {"code": symbol, "purpose": use, "name": exact[0].get("name") if len(exact)==1 else None,
                "type_verified": len(exact)==1}
        if len(exact)!=1:
            item["status"] = "identity_unverified" if code=="ok" else "metadata_"+code
        else:
            daily, code = safe_get("/api/fund/market/historical",
                                   {"thscode": symbol, "interval": "1d", "start": start, "end": end})
            stats = history_data(daily, "date_ms")
            item.update(stats)
            item["status"] = "verified_daily" if stats["bars"] else ("empty_daily" if code=="ok" else "daily_"+code)
        report["etfs"][asset] = item
    for term in SEARCH:
        data, code = safe_get("/api/meta/tickers/search", {"q": term, "limit": 20})
        hit = [{"code": x.get("thscode"), "name": x.get("name"), "type": x.get("asset_type")}
               for x in (data or {}).get("item", []) if x.get("thscode")]
        report["search"][term] = {"status": code, "results": hit[:20]}
    for api_name, path in (("main_continuous", "/api/futures/contracts/main-continuous-list"),
                           ("commodity_index", "/api/futures/contracts/commodity-index-list")):
        data, status = safe_get(path)
        rows = (data or {}).get("item", [])
        for kind, description in FUTURES.items():
            candidates = [x for x in rows if x.get("variety_code") == kind or (
                api_name=="commodity_index" and (
                    str(x.get("ticker") or "").upper().startswith(kind+"FI")
                    or (kind in ("SC","AU","AG","CU") and
                        (("原油" if kind=="SC" else {"AU":"黄金","AG":"白银","CU":"沪铜"}[kind])
                         in str(x.get("name") or "")))))]
            slot = report["futures"].setdefault(kind, {"purpose": description})
            slot[api_name+"_status"] = status
            slot[api_name+"_matches"] = [
                {"code": x.get("thscode"), "name": x.get("name")} for x in candidates[:3]]
            if api_name == "main_continuous" and len(candidates) == 1:
                symbol = candidates[0].get("thscode")
                if not symbol:
                    continue
                daily, daily_status = safe_get("/api/futures/prices/daily",
                                               {"thscode": symbol, "start": start, "end": end,
                                                "time_period": "day_1"})
                stats = history_data(daily, "timestamp")
                slot["sample"] = {"code": symbol, **stats,
                                  "status": "verified_daily" if stats["bars"] else (
                                      "empty_daily" if daily_status=="ok" else daily_status)}
    DEST.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False)+"\n"
    DEST.write_text(raw, "utf-8")
    print(json.dumps({"etfs_verified": sum(x.get("status")=="verified_daily" for x in report["etfs"].values()),
                      "futures_verified": sum(x.get("sample",{}).get("status")=="verified_daily" for x in report["futures"].values()),
                      "saved": str(DEST.relative_to(ROOT))}, ensure_ascii=False))

if __name__ == "__main__":
    main()

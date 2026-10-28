"""Offline contract tests: no API key and no market-data requests are used."""
import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import global_direct as g


EXAMPLE = b"""<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata"
      xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices">
 <entry><content type="application/xml"><m:properties>
  <d:NEW_DATE>2026-06-10T00:00:00</d:NEW_DATE>
  <d:BC_1YEAR>3.52</d:BC_1YEAR><d:BC_2YEAR>4.25</d:BC_2YEAR>
  <d:BC_5YEAR>4.11</d:BC_5YEAR><d:BC_10YEAR>4.60</d:BC_10YEAR>
  <d:BC_30YEAR>4.85</d:BC_30YEAR>
 </m:properties></content></entry>
 <entry><content><m:properties>
  <d:NEW_DATE>2026-06-11T00:00:00</d:NEW_DATE>
  <d:BC_2YEAR m:null="true"/><d:BC_10YEAR>4.50</d:BC_10YEAR>
 </m:properties></content></entry>
</feed>"""


class Response:
    content = EXAMPLE
    def raise_for_status(self):
        return None


def test_treasury_preserves_partial_and_no_fill():
    rows = g.parse_treasury(EXAMPLE)
    assert [r[0] for r in rows] == ["2026-06-10", "2026-06-11"]
    assert rows[0][1]["BC_2YEAR"] == 4.25
    assert "BC_2YEAR" not in rows[1][1]


def test_treasury_spread_and_no_future_data(tmp_path, monkeypatch):
    monkeypatch.setattr(g, "OUT", tmp_path)
    req = []
    def fake(url, **kwargs):
        req.append((url, kwargs))
        return Response()
    assert g.treasury(client=fake, today=date(2026, 6, 11)) == 6
    spread = json.loads((tmp_path / "ust_10y2y.json").read_text("utf-8"))
    assert spread["rows"] == [{"date": "2026-06-10", "value": 35.0}]
    assert spread["unit"] == "bp"
    assert spread["point_in_time_publication"] == "unverified"
    assert len(req) == 1
    assert g.treasury(client=fake, today=date(2026, 6, 11)) == 0


def test_etf_meta_must_match_exact_full_code_and_type():
    def bad(_path, _params):
        return {"item": [{"thscode": "513101.SH", "asset_type": "fund-etf", "name": "wrong"},
                         {"thscode": "513100.SH", "asset_type": "fund-lof", "name": "wrong"}]}
    assert g._verified_etf("513100.SH", bad) is None
    assert g._verified_etf("513100.SH", lambda *_:{
        "item": [{"thscode": "513100.SH", "asset_type": "fund-etf",
                  "name": "国泰纳斯达克100ETF"}]}) == "国泰纳斯达克100ETF"


def test_etf_proxy_keeps_own_session_date_and_identity(tmp_path, monkeypatch):
    monkeypatch.setattr(g, "OUT", tmp_path)
    monkeypatch.setattr(g, "ETF_CANDIDATES", (
        ("nasdaq100_etf", "513100.SH", "纳指 ETF代理"),))
    calls = []
    def caller(path, params):
        calls.append((path, params))
        if path.endswith("tickers/search"):
            return {"item": [{"thscode": "513100.SH", "asset_type": "fund-etf",
                              "name": "国泰纳斯达克100ETF"}]}
        assert path == "/api/fund/market/historical"
        assert params["thscode"] == "513100.SH"
        assert "adjust" not in params
        return {"item": [{
            "date_ms": g._date_ms(date(2026, 6, 10)),
            "close_price": 1.255, "turnover": 500_000_000,
        }]}
    result = g.etfs(caller=caller, today=date(2026, 6, 11))
    assert result["verified"] == 1
    assert result["updated"] == 1
    obj = json.loads((tmp_path / "nasdaq100_etf.json").read_text("utf-8"))
    assert obj["kind"] == "listed_etf_proxy"
    assert obj["underlying_is_direct_quote"] is False
    assert obj["price_adjustment"] == "forward"
    assert obj["rows"][0]["value"] == 1.255
    assert obj["rows"][0]["turnover"] == 500_000_000
    second = g.etfs(caller=caller, today=date(2026, 6, 11))
    assert second["updated"] == 0
    assert len([k for k, _ in calls if k == "/api/meta/tickers/search"]) == 1


def test_identity_mismatch_must_not_publish_fake_data(tmp_path, monkeypatch):
    monkeypatch.setattr(g, "OUT", tmp_path)
    monkeypatch.setattr(g, "ETF_CANDIDATES", (("bad", "513100.SH", "wrong"),))
    outcome = g.etfs(caller=lambda *_: {"item":[{"thscode":"159941.SZ",
                           "asset_type":"fund-etf","name":"other"}]}, today=date(2026, 6, 11))
    assert outcome["verified"] == 0
    assert not list(tmp_path.glob("*.json"))


def test_treasury_invalid_xml_does_not_destroy_existing(tmp_path, monkeypatch):
    monkeypatch.setattr(g, "OUT", tmp_path)
    g.write_series("ust_2y", "美债2年收益率", "treasury_yield", "%",
                   "treasury", [{"date": "2026-06-10", "value": 4.25}])
    before = (tmp_path / "ust_2y.json").read_bytes()
    class Invalid:
        content = b"<feed />"
        def raise_for_status(self):
            pass
    try:
        g.treasury(client=lambda *_args, **_kwargs: Invalid(), today=date(2026, 6, 11))
        assert False, "Invalid XML response should reject update"
    except ValueError:
        pass
    assert (tmp_path / "ust_2y.json").read_bytes() == before

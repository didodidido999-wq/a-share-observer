import gzip
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import v5_sector as sector


def test_members_reject_unproven_empty_or_truncated_records():
    def bad(_path,_params):return {"item":[]}
    try:sector.current_members(bad,'886042.TI');assert False
    except ValueError as e:assert 'empty' in str(e)
    result=sector.current_members(lambda _p,_a:{"item":[
       {"thscode":"600519.SH","name":"贵州茅台"},
       {"thscode":"000858.SZ","name":"五粮液"}],"total":2},'886042.TI')
    assert result["600519.SH"]=="贵州茅台"
    try:
        sector.current_members(lambda _p,_a:{"item":[{"thscode":"600519.SH"}],"total":2},"886042.TI")
        assert False
    except ValueError as e:assert 'incomplete' in str(e)


def test_sector_metrics_require_verified_down_pool():
    members={"000001.SZ":"平安银行","000002.SZ":"万科A"}
    stocks={"000001.SZ":{"price_change_ratio_pct":4.0},"000002.SZ":{"price_change_ratio_pct":-2.0}}
    a=sector.compute_sector(members,stocks,{"000001.SZ"},{"000002.SZ"},None,False)
    assert a["member_count"]==2
    assert a["member_up_ratio"]==50.0
    assert a["member_median"]==1.0
    assert a["limit_up_count"]==1
    assert a["limit_down_count"] is None
    assert a["limit_down_ratio"] is None
    assert a["hot_count"] is None
    b=sector.compute_sector(members,stocks,set(),{"000002.SZ"},set(),True)
    assert b["limit_up_count"]==0
    assert b["limit_down_count"]==1
    assert b["limit_down_ratio"]==50.0
    assert b["hot_count"]==0


def test_focus_has_factual_reasons_not_hallucinated_roles():
    members={"000001.SZ":"平安银行","000002.SZ":"万科A"}
    prices={"000001.SZ":{"price_change_ratio_pct":6.1,"turnover":200000},
            "000002.SZ":{"price_change_ratio_pct":-9.9,"turnover":150000}}
    focus=sector.pick_focus("886042.TI",members,prices,{"000001.SZ"},
                            {"000002.SZ"},set(),set(),{"000001.SZ"},"2026-10-27")
    assert len(focus)==2
    assert all(r["membership_observed_date"]=="2026-10-27" for r in focus)
    assert "当日跌停" in next(r for r in focus if r["stock_code"]=="000002.SZ")["factual_tags"]
    assert all("龙头" not in ",".join(r["factual_tags"]) for r in focus)


def test_gz_membership_history_is_dated_and_readable(monkeypatch,tmp_path):
    monkeypatch.setattr(sector,"MEMBER_DIR",tmp_path)
    path=sector.archive_gzip("2026-10-27",{"881101.TI":{"000001.SZ":"A"}})
    assert path.name=="2026-10-27.json.gz"
    with gzip.open(path,'rt',encoding='utf-8') as stream:
        obj=json.load(stream)
    assert obj["date"]=="2026-10-27"
    assert obj["members"]["881101.TI"]["000001.SZ"]=="A"


def test_current_day_complete_sector_data_is_idempotent(monkeypatch):
    from datetime import datetime as RealDatetime
    class Clock(RealDatetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026,10,28,17,0,tzinfo=tz)
    monkeypatch.setattr(sector, 'datetime', Clock)
    snapshot={'date':'2026-10-28','market':{'samples':5600},
              'sectors':[{'code':'886042.TI','name':'白酒'}],
              'quality_manifest':{
                'sector_members':{'status':'complete'},
                'sector_internal_metrics':{'status':'complete'},
                'sector_focus_stocks':{'status':'complete'}}}
    monkeypatch.setattr(sector.history,'read_json',lambda *_args:snapshot)
    monkeypatch.setattr(sector.history,'get_stock_snapshot',lambda: (_ for _ in ()).throw(
        AssertionError('Current-day complete sector snapshot must not be queried')))
    result=sector.run('2026-10-28',client_get=lambda *_: (_ for _ in ()).throw(
        AssertionError('No member calls once fully archived')))
    assert result['status']=='complete'
    assert result['skipped'] is True

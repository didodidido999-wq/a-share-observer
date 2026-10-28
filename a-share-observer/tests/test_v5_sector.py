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
    assert next(r for r in focus if r["stock_code"]=="000001.SZ")["turnover_100m"] == 0.002
    assert all("龙头" not in ",".join(r["factual_tags"]) for r in focus)



def test_focus_stock_prices_and_turnover_follow_each_symbol_after_sorting():
    members = {"600001.SH": "甲", "600002.SH": "乙", "600003.SH": "丙"}
    prices = {
        "600001.SH": {"price_change_ratio_pct": 7.0, "turnover": 260_000_000, "last_price": 13.28},
        "600002.SH": {"price_change_ratio_pct": -9.0, "turnover": 530_000_000, "last_price": 42.16},
        # This unselected last member must never leak values into selected rows.
        "600003.SH": {"price_change_ratio_pct": 0.1, "turnover": 990_000_000, "last_price": 99.99},
    }
    focus = sector.pick_focus("881101.TI", members, prices,
                              {"600001.SH"}, {"600002.SH"}, set(), set(),
                              set(), "2026-10-28")
    by_code = {row["stock_code"]: row for row in focus}
    assert set(by_code) == {"600001.SH", "600002.SH"}
    assert by_code["600001.SH"]["turnover_100m"] == 2.6
    assert by_code["600001.SH"]["price"] == 13.28
    assert by_code["600002.SH"]["turnover_100m"] == 5.3
    assert by_code["600002.SH"]["price"] == 42.16
    assert [row["stock_code"] for row in focus] == ["600002.SH", "600001.SH"]


def test_focus_missing_quote_stays_missing_and_not_previous_symbol_value():
    members = {"600001.SH": "甲", "600002.SH": "乙"}
    prices = {"600001.SH": {"price_change_ratio_pct": 8.0,
                            "turnover": 123_000_000, "last_price": 10.15}}
    rows = sector.pick_focus("881101.TI", members, prices,
                             {"600001.SH", "600002.SH"}, set(), set(), set(),
                             set(), "2026-10-28")
    by_code = {row["stock_code"]: row for row in rows}
    assert by_code["600001.SH"]["turnover_100m"] == 1.23
    assert by_code["600001.SH"]["price"] == 10.15
    assert by_code["600002.SH"]["turnover_100m"] is None
    assert by_code["600002.SH"]["price"] is None


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


def test_weekly_roster_reuses_fetched_members_and_daily_metrics_use_cached_asof(monkeypatch,tmp_path):
    from datetime import datetime
    monkeypatch.setattr(sector,'MEMBER_DIR',tmp_path)
    monkeypatch.setattr(sector,'DATA',tmp_path)
    roster={'code':'881101.TI','name':'农业'}
    prices=[
      {'thscode':'000001.SZ','price_change_ratio_pct':10,'turnover':2_000_000},
      {'thscode':'000002.SZ','price_change_ratio_pct':-10,'turnover':1_000_000}
    ]
    member_calls=[]
    def source(path, params):
        member_calls.append((path,params))
        assert path==sector.ENDPOINT
        return {'item':[{'thscode':'000001.SZ','name':'甲'},
                        {'thscode':'000002.SZ','name':'乙'}], 'total':2}
    fake_day=datetime.now(sector.base.TZ).strftime('%Y-%m-%d')
    observed='2026-10-25'
    def read(path, default=None):
        if str(path).endswith('dashboard.json'):
            return {'sectors':[roster]}
        if str(path).endswith('representatives.json'):
            return {'universe':[{'code':'000001.SZ'}]}
        return {'date':fake_day,'market':{'samples':2},
                'sectors':[{'code':'881101.TI','name':'农业','pct':1.0,'turnover':12345}],
                'stock_list':[{'thscode':'000001.SZ'}],
                'limit_down_events':[{'thscode':'000002.SZ'}],
                'limit_break_events':[], 'hot_rank_daily':[],
                'limits':{'non_st':1},
                'quality_manifest':{'limit_down_events':{'status':'complete'}}}
    monkeypatch.setattr(sector.history,'read_json',read)
    first=sector.weekly(client_get=source,observed_date=observed)
    assert first['observed']==1
    assert len(member_calls)==1
    second=sector.weekly(client_get=source,observed_date=observed)
    assert second['observed']==1
    assert len(member_calls)==1, 'rerun must reuse weekly cached members'
    import json
    web_index=json.loads((tmp_path/'sector-member-index'/(observed+'.json')).read_text(encoding='utf-8'))
    assert web_index['observed_date']==observed
    assert web_index['members']['881101.TI']['000001.SZ']=='甲'
    writes=[]
    monkeypatch.setattr(sector.history,'merge_day',lambda date,patch:writes.append((date,patch)))
    monkeypatch.setattr(sector.history,'create_dashboard',lambda:None)
    monkeypatch.setenv('SECTOR_ALLOW_EARLY','1')
    result=sector.run(day=fake_day,stock_snapshot=prices,
      client_get=lambda *_: (_ for _ in ()).throw(AssertionError('weekday must not call membership API')))
    assert result['status']=='complete'
    assert result['membership_observed_date']==observed
    row=writes[0][1]['sectors'][0]
    assert row['limit_up_count']==1
    assert row['limit_down_count']==1
    assert row['member_up_ratio']==50.0
    assert row['membership_observed_date']==observed
    assert writes[0][1]['quality_manifest']['sector_members']['source']=='weekly-member-snapshot:'+observed


def test_current_day_cannot_use_future_weekly_roster(monkeypatch,tmp_path):
    from datetime import datetime,timedelta
    monkeypatch.setattr(sector,'MEMBER_DIR',tmp_path)
    monkeypatch.setenv('SECTOR_ALLOW_EARLY','1')
    today=datetime.now(sector.base.TZ).strftime('%Y-%m-%d')
    future=(datetime.now(sector.base.TZ)+timedelta(days=5)).strftime('%Y-%m-%d')
    sector._write_weekly({'881101.TI':{'000001.SZ':'甲'}},future,1,[])
    monkeypatch.setattr(sector.history,'read_json',lambda *_:{
      'market':{'up':1},'sectors':[{'code':'881101.TI'}]})
    result=sector.run(day=today,stock_snapshot=[{'thscode':'000001.SZ'}])
    assert result['status']=='not_ready'

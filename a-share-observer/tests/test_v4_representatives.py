import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))

import update as api
import v4_representatives as rep


def test_universe_has_unique_codes_and_fixed_valid_economic_styles():
    items=rep.universe()
    assert len(items) == 300
    assert len({row['code'] for row in items}) == len(items)
    assert len({row['industry'] for row in items}) >= 18
    assert len({row['name'] for row in items}) == len(items)
    assert all(row['tags'] for row in items)
    assert set(rep.ECONOMIC_STYLES)=={'弹性成长','景气成长','稳定红利','价格周期','政策复苏'}
    assert all(row['economic_style'] in rep.ECONOMIC_STYLES for row in items)
    assert next(row for row in items if row['name']=='比亚迪')['industry']=='汽车整车'
    assert all(row['editorial'] is True for row in items)


def test_captured_prices_are_raw_api_observations_not_imputed(monkeypatch):
    from datetime import date
    seen=[]
    def source(path, params):
        seen.append((path,params))
        return {'item':[
          {'date_ms':api.since_ms(date(2026,10,26)),
           'open_price':100,'high_price':105,'low_price':98,'close_price':104,
           'turnover':200000000},
          {'date_ms':api.since_ms(date(2026,10,27)),
           'open_price':None,'high_price':None,'low_price':None,'close_price':None,
           'turnover':None}
        ]}
    monkeypatch.setattr(api,'client_get',source)
    rows=rep._bars('002594.SZ',0,10)
    assert seen[0][0]=='/api/a-share/prices/historical'
    assert seen[0][1]['adjust']=='forward'
    assert len(rows)==1
    assert rows[0]['date']=='2026-10-26'
    assert rows[0]['close']==104
    assert rows[0]['turnover_100m']==2


def test_missing_api_item_list_raises_instead_of_claiming_no_stock_bars(monkeypatch):
    monkeypatch.setattr(api,'client_get',lambda *args:{'total':100})
    try:
        rep._bars('002594.SZ',0,10)
        assert False
    except ValueError as exc:
        assert 'missing item' in str(exc)


def test_curated_stock_selection_balances_multiple_industries():
    original = len(rep.BASE_RAW)
    roster = rep.build_roster()
    assert original == 48
    assert len(roster) == 300
    from collections import Counter
    families = Counter(r[2] for r in roster[original:])
    assert len(families) >= 17
    assert min(families.values()) >= 10
    assert max(families.values()) <= 18


def test_existing_universe_core_entries_retained():
    rows = rep.universe()
    by_code = {row["code"]: row for row in rows}
    for code in ("002594.SZ", "300750.SZ", "600519.SH", "000333.SZ",
                 "600036.SH", "601899.SH", "688981.SH"):
        assert code in by_code


def test_daily_completed_universe_does_not_call_prices_api(monkeypatch, tmp_path):
    import json
    from datetime import datetime as RealDatetime
    class Clock(RealDatetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 28, 16, 10, tzinfo=tz)
    monkeypatch.setattr(rep, 'datetime', Clock)
    monkeypatch.setattr(rep, 'DEST', tmp_path/'representatives.json')
    monkeypatch.setattr(rep, 'DATA', tmp_path)
    complete={r['code']:[{'date':'2026-10-28','close':100}] for r in rep.universe()}
    rep.DEST.write_text(json.dumps({'prices':complete}), encoding='utf-8')
    monkeypatch.setattr(api, 'client_get', lambda *_args, **_kwargs: (_ for _ in ()).throw(
        AssertionError('No provider requests allowed for completed daily data')))
    rep.main()
    assert json.loads(rep.DEST.read_text())['prices'] == complete


def test_daily_incremental_stock_query_begins_after_last_saved_bar(monkeypatch, tmp_path):
    import json
    from datetime import datetime as RealDatetime, date
    class Clock(RealDatetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 28, 16, 10, tzinfo=tz)
    monkeypatch.setattr(rep, 'datetime', Clock)
    monkeypatch.setattr(rep, 'DEST', tmp_path/'representatives.json')
    monkeypatch.setattr(rep, 'DATA', tmp_path)
    monkeypatch.setenv('V4_REP_LIMIT', '1')
    monkeypatch.setattr(rep, 'universe', lambda: [{
        'code':'002594.SZ','name':'比亚迪','industry':'汽车整车',
        'economic_style':'景气成长','tags':['新能源汽车'], 'editorial':True}])
    rep.DEST.write_text(json.dumps({'prices':{
        '002594.SZ':[{'date':'2026-10-27','close':99}]}}), encoding='utf-8')
    calls=[]
    def source(path, params):
        calls.append(params)
        return {'item':[{'date_ms':api.since_ms(date(2026,10,28)),
                         'close_price':100,'turnover':50000000}]}
    monkeypatch.setattr(api, 'client_get', source)
    rep.main()
    assert len(calls)==1
    assert calls[0]['start']==api.since_ms(date(2026,10,28))
    assert json.loads(rep.DEST.read_text())['prices']['002594.SZ'][-1]['date']=='2026-10-28'

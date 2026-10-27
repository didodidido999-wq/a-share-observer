import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))

import update as api
import v4_representatives as rep


def test_universe_has_unique_codes_and_fixed_valid_economic_styles():
    items=rep.universe()
    assert 30 <= len(items) <= 120
    assert len({row['code'] for row in items}) == len(items)
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

import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import history
import pandas as pd


def test_start_date_is_june_10_2026():
    assert history.START_DATE.isoformat() == '2026-06-10'
    assert history.DEFAULT_WINDOW == 10


def test_limit_summary_counts_non_st_correctly():
    pool=[{'date':'2026-06-10','is_st':False,'boards':1},
          {'date':'2026-06-10','is_st':False,'boards':3},
          {'date':'2026-06-10','is_st':True,'boards':5}]
    x=history.limit_summary('2026-06-10',pool)
    assert x['total']==3 and x['non_st']==2 and x['first']==1
    assert x['continued']==1 and x['highest']==3


def test_missing_limit_pool_does_not_create_false_zero():
    frame=pd.DataFrame([{'date':'2026-06-10','thscode':'600519.SH',
      'close_price':100.,'return_pct':1.5,'turnover':1000000}])
    market,styles=history.convert_market(frame,'2026-06-10',None)
    assert market['up']==1
    assert styles and all(x['limit_up'] is None for x in styles)


def test_historical_day_merge_preserves_original_non_null(tmp_path,monkeypatch):
    monkeypatch.setattr(history,'HISTORY',tmp_path)
    history.write_json(tmp_path/'2026-06-10.json',{'date':'2026-06-10',
      'market':{'date':'2026-06-10','up':2400,'down':2000},
      'sectors':[{'code':'AAA.TI','name':'行业A','date':'2026-06-10','pct':1.2}]})
    record=history.merge_day('2026-06-10',{'market':{'up':None,'flat':100},
      'sectors':[{'code':'AAA.TI','name':'行业A','date':'2026-06-10','pct':None,'close':101}]})
    assert record['market']['up']==2400 and record['market']['flat']==100
    assert len(record['sectors'])==1 and record['sectors'][0]['pct']==1.2
    assert record['sectors'][0]['close']==101


def test_range_manifest_and_latest10_only(tmp_path,monkeypatch):
    monkeypatch.setattr(history,'DATA',tmp_path)
    monkeypatch.setattr(history,'HISTORY',tmp_path/'history')
    for i in range(1,16):
        d=f'2026-06-{i:02d}'
        history.write_json(history.archive_path(d),{
         'date':d,'market':{'date':d,'up':i},
         'limits':{'date':d,'total':i},
         'indices':[{'date':d,'code':'000001.SH','name':'上证指数','close':i}],
         'sectors':[], 'styles':[], 'stock_list':[]})
    j=history.create_dashboard()
    assert len(j['dates'])==6
    assert j['dates'][0]=='2026-06-10' and j['dates'][-1]=='2026-06-15'
    assert len(history.read_json(tmp_path/'dates.json')['dates'])==6


def test_snapshot_pagination_when_provider_caps_page_size(monkeypatch):
    # Even if the API silently caps requested 500 records at 100, next offset
    # must advance by received count, not requested count.
    codes=[f'{i:06d}.SZ' for i in range(4300)]
    stamp=history.base.since_ms(history.START_DATE)
    observed=[]
    def fake_get(path, params=None):
        assert path=='/api/a-share/prices/snapshot'
        offset=params['offset']
        observed.append(offset)
        return {'total':len(codes),'timestamp':stamp,
                'item':[{'thscode':code,'last_price':10,'turnover':100}
                        for code in codes[offset:offset+100]]}
    monkeypatch.setattr(history.base,'client_get',fake_get)
    result,day=history.get_stock_snapshot()
    assert day=='2026-06-10'
    assert len(result)==4300
    assert observed[0:3]==[0,100,200]


def test_no_dangerous_force_push_in_provided_workflow():
    root=Path(__file__).resolve().parents[2]
    flow=(root/'.github/workflows/update.yml').read_text()
    assert "cron: '7 8 * * 1-5'" in flow
    assert 'git push --force' not in flow
    assert 'git rebase origin/main' in flow


def test_index_snapshot_isolates_invalid_code_1002_and_keeps_real_quotes(monkeypatch):
    records=[{'code':'000300.SH','name':'沪深300'},
             {'code':'000510.CSI','name':'中证A500'},
             {'code':'399006.SZ','name':'创业板指'},
             {'code':'000688.SH','name':'科创50'}]
    calls=[]
    def fake_client(endpoint, params=None):
        assert endpoint=='/api/a-share-index/prices/snapshot'
        codes=params['thscodes'].split(',')
        calls.append(codes)
        if '000510.CSI' in codes:
            raise history.base.ApiError('API业务代码 1002 (/api/a-share-index/prices/snapshot)')
        return {'item':[{'thscode':code,'last_price':100.0,
                         'price_change_ratio_pct':1.2,'turnover':2000000}
                        for code in codes]}
    monkeypatch.setattr(history.base,'client_get',fake_client)
    result=history.snapshot_index_rows(records,'2026-10-28')
    by={x['code']:x for x in result}
    assert len(result)==len(records)
    assert [x['code'] for x in result]==[x['code'] for x in records]
    assert by['000510.CSI']['close'] is None
    assert by['000510.CSI']['pct'] is None
    for code in ('000300.SH','399006.SZ','000688.SH'):
        assert by[code]['close']==100
        assert by[code]['turnover']==2000000
    assert any(len(call)>1 for call in calls)
    assert ['000510.CSI'] in calls


def test_index_snapshot_must_not_swallow_auth_or_quota_errors(monkeypatch):
    def broken(endpoint, params=None):
        raise history.base.ApiError('API业务代码 2003 ('+endpoint+')')
    monkeypatch.setattr(history.base,'client_get',broken)
    try:
        history.snapshot_index_rows([{'code':'000300.SH','name':'沪深300'}],
                                    '2026-10-28')
        assert False,'Provider credentials failure cannot be converted into missing quotes'
    except history.base.ApiError as error:
        assert '2003' in str(error)

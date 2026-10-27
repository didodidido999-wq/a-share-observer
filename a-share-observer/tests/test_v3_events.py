import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import v3_events as v3
import pytest


def test_old_proxy_never_counts_as_complete_membership():
    snap={'date':'2026-10-27','market':{'up':1}, 'limits':{'non_st':1},'stock_list':[],
          'indices':[{'close':10}], 'sectors':[{'close':100,'limit_up_proxy':0}]}
    quality=v3.status_for_snapshot(snap)
    assert quality['sector_members']['status']=='not_collected'
    assert quality['limit_down_events']['status']=='not_collected'
    assert quality['limits']['status']=='complete'
    assert v3.dashboard_quality([snap])['status']=='partial'


def test_empty_missing_pagination_is_not_a_verified_zero():
    def client(_path, _params): return {'item': []}
    with pytest.raises(ValueError,match='ambiguous empty'):
        v3.fetch_paged(client,'/pool',{},'2026-10-27')


def test_verified_empty_list_is_complete_zero():
    def client(_path, _params): return {'item':[],'total':0}
    assert v3.fetch_paged(client,'/pool',{},'2026-10-27') == []


def test_pagination_when_page_size_is_silently_capped():
    calls=[]
    def client(_path,params):
        calls.append(params['page'])
        all_items=[{'thscode':f'{x:06}.SZ','name':'test'} for x in range(150)]
        start=(params['page']-1)*100
        return {'item':all_items[start:start+100],'pagination':{'total':150,'pages':2}}
    rows=v3.fetch_paged(client,'/pool',{},'2026-10-27')
    assert calls==[1,2] and len(rows)==150


def test_failed_collection_does_not_replace_existing_data():
    snap={'date':'2026-10-27','market':{'up':100}}
    write=[]
    class Base:
        @staticmethod
        def client_get(*_args): raise RuntimeError('not authorized')
        @staticmethod
        def since_ms(d): return 0
        class TZ:
            def utcoffset(self, *args): return None
    from zoneinfo import ZoneInfo
    Base.TZ=ZoneInfo('Asia/Shanghai')
    v3.enrich_today('2026-10-27',Base,lambda path,default:snap,
                    lambda d:'file.json',lambda d,data:write.append(data))
    assert write and 'limit_down_events' not in write[0]
    assert write[0]['quality_manifest']['limit_down_events']['status']=='missing'

def test_pagination_handles_silent_per_page_cap_without_false_incomplete_error():
    observed=[]
    def client(_path, params):
        observed.append(params['page'])
        records=[{'thscode':f'{i:06d}.SZ'} for i in range(120)]
        start=(params['page']-1)*50
        return {'item':records[start:start+50],
                'pagination':{'total':120,'pages':3,'page':params['page'],'size':50}}
    rows=v3.fetch_paged(client,'/pool',{},'2026-10-27')
    assert len(rows)==120
    assert observed==[1,2,3]


def test_pagination_duplicate_source_rows_does_not_mislabel_coverage():
    def client(_path, params):
        if params['page']==1:
            return {'item':[{'thscode':'000001.SZ'},{'thscode':'000001.SZ'}],
                    'pagination':{'total':3,'pages':2}}
        return {'item':[{'thscode':'000002.SZ'}],
                'pagination':{'total':3,'pages':2}}
    rows=v3.fetch_paged(client,'/pool',{},'2026-10-27')
    assert {r['thscode'] for r in rows}=={'000001.SZ','000002.SZ'}

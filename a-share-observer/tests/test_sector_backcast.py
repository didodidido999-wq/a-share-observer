import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import backcast_sector_events as backcast


def test_backcast_historical_up_down_complete_as_known_but_not_asof_members():
    s={'date':'2026-10-10','limits':{'non_st':1},
       'stock_list':[{'thscode':'002594.SZ'}],
       'limit_down_events':[{'thscode':'000002.SZ'}],
       'hot_rank_daily':[{'thscode':'002594.SZ'}],
       'sectors':[{'code':'881001.TI','name':'汽车'},
                  {'code':'881002.TI','name':'医药'}],
       'quality_manifest':{
           'limit_down_events':{'status':'complete'},
           'hot_rank_daily':{'status':'complete'}}}
    membership={'881001.TI':{'002594.SZ':'比亚迪','000002.SZ':'万科A'},
                '881002.TI':{'600276.SH':'恒瑞医药'}}
    result,reverse,flags=backcast.match_day(s,membership,membership_date='2026-10-28')
    a,b=result
    assert len(result)==2
    assert a['limit_up_count']==1
    assert a['limit_down_count']==1
    assert a['limit_diff']==0
    assert a['membership_observed_date']=='2026-10-28'
    assert a['membership_mode']=='backcast_current'
    assert b['limit_down_count']==0
    assert reverse['000002.SZ']==['汽车']
    assert flags=={'up':True,'down':True,'hot':True}


def test_backcast_partial_down_lists_give_explicit_lower_bounds_not_zero():
    s={'date':'2026-10-27','limits':{'non_st':2},
       'stock_list':[{'thscode':'002594.SZ'}],
       'limit_down_events':[{'thscode':'000002.SZ'}],
       'hot_rank_daily':[],
       'sectors':[{'code':'881001.TI','name':'汽车'}],
       'quality_manifest':{
           'limit_down_events':{'status':'partial'},
           'hot_rank_daily':{'status':'complete'}}}
    m={'881001.TI':{'002594.SZ':'比亚迪','000002.SZ':'万科A'}}
    rows,_,state=backcast.match_day(s,m,membership_date='2026-10-28')
    assert rows[0]['limit_down_count'] is None
    assert rows[0]['limit_down_known_count']==1
    assert rows[0]['limit_down_known_ratio']==50.0
    assert rows[0]['limit_down_completeness']=='partial'
    assert rows[0]['limit_diff'] is None
    assert not state['down']


def test_backcast_ignores_future_dates_and_completed_same_membership(monkeypatch):
    saved=['2026-10-26','2026-10-27','2026-10-28','2026-10-29']
    monkeypatch.setattr(backcast.history,'saved_dates',lambda:saved)
    source={'date':'2026-10-26','limits':{'non_st':1},
            'stock_list':[{'thscode':'002594.SZ'}],
            'limit_down_events':[],'hot_rank_daily':[],
            'sectors':[{'code':'881001.TI','name':'汽车'}],
            'quality_manifest':{'limit_down_events':{'status':'complete'},
                                'hot_rank_daily':{'status':'complete'}}}
    completed=dict(source,date='2026-10-27',quality_manifest={
        'sector_backcast':{'status':'complete','membership_observed_date':'2026-10-28'}})
    def read(path,default=None):
        return source if '2026-10-26' in str(path) else completed
    monkeypatch.setattr(backcast.history,'read_json',read)
    captured=[]
    monkeypatch.setattr(backcast.history,'merge_day',lambda day,patch:captured.append((day,patch)))
    monkeypatch.setattr(backcast.history,'create_dashboard',lambda:None)
    roster={'observed_date':'2026-10-28','members':{'881001.TI':{'002594.SZ':'比亚迪'}}}
    result=backcast.backcast(membership=roster)
    assert result['written_days']==1
    assert result['skipped_days']==1
    assert len(captured)==1
    assert captured[0][0]=='2026-10-26'

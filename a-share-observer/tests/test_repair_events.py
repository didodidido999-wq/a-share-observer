import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import repair_events as repair

def test_repair_only_incomplete_historic_event_domains():
    snap={'date':'2026-10-26','market':{'up':5},
          'limit_down_events':[{'thscode':'000001.SZ'}],
          'limit_break_events':[],
          'hot_rank_daily':[{'thscode':'000002.SZ'}],
          'quality_manifest':{
             'limit_down_events':{'status':'partial'},
             'limit_break_events':{'status':'complete'},
             'hot_rank_daily':{'status':'complete'}
          }}
    assert repair.needs_repair(snap)==['limit_down_events']

def test_repair_skips_complete_modules_even_in_old_archive():
    snap={'date':'2026-10-15','market':{'up':3},
          'limit_down_events':[],'limit_break_events':[],
          'hot_rank_daily':[],
          'quality_manifest':{
            'limit_down_events':{'status':'complete'},
            'limit_break_events':{'status':'complete'},
            'hot_rank_daily':{'status':'complete'}}}
    assert repair.needs_repair(snap)==[]

def test_uncollected_historic_modules_remain_recoverable():
    snap={'date':'2026-06-10','market':{'up':3},'sectors':[]}
    assert repair.needs_repair(snap)==list(repair.DOMAINS)
    assert 'anomaly_daily' not in repair.DOMAINS
    assert 'sector_members' not in repair.DOMAINS

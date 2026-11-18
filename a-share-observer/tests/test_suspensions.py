import sys
from pathlib import Path
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import suspensions
import v5_sector as sector

DAY = '2026-11-18'
NOW = '2026-11-19T02:00:00+08:00'
def row(**changes):
    return {'SECUCODE':'600185.SH', 'SUSPEND_START_TIME':'2026-11-12 09:30:00',
            'SUSPEND_END_TIME':None, 'SUSPEND_EXPIRE':'连续停牌', **changes}
def parse(rows, day=DAY):
    return suspensions.full_session_records({'success':True,'result':{
        'pages':1,'count':len(rows),'data':rows}},day,NOW)

def test_explicit_full_day_only():
    assert '600185.SH' in parse([row()])
    for r in [row(SUSPEND_START_TIME='2026-11-19 09:30:00'),
              row(SUSPEND_START_TIME='2026-11-18 10:00:00'),
              row(SUSPEND_END_TIME='2026-11-18 13:00:00'),
              row(SUSPEND_EXPIRE='未知'), row(PREDICT_RESUME_DATE='2026-11-18'),
              row(SUSPEND_START_TIME=None)]:
        assert parse([r]) == {}
    assert parse([row(SUSPEND_END_TIME='2026-11-18 15:00:00')])

def test_unproven_or_old_payload_fails_closed():
    for p in [{'success':False}, {'success':True,'result':{'pages':2,'count':2,'data':[row()]}}]:
        with pytest.raises(ValueError): suspensions.full_session_records(p,DAY,NOW)
    with pytest.raises(ValueError): parse([row()], '2026-10-18')

def test_missing_is_not_zero_or_suspension():
    members={'600185.SH':'珠免集团','601888.SH':'中国中免','000001.SZ':'test'}
    prices={'601888.SH':{'price_change_ratio_pct':-0.946}}
    m=sector.compute_sector(members,prices,set(),set(),None,True,suspended=parse([row()]))
    assert m['member_count']==3 and m['member_expected_price_sample']==2
    assert m['member_price_sample']==1 and m['member_suspended_count']==1
    assert m['member_missing_price_count']==1 and m['member_median']==-0.946
    assert m['member_suspensions'][0]['observed_at']==NOW
    unknown=sector.compute_sector(members,prices,set(),set(),None,True)
    assert unknown['member_expected_price_sample']==3 and unknown['member_missing_price_count']==2

def test_valid_return_or_limit_event_not_excused_as_suspended():
    ev=parse([row()]); members={'600185.SH':'珠免集团'}
    for prices,up in [({'600185.SH':{'price_change_ratio_pct':0}},set()), ({},{'600185.SH'})]:
        m=sector.compute_sector(members,prices,up,set(),None,True,suspended=ev)
        assert m['member_suspended_count']==0

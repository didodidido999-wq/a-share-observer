import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from closed_market import latest_closed_day, resolve_target
import history
from recovery_status import status

TZ=ZoneInfo('Asia/Shanghai')
DAYS=['2026-11-11','2026-11-12','2026-11-13','2026-11-16']

@pytest.mark.parametrize('clock,expected',[
    ('2026-11-13T16:00:00','2026-11-13'),
    ('2026-11-14T01:08:00','2026-11-13'),
    ('2026-11-16T15:59:59','2026-11-13'),
    ('2026-11-16T16:00:00','2026-11-16'),
    ('2026-11-12T01:00:00','2026-11-11'),
])
def test_select_closed_session_after_schedule_delay(clock,expected):
    assert latest_closed_day(DAYS,datetime.fromisoformat(clock).replace(tzinfo=TZ))==expected

def test_exchange_holiday_not_weekday_guess():
    now=datetime(2026,10,8,10,tzinfo=TZ)
    assert latest_closed_day(['2026-09-30','2026-10-08'],now)=='2026-09-30'

def test_no_calendar_fails_closed():
    with pytest.raises(ValueError): latest_closed_day([],datetime.now(TZ))

def test_intraday_override_rejected(monkeypatch):
    monkeypatch.setattr(history,'all_trading_days',lambda:DAYS)
    monkeypatch.setenv('TARGET_TRADE_DATE','2026-11-16')
    with pytest.raises(ValueError): resolve_target(datetime(2026,11,16,10,tzinfo=TZ))

def test_recovery_weekend_missing_date_is_not_success(tmp_path):
    (tmp_path/'dates.json').write_text(json.dumps({'dates':['2026-11-11']}))
    result=status('2026-11-13',tmp_path)
    assert not result['main_complete']
    assert not result['representatives_complete']
    assert not result['sector_complete']

def test_recovery_does_not_count_stale_representatives(tmp_path):
    (tmp_path/'representatives.json').write_text(json.dumps({
        'universe':[{'code':str(i)} for i in range(300)],
        'prices':{str(i):[{'date':'2026-11-11'}] for i in range(300)}}))
    result=status('2026-11-13',tmp_path)
    assert result['representatives_covered']==0
    assert not result['representatives_complete']

def test_delayed_auto_uses_historical_sources_never_snapshot(monkeypatch,tmp_path):
    import targeted_backfill
    class Clock(datetime):
        @classmethod
        def now(cls,tz=None): return cls(2026,11,14,1,8,tzinfo=tz)
    monkeypatch.setattr(history,'datetime',Clock)
    monkeypatch.setattr(history,'HISTORY',tmp_path)
    monkeypatch.setattr(history,'all_trading_days',lambda:['2026-11-11','2026-11-12','2026-11-13'])
    monkeypatch.setattr(history,'create_dashboard',lambda:None)
    monkeypatch.setattr(history.v3_events,'enrich_if_enabled',lambda *args:None)
    monkeypatch.setattr(history,'get_stock_snapshot',lambda:pytest.fail('No live snapshot for past date'))
    calls=[]
    monkeypatch.setattr(targeted_backfill,'backfill_days',lambda days:calls.extend(days))
    history.today()
    assert calls==['2026-11-11','2026-11-12','2026-11-13']

def test_delayed_auto_completed_target_does_not_download_dump(monkeypatch,tmp_path):
    import targeted_backfill
    class Clock(datetime):
        @classmethod
        def now(cls,tz=None): return cls(2026,11,14,1,8,tzinfo=tz)
    monkeypatch.setattr(history,'datetime',Clock)
    monkeypatch.setattr(history,'HISTORY',tmp_path)
    monkeypatch.setattr(history,'all_trading_days',lambda:['2026-11-13'])
    monkeypatch.setattr(history,'create_dashboard',lambda:None)
    monkeypatch.setattr(history.v3_events,'enrich_if_enabled',lambda *args:None)
    (tmp_path/'2026-11-13.json').write_text(json.dumps({'market':{'samples':5000},'limits':{},'sectors':[{'close':1}]*400}))
    monkeypatch.setattr(targeted_backfill,'backfill_days',lambda days:pytest.fail('Completed archive must be reused'))
    history.today()

def test_recovery_detects_hole_before_complete_target(tmp_path):
    (tmp_path/'history').mkdir()
    (tmp_path/'dates.json').write_text(json.dumps({'dates':['2026-11-13']}))
    (tmp_path/'history'/'2026-11-13.json').write_text(json.dumps({'date':'2026-11-13','market':{'samples':5000},'limits':{},'sectors':[{'close':1}]*400}))
    result=status('2026-11-13',tmp_path,['2026-11-12','2026-11-13'])
    assert result['main_complete']
    assert result['recent_missing_dates']==['2026-11-12']

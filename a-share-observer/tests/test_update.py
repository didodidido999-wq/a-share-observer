import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import update
import pandas as pd

def test_window_unique_ten():
    a=[f'2026-10-{x:02d}' for x in range(1,21)]
    assert update.last_window(a,10)==a[-10:]

def test_series_missing_not_zero():
    got=update.series_returns([{'date':'2026-10-20','close':100,'turnover':10},{'date':'2026-10-21','close':105,'turnover':12}],['2026-10-20','2026-10-21'])
    assert got[0]['pct'] is None and got[1]['pct']==5

def test_empty_breadth_is_null():
    df=pd.DataFrame([{'date':'2026-10-21','thscode':'000001.SZ','return_pct':float('nan'),'turnover':100}])
    val=update.calculate_market(df,['2026-10-21'])[0]
    assert val['up'] is None and val['down'] is None

def test_pct_not_ratio():
    pts=update.series_returns([{'date':'2026-10-20','close':100,'turnover':0},{'date':'2026-10-21','close':101,'turnover':0}],['2026-10-21'])
    assert pts[0]['pct']==1.0

def test_no_key_not_silently_accepted(monkeypatch):
    monkeypatch.delenv('HITHINK_FINANCE_API_KEY',raising=False)
    try: update.client_get('/api/a-share/prices/snapshot',{'thscodes':'600519.SH'})
    except update.ApiError as e: assert 'HITHINK_FINANCE_API_KEY' in str(e)
    else: assert False

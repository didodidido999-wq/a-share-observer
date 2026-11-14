import sys
from pathlib import Path
from datetime import datetime
import pandas as pd
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import targeted_backfill as target


@pytest.fixture
def setup(monkeypatch, tmp_path):
    h = target.history
    monkeypatch.setattr(h.v3_events, 'enrich_if_enabled', lambda *args: None)
    monkeypatch.setattr(h.v3_feedback, 'enrich_feedback', lambda *args: None)
    dates = ['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06',
             '2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13']
    now = datetime(2026, 11, 14, 1, tzinfo=h.base.TZ)
    monkeypatch.setattr(h, 'all_trading_days', lambda: dates)
    monkeypatch.setattr(h, 'HISTORY', tmp_path / 'history')
    monkeypatch.setattr(h, 'DATA', tmp_path)
    monkeypatch.setattr(h.base, 'INDEX_CODES', {'index': 'I'})
    monkeypatch.setattr(h, 'catalog', lambda: [{'code': 'S', 'name': 'sector', 'tag': 'industry'}])
    calls = []
    def fetch(kind, start, end):
        calls.append((kind, start.isoformat(), end.isoformat()))
        return pd.DataFrame([{'date': d, 'thscode': f'{i:06}.SH', 'close_price': 10.,
                              'return_pct': 1., 'turnover': 1000.}
                             for d in dates[-3:] for i in range(3500)])
    monkeypatch.setattr(h, 'fetch_parquet', fetch)
    monkeypatch.setattr(h, 'historic_bars', lambda records, days: [
        (r, [{'date': day, 'close': 10., 'pct': 1., 'turnover': 1000.} for day in days], None)
        for r in records])
    monkeypatch.setattr(h.base, 'get_limit_pool', lambda d: [])
    # Any unintended snapshot path is prohibited.
    monkeypatch.setattr(h, 'get_stock_snapshot', lambda: pytest.fail('snapshot used'))
    monkeypatch.setattr(h, 'snapshot_index_rows', lambda *a: pytest.fail('snapshot used'))
    return h, now, calls


def test_recent_two_dates_only_and_no_false_zero(setup):
    h, now, calls = setup
    report = target.backfill_days(['2026-11-13', '2026-11-12'], now=now)
    assert calls == [('10d', '2026-11-11', '2026-11-13')]
    assert h.saved_dates() == ['2026-11-12', '2026-11-13']
    assert len(report) == 2
    assert all(r['return_samples'] == 3500 and not r['limit_pool_from_dated_endpoint'] for r in report)
    record = h.read_json(h.archive_path('2026-11-12'))
    assert record['market']['date'] == '2026-11-12'
    assert record.get('limits') is None
    assert all(s['limit_up'] is None for s in record['styles'])
    assert record['sectors'][0]['limit_up_proxy'] is None


def test_refuse_unclosed_or_too_old_without_fetch(setup):
    h, now, calls = setup
    for day in ['2026-11-02', '2026-11-14', '2026-12-01']:
        with pytest.raises(h.base.ApiError):
            target.backfill_days([day], now=now)
    with pytest.raises(h.base.ApiError):
        target.backfill_days(['2026-11-13'], now=datetime(2026,11,13,15, tzinfo=h.base.TZ))
    assert calls == []


def test_insufficient_market_prevents_all_writes(setup, monkeypatch):
    h, now, calls = setup
    original = h.fetch_parquet
    monkeypatch.setattr(h, 'fetch_parquet', lambda *a: original(*a).query("date != '2026-11-13'"))
    with pytest.raises(h.base.ApiError):
        target.backfill_days(['2026-11-12', '2026-11-13'], now=now)
    assert h.saved_dates() == []


def test_insufficient_bars_prevents_writes(setup, monkeypatch):
    h, now, calls = setup
    monkeypatch.setattr(h, 'historic_bars', lambda records, days: [])
    with pytest.raises(h.base.ApiError):
        target.backfill_days(['2026-11-12'], now=now)
    assert h.saved_dates() == []


def test_existing_values_preserved_and_new_fields_filled(setup):
    h, now, calls = setup
    h.merge_day('2026-11-12', {'market': {'date': '2026-11-12', 'up': 1234},
                             'sectors': [{'code': 'S', 'date': '2026-11-12', 'close': 42., 'pct': None}],
                             'event_summary': {'verified': 'keep'}})
    target.backfill_days(['2026-11-12'], now=now)
    record = h.read_json(h.archive_path('2026-11-12'))
    assert record['market']['up'] == 1234
    assert record['market']['samples'] == 3500
    assert record['sectors'][0]['close'] == 42.
    assert record['sectors'][0]['pct'] == 1.
    assert record['event_summary'] == {'verified': 'keep'}


def test_wrong_dated_pool_is_not_published(setup, monkeypatch):
    h, now, calls = setup
    monkeypatch.setattr(h.base, 'get_limit_pool', lambda d: [{'date':'2026-11-13'}])
    target.backfill_days(['2026-11-12'], now=now)
    assert h.read_json(h.archive_path('2026-11-12')).get('limits') is None


def test_historical_stock_rows_dated_and_complete(setup, monkeypatch):
    h, now, calls = setup
    frame = pd.DataFrame([{'date':d, 'thscode':f'{i:06}.SH', 'close_price':10.,
                           'return_pct':1., 'turnover':1000.}
                          for d in ['2026-11-11', '2026-11-12', '2026-11-13'] for i in range(4000)])
    monkeypatch.setattr(h, 'fetch_parquet', lambda *a: frame)
    rows = target.historical_stock_rows('2026-11-12', now=now)
    assert len(rows) == 4000
    assert {r['date'] for r in rows} == {'2026-11-12'}
    assert rows[0]['last_price'] == 10.
    assert rows[0]['price_change_ratio_pct'] == 1.


def test_historical_stock_rows_refuses_partial_universe(setup):
    h, now, calls = setup
    with pytest.raises(h.base.ApiError):
        target.historical_stock_rows('2026-11-12', now=now)


def test_dated_events_enriched_after_archive_exists(setup,monkeypatch):
    h,now,calls=setup
    visited=[]
    def enrich(day,*args):
        assert h.archive_path(day).exists()
        visited.append(day)
    monkeypatch.setattr(h.v3_events,'enrich_if_enabled',enrich)
    target.backfill_days(['2026-11-12','2026-11-13'],now=now)
    assert visited==['2026-11-12','2026-11-13']


def test_feedback_reuses_dated_frame_after_events(setup,monkeypatch):
    h,now,calls=setup
    visited=[]
    def feedback(day,previous,read,archive,merge,loader,tz):
        data=loader('10d',None,None)
        assert day in data.date.values and previous in data.date.values
        visited.append((previous,day))
    monkeypatch.setattr(h.v3_feedback,'enrich_feedback',feedback)
    target.backfill_days(['2026-11-12','2026-11-13'],now=now)
    assert visited==[('2026-11-11','2026-11-12'),('2026-11-12','2026-11-13')]
    assert len(calls)==1

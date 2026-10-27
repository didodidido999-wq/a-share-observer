import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))

import pandas as pd
from v3_feedback import calculate_feedback


def sample_bars():
    return pd.DataFrame([
        {'date': '2026-10-26', 'thscode': '000001.SZ', 'open_price': 9.5, 'close_price': 10.0},
        {'date': '2026-10-27', 'thscode': '000001.SZ', 'open_price': 11.0, 'close_price': 9.0},
        {'date': '2026-10-26', 'thscode': '000002.SZ', 'open_price': 19.0, 'close_price': 20.0},
        {'date': '2026-10-27', 'thscode': '000002.SZ', 'open_price': 18.0, 'close_price': 22.0},
    ])


def test_t1_uses_all_event_stocks_and_both_prices():
    prior = {'limits': {'total': 2},
             'stock_list': [{'thscode': '000001.SZ'}, {'thscode': '000002.SZ'}],
             'limit_down_events': [],
             'limit_break_events': [],
             'quality_manifest': {
               'limit_down_events': {'status': 'complete'},
               'limit_break_events': {'status': 'complete'}}}
    result, status = calculate_feedback('2026-10-26', '2026-10-27', prior, sample_bars())
    assert status == 'complete'
    assert result['limit_up']['sample_size'] == 2
    assert result['limit_up']['open_median_pct'] == 0.0
    assert result['limit_up']['close_median_pct'] == 0.0
    assert result['limit_up']['open_positive_ratio'] == 50.0
    assert result['limit_down']['total_events'] == 0


def test_missing_price_is_excluded_not_assumed_zero():
    prior = {'limits': {'total': 2},
             'stock_list': [{'thscode': '000001.SZ'}, {'thscode': '000003.SZ'}]}
    result, status = calculate_feedback('2026-10-26', '2026-10-27', prior, sample_bars())
    assert status == 'partial'
    assert result['limit_up']['total_events'] == 2
    assert result['limit_up']['sample_size'] == 1
    assert result['limit_up']['excluded_no_prices'] == 1
    assert result['limit_down'] is None


def test_no_special_event_pool_not_equal_zero_events():
    prior = {'limits': {'total': 1}, 'stock_list': [{'thscode': '000001.SZ'}]}
    result, status = calculate_feedback('2026-10-26', '2026-10-27', prior, sample_bars())
    assert status == 'partial'
    assert result['limit_down'] is None
    assert result['limit_break'] is None
    assert result['sources']['limit_down']['status'] == 'not_collected'


def test_missing_required_open_price_fails_explicitly():
    prior = {'limits': {'total': 1}, 'stock_list': [{'thscode': '000001.SZ'}]}
    try:
        calculate_feedback('2026-10-26', '2026-10-27', prior, sample_bars().drop(columns=['open_price']))
        assert False
    except ValueError as exc:
        assert 'missing price columns' in str(exc)


def test_t1_preserves_per_stock_realized_prices_for_sector_filter():
    prior = {'limits': {'total': 2}, 'stock_list': [
        {'thscode': '000001.SZ'}, {'thscode': '000002.SZ'}]}
    result, state = calculate_feedback('2026-10-26', '2026-10-27', prior, sample_bars())
    sample = {r['code']: r for r in result['limit_up']['samples']}
    assert set(sample) == {'000001.SZ', '000002.SZ'}
    assert sample['000001.SZ']['open_pct'] == 10.0
    assert sample['000001.SZ']['close_pct'] == -10.0
    assert sample['000002.SZ']['open_pct'] == -10.0
    assert sample['000002.SZ']['close_pct'] == 10.0
    assert result['limit_up']['sample_size'] == len(sample)

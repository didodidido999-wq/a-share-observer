"""T+1 event feedback calculated from actual unadjusted daily K bars.

Feedback is *observed* market behavior, not a tradable backtest. Missing
historical event pools, suspensions and incomplete OHLC are never zero-filled.
"""
from __future__ import annotations

from datetime import date, datetime
import os

import pandas as pd


def _median(values):
    return round(float(pd.Series(values).median()), 3) if values else None


def _mean(values):
    return round(float(sum(values) / len(values)), 3) if values else None


def _num(value):
    try:
        x = float(value)
        return x if pd.notna(x) and x > 0 else None
    except (ValueError, TypeError):
        return None


def calculate_feedback(previous_day, current_day, previous_archive, bars):
    """Today's summary of yesterday's full captured event universes.

    bars: pandas DataFrame with date, thscode, open_price, close_price.
    All stock codes are matched at both T and T+1; no survivorship filtering.
    """
    required = {'date', 'thscode', 'open_price', 'close_price'}
    if not required.issubset(bars.columns):
        raise ValueError('daily K missing price columns')
    by_key = {(r.thscode, r.date): r for r in
              bars[['thscode', 'date', 'open_price', 'close_price']].itertuples(index=False)}
    types = {
        'limit_up': ('stock_list', 'limits'),
        'limit_down': ('limit_down_events', 'limit_down_events'),
        'limit_break': ('limit_break_events', 'limit_break_events')
    }
    result = {'date': current_day, 'reference_date': previous_day,
              'price_basis': 'none (unadjusted daily close/open)', 'sources': {}}
    fully_covered = True
    for name, (field, quality_name) in types.items():
        pool = previous_archive.get(field)
        q = (previous_archive.get('quality_manifest') or {}).get(quality_name, {})
        confirmed = (pool is not None and
                     (quality_name == 'limits' and previous_archive.get('limits') is not None
                      or q.get('status') == 'complete'))
        if not confirmed:
            result[name] = None
            fully_covered = False
            result['sources'][name] = {'status': 'not_collected', 'sample_size': 0}
            continue
        codes = sorted({r.get('thscode') for r in pool if r.get('thscode')})
        op, cl, samples = [], [], []
        missing = 0
        for code in codes:
            current = by_key.get((code, current_day))
            prior = by_key.get((code, previous_day))
            prior_close = _num(getattr(prior, 'close_price', None))
            current_open = _num(getattr(current, 'open_price', None))
            current_close = _num(getattr(current, 'close_price', None))
            if prior_close is None or current_open is None or current_close is None:
                missing += 1
                continue
            opening = (current_open / prior_close - 1) * 100
            closing = (current_close / prior_close - 1) * 100
            op.append(opening)
            cl.append(closing)
            samples.append({'code': code, 'open_pct': round(opening, 4),
                            'close_pct': round(closing, 4)})
        row = {
            'total_events': len(codes), 'sample_size': len(op),
            'excluded_no_prices': missing,
            'open_mean_pct': _mean(op), 'open_median_pct': _median(op),
            'open_positive_ratio': round(100 * sum(x > 0 for x in op) / len(op), 2) if op else None,
            'close_mean_pct': _mean(cl), 'close_median_pct': _median(cl),
            'close_positive_ratio': round(100 * sum(x > 0 for x in cl) / len(cl), 2) if cl else None,
            'samples': samples,
        }
        status = 'complete' if missing == 0 else 'partial'
        if missing:
            fully_covered = False
        result[name] = row
        result['sources'][name] = {'status': status, 'sample_size': len(op)}
    return result, 'complete' if fully_covered else 'partial'


def enrich_feedback(day, previous_day, read_json, archive_path, merge_day,
                    parquet_loader, tz):
    """Refresh T+1 for an existing closed day; failures keep old data."""
    if os.getenv('V3_ENABLE_FEEDBACK', '1').strip() != '1':
        return None
    snap = read_json(archive_path(day), {})
    prior = read_json(archive_path(previous_day), {})
    if not snap.get('market') or not prior.get('limits'):
        return None
    q = snap.get('quality_manifest') or {}
    old_feedback = snap.get('next_day_feedback') or {}
    if (q.get('next_day_feedback', {}).get('status') == 'complete'
            and all(not isinstance(old_feedback.get(k), dict)
                    or isinstance(old_feedback[k].get('samples'), list)
                    for k in ('limit_up', 'limit_down', 'limit_break'))):
        return old_feedback
    try:
        bars = parquet_loader('10d', date.fromisoformat(previous_day),
                              date.fromisoformat(day))
        output, status = calculate_feedback(previous_day, day, prior, bars)
        now = datetime.now(tz).isoformat()
        merge_day(day, {'next_day_feedback': output,
                        'quality_manifest': {'next_day_feedback': {
                            'trade_date': day, 'source': 'daily-k-10d + daily event pools',
                            'status': status, 'collected_at': now,
                            'items_count': sum(v['sample_size'] for v in output.values()
                                               if isinstance(v, dict) and 'sample_size' in v)
                        }}})
        return output
    except Exception as exc:
        print('WARN V3 T+1 feedback unavailable: ' + type(exc).__name__)
        return None

"""Daily observed THS sector constituents + factual sector breadth/events.

The provider only offers *current* membership, never historical membership.
This collector refuses requests for prior trade dates and archives the actual
observation date. Never use a later membership list for historical research.
"""
from __future__ import annotations
import argparse
import gzip
import io
import json
import os
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from statistics import median

sys.path.insert(0, str(Path(__file__).resolve().parent))
import update as base
import history

DATA = history.DATA
MEMBER_DIR = DATA / 'sector-members'
ENDPOINT = '/api/a-share-index/constituents/ths-stock-list'


def current_members(client_get, code):
    payload = client_get(ENDPOINT, {'thscode': code})
    if not isinstance(payload, dict) or not isinstance(payload.get('item'), list):
        raise ValueError('sector constituents response lacks item array')
    items = payload['item']
    if not items and payload.get('total') != 0:
        raise ValueError('ambiguous empty sector constituents response')
    members = {}
    for x in items:
        if not isinstance(x, dict):
            raise ValueError('invalid sector constituents row')
        thscode = x.get('thscode')
        if not isinstance(thscode, str) or '.' not in thscode:
            raise ValueError('sector member missing valid exchange code')
        members[thscode] = x.get('name') or thscode
    if payload.get('total') is not None and len(items) < int(payload['total']):
        raise ValueError('sector member list incomplete vs total')
    return members


def compute_sector(members, prices, up, down, hot, down_complete, up_complete=True):
    """Return null for unverified event counts and insufficient price samples."""
    count = len(members)
    matched = [(code, prices[code]) for code in members if code in prices]
    valid = [(c, base.num(p.get('price_change_ratio_pct'))) for c, p in matched]
    valid = [(c, pct) for c, pct in valid if pct is not None]
    up_n = len(set(members) & up) if up_complete else None
    down_n = len(set(members) & down) if down_complete else None
    values = [v for _, v in valid]
    return {
        'member_count': count,
        'member_price_sample': len(values),
        'member_up_ratio': round(100 * sum(v > 0 for v in values) / len(values), 2) if values else None,
        'member_median': round(median(values), 3) if values else None,
        'limit_up_count': up_n,
        'limit_down_count': down_n,
        'limit_up_ratio': round(100 * up_n / count, 2) if count and up_n is not None else None,
        'limit_down_ratio': round(100 * down_n / count, 2) if count and down_n is not None else None,
        'hot_count': len(set(members) & hot) if hot is not None else None,
    }


def pick_focus(code, members, prices, up, down, broken, hot, representatives, day, max_items=6):
    events = up | down | broken | (hot or set())
    ranked = []
    for stock_code, name in members.items():
        p = prices.get(stock_code, {})
        change = base.num(p.get('price_change_ratio_pct'))
        turnover = base.num(p.get('turnover'))
        reasons = []
        if stock_code in up: reasons.append('当日涨停')
        if stock_code in down: reasons.append('当日跌停')
        if stock_code in broken: reasons.append('当日炸板')
        if hot is not None and stock_code in hot: reasons.append('当日热榜')
        if stock_code in representatives: reasons.append('固定代表股观察池')
        if change is not None and change >= 5: reasons.append('当日上涨≥5%')
        if change is not None and change <= -5: reasons.append('当日下跌≤-5%')
        # No subjective role inference. Select only stocks with recorded events
        # or in curated watchlist; liquidity is a factual tiebreaker.
        if not reasons:
            continue
        priority = (1 if stock_code in events else 0, 1 if stock_code in representatives else 0,
                    abs(change) if change is not None else -1,
                    turnover if turnover is not None else -1)
        ranked.append((priority, stock_code, name, change, reasons))
    ranked.sort(key=lambda x: (x[0], x[1]), reverse=True)
    result = []
    for _, stock_code, name, change, reasons in ranked[:max_items]:
        result.append({'trade_date': day, 'sector_code': code, 'stock_code': stock_code,
                       'stock_name': name, 'pct': change, 'factual_tags': reasons,
                       'selection_reasons': reasons, 'membership_observed_date': day})
    return result


def archive_gzip(day, memberships):
    MEMBER_DIR.mkdir(parents=True, exist_ok=True)
    output = MEMBER_DIR / (day + '.json.gz')
    body = json.dumps({'date': day, 'source': ENDPOINT, 'members': memberships},
                      ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    # Deterministic compressed archive makes reruns stable.
    with io.BytesIO() as stream:
        with gzip.GzipFile(fileobj=stream, mode='wb', filename='', mtime=0, compresslevel=8) as z:
            z.write(body)
        buf = stream.getvalue()
    temp = output.with_suffix('.json.gz.tmp')
    temp.write_bytes(buf)
    temp.replace(output)
    return output


def run(day=None, client_get=None, stock_snapshot=None, workers=None):
    now = datetime.now(base.TZ)
    today = now.strftime('%Y-%m-%d')
    day = day or today
    if day != today:
        raise ValueError('Current-only constituents cannot be backdated to ' + day)
    if now.hour < 16 and os.getenv('SECTOR_ALLOW_EARLY') != '1':
        print('Before 16:00 Beijing: skip unfinalized membership/market snapshot')
        return {'status': 'not_ready'}
    snap = history.read_json(history.archive_path(day), {})
    if not snap.get('market') or not snap.get('sectors'):
        print(f'{day}: no completed base market archive; sector collection deferred')
        return {'status': 'not_ready'}
    # Never overwrite historical facts. Re-running today can repair missing sectors.
    archive_file = MEMBER_DIR / (day + '.json.gz')
    previous = {}
    if archive_file.exists():
        try:
            with gzip.open(archive_file, 'rt', encoding='utf-8') as f:
                prior = json.load(f)
            if prior.get('date') == day: previous = prior.get('members') or {}
        except (OSError, ValueError, KeyError):
            previous = {}
    client_get = client_get or base.client_get
    if stock_snapshot is None:
        stock_snapshot, asof = history.get_stock_snapshot()
    else:
        asof = day
    if asof != day:
        raise base.ApiError('Price snapshot date differs from membership observation date')
    prices = {x['thscode']: x for x in stock_snapshot if x.get('thscode')}
    sectors = {x['code']: x for x in snap['sectors'] if x.get('code')}
    up_rows = snap.get('stock_list')
    down_rows = snap.get('limit_down_events')
    broken_rows = snap.get('limit_break_events')
    hot_rows = snap.get('hot_rank_daily')
    up = {r['thscode'] for r in (up_rows or []) if r.get('thscode')}
    down = {r['thscode'] for r in (down_rows or []) if r.get('thscode')}
    broken = {r['thscode'] for r in (broken_rows or []) if r.get('thscode')}
    hot = {r['thscode'] for r in hot_rows if r.get('thscode')} if hot_rows is not None else None
    down_complete = (snap.get('quality_manifest') or {}).get('limit_down_events', {}).get('status') == 'complete'
    up_complete = up_rows is not None and snap.get('limits') is not None
    representatives_data = history.read_json(DATA / 'representatives.json', {})
    representatives = {r.get('code') for r in representatives_data.get('universe', []) if r.get('code')}
    max_workers = max(1, min(4, int(workers or os.getenv('SECTOR_MEMBERS_WORKERS', '2'))))
    max_sectors = int(os.getenv('SECTOR_MEMBERS_LIMIT', '0') or 0)
    sector_codes = sorted(sectors)[:max_sectors] if max_sectors > 0 else sorted(sectors)

    def one(code):
        if code in previous and previous[code]:
            return code, previous[code], None
        try:
            # Respect conservative shared API request rate; at two workers
            # approximately <=4 calls/s excluding response latency.
            time.sleep(float(os.getenv('SECTOR_MEMBERS_THROTTLE', '0.5')))
            members = current_members(client_get, code)
            return code, members, None
        except Exception as exc:
            return code, None, type(exc).__name__

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        results = list(pool.map(one, sector_codes))
    captured = dict(previous)
    errors = []
    for code, members, err in results:
        if members is not None:
            captured[code] = members
        else:
            errors.append({'code': code, 'error': err})
    # Any successful recorded membership observation is worth preserving,
    # but missing items never become zero counts.
    observed = sum(code in captured for code in sector_codes)
    if not observed:
        raise RuntimeError('No valid sector membership obtained; refusing to publish')
    archive_gzip(day, captured)
    derived = []
    stocks = []
    reverse = defaultdict(set)
    for code in sector_codes:
        members = captured.get(code)
        if members is None:
            continue
        for stock in members:
            if stock in up or stock in down or stock in broken or (hot is not None and stock in hot):
                reverse[stock].add(sectors[code].get('name') or code)
        metrics = compute_sector(members, prices, up, down, hot, down_complete, up_complete)
        derived.append({'code': code, 'name': sectors[code].get('name') or code,
                        'tag': sectors[code].get('tag'), 'date': day,
                        'membership_observed_date': day, **metrics})
        stocks.extend(pick_focus(code, members, prices, up, down, broken, hot,
                                 representatives, day))
    quality = 'complete' if observed == len(sector_codes) else 'partial'
    coverage_ok = sum((x.get('member_count') or 0) == 0 or (x.get('member_price_sample') or 0) >= .90 * x['member_count'] for x in derived)
    inner_quality = ('complete' if (quality == 'complete' and down_complete and up_complete
                                      and coverage_ok == observed) else 'partial')
    captured_at = datetime.now(base.TZ).isoformat()
    patch = {
        'sectors': derived,
        'sector_focus_stocks': stocks,
        'event_sector_map': {k: sorted(v) for k, v in reverse.items()},
        'quality_manifest': {
            'sector_members': {'trade_date': day, 'status': quality,
                               'items_count': observed, 'expected_count': len(sector_codes),
                               'source': ENDPOINT, 'collected_at': captured_at,
                               'failed_count': len(errors)},
            'sector_internal_metrics': {'trade_date': day, 'status': inner_quality,
                                        'items_count': coverage_ok, 'expected_count': len(sector_codes),
                                        'source': 'same-date constituents + same-date stock snapshot',
                                        'collected_at': captured_at},
            'sector_focus_stocks': {'trade_date': day, 'status': quality if (down_complete and up_complete) else 'partial',
                                    'items_count': len(stocks), 'source': 'observed constituents + daily snapshot',
                                    'collected_at': captured_at}
        }
    }
    history.merge_day(day, patch)
    history.create_dashboard()
    print(json.dumps({'mode': 'sector-enrichment', 'date': day,
                      'sectors': len(sector_codes), 'observed': observed,
                      'failed': len(errors), 'focus_stocks': len(stocks),
                      'status': quality, 'errors_preview': errors[:8]}, ensure_ascii=False))
    return {'status': quality, 'total': len(sector_codes), 'observed': observed,
            'errors': errors}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--date', default=None)
    args = p.parse_args()
    result = run(day=args.date)
    # Visible CI failure on serious outages; partial data remains on disk for a
    # follow-up run, never mislabeled as complete.
    if result.get('status') == 'not_ready':
        raise SystemExit(2)
    # CI evaluates coverage after committing partial but valid history, so
    # outages never discard successfully collected point-in-time observations.


if __name__ == '__main__':
    main()

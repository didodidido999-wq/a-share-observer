"""Weekly captured THS constituents and daily factual sector breadth/events.

Membership is snapshot-only. Weekend/current weekly rosters carry an observed
as-of date; weekday derived metrics use the last archived weekly roster and
the actual same-date event pool. Never backdate a weekly roster to history.
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
from datetime import datetime, date, timedelta
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


def pick_focus(code, members, prices, up, down, broken, hot, representatives, day, max_items=6, membership_date=None):
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
                       'selection_reasons': reasons, 'membership_observed_date': membership_date or day})
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



def _write_weekly(members, observed_date, expected, errors):
    """Keep immutable weekly point-in-time member file and current pointer."""
    MEMBER_DIR.mkdir(parents=True, exist_ok=True)
    obj = {'observed_date': observed_date, 'source': ENDPOINT,
           'expected_count': expected, 'observed_count': len(members),
           'status': 'complete' if len(members)==expected else 'partial',
           'failed_count': len(errors), 'members': members}
    raw=json.dumps(obj, ensure_ascii=False, separators=(',',':')).encode('utf-8')
    with io.BytesIO() as stream:
        with gzip.GzipFile(fileobj=stream, mode='wb', filename='', mtime=0, compresslevel=8) as z:
            z.write(raw)
        compressed=stream.getvalue()
    weekly=MEMBER_DIR / (f'weekly-{observed_date}.json.gz')
    weekly.write_bytes(compressed)
    current=MEMBER_DIR / 'current.json.gz'
    current.write_bytes(compressed)
    return weekly


def _load_weekly():
    pointer=MEMBER_DIR / 'current.json.gz'
    if not pointer.exists():
        return None
    with gzip.open(pointer, 'rt', encoding='utf-8') as f:
        obj=json.load(f)
    if not isinstance(obj.get('members'), dict) or not obj.get('observed_date'):
        raise ValueError('Weekly constituent cache missing provenance')
    return obj


def weekly(client_get=None, workers=None, observed_date=None):
    """Fetch provider constituents only on weekly schedule or explicit bootstrap."""
    observed_date = observed_date or datetime.now(base.TZ).strftime('%Y-%m-%d')
    client_get=client_get or base.client_get
    dashboard=history.read_json(DATA/'dashboard.json', {})
    sectors={r['code'] for r in dashboard.get('sectors', []) if r.get('code')}
    if not sectors:
        raise RuntimeError('Cannot fetch members without verified sector catalog')
    previous=_load_weekly()
    # A repeated run in the same week skips sectors that were already captured.
    prev_rows=(previous.get('members') or {}) if previous and previous['observed_date']==observed_date else {}
    max_workers=max(1,min(4,int(workers or os.getenv('SECTOR_MEMBERS_WORKERS','2'))))
    def fetch(code):
        if code in prev_rows:
            return code, prev_rows[code], None
        try:
            time.sleep(float(os.getenv('SECTOR_MEMBERS_THROTTLE','0.5')))
            return code,current_members(client_get, code),None
        except Exception as e:
            return code,None,type(e).__name__
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        rows=list(executor.map(fetch, sorted(sectors)))
    members={c:m for c,m,error in rows if m is not None}
    errors=[{'code':c,'error':error} for c,m,error in rows if error]
    if not members:
        raise RuntimeError('Weekly API returned no verified constituent lists')
    _write_weekly(members, observed_date, len(sectors), errors)
    result={'mode':'weekly-membership','date':observed_date,'expected':len(sectors),
            'observed':len(members),'failed':len(errors),
            'status':'complete' if len(members)==len(sectors) else 'partial',
            'error_preview':errors[:8]}
    print(json.dumps(result, ensure_ascii=False))
    return result


def run(day=None, client_get=None, stock_snapshot=None, workers=None):
    """Day-close enrichment reusing latest prior weekly roster; no membership API."""
    now=datetime.now(base.TZ)
    today=now.strftime('%Y-%m-%d')
    day=day or today
    if day!=today:
        raise ValueError('Daily enrichment cannot backdate current market snapshot')
    if now.hour<16 and os.getenv('SECTOR_ALLOW_EARLY')!='1':
        print('Before Beijing 16:00: do not publish unclosed market observations')
        return {'status':'not_ready'}
    snap=history.read_json(history.archive_path(day), {})
    if not snap.get('market') or not snap.get('sectors'):
        print(f'{day}: daily market base archive not ready')
        return {'status':'not_ready'}
    quality=snap.get('quality_manifest') or {}
    if all(quality.get(k,{}).get('status')=='complete' for k in
           ('sector_members','sector_internal_metrics','sector_focus_stocks')):
        return {'status':'complete','skipped':True,'total':0,'observed':0}
    weekly_data=_load_weekly()
    if not weekly_data or weekly_data['observed_date']>day:
        print(f'{day}: no eligible weekly member snapshot; not using future constituents')
        return {'status':'not_ready'}
    catalog={x['code']:x for x in snap['sectors'] if x.get('code')}
    member_lists=weekly_data['members']
    member_date=weekly_data['observed_date']
    if stock_snapshot is None:
        stock_snapshot, asof=history.get_stock_snapshot()
    else:
        asof=day
    if asof!=day:
        raise base.ApiError('Market snapshot day mismatches current trading day')
    prices={x['thscode']:x for x in stock_snapshot if x.get('thscode')}
    pool=snap.get('stock_list')
    down_pool=snap.get('limit_down_events')
    broken_pool=snap.get('limit_break_events')
    hot_pool=snap.get('hot_rank_daily')
    up={x['thscode'] for x in (pool or []) if x.get('thscode')}
    down={x['thscode'] for x in (down_pool or []) if x.get('thscode')}
    broken={x['thscode'] for x in (broken_pool or []) if x.get('thscode')}
    hot={x['thscode'] for x in hot_pool if x.get('thscode')} if hot_pool is not None else None
    up_ok=pool is not None and snap.get('limits') is not None
    down_ok=quality.get('limit_down_events',{}).get('status')=='complete'
    reps=history.read_json(DATA/'representatives.json', {})
    representatives={x['code'] for x in reps.get('universe',[]) if x.get('code')}
    metrics_rows=[]
    focus_rows=[]
    reverse=defaultdict(set)
    for code,meta in catalog.items():
        members=member_lists.get(code)
        if members is None:
            continue
        values=compute_sector(members,prices,up,down,hot,down_ok,up_ok)
        metrics_rows.append({'code':code,'name':meta.get('name',code),
            'tag':meta.get('tag'),'date':day,'membership_observed_date':member_date,**values})
        for stock in members:
            if stock in up or stock in down or stock in broken or (hot is not None and stock in hot):
                reverse[stock].add(meta.get('name',code))
        focus_rows.extend(pick_focus(code,members,prices,up,down,broken,hot,
            representatives,day,membership_date=member_date))
    observed=len(metrics_rows)
    total=len(catalog)
    coverage=sum(x['member_count']==0 or
                 x['member_price_sample']>=.90*x['member_count'] for x in metrics_rows)
    member_quality='complete' if observed==total else 'partial'
    internals_quality='complete' if (member_quality=='complete' and coverage==observed
                                     and up_ok and down_ok) else 'partial'
    status={'trade_date':day,'status':member_quality,'items_count':observed,
            'expected_count':total,'source':f'weekly-member-snapshot:{member_date}',
            'membership_observed_date':member_date,
            'collected_at':datetime.now(base.TZ).isoformat()}
    history.merge_day(day,{
        'sectors':metrics_rows,
        'sector_focus_stocks':focus_rows,
        'event_sector_map':{code:sorted(groups) for code,groups in reverse.items()},
        'quality_manifest':{
            'sector_members':status,
            'sector_internal_metrics':{**status, 'status':internals_quality,
                'items_count':coverage, 'source':'weekly members + actual daily stock returns/events'},
            'sector_focus_stocks':{**status,'status':member_quality if (up_ok and down_ok) else 'partial',
                'items_count':len(focus_rows)}
        }
    })
    history.create_dashboard()
    result={'mode':'daily-from-weekly','date':day,'membership_observed_date':member_date,
            'observed':observed,'total':total,'breadth_covered':coverage,
            'status':internals_quality}
    print(json.dumps(result, ensure_ascii=False))
    return result

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--date',default=None)
    p.add_argument('--mode',choices=('daily','weekly'),default='daily')
    args=p.parse_args()
    result=weekly(observed_date=args.date) if args.mode=='weekly' else run(day=args.date)
    if result.get('status')=='not_ready':
        raise SystemExit(2)


if __name__ == '__main__':
    main()

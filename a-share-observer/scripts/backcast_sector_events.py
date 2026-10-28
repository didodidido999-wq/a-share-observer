"""One-off user-authorized current-constituent historical event backcast.

Cohort is the 2026-10-28 first confirmed membership snapshot. All earlier
trading dates use the *same fixed snapshot*; no look-ahead claims are made.
Real event pools are dated. Incomplete event pools give NULL for that
particular metric, never an invented zero. Existing observed-day calculations
are never overwritten. After this one-off, scheduled weekday data uses
weekly roster and real same-day events.
"""
from __future__ import annotations

import argparse
import gzip
import json
from collections import defaultdict
from pathlib import Path

import history
import v3_events
import v5_sector

DOMAINS = ('limit_up_count','limit_up_ratio','limit_down_count','limit_down_ratio','limit_diff','hot_count')
QUALITY_NAME = 'sector_backcast'
FIXED_COHORT = '2026-10-28'


def match_day(snapshot, members, *, membership_date):
    """Pure calculation; inputs are dated events + one explicit fixed cohort."""
    up_rows=snapshot.get('stock_list')
    down_rows=snapshot.get('limit_down_events')
    hot_rows=snapshot.get('hot_rank_daily')
    quality=v3_events.status_for_snapshot(snapshot)
    up_ok=up_rows is not None and snapshot.get('limits') is not None
    down_ok=down_rows is not None and quality['limit_down_events']['status']=='complete'
    hot_ok=hot_rows is not None and quality['hot_rank_daily']['status']=='complete'
    up={r['thscode'] for r in (up_rows or []) if r.get('thscode')}
    down={r['thscode'] for r in (down_rows or []) if r.get('thscode')}
    hot={r['thscode'] for r in (hot_rows or []) if r.get('thscode')}
    inverse=defaultdict(set)
    result=[]
    for sector in snapshot.get('sectors',[]):
        code=sector.get('code')
        sector_members=members.get(code)
        if sector_members is None:
            continue
        stocks=set(sector_members)
        count=len(stocks)
        lu=len(stocks&up) if up_ok else None
        ld=len(stocks&down) if down_ok else None
        h=len(stocks&hot) if hot_ok else None
        ld_known=len(stocks&down) if down_rows is not None else None
        result.append({
            'code':code,
            'membership_mode':'backcast_current',
            'membership_observed_date':membership_date,
            'limit_up_count':lu,
            'limit_down_count':ld,
            'limit_down_known_count':ld_known if not down_ok else None,
            'limit_down_known_ratio':round(100*ld_known/count,2) if not down_ok and ld_known is not None and count else None,
            'limit_down_completeness':'complete' if down_ok else 'partial' if down_rows is not None else 'missing',
            'limit_up_ratio':round(100*lu/count,2) if lu is not None and count else None,
            'limit_down_ratio':round(100*ld/count,2) if ld is not None and count else None,
            'limit_diff':lu-ld if lu is not None and ld is not None else None,
            'hot_count':h,
            'member_count':count,
        })
        for t in stocks&(up|down|hot):
            inverse[t].add(sector.get('name') or code)
    flags={'up':up_ok,'down':down_ok,'hot':hot_ok}
    return result, {k:sorted(v) for k,v in inverse.items()}, flags


def backcast(membership=None, *, persist=True):
    if membership is not None:
        roster=membership
    else:
        fixed_file=v5_sector.MEMBER_DIR / f'weekly-{FIXED_COHORT}.json.gz'
        if not fixed_file.exists():
            raise RuntimeError(f'Fixed cohort snapshot missing: {fixed_file}')
        with gzip.open(fixed_file, 'rt', encoding='utf-8') as handle:
            roster=json.load(handle)
    if roster.get('observed_date') != FIXED_COHORT:
        raise RuntimeError('Refusing to backcast with a membership cohort other than '+FIXED_COHORT)
    if not roster or not roster.get('observed_date') or not isinstance(roster.get('members'),dict):
        raise RuntimeError('Weekly membership archive unavailable; refusing historic backcast')
    observed=roster['observed_date']
    members=roster['members']
    days=[d for d in history.saved_dates() if d<observed]
    totals={'dates':len(days),'written_days':0,'skipped_days':0,
            'missing_sector_days':0,'complete_down_days':0,'partial_down_days':0}
    for day in days:
        archived=history.read_json(history.archive_path(day),{})
        old=archived.get('quality_manifest',{}).get(QUALITY_NAME,{})
        # Re-running with the same confirmed roster is idempotent.
        if old.get('membership_observed_date')==observed and old.get('status') in ('complete','partial'):
            totals['skipped_days']+=1
            continue
        rows,reverse,flags=match_day(archived,members,membership_date=observed)
        if not rows:
            totals['missing_sector_days']+=1
            continue
        totals['complete_down_days']+=int(flags['down'])
        totals['partial_down_days']+=int(not flags['down'])
        quality={
            'trade_date':day,
            'status':'complete' if all(flags.values()) and len(rows)==len(archived.get('sectors',[])) else 'partial',
            'membership_observed_date':observed,
            'membership_mode':'backcast_current',
            'source':'fixed current cohort x dated historical event pools',
            'items_count':len(rows),
            'expected_count':len(archived.get('sectors',[])),
            'source_complete':flags,
        }
        if persist:
            history.merge_day(day,{'sectors':rows,'quality_manifest':{QUALITY_NAME:quality}})
        totals['written_days']+=1
    if persist:
        history.create_dashboard()
    print('BACKCAST_SUMMARY '+json.dumps({'cohort':observed,**totals},ensure_ascii=False))
    return totals


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--dry-run',action='store_true')
    args=parser.parse_args()
    backcast(persist=not args.dry_run)


if __name__=='__main__':
    main()

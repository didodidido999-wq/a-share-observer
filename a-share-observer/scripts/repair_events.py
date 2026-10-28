"""One-time missing-only event archive repair (not part of daily schedule).

Repairs dated limit-down, limit-break and historical hot-stock pools from the
provider. Never uses today's constituent list to backdate sectors, and never
requests current-only anomalies for older dates. No K dump is downloaded.
"""
from __future__ import annotations
import json
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import history
import update as base
import v3_events

DOMAINS=('limit_down_events','limit_break_events','hot_rank_daily')

def needs_repair(snapshot):
    states=v3_events.status_for_snapshot(snapshot)
    return [k for k in DOMAINS if states[k]['status'] != 'complete']

def main():
    dates=history.saved_dates()
    if not dates:
        raise RuntimeError('No archived trading days')
    today=datetime.now(base.TZ).date().isoformat()
    attempted=Counter()
    completed=Counter()
    failed=Counter()
    skipped=0
    for i,day in enumerate(dates,1):
        snap=history.read_json(history.archive_path(day), {})
        missing=needs_repair(snap)
        if not missing:
            skipped+=1
            continue
        # Do not request a not-yet-closed trading day.
        if day>=today:
            print(f'SKIP {day}: not a previously closed day')
            continue
        attempted.update(missing)
        try:
            v3_events.enrich_if_enabled(day,base,history.read_json,
                                        history.archive_path,history.merge_day)
            after=history.read_json(history.archive_path(day),{})
            quality=v3_events.status_for_snapshot(after)
            for key in missing:
                if quality[key]['status']=='complete':
                    completed[key]+=1
                else:
                    failed[key]+=1
            if i%10==0:
                print(f'PROGRESS {i}/{len(dates)}: new completed counts {dict(completed)}')
        except Exception as exc:
            failed.update(missing)
            print(f'WARN {day}: {type(exc).__name__}, archive preserved')
    history.create_dashboard()
    result={'mode':'historical-event-repair','archive_days':len(dates),
            'already_complete_days_skipped':skipped,
            'attempted_modules':dict(attempted),
            'completed_modules':dict(completed),
            'still_incomplete_modules':dict(failed),
            'source':'dated historic event pools; no fabricated sector membership'}
    print('REPAIR_SUMMARY '+json.dumps(result,ensure_ascii=False))
    if sum(completed.values())==0 and sum(attempted.values())>0:
        raise SystemExit('No historical event pool gaps repaired; check API source')

if __name__=='__main__':
    main()

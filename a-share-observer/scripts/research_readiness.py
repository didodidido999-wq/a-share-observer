"""Fail closed before generating research from stale or unobserved EOD inputs."""
import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from research_ledger import read, stamp, finite, load_archives, index, validate_activation_date


def readiness(data, now):
    rows = load_archives(data, now)
    if not rows:
        raise ValueError('No observed closed-session archive')
    row = rows[-1]
    day = row['date']
    validate_activation_date({'data_date': day}, read(data/'research-calendar.json', {}), now)
    market = row.get('market') or {}
    values = [market.get(k) for k in ('up', 'down', 'flat')]
    if market.get('date') != day or not all(finite(v) and v >= 0 for v in values) or sum(values) <= 0:
        raise ValueError('Current-session market breadth missing')
    if not finite(index(row).get('close')) or index(row)['close'] <= 0:
        raise ValueError('Current-session benchmark missing')
    if sum(s.get('date') == day and finite(s.get('close')) for s in row.get('sectors', [])) < 400:
        raise ValueError('Current-session board prices not ready')
    warnings = []
    for key in ('sector_members', 'sector_internal_metrics', 'sector_focus_stocks'):
        q = row.get('quality_manifest', {}).get(key, {})
        if q.get('trade_date') != day or not q.get('collected_at') or stamp(q['collected_at']) > now:
            raise ValueError(key + ': current-session observed evidence missing')
        if q.get('status') not in ('complete', 'partial'):
            raise ValueError(key + ': unavailable')
        if q.get('status') == 'partial':
            total, count = q.get('expected_count'), q.get('items_count')
            if not finite(total) or total <= 0 or not finite(count) or count / total < .9:
                raise ValueError(key + ': partial coverage below 90%')
            warnings.append(f'{key}: partial {count}/{total}; missing observations remain missing')
    return {'ready': True, 'target_date': day, 'warnings': warnings}


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--data-dir', type=Path, default=Path(__file__).resolve().parents[1]/'docs'/'data')
    args = p.parse_args()
    try:
        result = readiness(args.data_dir, datetime.now(timezone.utc))
    except (ValueError, KeyError, TypeError) as exc:
        result = {'ready': False, 'reason': str(exc)}
    print(json.dumps(result, ensure_ascii=False))
    if os.getenv('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
            f.write(f"ready={str(result['ready']).lower()}\n")
    elif not result['ready']:
        raise SystemExit(1)

"""Date-based recovery checks shared by plan and final verification."""
import argparse
import json
import os
from pathlib import Path
import history
from closed_market import resolve_target

DATA = Path(__file__).resolve().parents[1] / 'docs' / 'data'
SECTOR_FIELDS = ('sector_members', 'sector_internal_metrics', 'sector_focus_stocks')


def status(day, root=DATA, expected_days=None):
    snap = history.read_json(root / 'history' / f'{day}.json', {})
    dates = history.read_json(root / 'dates.json', {}).get('dates', [])
    quality = snap.get('quality_manifest') or {}
    reps = history.read_json(root / 'representatives.json', {})
    prices, roster = reps.get('prices', {}), reps.get('universe', [])
    coverage = sum(any(r.get('date') == day for r in prices.get(x.get('code'), [])) for x in roster)
    required = max(270, int(len(roster) * .9))
    main = (day in dates and snap.get('date') == day and bool(snap.get('market'))
            and sum(x.get('close') is not None for x in snap.get('sectors', [])) >= 400
            and snap.get('limits') is not None)
    recent=[d for d in (expected_days or [day]) if d<=day][-9:]
    missing=[d for d in recent if d not in dates or not history.read_json(root/'history'/f'{d}.json',{}).get('market')]
    return {'target_date': day, 'main_complete': main, 'recent_missing_dates': missing,
            'representatives_covered': coverage, 'representatives_required': required,
            'representatives_complete': coverage >= required,
            'sector_complete': all(quality.get(k, {}).get('status') == 'complete' for k in SECTOR_FIELDS)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['plan', 'verify'], required=True)
    parser.add_argument('--module', choices=['all', 'main', 'sector', 'representatives'], default='all')
    parser.add_argument('--date', default=os.getenv('TARGET_TRADE_DATE'))
    args = parser.parse_args()
    day = args.date or resolve_target()
    result = status(day, expected_days=history.all_trading_days())
    print(json.dumps(result, ensure_ascii=False))
    if args.mode == 'plan':
        values = {'TARGET_TRADE_DATE': day, 'NEED_MAIN': not result['main_complete'] or bool(result['recent_missing_dates']),
                  'NEED_REPS': not result['representatives_complete'], 'NEED_SECTOR': not result['sector_complete']}
        with open(os.environ['GITHUB_ENV'], 'a', encoding='utf-8') as fd:
            for key, value in values.items():
                fd.write(f'{key}={str(value).lower()}\n')
    else:
        fields = ['main', 'representatives', 'sector'] if args.module == 'all' else [args.module]
        if any(not result[f'{key}_complete'] for key in fields) or ('main' in fields and result['recent_missing_dates']) or int(os.getenv('RECOVERY_FAILURES', '0')):
            raise SystemExit('Closed-session recovery incomplete; missing data is not success')


if __name__ == '__main__':
    main()

"""MarketScope V3 optional event sources and data-quality metadata.

No API keys or raw market dumps are persisted. Errors in V3 enrichments
never block the existing end-of-day market snapshot. Only *verified* empty
provider pages produce [] with status='complete'; missing pages remain null.
"""
from __future__ import annotations

from datetime import datetime
import os
from typing import Callable

ENDPOINTS = {
    'limit_down_events': '/api/a-share/special-data/limit-down-pool',
    'limit_break_events': '/api/a-share/special-data/limit-break-pool',
    'hot_rank_daily': '/api/a-share/special-data/hot-stock-list-history',
    'anomaly_daily': '/api/a-share/special-data/anomaly-analysis-list',
}
ALLOWED_STATES = ('complete', 'partial', 'missing', 'not_collected', 'not_applicable')
PAGE_SIZE = 100
MAX_PAGES = 100


def quality_entry(status, date, *, count=None, source='hithink-finance', captured_at=None,
                  error_class=None):
    assert status in ALLOWED_STATES
    return {'trade_date': date, 'status': status, 'items_count': count,
            'source': source, 'collected_at': captured_at, 'error_class': error_class}


def status_for_snapshot(snapshot):
    """Legacy compatibility: a value is not invented if source never collected it."""
    date = snapshot.get('date')
    prior = dict(snapshot.get('quality_manifest') or {})
    defaults = {
        'market': 'complete' if snapshot.get('market') and snapshot['market'].get('up') is not None else 'missing',
        'indices': 'complete' if any(x.get('close') is not None for x in snapshot.get('indices', [])) else 'missing',
        'sectors': 'complete' if any(x.get('close') is not None for x in snapshot.get('sectors', [])) else 'missing',
        'limits': 'complete' if snapshot.get('limits') is not None and 'stock_list' in snapshot else 'missing',
        'limit_down_events': 'not_collected', 'limit_break_events': 'not_collected',
        'hot_rank_daily': 'not_collected', 'anomaly_daily': 'not_collected',
        'sector_members': 'not_collected', 'sector_focus_stocks': 'not_collected',
        'next_day_feedback': 'not_collected',
    }
    for module, default in defaults.items():
        if module in prior:
            continue
        if module in snapshot and module not in ('market','indices','sectors','limits'):
            value = snapshot[module]
            default = 'complete' if value is not None else 'missing'
        value = snapshot.get(module)
        count = len(value) if isinstance(value, list) else None
        prior[module] = quality_entry(default, date, count=count, source='archive')
    return prior


def dashboard_quality(snaps):
    if not snaps:
        return {'status': 'missing', 'modules': {}, 'days': 0}
    module_names = list(status_for_snapshot(snaps[0]))
    entries = [status_for_snapshot(s) for s in snaps]
    metrics = {}
    for module in module_names:
        state_counts = {status: 0 for status in ALLOWED_STATES}
        for row in entries:
            status = row.get(module, {}).get('status','missing')
            state_counts[status if status in state_counts else 'missing'] += 1
        metrics[module] = state_counts
    overall = 'complete' if all(all(x.get('status')=='complete' for x in entry.values())
                                for entry in entries) else 'partial'
    return {'status': overall, 'days': len(snaps), 'modules': metrics}


def _items(response):
    if not isinstance(response, dict) or not isinstance(response.get('item'), list):
        raise ValueError('API schema missing item array')
    return response['item']


def _capture(record, trade_date):
    """Whitelist provider fields; do not persist arbitrary upstream payloads."""
    keys = ('thscode','name','is_st','is_new','last_price','continue_day_cnt',
            'first_limit_time','last_limit_time','open_times','limit_down_reason',
            'limit_up_reason','reason','rank','rank_change','tag_name','tag_type',
            'event_type','event_reason','date','timestamp','keyword','keywords',
            'stock_name','analysis_content','keyword_list','price_change_ratio_pct',
            'turnover_ratio_pct','turnover','seal_money','max_seal_money',
            'limit_up_time','first_limit_time','last_limit_time','continue_day_text')
    obj = {'date': trade_date}
    for key in keys:
        if record.get(key) is not None:
            obj['source_date' if key == 'date' else key] = record[key]
    obj['name'] = obj.get('name') or obj.get('stock_name') or obj.get('thscode') or '—'
    if obj.get('analysis_content') and not obj.get('reason'):
        obj['reason'] = obj['analysis_content']
    if isinstance(obj.get('keyword_list'), list):
        obj['keywords'] = obj['keyword_list']
    if obj.get('last_price') is not None:
        obj['price'] = obj['last_price']
    if obj.get('limit_down_reason') or obj.get('limit_up_reason') or obj.get('event_reason'):
        obj['reason'] = obj.get('limit_down_reason') or obj.get('limit_up_reason') or obj.get('event_reason')
    return obj


def fetch_paged(client_get: Callable, path: str, params: dict, day: str, issues=None):
    output, seen = [], set()
    received = 0
    for page in range(1, MAX_PAGES+1):
        payload = client_get(path, {**params, 'page': page, 'size': PAGE_SIZE})
        batch = _items(payload)
        received += len(batch)
        paging = payload.get('pagination') or {}
        total = paging.get('total', payload.get('total'))
        if not batch and page==1 and total is None and paging.get('pages') not in (0, 1):
            raise ValueError('ambiguous empty first page (no verified total)')
        for i, record in enumerate(batch):
            if not isinstance(record, dict):
                raise ValueError('malformed record')
            code = record.get('thscode')
            if not code:
                if issues is not None:
                    issues.append('record_missing_stock_code')
                    continue
                raise ValueError('record missing stock code')
            if code in seen: continue
            seen.add(code)
            output.append(_capture(record, day))
        pages = paging.get('pages')
        if pages is not None and page >= int(pages):
            break
        if paging.get('pages') is not None:
            # Always honor the provider's page count even if requested size is capped.
            continue
        if total is not None and received>=int(total):
            break
        if len(batch)<PAGE_SIZE:
            if total is not None and received<int(total):
                continue  # Provider may silently cap requested page size.
            break
    else:
        raise ValueError('pagination ceiling reached before completion')
    if total is not None and received<int(total):
        raise ValueError('fewer raw event records than pagination total')
    return output


def fetch_list(client_get, path, params, day):
    payload = client_get(path, params)
    items = _items(payload)
    total = (payload.get('pagination') or {}).get('total', payload.get('total'))
    if not items and total is None and not (
        payload.get('timestamp') is not None or payload.get('date') == day
    ):
        raise ValueError('cannot prove empty response was completed')
    if path == ENDPOINTS['hot_rank_daily'] and payload.get('date') != day:
        raise ValueError('historical hot rank returned a different date')
    # Top-N lists may be provider-capped; the archive stores precisely the returned rank entries.
    return [_capture(x, day) for x in items if isinstance(x, dict)]


def enrich_today(day, base, read_json, archive_path, merge_day):
    """Collect V3 events for a *closed* trading date. Each module retries separately.

    Existing complete modules are skipped. Failed API calls never replace an
    earlier reliable record with an empty array or raise out of the daily job.
    """
    snap = read_json(archive_path(day), {'date': day})
    if not snap.get('market'):
        return
    prior = status_for_snapshot(snap)
    now = datetime.now(base.TZ).isoformat()
    patch, quality = {}, {}
    endpoints = ('limit_down_events','limit_break_events','hot_rank_daily','anomaly_daily')
    for domain in endpoints:
        if prior[domain]['status']=='complete':
            continue
        try:
            issues = []
            if domain in ('limit_down_events','limit_break_events'):
                params = {'date_ms': base.since_ms(datetime.strptime(day, '%Y-%m-%d').date())}
                records = fetch_paged(base.client_get, ENDPOINTS[domain], params, day, issues=issues)
            elif domain=='hot_rank_daily':
                records = fetch_list(base.client_get, ENDPOINTS[domain], {'date':day}, day)
            else:
                # Current-day-only API: never request a historical date or backfill from today.
                if day != datetime.now(base.TZ).strftime('%Y-%m-%d'):
                    quality[domain] = quality_entry('not_collected', day, source='hithink-finance')
                    continue
                records = fetch_list(base.client_get, ENDPOINTS[domain], {}, day)
            patch[domain] = records
            quality[domain] = quality_entry('partial' if issues else 'complete',
                                            day, count=len(records), captured_at=now,
                                            error_class='IncompleteUpstreamCodes' if issues else None)
        except Exception as exc:
            quality[domain] = quality_entry('missing', day, captured_at=now,
                                            error_class=type(exc).__name__)
            detail = str(exc) if isinstance(exc, ValueError) else type(exc).__name__
            print(f'WARN V3 event {domain}: {detail}; original archive preserved')
    if 'limit_down_events' in patch or 'limit_break_events' in patch:
        patch['event_summary'] = {
            **(snap.get('event_summary') or {}),
            **({'limit_down_count':len(patch['limit_down_events']) if quality['limit_down_events']['status']=='complete' else None}
               if 'limit_down_events' in patch else {}),
            **({'limit_break_count':len(patch['limit_break_events'])} if 'limit_break_events' in patch else {})
        }
    if patch or quality:
        merge_day(day, {**patch, 'quality_manifest':quality})
    return quality


def enrich_if_enabled(day, base, read_json, archive_path, merge_day):
    """Publication requires explicit confirmation of API access and reuse rights."""
    if os.getenv('V3_ENABLE_EVENTS', '1').strip() != '1':
        return None
    return enrich_today(day, base, read_json, archive_path, merge_day)
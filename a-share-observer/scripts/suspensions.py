"""Dated full-session suspension evidence, never inferred from missing prices.

Eastmoney's date filter returns interval records (including future starts), not
an exact daily pool. Validate the full 09:30–15:00 interval ourselves. This is
retrospective evidence observed now, not a historical point-in-time signal.
"""
from datetime import datetime, time
import re
import requests

SOURCE = 'https://data.eastmoney.com/tfpxx/'
ENDPOINT = 'https://datacenter-web.eastmoney.com/api/data/v1/get'


def full_session_records(payload, day, observed_at):
    target = datetime.strptime(day, '%Y-%m-%d').date()
    observed = datetime.fromisoformat(observed_at)
    # Only repair recent closed sessions. No speculative future or bulk history.
    age = (observed.date() - target).days
    if age < 0 or age > 7 or (age == 0 and observed.time() < time(15, 30)):
        raise ValueError('Suspension evidence outside recent closed-session window')
    result = payload.get('result') or {}
    rows = result.get('data')
    if payload.get('success') is not True or not isinstance(rows, list):
        raise ValueError('Unverified suspension response')
    if result.get('pages') != 1 or result.get('count') != len(rows):
        raise ValueError('Incomplete suspension response')
    start_of_day = datetime.combine(target, time(9, 30))
    end_of_day = datetime.combine(target, time(15))
    verified = {}
    for row in rows:
        code = row.get('SECUCODE', '')
        if not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)', code):
            continue
        try:
            start = datetime.fromisoformat(row['SUSPEND_START_TIME'])
            end_raw = row.get('SUSPEND_END_TIME')
            end = datetime.fromisoformat(end_raw) if end_raw else None
        except (KeyError, TypeError, ValueError):
            continue
        if start > start_of_day or (end is not None and end < end_of_day):
            continue
        # Open-ended intervals require explicit continuous-suspension semantics.
        if end is None and row.get('SUSPEND_EXPIRE') != '连续停牌':
            continue
        resume_raw = row.get('PREDICT_RESUME_DATE')
        if resume_raw:
            try:
                if datetime.fromisoformat(resume_raw).date() <= target:
                    continue
            except (TypeError, ValueError):
                continue
        verified[code] = {'stock_code': code, 'trade_date': day,
            'suspend_start': row['SUSPEND_START_TIME'], 'suspend_end': end_raw,
            'status': 'full_session_suspended', 'source': SOURCE,
            'observed_at': observed_at, 'evidence_basis': 'retrospective_interval'}
    return verified


def fetch_full_session(day, observed_at):
    # Reject unsupported dates before making any network request.
    full_session_records({'success': True, 'result': {'pages': 1, 'count': 0, 'data': []}},
                         day, observed_at)
    response = requests.get(ENDPOINT, params={
        'reportName': 'RPT_CUSTOM_SUSPEND_DATA_INTERFACE', 'columns': 'ALL',
        'source': 'WEB', 'client': 'WEB',
        'filter': f'(DATETIME=\'{day}\')(MARKET="全部")',
        'pageSize': 500, 'pageNumber': 1}, timeout=(8, 15))
    response.raise_for_status()
    return full_session_records(response.json(), day, observed_at)

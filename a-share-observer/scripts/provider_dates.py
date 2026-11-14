"""Reject explicit historical-response date conflicts without mistaking retrieval
 timestamps for trading dates. An absent date is not independent date proof.
"""
from datetime import datetime
from zoneinfo import ZoneInfo


def validate_response_dates(payload, expected):
    verified = False
    records = [payload] + (payload.get('item') or [])
    for record in records:
        if not isinstance(record, dict):
            continue
        for key in ('date', 'trade_date', 'trading_date', 'date_ms'):
            raw = record.get(key)
            if raw is None or raw == '':
                continue
            text = str(raw)
            if key == 'date_ms':
                actual = datetime.fromtimestamp(float(raw)/1000, ZoneInfo('Asia/Shanghai')).date().isoformat()
            elif len(text) == 8 and text.isdigit():
                actual = f'{text[:4]}-{text[4:6]}-{text[6:]}'
            else:
                actual = text[:10]
            if actual != expected:
                raise ValueError('Historical endpoint returned a conflicting trading date')
            verified = True
    return verified

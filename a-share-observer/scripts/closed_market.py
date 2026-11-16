"""Select an actual closed exchange session, never a weekday approximation."""
import os
from datetime import datetime, time
from zoneinfo import ZoneInfo

TZ = ZoneInfo('Asia/Shanghai')
# User's post-close collection target; readiness still depends on source dates.
COLLECTION_READY_TIME = time(15, 30)


def latest_closed_day(days, now=None):
    now = now or datetime.now(TZ)
    if now.tzinfo is None:
        raise ValueError('Market clock must be timezone-aware')
    now = now.astimezone(TZ)
    today = now.date().isoformat()
    eligible = sorted({d for d in days if d < today or
                       (d == today and now.time() >= COLLECTION_READY_TIME)})
    if not eligible:
        raise ValueError('Exchange calendar has no closed trading session')
    return eligible[-1]


def resolve_target(now=None):
    import history
    days=history.all_trading_days()
    latest=latest_closed_day(days, now)
    requested=os.getenv('TARGET_TRADE_DATE')
    if requested:
        if requested not in days or requested > latest:
            raise ValueError('Requested session is not a verified closed exchange session')
        return requested
    return latest

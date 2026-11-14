"""Bounded recent archive repair using dated historical sources, never snapshots.

Only explicitly requested, closed trading days inside the rolling ten-session
window are eligible. Raw dumps and signed URLs are never saved to the repository.
Existing non-null observations are preserved. Unsupported historical event and
membership-derived indicators remain missing, not zero or present-day backcasts.
"""
from __future__ import annotations
import argparse
import json
from datetime import date, datetime, time
import history


def _fill_missing(old, new):
    if old is None:
        return new
    if isinstance(old, dict) and isinstance(new, dict):
        return {k: _fill_missing(old.get(k), new.get(k)) for k in old.keys() | new.keys()}
    return old


def _preserve_rows(old, new, keys):
    mapped = {tuple(row.get(k) for k in keys): row for row in old}
    for row in new:
        key = tuple(row.get(k) for k in keys)
        mapped[key] = _fill_missing(mapped.get(key), row)
    return list(mapped.values())


def _validate_targets(days, now=None):
    now = now or datetime.now(history.base.TZ)
    if now.tzinfo is None:
        raise ValueError('now must be timezone aware')
    now = now.astimezone(history.base.TZ)
    requested = sorted(set(days))
    if not requested:
        raise ValueError('at least one explicit trading date is required')
    for day in requested:
        if date.fromisoformat(day).isoformat() != day:
            raise ValueError('dates must use YYYY-MM-DD')
    calendar = history.all_trading_days()
    closed = [d for d in calendar if d < now.date().isoformat() or
              (d == now.date().isoformat() and now.time() >= time(16))]
    # Leave one session for prior closes; a ten-session file cannot safely
    # establish returns for its oldest session.
    eligible = closed[-10:][1:]
    if any(day not in eligible for day in requested):
        raise history.base.ApiError('定向回补仅允许最近10个已收盘交易日中具有前收盘价的日期')
    predecessor = closed[closed.index(requested[0]) - 1]
    return requested, predecessor


def backfill_days(days, *, now=None):
    """Repair requested recent dates, return per-date coverage, raise if unsafe.

    Critical validation completes for all dates before writing any archive.
    A successful return guarantees >= 3,500 market/return samples and >= 90%
    dated sector closes for every target. Optional unavailable sources are noted.
    """
    requested, predecessor = _validate_targets(days, now)
    frame = history.fetch_parquet('10d', date.fromisoformat(predecessor),
                                  date.fromisoformat(requested[-1]))
    sector_catalog = history.catalog()
    index_catalog = [{'name': n, 'code': c} for n, c in history.base.INDEX_CODES.items()]
    bars = {}
    for field, records in (('sectors', sector_catalog), ('indices', index_catalog)):
        per_day = {day: [] for day in requested}
        for record, points, error in history.historic_bars(records, requested):
            # Provider errors are not persisted, since errors can contain URLs.
            for point in points:
                day = point.get('date')
                if day not in per_day or point.get('close') is None:
                    continue
                per_day[day].append({**record, **point,
                                    **({'limit_up_proxy': None} if field == 'sectors' else {})})
        bars[field] = per_day

    predecessor_count = frame.loc[frame.date == predecessor, 'thscode'].nunique()
    if predecessor_count < 3500:
        raise history.base.ApiError('前一交易日历史行情覆盖不足，未写入')
    prepared = {}
    reports = []
    for day in requested:
        sliced = frame.loc[frame.date == day]
        if (len(sliced) < max(3500, predecessor_count * .9) or sliced.thscode.nunique() != len(sliced) or
                sliced.close_price.notna().sum() < 3500 or
                sliced.return_pct.notna().sum() < 3500):
            raise history.base.ApiError(f'{day}: 历史全市场日线或前收盘价覆盖不足，未写入')
        sector_rows = bars['sectors'][day]
        if len(sector_rows) < len(sector_catalog) * .9:
            raise history.base.ApiError(f'{day}: 历史板块日线覆盖不足，未写入')
        if len(bars['indices'][day]) < len(index_catalog) * .9:
            raise history.base.ApiError(f'{day}: 历史指数日线覆盖不足，未写入')
        previous = history.read_json(history.archive_path(day), {})
        notes = ['定向历史回补：市场使用10日历史日线，指数/板块使用历史K线；未用当前快照倒填',
                 '历史事件和板块成员衍生指标仅保留已归档值；不可可靠还原的字段保持缺失']
        pool = previous.get('stock_list') if previous.get('limits') is not None else None
        if pool is None:
            try:
                # get_limit_pool supplies date_ms to the historical endpoint.
                # Its returned row.date is assigned by the adapter, not a
                # separately verified provider timestamp.
                candidate = history.base.get_limit_pool(day)
                if candidate and all(row.get('date') == day for row in candidate):
                    pool = candidate
            except history.base.ApiError:
                pass
        if pool is None:
            notes.append('该日历史涨停池不可验证，保持缺失而非零')
        market, styles = history.convert_market(sliced, day, pool)
        additions = {'market': _fill_missing(previous.get('market'), market), 'notes': notes}
        for field, values, keys in (
                ('styles', styles, ('dimension', 'group')),
                ('indices', bars['indices'][day], ('code',)),
                ('sectors', sector_rows, ('code',))):
            additions[field] = _preserve_rows(previous.get(field, []), values, keys)
        if pool is not None:
            additions['limits'] = _fill_missing(previous.get('limits'), history.limit_summary(day, pool))
            additions['stock_list'] = _preserve_rows(previous.get('stock_list', []), pool, ('thscode',))
        prepared[day] = additions
        reports.append({'date': day, 'market_samples': market['samples'],
                        'return_samples': market['return_samples'],
                        'sector_closes': len(sector_rows), 'sector_catalog': len(sector_catalog),
                        'index_closes': len(bars['indices'][day]),
                        'limit_pool_from_dated_endpoint': pool is not None})
    for day, additions in prepared.items():
        history.merge_day(day, additions)
    history.create_dashboard()
    return reports


def historical_stock_rows(day, *, now=None):
    """Historical rows for dated sector calculations; never quote snapshots."""
    requested, predecessor = _validate_targets([day], now)
    frame = history.fetch_parquet('10d', date.fromisoformat(predecessor), date.fromisoformat(day))
    selected = frame.loc[frame.date == day]
    predecessor_count = frame.loc[frame.date == predecessor, 'thscode'].nunique()
    if (predecessor_count < 4000 or len(selected) < max(4000, predecessor_count * .9) or selected.thscode.nunique() != len(selected) or
            selected.close_price.notna().sum() < 4000 or
            selected.return_pct.notna().sum() < 4000):
        raise history.base.ApiError(f'{day}: 历史全市场行情/前收盘价覆盖不足，拒绝计算板块指标')
    return [{'date': day, 'thscode': row.thscode,
             'last_price': history.base.num(row.close_price),
             'price_change_ratio_pct': history.base.num(row.return_pct),
             'turnover': history.base.num(row.turnover)}
            for row in selected.itertuples()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dates', nargs='+', required=True)
    args = parser.parse_args()
    print(json.dumps(backfill_days(args.dates), ensure_ascii=False))


if __name__ == '__main__':
    main()

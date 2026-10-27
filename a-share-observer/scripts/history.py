"""Append-only A-share archive, starting 2026-06-10.

Modes:
  backfill: use one 10-year parquet dump + historical index K bars and day-specific
            limit-up pools; never invent unavailable historic fields.
  auto:     read ONLY today's paged whole-market snapshot, today index snapshots,
            and today limit-up pool. No rolling 10-day dump on routine runs.
  rebuild:  rebuild last-10 dashboard and all-date manifest without API requests.

Historical archive files are a public derived dataset. Secrets/raw market dump and
presigned download links never enter the repository.
"""
from __future__ import annotations
import argparse
import json
import os
import tempfile
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, time as dtime
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd
import requests
import update as base
import v3_events
import v3_feedback

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'docs' / 'data'
HISTORY = DATA / 'history'
START_DATE = date(2026, 6, 10)
DEFAULT_WINDOW = 10
# Worktree-only housekeeping threshold; Git retains deleted historical objects.
SOFT_BYTES = int(os.getenv('HISTORY_SOFT_BYTES', str(400 * 1024 * 1024)))
LIMIT_POOL_WORKERS = 3


def saved_dates():
    return sorted(p.stem for p in HISTORY.glob('????-??-??.json')
                  if START_DATE.isoformat() <= p.stem <= '9999-12-31')


def read_json(path, fallback=None):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except FileNotFoundError:
        return fallback


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=path.parent,
                                     suffix='.tmp', delete=False) as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        tmp = Path(f.name)
    tmp.replace(path)


def archive_path(day):
    return HISTORY / (day + '.json')


def merge_day(day, additions):
    """Preserve prior known values on partial retries; never replace values with null."""
    prev = read_json(archive_path(day), {'date': day})
    merged = dict(prev)
    merged['date'] = day
    for field in ('market', 'limits'):
        if additions.get(field) is not None:
            if not isinstance(additions[field], dict):
                merged[field] = additions[field]
            else:
                prior = prev.get(field) or {}
                merged[field] = {k: (v if v is not None else prior.get(k))
                                 for k, v in {**prior, **additions[field]}.items()}
    for field in ('indices', 'sectors', 'styles', 'stock_list'):
        if field not in additions or additions[field] is None:
            continue
        if field == 'stock_list':
            if additions[field]:
                prior_codes = {x.get('thscode'):x for x in prev.get(field, [])}
                prior_codes.update({x.get('thscode'):x for x in additions[field]})
                merged[field] = list(prior_codes.values())
            elif field not in merged:
                merged[field] = []
        else:
            fields = {'indices':('code',), 'sectors':('code',), 'styles':('dimension','group')}
            keyfields = fields[field]
            objects = {tuple(x.get(k) for k in keyfields):x for x in prev.get(field, [])}
            for x in additions[field]:
                key = tuple(x.get(k) for k in keyfields)
                past = objects.get(key, {})
                objects[key] = {k:(v if v is not None else past.get(k)) for k,v in {**past, **x}.items()}
            merged[field] = list(objects.values())
    for field in ('limit_down_events', 'limit_break_events', 'hot_rank_daily',
                  'anomaly_daily', 'sector_focus_stocks', 'event_summary',
                  'next_day_feedback'):
        if field in additions and additions[field] is not None:
            merged[field] = additions[field]
    if isinstance(additions.get('quality_manifest'), dict):
        merged['quality_manifest'] = {**(prev.get('quality_manifest') or {}),
                                      **additions['quality_manifest']}
    merged['schema_version'] = 3
    merged['generated_at'] = datetime.now(base.TZ).isoformat()
    if 'notes' in additions:
        merged['notes'] = sorted(set((prev.get('notes') or []) + additions['notes']))
    write_json(archive_path(day), merged)
    return merged


def migrate_old_stocks():
    previous = read_json(DATA/'dashboard.json', {})
    lists = defaultdict(list)
    for item in previous.get('stock_list', []):
        if item.get('date'):
            lists[item['date']].append(item)
    for day in saved_dates():
        existing = read_json(archive_path(day), {})
        if lists.get(day) and not existing.get('stock_list'):
            merge_day(day, {'stock_list':lists[day]})


def maybe_trim_archive():
    """Limit working-tree history; note old Git commits still retain prior objects."""
    days=saved_dates()
    size=sum(archive_path(d).stat().st_size for d in days)
    if size<=SOFT_BYTES:return []
    goal=int(SOFT_BYTES*.8)
    removed=[]
    for d in days[:-DEFAULT_WINDOW]:
        if size<=goal:break
        p=archive_path(d)
        size-=p.stat().st_size
        p.unlink()
        removed.append(d)
    if removed:
        print(f'WARN: removed {len(removed)} oldest working-tree JSON files. '
              'Git commit history STILL retains previous blobs; external archival '
              'storage/repository maintenance will eventually be needed.')
    return removed


def archive_manifest():
    days = saved_dates()
    total = sum(archive_path(day).stat().st_size for day in days)
    return {'dates':days,'earliest':days[0] if days else None,
            'latest':days[-1] if days else None,
            'configured_start':START_DATE.isoformat(),'default_trading_days':DEFAULT_WINDOW,
            'archive_days':len(days),'archive_bytes':total,
            'soft_budget_bytes':SOFT_BYTES,'near_budget':total >= int(SOFT_BYTES*.8),
            'source':'hithink-finance','generated_at':datetime.now(base.TZ).isoformat()}


def create_dashboard():
    """Build current 10-day view without historical API calls."""
    # Keep all previously archived trading dates even if storage exceeds soft budget.
    manifest = archive_manifest()
    days = manifest['dates'][-DEFAULT_WINDOW:]
    old = read_json(DATA/'dashboard.json', {})
    snaps = [read_json(archive_path(d), {'date':d}) for d in days]
    indices, sectors = {}, {}
    for snap in snaps:
        for obj in snap.get('indices', []):
            code = obj.get('code')
            if not code: continue
            item = indices.setdefault(code, {'name':obj.get('name',code),'code':code,'points':[]})
            item['points'].append({k:v for k,v in obj.items() if k in ('date','close','pct','turnover')})
        for obj in snap.get('sectors', []):
            code = obj.get('code')
            if not code: continue
            item = sectors.setdefault(code, {'name':obj.get('name',code),'code':code,'tag':obj.get('tag'),'points':[]})
            item['points'].append({k:v for k,v in obj.items() if k in
                ('date','close','pct','turnover','limit_up_count','limit_down_count',
                 'limit_up_ratio','limit_down_ratio','member_up_ratio',
                 'member_median','hot_count','member_metrics')})
    market = [s['market'] for s in snaps if s.get('market') is not None]
    limits = [s['limits'] for s in snaps if s.get('limits') is not None]
    styles = [row for s in snaps for row in s.get('styles', [])]
    stock_list = [row for s in snaps for row in s.get('stock_list', [])]
    warnings = []
    if len(market) < len(days):warnings.append('部分交易日缺少全市场行情统计')
    if len(limits) < len(days):warnings.append('部分交易日涨停池无可验证数据')
    if any(not s.get('sectors') for s in snaps):warnings.append('部分交易日板块历史数据暂缺')
    if manifest['near_budget']:
        warnings.append('历史归档接近内部存储预算；Git删除文件不等于释放Git历史空间，请迁移数据存储')
    for s in snaps:
        warnings.extend(s.get('notes', []))
    warnings = list(dict.fromkeys(warnings))[:20]
    quality = v3_events.dashboard_quality(snaps)
    if quality['status'] != 'complete':
        warnings.append('部分V3指标尚未采集：请参见quality_manifest覆盖情况')
    data = {'schema_version': 3, 'quality_manifest':quality,
            'status':'live' if not warnings else 'partial', 'source':'hithink-finance',
            'generated_at':datetime.now(base.TZ).isoformat(), 'latest_date':days[-1] if days else None,
            'dates':days,'indices':list(indices.values()),'sectors':list(sectors.values()),
            'market':market,'styles':styles,'limits':limits,'stock_list':stock_list,
            'coverage':{'stock_days':len(market),'index_count':len(indices),
              'sector_count':len(sectors),'limit_days':len(limits),'archive_days':len(manifest['dates']),
              'earliest_saved_date':manifest['earliest'],'configured_start':START_DATE.isoformat(),
              'industry_limit_mapping':'历史涨停归因不可由现今板块成员代替，无法确认时留空'},
            'warnings':warnings}
    write_json(DATA/'dashboard.json',data)
    write_json(DATA/'dates.json',manifest)
    return data


def all_trading_days():
    j=base.client_get('/api/a-share/calendar/trading-days')
    days=[]
    for obj in j.get('item', []):
        raw=str(obj.get('date') or '')
        if len(raw)==8 and raw.isdigit():
            d=raw[:4]+'-'+raw[4:6]+'-'+raw[6:8]
        elif obj.get('date_ms') is not None:
            d=base.trading_date(obj['date_ms'])
        else:continue
        if START_DATE.isoformat()<=d<=datetime.now(base.TZ).strftime('%Y-%m-%d'):
            days.append(d)
    return sorted(set(days))


def fetch_parquet(kind, start_date, end_date):
    """Stream parquet to avoid loading ten years of OHLC into runner RAM."""
    import pyarrow.parquet as pq
    endpoint=('/api/dump/market-dumps/daily-k/download-url' if kind=='full' else
              '/api/dump/market-dumps/daily-k-10d/download-url')
    obj=base.client_get(endpoint)
    url=obj.get('presigned_url')
    if not url or urlparse(url).scheme!='https':
        raise base.ApiError('市场数据导出地址缺失或无效')
    with tempfile.NamedTemporaryFile(suffix='.parquet',delete=False) as f:
        local=Path(f.name)
    try:
        with requests.get(url,stream=True,timeout=(30,240)) as response:
            response.raise_for_status()
            with local.open('wb') as out:
                for chunk in response.iter_content(4*1024*1024):
                    if chunk:out.write(chunk)
        parquet=pq.ParquetFile(local)
        selected=['thscode','date_ms','open_price','high_price','low_price','close_price','volume','turnover']
        if not set(selected).issubset(parquet.schema_arrow.names):
            raise base.ApiError('Parquet缺失必要行情字段')
        from_ms=base.since_ms(start_date - timedelta(days=14))
        until_ms=base.since_ms(end_date + timedelta(days=1))
        frames=[]
        for batch in parquet.iter_batches(batch_size=120000, columns=selected):
            df=batch.to_pandas()
            df=df.loc[(df.date_ms>=from_ms)&(df.date_ms<until_ms)]
            if not df.empty:frames.append(df)
        if not frames:
            raise base.ApiError('历史Parquet未覆盖所需区间')
        df=pd.concat(frames,ignore_index=True)
        df['date']=pd.to_datetime(df.date_ms,unit='ms',utc=True).dt.tz_convert('Asia/Shanghai').dt.strftime('%Y-%m-%d')
        df=df.drop_duplicates(['thscode','date'],keep='last').sort_values(['thscode','date'])
        # no fill forward: IPO first date and missing prior close remain null
        df['return_pct']=df.groupby('thscode').close_price.pct_change(fill_method=None)*100
        return df.loc[df['date']>=start_date.isoformat()].copy()
    finally:
        local.unlink(missing_ok=True)


def catalog():
    existing=read_json(DATA/'dashboard.json',{})
    mapped={s['code']:{'name':s.get('name',s['code']), 'code':s['code'],'tag':s['tag']}
            for s in existing.get('sectors',[]) if s.get('code') and s.get('tag')}
    for tag in ('industry','cn_concept'):
        response=base.client_get('/api/a-share-index/catalog/ths-index-list',{'tag':tag})
        for x in response.get('item',[]):
            if x.get('thscode'):
                code=x['thscode'];mapped[code]={'name':x.get('name',code),'code':code,'tag':tag}
    if len(mapped)<50:
        raise base.ApiError('板块目录数量异常，停止数据更新')
    return list(mapped.values())


def limit_summary(day, pool):
    a=[x for x in pool if x.get('date')==day]
    return {'date':day,'total':len(a),'non_st':sum(not x['is_st'] for x in a),
            'first':sum(x['boards']==1 and not x['is_st'] for x in a),
            'continued':sum(x['boards']>=2 and not x['is_st'] for x in a),
            'highest':max((x['boards'] for x in a if not x['is_st']),default=None)}


def convert_market(df,day,pool=None):
    market=base.calculate_market(df,[day])[0]
    # If limit-up pool is unknown, do not report 0 as a false count.
    styles=base.market_style(df,pool or [],[day])
    if pool is None:
        for s in styles:s['limit_up']=None
    return market,styles


def get_stock_snapshot():
    """Strict whole-universe daily snapshot, robust if API caps requested page size."""
    items=[];seen=set();total=None;stamp_day=None;limit=500;offset=0
    for _ in range(120):
        raw=base.client_get('/api/a-share/prices/snapshot',{'limit':limit,'offset':offset})
        batch=raw.get('item') or []
        if raw.get('timestamp') is not None:
            d=base.trading_date(raw['timestamp'])
            if stamp_day is None:stamp_day=d
            elif stamp_day!=d:
                raise base.ApiError('分页过程中行情日期发生变化，拒绝混用交易日')
        if total is None and raw.get('total') is not None:total=int(raw['total'])
        if not batch:break
        offset+=len(batch)
        for item in batch:
            code=item.get('thscode')
            if code and code not in seen:seen.add(code);items.append(item)
        if total is not None and offset>=total:break
        if total is None and len(batch)<limit:break
    if len(items)<4000 or (total and len(items)<int(total*.95)):
        raise base.ApiError(f'全市场快照覆盖不足({len(items)}/{total})，拒绝发布')
    if stamp_day is None:raise base.ApiError('全市场快照缺少日期')
    return items,stamp_day


def snapshot_rows(items,day,pool):
    rows=[{'date':day,'thscode':x['thscode'], 'close_price':base.num(x.get('last_price')),
           'return_pct':base.num(x.get('price_change_ratio_pct')),
           'turnover':base.num(x.get('turnover'))}
          for x in items if x.get('thscode')]
    return convert_market(pd.DataFrame(rows),day,pool)


def chunked(rows,n=30):
    for start in range(0,len(rows),n):yield rows[start:start+n]


def snapshot_index_rows(records,day):
    groups=list(chunked(records,30))
    observed={}
    def get(group):
        d=base.client_get('/api/a-share-index/prices/snapshot',
                          {'thscodes':','.join(x['code'] for x in group)})
        return d.get('item',[])
    with ThreadPoolExecutor(max_workers=base.MAX_WORKERS) as ex:
        for group in ex.map(get,groups):
            for item in group:
                if item.get('thscode'):observed[item['thscode']]=item
    result=[]
    for record in records:
        x=observed.get(record['code']) or {}
        result.append({'name':record['name'],'code':record['code'],
                       **({'tag':record['tag']} if 'tag' in record else {}),
                       'date':day,'close':base.num(x.get('last_price')),
                       'pct':base.num(x.get('price_change_ratio_pct')),
                       'turnover':base.num(x.get('turnover')),
                       'limit_up_proxy':None})
    return result


def today():
    now=datetime.now(base.TZ)
    if now.time()<dtime(15,30):
        print('北京时间15:30前不执行收盘快照；不发布盘中数据')
        return
    day=now.strftime('%Y-%m-%d')
    days=all_trading_days()
    if day not in days:
        print(f'{day}不是交易日；跳过')
        create_dashboard();return
    existing=read_json(archive_path(day),{})
    if existing.get('market') and sum(x.get('close') is not None for x in existing.get('sectors',[]))>=400 and existing.get('limits') is not None:
        v3_events.enrich_if_enabled(day, base, read_json, archive_path, merge_day)
        preceding = [d for d in days if d < day]
        if preceding:
            v3_feedback.enrich_feedback(day, preceding[-1], read_json,
                                        archive_path, merge_day, fetch_parquet, base.TZ)
        print(f'{day}基础归档已存在，V3增量采集已核对');create_dashboard();return
    items,asof=get_stock_snapshot()
    if asof!=day:raise base.ApiError(f'全市场快照尚未更新为{day}，当前为{asof}')
    pool=base.get_limit_pool(day)
    market,styles=snapshot_rows(items,day,pool)
    sector_catalog=catalog()
    index_catalog=[{'name':name,'code':code} for name,code in base.INDEX_CODES.items()]
    indices=snapshot_index_rows(index_catalog,day)
    sectors=snapshot_index_rows(sector_catalog,day)
    ok=sum(x['close'] is not None for x in sectors)
    if ok<len(sector_catalog)*.9:
        raise base.ApiError(f'板块快照不完整 {ok}/{len(sector_catalog)}，拒绝发布')
    # Point-in-time membership not guaranteed, so avoid historical proxy.
    merge_day(day,{'market':market,'styles':styles,'indices':indices,'sectors':sectors,
                   'limits':limit_summary(day,pool),'stock_list':pool})
    v3_events.enrich_if_enabled(day, base, read_json, archive_path, merge_day)
    preceding = [d for d in days if d < day]
    if preceding:
        v3_feedback.enrich_feedback(day, preceding[-1], read_json,
                                    archive_path, merge_day, fetch_parquet, base.TZ)
    create_dashboard()
    print(json.dumps({'mode':'auto','date':day,'market_samples':market['samples'],
                      'sectors':ok,'stocks':len(pool)},ensure_ascii=False))


def historic_bars(records,dates):
    """One historical K request per index, not one request per date."""
    first=date.fromisoformat(dates[0]);last=date.fromisoformat(dates[-1]);
    begin=base.since_ms(first-timedelta(days=12))
    end=base.since_ms(last+timedelta(days=1))-1
    def one(record):
        try:
            bars=base.latest_close_bar(record['code'],begin,end)
            points=base.series_returns(bars,dates)
            return record, points, None
        except Exception as exc:
            return record, [], str(exc)
    with ThreadPoolExecutor(max_workers=base.MAX_WORKERS) as ex:
        return list(ex.map(one,records))


def backfill():
    """One-time historical backfill, with a single write for each archived date."""
    days=all_trading_days()
    if not days:raise base.ApiError('交易日历无有效历史日期')
    now=datetime.now(base.TZ)
    if now.time()<dtime(16,0) and days[-1]==now.strftime('%Y-%m-%d'):
        days=days[:-1]
    if not days:raise base.ApiError('暂无已收盘日期')
    migrate_old_stocks()
    pending={d:read_json(archive_path(d),{'date':d}) for d in days}
    # Index existing record by code/group so updates remain O(1) even for 700+ sectors.
    grouped={d:{field:{tuple(x.get(k) for k in keys):x for x in pending[d].get(field,[])}
          for field,keys in [('indices',('code',)),('sectors',('code',)),
                             ('styles',('dimension','group'))]} for d in days}
    def put(day,field,item):
        keys={'indices':('code',),'sectors':('code',),'styles':('dimension','group')}[field]
        key=tuple(item.get(k) for k in keys)
        old=grouped[day][field].get(key,{})
        grouped[day][field][key]={k:(v if v is not None else old.get(k))
                                    for k,v in {**old,**item}.items()}

    missing_market=[d for d in days if not pending[d].get('market') or not pending[d].get('styles')]
    df=None
    if missing_market:
        print(f'首次全量Parquet下载，仅补缺的市场统计 {len(missing_market)} 日')
        df=fetch_parquet('full', START_DATE, date.fromisoformat(days[-1]))
        for day in missing_market:
            sliced=df.loc[df.date==day]
            if len(sliced)<3500:
                print(f'WARN {day}: 全市场行情样本不足 {len(sliced)}，保持缺失')
                continue
            old=pending[day]
            pool=old.get('stock_list') if old.get('limits') is not None else None
            market,styles=convert_market(sliced,day,pool)
            if not old.get('market'):pending[day]['market']=market
            for x in styles:put(day,'styles',x)
    # Never publish a phantom newest trading day before market bars are available.
    days=[d for d in days if pending[d].get('market') is not None]
    pending={d:pending[d] for d in days}
    grouped={d:grouped[d] for d in days}
    if not days:raise base.ApiError('待回补交易日尚无完整市场日线')

    sector_catalog=catalog()
    indices=[{'name':n,'code':code} for n,code in base.INDEX_CODES.items()]
    for label,records,field in [('指数',indices,'indices'),('板块',sector_catalog,'sectors')]:
        needed=[r for r in records if any(
          (r['code'],) not in grouped[day][field] or
          grouped[day][field][(r['code'],)].get('close') is None for day in days)]
        print(f'{label}历史待补 {len(needed)}/{len(records)}；每代码仅请求一次')
        for obj,points,error in historic_bars(needed,days):
            if error:print(f'WARN {label} {obj["code"]}: 历史行情不可用')
            for point in points:
                if point.get('close') is None:continue
                row={**obj,**point}
                if field=='sectors':row['limit_up_proxy']=None
                put(point['date'],field,row)

    missing_limits=[d for d in days if pending[d].get('limits') is None or
                    'stock_list' not in pending[d]]
    print(f'涨停池需要补录 {len(missing_limits)} 个交易日')
    for i,d in enumerate(missing_limits,1):
        try:
            pool=base.get_limit_pool(d)
            if not pool:
                print(f'WARN {d}: 涨停池为空，不能确认历史源有数据，保持缺失')
                continue
            pending[d]['limits']=limit_summary(d,pool)
            old={x.get('thscode'):x for x in pending[d].get('stock_list',[])}
            old.update({x['thscode']:x for x in pool})
            pending[d]['stock_list']=list(old.values())
            # When market dump is loaded, compute exact historical price-bin
            # limit counts for this day rather than leaving null or using 0.
        except Exception:
            print(f'WARN 涨停池历史查询失败: {d}，保持缺失')
        if i%15==0:print(f'涨停池回补进度 {i}/{len(missing_limits)}')

    if df is not None:
        for d in days:
            if not pending[d].get('market'):continue
            if pending[d].get('limits') is None:continue
            pool=pending[d].get('stock_list') or []
            slice_day=df.loc[df.date==d]
            if slice_day.empty:continue
            _market, style_rows=convert_market(slice_day,d,pool)
            for x in style_rows:put(d,'styles',x)
        del df

    for d in days:
        data=pending[d]
        for field in ('indices','sectors','styles'):
            data[field]=list(grouped[d][field].values())
        data['date']=d
        data['generated_at']=now.isoformat()
        write_json(archive_path(d),data)
    output=create_dashboard()
    print(json.dumps({'mode':'backfill','configured_start':START_DATE.isoformat(),
       'archived_days':len(saved_dates()),'latest':output['latest_date'],
       'status':output['status']},ensure_ascii=False))


def refresh_recent():
    """Selective V3 backfill for saved recent trading days; never calls 10-year dump."""
    days = saved_dates()[-DEFAULT_WINDOW:]
    if not days:
        raise base.ApiError('no archived dates to enrich')
    frame = None

    def cached_ten_day_dump(kind, start, end):
        nonlocal frame
        if kind != '10d':
            raise ValueError('refresh only permits rolling 10-day dump')
        if frame is None:
            frame = fetch_parquet('10d', date.fromisoformat(days[0]),
                                  date.fromisoformat(days[-1]))
        return frame

    for i, day in enumerate(days):
        v3_events.enrich_if_enabled(day, base, read_json, archive_path, merge_day)
        if i > 0:
            v3_feedback.enrich_feedback(
                day, days[i-1], read_json, archive_path,
                merge_day, cached_ten_day_dump, base.TZ)
    output = create_dashboard()
    print(json.dumps({'mode': 'refresh', 'days': len(days),
                      'latest_date': output['latest_date'],
                      'quality': output.get('quality_manifest', {}).get('status')},
                     ensure_ascii=False))


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--mode',choices=('auto','backfill','rebuild','refresh'),default='auto')
    args=parser.parse_args()
    if args.mode=='backfill':backfill()
    elif args.mode=='auto':today()
    elif args.mode=='refresh':refresh_recent()
    else:create_dashboard()

if __name__=='__main__':main()

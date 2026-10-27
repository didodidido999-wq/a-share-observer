"""hithink-finance REST collector. Aggregates only; never writes credentials/raw dumps to public folder."""
from __future__ import annotations
import concurrent.futures
from datetime import datetime, timedelta, timezone
from collections import Counter, defaultdict
from pathlib import Path
import json, os, tempfile, time
from urllib.parse import urlparse
from zoneinfo import ZoneInfo
import requests
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'docs/data/dashboard.json'
BASE = 'https://fuyao.aicubes.cn'
TZ = ZoneInfo('Asia/Shanghai')
HEADERS = {'User-Agent': 'a-share-observer/0.1'}
INDEX_CODES = {'上证指数':'000001.SH','深证成指':'399001.SZ','沪深300':'000300.SH','中证500':'000905.SH',
               '中证1000':'000852.SH','中证2000':'932000.CSI','创业板指':'399006.SZ','科创50':'000688.SH','北证50':'899050.BJ'}
MAX_WORKERS = max(1,min(6,int(os.getenv('SECTOR_WORKERS','3'))))
MAX_INDICES = max(0,int(os.getenv('MAX_SECTOR_INDICES','0'))) # 0=all; no silent truncation

class ApiError(RuntimeError):
    pass

def client_get(path,params=None,attempts=3):
    key=os.environ.get('HITHINK_FINANCE_API_KEY','').strip()
    if not key:
        raise ApiError('未设置 GitHub Actions Secret: HITHINK_FINANCE_API_KEY')
    for n in range(attempts):
        try:
            resp=requests.get(BASE+path,params=params,headers={**HEADERS,'X-api-key':key},timeout=(12,40))
            resp.raise_for_status()
            obj=resp.json()
            if obj.get('code') != 0:
                code=obj.get('code')
                # Do not include server-returned echoes: could contain credentials.
                raise ApiError(f'API业务代码 {code} ({path})')
            data=obj.get('data')
            if data is None: raise ApiError(f'API返回空数据 ({path})')
            return data
        except (requests.RequestException, ValueError) as e:
            if n == attempts-1: raise ApiError(f'接口超时/不可用 ({path}), {type(e).__name__}') from None
            time.sleep(1.2*(n+1))
    raise AssertionError('unreachable')

def trading_date(ms):
    return datetime.fromtimestamp(int(ms)/1000, TZ).strftime('%Y-%m-%d')

def since_ms(day):
    return int(datetime.combine(day,datetime.min.time(),tzinfo=TZ).timestamp()*1000)

def last_window(rows,n=10):
    return sorted(set(rows))[-n:]

def latest_close_bar(code, start, end):
    d=client_get('/api/a-share-index/prices/historical',{'thscode':code,'interval':'1d','start':start,'end':end})
    return [{'date':trading_date(r['date_ms']),'close':num(r.get('close_price')),'turnover':num(r.get('turnover'))}
            for r in d.get('item',[]) if r.get('date_ms') is not None]

def num(x):
    try:
        if x is None or pd.isna(x): return None
        x=float(x)
        if x==float('inf') or x==-float('inf'): return None
        return x
    except (TypeError,ValueError): return None

def series_returns(bars,dates):
    by={b['date']:b for b in bars}
    out=[]
    # Compute each return from prior valid day, including one lookback before window.
    keys=sorted(by)
    for d in dates:
        prev=next((k for k in reversed(keys) if k<d),None)
        a=by.get(d); b=by.get(prev) if prev else None
        close=a.get('close') if a else None
        pclose=b.get('close') if b else None
        change=round(100*(close/pclose-1),3) if close is not None and pclose and pclose>0 else None
        out.append({'date':d,'close':close,'pct':change,'turnover':a.get('turnover') if a else None})
    return out

def load_last10_dump():
    d=client_get('/api/dump/market-dumps/daily-k-10d/download-url')
    url=d.get('presigned_url')
    if not url or urlparse(url).scheme!='https': raise ApiError('全市场10日数据下载地址缺失')
    # Never print, persist or commit the presigned URL.
    with tempfile.NamedTemporaryFile(suffix='.parquet',delete=False) as tmp:
        name=tmp.name
        try:
            with requests.get(url,headers=HEADERS,stream=True,timeout=(20,160)) as response:
                response.raise_for_status()
                for chunk in response.iter_content(1024*1024):
                    if chunk: tmp.write(chunk)
        except Exception:
            Path(name).unlink(missing_ok=True)
            raise ApiError('10日Parquet下载失败；已有汇总文件保持不变') from None
    try:
        df=pd.read_parquet(name)
    finally:
        Path(name).unlink(missing_ok=True)
    needed={'thscode','date_ms','close_price','turnover'}
    if not needed.issubset(df.columns): raise ApiError('Parquet字段发生变化，需人工检查Schema')
    df=df[['thscode','date_ms','close_price','turnover']].copy()
    df['date']=pd.to_datetime(df['date_ms'],unit='ms',utc=True).dt.tz_convert('Asia/Shanghai').dt.strftime('%Y-%m-%d')
    df=df.drop_duplicates(['thscode','date'],keep='last').sort_values(['thscode','date'])
    df['return_pct']=df.groupby('thscode')['close_price'].pct_change(fill_method=None)*100
    return df

def calculate_market(df,dates):
    out=[]
    for dt in dates:
        s=df.loc[df.date==dt]
        returns=s['return_pct'].dropna()
        turnover=float(s['turnover'].fillna(0).sum()) if len(s) else None
        # No false breadth values on first date, when prior close is missing.
        valid=len(returns)
        out.append({'date':dt,'samples':int(len(s)),'return_samples':int(valid),
          'up':int((returns>0).sum()) if valid else None,
          'down':int((returns<0).sum()) if valid else None,
          'flat':int((returns==0).sum()) if valid else None,
          'median':round(float(returns.median()),3) if valid else None,
          'turnover_100m':round(turnover/1e8,2) if turnover is not None else None})
    return out

def market_style(df,limits,dates):
    upmap={d:[x for x in limits if x['date']==d and not x.get('is_st')] for d in dates}
    out=[]
    for dt in dates:
        s=df.loc[df.date==dt].copy()
        s['close_price']=pd.to_numeric(s['close_price'],errors='coerce')
        s['return_pct']=pd.to_numeric(s['return_pct'],errors='coerce')
        price_bins=[(-float('inf'),5,'≤5元'),(5,10,'5–10元'),(10,20,'10–20元'),(20,50,'20–50元'),(50,float('inf'),'＞50元')]
        for low,high,label in price_bins:
            ss=s[(s.close_price>low)&(s.close_price<=high)]
            changes=ss.return_pct.dropna()
            out.append({'date':dt,'dimension':'价格分档','group':label,'sample':int(len(ss)),
                        'median_pct':round(float(changes.median()),3) if len(changes) else None,
                        'up_ratio':round(float((changes>0).mean())*100,2) if len(changes) else None,
                        'limit_up':sum(1 for x in upmap[dt] if x['thscode'] in set(ss.thscode))})
        # Listing-board-based regime proxy: excludes ST/new-unrestricted and exceptions.
        for label,prefix in [('10cm主板',('60','00')),('20cm创业/科创',('30','68')),('30cm北交所',('8','4','92'))]:
            ids=set(s.loc[s.thscode.astype(str).str.startswith(prefix),'thscode'])
            subset=s[s.thscode.isin(ids)]
            changes=subset.return_pct.dropna()
            out.append({'date':dt,'dimension':'交易制度代理','group':label,'sample':int(len(subset)),
                        'median_pct':round(float(changes.median()),3) if len(changes) else None,
                        'up_ratio':round(float((changes>0).mean())*100,2) if len(changes) else None,
                        'limit_up':sum(1 for x in upmap[dt] if x['thscode'] in ids)})
    return out

def get_limit_pool(dt):
    date_ms=since_ms(datetime.strptime(dt,'%Y-%m-%d').date())
    vals=[];seen=set()
    for page in range(1,100):
        d=client_get('/api/a-share/special-data/limit-up-pool',
                     {'date_ms':date_ms,'page':page,'size':100,'sort_field':'continue_day_cnt','sort_dir':'desc'})
        chunk=d.get('item') or []
        for x in chunk:
            code=x.get('thscode')
            if not code or code in seen: continue
            seen.add(code)
            vals.append({'date':dt,'thscode':code,'name':x.get('name') or code,
                'is_st':bool(x.get('is_st')),'is_new':bool(x.get('is_new')),
                'boards':int(x.get('continue_day_cnt') or 1),
                'reason':x.get('limit_up_reason') or '原因未披露',
                'price':num(x.get('last_price')),
                'limit_up_time':x.get('limit_up_time'),
                'seal_money':num(x.get('seal_money')),
                'max_seal_money':num(x.get('max_seal_money')),
                'price_change_ratio_pct':num(x.get('price_change_ratio_pct')),
                'continue_day_text':x.get('continue_day_text')})
        pg=d.get('pagination') or {}
        if page >= pg.get('pages',100) or len(chunk)<100: break
    return vals

def run():
    start_time=time.time()
    # Auth first, minimal request; never log key.
    client_get('/api/a-share/prices/snapshot',{'thscodes':'600519.SH'})
    old=json.loads(OUTPUT.read_text('utf-8')) if OUTPUT.exists() else {}
    problems=[]
    # Market dump is a best-effort dataset on first run. Subsequent loss of a
    # previously working critical source must not replace complete data.
    try:
        stockdf=load_last10_dump()
        all_dates=sorted(stockdf.date.unique())
        if len(all_dates)<5: raise ApiError('全市场10日数据少于5个交易日')
        dates=last_window(all_dates,10)
    except Exception as exc:
        stockdf=None
        problems.append('全市场10日Parquet不可用：'+str(exc))
        # Reuse known dates only, never inject calendar weekdays that could be holidays.
        dates=last_window(old.get('dates') or [],10)
    if stockdf is None and old.get('coverage',{}).get('stock_days',0)>=9:
        raise ApiError('全市场行情关键源本次失败，保留上一份成功发布的数据')
    t=datetime.now(TZ).date(); back=t-timedelta(days=50)
    begin,end=since_ms(back),since_ms(t+timedelta(days=1))-1
    indices=[]; hist_date_set=set(dates)
    for name,code in INDEX_CODES.items():
        try:
            bars=latest_close_bar(code,begin,end)
            indices.append({'name':name,'code':code,'bars':bars})
            hist_date_set.update(x['date'] for x in bars)
        except Exception:
            problems.append(f'指数{name}暂未取得完整日线')
    if not dates:
        dates=last_window(hist_date_set,10)
    if not dates:
        raise ApiError('不能确定交易日时间轴，拒绝生成错误版本')
    output_indices=[{'name':x['name'],'code':x['code'],'points':series_returns(x['bars'],dates)} for x in indices]
    sectors=[]
    catalogs=[]
    for tag in ['industry','cn_concept']:
        try:
            d=client_get('/api/a-share-index/catalog/ths-index-list',{'tag':tag})
            catalogs += [{'name':x.get('name') or x['thscode'],'code':x['thscode'],'tag':tag} for x in d.get('item',[]) if x.get('thscode')]
        except Exception:
            problems.append(f'{tag}指数目录当前不可用')
    catalogs=list({x['code']:x for x in catalogs}.values())
    if MAX_INDICES and len(catalogs)>MAX_INDICES:
        problems.append(f'主动限制板块请求至{MAX_INDICES}个，其余将显示缺失')
        catalogs=catalogs[:MAX_INDICES]
    def load_sector(x):
        try:
            bars=latest_close_bar(x['code'],begin,end)
            return {'name':x['name'],'code':x['code'],'tag':x['tag'],'points':series_returns(bars,dates)}
        except Exception:
            return {'name':x['name'],'code':x['code'],'tag':x['tag'],'points':[]}
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as exe:
        sectors=list(exe.map(load_sector,catalogs))
    sector_ok=sum(any(pt['pct'] is not None for pt in s['points']) for s in sectors)
    if sector_ok<len(sectors):problems.append(f'{len(sectors)-sector_ok}个板块未成功返回日线')
    # Query only available actual trading dates, no weekends invented.
    limits=[]
    successful_limit_days=set()
    for dt in dates:
        try:
            limits.extend(get_limit_pool(dt))
            successful_limit_days.add(dt)
        except Exception:
            problems.append(f'{dt}涨停池不可用')
    limits=list({(x['date'],x['thscode']):x for x in limits}.values())
    # Map limit-ups into industry indices using today's constituent list.
    # This is explicitly a CURRENT-membership historical attribution proxy, not
    # a point-in-time constituent history and not usable for precise backtests.
    codes_by_day=defaultdict(set)
    for x in limits:
        if not x.get('is_st'):
            codes_by_day[x['date']].add(x['thscode'])
    def industry_constituents(sec):
        try:
            d=client_get('/api/a-share-index/constituents/ths-stock-list',{'thscode':sec['code']})
            return sec['code'],{x['thscode'] for x in d.get('item',[]) if x.get('thscode')}
        except Exception:
            return sec['code'], None
    industry_sectors=[s for s in sectors if s['tag']=='industry']
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as exe:
        constituents=dict(exe.map(industry_constituents,industry_sectors))
    for sec in sectors:
        ids=constituents.get(sec['code'])
        for pt in sec['points']:
            pt['limit_up_proxy']=len(ids & codes_by_day[pt['date']]) if ids is not None and pt['date'] in successful_limit_days else None
    market=calculate_market(stockdf,dates) if stockdf is not None else []
    styles=market_style(stockdf,limits,dates) if stockdf is not None else []
    # Recover earliest-day market breadth from the earlier run's history: the 10d
    # dump lacks the preceding close required for returns on its first day.
    history_dir=OUTPUT.parent/'history'
    history_cache={}
    for dt in dates:
        file=history_dir/(dt+'.json')
        if file.exists():
            try: history_cache[dt]=json.loads(file.read_text('utf-8'))
            except (ValueError,OSError): pass
    for row in market:
        previous=(history_cache.get(row['date']) or {}).get('market') or {}
        if row.get('up') is None and previous.get('up') is not None:
            for k in ['up','down','flat','return_samples','median']:
                row[k]=previous.get(k)
    if styles:
        old_style={(x.get('date'),x.get('dimension'),x.get('group')):x
                   for h in history_cache.values() for x in h.get('styles',[])}
        for row in styles:
            oldrow=old_style.get((row.get('date'),row.get('dimension'),row.get('group')),{})
            for field in ['median_pct','up_ratio']:
                if row.get(field) is None and oldrow.get(field) is not None:
                    row[field]=oldrow[field]
    limit_rows=[]
    for d in dates:
        a=[x for x in limits if x['date']==d]
        limit_rows.append({'date':d,'total':len(a) if d in successful_limit_days else None,
                           'non_st':sum(not x['is_st'] for x in a) if d in successful_limit_days else None,
                           'first':sum(x['boards']==1 and not x['is_st'] for x in a) if d in successful_limit_days else None,
                           'continued':sum(x['boards']>=2 and not x['is_st'] for x in a) if d in successful_limit_days else None,
                           'highest':max((x['boards'] for x in a if not x['is_st']),default=None)})
    cov={'stock_days':len(market),'index_count':len(output_indices),'sector_count':len(sectors),
         'sector_success':sector_ok,'limit_days':len(successful_limit_days),
         'requested_days':10, 'industry_limit_mapping':'最新行业成分股归因代理（历史成分变化未回溯）',
         'features_unavailable':['真实跌停池','真实炸板池','全市场主力资金净流入','流通市值分档','完整上市年限']}
    payload={'status':'live' if not problems else 'partial','source':'hithink-finance','generated_at':datetime.now(TZ).isoformat(),
       'latest_date':dates[-1], 'dates':dates,'indices':output_indices,'market':market,'sectors':sectors,
       'styles':styles,'limits':limit_rows,'stock_list':limits[-2500:],'coverage':cov,
       'warnings':problems[:18]+['未接入的资金/跌停/炸板等指标明确留空；没有构造替代值。']}
    # Final conservative validation before publish.
    assert len(dates)==len(set(dates)) and dates==sorted(dates)
    assert all(s.get('points') is not None for s in sectors)
    if not output_indices and not market:
        raise ApiError('没有任何有效指数或市场行情，保留旧报告')
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w',dir=OUTPUT.parent,encoding='utf-8',suffix='.tmp',delete=False) as f:
        json.dump(payload,f,ensure_ascii=False,separators=(',',':'),allow_nan=False)
        temp=f.name
    os.replace(temp,OUTPUT)
    # Preserve each day independently; the UI still defaults to the latest 10 trading days.
    history_dir=OUTPUT.parent/'history'
    history_dir.mkdir(parents=True,exist_ok=True)
    for d in dates:
        day={'date':d,'generated_at':payload['generated_at'],
             'market':next((x for x in market if x['date']==d),None),
             'limits':next((x for x in limit_rows if x['date']==d),None),
             'indices':[{'name':x['name'],'code':x['code'],**next((pt for pt in x['points'] if pt['date']==d),{})}
                        for x in output_indices],
             'sectors':[{'name':x['name'],'code':x['code'],'tag':x['tag'],
                         **next((pt for pt in x['points'] if pt['date']==d),{})} for x in sectors],
             'styles':[x for x in styles if x['date']==d]}
        target=history_dir/(d+'.json')
        # Merge completed old observations when a later API run is partial.
        if target.exists():
            prev=json.loads(target.read_text('utf-8'))
            if day['market'] is None:day['market']=prev.get('market')
            if day['limits'] is None or day['limits'].get('total') is None:day['limits']=prev.get('limits')
            for field,key in [('indices','code'),('sectors','code'),('styles','group')]:
                new_rows=day.get(field,[]);old_rows=prev.get(field,[])
                seen={(r.get(key),r.get('dimension')):r for r in old_rows}
                for row in new_rows:
                    k=(row.get(key),row.get('dimension'))
                    if k in seen:
                        oldrow=seen[k]
                        seen[k]={z:(v if v is not None else oldrow.get(z)) for z,v in {**oldrow,**row}.items()}
                    else:seen[k]=row
                day[field]=list(seen.values())
        temp_path=target.with_suffix('.tmp')
        temp_path.write_text(json.dumps(day,ensure_ascii=False,separators=(',',':'),allow_nan=False),encoding='utf-8')
        temp_path.replace(target)
    print(json.dumps({'status':payload['status'],'date':dates[-1],'days':len(dates),
                      'indices':len(output_indices),'sectors':sector_ok,'limit_rows':len(limits),
                      'duration_sec':round(time.time()-start_time)},ensure_ascii=False))

if __name__=='__main__':
    run()

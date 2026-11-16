"""Dated macro/risk observations. No credentials or current snapshots backfilled.
Public Eastmoney fields verified against its public page scripts on 2026-11-15:
https://data.eastmoney.com/newstatic/js/cjsj/zmgzsyl.js
https://data.eastmoney.com/newstatic/js/shibor/shibor.js
https://data.eastmoney.com/newstatic/js/rzrq/detail.js
Universe contract: https://fuyao.aicubes.cn/docs/api-reference/ticker-list/
These are secondary observations, not official-exchange independently reconciled values.
Missing margin rows are NOT zero and do not establish non-eligibility or safety.
"""
from __future__ import annotations
import argparse, json, math, os, re, time
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from zoneinfo import ZoneInfo
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/data/risk-observer.json'
EM='https://datacenter-web.eastmoney.com/api/data/v1/get'
MARGIN_URL='https://data.eastmoney.com/rzrq/detail.html'
TZ=ZoneInfo('Asia/Shanghai')

def number(x):
    if isinstance(x,bool): return None
    try:
        v=float(x)
        return v if math.isfinite(v) else None
    except (TypeError,ValueError): return None

def day(x):
    try:
        d=date.fromisoformat(str(x)[:10])
        return d.isoformat() if date(2000,1,1)<=d<=datetime.now(TZ).date() else None
    except ValueError:return None

def fetch_report(report,sort,filters='',pagesize=500,max_pages=30,first_page_only=False):
    rows=[]; expected=None
    for page in range(1,max_pages+1):
        columns='DATE,SECUCODE,SCODE,SECNAME,RZYE,RZMRE,RZCHE,RZJME5D,RZYEZB,ZDF' if report=='RPTA_WEB_RZRQ_GGMX' else 'ALL'
        params={'reportName':report,'columns':columns,'sortColumns':sort,'sortTypes':'-1,1' if ',' in sort else -1,'pageNumber':page,'pageSize':pagesize}
        if filters:params['filter']=filters
        req=Request(EM+'?'+urlencode(params),headers={'User-Agent':'a-share-observer/1.0'})
        with urlopen(req,timeout=45) as response: obj=json.load(response)
        result=obj.get('result') or {}
        if obj.get('success') is False and obj.get('code')==9201 and obj.get('message')=='返回数据为空':
            if page==1 and not rows:return []
            raise ValueError('Incomplete report: empty subsequent page')
        if obj.get('success') is not True or not isinstance(result.get('data'),list):raise ValueError('Report unavailable: '+report)
        expected=int(result.get('pages',1))
        if expected>max_pages and not first_page_only:raise ValueError('Report pagination exceeds bounded limit: '+report)
        rows.extend(result['data'])
        if first_page_only or page>=expected:break
        time.sleep(.25)
    if not first_page_only and expected and len(rows)!=int(result.get('count',len(rows))):raise ValueError('Incomplete report row count')
    return rows

def series(rows,field,label,identity,url,datefield='SOLAR_DATE'):
    data={}
    for r in rows:
        d=day(r.get(datefield));v=number(r.get(field))
        if d and v is not None and -5<v<35:data[d]={'date':d,'value':v}
    return {'id':identity,'label':label,'unit':'%','source':'东方财富公开数据（转载）','source_url':url,
            'publication_time_verified':False,'rows':[data[k] for k in sorted(data)]}

def parse_macro(treasury,shibor):
    result=[series(treasury,'EMM00588704','中国国债2年收益率','cgb_2y','https://data.eastmoney.com/cjsj/zmgzsyl.html'),series(treasury,'EMM00166466','中国国债10年收益率','cgb_10y','https://data.eastmoney.com/cjsj/zmgzsyl.html')]
    for ident,label,key in [('001','Shibor隔夜','shibor_on'),('101','Shibor1周','shibor_1w')]:
        rows=[r for r in shibor if r.get('MARKET_CODE')=='001' and r.get('CURRENCY_CODE')=='CNY' and r.get('INDICATOR_ID')==ident]
        result.append(series(rows,'IR_RATE',label,key,'https://data.eastmoney.com/shibor/shibor.aspx','REPORT_DATE'))
    return result

def merge_macro_history(prior, incoming):
    """Append dated observations; reject revisions until explicitly reviewed.

    Keep provenance/backfill metadata and never mutate input records. This is
    shared by normal refreshes so a later run cannot silently undo the backfill.
    """
    old = {item['id']: item for item in prior}
    result = []
    for item in incoming:
        previous = old.pop(item['id'], None)
        if previous and previous.get('unit') != item.get('unit'):
            raise ValueError('Macro unit conflict: ' + item['id'])
        rows = {row['date']: row for row in (previous or {}).get('rows', [])}
        for row in item['rows']:
            if row['date'] in rows and rows[row['date']]['value'] != row['value']:
                raise ValueError('Macro historical conflict: ' + item['id'] + ' ' + row['date'])
            if row['date'] not in rows:
                rows[row['date']] = row
        result.append({**(previous or {}), **item, 'rows': [rows[d] for d in sorted(rows)]})
    return result + list(old.values())


def check(ident,label,value,unit,detail,status='observed'):
    return {'id':ident,'label':label,'status':status if value is not None else 'missing','value':value,'unit':unit,'detail':detail,'source':'东方财富转载交易所融资融券数据','source_url':MARGIN_URL}

def margin_observation(row):
    d=day(row.get('DATE'));code=str(row.get('SECUCODE') or '')
    if not d or not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',code):return None
    balance=number(row.get('RZYE'));buy=number(row.get('RZMRE'));repay=number(row.get('RZCHE'))
    if balance is None or balance<0:return None
    net=buy-repay if buy is not None and repay is not None and buy>=0 and repay>=0 else None
    pct=number(row.get('ZDF')); ratio=number(row.get('RZYEZB'));net5=number(row.get('RZJME5D'))
    if ratio is not None and not 0<=ratio<=100:ratio=None
    checks=[check('financing_balance','融资余额',round(balance/1e8,4),'亿元','未偿还融资头寸，不代表新增资金或全部散户资金。'),
      check('financing_net_buy','融资净买入',round(net/1e4,2) if net is not None else None,'万元','融资买入额减偿还额；不是主力资金流入。'),
      check('financing_net_5d','近5日融资净买入',round(net5/1e4,2) if net5 is not None else None,'万元','数据源提供的近5个交易日累计值；不推断未来股价。'),
      check('financing_ratio','融资余额/流通市值',ratio,'%','按数据源流通市值口径；数值高低不是通用买卖阈值。'),
      check('daily_change','当日价格波动',pct,'%','|涨跌幅|≥5%仅为波动提示，不是涨跌停判定或投资建议。','triggered' if pct is not None and abs(pct)>=5 else 'not_triggered')]
    return code,{'date':d,'checks':checks}

def build(universe,margin,macro,prior=None,complete=True):
    now=datetime.now(TZ).isoformat();prior=prior or {}; by={}
    for stock in prior.get('stocks',[]):
        by[stock['code']]={o['date']:o for o in stock.get('observations',[]) if day(o.get('date'))}
    for r in margin:
        parsed=margin_observation(r)
        if parsed:
            code,obs=parsed
            existing=by.setdefault(code,{}).get(obs['date'])
            if existing:
                old={c['id']:c for c in existing.get('checks',[])}
                obs['checks']=[old.get(c['id'],c) if c['value'] is None else c for c in obs['checks']]
            by[code][obs['date']]=obs
    stocks=[]
    seen=set()
    for m in universe:
        code=m.get('thscode') or m.get('code');name=m.get('name')
        if not code or not name:continue
        if not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',str(code)):raise ValueError('Invalid universe code')
        if code in seen:raise ValueError('Duplicate universe code')
        seen.add(code)
        obs=[by[code][d] for d in sorted(by.get(code,{}))]
        stocks.append({'code':code,'name':name,'observations':obs,'margin_status':'observed' if obs else 'missing','margin_note':'未取得融资记录不等于无风险，也不证明当前非两融标的。','unsupported':['convertible','credit_events','otc','warrants']})
    for old in prior.get('stocks',[]):
        if old['code'] not in seen and prior.get('universe',{}).get('complete'): stocks.append({**old,'in_current_universe':False})
    latest=max((x['date'] for s in stocks for x in s['observations']),default=None)
    return {'schema_version':1,'updated_at':now,'as_of':latest,'universe':{'source':'同花顺代码表' if complete else '部分融资证券代码表','date':now[:10],'complete':complete,'count':len(universe),'historical_membership':False},'stocks':stocks,'macro':macro,'limits':['融资与利率数据为盘后或定时披露，实际历史发布时间未核验，不用于无前视回测。','代码表为当前快照，不用于还原历史上市名单。','可转债关联、公司信用事件、权证及OTC风险未接入，不能视为已经检查通过。']}

def load_universe():
    import update as api
    result=[]
    for offset in range(0,30000,10000):
        obj=api.client_get('/api/meta/tickers/list',{'asset_type':'a-share','limit':10000,'offset':offset})
        rows=obj.get('item',[])
        if not isinstance(rows,list):raise ValueError('Invalid ticker universe')
        result.extend(r for r in rows if r.get('asset_type')=='a-share')
        if len(rows)<10000:break
    else:raise ValueError('Universe pagination incomplete')
    if len(result)<4000:raise ValueError('Incomplete A-share universe')
    return result

def atomic_json(file,obj):
    tmp=file.with_suffix('.tmp');tmp.write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n');tmp.replace(file)

CB_URL='https://data.eastmoney.com/kzz/default.html'
PLEDGE_URL='https://data.eastmoney.com/gpzy/pledgeRatio.aspx'
CHANGES_URL='https://data.eastmoney.com/executive/gdzjc.html'

def scheduled_day(value):
    """Contract dates may be future; these are announced schedules, never future observations."""
    try:
        d=date.fromisoformat(str(value)[:10])
        return d.isoformat() if date(2000,1,1)<=d<=date(2100,1,1) else None
    except ValueError:return None

def enrich(result, bonds, pledges, changes, window_start, failures=None, prior=None):
    today=datetime.now(TZ).date().isoformat(); failures=failures or {}; prior=prior or {}
    old_stocks={s['code']:s for s in prior.get('stocks',[])}
    result['supplemental_sources']={k:{'status':'unavailable' if k in failures else 'observed','fetched_at':result['updated_at'],'error':failures.get(k),'coverage':'current_snapshot' if k!='changes' else 'recent_90_calendar_days','publication_time_verified':False} for k in ['bonds','pledges','changes']}
    stocks={s['code']:s for s in result['stocks']}; short={c[:6]:c for c in stocks}
    for s in stocks.values():
        s['supplemental']={'pledge':{'status':'missing','as_of':None,'ratio':None,'source':'东方财富转载中国结算','source_url':PLEDGE_URL},
            'convertibles':{'observed_at':today,'coverage':'unavailable' if 'bonds' in failures else 'current_snapshot','bonds':[]},
            'shareholder_changes':{'window_start':window_start,'observed_at':today,'coverage':'unavailable' if 'changes' in failures else 'partial'}}
        s['events']=[];s['events_coverage']={'start':window_start,'end':today,'status':'partial','note':'仅含已接入源的已披露股东增减持与可转债赎回公告；非风险事件穷尽清单。','failures':failures}
    for row in pledges:
        code=row.get('SECUCODE');d=day(row.get('TRADE_DATE'));v=number(row.get('PLEDGE_RATIO'))
        if code in stocks and d and v is not None and 0<=v<=100:
            age=(date.fromisoformat(today)-date.fromisoformat(d)).days
            stocks[code]['supplemental']['pledge'].update(status='stale' if age>14 else 'observed',as_of=d,ratio=v,age_days=age,note='来源逐股最新可得记录，日期可能较旧；超过14自然日标旧值，不表示当前质押水平。')
    for row in bonds:
        code=short.get(row.get('CONVERT_STOCK_CODE'));issued=day(row.get('PUBLIC_START_DATE'));delisted=day(row.get('DELIST_DATE'))
        if code not in stocks or not issued:continue
        bondcode=str(row.get('SECURITY_CODE',''))
        if not re.fullmatch(r'\d{6}',bondcode):continue
        notice=day(row.get('NOTICE_DATE_SH')); redemption=scheduled_day(row.get('EXECUTE_START_DATESH'))
        # Keep only currently listed/issued bonds in the current snapshot. Historical redemption events remain separately dated.
        maturity=scheduled_day(row.get('EXPIRE_DATE'))
        if not delisted and (not maturity or maturity>=today):
            stocks[code]['supplemental']['convertibles']['bonds'].append({'code':bondcode,'name':row.get('SECURITY_NAME_ABBR'),'listed_on':scheduled_day(row.get('LISTING_DATE')),'matures_on':scheduled_day(row.get('EXPIRE_DATE')),'conversion_start':scheduled_day(row.get('TRANSFER_START_DATE')),'conversion_end':scheduled_day(row.get('TRANSFER_END_DATE')),'redemption_notice_date':notice,'redemption_date':redemption,'source_url':CB_URL,'note':'当前条款快照；原始转股价格不是当前转股价，不展示未经核验的价格或强赎触发概率。'})
        if notice and notice>=window_start:
            stocks[code]['events'].append({'date':notice,'type':'convertible_redemption','title':str(row.get('SECURITY_NAME_ABBR') or bondcode)+'赎回公告','source':'东方财富可转债资料','source_url':CB_URL,'detail':'赎回安排以发行人公告为准；不表示正股必然下跌。','event_date':redemption})
    for row in changes:
        code=short.get(row.get('SECURITY_CODE'));d=day(row.get('NOTICE_DATE'));v=number(row.get('CHANGE_NUM'));direction=row.get('DIRECTION')
        if code not in stocks or not d or d<window_start or direction not in ['增持','减持']:continue
        stocks[code]['events'].append({'date':d,'type':'shareholder_change','title':'股东'+direction+'披露','source':'东方财富股东增减持','source_url':CHANGES_URL,'detail':str(row.get('HOLDER_NAME') or '股东')+'；已披露变动，不等于未来计划。','shares_10k':v,'event_date':day(row.get('END_DATE')),'event_start':day(row.get('START_DATE')),'direction':direction})
    for s in stocks.values():
        old=old_stocks.get(s['code'],{})
        for source,section in [('bonds','convertibles'),('pledges','pledge'),('changes','shareholder_changes')]:
            current=s['supplemental'][section]
            if source in failures and old.get('supplemental',{}).get(section):
                current=dict(old['supplemental'][section]);current['status']='stale';s['supplemental'][section]=current
            else:current.setdefault('status','unavailable' if source in failures else 'observed')
            current.update(last_attempt_at=result['updated_at'],error=failures.get(source),publication_time_verified=False)
            if source not in failures:current['fetched_at']=result['updated_at']
        if failures:
            for event in old.get('events',[]):
                key='bonds' if event.get('type')=='convertible_redemption' else 'changes'
                if key in failures and day(event.get('date')) and event['date']>=window_start:s['events'].append({**event,'stale':True})
        s['events'].sort(key=lambda e:e['date'],reverse=True)
    return result

def optional_reports(start):
    data={};failures={}
    queries={'bonds':('RPT_BOND_CB_LIST','SECURITY_CODE','',5),'pledges':('RPT_CSDC_LIST_NEWEST','SECURITY_CODE','',15),'changes':('RPT_SHARE_HOLDER_INCREASE','NOTICE_DATE,SECURITY_CODE',f"(NOTICE_DATE>='{start}')",20)}
    for key,(report,sort,filters,limit) in queries.items():
        try:data[key]=fetch_report(report,sort,filters,500,limit)
        except Exception as exc:
            data[key]=[];failures[key]=type(exc).__name__+': source unavailable; not zero or safe'
    return data,failures

def fetch_margin_window(latest,initial=True):
    """Bounded daily requests avoid giant pagination and preserve exchange-specific dates."""
    rows=[]
    for ago in range(14 if initial else 3):
        d=(date.fromisoformat(latest)-timedelta(days=ago)).isoformat()
        rows.extend(fetch_report('RPTA_WEB_RZRQ_GGMX','DATE,SCODE',f"(DATE='{d}')",500,12))
    return rows

def main():
    p=argparse.ArgumentParser();p.add_argument('--partial-universe',action='store_true');args=p.parse_args()
    # Keep the established archive horizon, not a rolling 45-day initial snapshot.
    start='2026-06-10'
    treasury=fetch_report('RPTA_WEB_TREASURYYIELD','SOLAR_DATE',f"(SOLAR_DATE>='{start}')",500,6)
    shibor=fetch_report('RPT_IMP_INTRESTRATEN','REPORT_DATE',f"(MARKET_CODE=\"001\")(CURRENCY_CODE=\"CNY\")(REPORT_DATE>='{start}')",500,6)
    latest=day(fetch_report('RPTA_WEB_RZRQ_GGMX','DATE','',1,1,True)[0].get('DATE'))
    if not latest:raise ValueError('Invalid newest margin date')
    previous_index=json.loads(OUT.read_text()) if OUT.exists() else {}
    initial=not previous_index.get('margin_history_initialized')
    margin=fetch_margin_window(latest,initial=initial)
    if not any(day(row.get('DATE'))==latest and margin_observation(row) for row in margin):
        raise ValueError('Latest margin snapshot absent; keeping previous data and initialization state')
    keys=[(r.get('DATE'),r.get('SECUCODE')) for r in margin]
    if len(set(keys))!=len(keys):raise ValueError('Duplicate margin rows in pagination')
    if args.partial_universe:
        universe=list({r['SECUCODE']:{'code':r['SECUCODE'],'name':r['SECNAME']} for r in margin if re.fullmatch(r'(?:6\d{5}\.SH|[03]\d{5}\.SZ|[489]\d{5}\.BJ)',str(r.get('SECUCODE','')))}.values())
    else:universe=load_universe()
    prior=json.loads(OUT.read_text()) if OUT.exists() else {}
    for stock in prior.get('stocks',[]):
        if not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',str(stock.get('code',''))):raise ValueError('Invalid prior code')
        path=OUT.parent/'risk-stocks'/(stock['code']+'.json')
        if path.exists():
            detail=json.loads(path.read_text())
            for key in ['observations','supplemental','events']:stock[key]=detail.get(key,[] if key!='supplemental' else {})
    macro=parse_macro(treasury,shibor)
    macro=merge_macro_history(prior.get('macro',[]), macro)
    result=build(universe,margin,macro,prior=prior,complete=not args.partial_universe)
    result['margin_history_initialized']=True
    current_codes={s['code'] for s in result['stocks']};coverage={}
    for row in margin:
        code=row.get('SECUCODE');d=day(row.get('DATE'))
        if code in current_codes and d:
            key=d+'|'+code[-2:];coverage[key]=coverage.get(key,0)+1
    result['margin_coverage']={'requested_start':(date.fromisoformat(latest)-timedelta(days=13 if initial else 2)).isoformat(),'requested_end':latest,'date_exchange_rows':coverage,'status':'observed_not_guaranteed_continuous','note':'各市场实际返回日期和条数；未返回日期/股票不等于零，不保证历史逐日完整。初次尝试14个自然日，此后3日刷新，停跑可能留空档。'}
    event_start=(datetime.now(TZ).date()-timedelta(days=90)).isoformat()
    extras,failures=optional_reports(event_start)
    enrich(result,extras['bonds'],extras['pledges'],extras['changes'],event_start,failures,prior)
    if not result['as_of'] or not all(s['rows'] for s in result['macro']):raise ValueError('Required observations absent; keeping previous file')
    from reviewed_evidence import compile_index
    evidence_path=OUT.parent/'reviewed-evidence.json'
    evidence=compile_index(json.loads(evidence_path.read_text())) if evidence_path.exists() else {'by_code':{}}
    for stock in result['stocks']:
        if evidence['by_code'].get(stock['code']):stock['reviewed_evidence']=evidence['by_code'][stock['code']]
    OUT.parent.mkdir(parents=True,exist_ok=True)
    details=OUT.parent/'risk-stocks';details.mkdir(exist_ok=True)
    for stock in result['stocks']:
        if not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',stock['code']):raise ValueError('Invalid code path')
        file=details/(stock['code']+'.json');atomic_json(file,stock)
        stock.pop('observations',None);stock.pop('events',None);stock.pop('supplemental',None);stock.pop('reviewed_evidence',None);stock['observations_url']='data/risk-stocks/'+stock['code']+'.json'
    atomic_json(OUT,result)
    atomic_json(OUT.parent/'risk-macro.json',{'updated_at':result['updated_at'],'macro':result['macro'],'limits':result['limits']})
    print(json.dumps({'stocks':len(result['stocks']),'as_of':result['as_of'],'macro_series':len(result['macro']),'complete_universe':result['universe']['complete']}))
if __name__=='__main__':main()

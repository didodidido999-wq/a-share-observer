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

def main():
    p=argparse.ArgumentParser();p.add_argument('--partial-universe',action='store_true');args=p.parse_args()
    start=(datetime.now(TZ).date()-timedelta(days=45)).isoformat()
    treasury=fetch_report('RPTA_WEB_TREASURYYIELD','SOLAR_DATE',f"(SOLAR_DATE>='{start}')",500,3)
    shibor=fetch_report('RPT_IMP_INTRESTRATEN','REPORT_DATE',f"(MARKET_CODE=\"001\")(CURRENCY_CODE=\"CNY\")(REPORT_DATE>='{start}')",500,3)
    latest=day(fetch_report('RPTA_WEB_RZRQ_GGMX','DATE','',1,1,True)[0].get('DATE'))
    if not latest:raise ValueError('Invalid newest margin date')
    # Exchanges can publish on different dates. Keep a bounded 3-calendar-day initial window; preserve accumulated history.
    since=(date.fromisoformat(latest)-timedelta(days=2)).isoformat()
    margin=fetch_report('RPTA_WEB_RZRQ_GGMX','DATE,SCODE',f"(DATE>='{since}')(DATE<='{latest}')",500,40)
    keys=[(r.get('DATE'),r.get('SECUCODE')) for r in margin]
    if len(set(keys))!=len(keys):raise ValueError('Duplicate margin rows in pagination')
    if args.partial_universe:
        universe=list({r['SECUCODE']:{'code':r['SECUCODE'],'name':r['SECNAME']} for r in margin if re.fullmatch(r'(?:6\d{5}\.SH|[03]\d{5}\.SZ|[489]\d{5}\.BJ)',str(r.get('SECUCODE','')))}.values())
    else:universe=load_universe()
    prior=json.loads(OUT.read_text()) if OUT.exists() else {}
    for stock in prior.get('stocks',[]):
        if not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',str(stock.get('code',''))):raise ValueError('Invalid prior code')
        path=OUT.parent/'risk-stocks'/(stock['code']+'.json')
        if path.exists():stock['observations']=json.loads(path.read_text()).get('observations',[])
    macro=parse_macro(treasury,shibor)
    old_macro={m['id']:m for m in prior.get('macro',[])}
    for m in macro:
        rows={x['date']:x for x in old_macro.get(m['id'],{}).get('rows',[])}
        rows.update({x['date']:x for x in m['rows']});m['rows']=[rows[k] for k in sorted(rows)]
    result=build(universe,margin,macro,prior=prior,complete=not args.partial_universe)
    if not result['as_of'] or not all(s['rows'] for s in result['macro']):raise ValueError('Required observations absent; keeping previous file')
    OUT.parent.mkdir(parents=True,exist_ok=True)
    details=OUT.parent/'risk-stocks';details.mkdir(exist_ok=True)
    for stock in result['stocks']:
        if not re.fullmatch(r'\d{6}\.(SH|SZ|BJ)',stock['code']):raise ValueError('Invalid code path')
        file=details/(stock['code']+'.json');atomic_json(file,stock)
        stock.pop('observations',None);stock['observations_url']='data/risk-stocks/'+stock['code']+'.json'
    atomic_json(OUT,result)
    atomic_json(OUT.parent/'risk-macro.json',{'updated_at':result['updated_at'],'macro':result['macro'],'limits':result['limits']})
    print(json.dumps({'stocks':len(result['stocks']),'as_of':result['as_of'],'macro_series':len(result['macro']),'complete_universe':result['universe']['complete']}))
if __name__=='__main__':main()

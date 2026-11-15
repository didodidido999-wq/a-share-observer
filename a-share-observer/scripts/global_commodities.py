"""EIA official XLS physical crude spot prices, with FRED same-source fallback.
EIA public reuse: https://www.eia.gov/about/copyrights_reuse.php
FRED series DCOILWTICO/DCOILBRENTEU identify EIA source, USD/barrel,
daily observations and Public Domain: Citation Requested. Historical exact
publication times are NOT supplied by CSV; observation date is not known-at.
"""
from __future__ import annotations
import argparse,csv,io,json,math,re
from datetime import date,datetime,timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request,urlopen
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/data/global/series'
START=date(2026,6,10)
ASSETS={
 'wti_spot':{'name':'WTI库欣原油现货','symbol':'DCOILWTICO','source':'https://www.eia.gov/dnav/pet/hist/RWTCD.htm'},
 'brent_spot':{'name':'Brent欧洲原油现货','symbol':'DCOILBRENTEU','source':'https://www.eia.gov/dnav/pet/hist/RBRTEd.htm'}
}

def parse_csv(text,symbol,start=START,today=None):
    today=today or datetime.now(timezone.utc).date();reader=csv.DictReader(io.StringIO(text))
    if reader.fieldnames!=['observation_date',symbol]:raise ValueError('Unexpected source columns; refusing ambiguous series')
    rows={}
    for raw in reader:
        try:d=date.fromisoformat(raw['observation_date'])
        except (ValueError,TypeError):raise ValueError('Invalid observation date') from None
        value=raw.get(symbol)
        if value in (None,'','.'):continue
        try:v=float(value)
        except ValueError:raise ValueError('Invalid observation price') from None
        if not math.isfinite(v):raise ValueError('Nonfinite price')
        # Negative spot oil is not impossible. No positive-only filtering or invented zero.
        if d>today:raise ValueError('Future observation in source')
        if d<start:continue
        key=d.isoformat()
        if key in rows and rows[key]!=v:raise ValueError('Conflicting duplicate observation')
        rows[key]=v
    if not rows:raise ValueError('No usable observations; refusing overwrite')
    return [{'date':d,'value':rows[d]} for d in sorted(rows)]

def release_date(html,today=None):
    today=today or datetime.now(timezone.utc).date()
    match=re.search(r'(?<!Next )Release Date:\s*(\d{1,2}/\d{1,2}/\d{4})',html)
    if not match:return None
    d=datetime.strptime(match.group(1),'%m/%d/%Y').date()
    if d>today:raise ValueError('Future release date')
    return d.isoformat()

def download(url):
    with urlopen(Request(url,headers={'User-Agent':'MarketScope/1.0 (daily public economic data)'}),timeout=40) as response:return response.read().decode('utf-8-sig')

def download_binary(url):
    with urlopen(Request(url,headers={'User-Agent':'MarketScope/1.0 (daily public economic data)'}),timeout=35) as response:return response.read()

def parse_xls(payload,asset_id,today=None):
    import xlrd
    book=xlrd.open_workbook(file_contents=payload);sheet=book.sheet_by_name('Data 1')
    expected='RWTC' if asset_id=='wti_spot' else 'RBRTE'
    title='Cushing, OK WTI Spot Price FOB (Dollars per Barrel)' if asset_id=='wti_spot' else 'Europe Brent Spot Price FOB (Dollars per Barrel)'
    if sheet.cell_value(1,0)!='Sourcekey' or sheet.cell_value(1,1)!=expected or sheet.cell_value(2,0)!='Date' or sheet.cell_value(2,1)!=title:raise ValueError('EIA XLS identity/unit contract mismatch')
    lines=['observation_date,'+ASSETS[asset_id]['symbol']]
    for i in range(3,sheet.nrows):
        d,v=sheet.cell_value(i,0),sheet.cell_value(i,1)
        if d in ('',None):continue
        if sheet.cell_type(i,0)!=xlrd.XL_CELL_DATE:raise ValueError('Invalid XLS date cell')
        day=xlrd.xldate_as_datetime(d,book.datemode).date().isoformat()
        lines.append(day+','+str(v))
    return parse_csv('\n'.join(lines),ASSETS[asset_id]['symbol'],today=today)

def atomic(file,obj):
    file.parent.mkdir(parents=True,exist_ok=True);tmp=file.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n');tmp.replace(file)

def collect_asset(asset_id,out=OUT,get=download,today=None,get_binary=None):
    today=today or datetime.now(timezone.utc).date();spec=ASSETS[asset_id];file=out/(asset_id+'.json')
    prior=json.loads(file.read_text()) if file.exists() else {}
    csv_url='https://fred.stlouisfed.org/graph/fredgraph.csv?'+urlencode({'id':spec['symbol'],'cosd':START.isoformat()})
    xls_url='https://www.eia.gov/dnav/pet/hist_xls/'+('RWTCd.xls' if asset_id=='wti_spot' else 'RBRTEd.xls')
    failures={};used=xls_url;route='eia_xls'
    try:rows=parse_xls((get_binary or download_binary)(xls_url),asset_id,today)
    except Exception as exc:
        failures['eia_xls']=type(exc).__name__+': '+str(exc)
        try:rows=parse_csv(get(csv_url),spec['symbol'],today=today);used=csv_url;route='fred_csv'
        except Exception as other:
            failures['fred_csv']=type(other).__name__+': '+str(other)
            raise ValueError('All price routes failed: '+json.dumps(failures)) from other
    released=None
    try:
        released=release_date(get(spec['source']),today)
        if released is None:failures['release_html']='Release date absent in retrieved page; publication date unknown'
    except Exception as exc:failures['release_html']=type(exc).__name__+': '+str(exc)
    if released is not None and rows[-1]['date']>released:raise ValueError('Observation newer than source release; sources out of sync')
    if released and prior.get('source_release_date') and released<prior['source_release_date']:raise ValueError('Source release date regressed')
    if prior and (prior.get('asset_id')!=asset_id or prior.get('symbol')!=spec['symbol']):raise ValueError('Prior file identity mismatch')
    if prior.get('rows') and max(r['date'] for r in prior['rows'])>rows[-1]['date']:raise ValueError('Source coverage regressed; retaining newer observations')
    old={r['date']:r for r in prior.get('rows',[])}
    old.update({r['date']:r for r in rows})
    result={'schema_version':1,'asset_id':asset_id,'name':spec['name'],'kind':'commodity_spot','unit':'美元/桶','symbol':spec['symbol'],
      'source':spec['source'],'source_name':'美国EIA官方XLS' if route=='eia_xls' else '美国EIA（FRED公开分发）','download_url':used,'acquisition_route':route,'acquisition_warnings':failures,'provider_page':'https://fred.stlouisfed.org/series/'+spec['symbol'],
      'cross_border_date_policy':'previous_date','market_timezone':None,'publication_timezone':'America/New_York','point_in_time_publication':'unverified',
      'source_release_date':released,'last_observation_date':max(old),'fetched_at':datetime.now(timezone.utc).isoformat(),
      'date_policy':'源日期为日频现货观察日期，不是交易所收盘或数据公布时刻；当前发布日不能回填历史公布时间。',
      'instrument_type':'physical_crude_spot','is_etf_proxy':False,'is_futures':False,
      'license':'EIA public information; cite source','license_url':'https://www.eia.gov/about/copyrights_reuse.php',
      'limits':['非实时、非期货结算价；不同现货基准有品质和地点差异。','空缺不插值、不当零；精确历史公布时刻未核验，不支持无前视交易回测。'],
      'rows':[old[k] for k in sorted(old)]}
    atomic(file,result);return result

def run(out=OUT,get=download,today=None):
    health={'schema_version':1,'attempted_at':datetime.now(timezone.utc).isoformat(),'assets':{}};success=0
    for asset in ASSETS:
        try:
            result=collect_asset(asset,out,get,today);success+=1
            health['assets'][asset]={'status':'observed','last_observation_date':result['last_observation_date'],'source_release_date':result['source_release_date'],'rows':len(result['rows']),'error':None,'route':result['acquisition_route'],'warnings':result['acquisition_warnings']}
        except Exception as exc:
            file=out/(asset+'.json');prior=json.loads(file.read_text()) if file.exists() else {}
            health['assets'][asset]={'status':'stale' if prior.get('rows') else 'unavailable','last_observation_date':prior.get('last_observation_date'),'error':type(exc).__name__+': '+str(exc)}
    health['status']='observed' if success==len(ASSETS) else 'partial' if success else 'failed'
    atomic(out.parent/'commodities-status.json',health)
    return health,0 if success else 1

def main():
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,default=OUT);args=p.parse_args();health,code=run(args.out);print(json.dumps(health,ensure_ascii=False));raise SystemExit(code)
if __name__=='__main__':main()

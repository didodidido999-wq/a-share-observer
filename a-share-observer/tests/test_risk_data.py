import importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('risk_data',Path(__file__).parents[1]/'scripts/risk_data.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)

def sample():
 return {'DATE':'2026-11-13 00:00:00','SECUCODE':'600000.SH','RZYE':100000000,'RZMRE':20000,'RZCHE':30000,'RZJME5D':-50000,'RZYEZB':3,'ZDF':-6}

def test_finite():
 assert r.number(None) is None and r.number(True) is None and r.number('nan') is None

def test_dated_signed_net():
 code,obs=r.margin_observation(sample());assert code=='600000.SH' and obs['date']=='2026-11-13'
 checks={c['id']:c for c in obs['checks']};assert checks['financing_net_buy']['value']==-1
 assert checks['daily_change']['status']=='triggered'

def test_missing_not_zero():
 s=sample();s.pop('RZCHE'); obs=r.margin_observation(s)[1]
 assert obs['checks'][1]['value'] is None and obs['checks'][1]['status']=='missing'

def test_code_invalid():
 s=sample();s['SECUCODE']='000001';assert r.margin_observation(s) is None

def test_missing_stock_not_safe():
 o=r.build([{'code':'600001.SH','name':'示例'}],[sample()],[])
 assert o['stocks'][0]['observations']==[] and o['stocks'][0]['margin_status']=='missing'

def test_macro_mapping_and_identity():
 out=r.parse_macro([{'SOLAR_DATE':'2026-11-13','EMM00166466':1.6,'EMM00588704':1.2}],[{'REPORT_DATE':'2026-11-13','MARKET_CODE':'001','CURRENCY_CODE':'USD','INDICATOR_ID':'001','IR_RATE':8}])
 assert out[1]['rows'][0]['value']==1.6 and out[2]['rows']==[]

def test_no_future():
 assert r.day('2099-01-01') is None

def test_name_universe_never_event_only():
 out=r.build([{'thscode':'600000.SH','name':'浦发银行'},{'thscode':'000001.SZ','name':'平安银行'}],[sample()],[])
 assert out['universe']['count']==2 and len(out['stocks'])==2

def test_first_page_query_does_not_download_history(monkeypatch):
 import io,json
 calls=[]
 def fake(req,timeout):
  calls.append(req.full_url)
  return io.BytesIO(json.dumps({'success':True,'result':{'pages':9999999,'data':[sample()]}}).encode())
 monkeypatch.setattr(r,'urlopen',fake)
 assert len(r.fetch_report('r','DATE',pagesize=1,max_pages=1,first_page_only=True))==1
 assert len(calls)==1

def test_keep_removed_stock_history():
 prior=r.build([{'code':'600000.SH','name':'示例'}],[sample()],[])
 after=r.build([{'code':'000001.SZ','name':'另一个'}],[],[],prior)
 old=next(s for s in after['stocks'] if s['code']=='600000.SH')
 assert len(old['observations'])==1 and old['in_current_universe'] is False

def test_missing_new_values_preserve_prior():
 prior=r.build([{'code':'600000.SH','name':'示例'}],[sample()],[])
 new=sample();new.pop('RZCHE')
 after=r.build([{'code':'600000.SH','name':'示例'}],[new],[],prior)
 assert after['stocks'][0]['observations'][0]['checks'][1]['value']==-1

def test_different_exchange_dates_never_shifted():
 a=sample();b={**sample(),'DATE':'2026-11-12','SECUCODE':'000001.SZ'}
 out=r.build([{'code':'600000.SH','name':'沪'},{'code':'000001.SZ','name':'深'}],[a,b],[])
 assert out['as_of']=='2026-11-13'
 assert out['stocks'][1]['observations'][0]['date']=='2026-11-12'

def test_partial_preview_universe_not_carried_into_full():
 prior=r.build([{'code':'510050.SH','name':'ETF'}],[],[],complete=False)
 out=r.build([{'code':'600000.SH','name':'股票'}],[sample()],[],prior,complete=True)
 assert [s['code'] for s in out['stocks']]==['600000.SH']

def test_supplemental_dates_missing_and_no_future():
 o=r.build([{'code':'600000.SH','name':'浦发'}],[],[])
 r.enrich(o,[],[{'SECUCODE':'600000.SH','TRADE_DATE':'2099-01-01','PLEDGE_RATIO':1}],[],'2026-08-01')
 assert o['stocks'][0]['supplemental']['pledge']['status']=='missing'
 assert o['stocks'][0]['events_coverage']['status']=='partial'
 assert o['stocks'][0]['events']==[]

def test_announced_schedule_is_not_future_observation():
 o=r.build([{'code':'600000.SH','name':'浦发'}],[],[])
 r.enrich(o,[{'CONVERT_STOCK_CODE':'600000','SECURITY_CODE':'110001','PUBLIC_START_DATE':'2025-01-01','EXPIRE_DATE':'2029-01-01','NOTICE_DATE_SH':'2026-11-01','EXECUTE_START_DATESH':'2026-12-01','TRANSFER_PRICE':999}],[],[],'2026-08-01')
 s=o['stocks'][0];assert s['events'][0]['date']=='2026-11-01'
 assert s['events'][0]['event_date']=='2026-12-01'
 assert s['supplemental']['convertibles']['bonds'][0]['matures_on']=='2029-01-01'
 assert 'TRANSFER_PRICE' not in str(s)

def test_shareholder_change_uses_notice_not_trade_date():
 o=r.build([{'code':'600000.SH','name':'浦发'}],[],[])
 r.enrich(o,[],[],[{'SECURITY_CODE':'600000','NOTICE_DATE':'2026-11-13','END_DATE':'2026-11-01','DIRECTION':'减持','CHANGE_NUM':3}], '2026-08-01')
 assert o['stocks'][0]['events'][0]['date']=='2026-11-13'
 assert o['stocks'][0]['events'][0]['shares_10k']==3

def test_delisted_bond_not_current_snapshot():
 o=r.build([{'code':'600000.SH','name':'浦发'}],[],[])
 r.enrich(o,[{'CONVERT_STOCK_CODE':'600000','SECURITY_CODE':'110001','PUBLIC_START_DATE':'2025-01-01','DELIST_DATE':'2026-11-01'}],[],[],'2026-08-01')
 assert o['stocks'][0]['supplemental']['convertibles']['bonds']==[]

def test_margin_window_bounded(monkeypatch):
 calls=[]
 monkeypatch.setattr(r,'fetch_report',lambda *args: calls.append(args) or [])
 assert r.fetch_margin_window('2026-11-13')==[]
 assert len(calls)==14 and all(x[-1]==12 for x in calls)

def test_source_failure_retains_stale_snapshot():
 o=r.build([{'code':'600000.SH','name':'浦发'}],[],[])
 old={'stocks':[{'code':'600000.SH','supplemental':{'pledge':{'as_of':'2026-11-12','ratio':3,'status':'observed'}}}]}
 r.enrich(o,[],[],[],'2026-08-01',{'pledges':'timeout'},old)
 p=o['stocks'][0]['supplemental']['pledge'];assert p['status']=='stale' and p['ratio']==3 and p['as_of']=='2026-11-12'

def test_empty_provider_response_only_known_code(monkeypatch):
 import io,json
 monkeypatch.setattr(r,'urlopen',lambda *a,**k:io.BytesIO(json.dumps({'success':False,'code':9201,'message':'返回数据为空','result':None}).encode()))
 assert r.fetch_report('RPTA_WEB_RZRQ_GGMX','DATE')==[]

def test_old_pledge_date_is_stale_not_current():
 o=r.build([{'code':'600000.SH','name':'浦发'}],[],[])
 r.enrich(o,[],[{'SECUCODE':'600000.SH','TRADE_DATE':'2020-01-01','PLEDGE_RATIO':5}],[],'2026-08-01')
 assert o['stocks'][0]['supplemental']['pledge']['status']=='stale'

def test_expired_bond_without_delisting_not_current():
 o=r.build([{'code':'600000.SH','name':'浦发'}],[],[])
 r.enrich(o,[{'CONVERT_STOCK_CODE':'600000','SECURITY_CODE':'110001','PUBLIC_START_DATE':'2020-01-01','EXPIRE_DATE':'2025-01-01'}],[],[],'2026-08-01')
 assert o['stocks'][0]['supplemental']['convertibles']['bonds']==[]

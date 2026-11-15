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

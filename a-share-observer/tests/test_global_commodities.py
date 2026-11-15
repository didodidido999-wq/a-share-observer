import importlib.util,json
from pathlib import Path
from datetime import date
import pytest
spec=importlib.util.spec_from_file_location('global_commodities',Path(__file__).parents[1]/'scripts/global_commodities.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
TODAY=date(2026,11,15)
def csv(symbol='DCOILWTICO',value='89.62'):return f'observation_date,{symbol}\n2026-11-10,.\n2026-11-11,{value}\n'
def getter(url):
 if 'fredgraph.csv' in url:return csv('DCOILBRENTEU' if 'DCOILBRENTEU' in url else 'DCOILWTICO')
 return 'Release Date: 11/12/2026 Next Release Date: 11/18/2026'
def test_csv_missing_no_zero():assert g.parse_csv(csv(),'DCOILWTICO',today=TODAY)==[{'date':'2026-11-11','value':89.62}]
def test_signed_price_allowed():assert g.parse_csv(csv(value='-1'),'DCOILWTICO',today=TODAY)[0]['value']==-1
@pytest.mark.parametrize('text',[csv('SP500'),csv(value='NaN'),csv(value='inf'),csv().replace('2026-11-11','2099-01-01'),csv(value=''),csv()+'2026-11-11,90\n'])
def test_invalid_reject(text):
 with pytest.raises(ValueError):g.parse_csv(text,'DCOILWTICO',today=TODAY)
def test_release_not_next():assert g.release_date(getter('html'),TODAY)=='2026-11-12'
def test_source_identity_and_dates(tmp_path):
 o=g.collect_asset('wti_spot',tmp_path,getter,TODAY);assert o['kind']=='commodity_spot' and not o['is_futures'] and not o['is_etf_proxy'];assert o['last_observation_date']=='2026-11-11' and o['source_release_date']=='2026-11-12';assert o['market_timezone'] is None
 assert 'published_at' not in o['rows'][0]
def test_failures_preserve_last_good(tmp_path):
 g.run(tmp_path,getter,TODAY);path=tmp_path/'wti_spot.json';prior=path.read_bytes()
 def fail(url):raise TimeoutError('network')
 health,code=g.run(tmp_path,fail,TODAY);assert code==1 and health['assets']['wti_spot']['status']=='stale';assert path.read_bytes()==prior
 assert (tmp_path.parent/'commodities-status.json').exists()
def test_merge_does_not_drop_history(tmp_path):
 g.collect_asset('wti_spot',tmp_path,getter,TODAY)
 def next_get(url):return csv().replace('2026-11-11','2026-11-12') if 'fredgraph' in url else getter(url)
 o=g.collect_asset('wti_spot',tmp_path,next_get,TODAY);assert [r['date'] for r in o['rows']]==['2026-11-11','2026-11-12']
def test_out_of_sync_refused(tmp_path):
 def wrong(url):return csv().replace('2026-11-11','2026-11-13') if 'fredgraph' in url else getter(url)
 with pytest.raises(ValueError,match='out of sync'):g.collect_asset('wti_spot',tmp_path,wrong,TODAY)

def test_partial_success_visible(tmp_path):
 def partial(url):
  if 'DCOILBRENTEU' in url:raise TimeoutError('Brent unavailable')
  return getter(url)
 health,code=g.run(tmp_path,partial,TODAY)
 assert code==0 and health['status']=='partial' and health['assets']['brent_spot']['status']=='unavailable'
 assert (tmp_path/'wti_spot.json').exists() and not (tmp_path/'brent_spot.json').exists()

def test_regressed_source_preserves_file(tmp_path):
 g.collect_asset('wti_spot',tmp_path,getter,TODAY);before=(tmp_path/'wti_spot.json').read_bytes()
 def older(url):return csv().replace('2026-11-11','2026-11-09') if 'fredgraph' in url else getter(url)
 with pytest.raises(ValueError,match='regressed'):g.collect_asset('wti_spot',tmp_path,older,TODAY)
 assert (tmp_path/'wti_spot.json').read_bytes()==before

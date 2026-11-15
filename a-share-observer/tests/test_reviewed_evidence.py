import importlib.util,copy,json
from datetime import datetime,timezone
from pathlib import Path
import pytest
spec=importlib.util.spec_from_file_location('reviewed_evidence',Path(__file__).parents[1]/'scripts/reviewed_evidence.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
NOW=datetime(2026,11,15,tzinfo=timezone.utc)
def row():
 return dict(id='proof-1',revision=1,supersedes=None,code='600000.SH',kind='metric',metric_id='pledge_ratio',value=2.3,unit='%',data_date='2026-11-13',published_at='2026-11-14T01:00:00+08:00',observed_at='2026-11-14T10:00:00+08:00',source_url='https://www.sse.com.cn/disclosure/example.html',source_title='Test fixture only',note='Synthetic unit-test fixture, not real evidence.',status='verified')
def doc(rows=None):return {'schema_version':1,'records':rows or [],'catalog':[]}
def test_valid_and_latest_revision():
 a=row();b={**a,'id':'proof-2','revision':2,'supersedes':'proof-1','value':3};assert r.validate(doc([a,b]),now=NOW)==[b]
def test_append_only():
 a=row();b={**a,'value':4}
 with pytest.raises(ValueError,match='append-only'):r.validate(doc([b]),doc([a]),NOW)
def test_unknown_never_zero():
 a={**row(),'kind':'gap','status':'not_found','value':0}
 with pytest.raises(ValueError):r.validate(doc([a]),now=NOW)
 a['value']=None;assert r.validate(doc([a]),now=NOW)
@pytest.mark.parametrize('patch',[{'value':float('nan')},{'value':True},{'source_url':'http://www.sse.com.cn/'},{'source_url':'https://127.0.0.1/path'},{'observed_at':'2026-11-14T01:00:00'},{'observed_at':'2099-01-01T00:00:00Z'},{'published_at':'2026-11-15T00:00:00Z'},{'data_date':'2099-01-01'},{'asset_id':'cgb_10y'},{'code':'600000'},{'status':'unknown'}])
def test_reject_invalid(patch):
 with pytest.raises(ValueError):r.validate(doc([{**row(),**patch}]),now=NOW)
def test_no_fork_or_identity_change():
 a=row();b={**a,'id':'proof-2','revision':2,'supersedes':'proof-1'};c={**b,'id':'proof-3'}
 with pytest.raises(ValueError):r.validate(doc([a,b,c]),now=NOW)
 with pytest.raises(ValueError):r.validate(doc([a,{**b,'code':'000001.SZ'}]),now=NOW)
def test_apply_independent_and_preserves_automatic(tmp_path):
 p=tmp_path/'reviewed-evidence.json';p.write_text(json.dumps(doc([row()])));s=tmp_path/'risk-stocks';s.mkdir();f=s/'600000.SH.json';f.write_text(json.dumps({'code':'600000.SH','observations':[{'date':'2026-11-13'}]}));before=p.read_text();r.apply(p);out=json.loads(f.read_text());assert out['observations']==[{'date':'2026-11-13'}];assert out['reviewed_evidence'][0]['id']=='proof-1';assert p.read_text()==before;assert (tmp_path/'reviewed-index.json').exists()
def test_asset_evidence_separate():
 a=row();del a['code'];a['asset_id']='cgb_10y';out=r.compile_index(doc([a]));assert out['by_code']=={};assert out['by_asset']['cgb_10y'][0]['id']=='proof-1'

def test_index_preserves_versions_and_observation_availability():
 a=row();b={**a,'id':'proof-2','revision':2,'supersedes':'proof-1','value':3,'observed_at':'2026-11-14T11:00:00+08:00'}
 rows=r.compile_index(doc([a,b]))['by_code']['600000.SH']
 assert len(rows)==2 and rows[-1]['available_at']=='2026-11-14T11:00:00+08:00'

def test_declared_ratio_range_and_units():
 for patch in [{'unit':'arbitrary'},{'value':101},{'value':-1}]:
  with pytest.raises(ValueError):r.validate(doc([{**row(),**patch}]),now=NOW)

def test_revision_unit_and_date_identity():
 a=row()
 for patch in [{'unit':'bp'},{'data_date':'2026-11-12'}]:
  b={**a,'id':'proof-2','supersedes':'proof-1','revision':2,**patch}
  with pytest.raises(ValueError):r.validate(doc([a,b]),now=NOW)

def test_withdrawal_gap_stays_latest():
 a=row();b={**a,'id':'proof-2','revision':2,'supersedes':'proof-1','kind':'gap','status':'unknown','value':None,'note':'Prior value withdrawn pending verification.'}
 assert r.validate(doc([a,b]),now=NOW)==[b]

def test_period_and_entity_fields_validated():
 a={**row(),'report_period_end':'2026-09-30','document_date':'2026-10-26','entity':'实名组合','action_scope':'期末持仓，非买入量'}
 assert r.validate(doc([a]),now=NOW)
 for patch in [{'report_period_end':'2099-01-01'},{'document_date':'not-date'},{'entity':''},{'action_scope':5}]:
  with pytest.raises(ValueError):r.validate(doc([{**a,**patch}]),now=NOW)

def test_empty_apply_does_not_touch_stock_files(tmp_path):
 p=tmp_path/'reviewed-evidence.json';p.write_text(json.dumps(doc()));s=tmp_path/'risk-stocks';s.mkdir();f=s/'600000.SH.json';original='{"code":"600000.SH","observations":[]}\n';f.write_text(original);r.apply(p);assert f.read_text()==original

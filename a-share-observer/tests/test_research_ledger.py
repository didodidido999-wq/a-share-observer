import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path

spec=importlib.util.spec_from_file_location('research_ledger',Path(__file__).parents[1]/'scripts/research_ledger.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
NOW=datetime(2026,11,15,10,tzinfo=timezone.utc)

def rows():
    out=[]
    for i,d in enumerate(['2026-11-06','2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13']):
        x={'date':d,'generated_at':d+'T18:00:00+08:00','indices':[{'code':'000300.SH','close':4100-i*10,'pct':-.25}], 'market':{'up':100,'down':800,'flat':100,'median':-1}}
        x['_hash']=r.digest(x);out.append(x)
    return out

def calendar():
    return {'source_url':'https://www.sse.com.cn/','verified_at':'2026-11-15T08:00:00+00:00','coverage_start':'2026-11-13','coverage_end':'2026-12-31','sessions':['2026-11-13','2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20']}

def test_rule_symmetric_and_missing_abstains():
    x=rows();assert r.build_forecast(x,NOW)['judgment']=='down'
    for i,row in enumerate(x):row['indices'][0]['close']=4000+i*10;row['market'].update(up=800,down=100)
    assert r.build_forecast(x,NOW)['judgment']=='up'
    x[-1]['market']['up']=None
    assert r.build_forecast(x,NOW)['judgment']=='abstain'

def test_stale_abstains():
    assert r.build_forecast(rows(),datetime(2026,11,20,tzinfo=timezone.utc))['judgment']=='abstain'

def test_ledger_tamper_detected():
    ledger={'events':[]};r.append_event(ledger,'forecast',r.build_forecast(rows(),NOW));r.validate(ledger)
    ledger['events'][0]['payload']['judgment']='up'
    import pytest
    with pytest.raises(ValueError):r.validate(ledger)

def test_threshold_boundaries():
    assert r.classification(1,1)=='flat';assert r.classification(-1,1)=='flat';assert r.classification(-1.01,1)=='down'

def test_no_calendar_or_activation_no_scoring():
    f=r.build_forecast(rows(),NOW)
    assert r.evaluate(f,rows(),calendar(),NOW)==[]
    f['activated_at']=NOW.isoformat();assert r.evaluate(f,rows(),None,NOW)==[]

def test_due_date_fixed_calendar_missing_does_not_shift():
    f=r.build_forecast(rows(),NOW);f['activated_at']=NOW.isoformat()
    x=rows();later=dict(x[-1],date='2026-11-23');x.append(later)
    assert r.evaluate(f,x,calendar(),datetime(2026,11,24,tzinfo=timezone.utc))==[]

def test_evaluation_uses_activation_not_generation():
    f=r.build_forecast(rows(),NOW);f['activated_at']='2026-11-16T16:00:00+08:00'
    x=rows();x.append(dict(x[-1],date='2026-11-17'))
    results=r.evaluate(f,x,calendar(),datetime(2026,11,18,tzinfo=timezone.utc))
    assert len(results)==1;assert results[0]['due_date']=='2026-11-17';assert results[0]['horizon']==1;assert results[0]['correct'] is None

def test_future_due_not_scored():
    f=r.build_forecast(rows(),NOW);f['activated_at']=NOW.isoformat()
    x=rows();x.append(dict(x[-1],date='2026-11-16'))
    assert r.evaluate(f,x,calendar(),NOW)==[]

def test_daily_idempotent(tmp_path):
    (tmp_path/'history').mkdir()
    for row in rows():(tmp_path/'history'/f"{row['date']}.json").write_text(json.dumps({k:v for k,v in row.items() if k!='_hash'}))
    (tmp_path/'research-calendar.json').write_text(json.dumps(calendar()))
    r.daily(tmp_path,NOW);before=(tmp_path/'research-ledger.json').read_bytes()
    r.daily(tmp_path,NOW);assert before==(tmp_path/'research-ledger.json').read_bytes()
    r.daily(tmp_path,NOW,activate=True,activate_id=r.read(tmp_path/'research-current.json')['current']['id']);ledger=r.read(tmp_path/'research-ledger.json');assert len(ledger['events'])==2
    r.daily(tmp_path,NOW,activate=True,activate_id=r.read(tmp_path/'research-current.json')['current']['id']);assert len(r.read(tmp_path/'research-ledger.json')['events'])==2

def test_unverified_future_archive_excluded(tmp_path):
    (tmp_path/'history').mkdir();x=rows()[-1];x['generated_at']='2026-11-16T18:00:00+08:00'
    (tmp_path/'history'/'2026-11-13.json').write_text(json.dumps(x));assert r.load_archives(tmp_path,NOW)==[]

def test_calendar_coverage_required():
    f=r.build_forecast(rows(),NOW);f['activated_at']=NOW.isoformat();c=calendar();c['coverage_start']='2026-11-17'
    assert r.evaluate(f,rows(),c,datetime(2026,11,24,tzinfo=timezone.utc))==[]

def review_fixture(f):
    return {'review_id':'week-2026-47','created_at':NOW.isoformat(),'period':'2026-11-09 至 2026-11-15','type':'weekly','cited_forecast_ids':[f['id']], 'findings':['尚无到期前瞻样本，不评价准确率。'],'data_errors':[],'model_errors':[],'event_errors':[],'proposed_changes':[],'shadow_plan':'继续积累真实前瞻样本，正式规则不变。'}

def test_append_review_immutable_and_idempotent():
    import pytest
    ledger={'events':[]};f=r.build_forecast(rows(),NOW);r.append_event(ledger,'forecast',f)
    frozen=json.dumps(ledger['events'][0],sort_keys=True)
    review=review_fixture(f)
    assert r.append_review(ledger,review,NOW) is True
    assert r.append_review(ledger,review,NOW) is False
    assert json.dumps(ledger['events'][0],sort_keys=True)==frozen
    assert ledger['events'][-1]['payload']['formal_rules_unchanged'] is True
    review['findings']=['different']
    with pytest.raises(ValueError):r.append_review(ledger,review,NOW)
    r.validate(ledger)

def test_review_rejects_incomplete_future_unknown_and_rule_change():
    import pytest
    ledger={'events':[]};f=r.build_forecast(rows(),NOW);r.append_event(ledger,'forecast',f)
    for patch in [{'created_at':'2027-01-01T00:00:00Z'},{'cited_forecast_ids':['missing']},{'formal_rules_unchanged':False},{'findings':[]},{'type':'daily'}]:
        review=review_fixture(f);review.update(patch)
        with pytest.raises(ValueError):r.append_review(ledger,review,NOW)
    with pytest.raises(ValueError):r.append_review(ledger,{},NOW)

def test_target_statuses_separates_missing_from_pending():
    f=r.build_forecast(rows(),NOW)
    assert r.target_statuses([f],{},calendar(),rows(),[],NOW)[0]['status']=='not_activated'
    active={f['id']:NOW.isoformat()}
    assert r.target_statuses([f],active,None,rows(),[],NOW)[0]['status']=='calendar_missing'
    assert r.target_statuses([f],active,calendar(),rows(),[],NOW)[0]['status']=='pending'
    late=datetime(2026,11,24,tzinfo=timezone.utc)
    assert r.target_statuses([f],active,calendar(),rows(),[],late)[0]['status']=='price_missing'


def test_activation_refuses_collector_failure_after_next_close(tmp_path):
    import pytest
    (tmp_path/'history').mkdir()
    for row in rows():(tmp_path/'history'/f"{row['date']}.json").write_text(json.dumps({k:v for k,v in row.items() if k!='_hash'}))
    (tmp_path/'research-calendar.json').write_text(json.dumps(calendar()))
    result=r.daily(tmp_path,NOW);before=(tmp_path/'research-ledger.json').read_bytes()
    for intraday in ('2026-11-16T08:00:00+08:00','2026-11-16T14:45:00+08:00'):
        with pytest.raises(ValueError,match='EOD-only'):
            r.daily(tmp_path,datetime.fromisoformat(intraday),activate=True,activate_id=result['current']['id'])
        assert before==(tmp_path/'research-ledger.json').read_bytes()
    monday_evening=datetime.fromisoformat('2026-11-16T20:40:00+08:00')
    with pytest.raises(ValueError,match='latest completed exchange session is 2026-11-16'):
        r.daily(tmp_path,monday_evening,activate=True,activate_id=result['current']['id'])
    assert before==(tmp_path/'research-ledger.json').read_bytes()

def test_activation_calendar_boundaries_and_intraday():
    import pytest
    f=r.build_forecast(rows(),NOW)
    r.validate_activation_date(f,calendar(),NOW) # Sunday: Friday latest complete
    for t in ('2026-11-16T08:00:00+08:00','2026-11-16T14:00:00+08:00','2026-11-16T14:45:00+08:00'):
        with pytest.raises(ValueError,match='EOD-only'):
            r.validate_activation_date(f,calendar(),datetime.fromisoformat(t))
    with pytest.raises(ValueError,match='stale forecast'):
        r.validate_activation_date(f,calendar(),datetime.fromisoformat('2026-11-16T15:00:00+08:00'))
    for c,t in [(None,NOW),(dict(calendar(),coverage_end='2026-11-14'),NOW),(dict(calendar(),coverage_start='2026-11-16'),NOW),(dict(calendar(),sessions=['2026-11-16']),NOW)]:
        with pytest.raises(ValueError):r.validate_activation_date(f,c,t)

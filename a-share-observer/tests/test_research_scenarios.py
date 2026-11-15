"""Model-contract fixtures, independent of the daily production data contents."""
import sys
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import pytest
ROOT=Path(__file__).parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import research_scenarios as r
NOW=datetime(2026,11,15,12,tzinfo=timezone.utc)

@pytest.fixture
def data(tmp_path):
    (tmp_path/'history').mkdir()
    days=[];day=datetime(2026,11,13)
    while len(days)<21:
        if day.weekday()<5:days.append(day.date().isoformat())
        day-=timedelta(days=1)
    days.sort()
    codes=['000300.SH','000016.SH','000001.SH','000905.SH','000510.CSI','399006.SZ','000688.SH','399001.SZ','899050.BJ']
    pcts=[-.683,.106,-.588,-2.1,-1.172,-3.321,-2.304,-2.047,-3.495]
    for n,date in enumerate(days):
        indices=[{'code':code,'name':code,'close':4000-n*5,'pct':pct} for code,pct in zip(codes,pcts) if code!='000510.CSI' or n>=19]
        row={'date':date,'generated_at':date+'T18:00:00+08:00','indices':indices,'market':{'up':763,'down':4750,'flat':58}}
        (tmp_path/'history'/f'{date}.json').write_text(json.dumps(row))
    common={'published_at':'2026-11-09T10:00:00+08:00','available_at':'2026-11-15T09:00:00Z','title':'fixture','summary':'fixture facts','source_url':'https://example.com/fixture','period':'2026-10'}
    records=[dict(common,id='demand',kind='statistic',metrics=[{'name':'前三季度固定资产投资同比','value':-7.2}]),
             dict(common,id='price',kind='statistic',metrics=[{'name':'CPI同比','value':.7},{'name':'PPI同比','value':5.7}]),
             dict(common,id='fuel',kind='policy',effective_at='2026-11-13T00:00:00+08:00',metrics=[{'name':'汽油调价','value':-645},{'name':'柴油调价','value':-625}]),
             dict(common,id='comment',kind='official_commentary',metrics=[])]
    (tmp_path/'policy-context.json').write_text(json.dumps({'records':records}))
    return tmp_path

def test_fixed_cross_index_scenario(data):
    x=r.build(data,NOW)
    assert x['scenario']=='defensive_divergence'
    assert x['signals'][0]['value']==-.683
    assert x['signals'][2]['value']==.106
    assert len(x['index_matrix'])==9
    assert next(i for i in x['index_matrix'] if i['code']=='000510.CSI')['group']=='broad'
    assert len(x['policy_channels'])==4
    assert '局部' in x['policy_conclusion']

def test_future_policy_excluded(data):
    records=r.read(data/'policy-context.json')['records']
    assert r.policy_available(records,datetime(2026,11,13,tzinfo=timezone.utc))==[]
    assert len(r.policy_available(records,NOW))==4

def test_same_window_missing_not_zero(data):
    matrix=r.index_matrix(r.load_archives(data,NOW))
    assert next(i for i in matrix if i['code']=='000510.CSI')['changes']['20']['pct'] is None
    assert len({i['changes']['5']['start_date'] for i in matrix})==1
    assert next(i for i in matrix if i['code']=='000300.SH')['changes']['5']['pct'] is not None

def test_stale_market_pauses_direction_and_policy_degrades(data):
    x=r.build(data,datetime(2027,1,15,tzinfo=timezone.utc))
    assert x['scenario']=='stale'
    assert all(not c['current_eligible'] for c in x['policy_channels'])
    assert all('旧资料' in c['scenario_effect'] for c in x['policy_channels'])

def test_policy_actual_transmission_and_unknown_append(data):
    records=r.policy_available(r.read(data/'policy-context.json')['records'],NOW)
    records.append(dict(records[0],id='new-unknown',kind='policy',metrics=[]))
    channels=r.policy_channels(records,NOW)
    assert any(c['role']=='需求约束' for c in channels)
    assert any(c['role']=='成本分化' for c in channels)
    assert any(c['role']=='已实施成本政策' and '反证' in c['scenario_effect'] for c in channels)
    assert any(c['kind']=='official_commentary' and '重复计数' in c['scenario_effect'] for c in channels)
    assert next(c for c in channels if c['evidence_id']=='new-unknown')['role']=='待研究证据'

def test_missing_policy_is_not_positive_signal(data):
    (data/'policy-context.json').unlink()
    x=r.build(data,NOW)
    assert x['policy_channels']==[]
    assert '政策样本不足' in x['policy_conclusion']

def test_real_data_schema_and_ledger_unchanged():
    data=ROOT/'docs/data';path=data/'research-ledger.json';before=path.read_bytes()
    x=r.build(data,datetime.now(timezone.utc))
    assert x['schema_version']==1
    assert x['kind']=='scenario_research_not_scored_forecast'
    assert isinstance(x['index_matrix'],list)
    assert isinstance(x['policy_channels'],list)
    assert path.read_bytes()==before

def test_credit_materials_and_repo_plan_are_not_equity_inflows(data):
    common=r.read(data/'policy-context.json')['records'][0]
    def record(id,kind,title,values):
        return dict(common,id=id,kind=kind,title=title,metrics=[{'name':k,'value':v} for k,v in values.items()])
    records=[record('credit','statistic','金融统计',{'社融存量同比':7.2,'M2同比':7.1,'M1同比':4.4,'累计社融增量同比变化':-2.29}),
             record('materials','statistic','生产资料旬价',{'价格上涨品种':16,'价格下降品种':32,'价格持平品种':2,'螺纹钢旬环比':-.5,'电解铜旬环比':-.4}),
             record('repo-plan','policy','买断式逆回购计划',{'计划操作规模':2000,'期限':180})]
    channels=r.policy_channels(records,NOW)
    assert '不能等同股市净流入' in channels[0]['mechanism']
    assert '少增' in channels[0]['scenario_effect'] and '存量仍增长' in channels[0]['scenario_effect']
    assert '需求偏弱' in channels[1]['scenario_effect']
    assert channels[2]['role']=='流动性计划（未核验结果）'
    assert '不是实际结果或净投放' in channels[2]['mechanism']
    # Date passage alone must not promote a plan to a completed operation.
    later=r.policy_channels(records,datetime(2026,11,17,tzinfo=timezone.utc))
    assert later[2]['role']=='流动性计划（未核验结果）'
    assert '不自动转为已实施' in later[2]['watch']
    future=dict(records[2],available_at='2026-11-18T00:00:00Z')
    assert r.policy_available([future],NOW)==[]

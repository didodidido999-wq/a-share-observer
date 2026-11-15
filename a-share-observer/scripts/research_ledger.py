"""Frozen, prospective research ledger. No fitting, trading or backdated forecasts."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

VERSION = 'breadth-trend-v1'
THRESHOLDS = {1: 0.5, 5: 1.0, 20: 2.0}  # percent, fixed before outcomes
CN = ZoneInfo('Asia/Shanghai')


def read(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def stamp(value):
    dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        raise ValueError('timestamp requires timezone')
    return dt


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def classification(ret, threshold):
    return 'up' if ret > threshold else 'down' if ret < -threshold else 'flat'


def load_archives(data, now):
    rows = []
    for path in sorted((data / 'history').glob('????-??-??.json')):
        row = read(path)
        generated = row.get('generated_at')
        if not generated or stamp(generated) > now:
            continue
        # A dated archive is never an intraday observation.
        if stamp(row['date'] + 'T15:00:00+08:00') >= now:
            continue
        row['_hash'] = digest(row)
        rows.append(row)
    return rows


def index(row, code='000300.SH'):
    return next((i for i in row.get('indices', []) if i.get('code') == code), {})


def build_forecast(rows, now):
    if not rows:
        raise ValueError('no available end-of-day archive')
    latest = rows[-1]
    day = latest['date']
    points = [(r['date'], index(r).get('close')) for r in rows if finite(index(r).get('close')) and index(r)['close'] > 0]
    usable = len(points) >= 6 and points[-1][0] == day
    market = latest.get('market', {})
    up, down, flat = (market.get(k) for k in ('up', 'down', 'flat'))
    breadth = up / (up + down + flat) if all(finite(x) and x >= 0 for x in (up, down, flat)) and up + down + flat > 0 else None
    momentum = (points[-1][1] / points[-6][1] - 1) * 100 if usable else None
    close = index(latest).get('close')
    # A simple symmetric rule, not a calibrated model. Mixed signals abstain.
    judgment = 'abstain'
    if usable and breadth is not None and (now.astimezone(CN).date() - datetime.fromisoformat(day).date()).days <= 4:
        if momentum > 0 and breadth >= 0.55:
            judgment = 'up'
        elif momentum < 0 and breadth <= 0.45:
            judgment = 'down'
    label = {'up': '偏强', 'down': '偏弱', 'abstain': '证据不足，暂不判断'}[judgment]
    ev = []
    def evidence(key, title, values, inference, page='today'):
        ev.append({'id': key + ':' + day, 'title': title, 'date': day, 'values': values, 'inference': inference,
                   'source': latest.get('source', '站内真实日终归档；上游同花顺财经'),
                   'available_at': latest['generated_at'], 'observed_at': now.isoformat(),
                   'archive_sha256': latest['_hash'], 'archive_url': 'data/history/' + day + '.json',
                   'route': {'page': page, 'date': day, 'anchor': 'kpi-grid' if key == 'breadth' else 'market-index-section'}})
    evidence('benchmark', '沪深300价格与近5个归档交易间隔', {'close': close, 'pct': index(latest).get('pct'), 'change_5_sessions_pct': momentum, 'start_date': points[-6][0] if usable else None, 'input_points': points[-6:]},
             '价格动量提供趋势证据，不代表趋势必然延续；归档间隔不冒充已经核验的交易日历。')
    evidence('breadth', '全市场上涨覆盖与中位数', {'up': up, 'down': down, 'flat': flat, 'up_ratio': breadth, 'median_pct': market.get('median'), 'turnover_100m': market.get('turnover_100m')},
             '宽度反映涨跌是否由少数权重股驱动；弱宽度支持风险警示，也可能接近短期超跌反弹。')
    evidence('style', '权重与成长分化', {'indices': [{k: i.get(k) for k in ('name','code','close','pct')} for i in latest.get('indices', []) if i.get('code') in ('000016.SH','000905.SH','399006.SZ')]},
             '风格分化是反证检查：权重抗跌不代表多数股票止跌，成长回升也不等于广谱复苏。')
    explanation = (f'截至{day}，沪深300近5个归档交易间隔变化{momentum:+.2f}%，上涨股票占比{breadth:.1%}。两项同时偏弱，规则辅助结论为偏弱，重点观察宽度修复，而非断言持续下跌。' if judgment == 'down' else
                   f'截至{day}，沪深300近5个归档交易间隔变化{momentum:+.2f}%，上涨股票占比{breadth:.1%}。两项同时偏强，规则辅助结论为偏强，但需防止成交与宽度背离。' if judgment == 'up' else
                   '趋势与宽度尚未同时满足固定规则，或数据不足/陈旧；保留观察，不强行给出方向。')
    payload = {'schema_version': 1, 'model_version': VERSION, 'issued_at': now.isoformat(), 'issued_at_meaning': 'generation_time_not_verified_publication', 'data_date': day,
               'kind': 'prospective_end_of_day', 'benchmark': '000300.SH', 'benchmark_name': '沪深300',
               'reference_close': close, 'primary_horizon': 5, 'judgment': judgment, 'label': label, 'analysis': explanation,
               'probabilities': None, 'thresholds_pct': {str(k): v for k,v in THRESHOLDS.items()},
               'targets': [{'horizon': h, 'judgment': judgment if h == 5 else 'abstain', 'role': '主判断' if h == 5 else '辅助观察，不单独预测'} for h in (1,5,20)],
               'evidence': ev, 'counter_evidence': ['单日极弱宽度可能伴随超跌反弹，不能线性外推。', '重大新政策和海外冲击尚未纳入量化规则，可能改变当前方向。'],
               'invalidation': ['上涨覆盖重新超过55%且5个归档间隔动量转正，重新评估偏弱判断。', '上涨覆盖低于45%且动量转负，重新评估偏强判断。', '数据源修订、关键输入缺失或超过4个自然日未更新时停止沿用该判断。'],
               'limitations': ['规则辅助研究，未校准概率，未证明预测能力。', '这是盘后数据研究，不是当日14:45可得数据；不回填历史预测。', '宏观、政策、机构持仓和外围代理仅作背景，不冒充本规则的已量化输入。', '指数变化以发出时已知收盘值作研究参照，包含之后开盘跳空；不是可成交策略收益。', '到期评价须核验交易日历，缺失或迟到行情不作零处理。'],
               'baseline': {'always_up': 'up', 'momentum_sign': 'up' if momentum is not None and momentum > 0 else 'down' if momentum is not None and momentum < 0 else 'flat'},
               'input_hash': digest([r['_hash'] for r in rows[-6:]])}
    payload['id'] = 'research-' + now.strftime('%Y%m%dT%H%M%SZ') + '-' + digest(payload)[:10]
    return payload


def append_event(ledger, kind, payload):
    previous = ledger['events'][-1]['hash'] if ledger['events'] else None
    event = {'sequence': len(ledger['events']) + 1, 'previous_hash': previous, 'kind': kind, 'payload': payload}
    event['hash'] = digest(event)
    ledger['events'].append(event)


def validate(ledger):
    previous = None
    for n, event in enumerate(ledger['events'], 1):
        body = {k:v for k,v in event.items() if k != 'hash'}
        if event.get('sequence') != n or event.get('previous_hash') != previous or digest(body) != event.get('hash'):
            raise ValueError('ledger integrity failure')
        previous = event['hash']


def evaluate(forecast, rows, calendar, now):
    if not calendar or not calendar.get('source_url') or not calendar.get('verified_at'):
        return []  # Fail closed; observed archives are NOT an exchange calendar.
    if stamp(calendar['verified_at']) > now:
        return []
    days = calendar.get('sessions', [])
    if days != sorted(set(days)):
        raise ValueError('calendar sessions must be sorted and unique')
    if not forecast.get('activated_at'):
        return []
    issued_day = stamp(forecast['activated_at']).astimezone(CN).date().isoformat()
    if not calendar.get('coverage_start') or not calendar.get('coverage_end') or calendar['coverage_start'] > issued_day:
        return []
    # Only full sessions strictly after issue date; this EOD-only contract excludes same-day future bars.
    future = [d for d in days if d > issued_day]
    by_day = {r['date']: r for r in rows}
    results = []
    for target in forecast['targets']:
        h = target['horizon']
        if len(future) < h:
            continue
        due = future[h-1]
        if due > calendar['coverage_end']:
            continue
        if stamp(due + 'T15:00:00+08:00') >= now:
            continue
        actual = index(by_day.get(due, {})).get('close')
        if not finite(actual) or actual <= 0 or not finite(forecast['reference_close']) or forecast['reference_close'] <= 0:
            continue  # unresolved, never turn a missing close into zero
        ret = (actual / forecast['reference_close'] - 1) * 100
        category = classification(ret, forecast['thresholds_pct'][str(h)])
        results.append({'forecast_id': forecast['id'], 'horizon': h, 'due_date': due, 'evaluated_at': now.isoformat(),
                        'status': 'abstained' if target['judgment'] == 'abstain' else 'evaluated',
                        'actual_close': actual, 'return_pct': ret, 'actual_class': category,
                        'correct': None if target['judgment'] == 'abstain' else target['judgment'] == category,
                        'baselines': {k: v == category for k,v in forecast['baseline'].items()},
                        'source_archive_hash': by_day[due]['_hash'], 'calendar_hash': digest(calendar)})
    return results



def background(data, now):
    result=[]
    policy=read(data/'policy-context.json', {})
    for item in policy.get('records', []):
        if item.get('available_at') and stamp(item['available_at']) <= now:
            result.append({'title':item['title'], 'fact':item['summary'], 'analysis':item.get('interpretation',''), 'limitations':item.get('limitations',''), 'source_url':item.get('source_url'), 'evidence_id':item['id'], 'route':{'page':'policy','anchor':item['id']}, 'data_date':item.get('period'), 'available_at':item['available_at']})
    macro=read(data/'risk-macro.json', {})
    if macro.get('updated_at') and stamp(macro['updated_at']) <= now:
        for item in macro.get('macro', []):
            points=[p for p in item.get('rows',[]) if p['date'] <= now.astimezone(CN).date().isoformat() and finite(p.get('value'))]
            if points:
                point=points[-1]
                result.append({'title':item['label'],'fact':str(point['value'])+item.get('unit',''), 'analysis':'资金价格影响估值折现及融资成本；利率下行也可能反映需求偏弱，不能单向解释为股市利好。','limitations':'短历史、公布时刻未核验；仅当前背景，不纳入方向规则或历史14:45回放。','source_url':item.get('source_url'),'data_date':point['date'],'route':{'page':'macro','anchor':'risk-macro-section'}})
    funds=read(data/'funds-observer.json',{})
    if funds.get('updated_at') and stamp(funds['updated_at']) <= now and funds.get('financing',{}).get('rows'):
        point=funds['financing']['rows'][-1]
        result.append({'title':'融资交易背景','fact':f"融资余额 {point.get('financing_balance_100m')} 亿元；净买入 {point.get('financing_net_buy_100m')} 亿元",'analysis':'杠杆资金的边际变化需结合成交规模与价格确认，单日净买入不代表持续增量资金。','limitations':'融资不是全部散户或主力资金；ETF份额变化也不能确认汇金买卖。未纳入方向规则。','data_date':point['date'],'source_url':funds['financing'].get('source_url'),'route':{'page':'capital','anchor':'funds-observer'}})
    result.append({'title':'外围与重要商品','fact':'原始利率/原油现货与境内ETF代理必须分开观察。','analysis':'能源涨价可能支撑上游利润并挤压下游；海外利率变化经估值与汇率传导，但不能把代理ETF涨跌当作原指数精确表现。','limitations':'本版尚未量化跨市场传导和汇率/溢价影响，不能称全因子融合；油价是滞后现货而非实时期货。','route':{'page':'macro','anchor':'global-context'}})
    return {'observed_at':now.isoformat(), 'items':result, 'note':'以下是独立更新的当前背景研究，不是历史冻结预测当时已使用的输入，也不改变方向规则。'}

def daily(data, now, activate=False, activate_id=None):
    path = data / 'research-ledger.json'
    ledger = read(path, {'schema_version':1, 'events':[]})
    validate(ledger)
    rows = load_archives(data, now)
    forecasts = [e['payload'] for e in ledger['events'] if e['kind'] == 'forecast']
    current = build_forecast(rows, now)
    # Daily retry is idempotent. Corrections require a future, separately identified release.
    existing = next((f for f in reversed(forecasts) if f['data_date'] == current['data_date'] and f['model_version'] == VERSION), None)
    if not existing:
        append_event(ledger, 'forecast', current)
        forecasts.append(current)
    activations = {e['payload']['forecast_id']:e['payload']['activated_at'] for e in ledger['events'] if e['kind']=='activation'}
    if activate and not activate_id:
        raise ValueError('activation requires explicit --activate-id verified on live site')
    if activate and activate_id not in {f['id'] for f in forecasts}:
        raise ValueError('unknown activation ID')
    if activate and activate_id not in activations:
        selected=next(f for f in forecasts if f['id']==activate_id)
        if selected['data_date'] != rows[-1]['date']:
            raise ValueError('stale forecast: publish a newly generated record before activation')
        # This operation is only run AFTER the exact forecast is verified public.
        append_event(ledger, 'activation', {'forecast_id': activate_id, 'activated_at': now.isoformat()})
        activations[activate_id] = now.isoformat()
    calendar = read(data / 'research-calendar.json')
    done = {(e['payload']['forecast_id'], e['payload']['horizon']) for e in ledger['events'] if e['kind'] == 'evaluation'}
    for forecast in forecasts:
        for result in evaluate(dict(forecast, activated_at=activations.get(forecast['id'])), rows, calendar, now):
            if (result['forecast_id'], result['horizon']) not in done:
                append_event(ledger, 'evaluation', result)
    validate(ledger)
    summary = {'schema_version':1, 'generated_at':now.isoformat(), 'current':forecasts[-1],
               'forecasts':forecasts, 'evaluations':[e['payload'] for e in ledger['events'] if e['kind']=='evaluation'],
               'background':background(data, now), 'activations':activations, 'calendar_status':'verified_file_present' if calendar else 'missing',
               'review_policy': '每日记录与核对；每周复盘错误；每月候选版本影子检验。保留原预测，禁止事后调参美化成绩。尚未证明准确率提升。'}
    for output, value in ((path, ledger), (data/'research-current.json', summary)):
        tmp = output.with_suffix('.tmp')
        tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
        tmp.replace(output)
    return summary


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data-dir', type=Path, default=Path(__file__).resolve().parents[1]/'docs'/'data')
    p.add_argument('--git-base', help='verify all committed ledger events remain an exact prefix')
    p.add_argument('--activate-id', help='exact already-public forecast ID to activate')
    p.add_argument('--activate', action='store_true', help='only after verifying this exact forecast is publicly deployed; activates forward evaluation now')
    p.add_argument('--check', action='store_true', help='validate existing hash chain without changes')
    args=p.parse_args()
    if args.git_base:
        import subprocess
        repo=Path(__file__).resolve().parents[2]
        relative=(args.data_dir/'research-ledger.json').resolve().relative_to(repo).as_posix()
        subprocess.run(['git','rev-parse','--verify',args.git_base+'^{commit}'],cwd=repo,check=True,capture_output=True)
        exists=subprocess.check_output(['git','ls-tree','--name-only',args.git_base,'--',relative],cwd=repo,text=True).strip()
        if exists:
            raw=subprocess.check_output(['git','show',args.git_base+':'+relative],cwd=repo,text=True)
            old=json.loads(raw);new=read(args.data_dir/'research-ledger.json');validate(old);validate(new)
            if new['events'][:len(old['events'])] != old['events']:
                raise ValueError('existing committed events modified or removed')
    if args.check:
        validate(read(args.data_dir/'research-ledger.json'))
        print('research ledger integrity OK')
    else:
        result=daily(args.data_dir, datetime.now(timezone.utc), activate=args.activate or bool(args.activate_id), activate_id=args.activate_id)
        print(json.dumps({'current':result['current']['id'], 'forecasts':len(result['forecasts']), 'evaluations':len(result['evaluations']), 'calendar':result['calendar_status']}))

if __name__=='__main__':
    main()

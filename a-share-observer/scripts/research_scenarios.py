"""Current cross-index/policy scenario research, separate from scored v1 forecasts."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from research_ledger import read, stamp, digest, finite, load_archives, CN

VERSION = 'cross-index-policy-research-v1.1'
GROUPS = [('large','权重与大盘',['000300.SH','000016.SH','000001.SH']),
          ('mid','中盘与扩散',['000905.SH']),
          ('broad','全市场补充（非中盘专属）',['000510.CSI']),
          ('growth','成长与弹性',['399006.SZ','000688.SH','399001.SZ']),
          ('other','独立市场观察',['899050.BJ'])]


def policy_available(records, now):
    visible=[]
    for r in records:
        available=r.get('available_at')
        boundary=r.get('published_at') or r.get('availability_boundary')
        if not available or not boundary:
            continue
        if stamp(available)<=now and stamp(boundary)<=now:
            visible.append(r)
    superseded={r.get('supersedes') for r in visible if r.get('supersedes')}
    return [r for r in visible if r['id'] not in superseded]


def index_matrix(rows):
    latest=rows[-1];dates=[r['date'] for r in rows]
    lookup={r['date']:{i['code']:i for i in r.get('indices',[])} for r in rows}
    output=[]
    for group,label,codes in GROUPS:
        for code in codes:
            current=lookup[dates[-1]].get(code,{})
            changes={}
            for h in (1,5,20):
                base_date=dates[-h-1] if len(dates)>h else None
                base=lookup.get(base_date,{}).get(code,{}).get('close')
                close=current.get('close')
                complete=base_date is not None and all(finite(lookup[d].get(code,{}).get('close')) and lookup[d][code]['close']>0 for d in dates[-h-1:])
                changes[str(h)]={'pct':(close/base-1)*100 if complete else None,'start_date':base_date,'end_date':dates[-1],'status':'observed_archive_intervals' if complete else 'missing'}
            output.append({'code':code,'name':current.get('name',code),'group':group,'group_label':label,
                'close':current.get('close'),'daily_pct':current.get('pct'),'changes':changes,
                'route':{'page':'today','date':latest['date'],'anchor':'market-index-section'},
                'source_snapshot':{'path':'data/history/'+latest['date']+'.json','sha256':latest['_hash'],'available_at':latest['generated_at']}})
    return output


def policy_channels(records, now):
    channels=[]
    def add(r, role, mechanism, effect, counter, watch):
        age=(now-stamp(r.get('published_at') or r['availability_boundary'])).total_seconds()/86400
        current=age<=45 and not (r.get('expires_at') and stamp(r['expires_at'])<=now)
        if not current:
            effect='旧资料只保留背景，不再改变当前情景；需检索更新发布及执行情况。'
        channels.append({'current_eligible':current,'freshness':'current_review_window' if current else 'background_only','age_days':round(age,1),'evidence_id':r['id'],'title':r['title'],'kind':r['kind'],'fact':r['summary'],'metrics':r.get('metrics',[]),
            'role':role,'mechanism':mechanism,'scenario_effect':effect,'counter_evidence':counter,'watch':watch,
            'source_url':r.get('source_url'),'available_at':r['available_at'],'published_at':r.get('published_at'),
            'publication_precision':r.get('published_precision'), 'period':r.get('period'),
            'route':{'page':'policy','anchor':r['id']},'evidence_snapshot':r})
    for r in records:
        metrics={m['name']:m['value'] for m in r.get('metrics',[]) if finite(m.get('value'))}
        # Named, auditable interpretations. Unknown future policy types are never auto-scored.
        if '前三季度固定资产投资同比' in metrics and metrics['前三季度固定资产投资同比']<0:
            add(r,'需求约束','投资累计同比为负，与GDP增长并存，说明需求分项不均衡。',
                '削弱“所有行业盈利同步改善”的解释，当前更适合区分结构而非推断全面牛市。',
                'GDP仍增长，不能将投资负值等同于经济全面衰退。','后续投资、零售、工业利润的实际新发布值是否共同改善。')
        elif 'CPI同比' in metrics and 'PPI同比' in metrics:
            gap=metrics['PPI同比']-metrics['CPI同比']
            add(r,'成本分化',f"PPI与CPI同比相差{gap:.1f}个百分点；这不是直接利润率，但提示产业链价格传导不均。",
                '资源端收入与下游成本可能分化，降低“指数反弹等于多数行业盈利修复”的确信。' if gap>0 else '价格约束需结合行业销量、库存判断，不能自动推出资源普涨。',
                'PPI与CPI商品篮子不同，不能用两者差值直接计算上市公司毛利。','上游价格、下游提价能力和实际利润能否验证成本传导。')
        elif r['kind']=='policy' and '汽油调价' in metrics and '柴油调价' in metrics:
            effective=r.get('effective_at');active=bool(effective and stamp(effective)<=now)
            down=metrics['汽油调价']<0 and metrics['柴油调价']<0
            add(r,'已实施成本政策' if active else '待实施政策',
                '成品油价格下调可能缓和运输等燃料使用环节成本。' if down else '成品油调价改变燃料使用环节成本。',
                '对成本承压情景形成局部缓和反证，但不能抵消全部需求风险，也不是全面宽松转向。' if active and down else '尚需确认生效及行业传导，暂不改变当前情景。',
                '零售油价调价不等于所有企业采购成本同步同幅变化。','生效后的成本兑现、运价和消费量；不以政策标题代替盈利验证。')
        elif r['kind']=='statistic' and all(k in metrics for k in ('社融存量同比','M2同比','M1同比','累计社融增量同比变化')):
            change=metrics['累计社融增量同比变化']
            add(r,'融资背景',
                f"社融存量同比{metrics['社融存量同比']:.1f}%、M2同比{metrics['M2同比']:.1f}%、M1同比{metrics['M1同比']:.1f}%；存量增速与累计少增/多增分别观察，不能等同股市净流入。",
                '累计社融较上年同期少增，降低“融资全面加速”的确信；但存量仍增长，不能据此判定信用全面收缩。' if change<0 else '累计社融较上年同期多增提供融资扩张线索，但仍需核实融资结构与实体需求，不能直接推出指数上涨。',
                '累计同比变化不是当月流量，M1采用修订口径；融资需求、财政融资和供给均可能影响读数。',
                '后续社融结构、企业中长期贷款、M1同口径变化和实际经营数据是否共同确认需求改善。')
        elif r['kind']=='statistic' and all(k in metrics for k in ('价格上涨品种','价格下降品种','价格持平品种','螺纹钢旬环比','电解铜旬环比')):
            total=sum(metrics[k] for k in ('价格上涨品种','价格下降品种','价格持平品种'))
            majority=total>0 and metrics['价格下降品种']>total/2
            add(r,'原材料成本线索',
                f"本旬监测{total:g}种生产资料，下降{metrics['价格下降品种']:g}种；旬环比只反映本窗口，不与PPI月度同比直接拼接。",
                '多数品种回落是原料成本压力缓和的反证，但也可能反映需求偏弱；因此保留行业分化判断，不升级为全面盈利修复。' if majority else '本旬价格并非普遍下降；需要分产品观察，不能推定整体成本压力解除。',
                '流通价格包含费用、利润和税费，不等于出厂价或上市公司采购价；价格下降也可能同时压低上游收入。',
                '结合销量、库存、企业采购成本和后续旬价，区分供给改善与需求减弱。')
        elif r['kind']=='policy' and '买断式逆回购' in r.get('title','') and all(k in metrics for k in ('计划操作规模','期限')):
            add(r,'流动性计划（未核验结果）',
                f"公告计划规模{metrics['计划操作规模']:g}亿元、期限{metrics['期限']:g}天；这只是拟操作安排，不是实际结果或净投放。",
                '新增流动性安排是需跟踪的潜在缓和条件，不把计划计为已落地支持；只有实际结果和同期到期规模核验后才能讨论净影响。',
                '日历到达操作日不证明操作已完成；若仅续作到期资金，也不能把总额视为新增市场流动性。',
                '核对央行实际操作公告、成交及同期到期规模、资金利率；无结果就保持待核验，不自动转为已实施。')
        elif r['kind']=='official_commentary':
            add(r,'解释性证据','官方统计解读帮助识别价格来源，不新增独立政策工具。',
                '解释成本分化，不作为另一份独立利好重复计数。','与原统计引用同源，不增加独立证据数量。','等待实际措施与后续统计验证。')
        else:
            add(r,'待研究证据','尚无经人工核验的具体传导规则。','只列为待研究，不自动改变方向。','未研究不等于中性或没有影响。','核实政策工具、覆盖对象、生效与执行。')
    return channels


def build(data, now):
    rows=load_archives(data,now)
    if not rows: raise ValueError('no available EOD archive')
    latest=rows[-1];matrix=index_matrix(rows);by={i['code']:i for i in matrix}
    market=latest.get('market',{});counts=[market.get(k) for k in ('up','down','flat')]
    breadth=counts[0]/sum(counts)*100 if all(finite(x) and x>=0 for x in counts) and sum(counts)>0 else None
    groups=[]
    for key,label,codes in GROUPS:
        changes=[by[c]['changes']['5']['pct'] for c in codes]
        valid=[v for v in changes if v is not None]
        state='missing' if len(valid)!=len(codes) else 'strengthening' if all(v>0 for v in valid) else 'weakening' if all(v<0 for v in valid) else 'mixed'
        groups.append({'id':key,'label':label,'state':state,'available':len(valid),'expected':len(codes),
            'interpretation':{'missing':'成员窗口不完整，不以剩余少数代表全组。','strengthening':'组内5个归档间隔均上涨；仍需市场宽度确认。','weakening':'组内5个归档间隔均下跌；观察是否有政策或宽度反证。','mixed':'组内分化，不能用单一指数代表整体。'}[state]})
    records=policy_available(read(data/'policy-context.json',{}).get('records',[]),now)
    channels=policy_channels(records,now)
    hs=by['000300.SH']['daily_pct'];weight=by['000016.SH']['daily_pct'];mid=by['000905.SH']['daily_pct'];growth=by['399006.SZ']['daily_pct']
    relative=all(finite(x) for x in [hs,weight,mid,growth]) and weight>hs and hs>mid and hs>growth
    pressure=breadth is not None and breadth<50 and finite(hs) and hs<0
    improvement=breadth is not None and breadth>50 and all(next(g for g in groups if g['id']==k)['state']=='strengthening' for k in ('large','mid','growth'))
    stale=(now.astimezone(CN).date()-datetime.fromisoformat(latest['date']).date()).days>4
    if stale:
        headline='市场数据陈旧，暂停当前走势推断';scenario='stale'
    elif breadth is None or not all(finite(x) for x in [hs,weight,mid,growth]):
        headline='关键市场证据缺失，暂不归类当前走势';scenario='insufficient_data'
    elif pressure and relative:
        headline='权重相对抗跌，市场多数股票仍承压';scenario='defensive_divergence'
    elif pressure:
        headline='市场广度承压，尚缺广谱修复确认';scenario='broad_pressure'
    elif improvement:
        headline='多组指数同步改善，观察政策能否确认扩散';scenario='broad_improvement'
    else:
        headline='指数与市场宽度分化，暂不归为单边趋势';scenario='mixed'
    constraints=[c for c in channels if c['current_eligible'] and c['role'] in ('需求约束','成本分化')]
    relief=[c for c in channels if c['current_eligible'] and c['role']=='已实施成本政策']
    policy_text=('需求与成本证据提示行业分化；'+('已生效成品油调价提供局部成本缓和反证。' if relief else '尚缺已核验的广谱支持措施。')) if constraints else '政策样本不足，不能确认政策方向发生全面变化。'
    active_roles={c['role'] for c in channels if c['current_eligible']}
    if '融资背景' in active_roles:
        policy_text+=' 社融须区分存量增长与累计增量变化，尚不支持直接推断股市增量资金。'
    if '原材料成本线索' in active_roles:
        policy_text+=' 旬价为成本分化提供新反证，仍需区分供给和需求原因。'
    if '流动性计划（未核验结果）' in active_roles:
        policy_text+=' 逆回购计划列为后续验证条件，未当作已实施净投放。'
    strongest=(f'上证50当日{weight:+.3f}%，相对沪深300抗跌；但这不等于多数股票止跌。' if relative else '单日涨跌与5/20间隔趋势可能不同步，不能线性外推。')
    if relief: strongest+=' 已实施的成品油调价可能缓和部分下游成本，限制单边悲观解释。'
    result={'schema_version':1,'version':VERSION,'kind':'scenario_research_not_scored_forecast','generated_at':now.isoformat(),'data_date':latest['date'],
        'headline':headline,'scenario':scenario,'policy_conclusion':policy_text,'strongest_counter_evidence':strongest,
        'coverage':'结构判断使用国内指数/市场宽度；政策和统计证据改变情景解释与反证，不转换为未经验证的数值权重。',
        'role_boundary':'当前综合研究，不替代已激活v1预测，不自动进入其命中统计；本版本没有已验证的上涨概率。',
        'signals':[{'label':'沪深300当日','value':hs,'unit':'%','route':by['000300.SH']['route']},
                   {'label':'上涨股票占比','value':breadth,'unit':'%','route':{'page':'today','date':latest['date'],'anchor':'kpi-grid'}},
                   {'label':'上证50当日','value':weight,'unit':'%','route':by['000016.SH']['route']}],
        'index_matrix':matrix,'groups':groups,'policy_channels':channels,
        'scenarios':[{'title':'修复得到确认','conditions':'权重、中盘、成长的同窗走势由分化转为共同改善，且上涨覆盖连续获得确认；政策需有实际执行及需求/利润验证。','effect':'重新评估当前承压/分化解释，不能只凭权重拉升升级为广谱改善。'},
            {'title':'维持结构分化','conditions':'权重相对抗跌但中盘/成长及市场宽度未修复；政策仅局部缓和成本，需求证据未同步改善。','effect':'保留结构性而非全面修复解释，继续区分受益和成本承压行业。'},
            {'title':'压力进一步扩散','conditions':'权重也转弱、宽度未修复，同时执行/需求/利润新证据不支持修复。','effect':'提高风险情景关注；若新政策已兑现或宽度反转，则推翻该解释。'}],
        'missing':['中证1000/2000及红利完整序列不足，不用代理替代。','政策样本有限，尚未覆盖完整重大政策/人民日报社论/新华社评论。','当前为盘后研究，无当日14:45真实快照；不倒填历史。','1/5/20表示实际归档观察间隔；历史交易日历未全部核验，不能排除归档缺口。','政策超过45个自然日未重新核实则降级为背景；这是资料复核期限，不是政策效力期限或验证过的预测参数。','未纳入外盘ETF代理为原指数信号；境外时差/汇率/溢价及商品成本传导尚未量化。'],
        'source_manifest':[{'date':r['date'],'available_at':r['generated_at'],'sha256':r['_hash']} for r in rows[-21:]]}
    result['input_digest']=digest({'indices':matrix,'policy':channels,'market':market})
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--data-dir',type=Path,default=Path(__file__).resolve().parents[1]/'docs'/'data');args=p.parse_args()
    result=build(args.data_dir,datetime.now(timezone.utc));path=args.data_dir/'research-scenarios.json'
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');tmp.replace(path)
    print(json.dumps({'version':VERSION,'scenario':result['scenario'],'data_date':result['data_date'],'policies':len(result['policy_channels'])}))
if __name__=='__main__':main()

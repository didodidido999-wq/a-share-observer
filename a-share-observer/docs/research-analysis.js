(function(root){
'use strict';
const names={up:'偏强',down:'偏弱',flat:'震荡',abstain:'暂不判断'};
const utils={
 visibleForecasts:(rows,at)=>rows.filter(r=>Date.parse(r.issued_at)<=at),
 metrics:(rows,h=5)=>{const all=rows.filter(r=>r.horizon===h),scored=all.filter(r=>r.status==='evaluated'&&typeof r.correct==='boolean');return {mature:all.length,n:scored.length,hits:scored.filter(r=>r.correct).length,coverage:all.length?scored.length/all.length:null};}
};
root.ResearchAnalysisUtils=utils;
if(typeof document==='undefined')return;
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const fmt=(v,d=2)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(d):'缺失';
const when=t=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short'}).format(new Date(t));
let dataPromise,serial=0;
const getData=()=>dataPromise||(dataPromise=fetch('data/research-current.json',{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('研究档案尚未载入');return r.json();}).catch(e=>{dataPromise=null;throw e;}));
const section=(title,description)=>{const s=node('section',undefined,'research-card');s.append(node('h3',title));if(description)s.append(node('p',description,'research-muted'));return s;};
function routeLink(e,navigate){const route={...e.route};if(e.id&&e.id.startsWith('benchmark:'))route.anchor='market-index-section';if(e.id&&e.id.startsWith('style:'))route.anchor='market-index-section';if(e.id&&e.id.startsWith('breadth:'))route.anchor='kpi-grid';const a=node('a','查看对应日期的信息 →');a.href='#'+route.page+'?date='+encodeURIComponent(e.date||'')+'&anchor='+encodeURIComponent(route.anchor||'');a.addEventListener('click',event=>{const nav=navigate||root.MarketScopeNavigate;if(nav){event.preventDefault();nav(route);}});return a;}
function values(e){const v=e.values;if(e.id.startsWith('benchmark:'))return `收盘 ${fmt(v.close)}；当日 ${fmt(v.pct)}%；近5个归档间隔 ${fmt(v.change_5_sessions_pct)}%（自${v.start_date||'缺失'}）`;
if(e.id.startsWith('breadth:'))return `上涨 ${v.up??'缺失'} / 下跌 ${v.down??'缺失'} / 平盘 ${v.flat??'缺失'}；上涨占比 ${fmt(v.up_ratio===null?null:v.up_ratio*100)}%；中位数 ${fmt(v.median_pct)}%；成交 ${fmt(v.turnover_100m)} 亿元`;
return (v.indices||[]).map(i=>`${i.name} ${fmt(i.pct)}%`).join(' · ');}
async function render(options={}){
const id=++serial,host=document.getElementById('research-content');if(!host)return;host.replaceChildren(node('p','正在读取冻结研究档案…','research-muted'));
try{const data=await getData();if(id!==serial)return;host.replaceChildren();
const f=data.current;const stale=Date.now()-Date.parse(f.data_date+'T15:00:00+08:00')>4*86400000;
const hero=section('大盘研究与判断','规则辅助研究 · 盘后数据 · 尚未验证预测能力');hero.classList.add('research-hero');if(stale)hero.append(node('p','原判断数据已超过4天，请勿继续沿用。以下保留历史原文，等待新的有效研究。','research-notice'));hero.append(node('div',f.label,'research-verdict'),node('p',f.analysis));hero.append(node('p',`基准：${f.benchmark_name} · 主期限：发出后第5个交易日 · 生成：${when(f.issued_at)} · 数据：${f.data_date}`,'research-muted'));
hero.append(node('p',data.activations&&data.activations[f.id]?`前瞻跟踪激活：${when(data.activations[f.id])}；期限从激活后的下一个完整交易日起算。`:'此研究尚未确认上线激活；当前仅研究快照，不计入前瞻预测成绩。','research-notice'));hero.append(node('p','当前研究固定展示真实发出的版本，不随顶部历史日期选择倒填。历史预测见下方冻结档案；证据日期可独立跳转。','research-notice'));hero.append(node('p','没有校准后的上涨概率，不显示胜率承诺。1日、20日仅跟踪结果，不据此挑选最优期限。','research-notice'));host.append(hero);
const grid=node('div',undefined,'research-grid');
const evidence=section('01 / 具体依据','事实、规则推断与原始输入分开，点击定位所用数据日期。');
for(const e of f.evidence){const item=node('article',undefined,'research-evidence');item.append(node('h4',e.title),node('p',values(e),'research-value'),node('p',e.inference),node('p',`数据日期 ${e.date} · 归档生成 ${when(e.available_at)} · ${e.source}`,'research-muted'),routeLink(e,options.navigate));const details=node('details');details.append(node('summary','查看冻结输入及校验信息'),node('pre',JSON.stringify(e,null,2)));item.append(details);evidence.append(item);}grid.append(evidence);
const risk=section('02 / 反证与失效条件','改变判断必须新增版本，不覆盖原判断。');for(const line of f.counter_evidence)risk.append(node('p',line));risk.append(node('h4','下一步重点观察'));const ul=node('ul');for(const line of f.invalidation)ul.append(node('li',line));risk.append(ul);risk.append(node('h4','不能从本研究推出什么'));for(const line of f.limitations)risk.append(node('p',line,'research-muted'));grid.append(risk);host.append(grid);
if(data.background){const b=section('03 / 跨市场与政策背景',data.background.note+' 更新于'+when(data.background.observed_at));for(const item of data.background.items){const a=node('details',undefined,'research-evidence');a.append(node('summary',item.title+'：'+item.fact),node('p',item.analysis),node('p',(item.data_date?'数据期间 '+item.data_date+' · ':'')+item.limitations,'research-muted'),routeLink(item,options.navigate));if(item.source_url&&/^https:\/\//.test(item.source_url)){const source=node('a',' 官方/数据来源');source.href=item.source_url;source.target='_blank';source.rel='noopener noreferrer';a.append(source);}b.append(a);}host.append(b);}
const review=section('04 / 前瞻复盘','只统计发出后真实到期结果；历史回放不计入前瞻成绩。');
const m=utils.metrics(data.evaluations);review.append(node('p',`5日成熟记录 ${m.mature} 条 · 可评分 ${m.n} 条 · 命中 ${m.hits} 条 · 覆盖率 ${m.coverage===null?'待积累':fmt(m.coverage*100)+'%'}`,'research-value'));
review.append(node('p',m.n<30?'前瞻样本不足，不发布可靠胜率或“已提高准确率”结论。':'当前命中数不是独立样本胜率；重叠期限和市场阶段会影响解读。','research-notice'));
review.append(node('p',data.calendar_status==='missing'?'交易日历尚待核验：不凭归档文件数量推算到期日，也不把缺失行情当成零。':'评价依赖经核验日历；缺失到期价格继续等待，不移动目标日期。','research-muted'));
for(const h of [1,5,20]){const rows=data.evaluations.filter(r=>r.horizon===h&&r.status==='evaluated');const line=rows.length?`可评分${rows.length}条；本判断命中${rows.filter(r=>r.correct).length}；始终偏强基准命中${rows.filter(r=>r.baselines.always_up).length}；动量符号基准命中${rows.filter(r=>r.baselines.momentum_sign).length}`:'尚无可评分记录';review.append(node('p',`${h}交易日：${line}`));}
review.append(node('p',data.review_policy));host.append(review);
const history=section('05 / 冻结判断档案','生成时间、上线激活时间、证据与版本分别保留。点击每条查看原文，不对过去补写预测。');
for(const row of [...data.forecasts].reverse()){const d=node('details',undefined,'research-record');d.append(node('summary',`${when(row.issued_at)} · ${names[row.judgment]} · 数据 ${row.data_date} · ${row.model_version}`),node('p',row.analysis),node('p',data.activations&&data.activations[row.id]?`上线激活 ${when(data.activations[row.id])}`:'尚未上线激活，不计前瞻成绩'));const evaluations=data.evaluations.filter(e=>e.forecast_id===row.id);for(const target of row.targets){const ev=evaluations.find(e=>e.horizon===target.horizon);d.append(node('p',`${target.horizon}日 ${names[target.judgment]}：${ev?`${ev.due_date} 指数变化 ${fmt(ev.return_pct)}% · ${ev.correct===null?'观察、不计命中':ev.correct?'命中':'未命中'}`:'待到期/待核验数据'}`));}d.append(node('pre',JSON.stringify(row,null,2)));history.append(d);}const download=node('a','下载完整冻结账本（JSON）');download.href='data/research-ledger.json';download.target='_blank';download.rel='noopener';history.append(download);host.append(history);
}catch(e){if(id===serial){host.replaceChildren(node('p',e.message,'research-notice'));const retry=node('button','重新载入');retry.type='button';retry.addEventListener('click',()=>render(options));host.append(retry);}}
}
root.MarketScopeResearch={render};
})(typeof window!=='undefined'?window:globalThis);

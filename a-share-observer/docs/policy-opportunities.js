/* 安牛：政策机会研究，独立于资金证据；只读数据，使用 textContent。 */
(function opportunityModule(){
'use strict';
const stages={implemented:'已落地',published:'已公布',scheduled:'待生效',consultation:'征求意见',watch:'预期观察',proposal:'公司提议',expired:'已到期',cancelled:'已取消'};
const statusText={executed:'实际执行',planned:'计划或承诺',holding:'持仓证据',unknown:'待验证'};
const make=(tag,content,cls)=>{const n=document.createElement(tag);if(content!==undefined&&content!==null)n.textContent=content;if(cls)n.className=cls;return n;};
const safeLink=(url,label='查看来源')=>{const a=make('a',label,'po-link');if(typeof url==='string'&&/^https:\/\//.test(url)){a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}return make('span','尚无正式来源','po-muted');};
const button=(label,handler,cls)=>{const b=make('button',label,cls);b.type='button';b.addEventListener('click',handler);return b;};
const chip=(text,kind='')=>make('span',text,'po-chip '+kind);
function mount(host,head,getEvidence){
 if(host.querySelector('.po-switch'))return;
 const original=make('div',null,'po-original');
 [...host.children].filter(n=>n!==head).forEach(n=>original.append(n));
 const nav=make('nav',null,'po-switch');nav.setAttribute('aria-label','股票观察池研究视图');
 const pane=make('section',null,'po-pane');pane.id='policy-opportunities';pane.hidden=true;

 const home=make('section',null,'po-home');home.id='po-unified';
 let model=null,loading=false,current='home',researchTitle='政策机会观察池',homeSearch='',homeScope='all',focusCode=null;
 const resetFilter=()=>({horizon:'all',theme:'all',policy:'all',q:'',core:false,overlap:false,archived:false,buybackStatus:'all'});
 let filter=resetFilter();
 const overviewBtn=button('统一股票清单',()=>showView('home'),'po-tab');
 const evidenceBtn=button('资金证据池',()=>openEvidence(),'po-tab');
 const researchBtn=button('产业与政策池',()=>openResearch(),'po-tab');
 nav.append(overviewBtn,evidenceBtn,researchBtn);host.append(nav,home,original,pane);
 function showView(view){current=view;home.hidden=view!=='home';original.hidden=view!=='evidence';pane.hidden=view!=='research';for(const [b,k] of [[overviewBtn,'home'],[evidenceBtn,'evidence'],[researchBtn,'research']])b.setAttribute('aria-pressed',String(view===k));if(view==='home'){if(model)renderHome();else load();}else if(view==='research'){if(model)render();else load();}}
 function top(){nav.scrollIntoView({block:'start'});}
 function openEvidence(source='all',code=''){showView('evidence');const reset=document.getElementById('pf-reset');reset?.click();const sel=document.getElementById('pf-source');if(sel){sel.value=source;sel.dispatchEvent(new Event('change',{bubbles:true}));}if(code){const inp=document.getElementById('pf-search');if(inp){inp.value=code;inp.dispatchEvent(new Event('input',{bubbles:true}));}}top();}
 function openResearch(theme='all',code='',horizon='all',title='政策机会观察池',overlap=false){filter=resetFilter();filter.theme=theme;filter.q=code;filter.horizon=horizon;filter.overlap=overlap;researchTitle=title;focusCode=code||null;showView('research');top();}
 function load(){if(loading)return;loading=true;const target=current==='home'?home:pane;target.replaceChildren(make('p','正在读取政策研究数据…','pf-note'));fetch('data/policy-opportunities.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();}).then(j=>{if(j.schema_version!==1||!Array.isArray(j.events)||!Array.isArray(j.themes)||!Array.isArray(j.stocks))throw Error('schema');model=j;if(current==='home')renderHome();else if(current==='research')render();}).catch(()=>{const target=current==='home'?home:pane;target.replaceChildren(make('p','政策研究数据读取失败；不能据此判断没有政策或资金事件。','pf-note'),button('重新读取',load,'po-control'));}).finally(()=>loading=false);}
 const buyLabels={executed:'已披露成交',loan:'贷款承诺',planned:'已公布计划',proposal:'提议/预案',complete:'已完成',unknown:'待核线索',cancelled:'终止/取消'};
 function activeStocks(){return (model?.stocks||[]).filter(s=>s.state!=='archived');}
 function evidenceRows(){return getEvidence()?.stocks||[];}
 function united(){const map=new Map(activeStocks().map(s=>[s.code,{...s,evidence:null}]));for(const e of evidenceRows()){if(map.has(e.code))map.get(e.code).evidence=e;else if(!(model?.stocks||[]).some(s=>s.code===e.code&&s.state==='archived'))map.set(e.code,{code:e.code,name:e.name,priority:'观察',themes:[],horizons:[],drivers:[],evidence:e});}return [...map.values()].sort((a,b)=>(a.core_rank||999)-(b.core_rank||999)||Number(!!b.evidence)-Number(!!a.evidence)||a.code.localeCompare(b.code));}
 function renderHome(){if(!model)return;home.replaceChildren();const all=united(),active=activeStocks(),evidence=evidenceRows(),themeMap=new Map(model.themes.map(t=>[t.id,t.name]));
 const heading=make('div',null,'po-heading');const left=make('div');left.append(make('h3','值得关注的股票 · 统一清单'),make('p','一个股票只显示一次。先看股票，点击信息池卡片才展开对应的研究或资金证据。重点仅为研究优先级，不是买入建议。','pf-note'));const stamp=make('div',null,'po-time');stamp.append(make('strong','政策数据 '+model.as_of),make('small','资金证据 '+(getEvidence()?.as_of||'加载中或未取得')));heading.append(left,stamp);home.append(heading);
 const cards=make('section',null,'po-entry-grid');cards.setAttribute('aria-label','信息池入口');
 function card(name,value,desc,fn){const b=button('',fn,'po-entry');b.append(make('span',name,'po-entry-title'),make('strong',String(value),'po-entry-count'),make('small',desc),make('span','进入信息池 ›','po-entry-link'));cards.append(b);}
 const bbs=active.filter(s=>s.themes.includes('buyback'));card('增持回购',bbs.length,'含已成交、承诺、预案及待核线索',()=>openResearch('buyback','','all','增持回购信息池'));
 for(const [key,name,desc] of [['swap','互换便利','逐股标的未披露时保留未知'],['insurance','险资','具名持仓及权益变化'],['state','国资平台','实际增持及持仓'],['etf','主动ETF','披露持仓，不等于当日交易']])card(name,getEvidence()?evidence.filter(e=>e.tags.includes(key)).length:'—',desc+' · 已收录样本',()=>openEvidence(key));
 card('产业与政策',active.filter(s=>s.themes.some(t=>!['buyback','fundwatch','broker'].includes(t))).length,'电网、储能、算力、先进制造等',()=>openResearch('all','','medium','中期产业政策信息池'));
 card('短期稳市',active.filter(s=>s.horizons.includes('short')).length,'券商、回购、近期政策催化',()=>openResearch('all','','short','短期政策机会信息池'));
 card('资金证据总池',getEvidence()?evidence.length:'—','保留原证据、收藏、交叉筛选',()=>openEvidence());
 card('政策催化日历',model.events.length,'发布日期、待生效、征求意见',()=>{openResearch('all','','all','政策催化及产业研究');document.getElementById('po-calendar')?.scrollIntoView({block:'start'});});
 home.append(cards);
 const cov=model.buyback_coverage;const n=make('p',cov?`回购增持历史基准 ${cov.baseline_issuers} 家 / ${cov.baseline_events} 单；11月截至${cov.november_date}新增披露${cov.november_issuers}家。当前仅部分研究样本，不等于完整名单。`:'回购增持历史全量对账尚未完成。','po-coverage-note');home.append(n);
 const listSection=make('section',null,'po-section po-unified-section');listSection.append(make('h4','统一股票清单'));
 const controls=make('div',null,'po-unified-controls');const scopes=make('div',null,'po-scopes');
 const search=make('input');search.type='search';search.placeholder='搜索名称或股票代码';search.setAttribute('aria-label','搜索统一股票清单');search.value=homeSearch;search.oninput=()=>{homeSearch=search.value.trim().toLowerCase();draw();};controls.append(scopes,search);listSection.append(controls);
 const result=make('p',null,'po-muted');result.setAttribute('role','status');const list=make('div',null,'po-unified-list');listSection.append(result,list);home.append(listSection);
 function draw(){scopes.replaceChildren();for(const [id,label] of [['all','全部'],['core','重点'],['short','短期'],['medium','中期'],['buyback','增持回购'],['cross','资金证据交集']]){const b=button(label,()=>{homeScope=id;draw();},'po-control');b.setAttribute('aria-pressed',String(homeScope===id));scopes.append(b);}const rows=all.filter(s=>(!homeSearch||(s.name+' '+s.code).toLowerCase().includes(homeSearch))&&(homeScope==='all'||homeScope==='core'&&s.priority==='重点'||homeScope==='short'&&s.horizons.includes('short')||homeScope==='medium'&&s.horizons.includes('medium')||homeScope==='buyback'&&s.themes.includes('buyback')||homeScope==='cross'&&s.evidence&&s.themes.length));result.textContent=`显示 ${rows.length} / ${all.length} 只 · ${all.filter(s=>s.priority==='重点').length}只重点 · 去重合并`;list.replaceChildren();if(!rows.length)list.append(make('p','未匹配股票。','pf-empty'));for(const s of rows){const ev=s.evidence,bb=s.buyback_records||[],reason=s.drivers?.map(d=>d.logic).filter(Boolean).slice(0,2).join(' / ')||ev?.action||'待进一步研究';const row=button('',()=>{if(s.themes.includes('buyback'))openResearch('buyback',s.code,'all','增持回购信息池');else if(s.themes.length)openResearch('all',s.code,'all','个股政策研究');else openEvidence('all',s.code);},'po-unified-row');row.dataset.stockCode=s.code;const id=make('div',null,'po-unified-name');id.append(make('strong',s.name),make('small',s.code));const meta=make('div',null,'po-unified-meta');const labels=make('div',null,'po-stock-tags');if(s.priority==='重点')labels.append(chip('重点','po-confirmed'));s.horizons.forEach(h=>labels.append(chip(h==='short'?'短期':'中期')));if(bb.length)labels.append(chip(buyLabels[bb[0].status]||'待核'));if(ev)labels.append(chip('资金池记录'));meta.append(labels,make('span',reason,'po-unified-reason'));row.append(id,meta,make('span','›','po-unified-arrow'));list.append(row);}}
 draw();
 }
 host.addEventListener('aniu-policy-evidence-loaded',()=>{if(current==='home'&&model)renderHome();});

 function evidenceFor(code){return getEvidence()?.stocks?.find(x=>x.code===code);}
 function jumpEvidence(code){openEvidence('all',code);}
 function render(){
 if(!model)return;
 pane.replaceChildren();
 const title=make('div',null,'po-heading');const left=make('div');left.append(make('h3',researchTitle),make('p',model.scope,'pf-note'));const right=make('div',null,'po-time');right.append(make('strong','数据 '+model.as_of),make('small','最近核查 '+(model.checked_at||'未知')));title.append(left,right);pane.append(button('‹ 返回统一股票清单',()=>showView('home'),'po-control'),title);
 const staleDays=Math.floor((Date.now()-Date.parse(model.checked_at+'T23:59:59+08:00'))/86400000);if(staleDays>=3)pane.append(make('p','数据超过3日未核查，请谨慎使用并核对更新状态。','po-warning'));
 const counts=make('div',null,'po-counts');for(const [label,value] of [['研究候选',model.stocks.filter(s=>s.state!=='archived').length],['重点观察',model.stocks.filter(s=>s.priority==='重点'&&s.state!=='archived').length],['政策节点',model.events.length],['主题方向',model.themes.length]]){const cell=make('div');cell.append(make('small',label),make('strong',String(value)));counts.append(cell);}pane.append(counts);
 const evById=new Map(model.events.map(x=>[x.id,x])),themeById=new Map(model.themes.map(x=>[x.id,x]));
 const timeline=make('section',null,'po-section');timeline.id='po-calendar';timeline.append(make('h4','政策催化日历'));
 const upcoming=model.events.filter(e=>e.next_date&&e.next_date>=(model.checked_at||model.as_of)&&!['expired','cancelled'].includes(e.status)).sort((a,b)=>a.next_date.localeCompare(b.next_date));
 const recent=model.events.filter(e=>!upcoming.includes(e)&&e.status!=='watch').sort((a,b)=>(b.date||'').localeCompare(a.date||''));
 function eventItem(e){const d=make('details',null,'po-event');const sum=make('summary');const name=make('span',e.title,'po-event-name');sum.append(make('time',e.next_date||e.date||'日期待定','po-date'),name,chip(stages[e.status]||e.status,e.status==='scheduled'?'po-confirmed':''));
 d.append(sum);const inner=make('div',null,'po-event-body');inner.append(make('p',e.summary),make('p','下一步：'+e.next,'pf-note'),safeLink(e.source));const go=button('查看相关股票',()=>{filter.policy=e.id;filter.theme='all';filter.core=false;filter.horizon='all';filter.q='';render();document.getElementById('po-stock-list')?.scrollIntoView({block:'start'});},'po-control');inner.append(go);d.append(inner);return d;}
 const front=make('div',null,'po-event-list');if(upcoming.length)upcoming.forEach(e=>front.append(eventItem(e)));else front.append(make('p','暂无已确认的未来日期，关注政策进展。','pf-note'));timeline.append(front);
 const more=make('details',null,'po-more');more.append(make('summary',`近期已公布 / 待确认事项（${recent.length+model.events.filter(e=>e.status==='watch').length}）`));[...recent,...model.events.filter(e=>e.status==='watch')].forEach(e=>more.append(eventItem(e)));timeline.append(more);if(filter.theme!=='buyback'&&!focusCode)pane.append(timeline);
 const sector=make('section',null,'po-section');sector.append(make('h4','政策主线 · 点击筛选股票'));
 const table=make('div',null,'po-themes');[...model.themes].sort((a,b)=>a.rank-b.rank).forEach(t=>{const b=button('',()=>{filter.theme=filter.theme===t.id?'all':t.id;filter.policy='all';filter.core=false;render();document.getElementById('po-stock-list')?.scrollIntoView({block:'start'});},'po-theme');b.setAttribute('aria-pressed',String(filter.theme===t.id));b.append(make('strong',t.rank+'. '+t.name),make('span','短 '+t.short+' · 中 '+t.medium,'po-muted'),make('small',t.logic));table.append(b);});sector.append(table);if(filter.theme!=='buyback'&&!focusCode)pane.append(sector);
 const stocks=make('section',null,'po-section');stocks.id='po-stock-list';stocks.append(make('h4',filter.theme==='buyback'?'增持回购事件与研究候选':'个股研究清单'));if(filter.theme==='buyback'&&model.buyback_coverage){const c=model.buyback_coverage;const cov=make('div',null,'po-buyback-coverage');cov.append(make('strong','历史全量对账：未完成'),make('p',`${c.baseline_issuers}家 / ${c.baseline_events}单为官方历史基准；${c.november_issuers}家为11月新增披露统计，不能相加或当作已核验股票。`,'pf-note'),make('p',c.notes,'pf-note'));for(const a of c.sources||[])cov.append(safeLink(a.url,a.title));stocks.append(cov);}
 const bar=make('div',null,'po-controls');
 function toggle(label,active,fn){const b=button(label,()=>{fn();renderRows();},'po-control');b.setAttribute('aria-pressed',String(active));return b;}
 const scope=make('div',null,'po-scopes');
 function buildScope(){scope.replaceChildren(toggle('重点候选（'+model.stocks.filter(s=>s.priority==='重点'&&s.state!=='archived').length+'）',filter.core,()=>{filter.core=true;}),toggle('全部候选',!filter.core,()=>{filter.core=false;}),toggle('短期',filter.horizon==='short',()=>{filter.horizon=filter.horizon==='short'?'all':'short';filter.core=false;}),toggle('中期',filter.horizon==='medium',()=>{filter.horizon=filter.horizon==='medium'?'all':'medium';filter.core=false;}),toggle('资金证据交集',filter.overlap,()=>{filter.overlap=!filter.overlap;filter.core=false;}),toggle('含归档',filter.archived,()=>{filter.archived=!filter.archived;}));}
 bar.append(scope);
 function select(items,value,cb,label){const n=make('select');n.setAttribute('aria-label',label);items.forEach(([v,l])=>{const o=make('option',l);o.value=v;n.append(o);});n.value=value;n.onchange=()=>{cb(n.value);filter.core=false;renderRows();};return n;}
 const fields=make('div',null,'po-fields');const themeSelect=select([['all','全部主题'],...model.themes.map(t=>[t.id,t.name])],filter.theme,v=>{filter.theme=v;},'主题筛选');
 const policySelect=select([['all','全部政策'],...model.events.map(e=>[e.id,e.title])],filter.policy,v=>{filter.policy=v;},'政策筛选');
 const search=make('input');search.type='search';search.placeholder='搜索股票名称或代码';search.setAttribute('aria-label','搜索研究股票');search.value=filter.q;search.oninput=()=>{filter.q=search.value.trim().toLowerCase();if(filter.q)filter.core=false;renderRows();};
 const reset=button('重置',()=>{const theme=filter.theme==='buyback'?'buyback':'all';filter=resetFilter();filter.theme=theme;focusCode=null;render();},'po-control');fields.append(themeSelect,policySelect,search,reset);bar.append(fields);if(filter.theme==='buyback'){const stage=select([['all','全部事件状态'],...Object.entries(buyLabels)],filter.buybackStatus||'all',v=>{filter.buybackStatus=v;},'增持回购状态');bar.append(stage);}stocks.append(bar);
 const result=make('p',null,'po-muted');result.setAttribute('role','status');stocks.append(result);
 const list=make('div',null,'po-list');stocks.append(list);pane.append(stocks);
 function renderRows(){buildScope();let rows=model.stocks.filter(s=>(filter.archived||s.state!=='archived')&&(!filter.core||s.priority==='重点')&&(filter.horizon==='all'||s.horizons.includes(filter.horizon))&&(filter.theme==='all'||s.themes.includes(filter.theme))&&(filter.policy==='all'||(Array.isArray(evById.get(filter.policy)?.stock_codes)?evById.get(filter.policy).stock_codes.includes(s.code):s.themes.some(t=>themeById.get(t)?.policies.includes(filter.policy))))&&(!filter.q||(s.name+' '+s.code).toLowerCase().includes(filter.q))&&(!filter.overlap||!!evidenceFor(s.code))&&(!filter.buybackStatus||filter.buybackStatus==='all'||(s.buyback_records||[]).some(r=>r.status===filter.buybackStatus)));
 rows.sort((a,b)=>(a.core_rank||999)-(b.core_rank||999)||Math.min(...a.themes.map(t=>themeById.get(t)?.rank||999))-Math.min(...b.themes.map(t=>themeById.get(t)?.rank||999))||a.code.localeCompare(b.code));
 result.textContent=`显示 ${rows.length} / ${model.stocks.length} 只 · 研究顺序不是买入排名 · 点击股票展开逻辑、验证点和风险`;
 list.replaceChildren();
 if(!rows.length){list.append(make('p','当前筛选无候选。资金池样本不足不代表无真实资金买入。','pf-empty'));return;}
 rows.forEach(s=>{const detail=make('details',null,'po-stock');detail.dataset.stockCode=s.code;if(focusCode===s.code)detail.open=true;const summary=make('summary');const identity=make('span',null,'po-stock-name');identity.append(make('strong',s.name),make('small',s.code));const tags=make('span',null,'po-stock-tags');tags.append(chip(s.priority,s.priority==='重点'?'po-confirmed':''),...s.horizons.map(h=>chip(h==='short'?'短期':'中期')));const names=make('span',s.themes.map(t=>themeById.get(t)?.name||t).join(' / '),'po-stock-themes');const ev=evidenceFor(s.code);summary.append(identity,tags,names,make('small',ev?'资金池：'+(statusText[ev.status]||'待核'):'资金池暂无记录','po-stock-evidence'));detail.append(summary);
 const body=make('div',null,'po-stock-body');
 if(s.buyback_records?.length){const fmt=n=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(n<.1?4:2)+'亿元':'未核实';const bb=make('section',null,'po-buyback-records');bb.append(make('h5','增持回购事件 · 分计划保留'));for(const r of s.buyback_records){const block=make('div',null,'po-buyback-record');block.append(make('strong',buyLabels[r.status]||'待核'),make('p',(r.date||'披露日期待核')+' · '+r.subject+' · '+r.evidence_level,'po-muted'));const fields=make('dl',null,'po-buyback-fields');let remain='未核实';if(r.status==='complete'||r.status==='cancelled')remain='本期不再作为未来买盘';else if(r.status==='executed'&&typeof r.actual_100m==='number'&&typeof r.plan_min_100m==='number'&&typeof r.plan_max_100m==='number')remain=fmt(Math.max(0,r.plan_min_100m-r.actual_100m))+' / '+fmt(Math.max(0,r.plan_max_100m-r.actual_100m));for(const [k,v] of [['贷款承诺上限',fmt(r.loan_cap_100m)],['计划下限 / 上限',fmt(r.plan_min_100m)+' / '+fmt(r.plan_max_100m)],['披露实际成交',fmt(r.actual_100m)],['距计划下限 / 上限',remain],['计划到期',r.deadline||'待核'],['用途',r.purpose||'待核']])fields.append(make('dt',k),make('dd',v));block.append(fields,make('p',r.notes||'待核','pf-note'),safeLink(r.source,'事件来源'));for(const url of r.additional_sources||[])block.append(safeLink(url,'补充来源'));bb.append(block);}body.append(bb);}
 s.drivers.forEach(d=>{const t=themeById.get(d.theme);const block=make('div',null,'po-driver');block.append(make('strong',(t?.name||d.theme)+' · '+d.logic),make('p','传导：'+(t?.logic||'待核')),make('p','验证：'+(t?.verify||'待核')),make('p','风险：'+(t?.risk||'待核'),'po-muted'));(t?.policies||[]).forEach(p=>{const e=evById.get(p);if(e&&(!Array.isArray(e.stock_codes)||e.stock_codes.includes(s.code)))block.append(safeLink(e.source,e.title+' · '+(stages[e.status]||e.status)));});body.append(block);});
 for(const e of s.company_evidence||[]){const p=make('p',e.date+' '+e.stage+' ');p.append(safeLink(e.source,'公司披露'));body.append(p);}
 body.append(make('p','研究状态：'+s.review,'pf-note'));
 if(ev)body.append(button('查看该股原资金证据',()=>jumpEvidence(s.code),'po-control'));
 detail.append(body);list.append(detail);});
 }
 renderRows();
 const changes=make('details',null,'po-section po-more');changes.append(make('summary','更新记录与研究方法'));changes.append(make('p',model.method,'pf-note'));[...(model.change_log||[])].reverse().slice(0,30).forEach(c=>changes.append(make('p',c.date+' · '+c.summary,'pf-note')));pane.append(changes);
 }
 showView('home');
}
window.AniuPolicyOpportunities={mount};
})();

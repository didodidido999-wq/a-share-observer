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
 let model=null,loading=false,filter={horizon:'all',theme:'all',policy:'all',q:'',core:true,overlap:false,archived:false},lastFocus=null;
 const evidenceBtn=button('资金证据',()=>show(false),'po-tab');
 const researchBtn=button('政策机会 · 短中期',()=>show(true),'po-tab');
 nav.append(evidenceBtn,researchBtn);host.append(nav,original,pane);
 function show(open){original.hidden=open;pane.hidden=!open;evidenceBtn.setAttribute('aria-pressed',String(!open));researchBtn.setAttribute('aria-pressed',String(open));if(open){if(model)render();else load();}}
 function load(){if(loading)return;loading=true;pane.replaceChildren(make('p','正在读取政策机会研究…','pf-note'));
 fetch('data/policy-opportunities.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();}).then(j=>{if(j.schema_version!==1||!Array.isArray(j.events)||!Array.isArray(j.themes)||!Array.isArray(j.stocks))throw Error('schema');model=j;render();}).catch(()=>{pane.replaceChildren(make('p','政策机会数据读取失败。不能据此判断没有新政策。','pf-note'),button('重新读取',load,'po-control'));}).finally(()=>loading=false);}
 function evidenceFor(code){return getEvidence()?.stocks?.find(x=>x.code===code);}
 function jumpEvidence(code){show(false);const reset=document.getElementById('pf-reset');reset?.click();const inp=document.getElementById('pf-search');if(inp){inp.value=code;inp.dispatchEvent(new Event('input',{bubbles:true}));inp.focus();inp.scrollIntoView({block:'center'});}}
 function render(){
 if(!model)return;
 pane.replaceChildren();
 const title=make('div',null,'po-heading');const left=make('div');left.append(make('h3','政策机会观察池'),make('p',model.scope,'pf-note'));const right=make('div',null,'po-time');right.append(make('strong','数据 '+model.as_of),make('small','最近核查 '+(model.checked_at||'未知')));title.append(left,right);pane.append(title);
 const staleDays=Math.floor((Date.now()-Date.parse(model.checked_at+'T23:59:59+08:00'))/86400000);if(staleDays>=3)pane.append(make('p','数据超过3日未核查，请谨慎使用并核对更新状态。','po-warning'));
 const counts=make('div',null,'po-counts');for(const [label,value] of [['研究候选',model.stocks.filter(s=>s.state!=='archived').length],['重点观察',model.stocks.filter(s=>s.priority==='重点'&&s.state!=='archived').length],['政策节点',model.events.length],['主题方向',model.themes.length]]){const cell=make('div');cell.append(make('small',label),make('strong',String(value)));counts.append(cell);}pane.append(counts);
 const evById=new Map(model.events.map(x=>[x.id,x])),themeById=new Map(model.themes.map(x=>[x.id,x]));
 const timeline=make('section',null,'po-section');timeline.append(make('h4','政策催化日历'));
 const upcoming=model.events.filter(e=>e.next_date&&e.next_date>=(model.checked_at||model.as_of)&&!['expired','cancelled'].includes(e.status)).sort((a,b)=>a.next_date.localeCompare(b.next_date));
 const recent=model.events.filter(e=>!upcoming.includes(e)&&e.status!=='watch').sort((a,b)=>(b.date||'').localeCompare(a.date||''));
 function eventItem(e){const d=make('details',null,'po-event');const sum=make('summary');const name=make('span',e.title,'po-event-name');sum.append(make('time',e.next_date||e.date||'日期待定','po-date'),name,chip(stages[e.status]||e.status,e.status==='scheduled'?'po-confirmed':''));
 d.append(sum);const inner=make('div',null,'po-event-body');inner.append(make('p',e.summary),make('p','下一步：'+e.next,'pf-note'),safeLink(e.source));const go=button('查看相关股票',()=>{filter.policy=e.id;filter.theme='all';filter.core=false;filter.horizon='all';filter.q='';render();document.getElementById('po-stock-list')?.scrollIntoView({block:'start'});},'po-control');inner.append(go);d.append(inner);return d;}
 const front=make('div',null,'po-event-list');if(upcoming.length)upcoming.forEach(e=>front.append(eventItem(e)));else front.append(make('p','暂无已确认的未来日期，关注政策进展。','pf-note'));timeline.append(front);
 const more=make('details',null,'po-more');more.append(make('summary',`近期已公布 / 待确认事项（${recent.length+model.events.filter(e=>e.status==='watch').length}）`));[...recent,...model.events.filter(e=>e.status==='watch')].forEach(e=>more.append(eventItem(e)));timeline.append(more);pane.append(timeline);
 const sector=make('section',null,'po-section');sector.append(make('h4','政策主线 · 点击筛选股票'));
 const table=make('div',null,'po-themes');[...model.themes].sort((a,b)=>a.rank-b.rank).forEach(t=>{const b=button('',()=>{filter.theme=filter.theme===t.id?'all':t.id;filter.policy='all';filter.core=false;render();document.getElementById('po-stock-list')?.scrollIntoView({block:'start'});},'po-theme');b.setAttribute('aria-pressed',String(filter.theme===t.id));b.append(make('strong',t.rank+'. '+t.name),make('span','短 '+t.short+' · 中 '+t.medium,'po-muted'),make('small',t.logic));table.append(b);});sector.append(table);pane.append(sector);
 const stocks=make('section',null,'po-section');stocks.id='po-stock-list';stocks.append(make('h4','个股研究清单'));
 const bar=make('div',null,'po-controls');
 function toggle(label,active,fn){const b=button(label,()=>{fn();renderRows();},'po-control');b.setAttribute('aria-pressed',String(active));return b;}
 const scope=make('div',null,'po-scopes');
 function buildScope(){scope.replaceChildren(toggle('重点候选（'+model.stocks.filter(s=>s.priority==='重点'&&s.state!=='archived').length+'）',filter.core,()=>{filter.core=true;}),toggle('全部候选',!filter.core,()=>{filter.core=false;}),toggle('短期',filter.horizon==='short',()=>{filter.horizon=filter.horizon==='short'?'all':'short';filter.core=false;}),toggle('中期',filter.horizon==='medium',()=>{filter.horizon=filter.horizon==='medium'?'all':'medium';filter.core=false;}),toggle('资金证据交集',filter.overlap,()=>{filter.overlap=!filter.overlap;filter.core=false;}),toggle('含归档',filter.archived,()=>{filter.archived=!filter.archived;}));}
 bar.append(scope);
 function select(items,value,cb,label){const n=make('select');n.setAttribute('aria-label',label);items.forEach(([v,l])=>{const o=make('option',l);o.value=v;n.append(o);});n.value=value;n.onchange=()=>{cb(n.value);filter.core=false;renderRows();};return n;}
 const fields=make('div',null,'po-fields');const themeSelect=select([['all','全部主题'],...model.themes.map(t=>[t.id,t.name])],filter.theme,v=>{filter.theme=v;},'主题筛选');
 const policySelect=select([['all','全部政策'],...model.events.map(e=>[e.id,e.title])],filter.policy,v=>{filter.policy=v;},'政策筛选');
 const search=make('input');search.type='search';search.placeholder='搜索股票名称或代码';search.setAttribute('aria-label','搜索研究股票');search.value=filter.q;search.oninput=()=>{filter.q=search.value.trim().toLowerCase();if(filter.q)filter.core=false;renderRows();};
 const reset=button('重置',()=>{filter={horizon:'all',theme:'all',policy:'all',q:'',core:true,overlap:false,archived:false};themeSelect.value='all';policySelect.value='all';search.value='';renderRows();},'po-control');fields.append(themeSelect,policySelect,search,reset);bar.append(fields);stocks.append(bar);
 const result=make('p',null,'po-muted');result.setAttribute('role','status');stocks.append(result);
 const list=make('div',null,'po-list');stocks.append(list);pane.append(stocks);
 function renderRows(){buildScope();let rows=model.stocks.filter(s=>(filter.archived||s.state!=='archived')&&(!filter.core||s.priority==='重点')&&(filter.horizon==='all'||s.horizons.includes(filter.horizon))&&(filter.theme==='all'||s.themes.includes(filter.theme))&&(filter.policy==='all'||(Array.isArray(evById.get(filter.policy)?.stock_codes)?evById.get(filter.policy).stock_codes.includes(s.code):s.themes.some(t=>themeById.get(t)?.policies.includes(filter.policy))))&&(!filter.q||(s.name+' '+s.code).toLowerCase().includes(filter.q))&&(!filter.overlap||!!evidenceFor(s.code)));
 rows.sort((a,b)=>(a.core_rank||999)-(b.core_rank||999)||Math.min(...a.themes.map(t=>themeById.get(t)?.rank||999))-Math.min(...b.themes.map(t=>themeById.get(t)?.rank||999))||a.code.localeCompare(b.code));
 result.textContent=`显示 ${rows.length} / ${model.stocks.length} 只 · 研究顺序不是买入排名 · 点击股票展开逻辑、验证点和风险`;
 list.replaceChildren();
 if(!rows.length){list.append(make('p','当前筛选无候选。资金池样本不足不代表无真实资金买入。','pf-empty'));return;}
 rows.forEach(s=>{const detail=make('details',null,'po-stock');const summary=make('summary');const identity=make('span',null,'po-stock-name');identity.append(make('strong',s.name),make('small',s.code));const tags=make('span',null,'po-stock-tags');tags.append(chip(s.priority,s.priority==='重点'?'po-confirmed':''),...s.horizons.map(h=>chip(h==='short'?'短期':'中期')));const names=make('span',s.themes.map(t=>themeById.get(t)?.name||t).join(' / '),'po-stock-themes');const ev=evidenceFor(s.code);summary.append(identity,tags,names,make('small',ev?'资金池：'+(statusText[ev.status]||'待核'):'资金池暂无记录','po-stock-evidence'));detail.append(summary);
 const body=make('div',null,'po-stock-body');s.drivers.forEach(d=>{const t=themeById.get(d.theme);const block=make('div',null,'po-driver');block.append(make('strong',(t?.name||d.theme)+' · '+d.logic),make('p','传导：'+(t?.logic||'待核')),make('p','验证：'+(t?.verify||'待核')),make('p','风险：'+(t?.risk||'待核'),'po-muted'));(t?.policies||[]).forEach(p=>{const e=evById.get(p);if(e&&(!Array.isArray(e.stock_codes)||e.stock_codes.includes(s.code)))block.append(safeLink(e.source,e.title+' · '+(stages[e.status]||e.status)));});body.append(block);});
 for(const e of s.company_evidence||[]){const p=make('p',e.date+' '+e.stage+' ');p.append(safeLink(e.source,'公司披露'));body.append(p);}
 body.append(make('p','研究状态：'+s.review,'pf-note'));
 if(ev)body.append(button('查看该股原资金证据',()=>jumpEvidence(s.code),'po-control'));
 detail.append(body);list.append(detail);});
 }
 renderRows();
 const changes=make('details',null,'po-section po-more');changes.append(make('summary','更新记录与研究方法'));changes.append(make('p',model.method,'pf-note'));[...(model.change_log||[])].reverse().slice(0,30).forEach(c=>changes.append(make('p',c.date+' · '+c.summary,'pf-note')));pane.append(changes);
 }
 show(false);
}
window.AniuPolicyOpportunities={mount};
})();

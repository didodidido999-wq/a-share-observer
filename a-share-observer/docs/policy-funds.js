/* Policy-fund evidence workspace. Snapshot only; never infer real-time trades from financing or ETF PCF. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const sources={loan:'回购增持',swap:'互换便利',insurance:'险资',state:'国资平台',etf:'主动ETF'};
const statuses={executed:'已实际执行',planned:'计划或承诺',holding:'持仓证据',unknown:'待验证'};
const state={quick:'all',source:'all',combine:'or',status:'all',sort:'disclosed',search:'',selectedSources:[],favorites:new Set(),active:null,detail:'summary'};
let data=null,loading=null,ready=false,returnFocus=null;
try{state.favorites=new Set(JSON.parse(localStorage.getItem('policy-funds-favorites')||'[]'));}catch{}
const el=(tag,txt,cls)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined&&txt!==null)n.textContent=String(txt);return n;};
const label=(text,cl)=>el('span',text,'pf-label '+(cl||''));
const validUrl=url=>typeof url==='string'&&url.startsWith('https://')?url:null;
const link=(name,url)=>{const a=el('a',name);const v=validUrl(url);if(v){a.href=v;a.target='_blank';a.rel='noopener noreferrer';}else a.removeAttribute('href');return a;};
const note=(t)=>el('p',t,'pf-note');
const when=(r)=>r.event_date||r.disclosed||r.report_date||'';
const code=r=>r.code;
function saveFavorites(){try{localStorage.setItem('policy-funds-favorites',JSON.stringify([...state.favorites]));}catch{}}
function load(){if(data)return Promise.resolve(data);if(loading)return loading;
 loading=fetch('data/policy-funds.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();}).then(j=>{if(!Array.isArray(j.stocks))throw Error('数据结构不完整');data=j;return j;}).finally(()=>{loading=null;});
 return loading;}
function showTab(name,focus=false){
 const policy=name==='context',a=$('policy-content'),b=$('policy-funds-content');
 if(!a||!b)return;
 a.hidden=!policy;b.hidden=policy;
 for(const item of ['context','funds']){const t=$('policy-view-'+item);if(!t)continue;
 t.setAttribute('aria-selected',String(item===name));t.tabIndex=item===name?0:-1;t.classList.toggle('active',item===name);}
 if(!policy)mount();else closeDetail(false);
 if(focus)$('policy-view-'+name)?.focus();
}
function mount(){
 const host=$('policy-funds-content');if(!host||ready)return;ready=true;
 host.replaceChildren();
 const head=el('div',undefined,'pf-heading');const heading=el('div');heading.append(el('span','POLICY FUND EVIDENCE / 资金证据','pf-kicker'),el('h2','政策资金股票观察池'),note('资金事件按股票和主体分开。仅显示已收录证据，不等于完整名单、实时买入或买入建议。'));head.append(heading);host.append(head);
 const stats=el('div',undefined,'pf-overview');stats.id='pf-overview';host.append(stats);
 const warning=el('div',undefined,'pf-coverage');warning.id='pf-coverage';host.append(warning);
 const panel=el('section',undefined,'pf-workspace');panel.setAttribute('aria-label','政策资金股票观察池');
 const quick=el('div',undefined,'pf-quick');quick.id='pf-quick';quick.setAttribute('role','group');quick.setAttribute('aria-label','快捷筛选');
 for(const [key,title] of [['all','全部已核实'],['executed','实际执行'],['quality','中长线优选'],['cross','多来源线索'],['favorite','我的关注（本机）']]){const b=el('button',title);b.type='button';b.dataset.quick=key;quick.append(b);}
 panel.append(quick);
 const filters=el('div',undefined,'pf-filters');
 const makeSelect=(id,title,items)=>{const wrap=el('label',undefined,'pf-field');wrap.append(el('span',title));const sel=el('select');sel.id=id;for(const [v,n] of items){const o=el('option',n);o.value=v;sel.append(o);}wrap.append(sel);filters.append(wrap);return sel;};
 makeSelect('pf-source','资金来源',[['all','全部来源'],...Object.entries(sources)]);
 makeSelect('pf-status','证据级别',[['all','全部状态'],...Object.entries(statuses)]);
 makeSelect('pf-sort','排序',[['disclosed','最近披露'],['transaction','最近交易 / 报告期'],['code','股票代码']]);
 const search=el('label',undefined,'pf-field pf-search');search.append(el('span','搜索股票'));const input=el('input');input.id='pf-search';input.type='search';input.placeholder='名称或代码';search.append(input);filters.append(search);panel.append(filters);
 const more=el('details',undefined,'pf-advanced');const sum=el('summary','交叉筛选与数据说明');more.append(sum);const sourceGroup=el('fieldset',undefined,'pf-source-group');sourceGroup.append(el('legend','组合资金来源（可多选）'));
 for(const [key,name] of Object.entries(sources)){const l=el('label',undefined,'pf-source-check');const box=el('input');box.type='checkbox';box.value=key;box.dataset.sourceCheck=key;l.append(box,el('span',name));sourceGroup.append(l);}
 more.append(sourceGroup);
 const combine=el('label',undefined,'pf-combine');const andBox=el('input');andBox.type='checkbox';andBox.id='pf-and';combine.append(andBox,el('span','所选资金来源必须全部满足（AND）；不选时为任意来源（OR）'));more.append(combine,note('组合来源只说明不同资金证据存在，不代表不同机构在同日共同买入。'));const clear=el('button','清空筛选','pf-clear');clear.type='button';clear.id='pf-reset';panel.append(more,clear);
 const count=el('div',undefined,'pf-results');count.id='pf-results';count.setAttribute('role','status');panel.append(count);
 const area=el('div',undefined,'pf-rows');area.id='pf-rows';panel.append(area);host.append(panel);
 const foot=el('p','财务质量、未来成长和估值评级尚未完成逐股年报与最新财报核验，统一显示“待评估”，不会用示例分数替代真实研究。历史持仓快照不等于公告日交易；个人关注仅保存在当前浏览器。','pf-footer');host.append(foot);
 window.AniuPolicyOpportunities?.mount(host,head,()=>data);
 const backdrop=el('div',undefined,'pf-backdrop');backdrop.id='pf-backdrop';backdrop.hidden=true;
 const drawer=el('aside',undefined,'pf-drawer');drawer.id='pf-drawer';drawer.setAttribute('role','dialog');drawer.setAttribute('aria-modal','true');drawer.setAttribute('aria-labelledby','pf-detail-title');drawer.tabIndex=-1;backdrop.append(drawer);document.body.append(backdrop);
 backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeDetail();});
 document.addEventListener('keydown',e=>{if(backdrop.hidden)return;
 if(e.key==='Escape'){e.preventDefault();closeDetail();return;}
 if(e.key!=='Tab')return;
 const all=[...drawer.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled])')].filter(n=>n.getClientRects().length);
 if(!all.length){e.preventDefault();drawer.focus();return;}
 const first=all[0],last=all[all.length-1];
 if(e.shiftKey&&(document.activeElement===first||document.activeElement===drawer)){e.preventDefault();last.focus();}
 else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===drawer)){e.preventDefault();first.focus();}
 });
 quick.addEventListener('click',e=>{const btn=e.target.closest('button[data-quick]');if(btn){state.quick=btn.dataset.quick;renderListing();}});
 $('pf-source').addEventListener('change',e=>{state.source=e.target.value;state.selectedSources=[];for(const b of host.querySelectorAll('[data-source-check]'))b.checked=false;renderListing();});
 sourceGroup.addEventListener('change',()=>{state.selectedSources=[...sourceGroup.querySelectorAll('input:checked')].map(x=>x.value);if(state.selectedSources.length){state.source='all';$('pf-source').value='all';}renderListing();});
 $('pf-status').addEventListener('change',e=>{state.status=e.target.value;renderListing();});
 $('pf-sort').addEventListener('change',e=>{state.sort=e.target.value;renderListing();});
 input.addEventListener('input',e=>{state.search=e.target.value.trim().toLowerCase();renderListing();});
 $('pf-and').addEventListener('change',e=>{state.combine=e.target.checked?'and':'or';renderListing();});
 clear.addEventListener('click',()=>{Object.assign(state,{quick:'all',source:'all',selectedSources:[],status:'all',sort:'disclosed',search:'',combine:'or'});$('pf-source').value='all';$('pf-status').value='all';$('pf-sort').value='disclosed';$('pf-search').value='';$('pf-and').checked=false;for(const b of sourceGroup.querySelectorAll('input'))b.checked=false;renderListing();});
 area.addEventListener('click',e=>{const fav=e.target.closest('[data-favorite]');if(fav){const k=fav.dataset.favorite;state.favorites.has(k)?state.favorites.delete(k):state.favorites.add(k);saveFavorites();renderListing();return;}const btn=e.target.closest('button[data-open]');if(btn)openDetail(btn.dataset.open,btn);});
 host.querySelector('#pf-coverage').append(note('正在加载证据快照…'));
 load().then(()=>{renderOverview();renderListing();host.dispatchEvent(new Event('aniu-policy-evidence-loaded'));}).catch(()=>{$('pf-coverage').replaceChildren(note('资金证据读取失败：无法判断是否没有相关资金动作。'));const retry=el('button','重新读取');retry.onclick=()=>{ready=false;host.replaceChildren();backdrop.remove();mount();};$('pf-coverage').append(retry);});
}
function renderOverview(){
 const host=$('pf-overview');host.replaceChildren();
 for(const r of data.overview||[]){const box=el('div',undefined,'pf-stat');box.append(el('span',r.label,'pf-stat-label'),el('strong',r.value,'pf-stat-value'),el('small',r.basis,'pf-stat-foot'),link('核验口径 ↗',r.source));host.append(box);}
 const cov=$('pf-coverage');cov.replaceChildren();
 cov.append(el('strong','覆盖范围 · 部分核验样本'));
 cov.append(note('已收录 '+new Set(data.stocks.map(r=>r.code)).size+' 只去重股票、'+data.stocks.length+' 条事件；证监会902家、1110单只是历史对账基准，并非本站当前覆盖率。互换便利实际逐股标的仍未知。'));
 const det=el('details');det.append(el('summary','查看五类资金的数据缺口'));for(const [k,v] of Object.entries(data.coverage||{}))det.append(note((sources[k]||k)+'：'+v));cov.append(det);
 cov.append(el('small','快照核查基准 '+(data.as_of||'未知')+' · 非实时更新 · 日期均为北京时间'));
}
function listRows(){
 let rows=[...data.stocks].filter(r=>{
 if(state.selectedSources.length){const hits=state.selectedSources.filter(s=>r.tags.includes(s)).length;if(state.combine==='and'&&hits!==state.selectedSources.length)return false;if(state.combine==='or'&&!hits)return false;}
 else if(state.source!=='all'&&!r.tags.includes(state.source))return false;
 if(state.status!=='all'&&r.status!==state.status)return false;
 if(state.quick==='executed'&&r.status!=='executed')return false;
 if(state.quick==='quality'&&r.quality!=='A')return false;
 if(state.quick==='cross'&&r.tags.length<2)return false;
 if(state.quick==='favorite'&&!state.favorites.has(r.code))return false;
 if(state.search&&!(r.name+' '+r.code).toLowerCase().includes(state.search))return false;
 
 return true;});
 rows.sort((a,b)=>state.sort==='code'?a.code.localeCompare(b.code):
 String((state.sort==='transaction'?(b.event_date||b.report_date):b.disclosed)||'').localeCompare(String((state.sort==='transaction'?(a.event_date||a.report_date):a.disclosed)||''))||a.code.localeCompare(b.code));
 return rows;
}
function renderListing(){
 if(!data)return;
 for(const b of $('pf-quick').querySelectorAll('button[data-quick]'))b.setAttribute('aria-pressed',String(b.dataset.quick===state.quick));
 const rows=listRows(),target=$('pf-rows');$('pf-results').textContent='显示 '+rows.length+' / '+data.stocks.length+' 条事件 · 仅展示已收录案例 · '+(state.selectedSources.length?(state.combine==='and'?'多来源交集':'多来源并集'):'单来源筛选');
 target.replaceChildren();
 if(!rows.length){target.append(el('div',state.quick==='quality'?'尚无逐股核实完成的中长线A级评级；不能用资金事件代替基本面结论。':'当前条件下没有已核验证据；不代表市场上不存在符合条件的股票。','pf-empty'));return;}
 const head=el('div',undefined,'pf-table-head');for(const h of ['股票','资金线索','最新可核验事件','证据','基本面 / 估值','披露日','关注'])head.append(el('span',h));target.append(head);
 for(const r of rows){
 const row=el('div',undefined,'pf-row');
 const name=el('button',undefined,'pf-stock');name.type='button';name.dataset.open=String(data.stocks.indexOf(r));name.append(el('strong',r.name),el('small',r.code));row.append(name);
 const tags=el('div',undefined,'pf-tags');for(const t of r.tags.slice(0,2))tags.append(label(sources[t]));if(r.tags.length>2)tags.append(label('+'+(r.tags.length-2)));row.append(tags);
 const action=el('div',undefined,'pf-action');action.append(el('strong',r.action),el('small',r.cash&&r.cash!=='—'?r.cash:'金额未披露或不适用'));row.append(action);
 row.append(label(statuses[r.status]||'待验证','pf-status-'+r.status));
 row.append(el('span','待评估','pf-unrated'));
 row.append(el('time',r.disclosed||'未核实','pf-date'));
 const favorite=el('button',state.favorites.has(r.code)?'★':'☆','pf-favorite');favorite.type='button';favorite.dataset.favorite=r.code;favorite.setAttribute('aria-label',(state.favorites.has(r.code)?'取消关注':'加入关注')+r.name);favorite.setAttribute('aria-pressed',String(state.favorites.has(r.code)));row.append(favorite);
 target.append(row);
 }
}
function openDetail(id,trigger){
 const r=data.stocks[Number(id)];if(!r)return;state.active=r;state.detail='summary';returnFocus=trigger||document.activeElement;const back=$('pf-backdrop');back.hidden=false;document.body.classList.add('pf-drawer-open');drawDetail();$('pf-drawer').focus();
}
function closeDetail(restore=true){
 const back=$('pf-backdrop');if(!back||back.hidden)return;back.hidden=true;document.body.classList.remove('pf-drawer-open');state.active=null;if(restore&&returnFocus?.isConnected)returnFocus.focus();
}
function drawDetail(){
 const r=state.active,drawer=$('pf-drawer');if(!r||!drawer)return;
 drawer.replaceChildren();const head=el('div',undefined,'pf-detail-head');const title=el('div');title.append(el('span',r.code+' · '+r.kind,'pf-kicker'),el('h2',r.name));title.lastChild.id='pf-detail-title';head.append(title);const close=el('button','关闭 ×','pf-detail-close');close.type='button';close.onclick=()=>closeDetail();head.append(close);drawer.append(head);
 const tabs=el('div',undefined,'pf-detail-tabs');for(const [key,t] of [['summary','概览'],['events','资金记录'],['quality','基本面']]){const b=el('button',t);b.type='button';b.setAttribute('aria-pressed',String(state.detail===key));b.onclick=()=>{state.detail=key;drawDetail();};tabs.append(b);}drawer.append(tabs);
 const body=el('div',undefined,'pf-detail-body');
 if(state.detail==='summary'){
  const tags=el('div',undefined,'pf-tags');r.tags.forEach(t=>tags.append(label(sources[t])));body.append(tags,el('h3',r.action),label(statuses[r.status],'pf-status-'+r.status));
  body.append(note('主体：'+r.subject),note('已披露金额／计划规模：'+(r.cash||'未披露')),note('资金性质：'+r.funding),note('核验限制：'+r.basis));
  body.append(el('h3','中长线判断 · 待评估'),note('尚未完成三年财报、未来增长驱动、经营现金流和当前估值的逐项验证。不会因为国资、险资或ETF出现就自动给A级。'));
 }else if(state.detail==='events'){
  const dl=el('dl',undefined,'pf-meta');
  for(const [k,v] of [['动作类型',r.kind],['资金主体',r.subject],['实际交易或累计进展截至',r.event_date||'未单独确认'],['持仓报告期',r.report_date||'不适用'],['公告日期',r.disclosed||'待核'],['本系统样本日期',data.as_of],['数量',r.quantity||'—'],['金额',r.cash||'—'],['资金口径',r.funding]]){dl.append(el('dt',k),el('dd',v));}
  body.append(dl,note('一个股票可能有多笔不同主体的事件；当前仅展示所选事件，不是完整事件台账。'));
 }else{
  body.append(el('h3','财务质量：待评估'),note('需补齐最近三年营收、扣非净利、ROE/ROIC、经营现金流、自由现金流与负债变化。'));
  body.append(el('h3','未来2—3年成长：待评估'),note('需有公司披露的订单、产能、行业需求及竞争壁垒证据，并附验证节点；不得将研究假设当作业绩预测。'));
  body.append(el('h3','估值吸引力：待评估'),note('估值需要价格时点与可比口径，资金增持不自动代表低估。'));
 }
 body.append(el('div',undefined,'pf-source-link'));body.lastChild.append(link('查看本条披露来源 ↗',r.source));drawer.append(body);
}
function boot(){
 const tabContext=$('policy-view-context'),tabFunds=$('policy-view-funds');if(!tabContext||!tabFunds)return;
 for(const [t,name] of [[tabContext,'context'],[tabFunds,'funds']]){t.addEventListener('click',()=>showTab(name));t.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();showTab(name==='context'?'funds':'context',true);});}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
window.MarketScopePolicyFunds={showTab};
})();
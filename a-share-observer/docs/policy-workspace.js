/* 安牛政策研究工作区：三视图、统一股票清单、独立证据与严格历史档案。 */
(function policyWorkspace(root){
'use strict';
const d=root.document;
const sourceNames={buyback:'增持回购',loan:'回购增持专项贷款',swap:'互换便利',insurance:'险资',state:'国资平台',etf:'主动ETF'};
const labels={executed:'已披露成交',loan:'贷款承诺',planned:'已公布计划',proposal:'提议 / 预案',complete:'已完成',unknown:'待核线索',cancelled:'终止 / 取消',holding:'持仓证据',implemented:'已落地',published:'已公布',scheduled:'待生效',consultation:'征求意见',watch:'预期观察',expired:'已到期'};
const stockStatuses=new Set(['executed','loan','planned','proposal','holding','complete','unknown','cancelled']);
const n=(tag,txt,cls)=>{const el=d.createElement(tag);if(txt!=null)el.textContent=String(txt);if(cls)el.className=cls;return el;};
const btn=(txt,fn,cls='pw-button')=>{const b=n('button',txt,cls);b.type='button';b.addEventListener('click',fn);return b;};
const link=(txt,url)=>{if(typeof url!=='string'||!/^https?:\/\//.test(url))return n('span','来源待核','pw-muted');const a=n('a',txt,'pw-link');a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
const badge=(s)=>n('span',labels[s]||s||'待核','pw-status '+(s==='executed'?'pw-actual':s==='unknown'||s==='watch'?'pw-uncertain':''));
const memo=t=>n('p',t,'pw-muted');
const unique=a=>[...new Set(a)];
const day=t=>typeof t==='string'?t.slice(0,10):'';
const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const fmtDate=t=>{if(!t)return '日期未定';const a=new Date(t);return Number.isFinite(a.getTime())?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short'}).format(a)+' 北京时间':'日期待核';};
const money=v=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:v<.1?4:2})+'亿元':'未核实';
const hasNum=v=>typeof v==='number'&&Number.isFinite(v);
const details=(title,body,cls='pw-detail')=>{const e=n('details',null,cls);e.append(n('summary',title),body);return e;};
const dl=rows=>{const e=n('dl',null,'pw-dl');for(const [k,v] of rows)e.append(n('dt',k),n('dd',v==null?'待核':v));return e;};
const select=(label,items,value,onchange)=>{const s=n('select');s.setAttribute('aria-label',label);for(const [id,txt] of items){const o=n('option',txt);o.value=id;s.append(o);}s.value=value;s.onchange=()=>onchange(s.value);return s;};
const search=(label,value,oninput)=>{const i=n('input');i.type='search';i.placeholder=label;i.setAttribute('aria-label',label);i.value=value;i.oninput=()=>oninput(i.value);return i;};
const section=(title,sub,id)=>{const e=n('section',null,'pw-panel');if(id)e.id=id;e.append(n('h3',title));if(sub)e.append(memo(sub));return e;};
const kindText={official_commentary:'官方解读',policy:'正式政策',statistic:'统计事实'};
let host,ctx,view='stocks',archiveMode='current',calendarDays=30,macroKind='all',lastAnchor=null,loadPromise=null,drawSerial=0,dialog=null,previousFocus=null;
const data={opportunities:null,funds:null,context:null};
const errors={};
const fileNames={opportunities:'policy-opportunities.json',funds:'policy-funds.json',context:'policy-context.json'};
const sourceTitle={opportunities:'股票机会',funds:'资金披露',context:'宏观政策档案'};
let stockFilter={scope:'core',horizon:'all',theme:'all',q:''};
let fundFilter={source:'all',status:'all',q:'',favorites:false};
let favorites=new Set();try{favorites=new Set(JSON.parse(root.localStorage.getItem('policy-funds-favorites')||'[]'));}catch{}
function saveFav(){try{root.localStorage.setItem('policy-funds-favorites',JSON.stringify([...favorites]));}catch{}}
function valid(k,j){return j&&j.schema_version===1&&(k==='opportunities'?Array.isArray(j.stocks)&&Array.isArray(j.themes)&&Array.isArray(j.events):k==='funds'?Array.isArray(j.stocks):Array.isArray(j.records)&&Array.isArray(j.events));}
async function load(force=false){if(loadPromise)return loadPromise;
const keys=Object.keys(fileNames).filter(k=>force||!data[k]);if(!keys.length)return;
loadPromise=Promise.allSettled(keys.map(async k=>{try{const r=await root.fetch('data/'+fileNames[k],{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();if(!valid(k,j))throw Error('数据结构不完整');data[k]=j;delete errors[k];}catch(e){errors[k]=String(e.message||e);}})).finally(()=>{loadPromise=null;});
return loadPromise;}
function stocks(){const m=new Map();for(const s of data.opportunities?.stocks||[])if(s.state!=='archived')m.set(s.code,{...s,old:null});
for(const old of data.funds?.stocks||[]){if(m.has(old.code))m.get(old.code).old=old;else if(!(data.opportunities?.stocks||[]).some(s=>s.code===old.code&&s.state==='archived'))m.set(old.code,{code:old.code,name:old.name,priority:'观察',horizons:[],themes:[],drivers:[],old,review:'只有资金线索，未完成研究评估'});}
return [...m.values()].sort((a,b)=>(a.core_rank||999999)-(b.core_rank||999999)||a.code.localeCompare(b.code));}
function allFundEntries(s){
const rows=(s.buyback_records||[]).map(r=>({kind:'buyback',r,status:stockStatuses.has(r.status)?r.status:'unknown',sources:['buyback',...(hasNum(r.loan_cap_100m)||r.status==='loan'?['loan']:[])]}));
if(s.old){const r=s.old,src=unique((r.tags||[]).filter(t=>sourceNames[t]));const same=rows.find(e=>r.source&&e.r.source===r.source&&src.includes('loan'));if(same){same.sources=unique([...same.sources,...src]);same.legacy=r;}else rows.push({kind:'legacy',r,status:stockStatuses.has(r.status)?r.status:'unknown',sources:src});}
return rows;}
function matchingFundEntries(s,source='all',status='all'){return allFundEntries(s).filter(e=>(source==='all'||e.sources.includes(source))&&(status==='all'||e.status===status));}
function fundStatus(s){const rows=allFundEntries(s);if(!rows.length)return '政策研究';const pref=['executed','loan','planned','proposal','holding','complete','unknown','cancelled'];const keys=pref.filter(k=>rows.some(r=>r.status===k));return (labels[keys[0]]||'待核')+(keys.length>1?' 等':'');}
function reasons(s){const themeMap=new Map((data.opportunities?.themes||[]).map(t=>[t.id,t.name]));const ds=unique((s.drivers||[]).map(x=>x.logic).filter(Boolean));return ds.length?ds.slice(0,2).join('；'):s.old?.action||s.themes?.map(t=>themeMap.get(t)||t).join('、')||'待研究';}
function show(v){view=v;closeDialog();renderShell();}
function getAnchor(){try{const hash=root.location.hash||'';return hash.startsWith('#policy?')?new URLSearchParams(hash.split('?')[1]).get('anchor'):null;}catch{return null;}}
function routeAnchor(a){if(!a)return false;return ['policy-calendar','policy-macro','policy-recent-due'].includes(a)||(data.context?.records||[]).some(r=>r.id===a)||(data.context?.events||[]).some(r=>r.id===a)||(data.opportunities?.events||[]).some(r=>r.id===a);}
function render(c){ctx=c||ctx;host=d.getElementById('policy-workspace');if(!host)return;
const a=getAnchor(),seq=++drawSerial;if(a&&a!==lastAnchor){view='policy';archiveMode='current';calendarDays=30;}
lastAnchor=a;
if(!data.opportunities&&!data.funds&&!data.context){host.replaceChildren(memo('正在读取政策、资金和股票研究…'));}else renderShell();
load().then(()=>{if(seq!==drawSerial)return;if(a&&routeAnchor(a))view='policy';renderShell();});}
function renderShell(){if(!host)return;host.replaceChildren();host.className='pw-workspace';
const nav=n('nav',null,'pw-nav');nav.setAttribute('aria-label','政策板块');
for(const [key,title] of [['stocks','股票机会'],['policy','政策与日历'],['funds','资金追踪']]){const b=btn(title,()=>show(key),'pw-tab');b.dataset.view=key;b.setAttribute('aria-current',view===key?'page':'false');nav.append(b);}host.append(nav);
const strip=n('div',null,'pw-data-strip');const bits=[];if(data.opportunities)bits.push('股票研究 '+(data.opportunities.as_of||'日期待核'));if(data.funds)bits.push('原资金证据 '+(data.funds.as_of||'日期待核'));if(data.context)bits.push('宏观核查 '+day(data.context.checked_at));strip.append(n('span',bits.join('　·　')||'数据尚未取得'),btn('刷新数据',async()=>{await load(true);renderShell();},'pw-text-button'));host.append(strip);
const problems=Object.keys(errors);if(problems.length)host.append(n('p',problems.map(k=>sourceTitle[k]+'读取失败'+(data[k]?'（保留上次成功快照）':'')).join('；')+'。缺失不等于无事件。','pw-warning'));
const staleDate=data.opportunities?.checked_at;if(staleDate&&today()>new Date(Date.parse(staleDate+'T00:00:00Z')+3*86400000).toISOString().slice(0,10))host.append(n('p','股票研究已超过3天未核查，请核对最新公告。','pw-warning'));
const content=n('div',null,'pw-content');host.append(content);
if(view==='stocks')drawStocks(content);else if(view==='policy')drawPolicy(content);else drawFunds(content);
}
function drawStocks(host){
if(!data.opportunities&&!data.funds){host.append(memo('研究数据暂不可用。'));return;}
const all=stocks(),core=all.filter(s=>s.priority==='重点'),tmap=new Map((data.opportunities?.themes||[]).map(t=>[t.id,t]));
const h=n('div',null,'pw-heading');h.append(n('h2','股票机会'),n('span',`${core.length}只重点 / ${all.length}只候选`,'pw-total'));host.append(h,memo('以研究优先级排序，不是上涨概率或交易评级。短期 5—20 个交易日，中期 1—6 个月。点击股票查看政策、资金和风险。'));
const panel=n('section',null,'pw-panel');const controls=n('div',null,'pw-filters');const scopes=n('div',null,'pw-segment');
const scopeBtns=[];for(const [id,txt] of [['core','重点'],['all','全部候选'],['favorite','我的关注']]){const b=btn(txt,()=>{stockFilter.scope=id;update();},'pw-seg');b.dataset.scope=id;scopeBtns.push([id,b]);scopes.append(b);}controls.append(scopes,select('研究期限',[['all','全部期限'],['short','短期'],['medium','中期']],stockFilter.horizon,v=>{stockFilter.horizon=v;update();}),select('产业方向',[['all','全部方向'],...[...tmap.values()].sort((a,b)=>a.rank-b.rank).map(t=>[t.id,t.name])],stockFilter.theme,v=>{stockFilter.theme=v;update();}),search('搜索股票名称 / 代码',stockFilter.q,v=>{stockFilter.q=v;update();}));panel.append(controls);
const status=n('p',null,'pw-result');status.setAttribute('role','status');panel.append(status);const list=n('div',null,'pw-stock-list');list.id='policy-opportunity-list';panel.append(list);host.append(panel);
function update(){for(const [id,b] of scopeBtns)b.setAttribute('aria-pressed',String(stockFilter.scope===id));const q=stockFilter.q.trim().toLowerCase();const rows=all.filter(s=>(stockFilter.scope==='all'||stockFilter.scope==='core'&&s.priority==='重点'||stockFilter.scope==='favorite'&&favorites.has(s.code))&&(stockFilter.horizon==='all'||(s.horizons||[]).includes(stockFilter.horizon))&&(stockFilter.theme==='all'||(s.themes||[]).includes(stockFilter.theme))&&(!q||(s.code+' '+s.name).toLowerCase().includes(q)));
status.textContent=`显示 ${rows.length} 只 · ${stockFilter.scope==='core'?'重点研究':stockFilter.scope==='favorite'?'本机收藏':'全部候选'}`;
list.replaceChildren();if(!rows.length){list.append(memo('当前筛选无匹配股票。'));return;}
const head=n('div',null,'pw-stock-head');for(const t of ['股票','关注理由','研究期限','资金线索'])head.append(n('span',t));list.append(head);
for(const s of rows){const row=btn('',()=>openStock(s.code),'pw-stock-row');row.dataset.code=s.code;const id=n('span',null,'pw-stock-id');id.append(n('strong',s.name),n('small',s.code+(stockFilter.scope!=='core'&&s.priority==='重点'?' · 重点':'')));const term=(s.horizons||[]).map(h=>h==='short'?'短期':'中期').join(' / ')||'待评估';row.append(id,n('span',reasons(s),'pw-stock-reason'),n('span',term,'pw-stock-term'),n('span',fundStatus(s),'pw-stock-evidence'));row.setAttribute('aria-label','查看'+s.name+' '+s.code+'详情');list.append(row);}}
update();}
function openDialog(title,subtitle,body,code){
closeDialog();previousFocus=d.activeElement;dialog=n('dialog',null,'pw-dialog');dialog.setAttribute('aria-labelledby','pw-detail-title');const header=n('div',null,'pw-dialog-head');const left=n('div');const h=n('h2',title);h.id='pw-detail-title';left.append(h,memo(subtitle));const actions=n('div',null,'pw-dialog-actions');if(code){const star=btn(favorites.has(code)?'取消关注':'加入关注',()=>{if(favorites.has(code))favorites.delete(code);else favorites.add(code);saveFav();star.textContent=favorites.has(code)?'取消关注':'加入关注';},'pw-button');actions.append(star);}actions.append(btn('关闭 ×',closeDialog,'pw-button'));header.append(left,actions);dialog.append(header,body);d.body.append(dialog);dialog.addEventListener('close',()=>{const old=dialog;dialog=null;old?.remove();if(view==='stocks'&&stockFilter.scope==='favorite')renderShell();if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});});dialog.showModal();}
function closeDialog(){if(!dialog)return;const old=dialog;dialog=null;old.remove();if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}
function openStock(code,source='all'){
const s=stocks().find(x=>x.code===code);if(!s)return;const body=n('div',null,'pw-dialog-body');const themeMap=new Map((data.opportunities?.themes||[]).map(t=>[t.id,t]));const eventMap=new Map((data.opportunities?.events||[]).map(e=>[e.id,e]));
const overview=section('关注理由',null);overview.append(n('p',reasons(s)),memo((s.priority==='重点'?'重点研究':'观察候选')+' · '+((s.horizons||[]).map(h=>h==='short'?'短期':'中期').join(' / ')||'期限待评估')));body.append(overview);
const fund=section('资金与公司行动','按计划及披露主体分开；承诺、提款、成交及持仓不是同一概念。');const rows=matchingFundEntries(s,source);
if(!rows.length)fund.append(memo('该分类暂无已收录记录，不代表没有真实交易。'));for(const e of rows)fund.append(fundDetail(e));if(rows.length&&source!=='all')fund.append(btn('查看该股全部资金记录',()=>openStock(code),'pw-text-button'));body.append(fund);
const policy=section('相关政策及产业逻辑',null);if(!(s.drivers||[]).length)policy.append(memo('尚未完成产业研究。'));for(const a of s.drivers||[]){const t=themeMap.get(a.theme);const block=n('div',null,'pw-record');block.append(n('h4',(t?.name||a.theme)+' · '+a.logic),memo('传导：'+(t?.logic||'待核')),memo('验证：'+(t?.verify||'待核')),memo('风险：'+(t?.risk||'待核')));for(const id of t?.policies||[]){const event=eventMap.get(id);if(event&&(!Array.isArray(event.stock_codes)||event.stock_codes.includes(s.code)))block.append(link(event.title+' · '+(labels[event.status]||event.status),event.source));}policy.append(block);}body.append(policy);
if(s.company_evidence?.length){const e=section('公司披露补充',null);for(const x of s.company_evidence){const row=n('p',(x.date||'日期待核')+' · '+x.stage+' ');row.append(link('来源',x.source));e.append(row);}body.append(e);}
const risk=section('基本面、估值与风险','没有逐股核验时不得用研究优先级代替财务评级。');risk.append(n('p',s.review||'待评估'),memo('原资金证据评级：'+(s.old?.quality||'待评估')));body.append(risk);
openDialog(s.name,s.code,body,code);}
function fundDetail(e){const r=e.r,box=n('article',null,'pw-record pw-fund-record');const title=n('div',null,'pw-record-head');title.append(n('strong',e.kind==='buyback'?(r.subject||'主体待核')+' · 增持回购':r.action||r.kind||'资金披露'),badge(e.status));box.append(title,memo((r.date||r.disclosed||'披露日期待核')+' · '+e.sources.map(x=>sourceNames[x]).join(' / ')));
if(e.kind==='buyback'){let remain='未核实';if(['complete','cancelled'].includes(r.status))remain='本期不再计为潜在买盘';else if(r.status==='executed'&&hasNum(r.actual_100m)&&hasNum(r.plan_min_100m)&&hasNum(r.plan_max_100m))remain=money(Math.max(0,r.plan_min_100m-r.actual_100m))+' / '+money(Math.max(0,r.plan_max_100m-r.actual_100m));box.append(dl([['贷款承诺上限',money(r.loan_cap_100m)],['计划下限 / 上限',money(r.plan_min_100m)+' / '+money(r.plan_max_100m)],['累计成交',money(r.actual_100m)],['距计划下限 / 上限',remain],['到期日',r.deadline||'待核'],['用途',r.purpose||'待核'],['证据级别',r.evidence_level||'待核']]),memo(r.notes||'无进一步核验说明。'),link('披露来源',r.source));for(const url of r.additional_sources||[])box.append(link('补充来源',url));if(e.legacy)box.append(memo('原资金池存在同来源记录，合并显示；'+(e.legacy.basis||'')));}
else box.append(dl([['主体',r.subject],['事件日',r.event_date],['报告期',r.report_date],['金额',r.cash],['数量',r.quantity],['资金口径',r.funding]]),memo((r.basis||'待核')+'。资金来源标签仅为原收录线索，需以具体主体和公告核实。'),link('披露来源',r.source));return box;}
function drawFunds(host){
const all=stocks(),rows=all.filter(s=>allFundEntries(s).length);
host.append(n('h2','资金追踪'),memo('关注真实资金动作与尚未执行的计划。资金证据独立于股票研究排序；目前仍为部分核验样本。'));
const overview=section('资金政策规模','各工具口径可能重叠，不能合计为实际入市金额。');const summary=n('div',null,'pw-fund-summary');
for(const r of data.funds?.overview||[]){const cell=n('div');cell.append(n('span',r.label,'pw-muted'),n('strong',r.value),memo(r.basis),link('核验来源',r.source));summary.append(cell);}if(!data.funds?.overview?.length)summary.append(memo('资金规模快照未读取。'));overview.append(summary);host.append(overview);
const cov=data.opportunities?.buyback_coverage;if(cov){const b=n('div');b.append(memo(`官方历史基准 ${cov.baseline_issuers}家 / ${cov.baseline_events}单（截至${cov.baseline_date}）。11月披露统计${cov.november_issuers}家；不能简单相加。`),memo(cov.notes));for(const s of cov.sources||[])b.append(link(s.title,s.url));for(const [k,v] of Object.entries(data.funds?.coverage||{}))b.append(memo((sourceNames[k]||k)+'：'+v));host.append(details('覆盖范围与缺口 · '+(cov.status||'待核'),b,'pw-disclosure'));}else host.append(memo('历史902家全量对账尚未确认完成。'));
const panel=section('逐股资金记录',null,'policy-fund-list');const controls=n('div',null,'pw-filters');controls.append(select('资金来源',[['all','全部来源'],...Object.entries(sourceNames)],fundFilter.source,v=>{fundFilter.source=v;update();}),select('资金状态',[['all','全部状态'],...['executed','loan','planned','proposal','holding','complete','unknown','cancelled'].map(k=>[k,labels[k]])],fundFilter.status,v=>{fundFilter.status=v;update();}),search('搜索股票名称 / 代码',fundFilter.q,v=>{fundFilter.q=v;update();}));const fav=btn('我的关注',()=>{fundFilter.favorites=!fundFilter.favorites;update();},'pw-seg');controls.append(fav);panel.append(controls);const result=n('p',null,'pw-result');result.setAttribute('role','status');panel.append(result);const list=n('div',null,'pw-fund-list');panel.append(list);host.append(panel);
function update(){fav.setAttribute('aria-pressed',String(fundFilter.favorites));const q=fundFilter.q.trim().toLowerCase();const hits=rows.map(s=>({s,entries:matchingFundEntries(s,fundFilter.source,fundFilter.status)})).filter(x=>x.entries.length&&(!fundFilter.favorites||favorites.has(x.s.code))&&(!q||(x.s.code+' '+x.s.name).toLowerCase().includes(q)));result.textContent=`显示 ${hits.length}只 · 按股票去重；事件分计划核对`;list.replaceChildren();if(!hits.length){list.append(memo(fundFilter.source==='swap'?'尚无已收录的逐股买入证据；机构中标不等于买入该股票。':'当前筛选没有已收录记录，不能推断市场不存在此类事件。'));return;}const head=n('div',null,'pw-fund-head');for(const v of ['股票','最新收录线索','证据状态'])head.append(n('span',v));list.append(head);
for(const {s,entries} of hits){const sorted=[...entries].sort((a,b)=>(b.r.date||b.r.disclosed||'').localeCompare(a.r.date||a.r.disclosed||''));const e=sorted[0],r=e.r;const row=btn('',()=>openStock(s.code,fundFilter.source),'pw-fund-row');row.dataset.code=s.code;const name=n('span',null,'pw-stock-id');name.append(n('strong',s.name),n('small',s.code));const line=n('span',null,'pw-fund-reason');line.append(n('strong',e.kind==='legacy'?(r.action||r.kind||'资金披露'):(r.subject||'主体待核')+' · '+(r.purpose||'回购增持')),n('small',unique(entries.flatMap(e=>e.sources)).map(k=>sourceNames[k]).join(' / ')+' · '+entries.length+'条记录'));row.append(name,line,badge(e.status));list.append(row);}}
update();}
function drawPolicy(host){
const c=data.context,o=data.opportunities,u=root.PolicyContextUtils;
host.append(n('h2','政策与日历'));
const mode=n('div',null,'pw-segment');for(const [id,txt] of [['current','当前政策'],['history','历史时点档案']]){const b=btn(txt,()=>{archiveMode=id;renderShell();},'pw-seg');b.setAttribute('aria-pressed',String(archiveMode===id));mode.append(b);}host.append(mode);
const historic=archiveMode==='history',at=historic?u?.cutoff(ctx?.state?.selected||''):Date.now();
host.append(memo(historic?`历史截止 ${ctx?.state?.selected||'未选择'} 14:45 北京时间。只展示公开且本系统在当时已经留存的证据；不倒填后续机会研究。`:'把待生效、征求意见、已公布和未确认预期分开。日期经过不代表政策已经实施。'));
if(historic&&!Number.isFinite(at)){host.append(memo('无有效历史交易日，请先选择行情日期。'));return;}
const availableRecords=c&&u?u.visible(c.records,at):[],availableEvents=c&&u?u.visible(c.events,at):[];
if(c&&u?.stale(c.checked_at,Date.now())&&!historic)host.append(n('p','宏观档案超过48小时未核查，仍展示留存快照。','pw-warning'));
const cal=section('政策催化日历','已明确日期与日期未定分开。','policy-calendar');
const calendarControls=n('div',null,'pw-segment');for(const days of [7,30]){const b=btn('未来'+days+'天',()=>{calendarDays=days;renderShell();},'pw-seg');b.setAttribute('aria-pressed',String(days===calendarDays));calendarControls.append(b);}cal.append(calendarControls);
const until=new Date(at+calendarDays*86400000+8*3600000).toISOString().slice(0,10),from=new Date(at+8*3600000).toISOString().slice(0,10);
const oppEvents=historic?[]:(o?.events||[]);const calendarRows=[];
for(const e of oppEvents){if(e.next_date&&e.next_date>=from&&e.next_date<=until&&!['expired','cancelled'].includes(e.status))calendarRows.push({date:e.next_date,title:e.title,status:e.status,summary:e.summary,next:e.next,source:e.source,id:e.id});}
for(const e of availableEvents){if(u.bucket(e,at,calendarDays))calendarRows.push({date:day(e.scheduled_at),title:e.title,status:u.resultKnown(e,at)?'published':'scheduled',summary:e.plan,next:u.resultKnown(e,at)?'已公布结果：'+e.result:'实际结果尚待核验',source:e.source_url,id:e.id,datetime:e.scheduled_at});}
calendarRows.sort((a,b)=>a.date.localeCompare(b.date));const calList=n('div',null,'pw-policy-list');for(const e of calendarRows)calList.append(policyItem(e));if(!calendarRows.length)calList.append(memo('该时间窗内没有已收录且可用的确定日程。'));cal.append(calList);host.append(cal);
const recent=section('近期政策与待确认事项',null,'policy-recent-due');
if(!historic){const rows=oppEvents.filter(e=>!calendarRows.some(x=>x.id===e.id)).sort((a,b)=>(b.date||'').localeCompare(a.date||''));for(const e of rows){let status=e.status;if(e.next_date&&e.next_date<from&&['scheduled','consultation'].includes(status))status='expired';recent.append(policyItem({id:e.id,date:e.date,title:e.title,status,summary:e.summary,next:(status==='expired'?'原定 '+e.next_date+'，结果待复核；':'')+(e.next||''),source:e.source}));}}
const past=availableEvents.filter(e=>u.recentlyDue(e,at)).sort((a,b)=>b.scheduled_at.localeCompare(a.scheduled_at));if(past.length){const b=n('div');for(const e of past)b.append(policyItem({id:e.id,date:day(e.scheduled_at),title:e.title,status:u.resultKnown(e,at)?'published':'expired',summary:e.plan,next:u.resultKnown(e,at)?e.result:'已到期，结果待核',source:e.source_url,result_source:e.result_source_url}));recent.append(details('最近7天已到期宏观日程',b));}if(historic&&!past.length)recent.append(memo('此历史时点无已收录的最近到期日程。'));if(!historic&&c?.watchlist?.length){const b=n('div');for(const e of c.watchlist){b.append(n('h4',e.title),memo(e.plan),link('核查入口',e.source_url));}recent.append(details('其他日期未定研究项',b));}host.append(recent);
const macro=section('经济数据与正式政策档案','摘要默认可见；研究推论、统计口径及原文在展开后查看。','policy-macro');const bar=n('div',null,'pw-filters');bar.append(select('档案类型',[['all','全部档案'],...Object.entries(kindText)],macroKind,v=>{macroKind=v;renderShell();}));macro.append(bar);const rows=availableRecords.filter(r=>macroKind==='all'||r.kind===macroKind).sort((a,b)=>(b.published_date||b.published_at||'').localeCompare(a.published_date||a.published_at||''));if(!rows.length)macro.append(memo(historic?'该时点没有已留存的可用资料。当前新增条目不倒灌历史，不代表当时不存在经济数据。':'该分类暂无已收录资料。'));for(const r of rows){const content=n('div',null,'pw-policy-body');if(r.metrics?.length)content.append(dl(r.metrics.map(m=>[m.name,m.value+' '+m.unit+' · '+m.basis])));if(r.effective_at)content.append(memo('生效时刻：'+fmtDate(r.effective_at)));content.append(memo('研究推论：'+(r.interpretation||'待核')),memo('限制：'+(r.limitations||'待核')),memo('报告期 '+(r.period||'未知')+' · 原文 '+(r.published_precision==='date'?r.published_date+'（时刻未知）':fmtDate(r.published_at))+' · 留存 '+fmtDate(r.observed_at)+' · 版本 '+r.revision),link('核对官方原文',r.source_url));const det=n('details',null,'pw-policy-item');det.id=r.id;const sum=n('summary');const name=n('span',null,'pw-policy-title');name.append(n('strong',r.title),n('small',r.summary));sum.append(n('time',r.published_date||day(r.published_at),'pw-date'),name,n('span',kindText[r.kind]||r.kind,'pw-status'));det.append(sum,content);macro.append(det);}host.append(macro);
if(c?.gaps?.length){const b=n('div');for(const g of c.gaps)b.append(memo(g));host.append(details('政策档案覆盖范围与限制',b,'pw-disclosure'));}
}
function policyItem(e){const det=n('details',null,'pw-policy-item');if(e.id)det.id=e.id;const sum=n('summary');const title=n('span',null,'pw-policy-title');title.append(n('strong',e.title),n('small',e.summary||''));sum.append(n('time',e.date||'日期待定','pw-date'),title,badge(e.status));const body=n('div',null,'pw-policy-body');if(e.datetime)body.append(memo(fmtDate(e.datetime)));body.append(memo(e.next||'下一步待核'),link('核对来源',e.source));if(e.result_source)body.append(link('结果来源',e.result_source));det.append(sum,body);return det;}
root.MarketScopePolicy={render,utils:root.PolicyContextUtils};
root.AniuPolicyWorkspace={stocks,allFundEntries,matchingFundEntries,sourceNames,labels};
})(window);

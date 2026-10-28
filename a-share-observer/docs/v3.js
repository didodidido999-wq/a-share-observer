/* MarketScope V3 — historical, read-only client. Never calls the financial provider. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const N=x=>x===null||x===undefined||x===''||!Number.isFinite(Number(x))?null:Number(x);
const last=a=>a?.length?a[a.length-1]:null;
const number=(x,n=2)=>N(x)==null?'—':N(x).toLocaleString('zh-CN',{minimumFractionDigits:n,maximumFractionDigits:n});
const signed=(x,n=2,suffix='')=>N(x)==null?'—':`${x>0?'+':''}${number(x,n)}${suffix}`;
const pct=x=>signed(x,2,'%');
const dateShort=x=>x?.slice(5)||'—';
const changeClass=x=>N(x)==null?'':Number(x)>0?'positive':Number(x)<0?'negative':'';
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=String(value??'');if(cls)e.className=cls;return e;};
const cleared=id=>{let e=$(id);e.replaceChildren();return e;};
const pick=(obj,...keys)=>{for(const k of keys){if(obj?.[k]!==undefined&&obj?.[k]!==null)return obj[k];}return null;};
const MARKET_FIELDS=[['上涨家数','up','只'],['下跌家数','down','只'],['涨幅中位数','median','%'],['成交额','turnover_100m','亿元'],['非ST涨停','non_st','只'],['最高板','highest','板']];
const SECTOR_META={cum:['区间累计涨幅','%'],pct:['日涨跌幅','%'],relative:['相对基准累计收益','百分点'],turnover:['板块成交额','亿元'],activity:['成交额/MA5','倍'],limit_up_count:['涨停归属数','只'],limit_down_count:['跌停归属数','只'],limit_up_ratio:['涨停占比','%'],limit_down_ratio:['跌停占比','%'],limit_diff:['涨跌停净差','只'],member_up_ratio:['成分上涨占比','%'],member_median:['成分涨幅中位数','%'],hot_count:['热榜上榜数','只']};
const state={page:'today',dash:null,archive:[],days:[],snapshots:new Map(),detailLoaded:new Set(),selected:null,playing:null,compare:false,compareBase:null,sectorKind:'industry',sectorMetric:'cum',sectorSelection:{industry:[],cn_concept:[]},sectorManual:{industry:false,cn_concept:false},sectorPage:0,sectorSort:'cum',sectorFilter:'',sectorFocus:null,chartMap:new Map(),loadedPages:new Set(),loadingRange:false};
function fieldStatus(day,domain){let snap=state.snapshots.get(day);return snap?.quality_manifest?.[domain]?.status||null;}
function notice(msg,ok=false){$('notice').textContent=msg;$('notice').className='notice'+(ok?' ok':'');}
function qStatus(day,domain,items){const status=fieldStatus(day,domain);if(status==='complete')return 'complete';if(status&&status!=='complete')return status;return Array.isArray(items)&&items.length?'legacy':items===null||items===undefined?'not_collected':'legacy';}
function snapshot(day){return state.snapshots.get(day)||{};}
function market(day){return snapshot(day).market||{};}
function limits(day){return snapshot(day).limits||{};}
function indexList(){const seen=new Map();for(const d of state.days){for(const x of snapshot(d).indices||[])if(x.code)seen.set(x.code,{code:x.code,name:x.name||x.code});}return [...seen.values()];}
function indices(day){return snapshot(day).indices||[];}
function indexValue(day,code){return indices(day).find(x=>x.code===code)||{};}
function sectorCatalog(){const seen=new Map();for(const d of state.days){for(const s of snapshot(d).sectors||[])if(s.code)seen.set(s.code,{code:s.code,name:s.name||s.code,tag:s.tag||'industry'});}return [...seen.values()];}
function sectorValue(day,code){return snapshot(day).sectorMap?.get(code)||{};}
function createSectorMap(obj){if(obj&&!obj.sectorMap)obj.sectorMap=new Map((obj.sectors||[]).map(s=>[s.code,s]));}
function synthesizeDashboard(dash){for(const d of dash.dates||[]){let snap={date:d,market:(dash.market||[]).find(x=>x.date===d)||null,limits:(dash.limits||[]).find(x=>x.date===d)||null,
 indices:(dash.indices||[]).map(x=>({name:x.name,code:x.code,...(x.points||[]).find(y=>y.date===d)})).filter(x=>x.close!=null),
 sectors:(dash.sectors||[]).map(x=>({name:x.name,code:x.code,tag:x.tag,...(x.points||[]).find(y=>y.date===d)})),
 styles:(dash.styles||[]).filter(x=>x.date===d),stock_list:(dash.stock_list||[]).filter(x=>x.date===d)};createSectorMap(snap);state.snapshots.set(d,snap);}}
async function json(url){let res=await fetch(url,{cache:'no-store'});if(!res.ok)throw new Error(`${res.status} ${url}`);return await res.json();}
async function fullSnapshot(day){if(state.detailLoaded.has(day))return snapshot(day);try{const obj=await json(`data/history/${day}.json`);if(obj?.date!==day)throw new Error('归档日期不一致');let before=snapshot(day);Object.assign(before,obj);before.sectorMap=new Map((before.sectors||[]).map(s=>[s.code,s]));state.snapshots.set(day,before);state.detailLoaded.add(day);return before;}catch(e){console.warn('Archive unavailable',day,e.message);return snapshot(day);}}
async function loadRange(days){const missing=days.filter(d=>!state.detailLoaded.has(d));if(!missing.length)return;let pointer=0;let failures=0;await Promise.all(Array.from({length:Math.min(4,missing.length)},async()=>{while(pointer<missing.length){const d=missing[pointer++];try{const snap=await json(`data/history/${d}.json`);if(snap.date!==d)throw new Error('日期不一致');createSectorMap(snap);state.snapshots.set(d,snap);state.detailLoaded.add(d);}catch(e){failures++;console.warn('Archive load failed',d,e.message);}}}));if(failures)notice(`部分日期文件无法读取：${failures}/${missing.length}。缺失日期不伪造数据。`);}
function chart(id,opt,listener){const e=$(id);if(typeof window.echarts==='undefined'){e.textContent='图表组件暂不可用';return;}let c=state.chartMap.get(id);if(!c){c=echarts.init(e);state.chartMap.set(id,c);}c.clear();const base={animationDuration:220,color:['#be4955','#318c86','#386d95','#d6a159','#896ca1','#75a3b1'],textStyle:{fontFamily:'DM Sans,Microsoft YaHei,sans-serif'},tooltip:{trigger:'axis',confine:true,backgroundColor:'#173247',borderWidth:0,textStyle:{color:'#fff',fontSize:11}},legend:{top:4,right:4,type:'scroll',textStyle:{fontSize:10,color:'#778e9c'}},grid:{left:49,right:44,top:49,bottom:35,containLabel:true},xAxis:{type:'category',data:state.days.map(dateShort),axisLabel:{fontSize:10,color:'#8497a2'},axisLine:{lineStyle:{color:'#e2eaed'}},axisTick:{show:false}},yAxis:{type:'value',axisLabel:{fontSize:10,color:'#8ca0aa'},splitLine:{lineStyle:{color:'#edf1f4',type:'dashed'}}},...opt};c.setOption(base,true);c.off('click');if(listener)c.on('click',listener);return c;}
function noChart(id,msg){const c=state.chartMap.get(id);if(c){c.dispose();state.chartMap.delete(id);}$(id).replaceChildren(text('div',msg||'暂无可验证数据','inline-note'));}
function mark(){return {silent:true,symbol:'none',label:{show:false},lineStyle:{color:'#647f90',width:1,type:'dashed'},data:[{xAxis:dateShort(state.selected)}]};}
function nav(page){stop();if(window.MarketScopeEvents)window.MarketScopeEvents.stop();state.page=page;document.querySelectorAll('[data-page]').forEach(x=>{x.classList.toggle('active',x.dataset.page===page);});document.querySelectorAll('.page').forEach(x=>x.classList.toggle('active',x.id===page));const names={today:['今日市场','按交易日回放指数、市场广度、成交额和赚钱效应的变化。'],events:['异动与线索','追踪涨跌停、接力结构、异动和历史热股。'],sectors:['板块研究','比较全部行业与概念的历史表现，并查看可核验的板块内部结构。'],history:['代表性股票研究','查看行业标志性股票在不同时间窗口的客观排名与固定经济风格标签。']};$('crumb').textContent=$('page-title').textContent=names[page][0];$('page-desc').textContent=names[page][1];$('sidebar').classList.remove('open');renderPage();history.replaceState(null,'',`#${page}`);window.scrollTo({top:0,behavior:'smooth'});}
function setDay(day){if(!state.days.includes(day))return;state.selected=day;let i=state.days.indexOf(day);$('day-slider').value=String(i);$('selected-day').textContent=$('timeline-day').textContent=day;document.querySelectorAll('tbody tr[data-day]').forEach(e=>e.classList.toggle('selected',e.dataset.day===day));$('compare-base').disabled=!state.compare;$('event-date').value=day;renderPage();}
function step(dir){let i=state.days.indexOf(state.selected);let next=Math.min(state.days.length-1,Math.max(0,i+dir));setDay(state.days[next]);if(next===state.days.length-1&&dir>0)stop();}
function stop(){if(state.playing){clearInterval(state.playing);state.playing=null;}$('play-day').textContent='▶ 播放';}
function playback(){if(state.playing){stop();return;}if(state.days.length<2)return;if(state.selected===last(state.days))setDay(state.days[0]);let delay=Number($('play-speed').value)||900;$('play-day').textContent='Ⅱ 暂停';state.playing=setInterval(()=>{if(state.days.indexOf(state.selected)>=state.days.length-1){stop();return;}step(1);},delay);}
function fact(target,title,detail,missing=false){let div=text('div','', 'fact'+(missing?' missing':''));div.append(text('strong',title),text('span',detail));target.append(div);}
function valueDifference(cur,base,dec=0,suffix=''){if(N(cur)==null||N(base)==null)return '—';return `${signed(Number(cur)-Number(base),dec,suffix)}`;}
function kpiCard(title,value,subtitle,klass,action){let e=document.createElement(action?'button':'div');e.className='kpi';if(action){e.type='button';e.addEventListener('click',action);}e.append(text('small',title),text('strong',value,klass),text('span',subtitle,'delta'));return e;}
function renderPage(){if(!state.days.length)return;$('selected-day').textContent=state.selected||'—';const map={today:renderToday,events:renderEvents,sectors:renderSectors,history:()=>window.MarketScopeHistory?window.MarketScopeHistory.render({state,chart,noChart,showDialog}):renderHistory()};map[state.page]();window.requestAnimationFrame(()=>state.chartMap.forEach(c=>c.resize()));}
function populateSelect(id,values,selected){const e=$(id);e.replaceChildren();values.forEach(x=>{const opt=text('option',x.label||x.value);opt.value=x.value;e.append(opt);});if(selected!=null&&values.some(x=>x.value===selected))e.value=selected;}
function setSelectors(){const d=state.days;for(const name of ['compare-base','event-date'])populateSelect(name,d.map(x=>({value:x,label:x})),name==='compare-base'?(state.compareBase||d[0]):state.selected);let ind=indexList();for(const name of ['index-select','sector-benchmark']){let former=$(name).value;populateSelect(name,ind.map(x=>({value:x.code,label:x.name})),ind.some(x=>x.code===former)?former:'000300.SH');} $('range-start').value=d[0]||'';$('range-end').value=last(d)||'';$('first-day').textContent=d[0]||'—';$('last-day').textContent=last(d)||'—';$('day-slider').max=String(Math.max(d.length-1,0));$('day-slider').value=String(Math.max(d.indexOf(state.selected),0));$('range-info').textContent=`${d.length} 个已归档交易日`;$('archive-days').textContent=`总归档 ${state.archive.length} 日`;
}
async function applyRange(preset){if(state.loadingRange)return;stop();const avail=state.archive;let wanted=[];if(preset==='custom'){let a=$('range-start').value,b=$('range-end').value;if(!a||!b||a>b){notice('自定义日期范围无效');return;}wanted=avail.filter(d=>d>=a&&d<=b);}else if(preset==='all'){wanted=[...avail];}else{wanted=avail.slice(-Number(preset||10));}if(!wanted.length){notice('所选区间没有已归档交易日');return;}state.loadingRange=true;$('apply-range').disabled=true;notice(`正在按需读取 ${wanted.length} 个交易日的历史归档…`);await loadRange(wanted);state.days=wanted.filter(d=>state.snapshots.has(d));state.selected=last(state.days);state.sectorPage=0;state.compareBase=state.days[0];setSelectors();state.loadingRange=false;$('apply-range').disabled=false;notice(`已载入 ${state.days.length} 个交易日。所有指标均来自实际归档；未采集项显示 —。`,true);renderPage();}
function renderToday(){const d=state.selected;if(!state.detailLoaded.has(d))fullSnapshot(d).then(()=>{if(state.detailLoaded.has(d)&&state.selected===d&&state.page==='today')renderToday();});const m=market(d),l=limits(d),days=state.days,i=days.indexOf(d),prev=days[i-1],p=market(prev),pl=limits(prev),base=state.compare?state.compareBase:prev,bm=market(base),bl=limits(base);let host=cleared('kpi-grid');
 const v=[
 ['上涨家数',m.up,'只',base?valueDifference(m.up,bm.up,0,' 只'):'当前交易日',null,'history'],
 ['下跌家数',m.down,'只',base?valueDifference(m.down,bm.down,0,' 只'):'当前交易日',null,'history'],
 ['全市场成交额',m.turnover_100m,' 亿元',base?valueDifference(m.turnover_100m,bm.turnover_100m,0,' 亿元'):'亿元',0,'history'],
 ['涨跌幅中位数',m.median,'%',base?valueDifference(m.median,bm.median,2,'百分点'):'当日股票等权分布中位数',2,'history'],
 ['非ST涨停',l.non_st,'只',base?valueDifference(l.non_st,bl.non_st,0,' 只'):'全量涨停池（不含ST）',0,'events'],
 ['最高连板',l.highest,'板',base?valueDifference(l.highest,bl.highest,0,' 板'):'非ST涨停股票最高板位',0,'events'],
 ['跌停收录',Array.isArray(snapshot(d).limit_down_events)?snapshot(d).limit_down_events.length:null,'只',
   snapshot(d).quality_manifest?.limit_down_events?.status==='partial'?'仅有效代码，名单不完整':'当日已归档跌停股票',0,'events'],
 ['炸板收录',Array.isArray(snapshot(d).limit_break_events)?snapshot(d).limit_break_events.length:null,'只',
   snapshot(d).quality_manifest?.limit_break_events?.status==='partial'?'事件池部分完整':'当日已归档炸板股票',0,'events']
 ];for(const [title,num,unit,delta,dec,dest] of v){host.append(kpiCard(title,N(num)==null?'—':number(num,dec==null?0:dec)+unit,delta,changeClass(title.includes('中位数')?num:null),()=>nav(dest)));}
 const idx=$('index-select').value||'000001.SH';const xs=days.map(dateShort),baseDay=days[0];let first=indexValue(baseDay,idx).close;let series=[];
 for(const code of [idx,...['000001.SH','399006.SZ','000300.SH'].filter(x=>x!==idx)].slice(0,3)){const name=indexList().find(x=>x.code===code)?.name||code;let v=indexValue(baseDay,code).close;const list=days.map(t=>{let close=indexValue(t,code).close;return N(close)!=null&&N(v)>0?Number((close/v*100).toFixed(3)):null;});if(list.some(x=>x!==null))series.push({name,type:'line',symbolSize:3,showSymbol:false,smooth:false,lineStyle:{width:2},markLine:mark(),data:list});}
 const ratios=days.map(t=>{const a=market(t);return N(a.up)!=null&&N(a.down)!=null&&(Number(a.up)+Number(a.down)+Number(a.flat||0))>0?Number((100*a.up/(a.up+a.down+(a.flat||0))).toFixed(2)):null;});if(ratios.some(x=>x!=null))series.push({name:'上涨股票占比（右轴）',type:'line',yAxisIndex:1,symbol:'none',lineStyle:{type:'dotted',width:2},data:ratios});
 if(series.length)chart('index-chart',{xAxis:{type:'category',data:xs},yAxis:[{type:'value',scale:true,name:'指数基准100',nameTextStyle:{fontSize:10}},{type:'value',min:0,max:100,name:'上涨占比%',nameTextStyle:{fontSize:10},axisLabel:{formatter:'{value}%'}}],series},e=>{if(e.dataIndex!=null)setDay(days[e.dataIndex]);});else noChart('index-chart','当前日期指数数据未采集。');
 const type=$('market-trend-type').value;let series2=[],unit='只';if(type==='turnover'){unit='亿元';series2=[{name:'成交额',type:'bar',barWidth:'45%',itemStyle:{color:'#427f9e'},data:days.map(t=>N(market(t).turnover_100m)),markLine:mark()}];}else if(type==='limits'){series2=[{name:'首板',type:'bar',stack:'up',data:days.map(t=>N(limits(t).first))},{name:'连板',type:'bar',stack:'up',data:days.map(t=>N(limits(t).continued))}];}else{series2=[{name:'上涨家数',type:'bar',stack:'total',data:days.map(t=>N(market(t).up))},{name:'下跌家数',type:'bar',stack:'total',data:days.map(t=>N(market(t).down))}];}
 if(series2.some(s=>s.data.some(v=>v!==null)))chart('liquidity-chart',{xAxis:{type:'category',boundaryGap:true,data:xs},yAxis:{type:'value',name:unit,min:0},series:series2},e=>{if(e.dataIndex!=null)setDay(days[e.dataIndex]);});else noChart('liquidity-chart','该时段此项数据尚未采集。');
 renderStyles();renderFacts();if(window.MarketScopeFunds)window.MarketScopeFunds.render({state,chart,noChart});if(window.MarketScopeEtfShares)window.MarketScopeEtfShares.render({state,chart,noChart});let tbody=cleared('daily-ledger');for(const day of [...days].reverse()){const x=market(day),y=limits(day),tr=document.createElement('tr');tr.className='clickable'+(day===d?' selected':'');tr.dataset.day=day;[day,x.up??'—',x.down??'—',pct(x.median),number(x.turnover_100m,0),y.non_st??'—',y.highest??'—'].forEach(z=>tr.append(text('td',z)));tr.addEventListener('click',()=>setDay(day));tbody.append(tr);}
 $('compare-caption').textContent=state.compare?`${state.compareBase||'—'} → ${d} · 显示数值差值`:'拖动时间轴或点击图表日期，观察各指标同步变化';
}
function renderStyles(){let host=cleared('style-bars'),dim=$('style-dimension').value,metric=$('style-metric').value;const rows=(snapshot(state.selected).styles||[]).filter(x=>x.dimension===dim);if(!rows.length){fact(host,'该日风格归档尚缺失','无数据不等于0',true);return;}
 const values=rows.map(x=>N(x[metric])).filter(x=>x!=null);const max=Math.max(...values.map(Math.abs),1);for(const item of rows){const value=N(item[metric]);let row=text('div','','style-item');row.append(text('div',item.group,'style-label'));let track=text('div','','style-track'),fill=text('div','','style-fill '+(value==null?'':metric==='median_pct'&&value<0?'neg':'pos'));fill.style.width=`${value==null?0:Math.max(1,Math.min(100,100*Math.abs(value)/max))}%`;track.append(fill);row.append(track,text('div',value==null?'—':number(value,metric==='sample'||metric==='limit_up'?0:2)+(metric==='up_ratio'||metric==='median_pct'?'%':''),'style-value '+(metric==='median_pct'?changeClass(value):'')));host.append(row);}}
function renderFacts(){const host=cleared('market-facts'),days=state.days,i=days.indexOf(state.selected),prev=days[i-1];if(!prev){fact(host,'缺少前一交易日','当前区间内暂无可比数据',true);return;}const curr=market(state.selected),prior=market(prev),l=limits(state.selected),p=limits(prev);let rows=[['上涨家数',curr.up,prior.up,'只'],['下跌家数',curr.down,prior.down,'只'],['市场成交额',curr.turnover_100m,prior.turnover_100m,'亿元'],['非ST涨停',l.non_st,p.non_st,'只'],['最高板',l.highest,p.highest,'板']];for(const [name,a,b,unit] of rows){if(N(a)==null||N(b)==null)continue;fact(host,`${name}${a>=b?'增加':'减少'} ${number(Math.abs(a-b),name==='市场成交额'?2:0)}${unit}`,`${prev} → ${state.selected} · ${number(b,name==='市场成交额'?2:0)} → ${number(a,name==='市场成交额'?2:0)}`);}const ratio=N(curr.up)!=null&&N(curr.down)!=null?curr.up/(curr.up+curr.down+(curr.flat||0)):null;const sh=indexValue(state.selected,'000001.SH');if(ratio!=null&&ratio<.5&&N(sh.pct)>0)fact(host,'指数与广度出现背离',`上证日涨 ${pct(sh.pct)}，上涨股票占比仅 ${number(ratio*100,1)}%`);if(!host.children.length)fact(host,'暂无可比事实','需要相邻两个交易日的完整数据',true);}
function showDialog(title,fields){$('dialog-title').textContent=title;const host=cleared('dialog-body'),dl=document.createElement('dl');for(const [name,value] of fields){dl.append(text('dt',name),text('dd',value==null?'—':typeof value==='object'?JSON.stringify(value):value));}host.append(dl);$('detail-dialog').hidden=false;$('close-dialog').focus();}
function eventRows(day,type){const s=snapshot(day);let list=type==='up'?s.stock_list:type==='down'?(s.limit_down_events||s.limit_down_pool):type==='break'?(s.limit_break_events||s.limit_break_pool):type==='anomaly'?(s.anomaly_daily||s.anomaly_events):type==='hot'?(s.hot_rank_daily||s.hot_stocks):s.sector_focus_stocks;return Array.isArray(list)?list:null;}
function eventInfo(type){return {up:['涨停','limit_up_events'],down:['跌停','limit_down_events'],break:['炸板','limit_break_events'],anomaly:['异动','anomaly_daily'],hot:['热股','hot_rank_daily'],focus:['重点股票','sector_focus_stocks']}[type];}
async function renderEvents(){if(window.MarketScopeEvents){return window.MarketScopeEvents.render({state,loadRange,chart,noChart,showDialog,setDay});}const day=$('event-date').value||state.selected;await fullSnapshot(day);if(state.page!=='events')return;const s=snapshot(day),l=s.limits||{},host=cleared('event-kpis');const entries=[['非ST涨停',l.non_st,'只'],['首板',l.first,'只'],['连板',l.continued,'只'],['最高连板',l.highest,'板'],['跌停股',pick(s.event_summary,'limit_down_count'),'只'],['炸板股',pick(s.event_summary,'limit_break_count'),'只']];entries.forEach(([name,n,unit])=>host.append(kpiCard(name,n==null?'—':`${number(n,0)}${unit}`,n==null?'当日数据未采集':'按该日事件池归档','')));
 const type=$('event-type').value,meta=eventInfo(type),rows=eventRows(day,type),q=$('event-search').value.trim().toLowerCase();let quality=qStatus(day,meta[1],rows);$('event-quality').textContent=`${meta[0]} · ${day} · ${quality==='legacy'?'旧归档，字段有限':quality==='complete'?'已验证完整':quality==='not_collected'?'该项尚未采集':quality} · ${rows?.length??'—'} 条`;
 let cols=[['代码','thscode'],['股票','name'],['板数/类型','boards'],['价格','price'],['来源事件/原因','reason']];if(type==='hot')cols=[['代码','thscode'],['股票','name'],['排名','rank'],['事件日期','date']];if(type==='anomaly')cols=[['代码','thscode'],['股票','name'],['异动类型','tag_name'],['原因','reason']];if(type==='focus')cols=[['代码','stock_code'],['股票','stock_name'],['板块','sector_code'],['客观标签','factual_tags']];let head=cleared('event-head'),tr=document.createElement('tr');cols.forEach(c=>tr.append(text('th',c[0])));head.append(tr);const body=cleared('event-list');if(rows===null){let tr=document.createElement('tr'),td=text('td','该日尚未采集此类事件，不能据此判断没有事件。');td.colSpan=cols.length;tr.append(td);body.append(tr);}else{let filtered=rows.filter(x=>!q||JSON.stringify([x.thscode,x.stock_code,x.name,x.stock_name,x.reason,x.limit_up_reason,x.tag_name]).toLowerCase().includes(q));for(const item of filtered.slice(0,600)){let row=document.createElement('tr');row.className='clickable';for(const [_,key] of cols){let v=item[key];if(key==='boards'&&v==null)v=pick(item,'continue_day_cnt','tag_name','event_type');if(key==='reason'&&v==null)v=pick(item,'limit_up_reason','limit_down_reason','event_reason','tag_name');if(Array.isArray(v))v=v.map(x=>typeof x==='object'?x.label||x.tag||JSON.stringify(x):x).join('，');row.append(text('td',v??'—'));}row.addEventListener('click',()=>showDialog(`${item.name||item.stock_name||item.thscode||item.stock_code} · ${day}`,Object.entries(item)));body.append(row);}if(!filtered.length){let tr=document.createElement('tr'),td=text('td','在已归档的事件中没有匹配结果');td.colSpan=cols.length;tr.append(td);body.append(tr);}}
 let pool=eventRows(day,'up');if(pool){let counts={};for(const x of pool){if(x.is_st)continue;const n=N(x.boards);if(n!=null)counts[n]=(counts[n]||0)+1;}const labs=Object.keys(counts).sort((a,b)=>Number(a)-Number(b));if(labs.length)chart('ladder-chart',{xAxis:{type:'category',data:labs.map(x=>x+'板')},yAxis:{type:'value',min:0,name:'只'},legend:{show:false},series:[{type:'bar',name:'实际涨停池样本',data:labs.map(x=>counts[x]),barMaxWidth:45}]});else noChart('ladder-chart','无可用非ST连板数据。');}else noChart('ladder-chart','当日涨停池未归档。');
 const f=cleared('feedback-panel'),feedback=s.next_day_feedback;if(feedback){for(const [key,label] of [['limit_up','前日涨停股反馈'],['limit_down','前日跌停股反馈'],['limit_break','前日炸板股反馈']]){let value=feedback[key];if(value)fact(f,label,`样本 ${value.sample_size??'—'} · 次日开盘收益中位数 ${pct(value.open_median_pct)} · 次日收盘中位数 ${pct(value.close_median_pct)}`);else fact(f,label,'尚无满足完整样本的次日开收盘价',true);}}else fact(f,'次日赚钱 / 亏钱效应尚待采集','旧归档没有完整事件池次日OHLC；不以当天涨停样本代替全样本，也不编造隔日溢价。',true);
}
function sectorDays(code){return state.days.map(d=>sectorValue(d,code));}
function compound(values){if(!values.length||values.some(x=>N(x)==null))return null;return 100*(values.reduce((p,x)=>p*(1+Number(x)/100),1)-1);}
function cumulativeSector(code,toIndex){return compound(state.days.slice(0,toIndex+1).map(d=>sectorValue(d,code).pct));}
function cumulativeIndex(code,toIndex){return compound(state.days.slice(0,toIndex+1).map(d=>indexValue(d,code).pct));}
function metricValue(code,day,metric){const p=sectorValue(day,code),idx=state.days.indexOf(day);if(idx<0)return null;
 if(metric==='cum')return cumulativeSector(code,idx);
 if(metric==='relative'){const a=cumulativeSector(code,idx),b=cumulativeIndex($('sector-benchmark').value,idx);return a==null||b==null?null:a-b;}
 if(metric==='pct')return N(p.pct);
 if(metric==='limit_down_count'&&p.limit_down_count==null)return N(p.limit_down_known_count);
 if(metric==='limit_down_ratio'&&p.limit_down_ratio==null)return N(p.limit_down_known_ratio);
 if(metric==='turnover')return N(p.turnover)==null?null:p.turnover/1e8;
 if(metric==='activity'){if(idx<4||N(p.turnover)==null)return null;let rows=state.days.slice(idx-4,idx+1).map(d=>N(sectorValue(d,code).turnover));if(rows.some(x=>x==null))return null;let ma=rows.reduce((a,b)=>a+b,0)/5;return ma>0?p.turnover/ma:null;}
 const nested=p.member_metrics||p.sector_member_metrics||p.metrics||{};
 if(metric==='limit_diff'){const a=pick(p,'limit_up_count'),b=pick(p,'limit_down_count');const x=a??nested.limit_up_count,y=b??nested.limit_down_count;return x==null||y==null?null:Number(x)-Number(y);}
 if(metric==='limit_up_count'&&p.limit_up_count==null&&nested.limit_up_count==null)return null; // legacy limit_up_proxy is NOT a verified count
 return N(pick(p,metric)??pick(nested,metric));}

function heatMetricAggregate(code,metric){
 const ds=state.days,values=ds.map(d=>metricValue(code,d,metric));
 if(!values.length||values.some(v=>v==null))return null;
 if(metric==='pct'||metric==='cum')return cumulativeSector(code,ds.length-1);
 if(metric==='relative')return metricValue(code,ds[ds.length-1],metric);
 const sum=values.reduce((a,b)=>a+b,0);
 return ['activity','member_up_ratio','limit_up_ratio','limit_down_ratio','member_median'].includes(metric)?sum/values.length:sum;
}
function heatSortValue(code,kind,metric){
 if(kind==='name')return null;
 if(kind==='cum')return cumulativeSector(code,state.days.length-1);
 if(kind==='latest')return metricValue(code,state.selected,'pct');
 if(kind==='turnover')return metricValue(code,state.selected,'turnover');
 if(kind==='metric_range')return heatMetricAggregate(code,metric);
 return metricValue(code,state.selected,metric);
}
function heatIsLowerBound(code,day,metric){
 if(!['limit_down_count','limit_down_ratio'].includes(metric))return false;
 const p=sectorValue(day,code);
 return p.limit_down_completeness==='partial'&&p[metric]==null&&
   (metric==='limit_down_count'?p.limit_down_known_count:p.limit_down_known_ratio)!=null;
}
function heatValueText(v,metric,lowerBound=false){
 if(v==null)return '—';
 const dp=['limit_up_count','limit_down_count','hot_count','limit_diff'].includes(metric)?0:2;
 return (lowerBound?'≥':'')+number(v,dp);
}
function syncHeatControls(){
 const ds=state.days,sel=$('sector-date');
 if(sel&&(sel.options.length!==ds.length||ds.some((d,i)=>sel.options[i]?.value!==d))){
   sel.replaceChildren();
   for(const d of ds){const op=text('option',d);op.value=d;sel.append(op);}
 }
 if(sel)sel.value=state.selected;
 const metric=$('heat-metric').value,sort=$('sector-sort'),label=SECTOR_META[metric]?.[0]||'所选指标';
 if(sort?.options.length>=3){
   sort.options[0].textContent=label+' · 高→低';
   sort.options[1].textContent=label+' · 低→高';
   const avg=['activity','member_up_ratio','limit_up_ratio','limit_down_ratio'].includes(metric);
   sort.options[2].textContent=metric==='pct'?'区间累计涨幅':label+(avg?' · 区间日均':' · 区间合计');
 }
}

// A single view model drives cards, trend and heatmap. No manual line selection.
const memberIndexCache=new Map();
function loadMemberIndex(date){
 if(!date)return Promise.resolve(null);
 if(!memberIndexCache.has(date)){
   const path='data/sector-member-index/'+date+'.json';
   memberIndexCache.set(date,json(path).catch(err=>{
     console.warn('Member index unavailable',date,err.message);return null;
   }));
 }
 return memberIndexCache.get(date);
}
function focusHeatSector(code){
 const all=sectorCatalog().filter(x=>x.tag===$('sector-kind').value);
 const obj=all.find(x=>x.code===code);
 if(!obj)return;
 state.sectorFocus=code;
 // The user may have filtered this board away or switched page.
 const q=$('heat-search').value.trim().toLowerCase();
 if(q&&!obj.name.toLowerCase().includes(q)&&!obj.code.toLowerCase().includes(q))
   $('heat-search').value='';
 const metric=$('heat-metric').value,sort=$('sector-sort').value;
 let filtered=all.filter(x=>!$('heat-search').value||x.name.toLowerCase().includes($('heat-search').value.toLowerCase())||x.code.toLowerCase().includes($('heat-search').value.toLowerCase()));
 filtered=sortHeatSectors(filtered,metric,sort);
 const index=filtered.findIndex(x=>x.code===code);
 state.sectorPage=Math.max(0,Math.floor(Math.max(0,index)/40));
 renderSectors();
 window.requestAnimationFrame(()=>{
   const target=$('sector-inline-detail')||document.querySelector('.heat-label-button.is-expanded');
   if(target)target.scrollIntoView({behavior:'smooth',block:'center'});
 });
}
function sortHeatSectors(arr,metric,sort){
 const ascending=sort==='metric_asc'||sort==='name';
 return [...arr].sort((a,b)=>{
   if(sort==='name')return a.name.localeCompare(b.name,'zh');
   const av=heatSortValue(a.code,sort,metric),bv=heatSortValue(b.code,sort,metric);
   if(av==null&&bv==null)return a.name.localeCompare(b.name,'zh');
   if(av==null)return 1;
   if(bv==null)return -1;
   return (ascending?av-bv:bv-av)||a.name.localeCompare(b.name,'zh');
 });
}
function renderSectors(){
 syncHeatControls();
 if(state.page==='sectors'&&state.days.some(d=>!state.detailLoaded.has(d))&&!state.sectorDetailLoading){
   state.sectorDetailLoading=true;
   loadRange([...state.days]).then(()=>{if(state.page==='sectors')renderSectors();})
     .finally(()=>{state.sectorDetailLoading=false;});
 }
 const kind=state.sectorKind=$('sector-kind').value,metric=$('heat-metric').value;
 state.sectorMetric=metric;
 $('sector-benchmark-wrap').hidden=metric!=='relative';
 const days=state.days,all=sectorCatalog().filter(x=>x.tag===kind);
 const q=$('heat-search').value.toLowerCase().trim(),sort=$('sector-sort').value;
 const filtered=sortHeatSectors(all.filter(x=>x.name.toLowerCase().includes(q)||x.code.toLowerCase().includes(q)),metric,sort);
 const pages=Math.max(1,Math.ceil(filtered.length/40));
 state.sectorPage=Math.max(0,Math.min(state.sectorPage,pages-1));
 $('heat-page').textContent=(state.sectorPage+1)+'/'+pages+' · '+filtered.length+' 板块';
 $('heat-prev').disabled=state.sectorPage===0;$('heat-next').disabled=state.sectorPage>=pages-1;
 const top=all.filter(x=>x.name.toLowerCase().includes(q)||x.code.toLowerCase().includes(q))
  .map(x=>({...x,value:metricValue(x.code,state.selected,metric)}))
  .filter(x=>x.value!=null)
  .sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name,'zh')).slice(0,10);
 const unit=SECTOR_META[metric]?.[1]||'',label=SECTOR_META[metric]?.[0]||metric;
 const host=cleared('sector-turnover-rank'),heading=text('div','','sector-rank-caption');
 heading.append(text('strong',label+' · 前'+top.length+'板块'),
   text('span',state.selected+' · '+(kind==='industry'?'行业':'概念')+' · 点击卡片定位热力矩阵'));
 host.append(heading);
 const cards=text('div','','sector-rank-list');
 top.forEach((item,i)=>{
   const lower=heatIsLowerBound(item.code,state.selected,metric);
   const card=text('button','','sector-rank-item'+(state.sectorFocus===item.code?' is-selected':''));
   card.type='button';
   card.setAttribute('aria-label','第'+(i+1)+'名 '+item.name+' '+heatValueText(item.value,metric,lower)+unit+'，查看对应板块');
   card.append(text('small',String(i+1)),text('span',item.name),
      text('strong',heatValueText(item.value,metric,lower)+unit));
   card.title=item.name+'｜'+state.selected+'｜'+label+' '+heatValueText(item.value,metric,lower)+unit+
     (lower?'（部分跌停池，已知下限）':'');
   card.addEventListener('click',()=>focusHeatSector(item.code));
   cards.append(card);
 });
 if(top.length)host.append(cards);else host.append(text('p','所选日期及筛选条件下没有可核验数据。','inline-note'));
 $('sector-chart-help').textContent='对应上方'+top.length+'张卡片的'+label+'历史日线；点击任意一条线跳转热力图对应板块。';
 $('sector-trend-legend').textContent=days[0]+' — '+last(days)+' · '+unit;
 const series=top.map((item,i)=>({name:item.name,type:'line',connectNulls:false,
   showSymbol:days.length<=10,symbolSize:5,emphasis:{focus:'series'},
   lineStyle:{width:item.code===state.sectorFocus?3.4:2,opacity:.93},
   data:days.map(d=>{
     const value=metricValue(item.code,d,metric);
     return value==null?null:Number(value.toFixed(3));
   })}));
 if(series.some(x=>x.data.some(v=>v!=null))){
   const byName=new Map(top.map(x=>[x.name,x.code]));
   chart('sector-chart',{
     legend:{top:3,type:'scroll',right:0},
     tooltip:{trigger:'axis'},
     xAxis:{type:'category',data:days.map(dateShort)},
     yAxis:{type:'value',name:unit,scale:!['limit_up_count','limit_down_count','hot_count','limit_up_ratio','limit_down_ratio','member_up_ratio'].includes(metric)},
     series
   },ev=>{const code=byName.get(ev.seriesName);if(code)focusHeatSector(code);});
 }else noChart('sector-chart','对应指标暂无可计算的折线记录；数据缺失不连线。');
 $('sector-metric-status').textContent='曲线严格对应当前前10卡片，随指标、日期、板块类型及搜索变化；缺失日期断线。';

 const daily=snapshot(state.selected),l=daily.limits||{},
  down=daily.limit_down_events,breaks=daily.limit_break_events,quality=daily.quality_manifest||{};
 const status=cleared('sector-market-status');
 status.append(text('strong','全市场 · '+state.selected));
 status.append(text('span','涨停 '+(l.non_st??'—')+'只 · 跌停 '+(Array.isArray(down)?down.length:'—')+
        '只 · 炸板 '+(Array.isArray(breaks)?breaks.length:'—')+'只'));
 if(quality.limit_down_events?.status==='partial')
   status.append(text('span','跌停池部分完整 · ≥为已知下限'));
 const example=all[0]&&sectorValue(state.selected,all[0].code);
 if(example?.membership_mode==='backcast_current')
   status.append(text('span','历史回算：'+example.membership_observed_date+'固定成分口径（非当时成分）'));
 else if(example?.membership_observed_date)
   status.append(text('span','成员快照：'+example.membership_observed_date));

 const heat=cleared('sector-heat'),grid=text('div','','heat-grid');
 grid.style.gridTemplateColumns='160px repeat('+days.length+',minmax(68px,1fr))';
 grid.append(text('div','板块 / 日期','heat-head'));
 for(const d of days)grid.append(text('div',dateShort(d),'heat-head'+(d===state.selected?' is-current':'')));
 let known=0,total=0;
 for(const item of filtered.slice(state.sectorPage*40,state.sectorPage*40+40)){
   const open=item.code===state.sectorFocus;
   const title=text('button',item.name+(open?' ▴':' ▾'),'heat-label heat-label-button'+(open?' is-expanded':''));
   title.type='button';title.setAttribute('aria-expanded',String(open));
   title.title='点击'+(open?'收起':'展开')+item.name+'当日详情';
   title.addEventListener('click',()=>{
     state.sectorFocus=open?null:item.code;
     renderSectors();
     if(!open)window.requestAnimationFrame(()=>$('sector-inline-detail')?.scrollIntoView({behavior:'smooth',block:'nearest'}));
   });
   grid.append(title);
   for(const d of days){
     const v=metricValue(item.code,d,metric),lower=heatIsLowerBound(item.code,d,metric);
     const cell=text('button',heatValueText(v,metric,lower),'heat-cell heat-cell-button'+(v==null?' no-data':'')+(lower?' is-lower-bound':'')+(d===state.selected?' is-current':''));
     cell.type='button';total++;if(v!=null)known++;
     const point=sectorValue(d,item.code);
     cell.title=item.name+' · '+d+' · '+label+' '+heatValueText(v,metric,lower)+unit+
       (point.membership_mode==='backcast_current'?' · 以'+point.membership_observed_date+'成员回算':'');
     if(v!=null){
       const ratio=Math.min(Math.abs(v)/(['limit_up_count','limit_down_count'].includes(metric)?15:metric==='turnover'?2500:metric==='activity'?2:5),1);
       const rgb=['limit_down_count','limit_down_ratio'].includes(metric)?'35,145,118':
          ['turnover','activity'].includes(metric)?'49,115,151':v>=0?'192,73,85':'35,145,118';
       cell.style.background='rgba('+rgb+','+(.1+ratio*.55)+')';
     }
     cell.addEventListener('click',()=>{
       const toggled=state.sectorFocus===item.code&&state.selected===d;
       state.sectorFocus=toggled?null:item.code;
       if(state.selected!==d)setDay(d);else renderSectors();
       if(!toggled)window.requestAnimationFrame(()=>$('sector-inline-detail')?.scrollIntoView({behavior:'smooth',block:'nearest'}));
     });
     grid.append(cell);
   }
   if(open){
     const panel=text('div','','heat-inline-panel');
     panel.id='sector-inline-detail';panel.style.gridColumn='1 / span '+(days.length+1);
     grid.append(panel);
   }
 }
 heat.append(grid);
 $('heat-note').textContent='本页展示 '+Math.max(0,Math.min(40,filtered.length-state.sectorPage*40))+
   ' 个板块 · '+known+'/'+total+' 可核验格。热力图和折线图使用同一指标与日期窗口，展开查看对应股票。';
 renderSectorDetail();
}

async function renderSectorDetail(){
 const host=$('sector-inline-detail'),code=state.sectorFocus;
 if(!host||!code)return;
 host.replaceChildren();
 const selectedDate=state.selected,metric=$('heat-metric').value,board=sectorCatalog().find(x=>x.code===code);
 const point=sectorValue(selectedDate,code),asof=point.membership_observed_date,archive=snapshot(selectedDate);
 const header=text('div','','sector-band-header'),identity=text('div','','sector-band-identity');
 identity.append(text('strong',board?.name||code),text('span',selectedDate+' · '+code));
 identity.append(text('span',point.membership_mode==='backcast_current'?
   '按'+asof+'成分名单历史回算，不代表当时真实成分':
   asof?'使用'+asof+'确认的周度成分名单':'成分关系尚未采集','sector-band-source'));
 header.append(identity);
 const metrics=text('div','','sector-band-metrics');
 function box(label,value){
   const el=text('div','','sector-band-metric');
   el.append(text('small',label),text('b',value==null?'—':value));metrics.append(el);
 }
 const val=metricValue(code,selectedDate,metric),up=metricValue(code,selectedDate,'limit_up_count'),
 down=metricValue(code,selectedDate,'limit_down_count');
 box('当前指标 · '+SECTOR_META[metric][0],val==null?null:heatValueText(val,metric,heatIsLowerBound(code,selectedDate,metric))+SECTOR_META[metric][1]);
 box('当日板块涨跌',N(point.pct)==null?null:pct(point.pct));
 box('板块成交额',N(point.turnover)==null?null:number(point.turnover/1e8,2)+'亿元');
 box('成分数量',N(point.member_count)==null?null:number(point.member_count,0)+'只');
 box('归属涨停',N(up)==null?null:number(up,0)+'只');
 box('归属跌停',N(down)==null?null:heatValueText(down,'limit_down_count',heatIsLowerBound(code,selectedDate,'limit_down_count'))+'只');
 header.append(metrics);host.append(header);
 const loading=text('p','加载当日股票和成分关系…','sector-detail-empty');host.append(loading);
 const [memberFile,rep]=await Promise.all([
   loadMemberIndex(asof),
   window.MarketScopeHistory?.load?.()||Promise.resolve(null)
 ]);
 if($('sector-inline-detail')!==host||state.sectorFocus!==code||state.selected!==selectedDate||$('heat-metric').value!==metric)return;
 loading.remove();
 const members=memberFile?.members?.[code];
 if(!members){host.append(text('p','此日期缺少可验证成员名单，个股排名不做推断。','sector-detail-empty'));return;}
 const basePrices=rep?.prices||{},u=new Map((rep?.universe||[]).map(x=>[x.code,x]));
 const items=new Map();
 for(const [ticker,name]of Object.entries(members)){
   if(!u.has(ticker))continue;
   const bars=basePrices[ticker]||[],at=bars.findIndex(x=>x.date===selectedDate);
   if(at<0)continue;
   const bar=bars[at],prev=at>0?bars[at-1]:null;
   if(N(bar.close)==null)continue;
   const change=prev?.close>0?(bar.close/prev.close-1)*100:null;
   const back=bars.find(x=>x.date===state.days[0]),cum=back?.close>0?(bar.close/back.close-1)*100:null;
   const slice=at>=4?bars.slice(at-4,at+1).map(x=>N(x.turnover_100m)):null;
   const activity=slice&&!slice.some(x=>x==null)&&slice.reduce((a,b)=>a+b,0)>0?
     slice[4]/(slice.reduce((a,b)=>a+b,0)/5):null;
   items.set(ticker,{code:ticker,name:name||u.get(ticker).name,pct:change,
     turnover:N(bar.turnover_100m),price:bar.close,cum,activity,event:'代表池',boards:null});
 }
 const matched={up:[],down:[],break:[],hot:[]};
 for(const [type,list]of [['up',archive.stock_list||[]],['down',archive.limit_down_events||[]],
                          ['break',archive.limit_break_events||[]],['hot',archive.hot_rank_daily||[]]]){
   for(const row of list){
     const ticker=row.thscode||row.stock_code;
     if(!Object.prototype.hasOwnProperty.call(members,ticker))continue;
     const item=items.get(ticker)||{code:ticker,name:members[ticker],pct:null,turnover:null,
       price:null,cum:null,activity:null,boards:null,event:''};
     if(N(row.price_change_ratio_pct)!=null)item.pct=N(row.price_change_ratio_pct);
     if(N(row.turnover)!=null)item.turnover=N(row.turnover)/1e8;
     if(N(row.price??row.last_price)!=null)item.price=N(row.price??row.last_price);
     if(N(row.boards)!=null)item.boards=N(row.boards);
     if(N(row.rank)!=null)item.rank=N(row.rank);
     item.event={up:'涨停',down:'跌停',break:'炸板',hot:'热榜'}[type];
     item.reason=row.reason||row.limit_up_reason||row.limit_down_reason||item.reason||'';
     items.set(ticker,item);matched[type].push(item);
   }
 }
 for(const row of archive.sector_focus_stocks||[]){
   if(row.sector_code!==code||!Object.prototype.hasOwnProperty.call(members,row.stock_code))continue;
   const item=items.get(row.stock_code)||{code:row.stock_code,name:row.stock_name||members[row.stock_code],
     pct:null,turnover:null,price:null,cum:null,activity:null,event:''};
   if(N(row.pct)!=null)item.pct=N(row.pct);
   if(N(row.turnover_100m)!=null)item.turnover=N(row.turnover_100m);
   if(N(row.price)!=null)item.price=N(row.price);
   items.set(item.code,item);
 }
 const priced=[...items.values()].filter(x=>N(x.pct)!=null||N(x.turnover)!=null);
 const desc=k=>priced.filter(x=>N(x[k])!=null).sort((a,b)=>b[k]-a[k]).slice(0,6);
 const asc=k=>priced.filter(x=>N(x[k])!=null).sort((a,b)=>a[k]-b[k]).slice(0,6);
 const main=[...priced].sort((a,b)=>Number(u.has(b.code))-Number(u.has(a.code))||
   (b.turnover??-1)-(a.turnover??-1)).slice(0,6);
 const upList=[...matched.up].sort((a,b)=>(b.boards??0)-(a.boards??0)||(b.turnover??0)-(a.turnover??0)).slice(0,8);
 const downList=[...matched.down].sort((a,b)=>(a.pct??0)-(b.pct??0)).slice(0,8);
 let signal=[],title='',evidence='';
 if(['limit_up_count','limit_up_ratio'].includes(metric)){
   signal=upList;title='涨停接力前排';evidence='按真实连板高度排序';
 }else if(['limit_down_count','limit_down_ratio'].includes(metric)){
   signal=downList;title='跌停前排';evidence='按当日跌幅排序';
 }else if(metric==='limit_diff'){
   signal=[...upList.slice(0,4),...downList.slice(0,4)];title='涨跌停两端';evidence='涨停接力与跌停并列';
 }else if(metric==='hot_count'){
   signal=[...matched.hot].sort((a,b)=>(a.rank??999)-(b.rank??999)).slice(0,6);
   title='热榜前排';evidence='按归档热榜排名';
 }else if(metric==='turnover'){
   signal=desc('turnover');title='成交额前排';evidence='按有日K的代表股样本排序';
 }else if(metric==='activity'){
   signal=desc('activity');title='成交活跃度前排';evidence='近5个交易日成交额 / 日均';
 }else if(['cum','relative'].includes(metric)){
   signal=desc('cum');title='区间涨幅前排';evidence='有历史日K的代表股样本';
 }else if(['member_up_ratio','member_median'].includes(metric)){
   signal=[...desc('pct').slice(0,4),...asc('pct').slice(0,4)];
   title='内部涨跌两端';evidence='代表股样本中强弱股票';
 }else{
   signal=desc('pct');title='日涨幅前排';evidence='代表股样本中按日涨幅';
 }
 const layout=text('div','','sector-detail-columns');
 function makeBlock(name,subtitle,rows){
   const box=text('div','','sector-detail-section'),h=text('div','','sector-detail-heading');
   h.append(text('strong',name),text('span',subtitle));box.append(h);
   if(!rows.length){box.append(text('p','所选日期暂无可核验的个股记录。','sector-detail-empty'));return box;}
   const tbl=text('table','','sector-detail-table'),tr=text('tr','');
   for(const n of ['股票','涨跌幅','成交额','指标证据'])tr.append(text('th',n));
   const head=text('thead','');head.append(tr);tbl.append(head);
   const body=text('tbody','');
   for(const x of rows){
     const tr=text('tr',''),id=text('td','');
     const link=text('button',x.name,'sector-stock-link');
     link.type='button';
     link.addEventListener('click',()=>showDialog(x.name+' · '+x.code,[
       ['所属板块',board?.name||code],['成分名单日期',asof],
       ['当日涨跌幅',N(x.pct)==null?'—':signed(x.pct,2,'%')],
       ['成交额',N(x.turnover)==null?'—':number(x.turnover,2)+'亿元'],
       ['收盘价',N(x.price)==null?'—':number(x.price,2)],
       ['连板',x.boards==null?'—':x.boards+'板'],['事件',x.reason||x.event||'—']
     ]));
     id.append(link,text('small',x.code));
     tr.append(id,text('td',N(x.pct)==null?'—':signed(x.pct,2,'%'),
       N(x.pct)==null?'':x.pct>=0?'stock-positive':'stock-negative'));
     tr.append(text('td',N(x.turnover)==null?'—':number(x.turnover,2)+'亿'));
     const extra=x.boards!=null?x.boards+'板':metric==='activity'&&x.activity!=null?
       number(x.activity,2)+'倍':metric==='cum'&&x.cum!=null?signed(x.cum,2,'%'):
       x.rank!=null?'榜单第'+x.rank:x.event||'—';
     tr.append(text('td',extra));body.append(tr);
   }
   tbl.append(body);box.append(tbl);return box;
 }
 layout.append(makeBlock('主要成分股 · 有价格样本','成员名单 × 300只代表股观察池优先 · 按成交额展示',main));
 layout.append(makeBlock(title,evidence,signal));
 host.append(layout);
 const extras=text('div','','sector-detail-summary');
 if(['limit_up_count','limit_up_ratio','limit_diff'].includes(metric)){
   const highest=Math.max(0,...matched.up.map(x=>N(x.boards)||0));
   extras.append(text('span','最高连板 '+(highest?highest+'板':'—')));
   extras.append(text('span','2板及以上 '+matched.up.filter(x=>(N(x.boards)||0)>=2).length+'只'));
 }
 if(['limit_down_count','limit_down_ratio','limit_diff'].includes(metric))
   extras.append(text('span','跌停 '+(N(down)==null?'—':heatValueText(down,'limit_down_count',heatIsLowerBound(code,selectedDate,'limit_down_count'))+'只')));
 host.append(extras);
 host.append(text('p','个股价格样本可能仅覆盖300只代表股及当日事件股票，不应理解为全体成分股涨幅/成交额排名。历史成分回算与缺失数据均按来源标记。','sector-band-note'));
}
function compareValue(a,b,formatter,unit){return N(a)==null||N(b)==null?'—':formatter(Number(b)-Number(a))+(unit||'');}
function renderHistory(){const a=$('history-a').value||state.days[0],b=$('history-b').value||last(state.days),x=market(a),y=market(b),lx=limits(a),ly=limits(b);let host=cleared('history-comparison');for(const [label,key,unit] of MARKET_FIELDS){const va=key==='non_st'||key==='highest'?lx[key]:x[key],vb=key==='non_st'||key==='highest'?ly[key]:y[key];let el=text('div','','comparison-card');el.append(text('small',label+' · '+a+' → '+b));el.append(text('strong',N(va)==null||N(vb)==null?'—':signed(vb-va,key==='median'||key==='turnover_100m'?2:0,unit)));el.append(text('span',`${N(va)==null?'—':number(va)} → ${N(vb)==null?'—':number(vb)} ${unit}`));host.append(el);}
 const days=state.days;const data1=[{name:'非ST涨停',type:'line',data:days.map(d=>N(limits(d).non_st)),showSymbol:false},{name:'涨幅中位数（右轴）',type:'line',yAxisIndex:1,data:days.map(d=>N(market(d).median)),showSymbol:false}];if(data1.some(s=>s.data.some(x=>x!=null)))chart('history-sentiment',{xAxis:{type:'category',data:days.map(dateShort)},yAxis:[{type:'value',name:'只'},{type:'value',name:'%',scale:true}],series:data1},e=>{if(e.dataIndex!=null){$('history-b').value=days[e.dataIndex];renderHistory();}});else noChart('history-sentiment','历史赚钱效应数据不可用。');
 let dims=$('style-dimension').value||'价格分档',groups=[...new Set(days.flatMap(d=>(snapshot(d).styles||[]).filter(x=>x.dimension===dims).map(x=>x.group)))].slice(0,7);let series=groups.map(group=>({name:group,type:'line',showSymbol:false,data:days.map(d=>N((snapshot(d).styles||[]).find(x=>x.dimension===dims&&x.group===group)?.up_ratio))}));if(series.some(x=>x.data.some(v=>v!=null)))chart('history-style',{yAxis:{type:'value',min:0,max:100,name:'上涨占比%'},series},e=>{if(e.dataIndex!=null){$('history-b').value=days[e.dataIndex];renderHistory();}});else noChart('history-style','历史风格数据不可用。');
 const q=cleared('history-quality'),s=snapshot(b);fact(q,'已归档日期',`${state.archive.length} 个交易日；当前展示 ${state.days.length} 日。历史分日归档从 ${state.archive[0]||'—'} 开始。`);
 for(const [key,label] of [['market','全市场行情'],['limits','涨停池'],['limit_down_events','跌停池'],['limit_break_events','炸板池'],['sector_members','板块历史成分'],['hot_rank_daily','热股历史'],['anomaly_daily','当日异动']]){let fallback=key==='market'?s.market:key==='limits'?s.limits:s[key];let st=fieldStatus(b,key)||((fallback&&(!Array.isArray(fallback)||fallback.length))?'旧档案（字段有限）':'未采集');fact(q,`${label} · ${b}`,String(st),!['complete','旧档案（字段有限）'].includes(st));}}
function bind(){document.querySelectorAll('#navigation [data-page]').forEach(el=>el.addEventListener('click',()=>nav(el.dataset.page)));
 $('menu-btn').addEventListener('click',()=>$('sidebar').classList.toggle('open'));
 $('range-preset').addEventListener('change',()=>{$('apply-range').textContent=$('range-preset').value==='custom'?'应用自选区间':'应用区间';});
 $('apply-range').addEventListener('click',()=>applyRange($('range-preset').value));
 $('day-slider').addEventListener('input',e=>{stop();setDay(state.days[Number(e.target.value)]);});
 $('prev-day').addEventListener('click',()=>{stop();step(-1);});$('next-day').addEventListener('click',()=>{stop();step(1);});
 $('latest-day').addEventListener('click',()=>{stop();setDay(last(state.days));});$('play-day').addEventListener('click',playback);
 $('play-speed').addEventListener('change',()=>{if(state.playing){stop();playback();}});
 $('compare-enable').addEventListener('change',e=>{state.compare=e.target.checked;if(state.compare&&!state.compareBase)state.compareBase=state.days[0];$('compare-base').disabled=!state.compare;renderPage();});
 $('compare-base').addEventListener('change',e=>{state.compareBase=e.target.value;renderPage();});
 $('index-select').addEventListener('change',renderPage);$('market-trend-type').addEventListener('change',renderPage);
 $('style-dimension').addEventListener('change',renderPage);$('style-metric').addEventListener('change',renderPage);
 $('event-date').addEventListener('change',e=>{setDay(e.target.value);});$('event-type').addEventListener('change',renderEvents);$('event-search').addEventListener('input',renderEvents);
 $('sector-kind').addEventListener('change',e=>{state.sectorKind=e.target.value;state.sectorPage=0;state.sectorFocus=null;renderSectors();});
 $('heat-metric').addEventListener('change',()=>{state.sectorPage=0;state.sectorFocus=null;$('sector-sort').value='metric_desc';renderSectors();});
 $('sector-benchmark').addEventListener('change',renderSectors);
 $('sector-sort').addEventListener('change',()=>{state.sectorPage=0;renderSectors();});
 $('sector-date').addEventListener('change',e=>{if(state.days.includes(e.target.value)){setDay(e.target.value);}});
 $('heat-search').addEventListener('input',()=>{state.sectorPage=0;renderSectors();});
 $('sector-clear').addEventListener('click',()=>{
   $('sector-kind').value='industry';$('heat-metric').value='pct';
   $('sector-sort').value='metric_desc';$('heat-search').value='';
   state.sectorFocus=null;state.sectorPage=0;
   setDay(last(state.days));$('sector-research-panel')?.scrollIntoView({behavior:'smooth',block:'start'});
 });
 $('heat-prev').addEventListener('click',()=>{state.sectorPage--;renderSectors();$('sector-heat-anchor')?.scrollIntoView({behavior:'smooth',block:'start'});});
 $('heat-next').addEventListener('click',()=>{state.sectorPage++;renderSectors();$('sector-heat-anchor')?.scrollIntoView({behavior:'smooth',block:'start'});});
 /* Historical representative-stock controls bind in representatives.js. */
 $('close-dialog').addEventListener('click',()=>$('detail-dialog').hidden=true);$('detail-dialog').addEventListener('click',e=>{if(e.target===$('detail-dialog'))$('detail-dialog').hidden=true;});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('detail-dialog').hidden=true;stop();}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});window.addEventListener('pagehide',stop);
 window.addEventListener('hashchange',()=>{const page=location.hash.replace('#','');if(['today','events','sectors','history'].includes(page)&&page!==state.page)nav(page);});
 window.addEventListener('resize',()=>state.chartMap.forEach(c=>c.resize()));
}
async function bootstrap(){bind();try{const [dash,manifest]=await Promise.all([json('data/dashboard.json'),json('data/dates.json')]);if(!Array.isArray(dash.dates)||!dash.dates.length)throw new Error('最近市场档案无可用交易日');state.dash=dash;state.archive=(manifest.dates||dash.dates).filter(x=>typeof x==='string').sort();synthesizeDashboard(dash);state.days=[...dash.dates];state.selected=last(state.days);state.compareBase=state.days[0];setSelectors();$('status').textContent=`最近有效 ${dash.latest_date||state.selected} · ${dash.status||'未标记状态'}`;const scope=(dash.coverage?.archive_days)||state.archive.length;notice(`已载入 ${scope} 个归档交易日的索引，默认展示最近 ${state.days.length} 日。新增事件及成分归属仅在实际采集后出现。`,true);let initial=(location.hash||'#today').replace('#','');nav(['today','events','sectors','history'].includes(initial)?initial:'today');}catch(e){console.error(e);notice(`未能读取历史归档：${e.message}。检查部署路径和 JSON 数据文件。`);$('status').textContent='数据读取失败';}}
bootstrap();
})();
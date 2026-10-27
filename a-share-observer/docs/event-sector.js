/* MarketScope event replay: source-dated event themes, no live API credentials. */
(()=>{'use strict';
let a=null,ready='',loading=null,sector='',search='',timer=null,relayMode='up';
const $=id=>document.getElementById(id);
const num=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
const fmt=(v,dp=2)=>num(v)==null?'—':Number(v).toLocaleString('zh-CN',{minimumFractionDigits:dp,maximumFractionDigits:dp});
const pct=v=>num(v)==null?'—':(Number(v)>0?'+':'')+fmt(v)+'%';
const node=(tag,value,css)=>{let e=document.createElement(tag);if(value!==undefined)e.textContent=String(value??'');if(css)e.className=css;return e;};
const reset=id=>{let x=$(id);x.replaceChildren();return x;};
const dates=()=>a?.state?.days||[];
const selected=()=>a?.state?.selected;
const record=d=>a?.state?.snapshots.get(d)||{};
const list=(day,type)=>{let r=record(day),v=type==='up'?r.stock_list:type==='down'?r.limit_down_events:type==='break'?r.limit_break_events:type==='hot'?r.hot_rank_daily:type==='anomaly'?r.anomaly_daily:r.sector_focus_stocks;return Array.isArray(v)?v:null;};
function tags(reason){if(!reason||reason==='原因未披露')return[];return [...new Set(String(reason).split(/[+＋、，,；;|｜/]/).map(x=>x.trim()).filter(x=>x&&x!=='原因未披露'&&x.length<25))].slice(0,6);}
function evidence(code,at,source){let found={tags:[],date:null,official:false};for(let d of dates()){if(d>at)break;let hit=(list(d,'up')||[]).find(x=>x.thscode===code);if(hit){let t=tags(hit.reason||hit.limit_up_reason);if(t.length){found.tags=t;found.date=d;}}}
 const now=source&&tags(source.reason||source.limit_up_reason);if(now?.length){const observed=source.date&&source.date<=at?source.date:at;found.tags=now;found.date=observed;}
 const official=record(at).event_sector_map?.[code];if(Array.isArray(official)){found.official=true;let extra=official.map(x=>typeof x==='string'?x:x.name).filter(Boolean);found.tags=[...new Set([...found.tags,...extra])];}
 return found;}
function model(){let out=new Map(),day=selected();
 for(let date of dates()){if(date>day)break;for(let row of list(date,relayMode)||[]){if(!row.thscode||(relayMode==='up'&&row.is_st))continue;
 let x=out.get(row.thscode)||{code:row.thscode,name:row.name||row.thscode,boards:{},latest:date,row};
 x.name=row.name||x.name;
 let prev=dates()[dates().indexOf(date)-1];
 x.boards[date]=relayMode==='up'?(num(row.boards)??num(row.continue_day_cnt)??1):relayMode==='down'?((x.boards[prev]||0)+1):1;
 x.latest=date;x.row=row;out.set(x.code,x);}}
 for(let x of out.values()){let ev=evidence(x.code,day,x.row);x.tags=ev.tags;x.evidenceDay=ev.date;x.official=ev.official;x.group=x.tags[0]||'归属待核验';}
 return [...out.values()];}
function filterModel(items){const q=search.toLowerCase();return items.filter(x=>(!sector||x.tags.includes(sector))&&(!q||[x.code,x.name,...x.tags].join(' ').toLowerCase().includes(q)));}
function tagCounts(items){let result=new Map();for(let x of items)for(let t of x.tags){let v=result.get(t)||{name:t,window:0,today:0};v.window++;if(x.boards[selected()]!=null)v.today++;result.set(t,v);}return [...result.values()].sort((x,y)=>y.today-x.today||y.window-x.window||x.name.localeCompare(y.name,'zh'));}
function stampTags(parent,labels,official){if(!labels?.length){parent.append(node('span','归属待核验','event-tag unknown'));return;}
 for(let t of labels.slice(0,5)){let b=node('span',t,'event-tag'+(official?' official':''));b.title=official?'当日成分归属':'涨停原因包含的题材线索，不证明正式板块成分关系';parent.append(b);}}
function refreshFilters(counts){let sel=$('event-sector-filter'),old=sector;sel.replaceChildren();let op=node('option','全部板块线索');op.value='';sel.append(op);
 for(let v of counts){let item=node('option',v.name+' · 当日'+v.today+'只 / 区间'+v.window+'只');item.value=v.name;sel.append(item);}
 if(old&&!counts.some(x=>x.name===old)){let item=node('option',old+' · 当日无记录');item.value=old;sel.append(item);}
 sel.value=old;}
function renderGroups(counts){let el=reset('event-sector-summary');for(let c of counts.slice(0,18)){let b=node('button',undefined,'event-sector-pill'+(sector===c.name?' active':''));b.type='button';b.append(node('strong',c.name),node('span',c.today+'只当日 · '+c.window+'只区间'));b.addEventListener('click',()=>{sector=sector===c.name?'':c.name;renderNow();$('event-relay-anchor').scrollIntoView({behavior:'smooth',block:'start'});});el.append(b);}
 if(counts.length>18)el.append(node('span','其余'+(counts.length-18)+'类见下拉筛选','event-sector-more'));}
function renderTimeline(){let ds=dates(),i=ds.indexOf(selected());$('events-day-slider').max=Math.max(0,ds.length-1);$('events-day-slider').value=Math.max(0,i);$('events-slider-date').textContent=selected();$('events-first-day').textContent=ds[0]?.slice(5)||'—';$('events-last-day').textContent=ds.at(-1)?.slice(5)||'—';$('events-prev').disabled=i===0;$('events-next').disabled=i===ds.length-1;$('event-date').value=selected();}
function stop(){if(timer){clearInterval(timer);timer=null;}$('events-play').textContent='▶ 回放';}
function move(delta){stop();let ds=dates(),i=ds.indexOf(selected());if(ds.length)a.setDay(ds[Math.max(0,Math.min(ds.length-1,i+delta))]);}
function play(){if(timer){stop();return;}let ds=dates();if(ds.length<2)return;if(selected()===ds.at(-1))a.setDay(ds[0]);$('events-play').textContent='Ⅱ 暂停';timer=setInterval(()=>{let i=dates().indexOf(selected());if(i>=dates().length-1){stop();return;}a.setDay(dates()[i+1]);},1100);}
function feedbackCard(title,detail){let card=node('article',undefined,'event-feedback-card');card.append(node('small',title));
 if(!detail){card.append(node('b','—','event-feedback-value'),node('p','该日未取得足够的次日收益观察。','event-feedback-note'));return card;}
 card.append(node('b',pct(detail.close_median_pct),'event-feedback-value'+(num(detail.close_median_pct)<0?' is-negative':'')),node('span','次日收盘中位数','event-feedback-label'));
 let grid=node('div',undefined,'event-feedback-metrics');for(let [lab,key]of [['开盘中位数','open_median_pct'],['收盘均值','close_mean_pct'],['开盘上涨比','open_positive_ratio'],['收盘上涨比','close_positive_ratio']]){let p=node('div',undefined,'event-feedback-metric');p.append(node('small',lab),node('strong',pct(detail[key])));grid.append(p);}card.append(grid);
 card.append(node('p','有价格 '+(detail.sample_size??'—')+'/'+(detail.total_events??'—')+' 只 · 未匹配 '+(detail.excluded_no_prices??'—')+' 只','event-feedback-note'));return card;}
function sectorFeedback(d,key){let info=record(d).next_day_feedback,original=info?.[key];
 if(!sector)return original||null;
 if(!info||!Array.isArray(original?.samples))return null;
 const previous=info.reference_date;
 if(!record(previous)?.stock_list)return null;
 let rows=original.samples.filter(r=>evidence(r.code,previous).tags.includes(sector));
 if(!rows.length)return null;
 const summarize=(name)=>{let vals=rows.map(x=>num(x[name])).filter(x=>x!==null).sort((a,b)=>a-b);if(!vals.length)return null;let mid=Math.floor(vals.length/2);return {avg:vals.reduce((a,b)=>a+b,0)/vals.length,med:vals.length%2?vals[mid]:(vals[mid-1]+vals[mid])/2,pos:100*vals.filter(x=>x>0).length/vals.length};};
 let op=summarize('open_pct'),cl=summarize('close_pct');if(!op||!cl)return null;
 return {sample_size:rows.length,total_events:rows.length,excluded_no_prices:0,
 open_median_pct:op.med,open_mean_pct:op.avg,open_positive_ratio:op.pos,
 close_median_pct:cl.med,close_mean_pct:cl.avg,close_positive_ratio:cl.pos};
}
function feedback(){let data=record(selected()).next_day_feedback||{},ref=data.reference_date;
 $('event-feedback-context').textContent=ref?'事件 '+ref+' → 收益 '+selected():'所选日期尚无T+1明细';
 let host=reset('event-feedback-grid');
 host.append(feedbackCard('前日涨停 · T+1',sectorFeedback(selected(),'limit_up')),
             feedbackCard('前日炸板 · T+1',sectorFeedback(selected(),'limit_break')),
             feedbackCard('前日跌停 · T+1',sectorFeedback(selected(),'limit_down')));
 $('event-feedback-scope').textContent=sector?'已按「'+sector+'」筛选：仅用上一交易日已有题材证据且带有真实次日开收盘价的个股重新计算；没有归属或逐股价格的样本不推断。':'默认全市场事件池全部有效样本。滑块切换交易日；收益均是实际开盘价与收盘价变动，不是模拟交易。';
 const keys=[['limit_up','涨停股'],['limit_break','炸板股'],['limit_down','跌停股']],ds=dates();
 const series=keys.map(([key,name])=>({type:'line',name,connectNulls:false,symbolSize:6,data:ds.map(d=>num(sectorFeedback(d,key)?.close_median_pct))}));
 if(series.some(x=>x.data.some(y=>y!==null)))a.chart('event-feedback-chart',{xAxis:{type:'category',data:ds.map(x=>x.slice(5))},yAxis:{type:'value',scale:true,name:'次日收盘中位数 %'},legend:{top:0,type:'scroll'},series},event=>{if(event.dataIndex!=null){a.setDay(ds[event.dataIndex]);$('event-feedback-anchor').scrollIntoView({block:'start',behavior:'smooth'});}});
 else a.noChart('event-feedback-chart','所选区间 / 题材没有可复核的次日正负反馈，未知不等于0。');}
function relay(items){let hit=filterModel(items),day=selected(),ds=dates(),host=reset('event-relay-chart'),group=new Map();
 for(let x of hit){let key=sector||x.group;if(!group.has(key))group.set(key,[]);group.get(key).push(x);}
 let order=[...group].sort((a,b)=>b[1].filter(x=>x.boards[day]!=null).length-a[1].filter(x=>x.boards[day]!=null).length||b[1].length-a[1].length);
 let mat=node('div',undefined,'event-relay-matrix');mat.style.gridTemplateColumns='minmax(190px,260px) repeat('+ds.length+',minmax(56px,1fr))';
 mat.append(node('div',relayMode==='up'?'涨停个股 / 题材':relayMode==='down'?'跌停个股 / 题材':'炸板个股 / 题材','event-relay-head'));
 for(let d of ds){let b=node('button',d.slice(5),'event-relay-head'+(d===day?' is-current':''));b.type='button';b.addEventListener('click',()=>a.setDay(d));mat.append(b);}
 let shown=0;const limit=70;
 for(let [groupName,arr]of order){if(shown>=limit)break;arr.sort((a,b)=>(b.boards[day]||0)-(a.boards[day]||0)||Math.max(...Object.values(b.boards))-Math.max(...Object.values(a.boards)));
 let top=node('div',groupName+' · '+arr.filter(x=>x.boards[day]!=null).length+'只当日 / '+arr.length+'只区间','event-relay-group');top.style.gridColumn='1 / span '+(ds.length+1);mat.append(top);
 for(let x of arr){if(shown>=limit)break;shown++;let name=node('button',undefined,'event-relay-name');name.type='button';name.append(node('strong',x.name),node('small',x.code));let chips=node('span',undefined,'event-row-tags');stampTags(chips,x.tags,x.official);name.append(chips);
 name.addEventListener('click',()=>a.showDialog(x.name,[['代码',x.code],['可核验题材',x.tags.join(' / ')||'未收录'],['最近来源日',x.evidenceDay||'未收录'],['逐日板数',ds.filter(d=>x.boards[d]!=null).map(d=>d+'：'+x.boards[d]+'板').join('；')]]));mat.append(name);
 for(let d of ds){let v=x.boards[d],valid=list(d,relayMode)!==null,lab=!valid?'—':v!=null?(relayMode==='up'?v+'板':relayMode==='down'?v+'跌':'炸'):'·';let b=node('button',lab,'event-relay-cell'+(v!=null?(relayMode==='up'?' has-limit':relayMode==='down'?' has-down':' has-break'):'')+(d===day?' is-current':'')+(!valid?' no-data':'')+(d>day?' is-future':''));b.type='button';b.style.setProperty('--level',Math.min(1,Math.max(0,((v||0)-1)/6)));b.title=x.name+' '+d+'：'+(v!=null?(relayMode==='up'?v+'连板':relayMode==='down'?v+'连续跌停':'炸板事件'):valid?'未出现在当日事件池':'数据未采集');b.addEventListener('click',()=>a.setDay(d));mat.append(b);}}
 }
 if(hit.length)host.append(mat);else host.append(node('p','当前题材和搜索条件下没有对应的历史个股。','inline-note'));
 $('event-relay-footer').textContent='展示 '+shown+'/'+hit.length+' 只 · '+(relayMode==='up'?'红色为实际连板高度':relayMode==='down'?'绿色为连续跌停次数':'橙色为当日炸板事件')+'；· 为当日未进入对应事件池，— 为未采集；题材线索不等同于正式板块归属。';}
function poolTable(){let d=selected(),type=$('event-type').value,rows=list(d,type),body=reset('event-list'),head=reset('event-head'),header=node('tr');
 for(let c of ['股票 / 代码','题材 / 板块线索','板数 / 排名','价格','事件原因'])header.append(node('th',c));head.append(header);
 const states={up:'limits',down:'limit_down_events',break:'limit_break_events',hot:'hot_rank_daily',anomaly:'anomaly_daily',focus:'sector_focus_stocks'},q=record(d).quality_manifest?.[states[type]]?.status;
 $('event-quality').textContent=d+' · '+(q||'旧归档')+' · '+(rows?.length??'—')+' 条原始事件；选中题材 '+(sector||'全部');
 if(!rows){let tr=node('tr'),td=node('td','该日未采集此事件池；未知不等于0。');td.colSpan=5;tr.append(td);body.append(tr);return;}
 let found=0;for(let r of rows){let code=r.thscode||r.stock_code,ev=evidence(code,d,r),tags=ev.tags,name=r.name||r.stock_name||code||'—',text=$('event-search').value.toLowerCase().trim();
 if(sector&&!tags.includes(sector))continue;if(text&&![name,code,r.reason,r.event_reason,r.limit_up_reason,...tags].join(' ').toLowerCase().includes(text))continue;
 found++;if(found>500)continue;let tr=node('tr',undefined,'clickable'),n=node('td');n.append(node('strong',name),node('small',code));tr.append(n);let tagcell=node('td'),sp=node('div',undefined,'event-row-tags');stampTags(sp,tags,ev.official);tagcell.append(sp);tr.append(tagcell);
 tr.append(node('td',r.boards??r.continue_day_cnt??r.rank??r.event_type??'—'),node('td',fmt(r.price??r.last_price)),node('td',r.reason||r.limit_up_reason||r.event_reason||r.limit_down_reason||r.tag_name||'—'));
 tr.addEventListener('click',()=>a.showDialog(name,Object.entries(r)));body.append(tr);}
 if(!found){let tr=node('tr'),td=node('td','该筛选在选定日没有对应事件。');td.colSpan=5;tr.append(td);body.append(tr);}
 if(found>500)$('event-quality').textContent+=' · 列表前500条（共'+found+'条）';}
function renderNow(){if(!$('events-day-slider'))return;renderTimeline();
 let today=record(selected()),l=today.limits||{},host=reset('event-kpis');
 for(let [label,val]of [['非ST涨停',l.non_st],['首板',l.first],['连板',l.continued],['最高板',l.highest],['跌停已归档',list(selected(),'down')?.length],['炸板已归档',list(selected(),'break')?.length]]){let box=node('div',undefined,'kpi');box.append(node('small',label),node('strong',num(val)==null?'—':fmt(val,0)));host.append(box);}
 let items=model(),counts=tagCounts(items);refreshFilters(counts);renderGroups(counts);
 $('event-sector-quality').textContent='截至所选交易日，所选事件池区间共有 '+items.length+' 只个股 · '+counts.length+' 个事件题材线索。一个股票可对应多个题材，因此类别计数不可求和；题材来源于该日或此前事件原因，不等于同花顺板块正式成分。';
 feedback();relay(items);poolTable();}
async function render(context){a=context;let key=dates().join('/');
 if(key!==ready){if(!loading)loading=context.loadRange([...dates()]).finally(()=>{loading=null;ready=key;});await loading;}
 if(a.state.page==='events')renderNow();}
function binding(){if(window.__eventsBound)return;window.__eventsBound=true;
 $('events-day-slider')?.addEventListener('input',event=>{stop();a?.setDay(dates()[Number(event.target.value)]);});
 $('events-prev')?.addEventListener('click',()=>move(-1));$('events-next')?.addEventListener('click',()=>move(1));$('events-play')?.addEventListener('click',play);
 $('event-sector-filter')?.addEventListener('change',ev=>{sector=ev.target.value;renderNow();$('event-relay-anchor').scrollIntoView({behavior:'smooth',block:'start'});});
 $('event-clear-filter')?.addEventListener('click',()=>{sector='';search='';$('event-stock-filter').value='';$('event-search').value='';renderNow();});
 $('event-stock-filter')?.addEventListener('input',ev=>{search=ev.target.value.trim();renderNow();});
 $('event-relay-mode')?.addEventListener('change',ev=>{relayMode=ev.target.value;sector='';$('event-type').value=relayMode;renderNow();$('event-relay-anchor').scrollIntoView({behavior:'smooth',block:'start'});});
 $('event-type')?.addEventListener('change',ev=>{if(['up','down','break'].includes(ev.target.value)){relayMode=ev.target.value;$('event-relay-mode').value=relayMode;}renderNow();});$('event-search')?.addEventListener('input',poolTable);
 document.querySelectorAll('#navigation [data-page]').forEach(b=>b.addEventListener('click',stop));
 document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});window.addEventListener('pagehide',stop);}
binding();window.MarketScopeEvents={render,stop};
})();
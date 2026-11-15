(function(root){
'use strict';
const ms=v=>typeof v==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
function cutoff(day){return ms(day+'T14:45:00+08:00');}
function eligible(r,at){const publicBound=ms(r.published_at||r.announced_at||(r.published_precision==='date'?r.availability_boundary:null));return Number.isFinite(publicBound)&&Number.isFinite(ms(r.available_at))&&publicBound<=ms(r.available_at)&&ms(r.available_at)<=at;}
function visible(records,at){const rows=records.filter(r=>eligible(r,at)),sup=new Set(rows.map(r=>r.supersedes).filter(Boolean));return rows.filter(r=>!sup.has(r.id));}
function bucket(event,at,days){const t=ms(event.scheduled_at);return Number.isFinite(t)&&t>=at&&t<=at+days*86400000;}
function stale(checked,now){return !Number.isFinite(ms(checked))||now-ms(checked)>48*3600000;}
const utils={cutoff,eligible,visible,bucket,stale};root.PolicyContextUtils=utils;
if(typeof document==='undefined')return;
let payload,promise,mode='current',windowDays=7,serial=0;
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const link=(text,url)=>{const a=el('a',text);if(/^https:\/\//.test(url)){a.href=url;a.target='_blank';a.rel='noopener noreferrer';}return a;};
const fmt=t=>t?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short'}).format(new Date(t))+' 北京时间':'时间未定';
async function render(ctx){const host=document.getElementById('policy-content');if(!host)return;const seq=++serial;host.replaceChildren(el('p','读取核验政策与经济资料…'));
try{if(!payload){promise ||= fetch('data/policy-context.json').then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();});payload=await promise;}}catch(e){promise=null;host.replaceChildren(el('p','资料读取失败，不能据此排除政策或事件风险。'));const retry=el('button','重试');retry.onclick=()=>render(ctx);host.append(retry);return;}if(seq!==serial)return;
const at=mode==='history'?cutoff(ctx.state.selected):Date.now(),records=visible(payload.records,at);host.replaceChildren();
const controls=el('div',undefined,'policy-controls');for(const [v,label] of [['current','当前已核验资料'],['history','所选日14:45可用档案']]){const b=el('button',label);b.type='button';b.setAttribute('aria-pressed',String(mode===v));b.onclick=()=>{mode=v;render(ctx);};controls.append(b);}host.append(controls);
host.append(el('p',mode==='current'?`当前资料模式，不跟随历史行情日。最后核查：${fmt(payload.checked_at)}。人工核验快照，不是实时数据。`:`严格档案模式：截止 ${ctx.state.selected} 14:45。要求公开和本系统留存时间均不晚于截止点；后来补录不会倒填。`,'policy-note'));
if(stale(payload.checked_at,Date.now()))host.append(el('p','核验已超过48小时：本页留存旧资料，日程和政策可能已变更。未完成新一轮核验，不能当作最新状态。','policy-inference'));
const macro=el('section',undefined,'panel');macro.id='policy-macro';macro.append(el('h2','经济事实与解释'));if(!records.length)macro.append(el('p','该时点没有已留存的可用资料。当前新增条目不倒灌历史，不代表当时不存在经济数据。'));
for(const r of records){const card=el('article',undefined,'policy-record');card.id=r.id;card.append(el('span',r.kind==='official_commentary'?'官方解读 · 不是政策文件':r.kind==='policy'?'正式政策发布':'已公布统计事实','policy-kind'),el('h3',r.title),el('p',r.summary));if(r.metrics?.length){const metrics=el('dl',undefined,'policy-metrics');for(const m of r.metrics){const g=el('div');g.append(el('dt',m.name),el('dd',m.value+' '+m.unit),el('small',m.basis));metrics.append(g);}card.append(metrics);}if(r.effective_at)card.append(el('p','生效时刻：'+fmt(r.effective_at)));card.append(el('p','研究推论：'+r.interpretation,'policy-inference'),el('p','限制：'+r.limitations,'policy-note'),el('small',`报告期 ${r.period} · 原文发布日期 ${r.published_precision==='date'?r.published_date+'（时刻未知）':fmt(r.published_at)}${r.availability_boundary?' · 保守可用界限 '+fmt(r.availability_boundary):''} · 留存 ${fmt(r.observed_at)} · 版本 ${r.revision}`),link('核对官方原文',r.source_url));macro.append(card);}host.append(macro);
const cal=el('section',undefined,'panel');cal.id='policy-calendar';cal.append(el('h2','事件前瞻：预案与结果分开'));const filter=el('div',undefined,'policy-controls');for(const n of [7,30]){const b=el('button',`未来${n}天`);b.setAttribute('aria-pressed',String(windowDays===n));b.onclick=()=>{windowDays=n;render(ctx);};filter.append(b);}cal.append(filter,el('p','官方初步计划可能调整。未取得可靠一致预期，不显示“超预期”。','policy-note'));const events=visible(payload.events,at).filter(r=>bucket(r,at,windowDays)).sort((a,b)=>ms(a.scheduled_at)-ms(b.scheduled_at));if(!events.length)cal.append(el('p','此窗口没有已核验且当时可用的计划记录，不表示没有重大事件。'));for(const r of events){const item=el('article',undefined,'policy-event');item.id=r.id;item.append(el('time',fmt(r.scheduled_at)),el('h3',r.title),el('p','观察预案：'+r.plan),el('p',r.result&&ms(r.result_published_at)<=at?'已公布结果：'+r.result:'实际结果：未核验或尚未公布'),link('官方日程',r.source_url));cal.append(item);}host.append(cal);
const watch=el('details');watch.append(el('summary','日期未定的观察项（研究计划，不是已宣布事件）'));for(const r of (mode==='current'?payload.watchlist:[])){const item=el('article',undefined,'policy-record');item.append(el('h3',r.title),el('p',r.plan),link('核查入口',r.source_url));watch.append(item);}if(mode==='history')watch.append(el('p','日期未定研究计划不加入历史可用证据。'));host.append(watch);
const gaps=el('details');gaps.append(el('summary','数据覆盖与缺口'));for(const g of payload.gaps)gaps.append(el('p',g));host.append(gaps);
}
root.MarketScopePolicy={render,utils};
})(typeof window==='undefined'?globalThis:window);

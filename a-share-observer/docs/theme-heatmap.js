/* Source-dated theme watchlists. No retrospective membership or automatic exits. */
(()=>{'use strict';
let data=null,pending=null,context=null,expanded='',page=0,stockPage=0,query='',span=20,sort='total',generation=0;
const riskDone=new Set(),riskPending=new Set(),riskFailed=new Set();
const MEMBERSHIP_START='2026-10-28';
const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
const finite=v=>v!==null&&v!==undefined&&Number.isFinite(Number(v));
const percent=v=>finite(v)?(v>0?'+':'')+Number(v).toFixed(2)+'%':'—';
function cutoff(){return data.dates.findLastIndex(d=>d<=(context?.state.selected||data.dates.at(-1)));}
function score(member,end){const series=data.stocks[member.code]?.daily||[];let total=0,max=0;for(let i=0;i<=end;i++){if(data.dates[i]<member.since)continue;let b=series[i]?.[1];if(finite(b)&&b>0){total++;max=Math.max(max,b);}}return {total,max,current:series[end]?.[1]||0};}
function coverage(end){const admitted=new Map();for(const t of data.themes)for(const m of t.members)if(m.since<=data.dates[end]&&(!admitted.has(m.code)||admitted.get(m.code)>m.since))admitted.set(m.code,m.since);let total=0,have=0,today=0;for(const [code,since]of admitted){for(let i=0;i<=end;i++)if(data.dates[i]>=since){total++;if(finite(data.stocks[code]?.daily[i]?.[0]))have++;}if(finite(data.stocks[code]?.daily[end]?.[0]))today++;}return {total,have,today,count:admitted.size};}
function labelCount(value,status){return value==null?'—':(status==='partial'?'≥':'')+value;}
function toggle(name){expanded=expanded===name?'':name;stockPage=0;draw();}
function makeCell(label,cls){const td=el('td',null,cls);td.append(label);return td;}
function draw(){if(!data||!context||!$('theme-matrix'))return;const end=cutoff(),host=$('theme-matrix');host.replaceChildren();if(end<0){$('theme-status').textContent='所选日期无可核验归属，现有记录自 '+(data.coverage?.membership_start||MEMBERSHIP_START)+' 起。';$('theme-warning').textContent='';$('theme-warning').hidden=true;$('theme-page').textContent='0/0';$('theme-prev').disabled=true;$('theme-next').disabled=true;host.append(el('p','所选日期尚无题材归档。'));return;}
 const indices=data.dates.map((_,i)=>i).filter(i=>i<=end&&(span===0||i>end-span));
 const visible=data.themes.filter(t=>t.members.some(m=>m.since<=data.dates[end])&&(!query||t.name.toLowerCase().includes(query)||t.members.some(m=>m.since<=data.dates[end]&&(m.code+' '+data.stocks[m.code]?.name).toLowerCase().includes(query))));
 visible.sort((a,b)=>(b.daily[end]?.[0]||0)-(a.daily[end]?.[0]||0)||(b.daily[end]?.[2]||0)-(a.daily[end]?.[2]||0)||a.name.localeCompare(b.name,'zh'));
 const pages=Math.max(1,Math.ceil(visible.length/20));page=Math.min(page,pages-1);$('theme-page').textContent=`${page+1}/${pages} · ${visible.length} 题材`;$('theme-prev').disabled=page===0;$('theme-next').disabled=page===pages-1;
 const cov=coverage(end);$('theme-status').textContent=`归属记录自 ${data.coverage?.membership_start||'未知'} · 正式概念 · 涨跌停仅统计已纳入股票 · 已载入涨幅 ${cov.have}/${cov.total} 个股日（${cov.total?(100*cov.have/cov.total).toFixed(1):0}%） · 当日 ${cov.today}/${cov.count} 只`;if(cov.have<cov.total)$('theme-status').textContent+=' · 价格待补齐';if(riskFailed.size)$('theme-status').textContent+=' · '+riskFailed.size+' 只档案读取失败，可重试';$('theme-warning').textContent=cov.count&&cov.today/cov.count<.8?`所选日已载入涨幅仅 ${cov.today}/${cov.count} 只；缺失不是平盘，不能据此判断完整涨跌表现。`:'';$('theme-warning').hidden=!$('theme-warning').textContent;
 const table=el('table',null,'theme-table'),head=el('thead'),hr=el('tr');hr.append(el('th','题材 / 跟踪股'));for(const i of indices){const th=el('th',data.dates[i].slice(5));th.title=data.dates[i];hr.append(th);}head.append(hr);table.append(head);const body=el('tbody');
 for(const theme of visible.slice(page*20,page*20+20)){
  const tr=el('tr',null,'theme-summary'),name=el('button',null,'theme-name');name.type='button';name.setAttribute('aria-expanded',String(expanded===theme.code));name.append(el('strong',(expanded===theme.code?'▾ ':'▸ ')+theme.name),el('small',theme.members.filter(m=>m.since<=data.dates[end]).length+' 只持续跟踪'));name.addEventListener('click',()=>toggle(theme.code));tr.append(makeCell(name,'theme-sticky'));
  for(const i of indices){const value=theme.daily[i]||[],quality=data.quality[i]||{},button=el('button',null,'theme-day');button.type='button';button.setAttribute('aria-label',`${theme.name} ${data.dates[i]} 涨停${labelCount(value[0],quality.up)} 跌停${labelCount(value[1],quality.down)}，展开个股`);button.append(el('span','涨 '+labelCount(value[0],quality.up),'theme-up'),el('span','跌 '+labelCount(value[1],quality.down),'theme-down'));button.style.setProperty('--up',Math.min(.30,(value[0]||0)*.025));button.style.setProperty('--down',Math.min(.30,(value[1]||0)*.025));button.addEventListener('click',()=>toggle(theme.code));tr.append(makeCell(button));}body.append(tr);
  if(expanded!==theme.code)continue;
  const members=theme.members.filter(m=>m.since<=data.dates[end]).map(m=>({...m,...score(m,end)}));members.sort((a,b)=>b[sort==='streak'?'max':'total']-a[sort==='streak'?'max':'total']||b.total-a.total||a.code.localeCompare(b.code));
  const countPages=Math.max(1,Math.ceil(members.length/50));stockPage=Math.min(stockPage,countPages-1);const info=el('tr',null,'theme-detail-info'),infoTd=el('td');infoTd.colSpan=indices.length+1;infoTd.append(el('span',`纳入后累计涨停天数排序 · ${members.length} 只 · ${stockPage+1}/${countPages} 页 · 展开时补读站内个股档案 `));if(sort==='streak')infoTd.firstChild.textContent=`纳入以来观察到的最高连板排序 · ${members.length} 只 · ${stockPage+1}/${countPages} 页 `;
  for(const [text,delta] of [['上一页',-1],['下一页',1]]){const b=el('button',text,'btn');b.type='button';b.disabled=stockPage+delta<0||stockPage+delta>=countPages;b.addEventListener('click',()=>{stockPage+=delta;draw();});infoTd.append(b);}info.append(infoTd);body.append(info);
  const shownMembers=members.slice(stockPage*50,stockPage*50+50);loadRisk(shownMembers.map(m=>m.code));
  for(const member of shownMembers){const stock=data.stocks[member.code],row=el('tr',null,'theme-stock'),cell=el('td',null,'theme-sticky');cell.append(el('strong',stock.name),el('small',`${member.code} · ${member.total} 天涨停`));cell.title=`${member.since} 以当时概念归属及涨停记录纳入；成分证据 ${member.membership_observed_date||'待核验'}；观察到最高 ${member.max} 连板（可能纳入前已连板）`;row.append(cell);
   for(const i of indices){const day=data.dates[i],point=stock.daily[i]||[],td=el('td',null,'theme-stock-day');if(day<member.since){td.append(el('span','·'));td.title='尚未纳入';}else{const up=finite(point[1])&&point[1]>0,down=point[2]===true;td.classList.add(up?'is-up':down?'is-down':'is-tracked');td.append(el('strong',percent(point[0])),el('small',up?point[1]+'连板':down?'跌停':point[1]===0?'非涨停':'涨停状态缺失'));td.title=`${stock.name} ${day} · ${day===member.since?'首日纳入 · ':''}${percent(point[0])}${!finite(point[0])?'（涨跌幅缺失）':''} · ${data.price_sources?.[point[3]]||'来源未标记'}`;}row.append(td);}body.append(row);}
 }
 if(!visible.length){host.append(el('p',data.coverage?.membership_start&&data.dates[end]<data.coverage.membership_start?'该日期无可核验概念归属；现有记录自 '+data.coverage.membership_start+' 起。':'没有匹配的题材或股票。'));return;}table.append(body);host.append(table);
}
async function loadRisk(codes){
 const todo=codes.filter(code=>!riskDone.has(code)&&!riskPending.has(code)&&!riskFailed.has(code));if(!todo.length)return;
 const token=generation,model=data;todo.forEach(code=>riskPending.add(code));let cursor=0;
 await Promise.all(Array.from({length:Math.min(4,todo.length)},async()=>{while(cursor<todo.length){const code=todo[cursor++];try{const r=await fetch('data/risk-stocks/'+encodeURIComponent(code)+'.json');if(token!==generation)return;if(r.status===404){riskDone.add(code);continue;}if(!r.ok)throw Error('archive unavailable');const record=await r.json();if(token!==generation)return;if(record.code!==code)throw Error('identity mismatch');window.MarketScopeThemeModel.addRisk(model,record);riskDone.add(code);}catch{if(token===generation)riskFailed.add(code);}finally{if(token===generation)riskPending.delete(code);}}}));
 if(token===generation)draw();
}
async function render(ctx){context=ctx;
 if(ctx.state.detailLoaded&&ctx.state.days.some(d=>!ctx.state.detailLoaded.has(d))){$('theme-status').textContent='正在加载站内行情归档…';return;}
 if(!pending&&!data){$('theme-status').textContent='正在核对站内概念归属…';const token=generation;const job=(async()=>{
 const days=(ctx.state.archive||ctx.state.days).filter(d=>d>=MEMBERSHIP_START);
 await ctx.loadRange(days);
 if(token!==generation)return;data=window.MarketScopeThemeModel.build(days.map(d=>ctx.state.detailLoaded?.has(d)?ctx.state.snapshots.get(d):{date:d}));
 })().catch(()=>{if(token===generation)$('theme-status').textContent='概念归档加载失败，请重试。';}).finally(()=>{if(pending===job)pending=null;});pending=job;}
 if(pending)await pending;draw();
}
$('theme-search')?.addEventListener('input',e=>{query=e.target.value.trim().toLowerCase();page=0;draw();});$('theme-window')?.addEventListener('change',e=>{span=Number(e.target.value);draw();});$('theme-sort')?.addEventListener('change',e=>{sort=e.target.value;stockPage=0;draw();});$('theme-prev')?.addEventListener('click',()=>{page=Math.max(0,page-1);draw();});$('theme-next')?.addEventListener('click',()=>{page++;draw();});$('theme-retry')?.addEventListener('click',()=>{generation++;riskDone.clear();riskPending.clear();riskFailed.clear();data=null;pending=null;if(context)render(context);});
window.MarketScopeThemes={render};
})();

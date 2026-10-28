/* Date-aligned MarketScope fund observation. Balance differences != buy flows. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
let data=null,pending=null,error=null,wired=false;
const fmt=(v,d=2)=>v==null||!Number.isFinite(Number(v))?'—':
 Number(v).toLocaleString('zh-CN',{maximumFractionDigits:d,minimumFractionDigits:d});
const signed=v=>v==null?'—':(v>0?'+':'')+fmt(v);
function node(tag,label,cls){const e=document.createElement(tag);e.textContent=label||'';if(cls)e.className=cls;return e;}
function card(host,title,value,desc){const e=node('div','','fund-card');e.append(node('span',title,'fund-card-title'),node('strong',value,'fund-card-value'),node('small',desc,'fund-card-note'));host.append(e);}
function load(){if(pending)return pending;pending=fetch('data/funds-observer.json',{cache:'no-store'})
 .then(r=>{if(!r.ok)throw Error(String(r.status));return r.json();})
 .then(j=>{data=j;error=null;return j;})
 .catch(e=>{error=e.message;data=null;return null;});return pending;}
function render({state,chart,noChart}){
 if(!$('funds-observer'))return;
 if(!wired){wired=true;$('fund-chart-metric').addEventListener('change',()=>render({state,chart,noChart}));}
 if(!data&&!error){$('fund-status').textContent='正在读取真实资金归档…';
  load().then(()=>{if(state.page==='today')render({state,chart,noChart});});return;}
 const rows=data?.financing?.rows||[],byDate=new Map(rows.map(x=>[x.date,x]));
 const exact=byDate.get(state.selected);
 const latest=rows.filter(x=>x.date<=state.selected).at(-1);
 $('fund-status').textContent=!data?'资金源尚无可用归档；未采集不等于资金不变。':
  '融资数据截至 '+(latest?.date||'暂缺')+' · '+(exact?'所选日已披露':'所选日尚未披露，余额仅显示最近已知值')+' · 融资并不等于散户资金，通常T+1发布。';
 const host=$('fund-summary');host.replaceChildren();
 const prev=rows.filter(x=>x.date<(latest?.date||'')).at(-1);
 const a=latest?.financing_balance_100m,b=prev?.financing_balance_100m;
 const delta=a!=null&&b!=null?a-b:null;
 // Use the market's archived trading calendar, not merely the last ten available financing quotes.
 // A missing margin disclosure must not silently shrink the window or count as zero.
 const lastTen=(state.archive||[]).filter(day=>day<=state.selected).slice(-10);
 const period=lastTen.map(day=>byDate.get(day));
 const hasTen=lastTen.length===10;
 const valid=x=>typeof x==='number'&&Number.isFinite(x);
 const flowComplete=hasTen&&period.every(x=>x&&valid(x.financing_net_buy_100m));
 const balanceComplete=hasTen&&period.every(x=>x&&valid(x.financing_balance_100m));
 const tenNet=flowComplete?period.reduce((sum,x)=>sum+Number(x.financing_net_buy_100m),0):null;
 const tenNegative=flowComplete?period.filter(x=>Number(x.financing_net_buy_100m)<0).length:null;
 const tenBalance=balanceComplete?Number(period[9].financing_balance_100m)-Number(period[0].financing_balance_100m):null;
 const periodLabel=hasTen?lastTen[0]+' 至 '+lastTen[9]:'不足10个交易日';
 card(host,'融资余额',a!=null?fmt(a)+'亿':'—',
      latest?'归档 '+latest.date+(delta!=null?' · 较前记录 '+signed(delta)+'亿':''):'暂缺');
 card(host,'当日融资净买入',exact?.financing_net_buy_100m!=null?signed(exact.financing_net_buy_100m)+'亿':'—',
      exact?.financing_net_buy_100m!=null?'融资买入额－偿还额；不是余额日变动':'所选日尚无完整买入及偿还数据');
 card(host,'近10日净买入累计',tenNet!=null?signed(tenNet)+'亿':'—',
      tenNet!=null?periodLabel+' · 其中'+tenNegative+'日为负':'近10个交易日融资数据不完整');
 card(host,'10日区间首末余额差',tenBalance!=null?signed(tenBalance)+'亿':'—',
      tenBalance!=null?periodLabel+' · 首末两日余额之差':'近10个交易日余额数据不完整');
 const days=state.days||[],metric=$('fund-chart-metric').value;
 const values=days.map((day,i)=>{
  const r=byDate.get(day);if(!r)return null;
  if(metric==='balance')return r.financing_balance_100m??null;
  if(metric==='net')return r.financing_net_buy_100m??null;
  const p=i?byDate.get(days[i-1]):null;
  return r.financing_balance_100m!=null&&p?.financing_balance_100m!=null?
    Number((r.financing_balance_100m-p.financing_balance_100m).toFixed(3)):null;
 });
 if(values.some(v=>v!==null))chart('fund-chart',{xAxis:{type:'category',data:days.map(d=>d.slice(5))},
  yAxis:{type:'value',scale:true,name:'亿元'},
  series:[{type:metric==='balance'?'line':'bar',name:metric==='balance'?'融资余额':metric==='net'?'融资净买入':'融资余额日变动',
           showSymbol:true,symbolSize:5,data:values}]});
 else noChart('fund-chart','所选区间缺少真实融资数据；不补零。');
 const table=$('fund-history-body');table.replaceChildren();
 for(let i=days.length-1;i>=0;i--){
  const day=days[i],r=byDate.get(day),p=i?byDate.get(days[i-1]):null, tr=node('tr');
  const diff=r?.financing_balance_100m!=null&&p?.financing_balance_100m!=null?
    r.financing_balance_100m-p.financing_balance_100m:null;
  for(const v of [day,fmt(r?.financing_balance_100m),signed(diff),
                  signed(r?.financing_net_buy_100m),fmt(r?.financing_buy_100m),fmt(r?.financing_repay_100m),fmt(r?.short_balance_100m)])
    tr.append(node('td',v));
  table.append(tr);
 }


}
function renderHoldings({state}){
 if(!data&&!error){load().then(()=>{if(state.page==='today')renderHoldings({state});});return;}
 const holder=$('fund-holders');holder.replaceChildren();
 // Public dated top-holder filings may predate our collection; never imply today's holdings.
 const observed=(data?.disclosures||[]).filter(x=>
   (x.holders_top||[]).some(h=>h.publish_date&&h.publish_date<=state.selected&&h.report_date) ||
   (x.observed_at<=state.selected&&(x.holder_structure||[]).length));
 if(!observed.length){
  holder.append(node('p','所选日尚无已知的持有人披露证据；不能从ETF成交额推断国家队交易。','inline-note'));
 }else for(const fund of observed){
  const box=node('details','','fund-holder-item');
  box.append(node('summary',fund.name+' · '+fund.code));
  const body=node('div','','fund-holder-content');
  const available=(fund.holders_top||[]).filter(h=>h.publish_date&&h.publish_date<=state.selected&&h.report_date);
  const reportDate=available.map(h=>h.report_date).sort().at(-1);
  const named=available.filter(h=>h.report_date===reportDate);
  const published=named.map(h=>h.publish_date).sort().at(-1);
  body.append(node('p','前十大持有人：报告期 '+(reportDate||'未提供')+
     ' · 公布日 '+(published||'未提供')+
     ' · 采集 '+fund.observed_at+'；仅为历史持仓，不是所选日持仓。','inline-note'));
  if(!named.length)body.append(node('p','当时尚无可确认公布日期的前十大持有人记录。','inline-note'));
  for(const h of named){
    const line=node('div','','fund-holder-row');
    line.append(node('span',h.holder),node('b',h.hold_rate_pct!=null?fmt(h.hold_rate_pct)+'%':'—'));
    if(h.explicit_public_institution_name)line.classList.add('fund-explicit');
    body.append(line);
  }
  // Holder structure has a report date but no verified public publication date.
  // Do not project that later-collected structure backward into a historical replay.
  if(fund.observed_at<=state.selected)for(const r of (fund.holder_structure||[])){
   if(r.institution_pct!=null&&r.report_date&&r.report_date<=state.selected)
     body.append(node('p','机构持有人占比 '+fmt(r.institution_pct)+'% · 报告期 '+r.report_date+' · 非实时交易','inline-note'));
  }
  box.append(body);holder.append(box);
 }
}
window.MarketScopeFunds={render,renderHoldings,load};
})();
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
  '融资数据截至 '+(latest?.date||'暂缺')+' · '+(exact?'所选日已披露':'所选日暂未披露，显示最近已知值')+' · 融资并不等于散户资金，通常T+1发布。';
 const host=$('fund-summary');host.replaceChildren();
 const prev=rows.filter(x=>x.date<(latest?.date||'')).at(-1);
 const a=latest?.financing_balance_100m,b=prev?.financing_balance_100m;
 const delta=a!=null&&b!=null?a-b:null;
 const sample=rows.filter(x=>x.date<=state.selected).slice(-10);
 const ten=sample.length===10?sample[9].financing_balance_100m-sample[0].financing_balance_100m:null;
 card(host,'融资余额',a!=null?fmt(a)+'亿':'—',latest?'归档日期 '+latest.date:'暂缺');
 card(host,'较前一记录变化',delta!=null?signed(delta)+'亿':'—',prev?'余额差额，并非融资净买入额':'前一记录不足');
 card(host,'最近10次记录变化',ten!=null?signed(ten)+'亿':'—',ten!=null?sample[0].date+' 至 '+sample[9].date:'样本未满10日');
 card(host,'融资买入额',exact?.financing_buy_100m!=null?fmt(exact.financing_buy_100m)+'亿':'—',
      exact?.financing_buy_100m!=null?state.selected:'源未提供时留空，不拿余额变化冒充');
 const days=state.days||[],metric=$('fund-chart-metric').value;
 const values=days.map((day,i)=>{
  const r=byDate.get(day);if(!r)return null;
  if(metric==='balance')return r.financing_balance_100m??null;
  const p=i?byDate.get(days[i-1]):null;
  return r.financing_balance_100m!=null&&p?.financing_balance_100m!=null?
    Number((r.financing_balance_100m-p.financing_balance_100m).toFixed(3)):null;
 });
 if(values.some(v=>v!==null))chart('fund-chart',{xAxis:{type:'category',data:days.map(d=>d.slice(5))},
  yAxis:{type:'value',scale:true,name:'亿元'},
  series:[{type:metric==='balance'?'line':'bar',name:metric==='balance'?'融资余额':'融资余额日变动',
           showSymbol:true,symbolSize:5,data:values}]});
 else noChart('fund-chart','所选区间缺少真实融资数据；不补零。');
 const table=$('fund-history-body');table.replaceChildren();
 for(let i=days.length-1;i>=0;i--){
  const day=days[i],r=byDate.get(day),p=i?byDate.get(days[i-1]):null, tr=node('tr');
  const diff=r?.financing_balance_100m!=null&&p?.financing_balance_100m!=null?
    r.financing_balance_100m-p.financing_balance_100m:null;
  for(const v of [day,fmt(r?.financing_balance_100m),signed(diff),
                  fmt(r?.short_balance_100m),fmt(r?.financing_buy_100m)])
    tr.append(node('td',v));
  table.append(tr);
 }
 const holder=$('fund-holders');holder.replaceChildren();
 const observed=(data?.disclosures||[]).filter(x=>x.observed_at<=state.selected);
 if(!observed.length){
  holder.append(node('p','所选日暂无可验证的ETF持有人披露记录；不能由成交额推断国家队交易。','inline-note'));
 }else for(const fund of observed){
  const box=node('details','','fund-holder-item');
  box.append(node('summary',fund.name+' · '+fund.code));
  const body=node('div','','fund-holder-content');
  const named=(fund.holders_top||[]).filter(h=>h.publish_date&&h.publish_date<=state.selected);
  body.append(node('p','定期披露 · 查询快照 '+fund.observed_at+' · 不是当日持仓与资金流','inline-note'));
  if(!named.length)body.append(node('p','持有人公布日缺失，无法验证本交易日是否已知。','inline-note'));
  for(const h of named){
    const line=node('div','','fund-holder-row');
    line.append(node('span',h.holder),node('b',h.hold_rate_pct!=null?fmt(h.hold_rate_pct)+'%':'—'));
    if(h.explicit_public_institution_name)line.classList.add('fund-explicit');
    body.append(line);
  }
  for(const s of (fund.holder_structure||[])){
   if(s.institution_pct!=null)body.append(node('p','机构持有人占比 '+fmt(s.institution_pct)+'% · 报告期 '+(s.report_date||'未知')+' · 不代表实时资金流','inline-note'));
  }
  box.append(body);holder.append(box);
 }
}
window.MarketScopeFunds={render,load};
})();
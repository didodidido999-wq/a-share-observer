/* National-fund-associated ETF watch: share evidence != identified investor flow. */
(() => {'use strict';
const $=id=>document.getElementById(id);
const text=(tag,value,cls)=>{const n=document.createElement(tag);n.textContent=String(value??'');if(cls)n.className=cls;return n;};
const fmt=(v,d=2)=>typeof v==='number'&&Number.isFinite(v)?
 v.toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const signed=(v,d=2)=>typeof v!=='number'||!Number.isFinite(v)?'—':(v>0?'+':'')+fmt(v,d);
const bench={'510300.SH':'000300.SH','510310.SH':'000300.SH','510330.SH':'000300.SH',
 '159919.SZ':'000300.SH','510050.SH':'000016.SH','510500.SH':'000905.SH',
 '588000.SH':'000688.SH','159915.SZ':'399006.SZ'};
let data=null,filings=null,promise=null,focus='verified',mounted=false;
function load(){
 if(promise)return promise;
 promise=Promise.all([
  fetch('data/etf-shares.json',{cache:'no-store'}).then(r=>r.ok?r.json():{watch:{},rows:[]}),
  fetch('data/funds-observer.json',{cache:'no-store'}).then(r=>r.ok?r.json():{disclosures:[]})
 ]).then(([a,b])=>{data=a;filings=b;}).catch(e=>{
  console.warn('ETF share evidence missing',e);data={watch:{},rows:[]};filings={disclosures:[]};
 });
 return promise;
}
function holding(code,asof){
 const source=(filings?.disclosures||[]).find(x=>x.code===code);
 const named=(source?.holders_top||[]).filter(x=>x.holder?.includes('中央汇金') &&
   x.publish_date&&x.publish_date<=asof&&x.report_date&&
   typeof x.hold_rate_pct==='number'&&Number.isFinite(x.hold_rate_pct));
 if(!named.length)return null;
 const last=[...named].sort((a,b)=>a.report_date.localeCompare(b.report_date)).at(-1).report_date;
 const entries=named.filter(x=>x.report_date===last);
 return {ratio:entries.reduce((n,x)=>n+x.hold_rate_pct,0),
   date:last,published:entries.map(x=>x.publish_date).sort().at(-1)};
}
function indexChange(state,day,code){
 const days=state.archive||[],i=days.indexOf(day);
 if(i<1)return null;
 const a=(state.snapshots.get(day)?.indices||[]).find(x=>x.code===bench[code])?.pct;
 // Index day-return field uses the historically archived percentage change.
 return typeof a==='number'&&Number.isFinite(a)?a:null;
}
function render({state,chart,noChart}){
 if(!$('state-etf-table'))return;
 if(data===null){
  $('state-etf-status').textContent='正在加载交易所ETF份额与机构持有人披露…';
  load().then(()=>{if(state.page==='today')render({state,chart,noChart});});return;
 }
 const asof=state.selected;
 const dates=(state.archive||[]).filter(x=>x<=asof);
 const windowDays=dates.slice(-10);
 const byDay=new Map((data.rows||[]).map(x=>[x.date,x.funds||{}]));
 const all=Object.keys(data.watch||{});
 const latestDates=(data.rows||[]).filter(x=>x.date<=asof);
 const known=latestDates.at(-1)?.date||null;
 $('state-etf-status').textContent=known?
   'ETF官方份额最新归档 '+known+' · 所选日 '+asof+
   (known===asof?' 已有份额记录。':' 尚无当日完整份额，不能将上一日申赎当作今日资金。')+
   ' · T+1检查，上交所盘后/深交所统计日均以原始表日期为准。':
   'ETF份额采集尚未取得有效官方归档。保留缺失，不显示估算资金或推测买卖。';
 const reports=new Map(all.map(code=>[code,holding(code,asof)]));
 const selectedCodes=all.filter(code=>reports.get(code));
 const brief=$('state-etf-brief');brief.replaceChildren();
 const dated=byDay.get(asof)||{},previous=byDay.get(dates.at(-2))||{};
 const seen=all.filter(code=>typeof dated[code]?.shares==='number' &&
                          typeof previous[code]?.shares==='number');
 const expanding=seen.filter(code=>dated[code].shares>previous[code].shares);
 const summary=[
  ['历史披露汇金持有',selectedCodes.length+'只ETF','按前十大持有人真实姓名核实，不代表当前仍持有'],
  ['当日扩份额',seen.length?expanding.length+'/'+seen.length:'—',
   seen.length?'仅对当日及前一交易日均有份额的样本统计':'所选日份额或前一交易日份额未齐'],
  ['最新份额统计日',known||'—','ETF份额来自交易所；不是资金买卖身份']
 ];
 for(const [label,val,desc] of summary){
  const c=text('div','','state-summary-card');
  c.append(text('small',label),text('strong',val),text('span',desc));
  brief.append(c);
 }
 const selector=$('state-etf-focus'),prior=selector.value||focus;
 selector.replaceChildren();
 const options=[['verified','已披露汇金持有ETF'],['all','全部观察ETF'],
   ...all.map(code=>[code,(data.watch[code]||code)+' · '+code])];
 for(const [v,n] of options){const opt=text('option',n);opt.value=v;selector.append(opt);}
 focus=options.some(([v])=>v===prior)?prior:'verified';selector.value=focus;
 if(!mounted){
  selector.addEventListener('change',()=>{focus=selector.value;render({state,chart,noChart});});
  mounted=true;
 }
 const body=$('state-etf-table');body.replaceChildren();
 const sorted=[...all].sort((a,b)=>(reports.get(b)?.ratio||0)-(reports.get(a)?.ratio||0));
 for(const code of sorted){
  const shares=dated[code]?.shares,old=previous[code]?.shares;
  const change=typeof shares==='number'&&typeof old==='number'?(shares-old)/1e8:null;
  const first=byDay.get(windowDays[0])?.[code]?.shares;
  const last=byDay.get(windowDays.at(-1))?.[code]?.shares;
  const complete=windowDays.length===10&&windowDays.every(d=>typeof byDay.get(d)?.[code]?.shares==='number');
  const ten=complete&&first>0?(last/first-1)*100:null;
  const idx=indexChange(state,asof,code);
  const signal=change!=null&&change>0&&idx!=null&&idx<0?'指数下跌、ETF扩份额':
    change!=null&&change>0?'份额增加':change!=null&&change<0?'份额减少':
    change===0?'份额不变':'份额数据不足';
  const h=reports.get(code),tr=document.createElement('tr');
  tr.className='clickable'+(focus===code?' selected':'');
  tr.title='点击只观察此ETF的10日相对份额趋势';
  const cells=[
   data.watch[code]+' · '+code,
   h?'曾披露汇金系 '+fmt(h.ratio)+'% · 报告期'+h.date+' · 公布'+h.published:'无已核实的汇金姓名记录',
   shares!=null?fmt(shares/1e8)+'亿份':'—',
   change==null?'—':signed(change)+'亿份',
   ten==null?'—':signed(ten)+'%',
   signal
  ];
  for(const [i,v] of cells.entries())tr.append(text('td',v,i===1?'state-evidence':''));
  tr.addEventListener('click',()=>{focus=code;selector.value=code;render({state,chart,noChart});});
  body.append(tr);
 }
 const codes=focus==='all'?all:focus==='verified'?selectedCodes:all.includes(focus)?[focus]:[];
 const lines=codes.map(code=>{
  const base=byDay.get(windowDays[0])?.[code]?.shares;
  const vals=windowDays.map(day=>{
   const v=byDay.get(day)?.[code]?.shares;
   return base>0&&typeof v==='number'?Number((v/base*100).toFixed(3)):null;
  });
  return {name:code+' '+data.watch[code],code,data:vals,type:'line',
    showSymbol:true,symbolSize:4,connectNulls:false};
 }).filter(line=>line.data.filter(x=>x!==null).length>=2);
 if(lines.length){
  chart('state-etf-chart',{xAxis:{type:'category',data:windowDays.map(x=>x.slice(5))},
   yAxis:{type:'value',scale:true,name:'首日=100'},
   series:lines.map(({code,...s})=>s)},e=>{
     const found=lines.find(x=>x.name===e.seriesName);
     if(found){focus=found.code;selector.value=found.code;render({state,chart,noChart});}
   });
 }else noChart('state-etf-chart','当前区间缺少连续可比较的ETF真实份额。');
}
window.MarketScopeEtfShares={load,render};
})();

/* MarketScope: presentation-only. Browser never contacts the upstream provider. */
(() => {
'use strict';
let data={dates:[],indices:[],market:[],sectors:[],styles:[],limits:[],stock_list:[]};
let page='overview', pickedSector=null, archiveDates=[], sectorPage=0, latestData=null;
const SECTOR_PAGE_SIZE=60;
const labels={overview:['市场总览','同一时间轴观察价格、量能、市场广度与短线情绪。'],sectors:['板块轮动','全部行业与概念指数，统一所选交易日区间的横向对比。'],styles:['炒作风格','固定风格分档，观察上涨占比、涨幅中位数与涨停分布。'],stocks:['个股明细','每个交易日的涨停事实与连板梯队。']};
const $=id=>document.getElementById(id);
const fmt=(x,d=2)=>x===null||x===undefined||!Number.isFinite(Number(x))?'—':Number(x).toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d});
const ns=x=>x===null||x===undefined||Number.isNaN(Number(x))?null:Number(x);
const pct=x=>x===null||x===undefined?'—':`${Number(x)>0?'+':''}${fmt(x,2)}%`;
const col=x=>x===null||x===undefined?'':x>0?'positive':x<0?'negative':'';
const empty=arr=>!Array.isArray(arr)||!arr.length;
function text(tag,content,cls){const el=document.createElement(tag);if(cls)el.className=cls;el.textContent=content;return el;}
function setNotice(message,success=false){let el=$('notice');el.textContent=message;el.className='notice'+(success?' ok':'');}
const charts=new Map();
function chart(id,option){const el=$(id);if(!el)return; if(typeof echarts==='undefined'){el.textContent='图表组件未加载，请检查网络连接。';return;}
 let chart=charts.get(id);if(!chart){chart=echarts.init(el,null,{renderer:'canvas'});charts.set(id,chart);}
 const bg={axisLine:{lineStyle:{color:'#dae3e8'}},axisLabel:{color:'#8393a1',fontSize:10},splitLine:{lineStyle:{color:'#edf2f4',type:'dashed'}},axisTick:{show:false}};
 chart.setOption({animationDuration:430,color:['#c24c54','#2a8a83','#4a80ae','#b58d5b','#8476ab','#7ba8a6'],textStyle:{fontFamily:'DM Sans, Microsoft YaHei, sans-serif'},
 tooltip:{trigger:'axis',confine:true,backgroundColor:'#14283d',borderWidth:0,textStyle:{color:'#edf5f7',fontSize:11},axisPointer:{type:'line'}},
 legend:{top:1,right:0,type:'scroll',textStyle:{color:'#7e8c99',fontSize:10},icon:'circle',itemWidth:7,itemHeight:7},
 grid:{left:40,right:20,top:43,bottom:32,containLabel:true},
 xAxis:{type:'category',boundaryGap:false,...bg},yAxis:{type:'value',...bg},...option},true);
}
function noplot(id,reason){const el=$(id);if(!el)return;charts.get(id)?.dispose();charts.delete(id);el.innerHTML='';let wrap=text('div',reason||'暂无可核验数据','');wrap.style.cssText='display:flex;align-items:center;justify-content:center;height:100%;color:#9aaab5;font-size:12px;text-align:center;padding:26px';el.append(wrap);}
function valByDate(rows,d){return (rows||[]).find(x=>x.date===d)||{};}
function last(arr){return arr?.length?arr[arr.length-1]:undefined;}
function kpi(name,value,subtitle,klass){let el=document.createElement('div');el.className='kpi';el.append(text('small',name));el.append(text('strong',value,klass||''));el.append(text('div',subtitle||'当前区间','delta'));return el;}
function renderOverview(){let market=data.market||[],lim=data.limits||[], dates=data.dates||[];
 let latest=valByDate(market,last(dates)), prev=valByDate(market,dates.at(-2)), lastLimits=valByDate(lim,last(dates));
 let grid=$('market-kpis');grid.replaceChildren(
  kpi('市场成交额',latest.turnover_100m==null?'—':fmt(latest.turnover_100m,0)+' 亿',
    latest.turnover_100m!=null&&prev.turnover_100m?`较前日 ${pct((latest.turnover_100m/prev.turnover_100m-1)*100)}`:'亿元 · 最新交易日'),
  kpi('上涨 / 下跌家数',latest.up==null?'—':`${latest.up} / ${latest.down}`,`有效样本 ${latest.return_samples??'—'} 只`),
  kpi('非ST涨停',lastLimits.non_st??'—',lastLimits.first==null?'涨停池等待接入':`首板 ${lastLimits.first} · 连板 ${lastLimits.continued}`),
  kpi('市场涨跌幅中位数',pct(latest.median),`全市场日线涨幅中位数`,col(latest.median)));
 if(!empty(data.indices)){
  let series=data.indices.filter(x=>x.points?.some(v=>v.close!=null)).slice(0,9).map(x=>{
    let first=x.points?.find(v=>v.close>0)?.close;
    return {name:x.name,type:'line',showSymbol:false,smooth:.18,lineStyle:{width:2},data:dates.map(d=>{
      let p=valByDate(x.points,d);return p.close==null||!first?null:+(p.close/first*100).toFixed(2);})};
  });
  if(series.length)chart('index-line',{xAxis:{type:'category',data:dates.map(d=>d.slice(5)),boundaryGap:false},yAxis:{type:'value',scale:true},series});else noplot('index-line');
 }else noplot('index-line','指数行情等待接入，未展示模拟走势。');
 if(market.length)chart('turnover-chart',{xAxis:{type:'category',boundaryGap:true,data:dates.map(d=>d.slice(5))},series:[{name:'成交额（亿元）',type:'bar',barWidth:'46%',itemStyle:{color:'#407d9e',borderRadius:[4,4,0,0]},data:dates.map(d=>ns(valByDate(market,d).turnover_100m))}]});else noplot('turnover-chart');
 if(market.length)chart('breadth-chart',{xAxis:{type:'category',data:dates.map(d=>d.slice(5)),boundaryGap:true},series:[{name:'上涨',type:'bar',stack:'all',data:dates.map(d=>ns(valByDate(market,d).up)),itemStyle:{color:'#ca5b62'}},{name:'下跌',type:'bar',stack:'all',data:dates.map(d=>ns(valByDate(market,d).down)),itemStyle:{color:'#379c82'}}]});else noplot('breadth-chart');
 if(lim.length)chart('limits-chart',{xAxis:{type:'category',data:dates.map(d=>d.slice(5)),boundaryGap:true},series:[{name:'首板',type:'bar',stack:'u',data:dates.map(d=>ns(valByDate(lim,d).first)),itemStyle:{color:'#c85259'}},{name:'连板',type:'bar',stack:'u',data:dates.map(d=>ns(valByDate(lim,d).continued)),itemStyle:{color:'#b98e5f'}}]});else noplot('limits-chart');
 let tbody=$('market-table').querySelector('tbody');tbody.replaceChildren();if(!dates.length)tbody.append(rowEmpty(8));
 dates.slice().reverse().forEach(d=>{let m=valByDate(market,d),l=valByDate(lim,d);let tr=document.createElement('tr');
 [d,m.up??'—',m.down??'—',fmt(m.turnover_100m,0),l.non_st??'—',l.first??'—',l.continued??'—',l.highest??'—'].forEach(x=>tr.append(text('td',String(x))));tbody.append(tr);});
}
function rowEmpty(n){let tr=text('tr','','empty-row'),td=text('td','暂无真实行情记录');td.colSpan=n;tr.append(td);return tr;}
function heatBg(v,metric){if(v==null)return null;let val=Number(v);if(!Number.isFinite(val))return null;
 if(['limit_up','limit_up_proxy','sample'].includes(metric)){let a=Math.min(Math.abs(val)/18,.92);return `rgba(192,79,83,${.10+a*.65})`;}
 let a=Math.min(Math.abs(val)/5,.87);return val>=0?`rgba(204,76,79,${.13+a*.65})`:`rgba(32,154,117,${.13+a*.68})`;
}
function makeHeat(target,rows,dates,metric,format,onSelect){let host=$(target);host.replaceChildren();if(!rows.length||!dates.length){let emptyDiv=text('div','暂未取得可用于10日对比的同口径数据');emptyDiv.style.cssText='padding:64px 12px;text-align:center;color:#a1afb9';host.append(emptyDiv);return;}
 let grid=document.createElement('div');grid.className='heat-grid';grid.style.gridTemplateColumns=`180px repeat(${dates.length},minmax(66px,72px))`;grid.append(text('div','板块 / 风格','heat-head'));
 dates.forEach(d=>grid.append(text('div',d.slice(5),'heat-head')));
 rows.forEach((r,i)=>{let label=text('div',r.name||r.group,'heat-label'+((r.code||r.group)===pickedSector?' selected':''));label.title=r.name||r.group;
 let rank=text('em',String(i+1).padStart(2,'0'));label.append(rank);
 if(onSelect){label.addEventListener('click',()=>{pickedSector=r.code||r.group;onSelect(r);[...grid.querySelectorAll('.heat-label')].forEach(x=>x.classList.toggle('selected',x===label));});}
 grid.append(label);
 dates.forEach(d=>{let v;
   if(r.points){v=valByDate(r.points,d)[metric];}else{v=r.byDate[d]?.[metric];}
   const vv=ns(v),cell=text('div',vv==null?'—':format(vv),'heat-cell'+(vv==null?' empty':''));
   let bg=heatBg(vv,metric);if(bg)cell.style.background=bg;
   if(vv!=null&&Math.abs(vv)>(metric==='pct'?3.7:metric==='median_pct'?3.7:metric==='up_ratio'?85:70))cell.style.color='#fff';
   cell.title=`${r.name||r.group} | ${d} | ${vv==null?'无数据':format(vv)}`;
   grid.append(cell);
 });});host.append(grid);
}
function renderSectors(){let dates=data.dates||[],kind=$('sector-kind').value,q=$('sector-search').value.trim().toLowerCase(),sort=$('sector-sort').value,metric=$('sector-metric').value;
 let original=(data.sectors||[]).filter(s=>s.tag===kind);
 let arr=original.filter(s=>s.name.toLowerCase().includes(q)||s.code.toLowerCase().includes(q));
 function cumulative(s){let x=dates.map(d=>valByDate(s.points,d).pct);if(x.some(v=>v==null))return null;return (x.reduce((a,v)=>a*(1+v/100),1)-1)*100;}
 arr.sort((a,b)=>{if(sort==='name')return a.name.localeCompare(b.name,'zh');let av=sort==='latest'?ns(valByDate(a.points,last(dates))[metric]):cumulative(a),bv=sort==='latest'?ns(valByDate(b.points,last(dates))[metric]):cumulative(b);return (bv??-99999)-(av??-99999);});
 $('sector-coverage').replaceChildren(text('span',`${kind==='industry'?'行业':'概念'}板块 ${original.length} · 当前筛选 ${arr.length} · ${metric==='pct'?'日涨跌幅(%)':'按最新行业成分股计算涨停数，历史成分未回溯'}`),text('b',dates.length?dates[0]+' — '+last(dates):'尚无日期'));
 const pages=Math.max(1,Math.ceil(arr.length/SECTOR_PAGE_SIZE));sectorPage=Math.min(Math.max(sectorPage,0),pages-1);
 $('sector-page-info').textContent=`第 ${sectorPage+1} / ${pages} 页 · 每页最多60板块`;
 $('sector-page-prev').disabled=sectorPage===0;
 $('sector-page-next').disabled=sectorPage>=pages-1;
 makeHeat('sector-heat',arr.slice(sectorPage*SECTOR_PAGE_SIZE,(sectorPage+1)*SECTOR_PAGE_SIZE),dates,metric,v=>metric==='pct'?(v>0?'+':'')+fmt(v,2):fmt(v,0),s=>{pickedSector=s.code;sectorCharts(s);});
 let selection=arr.find(s=>s.code===pickedSector)||arr[0];if(selection){pickedSector=selection.code;sectorCharts(selection);}else{noplot('sector-detail');noplot('sector-volume');}
}
function sectorCharts(s){let dates=data.dates||[];if(!s?.points?.length){noplot('sector-detail');noplot('sector-volume');return;}
 const pts=dates.map(d=>valByDate(s.points,d));
 chart('sector-detail',{legend:{show:false},xAxis:{type:'category',data:dates.map(d=>d.slice(5))},series:[{name:s.name+' 日涨跌幅 %',type:'line',data:pts.map(x=>ns(x.pct)),smooth:.15,symbolSize:6,lineStyle:{width:2.5},areaStyle:{opacity:.06}}]});
 chart('sector-volume',{legend:{show:false},xAxis:{type:'category',boundaryGap:true,data:dates.map(d=>d.slice(5))},series:[{name:s.name+' 成交额（亿元）',type:'bar',barWidth:'45%',itemStyle:{color:'#4b879e'},data:pts.map(x=>x.turnover==null?null:+(x.turnover/1e8).toFixed(2))}]});
}
function renderStyles(){const dim=$('style-dim').value,metric=$('style-metric').value,dates=data.dates||[];
 let vals=(data.styles||[]).filter(x=>x.dimension===dim);
 let names=[...new Set(vals.map(x=>x.group))];
 let rows=names.map(name=>({group:name,byDate:Object.fromEntries(vals.filter(v=>v.group===name).map(v=>[v.date,v]))}));
 $('style-coverage').replaceChildren(text('span',`分类：${dim} · 指标：${$('style-metric').selectedOptions[0].textContent}`),text('b',`${dates.length}日 · ${rows.length}组`));
 makeHeat('style-heat',rows,dates,metric,x=>['median_pct','up_ratio'].includes(metric)?fmt(x,2)+'%':fmt(x,0));
 const regimes=['10cm主板','20cm创业/科创','30cm北交所'];
 let ser=regimes.map((r,i)=>({name:r,type:'bar',stack:'sum',data:dates.map(d=>vals.find(x=>x.group===r&&x.date===d)?.limit_up??null)}));
 if(empty(data.styles))noplot('style-limits');else{
  let all=data.styles.filter(x=>x.dimension==='交易制度代理');
  ser=regimes.map((r,i)=>({name:r,type:'bar',stack:'sum',data:dates.map(d=>all.find(x=>x.group===r&&x.date===d)?.limit_up??null)}));
  chart('style-limits',{xAxis:{type:'category',boundaryGap:true,data:dates.map(d=>d.slice(5))},series:ser});
 }
 let extras=[['流通市值分档','未接入 · 当前日K不含流通市值'],['上市年限','未接入 · 未建立完整IPO历史标签'],['经济风格','由行业/概念指数面板独立观察'],['全市场涨幅','来自最近10日未复权日K'],['涨跌幅制度','依据交易板块的制度代理，特殊情形可能偏差']];
 let host=$('style-extra');host.replaceChildren();extras.forEach(([a,b])=>{let x=document.createElement('div');x.className='coverage-line';x.append(text('b',a),text('span',b));host.append(x);});
}
function renderStocks(){let dates=(data.dates||[]).slice().reverse(), sel=$('stocks-date'),current=sel.value;sel.replaceChildren();dates.forEach(d=>{let op=document.createElement('option');op.value=d;op.textContent=d;sel.append(op);});
 if(dates.includes(current))sel.value=current;
 const d=sel.value, list=(data.stock_list||[]).filter(x=>x.date===d), pool=valByDate(data.limits,d),q=$('stocks-query').value.trim().toLowerCase();
 const filtered=list.filter(s=>(s.thscode+' '+s.name+' '+s.reason).toLowerCase().includes(q));
 $('stocks-kpis').replaceChildren(kpi('涨停数量',pool.total==null?'—':String(pool.total),'当日已归档涨停池'),kpi('非ST首板',pool.first??'—','独立股票计数'),kpi('最高连板',pool.highest??'—','若非交易日应留空'));
 $('stock-count').textContent=`筛选 ${filtered.length} 只 / ${list.length} 只`;
 let body=$('stocks-table').querySelector('tbody');body.replaceChildren();if(!filtered.length)body.append(rowEmpty(6));
 filtered.sort((a,b)=>b.boards-a.boards||a.thscode.localeCompare(b.thscode)).forEach(x=>{let tr=document.createElement('tr');[x.thscode,x.name,x.boards+'板',fmt(x.price,2),x.is_st?'ST':'—',x.reason].forEach(y=>{let cell=text('td',String(y));if(cell.textContent.length>70){cell.title=cell.textContent;cell.textContent=cell.textContent.slice(0,70)+'…';}tr.append(cell);});body.append(tr);});
}
function renderAll(){let dates=data.dates||[]; $('window-label').textContent=dates.length?`${dates[0].slice(5)} — ${last(dates).slice(5)}`:'最近10个交易日';
 $('latest-date').textContent=data.latest_date?`最新收盘：${data.latest_date}`:'收盘日期尚未接入';
 $('build-stamp').textContent=data.generated_at?'生成于 '+data.generated_at.slice(0,16).replace('T',' '):'未更新';
 let ok=data.status==='live',warning=data.status==='partial';$('data-state').textContent=ok?'真实数据 · 已同步':warning?'真实数据 · 部分缺失':'尚未接入真实数据';
 document.querySelector('.live-dot').classList.toggle('live',ok);let messages=(data.warnings||[]);
 if(ok)setNotice('已连接同花顺真实数据；所选日期区间内的缺失字段保留空值。',true);
 else if(warning)setNotice('数据已部分接入，但有接口未返回完整数据：'+messages.slice(0,3).join('；'));
 else setNotice('网站结构已经完成，尚未配置运行同花顺API密钥。当前没有展示任何虚构行情。请按照README开启GitHub Actions。');
 renderOverview(); renderSectors();renderStyles();renderStocks();
}
function setPage(id){page=id;document.querySelectorAll('.page').forEach(el=>el.classList.toggle('active',el.id===id));document.querySelectorAll('#nav button').forEach(el=>el.classList.toggle('active',el.dataset.page===id));$('crumb').textContent=labels[id][0];$('page-title').textContent=labels[id][0];$('page-sub').textContent=labels[id][1];$('sidebar').classList.remove('open');
 window.requestAnimationFrame(()=>{charts.forEach(c=>c.resize());if(id==='sectors')renderSectors();if(id==='styles')renderStyles();});
}
function buildRange(days,snapshots){
 const index=new Map(), sectors=new Map(), market=[], limits=[], styles=[], stock_list=[], warnings=[];
 for(let i=0;i<snapshots.length;i++){
  const s=snapshots[i];if(!s){warnings.push(`历史归档 ${days[i]} 未能加载`);continue;}
  if(s.market)market.push(s.market);else warnings.push(`${days[i]} 全市场统计缺失`);
  if(s.limits)limits.push(s.limits);else warnings.push(`${days[i]} 涨停池缺失`);
  if(!s.sectors?.length)warnings.push(`${days[i]} 板块指数历史缺失`);
  for(const row of s.styles||[])styles.push(row);
  for(const row of s.stock_list||[])stock_list.push(row);
  for(const x of s.indices||[]){if(!x.code)continue;
   const o=index.get(x.code)||{name:x.name,code:x.code,points:[]};
   o.points.push({date:days[i],close:x.close??null,pct:x.pct??null,turnover:x.turnover??null});index.set(x.code,o);}
  for(const x of s.sectors||[]){if(!x.code)continue;
   const o=sectors.get(x.code)||{name:x.name,code:x.code,tag:x.tag,points:[]};
   o.points.push({date:days[i],close:x.close??null,pct:x.pct??null,turnover:x.turnover??null,limit_up_proxy:x.limit_up_proxy??null});sectors.set(x.code,o);}
 }
 if(warnings.length)warnings.unshift('选定区间存在缺失档案，未填补假数据');
 return {...(latestData||{}),dates:days,latest_date:days.at(-1),indices:[...index.values()],sectors:[...sectors.values()],
  market,limits,styles,stock_list,status:warnings.length?'partial':'live',warnings,
  generated_at:latestData?.generated_at};
}
async function selectRange(start,end){
 if(!archiveDates.length)return;
 if(start>end){setNotice('起始日期不能晚于结束日期');return;}
 const days=archiveDates.filter(d=>d>=start&&d<=end);
 if(!days.length){setNotice('选定区间没有已保存的A股交易日');return;}
 const action=$('range-apply');action.disabled=true;
 try{
  if(latestData&&days.length===latestData.dates.length&&days.every((d,i)=>d===latestData.dates[i])){
   data=latestData;
  }else{
   const results=new Array(days.length);
   let cursor=0,finished=0;
   const workers=Array.from({length:Math.min(6,days.length)},async()=>{
    while(cursor<days.length){const i=cursor++;
     try{const response=await fetch(`data/history/${days[i]}.json`,{cache:'default'});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      results[i]=await response.json();
     }catch(e){results[i]=null;}
     finished++;
     if(finished%12===0||finished===days.length)setNotice(`正在读取历史数据：${finished}/${days.length} 个交易日`);
    }
   });
   await Promise.all(workers);
   data=buildRange(days,results);
  }
  sectorPage=0;pickedSector=null;renderAll();
  $('range-start').value=days[0];$('range-end').value=days.at(-1);
  $('archive-info').textContent=`已载入 ${days.length} 个交易日 / 共 ${archiveDates.length} 日`;
  $('sidebar').classList.remove('open');
 }catch(e){setNotice('日期范围加载失败，请刷新后重试。');}
 finally{action.disabled=false;}
}
async function start(){document.querySelectorAll('#nav button').forEach(btn=>btn.addEventListener('click',()=>setPage(btn.dataset.page)));
 $('menu-btn').addEventListener('click',()=>$('sidebar').classList.toggle('open'));
 ['sector-kind','sector-sort','sector-search','sector-metric'].forEach(id=>$(id).addEventListener(id==='sector-search'?'input':'change',renderSectors));
 ['style-dim','style-metric'].forEach(id=>$(id).addEventListener('change',renderStyles));
 ['stocks-date','stocks-query'].forEach(id=>$(id).addEventListener(id==='stocks-query'?'input':'change',renderStocks));
 try {let response=await fetch('data/dashboard.json?ts='+Date.now(),{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);
  data=await response.json(); if(!Array.isArray(data.dates))throw Error('JSON schema invalid');
  latestData=data;
 }catch(e){data={dates:[],warnings:[],status:'not_configured'};setNotice('数据文件暂时无法读取；请检查部署路径与更新状态。');}
 try{const m=await fetch('data/dates.json?ts='+Date.now(),{cache:'no-store'});
  if(m.ok){const listing=await m.json();archiveDates=(listing.dates||[]).filter(x=>x>='2026-06-10');}
 }catch(e){}
 if(!archiveDates.length)archiveDates=data.dates||[];
 const minimum=archiveDates[0]||'2026-06-10',maximum=archiveDates.at(-1)||minimum;
 $('range-start').min=minimum;$('range-end').min=minimum;
 $('range-start').max=maximum;$('range-end').max=maximum;
 $('range-start').value=data.dates?.[0]||minimum;
 $('range-end').value=data.dates?.at(-1)||maximum;
 $('archive-info').textContent=`历史覆盖 ${minimum} 至 ${maximum} · ${archiveDates.length} 日`;
 $('range-apply').addEventListener('click',()=>selectRange($('range-start').value,$('range-end').value));
 $('range-recent').addEventListener('click',()=>selectRange(archiveDates.at(-10)||minimum,maximum));
 $('range-all').addEventListener('click',()=>selectRange(minimum,maximum));
 ['sector-kind','sector-sort','sector-search','sector-metric'].forEach(id=>$(id).addEventListener(id==='sector-search'?'input':'change',()=>{sectorPage=0;}));
 $('sector-page-prev').addEventListener('click',()=>{sectorPage=Math.max(0,sectorPage-1);renderSectors();});
 $('sector-page-next').addEventListener('click',()=>{sectorPage++;renderSectors();});
 renderAll();window.addEventListener('resize',()=>charts.forEach(c=>c.resize()));
}
window.addEventListener('DOMContentLoaded',start);
})();

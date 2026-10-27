/* MarketScope representative-stock research: observed daily bars, curated fixed tags. */
(()=>{'use strict';
let host=null, dataset=null, fetching=null, pending=null;
const $=id=>document.getElementById(id),num=v=>v===null||v===undefined||v===''||!Number.isFinite(Number(v))?null:Number(v);
const fmt=(v,d=2)=>num(v)==null?'—':Number(v).toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d});
const pct=v=>num(v)==null?'—':(v>0?'+':'')+fmt(v)+'%';
const el=(tag,s,klass)=>{const x=document.createElement(tag);if(s!==undefined)x.textContent=String(s??'');if(klass)x.className=klass;return x;};
const empty=id=>{const x=$(id);x.replaceChildren();return x;};
const splitMetric={return:['区间涨跌幅','%'],drawdown:['最大回撤','%'],up_ratio:['上涨日占比','%'],volatility:['日波动率','%'],turnover:['日均成交额','亿元']};
function snapshot(row,until,n){
 let series=(dataset?.prices?.[row.code]||[]).filter(x=>x.date<=until&&num(x.close)>0);
 if(series.length<n+1||series[series.length-1].date!==until)return null;
 let s=series.slice(-(n+1)),returns=[];
 for(let i=1;i<s.length;i++)returns.push((s[i].close/s[i-1].close-1)*100);
 let peak=-Infinity,maxdd=0;
 for(const p of s){peak=Math.max(peak,p.close);maxdd=Math.min(maxdd,(p.close/peak-1)*100);}
 let avg=returns.reduce((a,b)=>a+b,0)/returns.length;
 let variance=returns.reduce((a,b)=>a+(b-avg)*(b-avg),0)/returns.length;
 let amounts=s.slice(1).map(x=>num(x.turnover_100m)).filter(x=>x!=null);
 return {return:(s.at(-1).close/s[0].close-1)*100,drawdown:maxdd,
   up_ratio:returns.filter(x=>x>0).length/returns.length*100,
   volatility:Math.sqrt(variance),
   turnover:amounts.length===n?amounts.reduce((a,b)=>a+b,0)/amounts.length:null,
   positive_days:returns.filter(x=>x>0).length,negative_days:returns.filter(x=>x<0).length,
   close:s.at(-1).close,as_of:until};
}
function rows(){const day=$('rep-date').value,n=Number($('rep-window').value);
 return (dataset?.universe||[]).map(r=>({...r,metrics:snapshot(r,day,n)}));}
function categories(x,dim){if(dim==='all')return [];
 if(dim==='tags')return x.tags||[];
 return [x[dim]].filter(Boolean);}
function updateCategory(){const dim=$('rep-dimension').value,el0=$('rep-category'),old=el0.value;
 const tags=[...new Set((dataset?.universe||[]).flatMap(r=>categories(r,dim)))].sort((a,b)=>a.localeCompare(b,'zh'));
 el0.replaceChildren();const opt=el('option','全部');opt.value='';el0.append(opt);
 for(const tag of tags){const option=el('option',tag);option.value=tag;el0.append(option);}
 el0.value=tags.includes(old)?old:'';}
function ranked(input,metric,sort){return input.filter(r=>r.metrics&&num(r.metrics[metric])!=null)
 .sort((a,b)=>sort*(a.metrics[metric]-b.metrics[metric])||a.name.localeCompare(b.name,'zh'));}
function animateScroll(target){target?.scrollIntoView({behavior:'smooth',block:'start'});}
function scopeRows(){const dim=$('rep-dimension').value,category=$('rep-category').value,q=$('rep-search').value.toLowerCase().trim();
 return rows().filter(r=>(!category||categories(r,dim).includes(category))&&
 (!q||[r.name,r.code,r.industry,r.economic_style,...(r.tags||[])].join(' ').toLowerCase().includes(q)));}
function ranking(){
 const metric=$('rep-metric').value,dir=$('rep-direction').value,rows0=scopeRows(),filtered=ranked(rows0,metric,dir==='asc'?1:-1),
 body=empty('rep-table-body'),head=empty('rep-table-head'),tr=el('tr');
 for(const text of ['池内名次','股票','行业 / 经济风格','题材标签',splitMetric[metric][0],'5日涨跌','10日涨跌','下跌天数'])tr.append(el('th',text));head.append(tr);
 const baseDay=$('rep-date').value;
 for(let i=0;i<filtered.length;i++){const r=filtered[i],m=r.metrics,row=el('tr',undefined,'rep-result'),old=numberOfRanks(r,baseDay);
  row.append(el('td',String(i+1)),el('td',r.name+' · '+r.code),el('td',r.industry+' / '+r.economic_style),
    el('td',(r.tags||[]).join(' · ')),
    el('td',metric==='turnover'?fmt(m[metric])+' 亿':pct(m[metric])),
    el('td',pct(old.five?.return)),el('td',pct(old.ten?.return)),el('td',String(m.negative_days)+' / '+$('rep-window').value));
  row.addEventListener('click',()=>{showStock(r);animateScroll($('rep-ranking'));});body.append(row);
 }
 if(!filtered.length){const tr=el('tr'),td=el('td','当前日期或筛选条件下没有足够的真实历史日K样本。');td.colSpan=8;tr.append(td);body.append(tr);}
 $('rep-ranking-info').textContent='符合筛选 '+filtered.length+' / '+rows0.length+' 只（观察池共 '+(dataset?.universe?.length||0)+' 只）。名次仅在当前已取得行情的代表性股票池内计算；截止日必须有真实收盘价且具备完整的'+$('rep-window').value+'日区间。';
}
function numberOfRanks(r,day){return {five:snapshot(r,day,5),ten:snapshot(r,day,10)};}
function showStock(r){if(!host?.showDialog)return;
 const m=r.metrics,history=(dataset?.prices?.[r.code]||[]).filter(x=>x.date<=$('rep-date').value).slice(-10);
 host.showDialog(r.name+' · '+r.code,[['行业',r.industry],['经济风格（固定分类）',r.economic_style],['题材标签（固定分类）',r.tags.join('、')],
 ['本区间收益',pct(m.return)],['最大回撤',pct(m.drawdown)],['上涨日占比',pct(m.up_ratio)],['下跌天数',m.negative_days],
 ['最近十根K线价格',history.map(x=>x.date+' '+fmt(x.close)).join(' / ')]]);
}
function groupSummaries(data,dim,n,metric){
 const groups=new Map();
 for(const r of data){if(!r.metrics||num(r.metrics[metric])==null)continue;
  for(const tag of categories(r,dim)){let arr=groups.get(tag)||[];arr.push(r.metrics[metric]);groups.set(tag,arr);}}
 return [...groups].map(([name,values])=>({name,count:values.length,
  median:values.sort((a,b)=>a-b)[Math.floor((values.length-1)/2)],
  win:100*values.filter(v=>v>0).length/values.length}))
 .sort((a,b)=>b.median-a.median);
}
function summaries(){
 const data=rows(),labels=dataset?.economic_styles||[],block=empty('rep-style-summary');
 const groups=groupSummaries(data,'economic_style',Number($('rep-window').value),'return');
 for(const name of labels){let group=groups.find(x=>x.name===name),card=el('button',undefined,'rep-style-card');
  card.type='button';card.append(el('small',name),el('strong',group?pct(group.median):'—'),el('span',group?'观察 '+group.count+' 只 · 正收益 '+fmt(group.win,0)+'%':'尚无足够历史行情'));
  card.addEventListener('click',()=>{$('rep-dimension').value='economic_style';updateCategory();$('rep-category').value=name;ranking();animateScroll($('rep-ranking'));});block.append(card);}
 const windows=[5,10,20,40],all=dataset?.universe||[],date=$('rep-date').value;
 const heat=windows.map(n=>groupSummaries(all.map(r=>({...r,metrics:snapshot(r,date,n)})),'economic_style',n,'return'));
 const ser=labels.map(label=>({type:'bar',name:label,data:windows.map((n,i)=>heat[i].find(x=>x.name===label)?.median??null)}));
 if(ser.some(s=>s.data.some(v=>v!==null)))host.chart('rep-style-chart',{tooltip:{trigger:'axis'},xAxis:{type:'category',data:windows.map(n=>n+'日')},
  yAxis:{type:'value',name:'池内中位收益 %',scale:true},legend:{type:'scroll',top:0},series:ser});
 else host.noChart('rep-style-chart','观察池历史数据尚未采集，暂不生成风格排名。');
 const tags=empty('rep-tag-summary');
 for(const dim of ['industry','tags']){const names=groupSummaries(data,dim,Number($('rep-window').value),'return').slice(0,15);
  let title=el('h3',dim==='industry'?'行业代表股 · 区间中位收益':'题材标签 · 区间中位收益');tags.append(title);
  let box=el('div',undefined,'rep-tags');for(const item of names){let chip=el('button',undefined,'rep-tag');chip.type='button';chip.append(el('strong',item.name),el('span',pct(item.median)+' · '+item.count+'只'));chip.addEventListener('click',()=>{$('rep-dimension').value=dim;updateCategory();$('rep-category').value=item.name;ranking();animateScroll($('rep-ranking'));});box.append(chip);}tags.append(box);}
}
function redraw(){if(!dataset)return;const day=$('rep-date').value;
 const source=dataset.quality||{},available=rows().filter(x=>x.metrics).length;
 $('rep-status').textContent='价格数据源：'+(dataset.source||'未注明')+' · '+day+' 可计算 '+available+'/'+(dataset.universe?.length||0)+' 只 · 仅用截止日以前的K线；没有足够样本的股票不纳入排名。股票标签为人工固定分类，不是实时官方认定。';
 summaries();ranking();
}
function initDate(){const select=$('rep-date'),list=host.state.archive||host.state.days,old=select.value;
 select.replaceChildren();for(const d of list){const opt=el('option',d);opt.value=d;select.append(opt);}
 select.value=list.includes(host.state.selected)?host.state.selected:(list.includes(old)?old:list.at(-1));
}
async function render(context){host=context;if(!dataset&&!fetching)fetching=fetch('data/representatives.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();}).then(r=>{dataset=r;fetching=null;}).catch(err=>{fetching=null;pending=err;});
 if(fetching)await fetching;
 if(!dataset){$('rep-status').textContent='代表性股票价格尚未生成：'+(pending?.message||'数据源未就绪')+'。不使用模拟排名。';return;}
 if(context.state.page!=='history')return;
 initDate();updateCategory();redraw();
}
function bind(){for(const id of ['rep-date','rep-window','rep-category','rep-metric','rep-direction'])$(id)?.addEventListener('change',redraw);
 $('rep-dimension')?.addEventListener('change',()=>{updateCategory();redraw();});
 $('rep-search')?.addEventListener('input',ranking);
}
bind();window.MarketScopeHistory={render};
})();

/* Existing public archives only. Source-reported returns, dated amounts, dated industry membership. */
(function(root){
'use strict';
const number=v=>v===null||v===undefined||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))?null:Number(v);
const round=v=>v===null?null:Math.round(v*10000)/10000;
function prepare(input,{memberIndexes={},riskRecords=[]}={}){
 const snapshots=[...new Map((input||[]).filter(s=>s?.date).map(s=>[s.date,s])).values()].sort((a,b)=>a.date.localeCompare(b.date));
 const dates=snapshots.map(s=>s.date),indices=new Map(dates.map((d,i)=>[d,i])),stocks=Object.create(null),industries=new Map(),rosters=Object.create(null),rosterIds=new Map(),amountConflicts=new Set();
 const stock=(code,name)=>{if(!stocks[code])stocks[code]={name:name||code,p:dates.map(()=>null),ps:dates.map(()=>null),a:dates.map(()=>null)};if(name)stocks[code].name=name;return stocks[code];};
 for(let i=0;i<snapshots.length;i++){
  const s=snapshots[i],day=s.date;
  const sameDayFocus=String(s.quality_manifest?.sector_focus_stocks?.collected_at||'').slice(0,10)===day;
  for(const r of s.sector_focus_stocks||[]){
   if(!r.stock_code||r.trade_date!==day)continue;const x=stock(r.stock_code,r.stock_name),amount=number(r.turnover_100m),key=r.stock_code+'|'+day;
   if(amount!==null&&amount>=0&&!amountConflicts.has(key)){
    if(x.a[i]!==null&&Math.abs(x.a[i]-amount)>0.000001){x.a[i]=null;amountConflicts.add(key);}else x.a[i]=amount;
   }
   if(sameDayFocus&&number(r.pct)!==null){x.p[i]=number(r.pct);x.ps[i]='f';}
  }
  for(const key of ['limit_break_events','limit_down_events','stock_list'])for(const r of s[key]||[]){
   if(!r.thscode||(r.date&&r.date!==day)||number(r.price_change_ratio_pct)===null)continue;
   const x=stock(r.thscode,r.name);x.p[i]=number(r.price_change_ratio_pct);x.ps[i]='e';
  }
  const q=s.quality_manifest?.sector_members,observed=q?.membership_observed_date,index=memberIndexes[observed];
  const valid=q?.status==='complete'&&(!q.trade_date||q.trade_date===day)&&observed&&observed<=day&&!/backcast/i.test(String(q.source||'')+' '+String(q.membership_mode||''))&&index?.status==='complete'&&index.observed_date===observed;
  for(const r of s.sectors||[]){
   if(r.tag!=='industry'||r.date!==day||!r.code)continue;
   if(!industries.has(r.code))industries.set(r.code,{code:r.code,name:r.name||r.code,p:dates.map(()=>null),roster_ids:dates.map(()=>null),membership_observed_dates:dates.map(()=>null)});
   const industry=industries.get(r.code);industry.name=r.name||industry.name;industry.p[i]=number(r.pct);
   const members=valid&&(r.membership_observed_date===undefined||r.membership_observed_date===observed)?index.members?.[r.code]:null;
   if(!members||typeof members!=='object'||Array.isArray(members))continue;
   const codes=Object.keys(members).sort(),canonical=JSON.stringify(codes);let id=rosterIds.get(canonical);
   if(!id){id='r'+rosterIds.size;rosterIds.set(canonical,id);rosters[id]=codes;}
   industry.roster_ids[i]=id;industry.membership_observed_dates[i]=observed;
   for(const code of codes)if(stocks[code]&&members[code])stocks[code].name=members[code];
  }
 }
 for(const r of riskRecords||[]){if(!r?.code)continue;for(const o of r.observations||[]){const i=indices.get(o.date);if(i===undefined)continue;for(const check of o.checks||[]){if(check.id!=='daily_change'||check.unit!=='%'||number(check.value)===null)continue;const x=stock(r.code,r.name);if(x.p[i]===null){x.p[i]=number(check.value);x.ps[i]='r';}}}}
 return {schema_version:1,kind:'sector_startup_base',dates,stocks,industries:[...industries.values()],rosters,supported:{breakout:false},amount_unit:'亿元',amount_rounding_half:0.0005,price_sources:{e:'当日事件源涨跌幅',f:'同日采集重点股行情源涨跌幅',r:'风险归档源报ZDF涨跌幅'},coverage:{archive_days:dates.length,amount_conflicts:amountConflicts.size},scope:'已有重点股成交额样本；不是全市场完整扫描。行业按启动日有效成分，多级行业不可跨组加总。'};
}
function evaluateStock(base,code,index,{pctThreshold=3,amountMultiple=1.5}={}){
 const stock=base.stocks[code],pct=number(stock?.p?.[index]),amount=number(stock?.a?.[index]);
 const previous=index>=5?stock?.a?.slice(index-5,index):null;
 const amountsComplete=amount!==null&&amount>0&&previous?.length===5&&previous.every(v=>number(v)!==null&&Number(v)>0);
 const mean=amountsComplete?previous.reduce((sum,v)=>sum+Number(v),0)/5:null;
 const result={state:'unknown',pct,amount_100m:amount,prior5_mean_100m:mean,amount_ratio:mean>0?amount/mean:null,eligible:pct!==null&&amountsComplete,reason:'missing_inputs'};
 // One false conjunct proves the rule false even when the other is unknown.
 if(pct!==null&&pct<pctThreshold)return {...result,state:'false',reason:'pct_below_threshold'};
 if(!amountsComplete)return result;
 const half=base.amount_rounding_half??0.0005;
 const low=amount-half,high=amount+half,meanLow=mean-half,meanHigh=mean+half;
 if(meanLow<=0)return {...result,reason:'amount_rounding_near_zero'};
 if(high<amountMultiple*meanLow)return {...result,state:'false',reason:'amount_below_threshold'};
 if(low>=amountMultiple*meanHigh&&pct!==null&&pct>=pctThreshold)return {...result,state:'true',reason:'confirmed'};
 return {...result,reason:pct===null?'missing_pct':'amount_rounding_boundary'};
}
function evaluate(base,{pctThreshold=3,amountMultiple=1.5,asof}={}){
 if(number(pctThreshold)===null||number(amountMultiple)===null||amountMultiple<=0)throw new RangeError('Invalid startup thresholds');
 const end=asof===undefined?base.dates.length-1:typeof asof==='string'?base.dates.indexOf(asof):asof;
 if(!Number.isInteger(end)||end<0||end>=base.dates.length)throw new RangeError('Unknown startup cutoff date');
 const params={pctThreshold:Number(pctThreshold),amountMultiple:Number(amountMultiple)},cache=new Map(),industries=[];
 const coverage={eligible_stock_days:0,eligible_stocks:0,new_stock_industry_pairs:0,repeat_stock_industry_events:0,first_eligible_date:null,last_eligible_date:null};
 const eligiblePairs=new Set(),eligibleStocks=new Set(),byDate=base.dates.map(date=>({date,universe:new Set(),eligible:new Set(),qualified:new Set(),new_stocks:new Set(),repeat_stocks:new Set(),has_membership:false}));
 for(const source of base.industries){
  const members=new Map(),daily=base.dates.map(()=>null);let prior=new Map();
  for(let i=0;i<=end;i++){
   const id=source.roster_ids[i],roster=id&&base.rosters[id];
   if(!roster){daily[i]={status:'unknown',expected:null,eligible:0,evaluated:0,new_count:null,count:null,repeat_count:null,known_new:null,known_repeat:null};prior=new Map();continue;}
   byDate[i].has_membership=true;for(const code of roster)byDate[i].universe.add(code);
   const point={status:'complete',expected:roster.length,eligible:0,evaluated:0,new_count:0,repeat_count:0,known_new:0,known_repeat:0,known_qualified:0},current=new Map();
   for(const code of roster){
    const key=code+'|'+i;if(!cache.has(key))cache.set(key,evaluateStock(base,code,i,params));const hit=cache.get(key);current.set(code,hit.state);
    if(hit.eligible){point.eligible++;eligiblePairs.add(key);eligibleStocks.add(code);byDate[i].eligible.add(code);if(!coverage.first_eligible_date||base.dates[i]<coverage.first_eligible_date)coverage.first_eligible_date=base.dates[i];if(!coverage.last_eligible_date||base.dates[i]>coverage.last_eligible_date)coverage.last_eligible_date=base.dates[i];}
    if(hit.state!=='unknown')point.evaluated++;
    if(hit.state!=='true')continue;
    point.known_qualified++;byDate[i].qualified.add(code);const date=base.dates[i];let member=members.get(code);
    if(!member){member={code,name:base.stocks[code]?.name||code,first_start:date,start_date:date,start_index:i,last_trigger:date,trigger_dates:[date],start_pct:hit.pct,amount_100m:hit.amount_100m,prior5_mean_100m:hit.prior5_mean_100m,amount_ratio:hit.amount_ratio,membership_observed_date:source.membership_observed_dates[i]};members.set(code,member);point.known_new++;byDate[i].new_stocks.add(code);coverage.new_stock_industry_pairs++;}
    else if(prior.get(code)==='false'){member.trigger_dates.push(date);member.last_trigger=date;point.known_repeat++;byDate[i].repeat_stocks.add(code);coverage.repeat_stock_industry_events++;}
   }
   point.status=point.evaluated===point.expected?'complete':'partial';
   point.new_count=point.status==='complete'?point.known_new:null;point.repeat_count=point.status==='complete'?point.known_repeat:null;point.count=point.new_count;daily[i]=point;prior=current;
  }
  industries.push({code:source.code,name:source.name,daily_pct:source.p,daily,members:[...members.values()]});
 }
 coverage.by_date=byDate.map((d,i)=>({date:d.date,universe:d.has_membership?d.universe.size:null,eligible:i<=end?d.eligible.size:null,qualified:i<=end?d.qualified.size:null,new_stocks:i<=end?d.new_stocks.size:null,repeat_stocks:i<=end?d.repeat_stocks.size:null}));
 coverage.eligible_stock_days=eligiblePairs.size;coverage.eligible_stocks=eligibleStocks.size;
 return {schema_version:1,dates:base.dates,asof:base.dates[end],parameters:params,industries,stocks:Object.fromEntries(Object.entries(base.stocks).map(([code,s])=>[code,{name:s.name,p:s.p,daily_pct:s.p,pct_sources:s.ps}])),coverage,scope:base.scope,supported:base.supported,price_sources:base.price_sources,methodology:'≥阈值且前5交易日金额全为正；舍入边界未知。每股每行业首次已确认入池，后续仅前日明确false→true重复触发；收益从首次启动日前收起，含启动日。'};
}
function membersAt(model,industry,end){const i=typeof end==='string'?model.dates.indexOf(end):end;if(!Number.isInteger(i)||i<0||i>=model.dates.length||model.dates[i]>model.asof)return[];const date=model.dates[i];return industry.members.filter(m=>m.first_start<=date).map(m=>{const triggers=m.trigger_dates.filter(d=>d<=date);return{...m,last_trigger:triggers.at(-1),trigger_dates:triggers};});}
function performance(model,industry,member,end){
 const i=typeof end==='string'?model.dates.indexOf(end):end,start=model.dates.indexOf(member.first_start||member.start_date);
 const missing={daily_pct:null,stock_cumulative_pct:null,cumulative:null,industry_cumulative_pct:null,relative_pp:null,relative:null};
 if(!Number.isInteger(i)||i<start||start<0||i>=model.dates.length||model.dates[i]>model.asof)return missing;
 const compound=values=>{let value=1;for(let j=start;j<=i;j++){const pct=number(values?.[j]);if(pct===null||pct< -100)return null;value*=1+pct/100;}return(value-1)*100;};
 const stock=compound(model.stocks[member.code]?.p),sector=compound(industry.daily_pct);
 return {daily_pct:number(model.stocks[member.code]?.p?.[i]),stock_cumulative_pct:round(stock),cumulative:round(stock),industry_cumulative_pct:round(sector),relative_pp:stock===null||sector===null?null:round(stock-sector),relative:stock===null||sector===null?null:round(stock-sector)};
}
root.SectorStartupModel={prepare,evaluate,evaluateStock,build:(input,options={})=>evaluate(prepare(input,options),options),membersAt,performance};
})(globalThis);

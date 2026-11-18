/* Existing public archives only. Source-reported returns, dated amounts, dated industry membership. */
(function(root){
'use strict';
const number=v=>v===null||v===undefined||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))?null:Number(v);
const round=v=>v===null?null:Math.round(v*10000)/10000;
const qualificationLabels=new Set(['沪股通','深股通','融资融券','转融券','融资标的','融券标的']);
function prepare(input,{memberIndexes={},riskRecords=[],themeModel=null}={}){
 const snapshots=[...new Map((input||[]).filter(s=>s?.date).map(s=>[s.date,s])).values()].sort((a,b)=>a.date.localeCompare(b.date));
 const dates=snapshots.map(s=>s.date),indices=new Map(dates.map((d,i)=>[d,i])),stocks=Object.create(null),industries=new Map(),rosters=Object.create(null),rosterIds=new Map(),amountConflicts=new Set();
 // Concept counts must be the exact independently published theme model, not a new proxy.
 if(!themeModel||JSON.stringify(themeModel.dates)!==JSON.stringify(dates))themeModel=root.MarketScopeThemeModel?.build(snapshots,{memberIndexes})||null;
 const themeByCode=new Map((themeModel?.themes||[]).map(t=>[t.code,t]));
 const upDays=snapshots.map(s=>{const rows=s.stock_list,seen=new Set();const complete=Array.isArray(rows)&&number(s.limits?.total)!==null&&rows.length===Number(s.limits.total)&&rows.every(r=>r.thscode&&(!r.date||r.date===s.date)&&!seen.has(r.thscode)&&seen.add(r.thscode));const up=new Map((Array.isArray(rows)?rows:[]).filter(r=>r.thscode&&(!r.date||r.date===s.date)).map(r=>[r.thscode,r]));return{complete,available:Array.isArray(rows),up};});
 const downDays=snapshots.map(s=>{const rows=s.limit_down_events,q=s.quality_manifest?.limit_down_events,seen=new Set();const complete=Array.isArray(rows)&&q?.status==='complete'&&(!q.trade_date||q.trade_date===s.date)&&(number(q.items_count)===null||Number(q.items_count)===rows.length)&&rows.every(r=>r.thscode&&(!r.date||r.date===s.date)&&!seen.has(r.thscode)&&seen.add(r.thscode));const down=new Map((Array.isArray(rows)?rows:[]).filter(r=>r.thscode&&(!r.date||r.date===s.date)).map(r=>[r.thscode,r]));return{complete,available:Array.isArray(rows),down};});
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
   if(!['industry','cn_concept'].includes(r.tag)||r.date!==day||!r.code)continue;
   if(r.tag==='cn_concept'&&(qualificationLabels.has(r.name)||(themeModel&&!themeByCode.has(r.code))))continue;
   if(!industries.has(r.code))industries.set(r.code,{code:r.code,name:r.name||r.code,kind:r.tag,p:dates.map(()=>null),roster_ids:dates.map(()=>null),membership_observed_dates:dates.map(()=>null),daily_event_up:dates.map(()=>null),daily_event_up_known:dates.map(()=>null),daily_event_quality:dates.map(()=>'unknown'),membership_modes:dates.map(()=>'unknown'),daily_limit_down_count:dates.map(()=>null),daily_limit_down_known:dates.map(()=>null),daily_limit_down_quality:dates.map(()=>'unknown'),limit_members:[]});
   const industry=industries.get(r.code);industry.name=r.name||industry.name;industry.p[i]=number(r.pct);
   if(r.tag==='cn_concept'){
    const theme=themeByCode.get(r.code);industry.daily_event_up[i]=theme?.daily_event_up?.[i]??null;industry.daily_event_up_known[i]=theme?.daily_event_up_known?.[i]??null;industry.daily_event_quality[i]=theme?.daily_event_quality?.[i]||'unknown';industry.membership_modes[i]=themeModel?.quality?.[i]?.membership||'unknown';const dq=themeModel?.quality?.[i]?.down||'unknown',down=theme?.daily?.[i]?.[1]??null;industry.daily_limit_down_count[i]=dq==='complete'?down:null;industry.daily_limit_down_known[i]=down;industry.daily_limit_down_quality[i]=down===null?'unknown':dq;industry.limit_members=theme?.members||[];
   }
   const members=valid&&(r.membership_observed_date===undefined||r.membership_observed_date===observed)?index.members?.[r.code]:null;
   if(!members||typeof members!=='object'||Array.isArray(members))continue;
   const codes=Object.keys(members).sort(),canonical=JSON.stringify(codes);let id=rosterIds.get(canonical);
   if(!id){id='r'+rosterIds.size;rosterIds.set(canonical,id);rosters[id]=codes;}
   industry.roster_ids[i]=id;industry.membership_observed_dates[i]=observed;
   if(r.tag==='industry'){
    const up=upDays[i],known=codes.filter(code=>up.up.has(code)&&!up.up.get(code).is_st).length;
    industry.daily_event_up[i]=up.complete?known:null;industry.daily_event_up_known[i]=up.available?known:null;industry.daily_event_quality[i]=up.complete?'complete':up.available?'partial':'unknown';industry.membership_modes[i]='historical';
    const dp=downDays[i],downKnown=codes.filter(code=>dp.down.has(code)&&!dp.down.get(code).is_st).length;
    industry.daily_limit_down_count[i]=dp.complete?downKnown:null;industry.daily_limit_down_known[i]=dp.available?downKnown:null;industry.daily_limit_down_quality[i]=dp.complete?'complete':dp.available?'partial':'unknown';
    for(const code of codes){const event=up.up.get(code);if(!event||event.is_st)continue;stock(code,event.name||members[code]);if(!industry.limit_members.some(m=>m.code===code))industry.limit_members.push({code,since:day,membership_mode:'historical',membership_observed_date:observed,admission_reason:event.reason||event.limit_up_reason||null,concept_name_at_admission:industry.name});}

   }
   for(const code of codes)if(stocks[code]&&members[code])stocks[code].name=members[code];
  }
 }
 for(const r of riskRecords||[]){if(!r?.code)continue;for(const o of r.observations||[]){const i=indices.get(o.date);if(i===undefined)continue;for(const check of o.checks||[]){if(check.id!=='daily_change'||check.unit!=='%'||number(check.value)===null)continue;const x=stock(r.code,r.name);if(x.p[i]===null){x.p[i]=number(check.value);x.ps[i]='r';}}}}
 // Use only already-published genuine theme price observations, and only fill gaps.
 for(const [code,source]of Object.entries(themeModel?.stocks||{})){
  const record=stock(code,source.name);
  for(let i=0;i<dates.length;i++){const value=source.daily?.[i];if(record.p[i]===null&&['e','f','r'].includes(value?.[3])&&number(value?.[0])!==null){record.p[i]=number(value[0]);record.ps[i]=value[3];}}
 }
 for(const [code,record]of Object.entries(stocks)){
  record.l=upDays.map(d=>d.up.has(code)?true:d.complete?false:null);
  record.b=upDays.map(d=>d.up.has(code)?number(d.up.get(code).boards)??number(d.up.get(code).continue_day_cnt)??null:d.complete?0:null);
  record.ld=downDays.map(d=>d.down.has(code)?true:d.complete?false:null);
 }
 return {schema_version:2,kind:'sector_startup_base',dates,stocks,industries:[...industries.values()],rosters,supported:{breakout:false},amount_unit:'亿元',amount_rounding_half:0.0005,price_sources:{e:'当日事件源涨跌幅',f:'同日采集重点股行情源涨跌幅',r:'风险归档源报ZDF涨跌幅'},coverage:{archive_days:dates.length,amount_conflicts:amountConflicts.size},scope:'已有重点股成交额样本；不是全市场完整扫描。行业/概念启动按当日有效成分，多级分类不可跨组加总；概念涨停热图沿用题材研究标明的回看口径。'};
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
 const kindCoverage=new Map();
 const eligiblePairs=new Set(),eligibleStocks=new Set(),byDate=base.dates.map(date=>({date,universe:new Set(),eligible:new Set(),qualified:new Set(),new_stocks:new Set(),repeat_stocks:new Set(),has_membership:false}));
 for(const source of base.industries){
  const kind=source.kind||'industry';
  if(!kindCoverage.has(kind))kindCoverage.set(kind,{eligiblePairs:new Set(),eligibleStocks:new Set(),new_stock_industry_pairs:0,repeat_stock_industry_events:0,byDate:base.dates.map(date=>({date,universe:new Set(),eligible:new Set(),qualified:new Set(),new_stocks:new Set(),repeat_stocks:new Set(),has_membership:false}))});
  const kc=kindCoverage.get(kind);
  const members=new Map(),daily=base.dates.map(()=>null);let prior=new Map();
  for(let i=0;i<=end;i++){
   const id=source.roster_ids[i],roster=id&&base.rosters[id],event={limit_up:source.daily_event_up?.[i]??null,limit_up_known:source.daily_event_up_known?.[i]??null,limit_up_quality:source.daily_event_quality?.[i]||'unknown',membership_mode:source.membership_modes?.[i]||'unknown',limit_down_count:source.daily_limit_down_count?.[i]??null,limit_down_known:source.daily_limit_down_known?.[i]??null,limit_down_quality:source.daily_limit_down_quality?.[i]||'unknown'};
   if(!roster){daily[i]={...event,status:'unknown',expected:null,eligible:0,evaluated:0,new_count:null,count:null,repeat_count:null,known_new:null,known_repeat:null};prior=new Map();continue;}
   byDate[i].has_membership=true;kc.byDate[i].has_membership=true;for(const code of roster){byDate[i].universe.add(code);kc.byDate[i].universe.add(code);}
   const point={...event,status:'complete',expected:roster.length,eligible:0,evaluated:0,new_count:0,repeat_count:0,known_new:0,known_repeat:0,known_qualified:0},current=new Map();
   for(const code of roster){
    const key=code+'|'+i;if(!cache.has(key))cache.set(key,evaluateStock(base,code,i,params));const hit=cache.get(key);current.set(code,hit.state);
    if(hit.eligible){point.eligible++;eligiblePairs.add(key);eligibleStocks.add(code);byDate[i].eligible.add(code);kc.eligiblePairs.add(key);kc.eligibleStocks.add(code);kc.byDate[i].eligible.add(code);if(!coverage.first_eligible_date||base.dates[i]<coverage.first_eligible_date)coverage.first_eligible_date=base.dates[i];if(!coverage.last_eligible_date||base.dates[i]>coverage.last_eligible_date)coverage.last_eligible_date=base.dates[i];}
    if(hit.state!=='unknown')point.evaluated++;
    if(hit.state!=='true')continue;
    point.known_qualified++;byDate[i].qualified.add(code);kc.byDate[i].qualified.add(code);const date=base.dates[i];let member=members.get(code);
    if(!member){member={code,name:base.stocks[code]?.name||code,first_start:date,start_date:date,start_index:i,last_trigger:date,trigger_dates:[date],start_pct:hit.pct,amount_100m:hit.amount_100m,prior5_mean_100m:hit.prior5_mean_100m,amount_ratio:hit.amount_ratio,membership_observed_date:source.membership_observed_dates[i]};members.set(code,member);point.known_new++;byDate[i].new_stocks.add(code);coverage.new_stock_industry_pairs++;kc.byDate[i].new_stocks.add(code);kc.new_stock_industry_pairs++;}
    else if(prior.get(code)==='false'){member.trigger_dates.push(date);member.last_trigger=date;point.known_repeat++;byDate[i].repeat_stocks.add(code);coverage.repeat_stock_industry_events++;kc.byDate[i].repeat_stocks.add(code);kc.repeat_stock_industry_events++;}
   }
   point.status=point.evaluated===point.expected?'complete':'partial';
   point.new_count=point.status==='complete'?point.known_new:null;point.repeat_count=point.status==='complete'?point.known_repeat:null;point.count=point.new_count;daily[i]=point;prior=current;
  }
  industries.push({code:source.code,name:source.name,kind,daily_pct:source.p,limit_members:source.limit_members||[],daily_limit_down_count:source.daily_limit_down_count||base.dates.map(()=>null),daily_limit_down_known:source.daily_limit_down_known||base.dates.map(()=>null),daily_limit_down_quality:source.daily_limit_down_quality||base.dates.map(()=>'unknown'),daily_event_up:source.daily_event_up||base.dates.map(()=>null),daily_event_up_known:source.daily_event_up_known||base.dates.map(()=>null),daily_event_quality:source.daily_event_quality||base.dates.map(()=>'unknown'),membership_modes:source.membership_modes||base.dates.map(()=>'unknown'),daily,members:[...members.values()]});
 }
 coverage.by_date=byDate.map((d,i)=>({date:d.date,universe:d.has_membership?d.universe.size:null,eligible:i<=end?d.eligible.size:null,qualified:i<=end?d.qualified.size:null,new_stocks:i<=end?d.new_stocks.size:null,repeat_stocks:i<=end?d.repeat_stocks.size:null}));
 coverage.by_kind=Object.fromEntries([...kindCoverage].map(([kind,k])=>[kind,{eligible_stock_days:k.eligiblePairs.size,eligible_stocks:k.eligibleStocks.size,new_stock_industry_pairs:k.new_stock_industry_pairs,repeat_stock_industry_events:k.repeat_stock_industry_events,first_eligible_date:k.byDate.find(d=>d.eligible.size>0)?.date||null,last_eligible_date:[...k.byDate].reverse().find(d=>d.eligible.size>0)?.date||null,by_date:k.byDate.map((d,i)=>({date:d.date,universe:d.has_membership?d.universe.size:null,eligible:i<=end?d.eligible.size:null,qualified:i<=end?d.qualified.size:null,new_stocks:i<=end?d.new_stocks.size:null,repeat_stocks:i<=end?d.repeat_stocks.size:null}))}]));
 coverage.eligible_stock_days=eligiblePairs.size;coverage.eligible_stocks=eligibleStocks.size;
 return {schema_version:2,dates:base.dates,asof:base.dates[end],parameters:params,industries,stocks:Object.fromEntries(Object.entries(base.stocks).map(([code,s])=>[code,{name:s.name,p:s.p,daily_pct:s.p,pct_sources:s.ps,daily_limit_up:s.l||base.dates.map(()=>null),daily_boards:s.b||base.dates.map(()=>null),daily_limit_down:s.ld||base.dates.map(()=>null)}])),coverage,scope:base.scope,supported:base.supported,price_sources:base.price_sources,methodology:'≥阈值且前5交易日金额全为正；舍入边界未知。每股每行业首次已确认入池，后续仅前日明确false→true重复触发；收益从首次启动日前收起，含启动日。'};
}
function membersAt(model,industry,end){const i=typeof end==='string'?model.dates.indexOf(end):end;if(!Number.isInteger(i)||i<0||i>=model.dates.length||model.dates[i]>model.asof)return[];const date=model.dates[i];return industry.members.filter(m=>m.first_start<=date).map(m=>{const triggers=m.trigger_dates.filter(d=>d<=date);return{...m,last_trigger:triggers.at(-1),trigger_dates:triggers};});}
function performance(model,industry,member,end){
 const i=typeof end==='string'?model.dates.indexOf(end):end,start=model.dates.indexOf(member.first_start||member.start_date);
 const missing={daily_pct:null,stock_cumulative_pct:null,cumulative:null,industry_cumulative_pct:null,relative_pp:null,relative_raw_pp:null,relative:null};
 if(!Number.isInteger(i)||i<start||start<0||i>=model.dates.length||model.dates[i]>model.asof)return missing;
 const compound=values=>{let value=1;for(let j=start;j<=i;j++){const pct=number(values?.[j]);if(pct===null||pct< -100)return null;value*=1+pct/100;}return(value-1)*100;};
 const stock=compound(model.stocks[member.code]?.p),sector=compound(industry.daily_pct);
 return {daily_pct:number(model.stocks[member.code]?.p?.[i]),stock_cumulative_pct:round(stock),cumulative:round(stock),industry_cumulative_pct:round(sector),relative_pp:stock===null||sector===null?null:round(stock-sector),relative_raw_pp:stock===null||sector===null?null:stock-sector,relative:stock===null||sector===null?null:round(stock-sector)};
}
function limitMembersAt(model,sector,end,window=60){
 const i=typeof end==='string'?model.dates.indexOf(end):end;
 if(!Number.isInteger(i)||i<0||i>=model.dates.length||model.dates[i]>model.asof||!Number.isInteger(window)||window<1)return[];
 const date=model.dates[i],start=Math.max(0,i-window+1),result=[];
 for(const member of sector.limit_members||[]){
  if(!member.since||member.since>date)continue;const daily=model.stocks[member.code]?.daily_limit_up||[];let first=null,complete=true;
  for(let j=start;j<=i;j++){if(model.dates[j]<member.since)continue;if(daily[j]===true){first??=model.dates[j];}else if(daily[j]!==false)complete=false;}
  if(first===null&&complete)continue;
  result.push({...member,name:model.stocks[member.code]?.name||member.code,start_date:member.since,start_index:model.dates.indexOf(member.since),first_start:member.since,window_first_limit_up:first,retention_status:first===null?'pending_verification':'within_window'});
 }
 return result;
}
function filterMembers(model,sector,end,{recentDays=0,relativePositive=false,notLimitUp=false}={}){
 const i=typeof end==='string'?model.dates.indexOf(end):end,candidates=membersAt(model,sector,end),members=[];let pending=0;
 for(const member of candidates){
  let failed=false,unknown=false;
  if(recentDays){if(!Number.isInteger(recentDays)||recentDays<1)unknown=true;else if(member.start_index<i-recentDays+1)failed=true;}
  if(relativePositive){const p=performance(model,sector,member,i);if(p.relative_raw_pp===null)unknown=true;else if(p.relative_raw_pp<=0)failed=true;}
  if(notLimitUp){const state=model.stocks[member.code]?.daily_limit_up?.[i];if(state===true)failed=true;else if(state!==false)unknown=true;}
  if(!failed&&!unknown)members.push(member);else if(!failed&&unknown)pending++;
 }
 return {members,pending,total:candidates.length};
}
root.SectorStartupModel={prepare,evaluate,evaluateStock,build:(input,options={})=>evaluate(prepare(input,options),options),membersAt,performance,filterMembers,limitMembersAt};
})(globalThis);

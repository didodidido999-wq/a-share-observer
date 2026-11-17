/* Existing public archives only. Historical membership and explicitly labeled current-cohort backcasts stay distinct. */
(function(root){
'use strict';
const excluded=new Set(['沪股通','深股通','融资融券','转融券','融资标的','融券标的']);
const num=v=>v==null||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))?null:Number(v);
const pool=(s,key)=>{if(!Array.isArray(s[key]))return 'unknown';if(key==='stock_list'){const seen=new Set();const valid=s[key].every(r=>r.thscode&&(!r.date||r.date===s.date)&&!seen.has(r.thscode)&&seen.add(r.thscode));return valid&&num(s.limits?.total)!==null&&s[key].length===Number(s.limits.total)?'complete':'partial';}return ['complete','partial'].includes(s.quality_manifest?.[key]?.status)?s.quality_manifest[key].status:'partial';};
function concepts(s){
 const q=s.quality_manifest?.sector_members,observed=q?.membership_observed_date;
 if(q?.status!=='complete'||!observed||observed>s.date||/backcast/i.test(String(q.source||''))||/backcast/i.test(String(q.membership_mode||''))||!s.event_sector_map||Array.isArray(s.event_sector_map))return null;
 const byName=new Map(),dupes=new Set();
 for(const r of s.sectors||[]){if(r.tag!=='cn_concept'||r.date!==s.date||!r.code||!r.name||excluded.has(r.name)||(r.membership_observed_date&&r.membership_observed_date!==observed))continue;
  if(byName.has(r.name)&&byName.get(r.name).code!==r.code)dupes.add(r.name);else byName.set(r.name,r);}
 for(const name of dupes)byName.delete(name);
 return byName.size?{byName,observed}:null;
}
function coverage(model){
 const first=new Map();for(const t of model.themes)for(const m of t.members)if(!first.has(m.code)||m.since<first.get(m.code))first.set(m.code,m.since);
 let total=0,have=0;for(const [code,since]of first)for(let i=0;i<model.dates.length;i++)if(model.dates[i]>=since){total++;if(num(model.stocks[code].daily[i][0])!==null)have++;}
 model.coverage={days:model.dates.length,stocks:Object.keys(model.stocks).length,themes:model.themes.length,membership_days:model.quality.filter(q=>q.membership==='complete').length,membership_start:model.dates.find((d,i)=>model.quality[i].membership!=='unknown')||null,tracked_stock_days:total,price_stock_days:have,missing_price_stock_days:total-have};
 model.coverage.first_verified_membership=model.dates.find((d,i)=>model.quality[i].membership==='complete')||null;model.coverage.backcast_days=model.quality.filter(q=>q.membership==='backcast_current').length;
}
// Independent full-concept event counts, not the persistent tracking cohort.
function eventStats(s,c,mapping,options,rosterIds){
 const result=new Map();if(!c)return result;
 const rows=s.stock_list,seen=new Set();
 const complete=pool(s,'stock_list')==='complete'&&Array.isArray(rows)&&rows.every(r=>r.thscode&&(!r.date||r.date===s.date)&&!seen.has(r.thscode)&&seen.add(r.thscode));
 const index=options.memberIndexes?.[c.observed],mode=c.mode||'historical';
 for(const formal of c.byName.values()){
  let signature=null,basis=null,all=[],status='unknown';
  const observedRows=[...new Map((Array.isArray(rows)?rows:[]).filter(r=>r.thscode&&(!r.date||r.date===s.date)).map(r=>[r.thscode,r])).values()];
  const members=index?.status==='complete'&&index.observed_date===c.observed?index.members?.[formal.code]:null;
  if(members&&typeof members==='object'&&!Array.isArray(members)){
   const codes=Object.keys(members).sort(),key=JSON.stringify([mode,formal.code,codes]);
   if(!rosterIds.has(key))rosterIds.set(key,'roster:'+rosterIds.size);
   signature=rosterIds.get(key);basis='complete_roster';
   const set=new Set(codes);all=observedRows.filter(r=>set.has(r.thscode));if(complete)status='complete';
  }else{
   // Event maps contain event stocks only, so never use their keys as a roster.
   signature=JSON.stringify(['snapshot_boundary',mode,c.observed,formal.code]);basis='snapshot_boundary';
   all=observedRows.filter(r=>Array.isArray(mapping?.[r.thscode])&&mapping[r.thscode].includes(formal.name));
   if(complete){
    // Complete membership manifest plus independently archived full-sector count
    // is required to interpret missing event-map entries as zero.
    if(num(formal.limit_up_count)!==null&&Number(formal.limit_up_count)===all.length)status='complete';}
  }
  // The archived count includes ST. Check all stocks before applying non-ST scope.
  if(status==='complete'&&num(formal.limit_up_count)!==null&&Number(formal.limit_up_count)!==all.length)status='unknown';
  result.set(formal.code,{up:status==='complete'?all.filter(r=>!r.is_st).length:null,known:Array.isArray(rows)?all.filter(r=>!r.is_st).length:null,status,signature:status==='complete'?signature:null,basis});
 }
 return result;
}
function isNewActivity(model,theme,end,days){
 const i=typeof end==='string'?model.dates.indexOf(end):end;
 if(!Number.isInteger(i)||!Number.isInteger(days)||days<1||i<0||i>=model.dates.length)return null;
 if(theme.daily_event_quality?.[i]!=='complete'||num(theme.daily_event_up?.[i])===null)return null;
 if(theme.daily_event_up[i]===0)return false;
 if(i<days)return null;
 const signature=theme.membership_signature?.[i];if(!signature)return null;
 for(let j=i-days;j<=i;j++)if(theme.daily_event_quality?.[j]!=='complete'||num(theme.daily_event_up?.[j])===null||theme.membership_signature?.[j]!==signature)return null;
 return theme.daily_event_up.slice(i-days,i).every(n=>n===0);
}
// Latest confirmed start inside a recent window; later unknown windows stay explicit.
function recentActivity(model,theme,end,recentDays=3,quietDays=5){
 const i=typeof end==='string'?model.dates.indexOf(end):end;
 const base={recentDays,quietDays,date:null,index:null,count:null,later_unknown_dates:[]};
 if(!Number.isInteger(i)||i<0||i>=model.dates.length||!Number.isInteger(recentDays)||recentDays<1||!Number.isInteger(quietDays)||quietDays<1)return {...base,status:'unknown',reason:'invalid_window'};
 const start=Math.max(0,i-recentDays+1),unknown=[];
 for(let candidate=i;candidate>=start;candidate--){
  const result=isNewActivity(model,theme,candidate,quietDays);
  if(result===true)return {...base,status:'match',date:model.dates[candidate],index:candidate,count:theme.daily_event_up[candidate],later_unknown_dates:unknown};
  if(result===null)unknown.push(model.dates[candidate]);
 }
 return {...base,status:unknown.length||i+1<recentDays?'unknown':'none',later_unknown_dates:unknown,...(i+1<recentDays?{reason:'insufficient_recent_history'}:{})};
}

function build(input,options={}){
 const snapshots=[...new Map((input||[]).filter(s=>s?.date).map(s=>[s.date,s])).values()].sort((a,b)=>a.date.localeCompare(b.date));
 const dates=snapshots.map(s=>s.date),themes=new Map(),prices=[],ups=[],downs=[],valid=[],names=new Map(),quality=[],eventDays=[],rosterIds=new Map();
 for(const s of snapshots){
  let c=concepts(s);let mapping=s.event_sector_map;
  const back=s.quality_manifest?.sector_backcast,index=options.memberIndexes?.[back?.membership_observed_date];
  if(!c&&['complete','partial'].includes(back?.status)&&back.membership_mode==='backcast_current'&&index?.status==='complete'&&index.observed_date===back.membership_observed_date){
   const byName=new Map();mapping={};for(const r of s.sectors||[]){if(r.tag!=='cn_concept'||r.date!==s.date||!r.code||excluded.has(r.name)||r.membership_observed_date!==index.observed_date||r.membership_mode!=='backcast_current'||!index.members?.[r.code])continue;byName.set(r.name,r);for(const code of Object.keys(index.members[r.code]))(mapping[code]??=[]).push(r.name);}
   if(byName.size)c={byName,observed:index.observed_date,mode:'backcast_current'};
  }
  eventDays.push(eventStats(s,c,mapping,options,rosterIds));
  const date=s.date,p=new Map(),up=new Map(),down=new Set();
  valid.push(c?new Set([...c.byName.values()].map(r=>r.code)):new Set());
  quality.push({up:pool(s,'stock_list'),down:pool(s,'limit_down_events'),membership:c?(c.mode==='backcast_current'?'backcast_current':'complete'):'unknown',membership_observed_date:c?.observed||null});
  if(String(s.quality_manifest?.sector_focus_stocks?.collected_at||'').slice(0,10)===date)
   for(const r of s.sector_focus_stocks||[])if(r.trade_date===date&&r.stock_code&&num(r.pct)!==null)p.set(r.stock_code,[num(r.pct),'f']);
  for(const key of ['limit_break_events','limit_down_events','stock_list'])for(const r of s[key]||[]){
   const code=r.thscode;if(!code||(r.date&&r.date!==date))continue;
   if(num(r.price_change_ratio_pct)!==null)p.set(code,[num(r.price_change_ratio_pct),'e']);
   if(key==='limit_down_events'){
    down.add(code);names.set(code,r.name||code);
    if(!r.is_st&&c&&Array.isArray(mapping?.[code]))for(const name of mapping[code]){const formal=c.byName.get(name);if(!formal)continue;if(!themes.has(formal.code))themes.set(formal.code,{code:formal.code,name:formal.name,members:new Map(),down_members:new Map()});const theme=themes.get(formal.code);if(!theme.down_members.has(code))theme.down_members.set(code,{code,since:date,membership_observed_date:c.observed,membership_mode:c.mode||'historical',down_dates:[]});theme.down_members.get(code).down_dates.push(date);}
   }
   if(key!=='stock_list')continue;
   up.set(code,num(r.boards)||num(r.continue_day_cnt)||1);names.set(code,r.name||code);
   if(r.is_st||!c||!Array.isArray(mapping[code]))continue;
   for(const name of mapping[code]){
    const formal=c.byName.get(name);if(!formal)continue;
    if(!themes.has(formal.code))themes.set(formal.code,{code:formal.code,name:formal.name,members:new Map(),down_members:new Map()});
    const theme=themes.get(formal.code);theme.name=formal.name;
    if(!theme.members.has(code))theme.members.set(code,{code,since:date,membership_observed_date:c.observed,membership_mode:c.mode||'historical',admission_reason:r.reason||r.limit_up_reason||null,concept_name_at_admission:formal.name});
   }
  }
  prices.push(p);ups.push(up);downs.push(down);
 }
 const stocks=Object.create(null),out=[];
 for(const theme of themes.values()){
  const members=[...theme.members.values()];
  const downMembers=[...theme.down_members.values()];
  for(const m of [...members,...downMembers])if(!stocks[m.code])stocks[m.code]={name:names.get(m.code)||m.code,daily:dates.map((d,i)=>[prices[i].get(m.code)?.[0]??null,ups[i].get(m.code)??(quality[i].up==='complete'?0:null),downs[i].has(m.code)?true:quality[i].down==='complete'?false:null,prices[i].get(m.code)?.[1]??null])};
  out.push({code:theme.code,name:theme.name,members,down_members:downMembers,daily_sector_pct:snapshots.map(s=>{const r=(s.sectors||[]).find(r=>r.code===theme.code&&r.tag==='cn_concept'&&r.date===s.date);return num(r?.pct);}),daily_sector_turnover_yuan:snapshots.map(s=>{const r=(s.sectors||[]).find(r=>r.code===theme.code&&r.tag==='cn_concept'&&r.date===s.date);return num(r?.turnover);}),daily_event_up_known:eventDays.map(d=>d.get(theme.code)?.known??null),event_scope:'full_concept_non_st',daily_event_up:eventDays.map(d=>d.get(theme.code)?.up??null),daily_event_quality:eventDays.map(d=>d.get(theme.code)?.status||'unknown'),membership_signature:eventDays.map(d=>d.get(theme.code)?.signature??null),membership_signature_basis:eventDays.map(d=>d.get(theme.code)?.basis??null),daily:dates.map((d,i)=>{if(!valid[i].has(theme.code))return[null,null,null];const active=members.filter(m=>m.since<=d);return[quality[i].up==='unknown'?null:active.filter(m=>ups[i].has(m.code)).length,quality[i].down==='unknown'?null:downMembers.filter(m=>m.down_dates.includes(d)).length,active.length];})});
 }
 const model={schema_version:1,dates,quality,stocks,themes:out,price_sources:{e:'当日事件源涨跌幅',f:'同日采集的板块个股行情源涨跌幅',r:'东方财富转载交易所融资融券归档ZDF涨跌幅'},sector_metric_units:{daily_sector_pct:'%',daily_sector_turnover_yuan:'CNY'},scope:'按当时概念归属或明确标记的现有成分回看纳入真实涨停记录；不是涨停原因归因。跌停仅使用该日有效映射。',methodology:{admission:'历史归属使用当日有效成分映射；backcast_current按归档标注日期的完整成分索引回看，非历史当日归属；首次纳入由真实当日事件确定。',daily:'[涨跌幅%, 连板数, 是否跌停, 来源短码]；null未知。',count:'题材全概念非ST涨停使用daily_event_up；跌停使用当日有效归属；不以滚动观察池代替全题材统计。',end:'首次按题材内涨停纳入；随后按股票自身滚动60交易日涨停留存，完整无涨停移出，缺档待核验；原始历史不删除。'}};
 coverage(model);return model;
}
// Rolling membership is derived from dated qualifying events, never the UI range.
function membersAt(model,theme,end,window=60){
 const i=typeof end==='string'?model.dates.indexOf(end):end;
 if(!Number.isInteger(i)||i<0||i>=model.dates.length||!Number.isInteger(window)||window<1)return [];
 const day=model.dates[i],startIndex=Math.max(0,i-window+1),start=model.dates[startIndex];
 const result=[];
 for(const original of theme.members||[]){
  if(!original.since||original.since>day)continue;
  const code=original.code,daily=model.stocks?.[code]?.daily||[];
  let complete=true,firstUp=null,lastUp=null;
  // Admission must precede any retention/sorting evidence for this theme.
  for(let j=startIndex;j<=i;j++){
   if(model.dates[j]<original.since)continue;
   const boards=num(daily[j]?.[1]);
   if(boards===null)complete=false;
   else if(boards>0){if(firstUp===null)firstUp=model.dates[j];lastUp=model.dates[j];}
  }
  if(firstUp===null&&complete)continue;
  result.push({...original,window_first_up:firstUp,window_first_limit_up:firstUp,last_qualifying_limit_up:lastUp,eligibility:firstUp!==null?'confirmed':'unknown',retention_status:firstUp!==null?'within_window':'pending_verification',window_start:start,window_end:day});
 }
 return result;
}
function addRisk(model,record,{recompute=true}={}){
 const stock=model?.stocks?.[record?.code];if(!stock)return false;
 const index=new Map(model.dates.map((d,i)=>[d,i]));let changed=false;
 for(const o of record.observations||[]){const i=index.get(o.date);if(i===undefined||num(stock.daily[i][0])!==null)continue;
  const check=(o.checks||[]).find(x=>x.id==='daily_change'&&x.unit==='%'&&num(x.value)!==null);
  if(check){stock.daily[i][0]=num(check.value);stock.daily[i][3]='r';changed=true;}}
 if(changed&&recompute)coverage(model);return changed;
}
root.MarketScopeThemeModel={build,addRisk,refreshCoverage:coverage,isNewActivity,membersAt,recentActivity};
})(globalThis);

/* Existing public archives only. Historical membership and explicitly labeled current-cohort backcasts stay distinct. */
(function(root){
'use strict';
const excluded=new Set(['沪股通','深股通','融资融券','转融券','融资标的','融券标的']);
const num=v=>v==null||v===''||typeof v==='boolean'||!Number.isFinite(Number(v))?null:Number(v);
const pool=(s,key)=>{if(!Array.isArray(s[key]))return 'unknown';if(key==='stock_list')return num(s.limits?.total)!==null&&s[key].length===Number(s.limits.total)?'complete':'partial';return ['complete','partial'].includes(s.quality_manifest?.[key]?.status)?s.quality_manifest[key].status:'partial';};
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
function build(input,options={}){
 const snapshots=[...new Map((input||[]).filter(s=>s?.date).map(s=>[s.date,s])).values()].sort((a,b)=>a.date.localeCompare(b.date));
 const dates=snapshots.map(s=>s.date),themes=new Map(),prices=[],ups=[],downs=[],valid=[],names=new Map(),quality=[];
 for(const s of snapshots){
  let c=concepts(s);let mapping=s.event_sector_map;
  const back=s.quality_manifest?.sector_backcast,index=options.memberIndexes?.[back?.membership_observed_date];
  if(!c&&['complete','partial'].includes(back?.status)&&back.membership_mode==='backcast_current'&&index?.status==='complete'&&index.observed_date===back.membership_observed_date){
   const byName=new Map();mapping={};for(const r of s.sectors||[]){if(r.tag!=='cn_concept'||r.date!==s.date||!r.code||excluded.has(r.name)||r.membership_observed_date!==index.observed_date||r.membership_mode!=='backcast_current'||!index.members?.[r.code])continue;byName.set(r.name,r);for(const code of Object.keys(index.members[r.code]))(mapping[code]??=[]).push(r.name);}
   if(byName.size)c={byName,observed:index.observed_date,mode:'backcast_current'};
  }
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
  out.push({code:theme.code,name:theme.name,members,down_members:downMembers,daily:dates.map((d,i)=>{if(!valid[i].has(theme.code))return[null,null,null];const active=members.filter(m=>m.since<=d);return[quality[i].up==='unknown'?null:active.filter(m=>ups[i].has(m.code)).length,quality[i].down==='unknown'?null:downMembers.filter(m=>m.down_dates.includes(d)).length,active.length];})});
 }
 const model={schema_version:1,dates,quality,stocks,themes:out,price_sources:{e:'当日事件源涨跌幅',f:'同日采集的板块个股行情源涨跌幅',r:'东方财富转载交易所融资融券归档ZDF涨跌幅'},scope:'按当时概念归属或明确标记的现有成分回看纳入真实涨停记录；不是涨停原因归因。跌停仅使用该日有效映射。',methodology:{admission:'历史归属使用当日有效成分映射；backcast_current按归档标注日期的完整成分索引回看，非历史当日归属；首次纳入由真实当日事件确定。',daily:'[涨跌幅%, 连板数, 是否跌停, 来源短码]；null未知。',count:'已纳入跟踪池；partial为至少已观察数。',end:'不自动结束或删除股票。'}};
 coverage(model);return model;
}
function addRisk(model,record){
 const stock=model?.stocks?.[record?.code];if(!stock)return false;
 const index=new Map(model.dates.map((d,i)=>[d,i]));let changed=false;
 for(const o of record.observations||[]){const i=index.get(o.date);if(i===undefined||num(stock.daily[i][0])!==null)continue;
  const check=(o.checks||[]).find(x=>x.id==='daily_change'&&x.unit==='%'&&num(x.value)!==null);
  if(check){stock.daily[i][0]=num(check.value);stock.daily[i][3]='r';changed=true;}}
 if(changed)coverage(model);return changed;
}
root.MarketScopeThemeModel={build,addRisk};
})(globalThis);

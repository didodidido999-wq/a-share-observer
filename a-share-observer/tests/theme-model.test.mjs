import test from 'node:test';
import assert from 'node:assert/strict';
import '../docs/theme-model.js';
const {build,addRisk}=globalThis.MarketScopeThemeModel;
const D='2026-10-28',E='2026-10-29';
const row=(code='A')=>({thscode:code,name:code,boards:1,reason:'随意+词语'});
function snap(date,rows=[row()],map={A:['人工智能']}){return{date,stock_list:rows,limits:{total:rows.length},limit_down_events:[],event_sector_map:map,sectors:[{date,code:'C',name:'人工智能',tag:'cn_concept',membership_observed_date:D}],quality_manifest:{sector_members:{status:'complete',membership_observed_date:D,source:'weekly-member-snapshot:'+D},limit_down_events:{status:'complete'}}};}
test('formal mapping only, no reason split or future membership',()=>{
 const m=build([snap('2026-06-10'),snap(D),snap(E,[],{})]);
 assert.deepEqual(m.themes.map(t=>t.name),['人工智能']);assert.equal(m.themes[0].code,'C');assert.equal(m.themes[0].members[0].since,D);
 assert.deepEqual(m.themes[0].daily[0],[null,null,null]);assert.deepEqual(m.themes[0].daily[2],[0,0,1]);assert.equal(m.coverage.membership_days,2);
});
test('missing body, map or backcast are unknown not zeros',()=>{
 const a=snap(E);a.quality_manifest.sector_members.source='backcast_current';
 const m=build([snap(D),a,{date:'2026-10-30'}]);assert.deepEqual(m.themes[0].daily.slice(1),[[null,null,null],[null,null,null]]);
 const b=snap(D);delete b.event_sector_map;assert.equal(build([b]).themes.length,0);
});
test('eligibility tags and industry not admitted',()=>{
 const a=snap(D);a.sectors[0].name='沪股通';a.event_sector_map.A=['沪股通'];assert.equal(build([a]).themes.length,0);
 a.sectors[0].name='人工智能';a.sectors[0].tag='industry';a.event_sector_map.A=['人工智能'];assert.equal(build([a]).themes.length,0);
});
test('event percentages win; historical focus and computed feedback excluded',()=>{
 const a=snap(D);a.sector_focus_stocks=[{trade_date:D,stock_code:'A',pct:3}];a.quality_manifest.sector_focus_stocks={collected_at:E+'T18:00:00+08:00'};
 a.next_day_feedback={date:D,limit_up:{samples:[{code:'A',close_pct:4}]}};
 assert.equal(build([a]).stocks.A.daily[0][0],null);
 a.quality_manifest.sector_focus_stocks.collected_at=D+'T18:00:00+08:00';assert.deepEqual(build([a]).stocks.A.daily[0],[3,1,false,'f']);
 a.stock_list[0].price_change_ratio_pct=10;assert.deepEqual(build([a]).stocks.A.daily[0],[10,1,false,'e']);
});
test('risk fills only matching date missing pct and recomputes coverage',()=>{
 const a=snap(D);a.stock_list[0].price_change_ratio_pct=10;const m=build([a,snap(E,[],{})]);
 assert.equal(addRisk(m,{code:'A',observations:[{date:D,checks:[{id:'daily_change',unit:'%',value:99}]},{date:E,checks:[{id:'daily_change',unit:'%',value:0}]}]}),true);
 assert.equal(m.stocks.A.daily[0][0],10);assert.deepEqual(m.stocks.A.daily[1],[0,0,false,'r']);assert.equal(m.coverage.price_stock_days,2);
 assert.equal(addRisk(m,{code:'X',observations:[]}),false);
});
test('partial pools retain lower bound and disappeared names retained',()=>{
 const a=snap(E,[],{});a.quality_manifest.limit_down_events.status='partial';const m=build([snap(D),a]);assert.equal(m.quality[1].down,'partial');assert.deepEqual(m.themes[0].daily[1],[0,0,1]);assert.equal(m.stocks.A.daily[1][2],null);
});

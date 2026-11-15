import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../docs/market-overview.js',import.meta.url),'utf8');
const ctx={};vm.createContext(ctx);vm.runInContext(code,ctx);const u=ctx.MarketScopeOverviewUtils;
test('breadth requires all three nonnegative integer states and verified denominator',()=>{
 assert.equal(u.breadth({up:1,down:1}),null);
 assert.equal(u.breadth({up:1,down:1,flat:null}),null);
 assert.equal(u.breadth({up:1,down:1,flat:0,return_samples:3}),null);
 assert.equal(u.breadth({up:true,down:1,flat:0}),null);
 assert.equal(u.breadth({up:0,down:0,flat:0}),null);
 assert.equal(u.breadth({up:1,down:1,flat:2,return_samples:4}).share,25);
 assert.equal(u.breadth({up:0,down:1,flat:0}).share,0);
});
test('missing turnover is not zero and negative values cannot create trend',()=>{
 assert.equal(u.turnover({turnover_100m:null}),null);
 assert.equal(u.turnover({turnover_100m:-1}),null);
 assert.equal(u.turnover({turnover_100m:0}),0);
 assert.equal(u.difference(100,null),null);
 assert.equal(u.difference(100,150),-50);
});
test('event pool completeness must be explicit and same dated',()=>{
 const s={limit_break_events:[],quality_manifest:{limit_break_events:{status:'complete',trade_date:'2026-11-13',items_count:0}}};
 assert.equal(u.eventPool(s,'limit_break_events','2026-11-13').complete,true);
 assert.equal(u.eventPool(s,'limit_break_events','2026-11-12').value,null);
 s.quality_manifest.limit_break_events.status='partial';assert.equal(u.eventPool(s,'limit_break_events','2026-11-13').complete,false);
 assert.equal(u.eventPool({limit_break_events:[]},'limit_break_events','2026-11-13').complete,false);
});
test('trend never leaks later dates, fills null gaps or mismatched archive dates',()=>{
 const s=new Map([['2026-11-11',{market:{turnover_100m:100}}],['2026-11-12',{date:'2026-11-11',market:{turnover_100m:200}}],['2026-11-13',{market:{turnover_100m:300}}]]);
 const t=u.trend(s,['2026-11-11','2026-11-12','2026-11-13'],'2026-11-12');
 assert.equal(JSON.stringify(t),JSON.stringify({dates:['2026-11-11','2026-11-12'],values:[100,null]}));
});
test('overview retains detail controls and strict breadth shared with old plots',()=>{
 const html=fs.readFileSync(new URL('../docs/index.html',import.meta.url),'utf8'),app=fs.readFileSync(new URL('../docs/v3.js',import.meta.url),'utf8');
 for(const id of ['market-overview','kpi-grid','index-chart','liquidity-chart','macro-risk-panel'])assert.ok(html.includes('id="'+id+'"'));
 assert.ok(html.includes('src="market-overview.js?'));assert.match(app,/MarketScopeOverview\?\.render/);
 assert.equal(app.includes('a.flat||0'),false);assert.equal(app.includes('curr.flat||0'),false);
});

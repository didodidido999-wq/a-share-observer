import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';const sandbox={};vm.runInNewContext(fs.readFileSync(new URL('../docs/global-context.js',import.meta.url),'utf8'),sandbox);const u=sandbox.GlobalContextUtils;
test('US Treasury including mislabeled spread excludes same China date',()=>{for(const id of ['ust_10y','ust_10y2y'])assert.deepEqual(Array.from(u.rowsBefore({asset_id:id,market_timezone:'Asia/Shanghai',rows:[{date:'2026-11-12',value:1},{date:'2026-11-13',value:9}]},'2026-11-13'),r=>r.value),[1]);});
test('domestic proxies use own dates including non-equity dates but never future',()=>{assert.deepEqual(Array.from(u.rowsBefore({asset_id:'gold_etf',rows:[{date:'2026-10-10',value:1},{date:'2026-10-12',value:2},{date:'2026-10-13',value:3}]},'2026-10-12','2026-10-10'),r=>r.date),['2026-10-10','2026-10-12']);});
test('yield curve requires common date instead of latest mismatched dates',()=>{const assets=[{asset_id:'ust_2y',rows:[{date:'2026-11-11',value:2},{date:'2026-11-12',value:3}]},{asset_id:'ust_10y',rows:[{date:'2026-11-11',value:4}]}];assert.equal(u.sharedDate(assets,'2026-11-13'),'2026-11-11');});
test('normalization uses shared base, never zero or future',()=>{const assets=[{rows:[{date:'2026-11-11',value:0},{date:'2026-11-12',value:2}]},{rows:[{date:'2026-11-12',value:4}]}];assert.equal(u.commonBase(assets,'2026-11-13'),'2026-11-12');assert.deepEqual(Array.from(u.normalized([{date:'a',value:2},{date:'b',value:null},{date:'c',value:3}],'a'),r=>r.value),[100,null,150]);assert.equal(u.normalized([{date:'a',value:0}],'a')[0].value,null);});

test('EIA spot uses prior China date despite null observation timezone',()=>{for(const id of ['wti_spot','brent_spot'])assert.deepEqual(Array.from(u.rowsBefore({asset_id:id,market_timezone:null,publication_timezone:'America/New_York',rows:[{date:'2026-11-11',value:89.62},{date:'2026-11-12',value:90}]},'2026-11-12'),r=>r.value),[89.62]);});
test('explicit cross-border policy excludes same China date regardless of timezone',()=>{assert.equal(u.rowsBefore({cross_border_date_policy:'previous_date',market_timezone:'Europe/London',rows:[{date:'2026-11-13',value:2}]},'2026-11-13').length,0);});

test('all commodity spot series conservatively exclude same-date observations',()=>{assert.equal(u.rowsBefore({kind:'commodity_spot',market_timezone:null,rows:[{date:'2026-11-13',value:1}]},'2026-11-13').length,0);});


test('Brent spot is the only active oil series, labeled explicitly as a trend proxy',()=>{
 const oil=u.singleCatalog.filter(x=>/原油|油气/.test(x.label));
 assert.equal(oil.length,1);assert.equal(oil[0].id,'brent_spot');assert.equal(oil[0].kind,'series');assert.match(oil[0].label,/走势参考/);
 assert.deepEqual(Array.from(u.groups.brent_proxy.ids),['brent_spot']);
 assert.match(u.groups.brent_proxy.note,/不是 ICE 期货报价/);
 for(const id of ['ice_brent_futures','wti_spot','sc_crude_continuous','china_oil_gas_equities','us_oil_gas_equities']){
  assert.ok(u.retiredQueries[id]);assert.equal(u.gapSources[id],undefined);
 }
 assert.equal(u.groups.ice_brent,undefined);assert.equal(u.groups.sc,undefined);assert.equal(u.groups.crude_spot,undefined);
});

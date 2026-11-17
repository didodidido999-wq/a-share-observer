import test from 'node:test';import assert from 'node:assert/strict';import '../docs/theme-model.js';
const {recentActivity}=globalThis.MarketScopeThemeModel;
function fixture(values){const dates=values.map((_,i)=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10));return[{dates},{daily_event_up:values,daily_event_quality:values.map(v=>v===null?'unknown':'complete'),membership_signature:values.map(()=> 'same')}];}
test('finds a confirmed start two days ago even when selected day has no up',()=>{const[m,t]=fixture([0,0,0,0,0,2,0,0]);assert.deepEqual(recentActivity(m,t,7),{status:'match',recentDays:3,quietDays:5,date:m.dates[5],index:5,count:2,later_unknown_dates:[]});});
test('returns latest confirmed start rather than first inside recent window',()=>{const[m,t]=fixture([0,0,1,0,0,2,0]);const r=recentActivity(m,t,6,5,2);assert.equal(r.index,5);assert.equal(r.count,2);});
test('recent window is inclusive of selected date and excludes one day beyond its start',()=>{const[m,t]=fixture([0,0,0,0,0,1,0,0,0]);assert.equal(recentActivity(m,t,7,3,5).status,'match');assert.equal(recentActivity(m,t,8,3,5).status,'none');});
test('historical selection never sees a future start',()=>{const[m,t]=fixture([0,0,0,0,0,2]);assert.equal(recentActivity(m,t,m.dates[4],3,5).status,'none');});
test('partial quiet day or current event day yields unknown rather than zero',()=>{const[m,t]=fixture([0,0,null,0,0,2]);assert.equal(recentActivity(m,t,5,1,5).status,'unknown');t.daily_event_up[5]=null;t.daily_event_quality[5]='unknown';assert.equal(recentActivity(m,t,5,1,5).status,'unknown');});
test('each candidate requires a consistent membership signature',()=>{const[m,t]=fixture([0,0,0,0,0,2]);t.membership_signature[3]='changed';assert.equal(recentActivity(m,t,5,1,5).status,'unknown');});
test('a later unknown does not erase a proven start but remains disclosed',()=>{const[m,t]=fixture([0,0,0,0,0,2,0,null]);const r=recentActivity(m,t,7,3,5);assert.equal(r.status,'match');assert.equal(r.index,5);assert.deepEqual(r.later_unknown_dates,[m.dates[7]]);});
test('insufficient quiet history cannot be called a start',()=>{const[m,t]=fixture([0,2]);assert.equal(recentActivity(m,t,1,3,5).status,'unknown');});
test('invalid parameters are unknown without reading outside date bounds',()=>{const[m,t]=fixture([0,1]);for(const args of [[-1,3,5],[2,3,5],[1,0,5],[1,3,0],['2099-01-01',3,5]])assert.equal(recentActivity(m,t,...args).status,'unknown');});

test('a truncated recent window is unknown rather than claiming no prior start',()=>{const[m,t]=fixture([0]);const r=recentActivity(m,t,0,3,5);assert.equal(r.status,'unknown');assert.equal(r.reason,'insufficient_recent_history');});

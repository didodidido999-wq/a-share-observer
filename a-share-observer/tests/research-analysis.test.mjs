import test from 'node:test';
import assert from 'node:assert/strict';
import '../docs/research-analysis.js';
const u=globalThis.ResearchAnalysisUtils;
test('future records never enter historical selection',()=>{assert.equal(u.visibleForecasts([{issued_at:'2026-11-15T10:00:00Z'}],Date.parse('2026-11-14T10:00:00Z')).length,0);});
test('abstentions not counted as hits, coverage disclosed',()=>{assert.deepEqual(u.metrics([{horizon:5,status:'abstained',correct:null},{horizon:5,status:'evaluated',correct:false},{horizon:1,status:'evaluated',correct:true}]),{mature:2,n:1,hits:0,coverage:.5});});
test('zero sample does not invent accuracy',()=>{assert.equal(u.metrics([]).coverage,null);});

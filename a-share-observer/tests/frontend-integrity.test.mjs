import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../docs');
function fn(file,name){const source=fs.readFileSync(path.join(root,file),'utf8');const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);const end=source.indexOf('\nfunction ',start+1);return source.slice(start,end<0?undefined:end);}
test('sector tooltip keeps partial lower bounds, exact dates, and missing values',()=>{
 const ctx={N:x=>x==null?null:Number(x),SECTOR_META:{limit_down_count:['跌停归属数','只']},heatIsLowerBound:(code,day)=>code==='partial'&&day==='2026-11-13',heatValueText:(v,m,b)=>v==null?'—':(b?'≥':'')+v};vm.createContext(ctx);vm.runInContext(fn('v3.js','heatTooltipText'),ctx);
 const names=new Map([['部分板块','partial'],['完整板块','complete'],['无数据','missing']]);
 const result=ctx.heatTooltipText([{seriesName:'部分板块',dataIndex:1,value:3},{seriesName:'完整板块',dataIndex:1,value:2},{seriesName:'无数据',dataIndex:1,value:null}],['2026-11-12','2026-11-13'],'limit_down_count',names);
 assert.match(result,/^2026-11-13/);assert.match(result,/部分板块: ≥3只（已知下限，数据部分完整）/);assert.match(result,/完整板块: 2只/);assert.match(result,/无数据: —/);
});
function repContext(selected){const els=new Map();function element(){return {value:'',textContent:'',append(){},addEventListener(){},replaceChildren(){}};}const $=id=>{if(!els.has(id))els.set(id,element());return els.get(id);};$('rep-date').value=selected;$('rep-window').value='5';$('rep-style-view').value='line';const calls=[];
 const ctx={num:x=>x==null?null:Number(x),dataset:{economic_styles:['成长'],universe:[{code:'A'}],prices:{A:[{date:'2026-11-12',close:10},{date:'2026-11-13',close:11}]}},$,rows:()=>[],empty:()=>element(),el:()=>element(),groupSummaries:()=>[{name:'成长',median:1,count:1,win:100}],snapshot:()=>({}),pct:x=>x+'%',fmt:String,updateCategory(){},ranking(){},animateScroll(){},host:{chart:(id,options)=>calls.push(['chart',id,options]),noChart:(id,message)=>calls.push(['empty',id,message])}};vm.createContext(ctx);return {ctx,calls};}
test('stale representative line is replaced with explicit last-date empty state',()=>{const {ctx,calls}=repContext('2026-11-14');vm.runInContext(fn('representatives.js','summaries'),ctx);ctx.summaries();assert.equal(calls[0][0],'empty');assert.match(calls[0][2],/所选 2026-11-14 尚无/);assert.match(calls[0][2],/截至 2026-11-13/);assert.equal(calls.filter(c=>c[0]==='chart').length,0);});
test('fresh representative line still renders, repeated date switch clears stale plot',()=>{const {ctx,calls}=repContext('2026-11-13');vm.runInContext(fn('representatives.js','summaries'),ctx);ctx.summaries();assert.equal(calls[0][0],'chart');ctx.$('rep-date').value='2026-11-14';ctx.summaries();assert.equal(calls.at(-1)[0],'empty');ctx.$('rep-date').value='2026-11-13';ctx.summaries();assert.equal(calls.at(-1)[0],'chart');});
test('representative status discloses actual cutoff instead of selected stale date',()=>{const {ctx}=repContext('2026-11-14');ctx.summaries=()=>{};vm.runInContext(fn('representatives.js','redraw'),ctx);ctx.redraw();assert.match(ctx.$('rep-status').textContent,/所选日无行情，已有数据截至 2026-11-13/);});

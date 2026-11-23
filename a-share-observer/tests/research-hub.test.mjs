import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const read=n=>readFileSync(new URL('../docs/'+n,import.meta.url),'utf8');
const html=read('index.html'),js=read('v3.js');
test('every workspace is accessible and existing element IDs remain unique',()=>{
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(ids.length,new Set(ids).size);
 for(const route of ['research','today','capital','macro','policy','sectors','risk','events','history']){assert.ok(html.includes(`data-page="${route}"`));assert.ok(html.includes(`id="${route}" class="page`));}
});
test('capital and macro evidence no longer live in A-share market page',()=>{
 const today=html.slice(html.indexOf('<section id="today"'),html.indexOf('<section id="research"'));
 for(const id of ['funds-observer','domestic-reviewed','macro-risk-panel','global-context'])assert.ok(!today.includes(`id="${id}"`));
 for(const id of ['day-slider','index-chart','market-overview','daily-ledger'])assert.ok(today.includes(`id="${id}"`));
});
test('dated evidence URL encoding, fallback and parsing',()=>{
 const code=js.slice(js.indexOf('const PAGE_NAMES='),js.indexOf('async function navigate('));
 const ctx={URLSearchParams,location:{hash:'#macro?date=2026-11-13&anchor=global-context'}};vm.createContext(ctx);vm.runInContext(code+';globalThis.testFns={routeHash,readRoute};',ctx);
 assert.equal(ctx.testFns.routeHash('today','2026-11-13','market-index-section'),'#today?date=2026-11-13&anchor=market-index-section');
 assert.equal(ctx.testFns.readRoute().page,'macro');assert.equal(ctx.testFns.readRoute().date,'2026-11-13');assert.equal(ctx.testFns.readRoute().anchor,'global-context');
 ctx.location.hash='#unknown';assert.equal(ctx.testFns.readRoute().page,'research');
 ctx.location.hash='';assert.equal(ctx.testFns.readRoute().page,'research');
});
test('async capital sources refresh on their actual route',()=>{
 for(const file of ['capital-workspace.js','funds-observer.js','etf-state.js']){assert.ok(read(file).includes("page"));assert.ok(!/page\s*[!=]+\s*'today'/.test(read(file)));}
});
test('missing exact date rejects navigation and racing loads are guarded',()=>{assert.ok(js.includes('未替换为其他日期'));assert.ok(js.includes('serial!==routeSerial'));assert.ok(js.includes("history.pushState"));assert.ok(js.includes("'popstate'"));});
test('old exact-date route replaces recent days with a trailing consecutive archive window',async()=>{
 const archive=Array.from({length:25},(_,i)=>`2026-01-${String(i+1).padStart(2,'0')}`),elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{classList:{remove(){}},textContent:'',value:''});return elements.get(id);};
 const state={archive,days:archive.slice(-10),detailLoaded:new Set(),selected:archive.at(-1),page:'today'};
 let requested;
 const ctx={URLSearchParams,location:{hash:'#today'},state,$:element,notice(){},stop(){},renderPage(){},setSelectors(){},loadRange:async days=>{requested=[...days];days.forEach(d=>state.detailLoaded.add(d));},history:{pushState(){}},document:{body:{classList:{toggle(){}},dataset:{}},querySelectorAll:()=>[]},window:{scrollTo(){}}};
 vm.createContext(ctx);vm.runInContext(js.slice(js.indexOf('const PAGE_NAMES='),js.indexOf('function nav('))+';globalThis.run=navigate;',ctx);
 assert.equal(await ctx.run({page:'today',date:archive[12]}),true);
 assert.deepEqual(Array.from(state.days),archive.slice(3,13));assert.deepEqual(requested,archive.slice(3,13));
 assert.equal(state.compareBase,archive[3]);assert.equal(state.selected,archive[12]);assert.ok(state.days.every(d=>d<=state.selected));
});
test('restrained site identity preserves the published slogan and shared design tokens',()=>{
 assert.ok(html.includes('看好股，做好人，得好报</p>'));
 const research=html.slice(html.indexOf('<section id="research"'),html.indexOf('<section id="policy"'));assert.ok(research.includes('class="brand-slogan"'));assert.ok(!html.includes('class="brand-statement"'));
 assert.ok(html.includes('aria-label="品牌主张"'));
 assert.equal((html.match(/class="brand-slogan"/g)||[]).length,1);
 const css=read('research-hub.css');for(const token of ['--nav:#172b38','--paper:#f4f6f8','--accent:#286387','--text-muted:#65717c'])assert.ok(css.includes(token));
 assert.ok(css.includes('@media(max-width:360px)'));assert.ok(css.includes('prefers-reduced-motion'));
});

test('market data and charts precede optional replay, with date stepping always available',()=>{
 assert.ok(html.indexOf('id="market-key-strip"')<html.indexOf('id="index-chart"'));
 assert.ok(html.indexOf('id="index-chart"')<html.indexOf('class="market-replay-tools"'));
 assert.ok(html.indexOf('id="prev-day"')<html.indexOf('id="index-chart"'));
 assert.ok(html.includes('历史回放与双日期比较'));
});

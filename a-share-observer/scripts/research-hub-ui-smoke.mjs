/* Evidence routing integration: real local archives, delayed source responses, no market fixtures. */
import {chromium} from 'playwright';
const base=process.env.MARKET_URL||'http://127.0.0.1:8765/';
const dates=await fetch(new URL('data/dates.json',base)).then(r=>r.json()).then(x=>x.dates);
const latest=dates.at(-1),older=dates[Math.min(15,Math.max(0,dates.length-11))];
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const check=(v,m)=>{if(!v)throw Error(m);};
const active=route=>page.waitForFunction(r=>document.querySelector('.page.active')?.id===r,route);
const navigate=args=>page.evaluate(x=>window.MarketScopeNavigate(x),args);
const settled=()=>page.waitForFunction(()=>typeof window.MarketScopeNavigate==='function'&&document.querySelector('#status')?.textContent.includes('行情归档截至'));
const routes=['research','today','capital','macro','policy','sectors','risk','events','history'];
try{
 await page.goto(base,{waitUntil:'domcontentloaded'});await settled();await active('research');
 for(const route of routes){await navigate({page:route,date:latest});await active(route);check(await page.locator(`#navigation [data-page="${route}"]`).evaluate(e=>e.classList.contains('active')),'Navigation highlight mismatch: '+route);}
 await navigate({page:'today',date:latest,anchor:'market-index-section'});await page.waitForFunction(()=>document.querySelector('#market-index-section').classList.contains('evidence-focus'));
 const first=page.url();await navigate({page:'macro',date:latest,anchor:'global-context'});await active('macro');
 await page.goBack();await active('today');check(page.url()===first,'Back failed to restore exact evidence URL');
 await page.goForward();await active('macro');check(page.url().includes('anchor=global-context'),'Forward lost anchor');
 check(await navigate({page:'today',date:older,anchor:'market-overview'}),'Older exact archive navigation rejected');
 check(await page.locator('#selected-day').innerText()===older,'Old date silently replaced');
 check(await page.locator('#event-date').inputValue()===older,'Linked selector stale after exact-date navigation');
 check(await page.locator('#range-end').inputValue()===older,'Old evidence retained a future window endpoint');
 check(await page.locator('#range-start').inputValue()===dates[Math.max(0,dates.indexOf(older)-9)],'Old evidence window is not consecutive trailing archive dates');
 check(await page.locator('#compare-base').inputValue()===await page.locator('#range-start').inputValue(),'Comparison baseline escaped dated window');
 const preserved=page.url();check(!(await navigate({page:'today',date:'1900-01-01',anchor:'market-overview'})),'Invalid date accepted');
 check(page.url()===preserved,'Invalid date changed route');check((await page.locator('#notice').innerText()).includes('未替换为其他日期'),'Invalid archive warning absent');
 // Reload to clear module cache, delay actual policy data, then verify eventual focus.
 await page.route('**/data/policy-context.json',async r=>{const response=await r.fetch();await new Promise(resolve=>setTimeout(resolve,900));await r.fulfill({response});});
 await page.goto(new URL('#policy?date='+latest+'&anchor=policy-calendar',base).href,{waitUntil:'domcontentloaded'});await page.reload({waitUntil:'domcontentloaded'});await settled();await active('policy');
 await page.waitForFunction(()=>document.querySelector('#policy-calendar')?.classList.contains('evidence-focus'));
 check(!(await page.locator('#notice').innerText()).includes('定位尚未取得'),'Delayed source falsely reported missing anchor');
 // A cancelled wait may not scroll or warn on a newer page.
 await page.reload({waitUntil:'domcontentloaded'});await settled();await active('policy');
 await navigate({page:'today',date:latest,anchor:'market-index-section'});await page.waitForFunction(()=>document.querySelector('#market-index-section').classList.contains('evidence-focus'));
 await page.waitForTimeout(1200);await active('today');check(!(await page.locator('#policy-calendar').getAttribute('class'))?.includes('evidence-focus'),'Old delayed navigation focused hidden evidence');
 await page.setViewportSize({width:390,height:844});
 for(const route of routes){await navigate({page:route,date:latest});await active(route);await page.waitForTimeout(200);check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Mobile viewport overflow: '+route);}
 // Editorial first-screen contract: useful evidence, not merely no horizontal overflow.
 const inViewport=selector=>page.locator(selector).evaluateAll(nodes=>nodes.filter(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return b.top>=0&&b.bottom<=innerHeight&&b.width>0&&s.visibility!=='hidden'&&s.display!=='none';}).length);
 for(const [label,viewport] of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]){
  await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:'reduce'});
  if(label==='mobile')await page.waitForFunction(()=>document.querySelector('#sidebar').getBoundingClientRect().right<=1);
  for(const route of ['research','today','policy','risk']){
   await navigate({page:route,date:latest});await active(route);
   if(route==='research')await page.locator('.research-verdict').first().waitFor();
   if(route==='policy')await page.locator('#policy-macro').waitFor();
   if(route==='risk'){await page.locator('#risk-query').fill('601857');await page.locator('#risk-search-form').getByRole('button',{name:'查询',exact:true}).click();await page.locator('#risk-trend-chart').waitFor();}
   await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(250);
   if(route!=='research')check(!(await page.locator('.brand-slogan').isVisible()),'Slogan leaked into '+route);
   if(route==='research'){
    check(await inViewport('.research-verdict')>=1,'Main research verdict missing from first screen '+label);
    check(await inViewport('.research-signal-value')>=(label==='desktop'?3:1),'Actual research evidence values missing from first screen '+label);
   }
   if(route==='today'){
    if(label==='mobile')check(await page.locator('.range-bar input[type=date]').evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().width>=120)),'Mobile date inputs too narrow to read');
    check(await inViewport('.market-key strong')===4,'Four actual market values not visible '+label);
    check(await page.locator('.market-key strong').evaluateAll(nodes=>nodes.every(n=>/\d/.test(n.textContent)&&!n.textContent.includes('—'))),'Market key values are placeholders');
    if(label==='desktop')check(await page.locator('#index-chart').evaluate(e=>e.getBoundingClientRect().top<innerHeight-180),'Index chart below first-screen working area');
   }
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'Viewport overflow: '+route+' '+label);
   await page.screenshot({path:`/tmp/marketscope-${route}-${label}-viewport.png`,fullPage:false,animations:'disabled'});
   await page.screenshot({path:`/tmp/marketscope-${route}-${label}.png`,fullPage:true,animations:'disabled'});
  }
 }
 // Optional replay remains usable, including linked date selection and comparison.
 await navigate({page:'today',date:latest});await page.locator('.market-replay-tools>summary').click();
 await page.locator('#compare-enable').check();check(await page.locator('#compare-base').isEnabled(),'Double-date compare unavailable');
 await page.locator('#compare-enable').uncheck();
 check(!errors.length,errors.join('; '));console.log('Research hub routing, asynchronous anchors and mobile smoke passed.');
}catch(e){console.error(e);await page.screenshot({path:'/tmp/marketscope-research-hub-failed.png',fullPage:true}).catch(()=>{});process.exitCode=1;}finally{await browser.close();}

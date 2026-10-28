/* Browser-level smoke audit of navigation, controls, and visible feedback. */
import { chromium } from 'playwright';
const base=process.env.MARKET_URL||'http://127.0.0.1:8765/';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const failures=[];
page.on('pageerror',err=>failures.push(err.message));
function check(value,message){if(!value)throw new Error(message);}
const visible=async sel=>await page.locator(sel).isVisible();
const click=async sel=>await page.locator(sel).click({timeout:25000});
try{
 await page.goto(base,{waitUntil:'domcontentloaded',timeout:25000});
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('最近有效'),{timeout:25000});
 check(await visible('#today'),'Home should render');
 check(await page.locator('#day-slider').count()===1,'Global timeline missing');
 // Funding KPI arithmetic is tied to the archive trading calendar, never to a sparse quote list.
 await page.waitForSelector('#fund-summary .fund-card-value',{timeout:25000});
 check((await page.locator('#fund-summary .fund-card-value').count())===4,'Funding KPI cards missing');
 const funding=await page.evaluate(async()=>{
   const [margin,dates]=await Promise.all([
     fetch('data/funds-observer.json').then(r=>r.json()),
     fetch('data/dates.json').then(r=>r.json())
   ]);
   const day=dates.dates.at(-1),window=dates.dates.filter(d=>d<=day).slice(-10);
   const byDay=new Map(margin.financing.rows.map(r=>[r.date,r]));
   const rows=window.map(d=>byDay.get(d));
   const complete=window.length===10&&rows.every(r=>r&&typeof r.financing_net_buy_100m==='number'&&Number.isFinite(r.financing_net_buy_100m));
   return {complete,expected:complete?rows.reduce((sum,r)=>sum+r.financing_net_buy_100m,0):null};
 });
 const flowText=await page.locator('#fund-summary .fund-card-value').nth(2).innerText();
 if(!funding.complete)check(flowText.trim()==='—','Missing funding days must not be skipped or filled with zero');
 else check(Math.abs(Number(flowText.replace(/[,亿+]/g,''))-funding.expected)<0.011,
  '10-trading-day net buy total must agree with archived daily flows');
 check((await page.locator('#fund-summary .fund-card-title').nth(2).innerText()).includes('10日净买入'),
  'Funding flow KPI must clearly distinguish cumulative net buys from balance changes');
 await click('#navigation [data-page="sectors"]');
 await page.waitForSelector('#sector-turnover-rank .sector-rank-item',{timeout:30000});
 check(await visible('#sector-heat'),'Heatmap missing');
 await page.locator('#heat-metric').selectOption('turnover');
 await page.waitForFunction(()=>document.querySelector('#sector-turnover-rank')?.textContent?.includes('成交额'),{timeout:15000});
 check((await page.locator('#sector-turnover-rank .sector-rank-item').count())>=5,'Metric cards missing');
 const first=await page.locator('#sector-turnover-rank .sector-rank-item').first().textContent();
 const cardNames=await page.locator('#sector-turnover-rank .sector-rank-item span').allTextContents();
 const lines=await page.evaluate(()=>{
   const c=window.echarts?.getInstanceByDom(document.getElementById('sector-chart'));
   return c?.getOption()?.series?.map(s=>s.name)||[];
 });
 check(JSON.stringify(cardNames)===JSON.stringify(lines),
   'Sector line series must exactly correspond to the metric-ranked cards, in order');
 check(!(await page.locator('#sector-add').count()),'Manual board picker should be removed');
 await page.locator('#sector-sort').selectOption('metric_asc');
 check((await page.locator('#sector-sort option').first().textContent()).includes('成交额'),
   'Sort options must reflect the selected measure');
 await page.locator('#sector-sort').selectOption('metric_desc');
 check(first.includes('亿'),'Turnover cards should show RMB 100m units');
 await page.locator('#heat-metric').selectOption('pct');
 await page.waitForFunction(()=>document.querySelector('.sector-rank-caption')?.textContent?.includes('日涨跌幅'),{timeout:10000});
 check(!(await page.locator('.sector-rank-caption').textContent()).includes('成交额排行'),'Top ten failed to follow metric');
 check((await page.locator('#sector-sort option').first().textContent()).includes('日涨跌幅'),'Metric sort labels did not follow');
 await click('#sector-turnover-rank .sector-rank-item:first-child');
 const firstCard=await page.locator('#sector-turnover-rank .sector-rank-item:first-child span').textContent();
 check((await page.locator('.heat-label-button.is-expanded').first().textContent()).includes(firstCard),
   'Clicking top card must expand matching sector');

 await page.waitForSelector('#sector-inline-detail',{timeout:15000});
 check(await visible('#sector-inline-detail'),'Clicking top-card must reveal inline board detail');
 check((await page.locator('.heat-label-button.is-expanded').count())===1,'Expanded row not highlighted');
 const ds=await page.locator('#sector-date option').count();
 check(ds>=2,'Sector date dropdown not populated');
 const targetDate=await page.locator('#sector-date option').nth(0).getAttribute('value');
 await page.locator('#sector-date').selectOption(targetDate);
 check((await page.locator('#selected-day').textContent()).trim()===targetDate,'Sector date change failed global sync');
 await click('#navigation [data-page="events"]');
 await page.waitForSelector('#event-relay-mode',{timeout:15000});
 await page.locator('#event-relay-mode').selectOption('down');
 check((await page.locator('#event-relay-mode').inputValue())==='down','Down event mode unavailable');
 check((await page.locator('#event-type').inputValue())==='down','Down event pool selector not synchronized');
 await click('#navigation [data-page="history"]');
 await page.waitForSelector('#rep-style-view',{timeout:30000});
 const tagBottom=(await page.locator('#rep-tag-summary').boundingBox())?.y;
 const rankingTop=(await page.locator('#rep-ranking').boundingBox())?.y;
 check(tagBottom!=null&&rankingTop!=null&&tagBottom<rankingTop,'Tag research must precede stock ranking');
 await page.locator('#rep-style-view').selectOption('line');
 check((await page.locator('#rep-style-view').inputValue())==='line','Style line chart missing');
 await page.screenshot({path:'/tmp/marketscope-desktop.png',fullPage:false});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'/tmp/marketscope-mobile.png',fullPage:false});
 await click('#menu-btn');
 await click('#navigation [data-page="today"]');
 check(await visible('#today'),'Mobile route failed');
 // Hash navigation must reflect user-opened links / external page jumps.
 await page.evaluate(()=>{location.hash='#sectors'});
 await page.waitForFunction(()=>document.querySelector('#sectors')?.classList.contains('active'),{timeout:10000});
 check(!failures.length,'Browser JS exceptions: '+failures.join('; '));
 console.log('Browser UX smoke passed: home/sector cards/metric sort/date/inline/events/history/mobile/hash');
}catch(e){
 console.error('Browser UX smoke FAILED:',e);
 if(failures.length)console.error('JS exceptions:',failures);
 await page.screenshot({path:'/tmp/marketscope-failed.png',fullPage:true}).catch(()=>{});
 process.exitCode=1;
}finally{await browser.close();}

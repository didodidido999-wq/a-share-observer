/* Synthetic prices exercise non-oil groups. ICE and retired oil queries must request no price feed. */
import {chromium} from 'playwright';
const base=process.env.MARKET_URL||'http://127.0.0.1:8765/';
const [before,day]=(await fetch(new URL('data/dates.json',base)).then(r=>r.json())).dates.slice(-2);
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const requested=[],errors=[];
let failSpread=true;
page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(/\/data\/global\/(series\/|commodities-status)/.test(r.url()))requested.push(r.url());});
await page.route('**/data/global/series/*.json',r=>{
 const id=r.request().url().split('/').at(-1).replace('.json',''),treasury=id.startsWith('ust_');
 if(id==='ust_10y2y'&&failSpread)return r.fulfill({status:503,body:'synthetic failure'});
 return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({asset_id:id,name:id,symbol:id,kind:id==='ust_10y2y'?'treasury_spread':treasury?'treasury_yield':'listed_etf_proxy',unit:treasury?'%':'CNY',source:'Synthetic fixture only',market_timezone:'Asia/Shanghai',rows:[{date:before,value:2},{date:day,value:999},{date:'2099-01-01',value:9999}]})});
});
const check=(x,m)=>{if(!x)throw Error(m);};
const wait=()=>page.waitForFunction(()=>document.querySelector('#global-status')?.textContent.includes('已读取'));
const option=()=>page.evaluate(()=>window.echarts.getInstanceByDom(document.getElementById('global-context-chart')).getOption());
const oilLink=()=>page.getByRole('link',{name:'查看 ICE 官方布伦特期货行情 ↗'});
try{
 await page.goto(new URL('#macro',base).href,{waitUntil:'domcontentloaded'});
 await oilLink().waitFor();
 check((await oilLink().getAttribute('href'))==='https://www.ice.com/products/219/Brent-Crude-Futures/data','Wrong official ICE destination');
 check(!(await page.locator('#global-values').innerText()).trim(),'ICE displayed unlicensed prices');
 check(!requested.length,'Default ICE query requested data');
 await page.locator('#global-single').selectOption('ice_brent_futures');
 await oilLink().waitFor();
 check(new URL(page.url()).hash.includes('query=ice_brent_futures'),'ICE independent query was not deep-linked');
 check(!requested.length,'Independent ICE query requested data');
 for(const id of ['wti_spot','brent_spot','sc_crude_continuous']){
  await page.goto(new URL('#macro?query='+id+'&anchor=global-context',base).href);
  await page.waitForFunction(()=>document.querySelector('#global-status')?.textContent.includes('已移出'));
  check(!(await page.locator('#global-values').innerText()).trim(),'Retired query displayed a substitute price');
 }
 check(!requested.length,'Retired oil queries fetched prices');
 await page.locator('#global-group').selectOption('curve');await wait();let c=await option();
 check(c.series[0].data.every(x=>x===2)&&c.series[0].name.includes(before),'Treasury did not respect common prior date');
 await page.locator('#global-group').selectOption('spread');
 await page.waitForFunction(()=>document.querySelector('#global-status')?.textContent.includes('读取失败'));
 check(await page.locator('#global-retry').isVisible(),'Failure retry absent');
 failSpread=false;await page.locator('#global-retry').click();await wait();c=await option();
 check(c.yAxis[0].name==='bp'&&c.xAxis[0].data.every(d=>d<day),'Spread unit or date changed');
 await page.locator('#global-group').selectOption('risk');await wait();c=await option();
 check(c.yAxis[0].name==='基准 = 100'&&c.xAxis[0].data.every(d=>d<=day),'Proxy normalization or date changed');
 const proxyCount=await page.locator('#global-assets input').count();
 await page.locator('#global-assets input').first().uncheck();await wait();
 check((await option()).series.length===proxyCount-1,'Asset deselection did not update trend');
 await page.setViewportSize({width:390,height:844});
 await page.locator('#global-group').selectOption('ice_brent');
 await oilLink().waitFor();
 check(await page.locator('#global-context').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Global panel mobile overflow');
 check(!errors.length,errors.join(';'));
 console.log('Global context synthetic browser smoke passed.');
}catch(e){console.error(e);await page.screenshot({path:'/tmp/marketscope-global-failed.png',fullPage:true}).catch(()=>{});process.exitCode=1;}finally{await browser.close();}

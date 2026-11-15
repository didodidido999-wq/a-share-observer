// Release evidence with repository data, never fixture substitutions.
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const base=process.env.MARKET_URL||'http://127.0.0.1:8765/';
try {
 await page.goto(base,{waitUntil:'networkidle'});
 await page.locator('#market-overview').waitFor({state:'visible'});
 await page.screenshot({path:'/tmp/marketscope-market-redesign.png',fullPage:true});
 await page.locator('#navigation [data-page="risk"]').click();
 await page.locator('#risk-query').fill('000001');
 await page.locator('#risk-query').press('Enter');
 await page.getByRole('heading',{name:'平安银行 · 000001.SZ',exact:true}).waitFor();
 const detail=await fetch(new URL('data/risk-stocks/000001.SZ.json',base)).then(r=>r.json());
 const options=await page.locator('#risk-date option').evaluateAll(nodes=>nodes.map(n=>n.value));
 const available=(detail.observations||[]).map(o=>o.date).filter(d=>options.includes(d)).sort().at(-1);
 if(available) await page.locator('#risk-date').selectOption(available);
 await page.locator('#risk-trend-chart').waitFor({state:'visible'});
 await page.screenshot({path:'/tmp/marketscope-risk-redesign.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'/tmp/marketscope-risk-redesign-mobile.png',fullPage:true});
 console.log('Saved real-archive release layout evidence (not synthetic tests).');
} finally {await browser.close();}

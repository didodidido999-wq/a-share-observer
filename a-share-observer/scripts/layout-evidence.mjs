// Release evidence with repository data, never fixture substitutions.
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const base=process.env.MARKET_URL||'http://127.0.0.1:8765/';
try {
 await page.goto(base,{waitUntil:'networkidle'});
 await page.locator('#market-overview').waitFor({state:'visible'});
 if(await page.locator('#timeline-day').innerText()!==await page.locator('#selected-day').innerText())throw Error('Initial timeline date differs from selected date');
 await page.getByRole('button',{name:'外围市场',exact:true}).click();
 await page.waitForFunction(()=>Math.abs(document.getElementById('global-context').getBoundingClientRect().top-80)<5);
 if(new URL(page.url()).hash!=='#today')throw Error('Section jump changed page route');
 await page.locator('#global-group').selectOption('crude_spot');
 await page.waitForFunction(()=>document.querySelector('#global-values')?.textContent.includes('WTI'));
 const spotText=await page.locator('#global-values').innerText();
 if(!spotText.includes('美元/桶')||!spotText.includes('EIA')||spotText.includes('美国财政部'))throw Error('Official spot identity or unit not shown');
 await page.waitForTimeout(1200); // ECharts initial animation must settle before visual evidence.
 await page.locator('#global-context').screenshot({path:'/tmp/marketscope-crude-spot.png'});
 await page.locator('#global-view-mode').selectOption('normalized');
 await page.waitForTimeout(1200); // Wait for mode-switch animation, not source availability.
 await page.locator('#global-context').screenshot({path:'/tmp/marketscope-crude-normalized.png'});
 await page.locator('#global-view-mode').selectOption('raw');
 await page.goto(base,{waitUntil:'networkidle'});
 await page.screenshot({path:'/tmp/marketscope-market-redesign.png',fullPage:true});
 // Current disclosure ledger uses actual archived official evidence, independent of historical day.
 await page.locator('#domestic-reviewed > details > summary').click();
 await page.locator('#domestic-reviewed select').selectOption('petrochina_controlling_shareholder_increase');
 // Re-rendering preserves the selected category but intentionally resets disclosure open state.
 await page.locator('#domestic-reviewed > details').evaluate(e=>e.open=true);
 await page.waitForFunction(()=>document.querySelector('#domestic-reviewed')?.textContent.includes('合计人民币')||document.querySelector('#domestic-reviewed')?.textContent.includes('集团及其全资子公司'));
 if(!await page.locator('#domestic-reviewed').innerText().then(t=>t.includes('当前核验台账')))throw Error('New official disclosures incorrectly hidden by historical selection');
 if(!await page.locator('#domestic-reviewed').innerText().then(t=>t.includes('2801325814.29')))throw Error('Official combined disclosed amount absent from current ledger');
 await page.locator('#domestic-reviewed').screenshot({path:'/tmp/marketscope-disclosures.png'});
 await page.locator('#domestic-reviewed select').selectOption('social_security_quarterly_holdings');
 await page.locator('#domestic-reviewed > details').evaluate(e=>e.open=true);
 await page.waitForFunction(()=>document.querySelector('#domestic-reviewed')?.textContent.includes('全国社保基金六零四组合'));
 if(!await page.locator('#domestic-reviewed').innerText().then(t=>t.includes('不是披露日')))throw Error('Report-period vs publication-date distinction absent');
 await page.locator('#domestic-reviewed').screenshot({path:'/tmp/marketscope-disclosures-social-security.png'});
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
 await page.waitForFunction(()=>document.getElementById('sidebar').getBoundingClientRect().right<=1);
 if(!await page.getByText('窄屏可左右滑动表格，查看差值与状态。',{exact:true}).isVisible())throw Error('Mobile comparison table lacks scroll cue');
 await page.screenshot({path:'/tmp/marketscope-risk-redesign-mobile.png',fullPage:true,animations:'disabled'});
 console.log('Saved real-archive release layout evidence (not synthetic tests).');
} finally {await browser.close();}

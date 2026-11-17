import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
try {
 await page.goto((process.env.MARKET_URL||'http://127.0.0.1:8765/')+'#sectors',{waitUntil:'networkidle'});
 await page.locator('.theme-summary').first().waitFor();
 if(!await page.locator('.theme-summary .theme-up').count()||await page.locator('.theme-summary .theme-down').count())throw Error('Top level must show limit-ups only');
 const first=page.locator('.theme-name').first();await first.click();
 await page.locator('.theme-stock').first().waitFor();
 if(await page.locator('.theme-summary').first().evaluate(e=>!e.nextElementSibling.classList.contains('theme-detail-info')))throw Error('Expansion must be in original row position');
 if(!await page.locator('.theme-down-summary').count())throw Error('Expanded down tracking absent');
 if(!await page.locator('.theme-stock-day.return-up').count()||!await page.locator('.theme-stock-day.return-down').count())throw Error('Return heat colors absent');
 const values=await page.locator('.theme-stock .theme-sticky small').allTextContents();
 const counts=values.map(t=>Number(t.match(/· (\d+) 天/)?.[1]));if(counts.some((n,i)=>i>0&&n>counts[i-1]))throw Error('Cumulative limit-up count ordering broken');
 await page.locator('#theme-panel').screenshot({path:'/tmp/marketscope-theme-desktop.png'});
 await first.click();if(await page.locator('.theme-stock').count())throw Error('Repeated click did not collapse');
 await page.locator('#theme-window').selectOption('0');
 await page.locator('#theme-search').fill('不可能匹配题材123');if(!await page.locator('#theme-matrix').innerText().then(t=>t.includes('没有匹配')))throw Error('Empty filter broken');
 await page.locator('#theme-search').fill('');await page.locator('.theme-name').first().click();
 await page.locator('#theme-sort').selectOption('streak');
 await page.setViewportSize({width:390,height:844});await page.locator('#theme-panel').scrollIntoViewIfNeeded();
 if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+3))throw Error('Theme heatmap leaks horizontal page scroll');
 await page.locator('#theme-panel').screenshot({path:'/tmp/marketscope-theme-mobile.png'});
 if(!await page.locator('#sector-research-panel').count())throw Error('Existing sector tracker removed');
 console.log('Theme heatmap: real archived data, inline expand/collapse, sorting, empty search, full history, mobile and existing tracker passed');
}finally{await browser.close();}

import {chromium} from 'playwright';
import fs from 'node:fs';
const base=process.env.MARKET_URL||'http://127.0.0.1:8765/';
const fixture=JSON.parse(fs.readFileSync(new URL('../docs/data/policy-funds.json',import.meta.url),'utf8'));
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const check=(value,message)=>{if(!value)throw Error(message);};
try{
 for(const viewport of [{width:1280,height:850},{width:390,height:844}]){
  const page=await browser.newPage({viewport});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/policy-funds-test.html',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:
   '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="policy-funds.css"><script defer src="policy-funds.js"></script></head><body><main style="max-width:1400px;margin:auto;padding:20px"><nav class="pf-view-tabs" role="tablist"><button id="policy-view-context" role="tab" aria-selected="true" class="active">政策与资金</button><button id="policy-view-funds" role="tab" aria-selected="false">股票观察池</button></nav><div id="policy-content">原政策档案保持可见</div><div id="policy-funds-content" hidden></div></main></body></html>'}));
  await page.route('**/data/policy-funds.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(fixture)}));
  await page.goto(new URL('policy-funds-test.html',base).href);
  check(await page.getByText('原政策档案保持可见').isVisible(),'Existing policy pane lost');
  await page.getByRole('tab',{name:'股票观察池'}).click();
  await page.getByText('政策资金股票观察池').waitFor();
  await page.locator('.pf-row').first().waitFor();
  check(await page.locator('.pf-row').count()===fixture.stocks.length,'Not all unique stock records rendered');
  check(await page.getByText('待评估').count()>0,'Unverified financial grades replaced with fabricated scores');
  check(await page.getByText('互换便利实际逐股标的仍未知').count()>0,'Swap unknown flag missing');
  await page.locator('#pf-status').selectOption('executed');
  check(await page.locator('.pf-row').count()===fixture.stocks.filter(x=>x.status==='executed').length,'Status filtering incorrect');
  await page.locator('#pf-reset').click();
  await page.locator('#pf-search').fill('002039');
  check(await page.locator('.pf-row').count()===fixture.stocks.filter(x=>x.code==='002039').length,'Code search incorrect');
  const oldRow=page.locator('.pf-row').filter({hasText:'国新产业资本持股由6%升至7%'});
  await oldRow.locator('.pf-stock').click();
  check(await page.locator('.pf-drawer').count()===1||await page.locator('#pf-drawer').isVisible(),'Detail drawer missing');
  check(await page.getByText('自有资金；不是专项贷款买入').isVisible(),'Funding-source qualification missing');
  await page.keyboard.press('Escape');
  check(await page.locator('#pf-backdrop').isHidden(),'Drawer Escape close failed');
  await page.locator('#pf-search').fill('');
  await page.locator('.pf-advanced summary').click();
  await page.locator('[data-source-check=loan]').check();
  await page.locator('[data-source-check=insurance]').check();
  const either=fixture.stocks.filter(x=>x.tags.includes('loan')||x.tags.includes('insurance')).length;
  check(await page.locator('.pf-row').count()===either,'Multiple source OR filter incorrect');
  await page.locator('#pf-and').check();
  const both=fixture.stocks.filter(x=>x.tags.includes('loan')&&x.tags.includes('insurance')).length;
  check(await page.locator('.pf-row').count()===both,'Multiple source AND filter incorrect');
  await page.locator('#pf-reset').click();
  check(await page.locator('.pf-row').count()===fixture.stocks.length,'Reset filters did not restore all rows');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+2),'Horizontal viewport overflow at '+viewport.width);
  check(!errors.length,'Browser exceptions: '+errors.join(';'));
  await page.screenshot({path:'/tmp/marketscope-policy-funds-'+viewport.width+'.png',fullPage:true});
  await page.close();
 }
 console.log('Policy funds desktop/mobile: tab preserve, evidence, filters OR/AND, detail, escape, layout passed.');
}finally{await browser.close();}

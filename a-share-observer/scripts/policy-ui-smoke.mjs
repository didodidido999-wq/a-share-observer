import {chromium} from 'playwright';
import fs from 'node:fs';
const base=process.env.MARKET_URL||'http://127.0.0.1:8765/';
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const check=(v,m)=>{if(!v)throw Error(m);};
const data=JSON.parse(fs.readFileSync(new URL('../docs/data/policy-context.json',import.meta.url),'utf8'));
await page.route('**/data/policy-context.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(data)}));
await page.route('**/policy-test.html',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="policy-context.css"><script defer src="policy-context.js"></script><div id="policy-content"></div>'}));
try{
 await page.goto(new URL('policy-test.html',base).href);await page.waitForFunction(()=>window.MarketScopePolicy);await page.evaluate(()=>{Date.now=()=>Date.parse('2026-11-15T12:00:00Z');window.MarketScopePolicy.render({state:{selected:'2026-11-13'}});});
 await page.getByText('10月物价：消费与生产价格分化',{exact:true}).waitFor();
 check(await page.locator('#nbs-20261116-economy').count()===1,'Verified upcoming release missing');
 check(await page.locator('#nbs-20261130-pmi').count()===0,'7-day filter contains later release');
 await page.getByRole('button',{name:'未来30天',exact:true}).click();await page.locator('#nbs-20261130-pmi').waitFor();
 await page.getByRole('button',{name:'所选日14:45可用档案',exact:true}).click();
 await page.getByText('该时点没有已留存的可用资料。当前新增条目不倒灌历史，不代表当时不存在经济数据。',{exact:true}).waitFor();
 check(await page.locator('#nbs-202610-prices-v1').count()===0,'Later facts leaked into earlier history');
 await page.getByRole('button',{name:'当前已核验资料',exact:true}).click();await page.locator('#ndrc-20261112-fuel-price-v1').waitFor();
 check((await page.locator('#ndrc-20261112-fuel-price-v1').textContent()).includes('生效时刻'),'Policy effective time missing');
 check((await page.locator('#nbs-202610-prices-v1 a').getAttribute('href')).startsWith('https://www.stats.gov.cn/'),'Original source missing');
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Mobile horizontal overflow');check(!errors.length,errors.join(';'));
 console.log('Policy current/history, calendar windows, source link and mobile tests passed.');
}finally{await browser.close();}

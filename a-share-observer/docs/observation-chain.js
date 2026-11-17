/* Read-only observation order, not a validated leading indicator. No foreign proxy substitution. */
(()=>{'use strict';
const companies=[['苹果','AAPL'],['微软','MSFT'],['Alphabet','GOOGL'],['亚马逊','AMZN'],['Meta','META'],['英伟达','NVDA'],['特斯拉','TSLA']];
const sectors=[['881121.TI','半导体'],['886042.TI','存储芯片'],['884229.TI','半导体设备'],['885957.TI','东数西算(算力)']];
function sectorRows(snapshot,day){return sectors.map(([code,name])=>{const s=snapshot?.date===day?(snapshot.sectors||[]).find(s=>s.code===code):null;return {code,name,date:s?.date===day?day:null,pct:s?.date===day&&typeof s.pct==='number'&&Number.isFinite(s.pct)?s.pct:null};});}
const utils={companies,sectors,sectorRows};if(typeof window==='undefined'){globalThis.ObservationChainUtils=utils;return;}
const el=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text??'';if(cls)n.className=cls;return n;};
function link(text,url){const n=el('a',text);n.href=url;if(url.startsWith('https:')){n.target='_blank';n.rel='noopener noreferrer';}return n;}
function card(title,subtitle){const n=el('section',null,'chain-card');n.append(el('h3',title),el('p',subtitle,'chain-muted'));return n;}
function row(label,value){const n=el('div',null,'chain-row');n.append(typeof label==='string'?el('span',label):label,typeof value==='string'?el('span',value):value);return n;}
function render(ctx){const root=document.getElementById('observation-chain');if(!root)return;root.replaceChildren();const day=ctx.state.selected;root.append(el('h2','科技观察链'),el('p','三星 / 海力士 → 费城半导体 → 美股七姐妹 → A股关联板块','chain-route'),el('p','观察顺序，非领先保证｜各市场日期不同','chain-muted')); 
const grid=el('div',null,'chain-grid');
const korea=card('01 · 韩国芯片','韩国普通股 · 行情未接入');korea.append(row(link('三星电子 · 005930','https://www.google.com/finance/quote/005930:KRX'),'—'),row(link('SK海力士 · 000660','https://www.google.com/finance/quote/000660:KRX'),'—'),el('small','点击查看 Google Finance 行情','chain-muted'));
const sox=card('02 · 费城半导体','SOX 原指数 · 公开历史授权待核实');sox.append(row('收盘点位 / 日涨跌幅','未接入'),row('历史曲线 / 区间涨跌','未接入'),link('Nasdaq 历史查询 ↗','https://indexes.nasdaq.com/Index/History/SOX'),link('本站 SOX 独立入口',window.MarketScopeQueryLink('macro','sox',day,'global-context')));
const us=card('03 · 美股七姐妹','个股行情未接入 · 不用纳指代替');const list=el('div',null,'chain-companies');for(const [name,symbol] of companies)list.append(link(name+' · '+symbol,symbol==='GOOGL'?'https://www.google.com/finance/quote/GOOGL:NASDAQ':'https://www.nasdaq.com/market-activity/stocks/'+symbol.toLowerCase()));us.append(list);
const china=card('04 · A股关联板块',day+' · 日涨跌幅');for(const s of sectorRows(ctx.state.snapshots.get(day),day)){const v=el('span',s.pct===null?'未归档':`${s.pct>0?'+':''}${s.pct.toFixed(2)}%`,s.pct>0?'positive':s.pct<0?'negative':'');china.append(row(s.name,v));}china.append(link('查看板块追踪','#sectors?date='+encodeURIComponent(day)));grid.append(korea,sox,us,china);root.append(grid);
const details=el('details');details.append(el('summary','数据口径'),el('p','箭头仅为观察顺序，不表示已证实的领先关系。海外入口是外部查询，不等于本站已归档；未接入的数据不补零、不用ETF代替。外部页面日期与所选中国交易日可能不同。本站A股显示所选交易日收盘归档，不用于证明14:45已知。Alphabet仅列GOOGL，避免重复计算；未计算七股综合指数。','chain-muted'));root.append(details);
}
window.MarketScopeObservationChain={render,utils};})();

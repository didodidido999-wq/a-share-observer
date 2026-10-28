/* Single navigation level for the two distinct capital-evidence workflows. */
(()=>{'use strict';
const tabs=['financing','etf'];
const $=id=>document.getElementById(id);
let active='financing',context=null,bound=false;
function draw(){
 if(!context || context.state.page!=='today')return;
 if(active==='financing'){
  window.MarketScopeFunds?.render(context);
 }else{
  window.MarketScopeEtfShares?.render(context);
  window.MarketScopeFunds?.renderHoldings(context);
 }
 requestAnimationFrame(()=>{
  const id=active==='financing'?'fund-chart':'state-etf-chart';
  context.state.chartMap?.get(id)?.resize();
 });
}
function select(name,focus=false){
 if(!tabs.includes(name))return;
 active=name;
 for(const tab of tabs){
  const selected=tab===name,control=$('capital-tab-'+tab),panel=$('funds-'+tab+'-view');
  control.setAttribute('aria-selected',String(selected));
  control.tabIndex=selected?0:-1;
  control.classList.toggle('active',selected);
  panel.hidden=!selected;
 }
 draw();
 if(focus)$('capital-tab-'+name).focus();
}
function render(ctx){
 context=ctx;
 if(!bound){
  bound=true;
  for(const tab of tabs){
   const control=$('capital-tab-'+tab);
   control.addEventListener('click',()=>select(tab));
   control.addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
    e.preventDefault();
    const i=tabs.indexOf(tab);
    const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:
     (i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    select(tabs[next],true);
   });
  }
 }
 select(active);
}
window.MarketScopeCapital={render};
})();

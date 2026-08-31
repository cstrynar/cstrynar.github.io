const TAYLOR_MASTER_DOC_URL=new URL('master.html',location.href).href.split('?')[0].split('#')[0];
const OLD_MASTER_DOC='https://taylor-5k-planning-portal.vercel.app/master.html';
function isOldMasterTarget(v){if(!v)return false;try{return new URL(String(v),location.href).href.split('?')[0].split('#')[0]===OLD_MASTER_DOC}catch{return String(v).includes('taylor-5k-planning-portal.vercel.app/master.html')}}
function fixMasterDocLinks(root=document){
  root.querySelectorAll?.('a[href]').forEach(a=>{if(isOldMasterTarget(a.getAttribute('href')))a.setAttribute('href',TAYLOR_MASTER_DOC_URL)});
  root.querySelectorAll?.('[data-external]').forEach(el=>{if(isOldMasterTarget(el.dataset.external))el.dataset.external=TAYLOR_MASTER_DOC_URL});
}
document.addEventListener('click',e=>{
  const el=e.target.closest?.('a[href],[data-external]');if(!el)return;
  const target=el.matches('a[href]')?el.getAttribute('href'):el.dataset.external;
  if(!isOldMasterTarget(target))return;
  e.preventDefault();e.stopImmediatePropagation();window.open(TAYLOR_MASTER_DOC_URL,'_blank','noopener');
},true);
new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.nodeType===1)fixMasterDocLinks(n)}).observe(document.documentElement,{subtree:true,childList:true});
queueMicrotask(()=>fixMasterDocLinks());

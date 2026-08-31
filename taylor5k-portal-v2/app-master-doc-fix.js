const TAYLOR_MASTER_DOC_URL=new URL('master.html',location.href).href.split('?')[0].split('#')[0];
const OLD_MASTER_DOC='https://taylor-5k-planning-portal.vercel.app/master.html';
const MASTER_DOC_BUILD='v3.2.3';
function cleanMasterUrl(v){if(!v)return'';try{return new URL(String(v),location.href).href.split('?')[0].split('#')[0]}catch{return String(v)}}
function isOldMasterTarget(v){return cleanMasterUrl(v)===OLD_MASTER_DOC}
function isCurrentMasterTarget(v){return cleanMasterUrl(v)===TAYLOR_MASTER_DOC_URL}
function isAnyMasterTarget(v){return isOldMasterTarget(v)||isCurrentMasterTarget(v)}
function syncLivePortalSession(){
  try{
    const live=(typeof session!=='undefined'&&session?.access_token)?session:null;
    if(!live)return false;
    const key=(typeof SESSION_KEY!=='undefined'&&SESSION_KEY)?SESSION_KEY:'t5k_session';
    localStorage.setItem(key,JSON.stringify(live));
    return true;
  }catch{return false}
}
function applyMasterBuild(root=document){
  try{document.documentElement.style.setProperty('--portal-version','"'+MASTER_DOC_BUILD+'"')}catch{}
  root.querySelectorAll?.('.portal-version').forEach(el=>el.textContent=MASTER_DOC_BUILD);
}
function fixMasterDocLinks(root=document){
  root.querySelectorAll?.('a[href]').forEach(a=>{if(isOldMasterTarget(a.getAttribute('href')))a.setAttribute('href',TAYLOR_MASTER_DOC_URL)});
  root.querySelectorAll?.('[data-external]').forEach(el=>{if(isOldMasterTarget(el.dataset.external))el.dataset.external=TAYLOR_MASTER_DOC_URL});
  applyMasterBuild(root);
}
document.addEventListener('click',e=>{
  const el=e.target.closest?.('a[href],[data-external]');if(!el)return;
  const target=el.matches('a[href]')?el.getAttribute('href'):el.dataset.external;
  if(!isAnyMasterTarget(target))return;
  syncLivePortalSession();
  e.preventDefault();
  e.stopImmediatePropagation();
  window.open(TAYLOR_MASTER_DOC_URL,'_blank','noopener');
},true);
new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes)if(n.nodeType===1)fixMasterDocLinks(n)}).observe(document.documentElement,{subtree:true,childList:true});
queueMicrotask(()=>{syncLivePortalSession();fixMasterDocLinks()});

/* Mercury approved local candidate: P8.1, P8.2 previews, P5.9 read-only view. */
(() => {
  'use strict';
  const el=id=>document.getElementById(id);
  let epoch=0,slug='',eventData=null,verified=null,verifyController=null,supportController=null;
  let sponsorURL='',logoEpoch=0,supportCache=null,copyBusy=false,shareBusy=false;
  const draft={name:'',website:'',alt:'',results:true,print:false};
  const isLocal=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
  const shareActions=['copyEventLink','shareEventLink','previewSign'];
  function feedback(id,msg,bad=false){const n=el(id);n.textContent=msg;n.dataset.error=String(bad);n.style.color=bad?'var(--bad)':'';}
  function setShareEnabled(enabled){for(const id of shareActions)el(id).disabled=!enabled;}
  function qrMarkup(url){const q=qrcode(0,'M');q.addData(url);q.make();return q.createSvgTag({cellSize:4,margin:16,scalable:true,alt:'Event QR code'});}
  function publicURL(value){const u=new URL('../',location.href);u.search='';u.hash='';u.searchParams.set('event',value);return u.href;}
  function stamp(value){if(!value)return 'Unknown';const n=Date.parse(value);return !Number.isFinite(n)||n>Date.now()?'Invalid timestamp':new Date(n).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,' UTC');}
  function safeWebsite(value){if(!value.trim())return '';try{const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
  async function getJSON(path,signal,admin=false){
    if(admin)return req(API+'/'+path,{signal,headers:authHeaders(false)});
    const r=await fetch(API+'/'+path,{cache:'no-store',signal});
    if(!r.ok){const e=new Error('Request failed');e.status=r.status;throw e;}return r.json();
  }
  function timedController(){const c=new AbortController();const timer=setTimeout(()=>c.abort(),10000);return {c,finish:()=>clearTimeout(timer)};}
  function clear(){
    epoch++;slug='';eventData=null;verified=null;supportCache=null;verifyController?.abort();supportController?.abort();logoEpoch++;
    copyBusy=false;shareBusy=false;setShareEnabled(false);el('eventQr').replaceChildren();el('shareLink').value='';el('shareName').textContent='No verified public event';el('shareMeta').textContent='';
    feedback('shareState','Choose an event to verify its public link.');feedback('shareFeedback','');
    el('verifyEventLink').disabled=true;el('refreshSupport').disabled=true;
    for(const id of ['supportEvent','supportSnapshot','supportClients','supportActivity'])el(id).replaceChildren();
    feedback('supportState','Choose an event.');el('supportContext').textContent='Choose an event.';
    Object.assign(draft,{name:'',website:'',alt:'',results:true,print:false});if(sponsorURL)URL.revokeObjectURL(sponsorURL);sponsorURL='';
    for(const id of ['sponsorName','sponsorWebsite','sponsorAlt','sponsorLogo'])el(id).value='';
    el('sponsorResults').checked=true;el('sponsorPrint').checked=false;
    el('sponsorEventName').textContent='Choose an event';el('sponsorEventMeta').textContent='';feedback('sponsorError','');renderSponsor();closePrint();
  }
  async function eventChanged(value,data){
    if(!value||data?.event?.slug!==value)return;
    slug=value;eventData=data;el('verifyEventLink').disabled=false;el('refreshSupport').disabled=false;
    el('sponsorEventName').textContent=data.event.name||value;el('sponsorEventMeta').textContent=[data.event.event_date,data.event.location].filter(Boolean).join(' / ');
    el('supportContext').textContent=data.event.name||value;
    if(document.querySelector('[data-panel="supportPanel"]').getAttribute('aria-pressed')==='true')refreshSupport();
    return verifyPublic();
  }
  async function verifyPublic(){
    const generation=epoch,target=slug;if(!target||!eventData)return;
    verifyController?.abort();const job=timedController();verifyController=job.c;
    verified=null;setShareEnabled(false);el('eventQr').replaceChildren();el('shareLink').value='';el('shareName').textContent='Public event not confirmed';el('shareMeta').textContent='';closePrint();
    feedback('shareFeedback','');feedback('shareState','Checking the public event link...');
    try{
      if(eventData.event.is_public!==true){const e=new Error('This event is private. Share and print are unavailable.');e.publicMessage=e.message;throw e;}
      const list=await getJSON('live-events',job.c.signal);
      if(!Array.isArray(list?.events))throw new Error('Invalid event list');
      if(!list.events.some(e=>e.slug===target)){const e=new Error();e.publicMessage='Event unavailable. This event is not in the public event list.';throw e;}
      const snap=await getJSON('live-results?slug='+encodeURIComponent(target),job.c.signal);
      if(snap?.event?.slug!==target||!Array.isArray(snap.results)){const e=new Error();e.publicMessage='Event unavailable. The public response does not match the selected event.';throw e;}
      if(generation!==epoch||job.c!==verifyController)return;
      const url=publicURL(target);const svg=qrMarkup(url);
      verified={slug:target,url,snapshot:snap};el('shareName').textContent=snap.event.name||target;
      el('shareMeta').textContent=[snap.event.date,snap.event.location].filter(Boolean).join(' / ');
      el('shareLink').value=url;el('eventQr').innerHTML=svg;setShareEnabled(true);
      feedback('shareState',isLocal?'LOCAL REVIEW - link points to this local candidate.':'Public event and returned event identity checked.');
    }catch(e){if(generation===epoch&&job.c===verifyController)feedback('shareState',e.publicMessage||'Unable to check this event. Retry when the public service is reachable.',true);}
    finally{job.finish();}
  }
  function manualCopy(message){el('shareLink').focus();el('shareLink').select();feedback('shareFeedback',message);}
  async function copyLink(){
    if(!verified||copyBusy)return;const generation=epoch,url=verified.url;copyBusy=true;el('copyEventLink').disabled=true;
    try{if(!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(url);if(generation===epoch&&verified?.url===url)feedback('shareFeedback','Link copied.');}
    catch{if(generation===epoch&&verified?.url===url)manualCopy('Select and copy the event link above. Clipboard access was unavailable.');}
    finally{if(generation===epoch){copyBusy=false;el('copyEventLink').disabled=!verified;}}
  }
  async function shareLink(){
    if(!verified||shareBusy)return;
    if(!navigator.share){manualCopy('Sharing is unavailable in this browser. Copy the selected event link.');return;}
    const generation=epoch,v=verified;shareBusy=true;el('shareEventLink').disabled=true;
    try{await navigator.share({title:v.snapshot.event.name||'Mercury race results',url:v.url});if(generation===epoch&&verified===v)feedback('shareFeedback','Share completed.');}
    catch(e){if(generation===epoch&&verified===v){if(e.name==='AbortError')feedback('shareFeedback','Share cancelled. The event link is unchanged.');else manualCopy('Sharing could not open. Copy the selected event link.');}}
    finally{if(generation===epoch){shareBusy=false;el('shareEventLink').disabled=!verified;}}
  }
  function sponsorBlock(forPrint=false){
    if(!draft.name.trim()||!(forPrint?draft.print:draft.results))return null;
    const block=document.createElement('section');block.className='sponsor-block';const label=document.createElement('small');label.textContent=forPrint?'Supported by':'Event sponsor';block.append(label);
    const row=document.createElement('div');row.className='sponsor-identity';block.append(row);
    if(sponsorURL){const img=document.createElement('img');img.src=sponsorURL;img.alt=draft.alt.trim()||draft.name.trim()+' logo';img.onerror=()=>img.remove();row.append(img);}
    const url=safeWebsite(draft.website);const name=document.createElement(url&&!forPrint?'a':'strong');name.textContent=draft.name.trim();
    if(url&&!forPrint){name.href=url;name.target='_blank';name.rel='noopener noreferrer';}
    row.append(name);return block;
  }
  function renderSponsor(){
    const block=sponsorBlock();el('sponsorPlacement').replaceChildren(...(block?[block]:[]));el('sponsorEmpty').hidden=!!block;
  }
  function updateDraft(){
    for(const [field,id] of [['name','sponsorName'],['website','sponsorWebsite'],['alt','sponsorAlt']])draft[field]=el(id).value;
    draft.results=el('sponsorResults').checked;draft.print=el('sponsorPrint').checked;
    const invalid=safeWebsite(draft.website)===null;el('sponsorWebsite').setAttribute('aria-invalid',String(invalid));
    feedback('sponsorError',invalid?'Use a complete http:// or https:// address. This preview is unlinked.':'Preview only. Nothing has been published.',invalid);renderSponsor();closePrint();
  }
  async function logoSelected(){
    const n=++logoEpoch,file=el('sponsorLogo').files[0];if(!file)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024){el('sponsorLogo').value='';feedback('sponsorError','Choose a PNG, JPEG or WebP logo under 2 MB.',true);return;}
    const url=URL.createObjectURL(file),img=new Image();img.src=url;
    try{await img.decode();if(n!==logoEpoch){URL.revokeObjectURL(url);return;}if(img.naturalWidth>8000||img.naturalHeight>8000)throw new Error();
      if(sponsorURL)URL.revokeObjectURL(sponsorURL);sponsorURL=url;updateDraft();
    }catch{URL.revokeObjectURL(url);if(n===logoEpoch)feedback('sponsorError','The logo could not be read. The sponsor name remains available.',true);}
  }
  const dialog=document.createElement('dialog');dialog.id='printDialog';dialog.setAttribute('aria-labelledby','printTitle');
  dialog.innerHTML='<div class="print-controls"><strong id="printTitle">Printable sign preview</strong><label for="paperSize">Paper</label><select id="paperSize"><option value="Letter">Letter</option><option value="A4">A4</option></select><button type="button" class="primary" id="printSign">Print sign</button><button type="button" class="secondary" id="closeSign">Close</button><span id="printFeedback" role="status"></span></div><article id="printSheet" class="sign-sheet"></article>';
  document.body.append(dialog);const pageStyle=document.createElement('style');document.head.append(pageStyle);let printVersion=null;
  function closePrint(){if(dialog.open)dialog.close();printVersion=null;pageStyle.textContent='';document.body.classList.remove('mercury-printing');}
  function drawSign(){
    if(!verified)return;printVersion=verified;const sheet=el('printSheet');sheet.replaceChildren();
    const add=(tag,s,cls)=>{const n=document.createElement(tag);n.textContent=s;if(cls)n.className=cls;sheet.append(n);return n;};
    if(isLocal)add('p','LOCAL REVIEW ONLY - not a race-day sign','local-notice');
    const img=add('img','','sign-logo');img.src=new URL('../assets/mercury-logo.png',location.href).href;img.alt='Mercury Timing Systems';
    add('h1','RACE RESULTS');add('h2',verified.snapshot.event.name||slug);add('p',[verified.snapshot.event.date,verified.snapshot.event.location].filter(Boolean).join(' / '));
    add('p','Scan with your phone camera');const qr=add('div','','sign-qr');qr.innerHTML=qrMarkup(verified.url);add('p',verified.url,'sign-link');
    const sponsor=sponsorBlock(true);if(sponsor)sheet.append(sponsor);add('footer','Mercury Timing Systems','sign-footer');
    const a4=el('paperSize').value==='A4';sheet.style.setProperty('--paper-width',a4?'210mm':'8.5in');sheet.style.setProperty('--paper-height',a4?'297mm':'11in');
    pageStyle.textContent='@page{size:'+(a4?'A4':'Letter')+' portrait;margin:0}';
    el('printSign').disabled=false;feedback('printFeedback','');
  }
  async function printSign(){
    if(!verified||printVersion!==verified){closePrint();return;}
    const v=verified;el('printSign').disabled=true;
    try{
      await Promise.all([...el('printSheet').querySelectorAll('img')].map(i=>i.decode().catch(()=>i.remove())));
      if(v!==verified||!dialog.open)return;
      // Guard exceptionally long display names; final paper fit still needs event-specific review.
      if((v.snapshot.event.name||'').length>180){feedback('printFeedback','Event name is too long for this sign. Shorten the event display name before printing.',true);return;}
      document.body.classList.add('mercury-printing');window.print();
    }catch{feedback('printFeedback','Printing could not open. Retry or use your browser print command while this preview is open.',true);}
    finally{document.body.classList.remove('mercury-printing');el('printSign').disabled=!verified;}
  }
  function dl(id,rows){const target=el(id);target.replaceChildren();for(const [k,v] of rows){const term=document.createElement('dt'),val=document.createElement('dd');term.textContent=k;val.textContent=String(v??'Unknown');target.append(term,val);}}
  function unavailable(id,message){el(id).textContent=message;}
  async function refreshSupport(){
    if(!slug||!eventData)return;const generation=epoch,target=slug;supportController?.abort();const job=timedController();supportController=job.c;
    el('refreshSupport').disabled=true;feedback('supportState','Refreshing read-only observations...');
    const endpoints=[['event','admin-event-settings?slug='+encodeURIComponent(target),true],['snapshot','live-results?slug='+encodeURIComponent(target),false],['clients','admin-event-settings?action=bridge-clients',true],['activity','admin-activity?slug='+encodeURIComponent(target),true]];
    const results=await Promise.allSettled(endpoints.map(([,path,auth])=>getJSON(path,job.c.signal,auth)));job.finish();
    if(generation!==epoch||job.c!==supportController)return;
    const values={};let failed=0;results.forEach((r,i)=>{if(r.status==='fulfilled')values[endpoints[i][0]]=r.value;else failed++;});
    // No stale admin event or credential values masquerade as a fresh observation.
    if(values.event?.event?.slug===target){const e=values.event.event;dl('supportEvent',[['Event status',e.status||'Unknown'],['Public setting',e.is_public===true?'Enabled':e.is_public===false?'Disabled':'Unknown'],['Public verification','Not checked']]);}
    else{unavailable('supportEvent','Event information unavailable.');failed++;}
    const snap=values.snapshot;
    const revisionValid=typeof snap?.revision==='number'&&Number.isSafeInteger(snap.revision)&&snap.revision>=0;
    if(snap?.event?.slug===target&&Array.isArray(snap.results)&&revisionValid&&(!supportCache||snap.revision>=supportCache.revision)){
      supportCache=snap;
      dl('supportSnapshot',[['Feed revision',supportCache.revision],['Finishers',supportCache.results.length],['Data timestamp',stamp(supportCache.updatedAt)]]);
    }else if(supportCache?.event?.slug===target){failed++;dl('supportSnapshot',[['Refresh','Failed - last received data'],['Feed revision',supportCache.revision],['Finishers',supportCache.results.length],['Data timestamp',stamp(supportCache.updatedAt)]]);}
    else{unavailable('supportSnapshot','Public snapshot unavailable.');failed++;}
    const clients=values.clients?.clients;
    if(Array.isArray(clients)&&clients.every(c=>c&&typeof c==='object')){el('supportClients').replaceChildren();if(!clients.length)unavailable('supportClients','No timing credentials returned.');
      for(const c of clients){const block=document.createElement('div');block.className='support-client';const name=document.createElement('strong'),state=document.createElement('p'),last=document.createElement('p');name.textContent=c.name||'Unnamed timing credential';state.textContent=c.active===true?'Credential active':c.active===false?'Credential disabled':'Credential state unknown';last.textContent='Last credential use: '+stamp(c.last_used_at);block.append(name,state,last);el('supportClients').append(block);}
    }else{unavailable('supportClients','Timing credentials unavailable.');failed++;}
    el('supportActivity').replaceChildren();
    if(Array.isArray(values.activity?.activity)&&values.activity.activity.every(a=>a&&typeof a==='object')){
      if(!values.activity.activity.length)el('supportActivity').innerHTML='<tr><td colspan="3">No activity returned for this event.</td></tr>';
      for(const a of values.activity.activity.slice(0,50)){
        // The existing source does not define an action enum. Do not expose arbitrary action/detail strings.
        const tr=document.createElement('tr');for(const value of [stamp(a.created_at),'Event activity','Details omitted in support view']){const td=document.createElement('td');td.textContent=value;tr.append(td);}el('supportActivity').append(tr);
      }
    }else{el('supportActivity').innerHTML='<tr><td colspan="3">Unable to load activity.</td></tr>';failed++;}
    feedback('supportState',(failed?'Some observations could not be refreshed. ':'')+'View captured '+stamp(new Date().toISOString())+(isLocal?' / LOCAL REVIEW':''),failed>0);el('refreshSupport').disabled=false;
  }
  for(const button of document.querySelectorAll('[data-panel]'))button.addEventListener('click',()=>{
    for(const n of document.querySelectorAll('[data-panel]')){const active=n===button;n.setAttribute('aria-pressed',String(active));el(n.dataset.panel).hidden=!active;}
    if(button.dataset.panel==='supportPanel')refreshSupport();
  });
  el('verifyEventLink').onclick=verifyPublic;el('copyEventLink').onclick=copyLink;el('shareEventLink').onclick=shareLink;
  el('previewSign').onclick=()=>{if(verified){drawSign();if(!dialog.open)dialog.showModal();}};
  el('closeSign').onclick=closePrint;el('printSign').onclick=printSign;el('paperSize').onchange=drawSign;
  dialog.addEventListener('cancel',event=>{event.preventDefault();closePrint();});
  dialog.addEventListener('close',()=>{if(!dialog.open){printVersion=null;pageStyle.textContent='';document.body.classList.remove('mercury-printing');}});
  window.addEventListener('beforeprint',()=>{if(dialog.open&&verified&&printVersion===verified)document.body.classList.add('mercury-printing');});
  window.addEventListener('afterprint',()=>document.body.classList.remove('mercury-printing'));
  el('previewSponsor').onclick=updateDraft;el('sponsorLogo').onchange=logoSelected;
  el('removeSponsorLogo').onclick=()=>{logoEpoch++;if(sponsorURL)URL.revokeObjectURL(sponsorURL);sponsorURL='';el('sponsorLogo').value='';updateDraft();};
  el('refreshSupport').onclick=refreshSupport;
  window.MercuryTools={clear,eventChanged};clear();
})();

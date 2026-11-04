(function(root){
 'use strict';
 function model(data,access,now=Date.now(),telemetry=null){
  const e=data.event,closed=['finished','official','archived'].includes(e.status),clients=access.clients||[];
  const permitted=clients.filter(c=>c.active===true&&c.grant?.active===true&&c.grant.can_publish===true);
  const expiry=Date.parse(access.lease?.expires_at),held=Number.isFinite(expiry)&&expiry>now;
  const stamp=value=>{const t=Date.parse(value);return !value?'Not yet reported':!Number.isFinite(t)||t>now+60000?'Timestamp unavailable':new Date(t).toLocaleString()};
  const mapping=data.raceMapping,detected=mapping?.detectedRaces,unmapped=mapping?.unmappedRaces;
  const validRows=rows=>Array.isArray(rows)&&rows.every(r=>r&&typeof r.label==='string'&&r.label.trim()&&Number.isSafeInteger(r.count)&&r.count>0);
  const mappingKnown=validRows(detected)&&detected.length>0&&validRows(unmapped)&&
   new Set(detected.map(r=>r.label)).size===detected.length&&new Set(unmapped.map(r=>r.label)).size===unmapped.length&&
   unmapped.every(r=>detected.some(d=>d.label===r.label&&d.count===r.count));
  const labeledRows=mappingKnown?detected.reduce((sum,r)=>sum+r.count,0):null;
  const countsKnown=mappingKnown&&Number.isSafeInteger(labeledRows);
  const cards=[
   ['Selected event',e.name,e.status+' · '+(e.is_public?'Public':'Private')],
   ['Publishing permission',closed?'Closed to Bridge publishing':permitted.length+' authorized computer'+(permitted.length===1?'':'s'),permitted.map(c=>c.name).join(', ')||'No active publishing grants'],
   ['Writer lease',held?(access.lease.client_name||'Assigned timing computer'):'No active writer lease',held?'Expires '+stamp(access.lease.expires_at)+'. This is a publishing reservation, not proof of current uploads.':access.policy?.require_lease?'An exclusive lease is required to publish.':'This event does not require an exclusive lease.'],
   ['Latest cloud publication',stamp(e.last_published_at),'Saved revision '+Number(e.current_revision||0)+'. An old timestamp does not prove a connection failure.'],
   ['Saved race data',countsKnown?labeledRows.toLocaleString()+' rows with race labels':'Not confirmed',countsKnown?'From saved revision '+Number(e.current_revision||0)+'. Excludes rows without a race label; this is not a finisher or participant total.':'No complete race-count report is available. This does not establish that the event has zero results.'],
   ['Race mappings',countsKnown?(unmapped.length?unmapped.length+' need mapping':detected.length+' recognized'):'Not confirmed',countsKnown?detected.map(r=>r.label+': '+r.count.toLocaleString()+' rows'+(unmapped.some(u=>u.label===r.label)?' — mapping required':' — recognized')).join(' · '):'Mapping readiness cannot be established from the current report.'],
   ['Bridge connection','Not reported','The current cloud interface has no dedicated Bridge heartbeat. A lease or prior computer activity does not establish an online connection.'],
   ['MYLAPS export freshness','Not reported','The cloud cannot currently confirm the age or readability of the local export. Check the Bridge on the timing computer.'],
   ['Waiting / blocked uploads','Not reported','Local queue depth, paused work and rejected uploads are not currently reported to this dashboard. Check the Bridge for these details.']
  ];
  // Reports are observations, never proof that publishing succeeded.
  if(telemetry){
   const valid=r=>r&&typeof r.client_name==='string'&&typeof r.client_id==='string'&&typeof r.session_id==='string'&&
    ['starting','armed','watching','source_wait','upload_delayed','blocked','paused'].includes(r.state)&&
    ['pending','staged','correction'].every(k=>typeof r[k]==='boolean')&&
    (r.source_age_seconds===null||(Number.isSafeInteger(r.source_age_seconds)&&r.source_age_seconds>=0&&r.source_age_seconds<=31536000))&&
    Number.isFinite(Date.parse(r.received_at))&&Date.parse(r.received_at)<=now+5000;
   const rows=Array.isArray(telemetry.reports)?telemetry.reports:[];
   const authorized=new Set(clients.filter(c=>c.active===true&&c.grant?.active===true&&c.grant.can_read===true).map(c=>c.id));
   const usable=rows.filter(r=>valid(r)&&authorized.has(r.client_id));
   const recent=usable.filter(r=>now-Date.parse(r.received_at)<=120000);
   const label=r=>r.client_name+' — '+r.state.replaceAll('_',' ');
   const latest=usable.sort((a,b)=>Date.parse(b.received_at)-Date.parse(a.received_at))[0];
   cards[6]=['Bridge connection',recent.length?recent.length+' recent session report'+(recent.length===1?'':'s'):latest?'Report stale':'Not reported',recent.length?recent.map(label).join(' · ')+'. Received within 2 minutes; this does not confirm uploads. Multiple sessions may include a recently stopped session.':latest?'Last report '+stamp(latest.received_at)+'. Current computer state is unknown.':'No report from a currently authorized computer. Older Bridge versions do not send status.'];
   cards[7]=['MYLAPS export freshness',recent.length?'Reported by Bridge':'Not confirmed',recent.length?recent.map(r=>r.client_name+': '+(r.source_age_seconds===null?'unknown':Math.max(0,Math.floor((now-Date.parse(r.received_at))/1000)+r.source_age_seconds)+' seconds old')+' at latest observation').join(' · ')+'. Age alone does not confirm file readability.':'A fresh Bridge report is required.'];
   cards[8]=['Waiting / blocked uploads',recent.length?recent.some(r=>r.pending||r.staged||r.correction||['blocked','source_wait','upload_delayed'].includes(r.state))?'Attention needed':'No saved work reported':'Not confirmed',recent.length?recent.map(r=>label(r)+': '+[r.pending?'pending request':null,r.staged?'staged snapshot':null,r.correction?'correction review':null].filter(Boolean).join(', ')).join(' · ')+'. These are saved-work flags, not an upload count.':'Local pending work is unknown without a fresh report.'];
  }
  const alerts=[];
  if(closed&&(permitted.length||held))alerts.push('This event is closed, but writer/access remains enabled. Review Timing Computers in Event settings.');
  if(!closed&&!permitted.length)alerts.push('No timing computer has publishing access. Enable the intended computer in Event settings when ready.');
  if(e.status==='live'&&access.policy?.require_lease&&!held)alerts.push('The event is Live but has no active writer lease. Check the intended publishing computer.');
  if(!e.is_public)alerts.push('This event is private; spectators cannot open its results.');
  if(validRows(unmapped)&&unmapped.length)alerts.push('Review MYLAPS race mappings in Event settings: '+unmapped.map(r=>r.label).join(', '));
  else if(!countsKnown)alerts.push('No detected race identities are available from the current cloud snapshot; mapping readiness is not confirmed.');
  if(!alerts.length)alerts.push('No issue found in the cloud status checks shown here. Local Bridge, source and queue health are not verified.');
  return {cards,alerts};
 }
 root.MercuryOperatorModel=model;
 if(typeof module!=='undefined')module.exports=model;
 if(typeof document==='undefined')return;
 const el=id=>document.getElementById(id),panel=el('operatorPanel');let epoch=0,controller=null;
 const visible=()=>!panel.hidden&&!document.hidden&&!!token&&!!currentSlug;
 function clear(){epoch++;controller?.abort();controller=null;el('operatorCards').replaceChildren();el('operatorAlerts').replaceChildren();el('operatorState').textContent='Choose and load an event to check its status.';el('refreshOperator').disabled=false;}
 async function refresh(){
  if(!visible()||loaded?.event?.slug!==currentSlug)return;
  controller?.abort();const job=new AbortController();controller=job;const generation=++epoch,slug=currentSlug,session=token;
  const current=()=>generation===epoch&&slug===currentSlug&&session===token&&visible();
  el('refreshOperator').disabled=true;el('operatorState').textContent='Checking selected event…';
  // Never leave old green/healthy-looking status visible during an uncertain check.
  el('operatorCards').replaceChildren();el('operatorAlerts').replaceChildren();
  const timeout=setTimeout(()=>job.abort(),12000);
  try{
   const read=async path=>{const r=await fetch(API+path,{headers:authHeaders(false),signal:job.signal,cache:'no-store'});if(!r.ok)throw Error('unavailable');return r.json()};
   const [data,access,report]=await Promise.all([read('/admin-event-settings?slug='+encodeURIComponent(slug)),read('/admin-event-settings?action=bridge-access&slug='+encodeURIComponent(slug)),read('/bridge-status?slug='+encodeURIComponent(slug)).catch(()=>null)]);
   if(!current())return;
   if(data?.event?.slug!==slug||access?.event?.slug!==slug||data.event.id!==access.event.id||!Array.isArray(access.clients))throw Error('identity_mismatch');
   if(data.event.status!==access.event.status||data.event.current_revision!==access.event.current_revision)throw Error('status_changed');
   const telemetry=report?.event?.id===data.event.id&&report?.event?.slug===slug?report:null;
   const view=model(data,access,Date.now(),telemetry);
   if(!telemetry){for(const card of view.cards.slice(6)){card[1]='Status unavailable';card[2]='Unable to retrieve Bridge reports. Other cloud checks remain available.'}}
   for(const [label,value,detail] of view.cards){const card=document.createElement('section');card.style.cssText='border:1px solid #ddd;border-radius:8px;padding:14px';const h=document.createElement('h3'),v=document.createElement('p'),p=document.createElement('p');h.textContent=label;v.textContent=value;v.style.fontWeight='700';p.textContent=detail;p.className='hint';card.append(h,v,p);el('operatorCards').append(card)}
   for(const alert of view.alerts){const li=document.createElement('li');li.textContent=alert;el('operatorAlerts').append(li)}
   el('operatorState').textContent='Cloud status checked '+new Date().toLocaleTimeString()+'. These checks do not verify the public results page or the local Bridge.';
  }catch(e){if(current())el('operatorState').textContent=e.message==='status_changed'?'Event changed during the check. Refresh status to check again.':'Unable to verify current status. Check your connection/session, then refresh. No healthy status is assumed.';}
  finally{clearTimeout(timeout);if(generation===epoch){controller=null;el('refreshOperator').disabled=false;}}
 }
 el('refreshOperator').onclick=refresh;
 document.querySelector('[data-panel="operatorPanel"]').addEventListener('click',refresh);
 for(const button of document.querySelectorAll('[data-panel]'))if(button.dataset.panel!=='operatorPanel')button.addEventListener('click',clear);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();else if(visible())refresh()});
 setInterval(()=>{if(visible()&&!controller)refresh()},30000);
 root.MercuryOperator={clear,selected:()=>{clear();if(visible())refresh()}};
})(typeof window==='undefined'?globalThis:window);

(() => {
 const panel=document.querySelector('#eventCloseout');
 function summary(access=null,failed=false){
  const e=loaded?.event;if(!e||e.slug!==currentSlug){clear();return}
  panel.hidden=false;panel.replaceChildren();
  const heading=document.createElement('h2');heading.textContent='Event summary · '+e.name;panel.append(heading);
  const closed=['finished','official','archived'].includes(e.status);
  const lines=[['Status',e.status],['Visibility',e.is_public?'Public':'Private'],['Latest revision',String(e.current_revision||0)],['Last publication',e.last_published_at?new Date(e.last_published_at).toLocaleString():'Not yet published'],['Bridge publishing',closed?'Blocked by event status':'Allowed only with publishing access and the required writer lease']];
  if(access){
   const clients=Array.isArray(access.clients)?access.clients:[];
   const grants=clients.filter(c=>c.active===true&&c.grant?.active!==false&&c.grant?.can_publish===true).length;
   const lease=access.lease,active=!!lease&&Date.parse(lease.expires_at)>Date.now();
   lines.push(['Writer lease',active?(lease.client_name||'Active writer'):'No active writer'],['Enabled publishing access',String(grants)+' timing computer'+(grants===1?'':'s')]);
   lines.push(['Closeout',closed&&!active&&!grants?'Closed · no active writer or publishing access':closed?'Closed · review remaining writer/access below':'Event remains open; use Finished when racing has concluded']);
  }else lines.push(['Writer / access check',failed?'Unavailable — refresh to check':'Checking…']);
  const list=document.createElement('dl');for(const [label,value] of lines){const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=label;detail.textContent=value;list.append(term,detail)}panel.append(list);
  const note=document.createElement('p');note.className='hint';note.textContent='Last publication is a saved timestamp, not a live connection indicator. Archived events stay visible when Public event is enabled. This summary reflects saved settings.';panel.append(note);
  if(e.is_public){const a=document.createElement('a');a.textContent='View public results';a.href='../?event='+encodeURIComponent(e.slug);a.target='_blank';a.rel='noopener';panel.append(a)}
 }
 function clear(){panel.hidden=true;panel.replaceChildren()}
 function list(){
  const host=document.querySelector('#adminHistoryList');host.replaceChildren();
  const table=document.createElement('table');table.className='table';
  const head=document.createElement('thead');head.innerHTML='<tr><th>Event</th><th>Date</th><th>Status</th><th>Visibility</th><th>Last publication</th><th>Open</th></tr>';table.append(head);
  const body=document.createElement('tbody');
  for(const e of [...eventCatalog].sort((a,b)=>String(b.event_date||'').localeCompare(String(a.event_date||''))||String(a.name).localeCompare(String(b.name)))){
   const row=document.createElement('tr');for(const value of [e.name,e.event_date||'No date',e.status,e.is_public?'Public':'Private',e.last_published_at?new Date(e.last_published_at).toLocaleString():'Not published']){const cell=document.createElement('td');cell.textContent=value;row.append(cell)}
   const cell=document.createElement('td'),button=document.createElement('button');button.className='secondary small';button.textContent='Manage';button.onclick=async()=>{if(!token)return;currentSlug=e.slug;eventScope=eventIsCurrent(e)?'current':'past';renderEventList();await loadEvent();await loadClients();panel.scrollIntoView({block:'start'})};cell.append(button);row.append(cell);body.append(row);
  }
  table.append(body);const wrap=document.createElement('div');wrap.style.overflowX='auto';wrap.append(table);host.append(wrap);
  if(!eventCatalog.length)host.textContent='No events available.';
 }
 window.MercuryAdminHistory={summary,clear,list};
})();

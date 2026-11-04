/* Duplicate Event: reviewed server plan, immutable in-flight request, recovery by ID. */
(() => {
 'use strict';
 const el=id=>document.getElementById(id), panel=el('duplicateEventCard');
 const pendingKey='mercuryDuplicatePendingV1';
 let source=null,plan=null,reviewed=null,pending=null,busy=false,dirty=false,step='details',epoch=0,slugTouched=false;
 try{pending=JSON.parse(sessionStorage.getItem(pendingKey)||'null')}catch{sessionStorage.removeItem(pendingKey)}
 function persist(){if(pending)sessionStorage.setItem(pendingKey,JSON.stringify(pending));else sessionStorage.removeItem(pendingKey)}
 function error(message,id){el('dupError').hidden=false;el('dupError').textContent=message;if(id){el(id).setAttribute('aria-invalid','true');el(id).focus()}else el('dupError').scrollIntoView({block:'nearest'})}
 function info(message){el('dupStatus').hidden=!message;el('dupStatus').textContent=message}
 const messages={invalid_logo_path:'The source logo reference needs review. Fix it separately or explicitly turn off branding copying.',duplicate_unavailable:'Mercury could not check this configuration. Your entries are retained; try again after connection recovery.',source_changed:'The source changed since it was reviewed. Cancel this attempt and reload the source before reviewing again.',slug_already_exists:'This identifier is already in use. Choose another; the existing event will not change.',invalid_event_name:'Enter a new event name, different from the source (maximum 180 characters).',invalid_slug:'Use a new identifier with lowercase letters, numbers and single hyphens (maximum 120 characters).',invalid_event_date:'Enter a valid new event date.',invalid_timezone:'Enter a supported IANA timezone.',invalid_awards_configuration:'Source awards need review. Fix the source separately or explicitly turn off awards copying and review clean defaults.',unsupported_special_division:'A special-division definition is unsupported. Fix it separately or explicitly omit awards copying.',invalid_team_configuration:'Source team-scoring rules need review. Fix them separately or explicitly omit this group.',invalid_display_configuration:'Source display preferences need review. Fix them separately or explicitly omit this group.',source_logo_missing:'The source logo is missing. Retry or explicitly turn off branding and review the defaults.',logo_copy_failed:'The independent logo copy could not be verified. No event has been committed. Retry this same request, or cancel it before choosing different options.',unauthorized:'Sign in again, then use Check creation status. Your draft is retained.',creation_outcome_unknown:'The creation outcome is uncertain. Check creation status before retrying. Do not start another duplicate.'};
 function friendly(e){return messages[e.code]||e.message||'The operation could not be completed. Your entries are retained.'}
 async function api(action,data={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  const get=['source','status'].includes(action);
  const url=new URL(API+'/admin-duplicate-event');if(get){url.searchParams.set('action',action);Object.entries(data).forEach(([k,v])=>url.searchParams.set(k,v))}
  try{
   const response=await fetch(url,{method:get?'GET':'POST',cache:'no-store',headers:authHeaders(!get),signal:controller.signal,...(!get?{body:JSON.stringify({action,...data})}:{})});
   const body=await response.json();if(response.status===401){localStorage.removeItem('mercuryAdminSession');token='';showLogin();}if(!response.ok){const e=new Error(messages[body.error]||body.error||'Request failed.');e.code=body.error;e.status=response.status;throw e}return body;
  }finally{clearTimeout(timer)}
 }
 function controls(){
  for(const node of panel.querySelectorAll('input,select,button'))node.disabled=busy;
  // A submitted payload is immutable until its outcome is known or cancelled.
  if(pending)for(const node of panel.querySelectorAll('#dupDetails input,#dupDetails select,#dupDetails button,#dupConfirm'))node.disabled=true;
  el('dupNext').disabled=busy||(step==='review'&&!pending&&!el('dupConfirm').checked);
  el('dupBack').disabled=busy||!!pending;
  el('dupRetry').hidden=!pending;
  el('dupNext').textContent=pending?'Retry same creation':step==='review'?'Create private event':'Review duplicate';
 }
 function mode(value){step=value;el('dupDetails').hidden=value!=='details';el('dupReview').hidden=value!=='review';el('dupSafety').hidden=value==='review';el('dupBack').hidden=value!=='review';el('dupStep1').classList.toggle('active',value==='details');el('dupStep2').classList.toggle('active',value==='review');el('duplicateTitle').textContent=value==='review'?'Review Duplicate Event':'Duplicate Event';controls()}
 function openSurface(){setNewEventMode(true);el('newEventCard').classList.add('hidden');panel.hidden=false;el('dupSource').textContent='Source: '+(source?.event.name||pending?.source_name||'recovering previous request');}
 function closeSurface(){panel.hidden=true;setNewEventMode(false);source=null;plan=null;reviewed=null;dirty=false;epoch++;el('newEventBtn').textContent=pending?'Recover duplicate':'New event'}
 function groups(){return Object.fromEntries([...panel.querySelectorAll('[data-dup-group]')].map(n=>[n.dataset.dupGroup,n.checked]))}
 function races(){return [...el('dupRaceRows').children].map(row=>Object.fromEntries(['source','key','display','start'].map((k,i)=>[['source_label','race_key','display_label','scheduled_start_time'][i],row.querySelector('[data-new-race="'+k+'"]').value.trim()]))) }
 function featured(){const previous=el('dupFeatured').value||source?.featured_race_key;el('dupFeatured').replaceChildren();for(const r of races()){const o=document.createElement('option');o.value=r.race_key;o.textContent=r.display_label||r.race_key||'Complete race fields';el('dupFeatured').append(o)}if([...el('dupFeatured').options].some(o=>o.value===previous))el('dupFeatured').value=previous;}
 function seedRaces(){el('dupRaceRows').replaceChildren();const g=groups();const rows=g.races?source.races:[];for(const r of rows)addNewRaceRow({...r,scheduled_start_time:g.starts?r.scheduled_start_time:''},el('dupRaceRows'));if(!rows.length)addNewRaceRow({},el('dupRaceRows'));featured()}
 function draft(){return {event:{name:el('dupName').value.trim(),slug:el('dupSlug').value.trim(),event_date:el('dupDate').value,location:el('dupLocation').value.trim(),timezone:el('dupZone').value.trim()},groups:groups(),races:races(),featured_race_key:el('dupFeatured').value}}
 function validate(d){
  const n=d.event;const bad=(message,id)=>{error(message,id);return false};
  if(!n.name||n.name===source.event.name||n.name.length>180)return bad(messages.invalid_event_name,'dupName');
  if(!n.event_date||!el('dupDate').validity.valid||new Date(n.event_date+'T00:00:00Z').toISOString().slice(0,10)!==n.event_date)return bad(messages.invalid_event_date,'dupDate');
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n.slug)||n.slug===source.event.slug||n.slug.length>120)return bad(messages.invalid_slug,'dupSlug');
  try{new Intl.DateTimeFormat('en',{timeZone:n.timezone}).format()}catch{return bad(messages.invalid_timezone,'dupZone')}
  if(!d.races.length||d.races.length>20)return bad('Define between 1 and 20 races.');
  const keys=new Set(),labels=new Set();
  for(const [i,r] of d.races.entries()){
   if(!r.source_label||r.source_label.length>160||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.race_key)||r.race_key.length>80||!r.display_label||r.display_label.length>80)return bad('Complete source label, key and public name for race '+(i+1)+'.');
   if(keys.has(r.race_key)||labels.has(r.source_label.toLowerCase()))return bad('Each race needs a unique Mercury key and MYLAPS source label.');keys.add(r.race_key);labels.add(r.source_label.toLowerCase());
  }
  return true;
 }
 function summary(p){
  const identity=el('dupIdentity');identity.replaceChildren();
  for(const [label,value] of [['New event',p.event.name],['New date / timezone',p.event.event_date+' · '+p.settings.timezone],['Unique event identifier',p.event.slug],['Location',p.event.location||'Not set'],['Copied from',p.source_name]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;identity.append(dt,dd)}
  const box=el('dupSummary');box.replaceChildren();const line=(label,text)=>{const p=document.createElement('p'),b=document.createElement('b');b.textContent=label;const span=document.createElement('span');span.textContent=text;p.append(b,document.createElement('br'),span);box.append(p)};
  for(const r of p.races)line(r.display_label,'MYLAPS: '+r.source_label+' · key: '+r.race_key+' · start: '+(r.scheduled_start_time||'TBD'));
  line('Featured podium race',p.settings.featured_race_key);
  const a=p.settings.awards;line((p.groups.awards?'Copied':'Default')+' awards',`Top ${a.overall_places??3} Male + Female; ${a.age_groups.length} age-group division rows; ${a.special_divisions.length} special divisions. Overall winners ${a.remove_overall_from_age_groups?'removed from':'remain eligible for'} age-group awards.`);
  if(a.age_groups.length){const details=document.createElement('details'),title=document.createElement('summary'),text=document.createElement('p');title.textContent='Review all age-group divisions ('+a.age_groups.length+')';text.textContent=a.age_groups.map(g=>`${g.label}: ${g.min}–${g.max===999||g.max===null?'open':g.max} (${g.division})`).join('; ');details.append(title,text);box.append(details);}
  if(a.special_divisions.length)line('Special divisions',a.special_divisions.map(d=>Object.entries(d).map(([k,v])=>k+': '+v).join(', ')).join('; '));
  line((p.groups.branding?'Copied':'Default')+' branding',p.settings.accent_color+(p.logo_source?' · independent event logo copy; review dated artwork':' · no event logo'));
  const fields=Object.keys(p.settings).filter(k=>k.startsWith('show_'));line((p.groups.display?'Copied':'Default')+' results display',fields.map(k=>k.replace('show_','').replaceAll('_',' ')+': '+(p.settings[k]?'on':'off')).join('; ')+`; Recent count: ${p.settings.recent_finishers_default_count}`);
  line('Podium display',(p.settings.podium_mode||'featured')+'; '+(p.settings.podium_configs||[]).map(c=>c.race_key+' / '+c.gender+' / top '+c.places).join('; '));
  line('Course records','Not copied; add or review course records separately for the new edition.');
  const t=p.settings.team_scoring;const divisions={all:'all athletes together',gender:'separate by gender',category:'separate by race / category',gender_category:'separate by gender and race / category'};const ties={ncaa_head_to_head:'head-to-head scorers',nfhs_next_runner:'next runner',aggregate_time:'aggregate scorer time',usatf_last_scorer:'last scoring member'};line((p.groups.team?'Copied':'Default')+' team scoring',`${t.enabled?'Enabled':'Disabled'}; ${t.ruleset||'custom'} rules; minimum ${t.min_complete_teams_to_publish??3} complete teams; ${t.scorers_per_team} scorers and ${t.displacers_per_team} displacers per team; ${divisions[t.division_mode]}; unattached athletes ${t.unattached_mode==='skip_compress'?'skipped, with scoring places compressed':'kept in scoring sequence'}; tie-break: ${ties[t.tiebreaker]}.`);
  if(p.event.event_date<new Intl.DateTimeFormat('en-CA',{timeZone:p.settings.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))line('Past-date warning','This is a past event date. Confirm it is intentional.');
 }
 async function open(sourceSlug){
  if(busy)return;el('dupError').hidden=true;info('');
  if(pending){source=null;openSurface();mode('review');summary(pending.plan);await check();return}
  const selected=eventCatalog.find(e=>e.slug===sourceSlug&&!eventIsCurrent(e));if(!token||!selected)return;source={event:selected};openSurface();el('dupDetails').hidden=true;el('dupReview').hidden=true;info('Loading source configuration…');busy=true;const run=++epoch;controls();
  try{const j=await api('source',{source_slug:sourceSlug});if(run!==epoch||!token){closeSurface();return}if(j.event?.slug!==sourceSlug)throw new Error('Source response does not match the selected event. Refresh and try again.');source=j;info('');openSurface();slugTouched=false;
   el('dupName').value='';el('dupSlug').value='';el('dupDate').value='';el('dupLocation').value=j.event.location||'';el('dupZone').value=j.timezone;
   for(const n of panel.querySelectorAll('[data-dup-group]'))n.checked=n.dataset.dupGroup!=='starts';seedRaces();dirty=false;mode('details');el('dupName').focus();
  }catch(e){closeSurface();showToast(friendly(e),false)}finally{busy=false;controls()}
 }
 async function review(){
  el('dupError').hidden=true;for(const n of panel.querySelectorAll('[aria-invalid]'))n.removeAttribute('aria-invalid');const d=draft();if(!validate(d))return;
  busy=true;controls();info('Checking configuration and identifier…');const run=epoch;
  try{const j=await api('preview',{source_slug:source.event.slug,source_version:source.source_version,draft:d});if(run!==epoch)return;plan=j.plan;reviewed={source_slug:source.event.slug,source_version:j.source_version,draft:d};summary(plan);el('dupConfirm').checked=false;mode('review');info('');el('duplicateTitle').scrollIntoView({block:'start'})}
  catch(e){error(friendly(e));info('')}finally{busy=false;controls()}
 }
 async function complete(result){
  pending=null;persist();closeSurface();showToast('Private event created: '+result.event.name+'. Setup · revision 0 · no timing-computer access.');
  try{await loadEvents();const event=eventCatalog.find(e=>e.slug===result.event.slug);if(event){eventScope=eventIsCurrent(event)?'current':'past';renderEventList();currentSlug=result.event.slug;el('eventSelect').value=currentSlug;await loadEvent();await loadClients();el('adminEventState').hidden=false;el('adminEventState').textContent='New private event · Setup · revision 0 · no timing-computer access. Review configuration before separate activation.'}}
  catch{showToast('Private event was created: '+result.event.slug+'. Refresh the event list to open it.',false)}
 }
 async function check(){
  if(!pending||busy)return;busy=true;controls();info('Checking creation status…');
  try{const result=await api('status',{operation_id:pending.operation_id});if(result.state==='complete'){await complete(result);return}
   if(['cancelled','cleanup_pending'].includes(result.state)){error('This attempt was cancelled or needs logo cleanup. Use Cancel to finish cleanup before starting again.');info('');return}
   info(result.state==='pending'?'No event committed yet. Retry uses the same request and independent logo path.':'No committed operation found. Retry will use the same request ID.');
  }catch(e){error(friendly(e));info('Outcome remains uncertain. Keep this request ID and check again after sign-in or connection recovery.')}finally{busy=false;controls()}
 }
 async function create(){
  if(busy)return;
  if(!pending){if(!el('dupConfirm').checked)return;pending={...reviewed,operation_id:crypto.randomUUID(),plan,source_name:source.event.name};persist()}
  busy=true;controls();info('Creating private event…');el('dupError').hidden=true;
  try{const result=await api('create',pending);if(result.state==='complete')await complete(result);else error('Creation is pending. Check status before continuing.')}
  catch(e){error(friendly(e));info('Entries and request ID retained. Check status before retrying; the source stays unchanged.')}
  finally{busy=false;controls()}
 }
 async function cancel(){
  if(busy)return;if((dirty||pending)&&!confirm(pending?'Reconcile and cancel this duplicate attempt? Any completed event will be opened rather than deleted.':'Discard this unsaved duplicate draft?'))return;
  if(pending){busy=true;controls();try{const result=await api('cancel',{operation_id:pending.operation_id});if(result.state==='complete'){await complete(result);return}if(result.state==='cleanup_pending'){info('Cancellation recorded. A logo copy is still active or needs reconciliation. Keep this request and check status; no event will be created.');return}pending=null;persist()}catch(e){error(friendly(e));info('Cancellation is unconfirmed. Keep this request and try again.');return}finally{busy=false;controls()}}
  closeSurface();
 }
 el('dupNext').onclick=()=>pending?create():step==='details'?review():create();el('dupRetry').onclick=check;el('dupCancel').onclick=cancel;
 el('dupBack').onclick=()=>{if(!pending){mode('details');info('');plan=null;reviewed=null}};el('dupConfirm').onchange=controls;
 el('dupAddRace').onclick=()=>{if(el('dupRaceRows').children.length<20){addNewRaceRow({},el('dupRaceRows'));featured();dirty=true}else error('At most 20 races are supported.')};
 el('dupRaceRows').addEventListener('input',()=>{featured();dirty=true});
 panel.addEventListener('input',e=>{dirty=true;if(e.target.hasAttribute('aria-invalid'))e.target.removeAttribute('aria-invalid');el('dupError').hidden=true});
 el('dupName').addEventListener('input',()=>{if(!slugTouched)el('dupSlug').value=slugify(el('dupName').value)});el('dupSlug').addEventListener('input',()=>{slugTouched=true});
 for(const n of panel.querySelectorAll('[data-dup-group]'))n.addEventListener('change',()=>{if(['races','starts'].includes(n.dataset.dupGroup)){if(dirty&&!confirm('Replace the current race editor rows using this inheritance choice?')){n.checked=!n.checked;return}seedRaces()}});
 window.addEventListener('beforeunload',e=>{if(!panel.hidden&&(dirty||pending)){e.preventDefault();e.returnValue=''}});
 window.MercuryDuplicate={hasPending:()=>!!pending,open};
 if(pending)el('newEventBtn').textContent='Recover duplicate';
})();

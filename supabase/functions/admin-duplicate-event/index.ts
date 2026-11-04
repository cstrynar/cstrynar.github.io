// Dedicated configuration-only duplication. No participant/result endpoints.
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const safeErrors = new Set(['source_not_found','source_changed','invalid_configuration','invalid_event_name','invalid_slug','invalid_event_date','invalid_timezone','invalid_location','slug_already_exists','race_required','invalid_race','invalid_race_source_label','invalid_race_key','invalid_race_display_label','duplicate_race_source_label','duplicate_race_key','invalid_race_scheduled_start','invalid_featured_race_key','invalid_accent_color','source_logo_missing','invalid_display_configuration','invalid_awards_configuration','unsupported_special_division','invalid_team_configuration','operation_id_required','operation_payload_mismatch','operation_not_found','operation_cancelled','logo_copy_required','unsupported_logo','unauthorized','invalid_worker','invalid_operation_state','invalid_logo_path']);
async function digest(value: Uint8Array) {
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
// fetcher/env are injectable for offline contract tests. Production passes Deno.env.
export async function handleDuplicate(req: Request, env: {get:(name:string)=>string|undefined}, fetcher: typeof fetch = fetch) {
 if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
 if(!['GET','POST'].includes(req.method)) return reply({error:'method_not_allowed'},405);
 const base=env.get('SUPABASE_URL'), key=env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!base||!key) return reply({error:'server_not_configured'},500);
 const headers={apikey:key,Authorization:`Bearer ${key}`};
 const storagePath=(path:string)=>{if(typeof path!=='string'||path.length>500||path.split('/').some(part=>!part||part==='.'||part==='..')||/[\\?#]/.test(path))throw new Error('invalid_logo_path');return path.split('/').map(encodeURIComponent).join('/')};
 let adminId:string; let sessionHash:string; const workerId=crypto.randomUUID();
 try {
  const token=/^Bearer (\S+)$/.exec(req.headers.get('authorization')||'')?.[1];
  if(!token||token.length>4096) return reply({error:'unauthorized'},401);
  const hash=await digest(new TextEncoder().encode(token));sessionHash=hash;
  const sessions=await fetcher(`${base}/rest/v1/admin_sessions?select=admin_client_id&token_hash=eq.${hash}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`,{headers});
  if(!sessions.ok) return reply({error:'authorization_unavailable'},503);
  const rows=await sessions.json();
  if(!rows?.[0]?.admin_client_id) return reply({error:'unauthorized'},401);
  adminId=rows[0].admin_client_id;
  const clients=await fetcher(`${base}/rest/v1/admin_clients?select=id&id=eq.${encodeURIComponent(adminId)}&active=eq.true&limit=1`,{headers});
  if(!clients.ok) return reply({error:'authorization_unavailable'},503);
  if(!(await clients.json())?.length) return reply({error:'unauthorized'},401);
 } catch {return reply({error:'authorization_unavailable'},503)}
 const url=new URL(req.url);let body:any={};
 try {if(req.method==='POST'){const text=await req.text();if(text.length>100000)return reply({error:'request_too_large'},413);body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))return reply({error:'invalid_json'},400)}}catch{return reply({error:'invalid_json'},400)}
 const action=req.method==='GET'?url.searchParams.get('action'):body.action;
 const operation=req.method==='GET'?url.searchParams.get('operation_id'):body.operation_id;
 if(!['source','preview','create','status','cancel'].includes(action||''))return reply({error:'invalid_action'},400);
 if((req.method==='GET')!==['source','status'].includes(action))return reply({error:'method_not_allowed'},405);
 if(['create','status','cancel'].includes(action)&&!uuid.test(operation||''))return reply({error:'invalid_operation_id'},400);
 const source=req.method==='GET'?url.searchParams.get('source_slug'):body.source_slug;
 if(['source','preview','create'].includes(action)&&(typeof source!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source||'')||source.length>120))return reply({error:'invalid_slug'},400);
 async function rpc(mode:string){
  const res=await fetcher(`${base}/rest/v1/rpc/mercury_duplicate_event`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_mode:mode,p_admin_id:adminId,p_operation_id:operation||null,p_source_slug:source||null,p_source_version:body.source_version||null,p_draft:body.draft||null,p_session_hash:sessionHash,p_worker_id:workerId})});
  const data=await res.json();
  if(!res.ok){const message=res.status===409?'slug_already_exists':safeErrors.has(data.message)?data.message:'duplicate_unavailable';throw new Error(message)}
  return data;
 }
 async function object(path:string){
  const r=await fetcher(`${base}/storage/v1/object/authenticated/event-assets/${storagePath(path)}`,{headers});
  if(!r.ok){let missing=r.status===404;try{const problem=await r.json();missing=missing||(r.status===400&&String(problem.statusCode)==='404'&&['not_found','not_found_error','Object not found'].includes(problem.error||problem.message))}catch{}return {response:r,bytes:null,missing};}
  if(Number(r.headers.get('content-length')||0)>5*1024*1024)throw new Error('logo_copy_failed');
  const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>5*1024*1024)throw new Error('logo_copy_failed');
  return {response:r,bytes};
 }
 let workerStarted=false,writeOutcomeKnown=true;
 async function cleanup(record:any){
  if(record.state==='complete'||record.state==='cancelled')return record;
  if(record.active_workers>0)return {state:'cleanup_pending',active_workers:record.active_workers,operation_id:operation};
  if(record.logo_target){
   const r=await fetcher(`${base}/storage/v1/object/event-assets/${storagePath(record.logo_target)}`,{method:'DELETE',headers});
   if(!r.ok&&r.status!==404)throw new Error('logo_cleanup_pending');
  }
  return rpc('cleaned');
 }
 try {
  if(action==='source'||action==='status'||action==='preview')return reply(await rpc(action));
  if(action==='cancel'){
   const cancelled=await rpc('cancel');
   return reply(await cleanup(cancelled));
  }
  const reserved=await rpc('reserve');
  if(reserved.state==='complete')return reply(reserved);
  const plan=reserved.plan;
  if(plan.logo_target){
   const started=await rpc('worker_start');if(started.state==='complete')return reply(started);workerStarted=true;
   const sourceLogo=await object(plan.logo_source);if(!sourceLogo.bytes)throw new Error('logo_copy_failed');
   const existing=await object(plan.logo_target);
   if(!existing.bytes){
    if(!existing.missing)throw new Error('logo_copy_failed');
    const type=({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml'} as Record<string,string>)[plan.logo_target.split('.').pop()];
    writeOutcomeKnown=false;
    const r=await fetcher(`${base}/storage/v1/object/event-assets/${storagePath(plan.logo_target)}`,{method:'POST',headers:{...headers,'Content-Type':type,'x-upsert':'false'},body:sourceLogo.bytes});
    writeOutcomeKnown=true;
    // Concurrent retry may have copied the same deterministic object. Compare it.
    if(!r.ok){const retry=await object(plan.logo_target);if(!retry.bytes)throw new Error('logo_copy_failed');}
   }
   const destination=await object(plan.logo_target);
   if(!destination.bytes||await digest(destination.bytes)!==await digest(sourceLogo.bytes))throw new Error('logo_copy_failed');
  }
  // Event, settings, races, policy, provenance, and operation completion commit
  // in one PostgreSQL transaction. A lost response is reconciled by status.
  return reply(await rpc('commit'));
 } catch(e){
  const message=e instanceof Error?e.message:'';
  if(message==='logo_copy_failed'){try{const state=await rpc('status');if(state.state==='complete')return reply(state);return reply({error:message,operation_id:operation,state:state.state},503)}catch{return reply({error:'creation_outcome_unknown',operation_id:operation},503)}}
  const known=safeErrors.has(message);
  return reply({error:known?message:(['source','preview','status'].includes(action)?'duplicate_unavailable':'creation_outcome_unknown'),operation_id:operation},known?(message==='unauthorized'?401:409):503);
 }finally{
  if(workerStarted&&writeOutcomeKnown){
   try{const stopped=await rpc('worker_finish');if(stopped.state==='cleanup_pending'&&stopped.active_workers===0)await cleanup(stopped)}catch{/* Durable worker/cleanup state is retained for reconciliation. */}
  }
 }
}
if(typeof Deno!=='undefined') Deno.serve(req=>handleDuplicate(req,Deno.env));

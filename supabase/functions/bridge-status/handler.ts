const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, content-type, x-mercury-key, x-mercury-admin-key','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Cache-Control':'no-store','Content-Type':'application/json'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
async function hash(v:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,'0')).join('')}
const states=['starting','armed','watching','source_wait','upload_delayed','blocked','paused'];
export function validReport(b:any){
 return b && typeof b==='object' && !Array.isArray(b) && Object.keys(b).sort().join(',')==='correction,eventSlug,pending,sequence,sessionId,sourceAgeSeconds,staged,state,version' &&
 typeof b.eventSlug==='string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(b.eventSlug)&&b.eventSlug.length<=110 &&
 typeof b.sessionId==='string'&&/^[a-f0-9]{32}$/.test(b.sessionId)&&Number.isSafeInteger(b.sequence)&&b.sequence>0&&
 typeof b.version==='string'&&/^\d+\.\d+\.\d+(?:-rc\d+)?$/.test(b.version)&&b.version.length<=30&&states.includes(b.state)&&
 (b.sourceAgeSeconds===null||(Number.isSafeInteger(b.sourceAgeSeconds)&&b.sourceAgeSeconds>=0&&b.sourceAgeSeconds<=31536000))&&
 ['pending','staged','correction'].every(k=>typeof b[k]==='boolean');
}
export function handler(base:string,secret:string,fetcher:typeof fetch=fetch){return async(req:Request)=>{
 if(req.method==='OPTIONS')return json({ok:true});
 if(!['GET','POST'].includes(req.method))return json({error:'method_not_allowed'},405);
 try{
  const headers={apikey:secret,Authorization:`Bearer ${secret}`,'Content-Type':'application/json'};
  async function db(path:string,init:RequestInit={}){const r=await fetcher(base+'/rest/v1/'+path,{...init,headers,signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('database_unavailable');return r.status===204?null:r.json()}
  const url=new URL(req.url);
  if(req.method==='GET'){
   let authorized=false;
   const auth=req.headers.get('authorization')||'';
   if(auth.startsWith('Bearer ')&&auth.length<=4096){
    const rows=await db('admin_sessions?select=admin_client_id&token_hash=eq.'+await hash(auth.slice(7).trim())+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&limit=1');
    if(rows.length)authorized=(await db('admin_clients?select=id&id=eq.'+rows[0].admin_client_id+'&active=eq.true&limit=1')).length===1;
   }
   const legacy=req.headers.get('x-mercury-admin-key')||'';
   if(!authorized&&legacy.length>=24&&legacy.length<=4096)authorized=(await db('admin_clients?select=id&key_hash=eq.'+await hash(legacy)+'&active=eq.true&password_hash=is.null&limit=1')).length===1;
   if(!authorized)return json({error:'unauthorized'},401);
   const slug=url.searchParams.get('slug')||'';
   if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>110)return json({error:'invalid_event'},400);
   const events=await db('live_events?select=id,slug&slug=eq.'+slug+'&limit=1');
   if(!events.length)return json({error:'event_not_found'},404);
   const event=events[0];
   const rows=await db('bridge_status_reports?select=client_id,session_id,sequence,version,state,source_age_seconds,pending,staged,correction,received_at,bridge_clients!inner(name,active)&event_id=eq.'+event.id+'&bridge_clients.active=eq.true&order=received_at.desc&limit=100');
   const grants=await db('bridge_event_grants?select=bridge_client_id&event_id=eq.'+event.id+'&active=eq.true&can_read=eq.true');
   return json({event,checkedAt:new Date().toISOString(),reports:rows.filter((r:any)=>grants.some((g:any)=>g.bridge_client_id===r.client_id)).map((r:any)=>{const {bridge_clients,...v}=r;return {...v,client_name:bridge_clients.name}})});
  }
  const key=req.headers.get('x-mercury-key')||'';
  if(key.length<24||key.length>4096)return json({error:'unauthorized'},401);
  const clients=await db('bridge_clients?select=id&key_hash=eq.'+await hash(key)+'&active=eq.true&limit=1');
  if(!clients.length)return json({error:'unauthorized'},401);
  // Stream with a hard byte limit even if Content-Length is omitted or forged.
  const reader=req.body?.getReader();if(!reader)return json({error:'invalid_report'},400);
  const chunks:Uint8Array[]=[];let length=0;
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>2048){await reader.cancel();return json({error:'report_too_large'},413)}chunks.push(value)}
  const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
  let b;try{b=JSON.parse(new TextDecoder().decode(bytes))}catch{return json({error:'invalid_report'},400)}
  if(!validReport(b))return json({error:'invalid_report'},400);
  const events=await db('live_events?select=id&slug=eq.'+b.eventSlug+'&limit=1');
  if(!events.length)return json({error:'event_not_authorized'},403);
  const accepted=await db('rpc/record_bridge_status',{method:'POST',body:JSON.stringify({p_client:clients[0].id,p_event:events[0].id,p_session:b.sessionId,p_sequence:b.sequence,p_version:b.version,p_state:b.state,p_age:b.sourceAgeSeconds,p_pending:b.pending,p_staged:b.staged,p_correction:b.correction})});
  if(accepted===null)return json({error:'event_not_authorized'},403);
  return json({ok:true,accepted});
 }catch{return json({error:'status_unavailable'},503)}
}}

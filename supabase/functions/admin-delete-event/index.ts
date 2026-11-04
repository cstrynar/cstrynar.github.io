const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
const known=new Set(['unauthorized','event_not_found','confirmation_mismatch','duplication_in_progress']);
export async function handleDelete(req:Request,env:{get:(name:string)=>string|undefined},fetcher:typeof fetch=fetch){
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
 const base=env.get('SUPABASE_URL'),key=env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!base||!key)return reply({error:'server_not_configured'},500);
 const token=/^Bearer (\S+)$/.exec(req.headers.get('authorization')||'')?.[1];
 if(!token||token.length>4096)return reply({error:'unauthorized'},401);
 const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
 let body:any;
 try{const raw=await req.text();if(raw.length>4000)return reply({error:'request_too_large'},413);body=JSON.parse(raw)}catch{return reply({error:'invalid_request'},400)}
 if(!body||typeof body.confirm_name!=='string'||!body.confirm_name||body.confirm_name.length>1000||!(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(body.event_id||'')))return reply({error:'invalid_request'},400);
 try{
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const sr=await fetcher(`${base}/rest/v1/admin_sessions?select=admin_client_id&token_hash=eq.${hash}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`,{headers});
  if(!sr.ok)return reply({error:'authorization_unavailable'},503);
  const admin=(await sr.json())?.[0]?.admin_client_id;
  if(!admin)return reply({error:'unauthorized'},401);
  async function rpc(done=false){
   const r=await fetcher(`${base}/rest/v1/rpc/mercury_delete_event`,{method:'POST',headers,body:JSON.stringify({p_admin_id:admin,p_session_hash:hash,p_event_id:body.event_id,p_confirm_name:body.confirm_name,p_cleanup_done:done})});
   const data=await r.json();if(!r.ok)throw new Error(known.has(data.message)?data.message:'delete_unavailable');return data;
  }
  const result=await rpc();
  if(!result.assets_cleaned){
   try{
    // Use Storage API (never delete storage.objects rows directly). The durable
    // receipt makes retries safe even after the event row has been removed.
    const r=await fetcher(`${base}/storage/v1/object/event-assets`,{method:'DELETE',headers,body:JSON.stringify({prefixes:result.logo_paths})});
    if(!r.ok)throw Error('storage_cleanup_pending');
    await rpc(true);
   }catch{return reply({deleted:true,event_id:body.event_id,assets_cleaned:false},202)}
  }
  return reply({deleted:true,event_id:body.event_id,assets_cleaned:true});
 }catch(e){const message=e instanceof Error?e.message:'';return reply({error:known.has(message)?message:'deletion_outcome_unknown'},message==='unauthorized'?401:known.has(message)?409:503)}
}
if(import.meta.main)Deno.serve(req=>handleDelete(req,Deno.env));

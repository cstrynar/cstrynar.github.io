import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleDelete} from '../functions/admin-delete-event/index.ts';
const env={get:n=>n==='SUPABASE_URL'?'https://example.invalid':'server-only'};
const event='11111111-1111-4111-8111-111111111111';
const request=(body={event_id:event,confirm_name:'Test event'},token='opaque-test-session')=>new Request('https://example.invalid/delete',{method:'POST',headers:token?{Authorization:'Bearer '+token}:{},body:JSON.stringify(body)});
const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
test('no token cannot access database or storage',async()=>{
 const response=await handleDelete(request(undefined,''),env,()=>{throw Error('must not fetch')});assert.equal(response.status,401);
});
test('bad input cannot reach database',async()=>{
 const response=await handleDelete(request({event_id:'wrong',confirm_name:'Test'}),env,()=>{throw Error('must not fetch')});assert.equal(response.status,400);
});
test('database confirmation/auth rejection never touches storage',async()=>{
 for(const error of ['confirmation_mismatch','unauthorized','duplication_in_progress']){
  const response=await handleDelete(request(),env,async url=>{
   if(url.includes('admin_sessions?'))return json([{admin_client_id:event}]);
   assert(url.includes('/rpc/mercury_delete_event'));return json({message:error},400);
  });assert.equal((await response.json()).error,error);
 }
});
test('successful deletion cleans only server-provided asset paths and acknowledges cleanup',async()=>{
 const calls=[];
 const response=await handleDelete(request(),env,async(url,options)=>{
  calls.push(url);
  if(url.includes('admin_sessions?'))return json([{admin_client_id:event}]);
  const body=JSON.parse(options.body);
  if(url.includes('/storage/')){assert.equal(options.method,'DELETE');assert.deepEqual(body.prefixes,[event+'/event-logo.png']);return json([])}
  assert.equal(body.p_event_id,event);assert.equal(body.p_confirm_name,'Test event');assert.equal(body.p_session_hash.length,64);
  return json({deleted:true,assets_cleaned:body.p_cleanup_done,logo_paths:[event+'/event-logo.png']});
 });assert.equal(response.status,200);assert.deepEqual(await response.json(),{deleted:true,event_id:event,assets_cleaned:true});assert.equal(calls.length,4);
});
test('failed storage cleanup reports deleted event with retry pending',async()=>{
 const response=await handleDelete(request(),env,async url=>url.includes('admin_sessions?')?json([{admin_client_id:event}]):url.includes('/storage/')?json({},503):json({deleted:true,assets_cleaned:false,logo_paths:[event+'/event-logo.png']}));
 assert.equal(response.status,202);assert.equal((await response.json()).assets_cleaned,false);
});
test('completed deletion retry does not touch storage',async()=>{
 const response=await handleDelete(request(),env,async url=>{
  assert(!url.includes('/storage/'));return url.includes('admin_sessions?')?json([{admin_client_id:event}]):json({deleted:true,assets_cleaned:true});
 });assert.equal(response.status,200);
});

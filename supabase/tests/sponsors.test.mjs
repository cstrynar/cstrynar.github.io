import {test} from 'node:test';
import assert from 'node:assert/strict';
let handler,state={},uploads=[],failSave=false;
globalThis.Deno={serve:f=>handler=f,env:{get:k=>k==='SUPABASE_URL'?'https://fixture.invalid':'test'}};
globalThis.fetch=async(url,options={})=>{const u=String(url);let data=[];
if(u.includes('/admin_sessions?'))data=options.method?[]:[{id:'session',admin_client_id:'admin'}];
else if(u.includes('/admin_clients?'))data=[{id:'admin',active:true}];
else if(u.includes('/live_events?'))data=[{id:'event',slug:'test',status:'setup'}];
else if(u.includes('/event_settings?')){if(options.method==='PATCH'){if(failSave)return new Response('{}',{status:500});Object.assign(state,JSON.parse(options.body));}data=[state];}
else if(u.includes('/storage/'))uploads.push({url:u,method:options.method});
return Response.json(data);};
await import('../functions/admin-event-settings/index.ts');
async function save(items,extra={},file){const f=new FormData();f.set('sponsor',JSON.stringify({items,top:true,bottom:true,...extra}));if(file)f.set('file0',file);const r=await handler(new Request('https://fixture.invalid/?slug=test&action=sponsor',{method:'POST',headers:{Authorization:'Bearer fixture'},body:f}));return {status:r.status,body:await r.json()};}
test('requires authorization',async()=>{const r=await handler(new Request('https://fixture.invalid/?slug=test&action=sponsor',{method:'POST'}));assert.equal(r.status,401)});
test('saves 1, 2, 3 and placements without modifying awards',async()=>{state={awards:{overall_places:7}};for(const n of [1,2,3]){const r=await save(Array.from({length:n},(_,i)=>({name:'Sponsor '+i})),{top:n!==2,bottom:n!==1});assert.equal(r.status,200);assert.equal(state.sponsor.items.length,n);assert.equal(state.sponsor.top,n!==2);assert.equal(state.sponsor.bottom,n!==1);assert.equal(state.awards.overall_places,7);}});
test('rejects invalid count, URL, and blank sponsors',async()=>{for(const items of [[],Array(4).fill({name:'x'}),[{name:'x',website:'javascript:alert(1)'}],[{}]])assert.equal((await save(items)).status,400)});
test('uploads validated logo, retains on text save, explicitly removes',async()=>{uploads=[];const png=new File([new Uint8Array([137,80,78,71,13,10,26,10,1])],'logo.png',{type:'image/png'});assert.equal((await save([{name:'Logo'}],{},png)).status,200);const path=state.sponsor.items[0].logoPath;assert.match(path,/^event\/sponsor-.*\.png$/);assert.equal(uploads.length,1);await save([{name:'Edited'}]);assert.equal(state.sponsor.items[0].logoPath,path);await save([{name:'Edited',removeLogo:true}]);assert.equal(state.sponsor.items[0].logoPath,null)});
test('rejects spoofed file and does not upload',async()=>{uploads=[];const file=new File(['<svg/>'],'fake.png',{type:'image/png'});assert.equal((await save([{name:'Logo'}],{},file)).status,400);assert.equal(uploads.length,0)});
test('cleans up new upload if settings save fails',async()=>{uploads=[];failSave=true;const png=new File([new Uint8Array([137,80,78,71,13,10,26,10])],'logo.png',{type:'image/png'});try{assert.equal((await save([{name:'Logo'}],{},png)).status,500);assert.deepEqual(uploads.map(x=>x.method),['POST','DELETE']);}finally{failSave=false;}});

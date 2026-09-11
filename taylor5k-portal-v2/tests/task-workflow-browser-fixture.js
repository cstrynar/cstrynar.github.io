if(!crypto.randomUUID)Object.defineProperty(crypto,'randomUUID',{value:()=> 'fixture-draft-'+Math.random().toString(16).slice(2)});
// Isolated portal-contract fixture. Every network operation below is mocked.
const BASE='https://portal-api.test',KEY='test-key',AI_KEY=KEY,TAYLOR_TOOLS_V31_URL=BASE+'/functions/v1/taylor5k-tools-v31',DEMO=false;
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
let me={id:'admin-one',user_id:'user-one',display_name:'Alex North',email:'alex@example.test',role:'admin',active:true},session={access_token:'test-session',user:{id:'user-one'}},data={},currentPage='tasks',editing=null,aiBusy=false;
const database={team_members:[{...me},{id:'admin-two',user_id:null,display_name:'Sam West',email:'sam@example.test',role:'admin',active:true},{id:'viewer',display_name:'Read Only',role:'viewer',active:true},{id:'inactive',display_name:'Former Admin',role:'admin',active:false}],tasks:[{id:'task-one',title:'Coordinate volunteers',category:'Volunteers',notes:'First line\n"quoted"',status:'Not Started',priority:'Medium',owner_member_id:null,owner_name:null,updated_at:'2026-09-11T13:00:00.000Z'}]};
const calls=[],delegated=[],rtMessages=[],alerts=[];let clock=0,failRead=false;
function headers(){return {apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'};}
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
window.fetch=async function(url,opt={}){
 const u=new URL(url),method=opt.method||'GET',body=opt.body?JSON.parse(opt.body):null;calls.push({url,method,body});
 if(u.pathname==='/rest/v1/team_members')return json(database.team_members.filter(m=>m.active&&['admin','super_admin'].includes(m.role)));
 if(u.pathname==='/functions/v1/taylor5k-tools-v31'){
  if(failRead)return new Response('<html>bad gateway</html>',{status:502,headers:{'Content-Type':'text/html'}});
  const query=(body.args.query||'').toLowerCase();return json({result:database.tasks.filter(t=>!query||JSON.stringify(t).toLowerCase().includes(query))});
 }
 if(u.pathname==='/rest/v1/tasks'){
  const id=(u.searchParams.get('id')||'').replace(/^eq\./,''),expected=(u.searchParams.get('updated_at')||'').replace(/^eq\./,'');
  if(method==='GET')return json(database.tasks.filter(t=>!id||t.id===id));
  if(!['admin','super_admin','editor'].includes(me.role))return json({error:'Read-only',code:'FORBIDDEN'},403);
  let row;
  if(method==='PATCH'){row=database.tasks.find(t=>t.id===id);if(!row||expected&&row.updated_at!==expected)return json([]);}
  else{if(database.tasks.some(t=>t.id===body.id))return json({code:'23505',message:'Duplicate draft'},409);row={id:body.id};database.tasks.push(row);}
  Object.assign(row,body);if('owner_member_id'in body){const m=database.team_members.find(m=>m.id===body.owner_member_id);row.owner_name=m?.display_name||null;row.owner_user_id=m?.user_id||null;}
  row.updated_at=new Date(1789150000000+(++clock)*1000).toISOString();return json([row]);
 }
 throw new Error('Unexpected fixture request '+url);
};
async function api(path,opt={}){const r=await fetch(BASE+path,{...opt,headers:headers()});const j=await r.json();if(!r.ok)throw Error(j.error||j.message);return j;}
async function loadData(){data={...structuredClone(database),chapters:[{body:'x'.repeat(75000)}],live_signups:{rows:[{name:'Signup Person',summary:'Retain signup context'}]}};}
function canEdit(entity){return entity==='team_members'?false:['admin','super_admin','editor'].includes(me.role);}
const editDefs={tasks:[['title','Task','text'],['category','Area','text'],['owner_member_id','Assigned to','admin-member'],['priority','Priority','select',['Critical','High','Medium','Low']],['status','Status','select',['Not Started','In Progress','Decision Required','Waiting','Complete']],['notes','Notes','textarea']]};
function fieldHTML([key,label,type,opts],row){const v=row?.[key]??'';if(type==='admin-member'){return '<label>'+label+'<select name="owner_member_id" id="taskOwnerMember"><option value="">Unassigned</option>'+data.team_members.filter(m=>m.active&&['admin','super_admin'].includes(m.role)).map(m=>'<option value="'+esc(m.id)+'"'+(v===m.id?' selected':'')+'>'+esc(m.display_name)+' — '+esc(m.email)+(m.user_id?'':' (invited / setup pending)')+'</option>').join('')+'</select></label>';}
 if(type==='textarea')return '<label>'+label+'<textarea name="'+key+'">'+esc(v)+'</textarea></label>';
 if(type==='select')return '<label>'+label+'<select name="'+key+'">'+opts.map(o=>'<option'+(o===v?' selected':'')+'>'+esc(o)+'</option>').join('')+'</select></label>';
 return '<label>'+label+'<input name="'+key+'" value="'+esc(v)+'"></label>';
}
function openEditor(entity,id){if(!canEdit(entity)){alert('Read-only');return;}const row=id?data[entity].find(t=>t.id===id):{};editing={entity,id,row};$('#editFields').innerHTML=editDefs[entity].map(f=>fieldHTML(f,row)).join('');$('#editModal').hidden=false;}
function closeEditor(){editing=null;$('#editModal').hidden=true;}
async function saveEdit(e){e.preventDefault();delegated.push('other-save');}
function renderPage(){$('#content').innerHTML='<div class="page-toolbar">Tasks</div><button id="addAdminSentinel">+ Add Admin</button>';}
function portalContext(){return JSON.stringify(data).slice(0,70000);}
function aiMessage(kind,text){const el=document.createElement('div');el.className='message '+kind;el.textContent=text;$('#aiMessages').appendChild(el);return el;}
const aiFieldAllow={tasks:['title','category','owner_name','status','priority','notes']};
function showProposal(action){delegated.push('other-proposal:'+action.entity_type);}
async function executeAIAction(action){delegated.push('other-execute:'+action.entity_type);}
async function sendChatAI(){delegated.push('chat:'+$('#aiInput').value);}
function sendAI(){return sendChatAI();}
function realtimeV31Tools(){return ['read_portal_section','search_portal','list_task_admins','prepare_task_assignment','confirm_task_assignment','cancel_task_assignment','read_google_drive_file','inspect_public_site','search_marketing_library'].map(name=>({type:'function',name,parameters:{type:'object',properties:{}}}));}
function rtV31Instructions(){return 'Preserve current portal functions and use outside web research.';}
let rtHandledCalls=new Set(),rtDc={readyState:'open',send:s=>rtMessages.push(JSON.parse(s))};
function handleRealtimeEvent(){delegated.push('voice-event');}
async function runRealtimeV31Tool(item){delegated.push('tool:'+item.name);}
window.alert=s=>alerts.push(s);

/* Taylor 5K v3.3.1: complete JSON context and confirmation-gated task creation/updates.
 * Extends v3.3.0 without replacing its admin dropdown, invitations, or other project tools.
 */
(function(global){
 'use strict';
 const VERSION='3.3.1',has=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
 const array=v=>Array.isArray(v)?v:[],norm=v=>String(v??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
 const clip=(v,n)=>typeof v==='string'?v.slice(0,n):'';
 const eligible=rows=>array(rows).filter(m=>m&&m.active===true&&['admin','super_admin'].includes(m.role));
 const error=(code,message)=>Object.assign(new Error(message),{code});
 const yes=s=>/^(yes(?: please)?|confirm(?: (?:the )?(?:task|update|assignment))?|save (?:the )?task|go ahead)[.!?\s]*$/i.test(String(s||'').trim());
 const no=s=>/^(no(?: thanks)?|cancel(?: (?:the )?(?:task|update|assignment))?|never ?mind)[.!?\s]*$/i.test(String(s||'').trim());
 function memberFor(fields,rows,self){
  const members=eligible(rows);let member=null;
  if(has(fields,'owner_member_id')){
   const id=fields.owner_member_id;
   if(id!==null&&id!==''&&typeof id!=='string')throw error('INVALID_ASSIGNEE','Choose an admin by their member ID.');
   if(id){member=members.find(m=>m.id===id);if(!member)throw error('ADMIN_NOT_FOUND','That person is not an active admin. Refresh the admin list.');}
   if(has(fields,'owner_name')&&norm(fields.owner_name)&&norm(fields.owner_name)!=='unassigned'&&(!member||![norm(member.display_name),norm(member.email)].includes(norm(fields.owner_name))))throw error('ASSIGNEE_CONFLICT','The admin ID and name do not match. Please clarify the assignee.');
  }else if(has(fields,'owner_user_id')){
   if(fields.owner_user_id){member=members.find(m=>m.user_id===fields.owner_user_id);if(!member)throw error('ADMIN_NOT_FOUND','That account is not an active admin.');}
  }else if(has(fields,'owner_name')){
   const q=norm(fields.owner_name);
   if(['','unassigned','none','tbd'].includes(q))return null;
   if(['me','myself'].includes(q))member=members.find(m=>m.id===self?.id||(self?.user_id&&m.user_id===self.user_id));
   else{
    const exact=members.filter(m=>norm(m.email)===q||m.id===fields.owner_name);
    const matches=exact.length?exact:members.filter(m=>norm(m.display_name)===q||(!q.includes(' ')&&norm(m.display_name).replace(/^dr\.?\s+/,'').split(' ')[0]===q));
    if(matches.length>1)throw error('AMBIGUOUS_ADMIN','More than one admin matches. Use the full name, email, or dropdown.');
    member=matches[0];
   }
   if(!member)throw error('ADMIN_NOT_FOUND','No active admin matches that name. Add the person first or confirm their name/email.');
  }
  return member||null;
 }
 function contextObject(state,user,usage=[]){
  const rows=array(state?.team_members),signups=array(state?.live_signups?.rows);
  const c={context_version:VERSION,generated_at:new Date().toISOString(),event:'Kent Taylor 5K · Fall 2027 · Norton, Massachusetts',role:user?.role||'viewer',member_summary:{current_member_id:user?.id||null,current_time_utc:new Date().toISOString(),task_policy:'Creating tasks, assigning existing admins, and updating task details are allowed planning actions, not account-role changes. Read live tasks and admins; ask about missing or ambiguous targets. Use owner_member_id. All task changes need a human confirmation card. Admin invitations use the Add Admin form.',assignable_admins:eligible(rows).slice(0,120).map(m=>({id:clip(m.id,80),display_name:clip(m.display_name,180),email:clip(m.email,320),role:m.role,setup_pending:!m.user_id})),active_count:eligible(rows).length},live_signups:signups.filter(Boolean).slice(0,80).map(s=>({name:clip(s.name,180),email:clip(s.email,320),role:clip(s.role,500),summary:clip(s.summary,1200)})),portal_usage_summary:array(usage).slice(0,30),counts:{},summary_only:true};
  for(const k of ['chapters','tasks','permits','sponsors','sponsor_opportunities','festival_items','swag_items','decisions','site_edits'])c.counts[k]=array(state?.[k]).length;
  c.live_signups_truncated=c.live_signups.length<signups.length;
  c.member_summary.truncated=c.member_summary.assignable_admins.length<c.member_summary.active_count;
  // Reduce whole DATA items, never the serialized JSON string.
  while(JSON.stringify(c).length>56000&&c.live_signups.length){c.live_signups.pop();c.live_signups_truncated=true;}
  while(JSON.stringify(c).length>56000&&c.portal_usage_summary.length){c.portal_usage_summary.pop();c.portal_usage_truncated=true;}
  while(JSON.stringify(c).length>56000&&c.member_summary.assignable_admins.length){c.member_summary.assignable_admins.pop();c.member_summary.truncated=true;}
  return c;
 }
 async function parseResponse(response,label){
  const raw=await response.text(),type=response.headers.get('content-type')||'unknown';let body;
  try{body=JSON.parse(raw.replace(/^\uFEFF/,''));}catch{throw error('INVALID_JSON',`${label} returned invalid JSON (HTTP ${response.status}; ${type}). No successful save has been confirmed. Refresh before retrying a save.`);}
  if(!response.ok)throw error(body?.code||'REQUEST_FAILED',typeof body?.error==='string'?body.error:body?.message||`${label} failed (HTTP ${response.status}).`);
  if(!/\bjson\b/i.test(type))throw error('INVALID_CONTENT_TYPE',`${label} returned ${type}, not JSON.`);
  return body;
 }
 function fieldsFor(action){
  if(!action||!['create','update'].includes(action.operation))throw error('INVALID_OPERATION','Choose task creation or update.');
  const input=action.fields;
  if(!input||typeof input!=='object'||Array.isArray(input))throw error('INVALID_FIELDS','Task details must be an object.');
  const fields={};
  for(const key of ['title','category','due_date','status','priority','notes'])if(has(input,key)){
   const v=input[key];if(v!==null&&typeof v!=='string')throw error('INVALID_FIELD','Task '+key+' must be text.');fields[key]=v;
  }
  if(action.operation==='create'&&!String(fields.title||'').trim())throw error('TITLE_REQUIRED','Give the new task a title.');
  if(has(fields,'title')&&!String(fields.title||'').trim())throw error('TITLE_REQUIRED','A task title cannot be blank.');
  if(fields.status==='Waiting')fields.status='Blocked';if(fields.priority==='Urgent')fields.priority='Critical';
  if(has(fields,'status')&&!['Not Started','In Progress','Decision Required','Blocked','Complete'].includes(fields.status))throw error('INVALID_STATUS','Choose a valid task status.');
  if(has(fields,'priority')&&!['Critical','High','Medium','Low'].includes(fields.priority))throw error('INVALID_PRIORITY','Choose a valid task priority.');
  if(fields.due_date){const d=new Date(fields.due_date+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(fields.due_date)||Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==fields.due_date)throw error('INVALID_DATE','Use a valid due date in YYYY-MM-DD format.');}
  else if(has(fields,'due_date'))fields.due_date=null;
  if(action.operation==='create'){if(!has(fields,'status'))fields.status='Not Started';if(!has(fields,'priority'))fields.priority='Medium';}
  return fields;
 }
 function outputJSON(value){
  const s=JSON.stringify(value??{});if(s.length<48000)return s;
  if(Array.isArray(value)){const rows=value.slice();while(rows.length&&JSON.stringify(rows).length>44000)rows.pop();return JSON.stringify({rows,truncated:true,available_count:value.length,message:'Voice output was limited at whole-record boundaries. Narrow the query or request a smaller limit.'});}
  return JSON.stringify({error:'RESULT_TOO_LARGE',truncated:true,message:'Narrow the query to receive a smaller result.'});
 }
 const utils={VERSION,eligible,memberFor,contextObject,parseResponse,fieldsFor,outputJSON,yes,no};
 global.TaylorTaskWorkflowUtils=utils;
 if(typeof module!=='undefined'&&module.exports)module.exports=utils;
 if(!global.document)return;
 const editor=()=>me?.active!==false&&['admin','super_admin','editor'].includes(me?.role);
 const nameOf=m=>m?.display_name||m?.email||'Unassigned';
 let pending=null,proposalSeq=0,voice={seq:0,at:0,text:''},lastVoiceItem=null,savingEditor=false,opening=0;
 const prepared=new WeakSet();
 function assertEditor(){if(!editor()||!session?.user?.id)throw error('EDITOR_REQUIRED','Sign in with a portal account that can edit tasks.');}
 async function request(path,opts={}){
  if(!session?.access_token)throw error('SIGN_IN_REQUIRED','Sign in to the portal first.');
  const response=await fetch(BASE+path,{...opts,headers:{...headers(),...(opts.headers||{})}});
  return parseResponse(response,'Task service');
 }
 async function roster(){
  const rows=DEMO?data.team_members:await request('/rest/v1/team_members?select=id,user_id,display_name,email,role,active&active=eq.true&role=in.(admin,super_admin)&order=display_name.asc');
  if(!Array.isArray(rows))throw error('INVALID_ROSTER','The admin list could not be read.');return eligible(rows);
 }
 async function getTask(id){
  if(!id||typeof id!=='string')throw error('TASK_REQUIRED','Select the existing task first.');
  const rows=DEMO?array(data.tasks).filter(t=>t.id===id):await request('/rest/v1/tasks?select=*&id=eq.'+encodeURIComponent(id)+'&limit=2');
  if(!Array.isArray(rows)||rows.length!==1)throw error('TASK_NOT_FOUND','That task was not found. Please choose from the live task list.');return rows[0];
 }
 portalContext=function(){
  let usage=[];
  if(me?.role==='super_admin'&&typeof memberTimeSummary==='function')try{usage=memberTimeSummary().map(x=>({member_name:clip(x.member?.display_name,180),role:x.member?.role,active_now:!!x.activeNow,active_seconds_30_days:Number(x.last30)||0,active_seconds_all_time:Number(x.total)||0,session_count:Number(x.sessions)||0,last_seen:x.lastSeen?.toISOString?.()||null}));}catch{}
  return JSON.stringify(contextObject(data,me,usage));
 };
 async function draft(action){
  assertEditor();const fields=fieldsFor(action),row=action.operation==='update'?await getTask(action.record_id):null;
  const assignment=['owner_member_id','owner_user_id','owner_name'].some(k=>has(action.fields,k));let member=null;
  if(assignment){member=memberFor(action.fields,await roster(),me);fields.owner_member_id=member?.id||null;}
  if(!Object.keys(fields).length)throw error('EMPTY_UPDATE','No supported task changes were supplied.');
  const d={entity_type:'tasks',operation:action.operation,record_id:row?.id||null,expected:row?.updated_at||null,create_id:action.operation==='create'?crypto.randomUUID():null,actor:session.user.id,fields:Object.freeze(fields),assignee:member?{id:member.id,name:nameOf(member),email:member.email}:null,title:fields.title||row?.title};
  Object.freeze(d);prepared.add(d);return d;
 }
 async function saveDraft(d){
  assertEditor();if(!prepared.has(d)||d.actor!==session.user.id)throw error('CONFIRMATION_REQUIRED','Request a fresh task confirmation.');
  if(has(d.fields,'owner_member_id')&&d.fields.owner_member_id){const m=(await roster()).find(x=>x.id===d.fields.owner_member_id);if(!m||nameOf(m)!==d.assignee?.name||m.email!==d.assignee?.email)throw error('ADMIN_CHANGED','The admin details changed. Review a new task proposal before saving.');}
  const body={...d.fields};if(has(body,'owner_member_id')&&!body.owner_member_id){body.owner_name=null;body.owner_user_id=null;}
  let rows;
  if(DEMO){
   let row=d.record_id?array(data.tasks).find(t=>t.id===d.record_id):null;
   if(d.record_id&&(!row||(d.expected&&row.updated_at!==d.expected)))throw error('TASK_CHANGED','The task changed. Review a new proposal.');
   if(!row){row={id:d.create_id};(data.tasks||(data.tasks=[])).push(row);}Object.assign(row,body,{updated_at:new Date().toISOString()});if(has(body,'owner_member_id'))row.owner_name=d.assignee?.name||null;rows=[row];
  }else{
   let path='/rest/v1/tasks';
   if(d.operation==='update'){if(!d.expected)throw error('MISSING_VERSION','Refresh the task before updating it.');path+='?id=eq.'+encodeURIComponent(d.record_id)+'&updated_at=eq.'+encodeURIComponent(d.expected);}
   else body.id=d.create_id; // Repeated network submissions cannot create a second copy of this draft.
   rows=await request(path,{method:d.operation==='create'?'POST':'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(body)});
   if(!Array.isArray(rows)||rows.length!==1)throw error('TASK_CHANGED','The task or your access changed. This request saved no update. Refresh and review it again.');
  }
  prepared.delete(d);return rows[0];
 }
 function cancelTask(message){if(pending?.busy)return false;proposalSeq++;if(pending){pending.box.remove();pending=null;if(message)aiMessage('system',message);}return true;}
 async function proposeTask(action){
  if(pending?.busy)throw error('SAVE_IN_PROGRESS','Wait for the current task save to finish.');
  const sequence=++proposalSeq,d=await draft(action);if(sequence!==proposalSeq)return {status:'superseded',saved:false};
  if(pending)pending.box.remove();
  const assignment=has(d.fields,'owner_member_id');
  const summary=(d.operation==='create'?'Create task “':'Update task “')+d.title+'”'+(assignment?' — assigned to '+(d.assignee?.name||'Unassigned'):'')+'.';
  const display={...d.fields};if(assignment){delete display.owner_member_id;display.assigned_to=d.assignee?d.assignee.name+' ('+d.assignee.email+')':'Unassigned';}
  const box=document.createElement('div');box.className='proposal task-assignment-card task-change-card';
  box.innerHTML='<strong>CONFIRM TASK '+(d.operation==='create'?'CREATION':'UPDATE')+'</strong><p>'+esc(summary)+'</p><pre>'+esc(JSON.stringify(display,null,2))+'</pre><p class="task-admin-help">Nothing has been saved. Use Confirm Update, type “confirm task,” or say “confirm task” in a new Voice turn.</p><div class="proposal-actions"><button class="yes" type="button">Confirm Update</button><button class="no" type="button">Cancel</button></div>';
  $('#aiMessages').appendChild(box);pending={draft:d,box,summary,created:Date.now(),voiceSeq:voice.seq,busy:false};
  box.querySelector('.yes').onclick=()=>confirmTask().catch(e=>aiMessage('system',e.message));box.querySelector('.no').onclick=()=>cancelTask('Task change cancelled.');
  $('#aiMessages').scrollTop=$('#aiMessages').scrollHeight;
  return {status:'pending_human_confirmation',summary,saved:false,message:'The task card is displayed. Ask the user to say confirm task in a new turn or use Confirm Update.'};
 }
 async function confirmTask(){
  const p=pending;if(!p)throw error('NO_PENDING_TASK','There is no pending task change.');if(p.busy)throw error('SAVE_IN_PROGRESS','This task is already saving.');
  if(Date.now()-p.created>600000||p.draft.actor!==session?.user?.id){cancelTask();throw error('EXPIRED','That task confirmation expired. Please request it again.');}
  p.busy=true;p.box.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{const row=await saveDraft(p.draft);pending=null;p.box.remove();aiMessage('assistant','Saved: '+p.summary);if(!DEMO)try{await loadData();}catch{aiMessage('system','The task saved, but the page could not refresh. Reload the portal.');}renderPage();return {status:'saved',task_id:row.id,summary:p.summary};}
  catch(e){p.busy=false;p.box.querySelectorAll('button').forEach(b=>b.disabled=false);throw e;}
 }
 const oldProposal=showProposal;
 showProposal=function(action,summary){if(action?.entity_type!=='tasks')return oldProposal(action,summary);return proposeTask(action).catch(e=>{aiMessage('system',e.message+' No task was changed.');return {error:e.message,code:e.code};});};
 const oldExecute=executeAIAction;
 executeAIAction=function(action){if(action?.entity_type!=='tasks')return oldExecute(action);return Promise.reject(error('CONFIRMATION_REQUIRED','Use the new task confirmation card.'));};
 const oldSend=sendChatAI;
 sendChatAI=async function(fromVoice=false){
  const input=$('#aiInput'),t=input?.value.trim()||'';
  if(pending&&(yes(t)||no(t))){if(aiBusy)return;input.value='';aiMessage('user',t);if(no(t)){cancelTask('Task change cancelled.');return;}aiBusy=true;try{await confirmTask();}catch(e){aiMessage('system',e.message);}finally{aiBusy=false;}return;}
  if(pending&&t)cancelTask('Previous task draft cancelled before the new request.');return oldSend(fromVoice);
 };
 sendAI=()=>sendChatAI(false);
 editDefs.tasks=editDefs.tasks.map(f=>f[0]==='status'?['status',f[1],'select',['Not Started','In Progress','Decision Required','Blocked','Complete']]:f);
 const oldOpen=openEditor,oldClose=closeEditor,oldSave=saveEdit;
 openEditor=async function(entity,id){
  if(entity!=='tasks'||!editor()||!id)return oldOpen(entity,id);
  const generation=++opening;
  try{const row=await getTask(id);if(generation!==opening)return;const i=array(data.tasks).findIndex(t=>t.id===id);if(i>=0)data.tasks[i]=row;else (data.tasks||(data.tasks=[])).push(row);return oldOpen(entity,id);}catch(e){alert(e.message);}
 };
 closeEditor=function(){if(savingEditor)return;opening++;return oldClose();};
 saveEdit=async function(event){
  if(editing?.entity!=='tasks')return oldSave(event);event.preventDefault();if(savingEditor)return;
  const state=editing,fd=new FormData(event.target),fields={};for(const [key,,type]of editDefs.tasks){const v=fd.get(key);if(key==='owner_member_id'&&v==='__legacy__')continue;fields[key]=(type==='date'||key==='owner_member_id')?(v||null):v;}
  savingEditor=true;const btn=$('#editForm button[type="submit"]'),status=$('#editStatus');btn.disabled=true;status.textContent='Saving…';let saved=false;
  try{
   if(fields.owner_member_id&&fields.owner_member_id===state.row?.owner_member_id&&!(await roster()).some(m=>m.id===fields.owner_member_id))delete fields.owner_member_id;
   const d=await draft({entity_type:'tasks',operation:state.id?'update':'create',record_id:state.id,fields});
   if(state.id&&state.row?.updated_at!==d.expected)throw error('TASK_CHANGED','Someone changed this task while it was open. Close and reopen it before saving.');
   await saveDraft(d);saved=true;if(!DEMO)await loadData();savingEditor=false;closeEditor();renderPage();
  }catch(e){status.textContent=saved?'Saved, but refresh failed. Reload the portal before editing again.':e.message;}
  finally{savingEditor=false;btn.disabled=false;}
 };
 $('#editForm').onsubmit=e=>saveEdit(e);$('#editClose').onclick=$('#editCancel').onclick=closeEditor;
 const oldTools=realtimeV31Tools;
 realtimeV31Tools=function(){return [...oldTools(),
  {type:'function',name:'prepare_task_change',description:'Create a NEW task or update an existing live task, with optional admin assignment. Only prepares a confirmation card. Never use create when an existing task cannot be found; clarify first.',parameters:{type:'object',properties:{operation:{type:'string',enum:['create','update']},record_id:{type:['string','null']},fields_json:{type:'string',description:'JSON object: title, category, owner_member_id, due_date (YYYY-MM-DD), status, priority, notes. New tasks require title. Existing tasks require record_id.'}},required:['operation','record_id','fields_json'],additionalProperties:false}},
  {type:'function',name:'confirm_task_change',description:'Save the pending task creation/update ONLY after a new explicit human confirmation voice turn.',parameters:{type:'object',properties:{},required:[],additionalProperties:false}},
  {type:'function',name:'cancel_task_change',description:'Cancel the pending task change after the human says cancel.',parameters:{type:'object',properties:{},required:[],additionalProperties:false}}
 ];};
 const oldInstructions=rtV31Instructions;
 rtV31Instructions=function(){return oldInstructions()+'\nTASK CREATION AND EDITING: You can CREATE tasks as well as assign and update them, in voice and typed chat. For a new task use prepare_task_change(operation=create, record_id=null, fields_json with title and requested details). For updates read live tasks first. Use list_task_admins to resolve assignees. Optional due dates must be YYYY-MM-DD; never invent a missing person or task. Both task creation and task editing display a confirmation card. Read back the change, then wait for a NEW human confirmation and call confirm_task_change (the legacy confirm_task_assignment also works). Do not report saved until the tool confirms saved. Keep using all existing project, website, files, Drive, marketing, and external research tools for their supported duties and permissions.';};
 const oldEvents=handleRealtimeEvent;
 handleRealtimeEvent=function(event){
  try{const e=JSON.parse(event.data);if(e.type==='conversation.item.input_audio_transcription.completed'&&(e.item_id||e.event_id)&&(e.item_id||e.event_id)!==lastVoiceItem){lastVoiceItem=e.item_id||e.event_id;voice={seq:voice.seq+1,at:Date.now(),text:String(e.transcript||'')};if(pending&&!yes(voice.text)&&!no(voice.text))cancelTask('Previous task draft cancelled before the new voice request.');}}catch{}
  return oldEvents(event);
 };
 const oldRun=runRealtimeV31Tool;
 runRealtimeV31Tool=async function(item){
  let a;try{a=JSON.parse(item?.arguments||'{}');}catch{a=null;}
  const name=item?.name,isTaskProposal=name==='propose_project_update'&&a?.entity_type==='tasks';
  const own=['read_portal_section','search_portal','list_task_admins','prepare_task_change','prepare_task_assignment','confirm_task_change','confirm_task_assignment','cancel_task_change','cancel_task_assignment'].includes(name);
  if(!own&&!isTaskProposal)return oldRun(item);
  if(!item.call_id||rtHandledCalls.has(item.call_id))return;rtHandledCalls.add(item.call_id);let result;
  try{
   if(!a||typeof a!=='object'||Array.isArray(a))throw error('INVALID_ARGUMENTS','The tool arguments must be valid JSON.');
   if(name==='read_portal_section'||name==='search_portal'){
    const response=await fetch(TAYLOR_TOOLS_V31_URL,{method:'POST',headers:headers(),body:JSON.stringify({tool:name,args:a,context:{live_signups:contextObject(data,me).live_signups}})});
    const body=await parseResponse(response,'Live portal tool');if(!Array.isArray(body?.result))throw error('INVALID_TOOL_RESULT','The portal tool returned an unexpected structure.');result=body.result;
   }else if(name==='list_task_admins')result={admins:(await roster()).map(m=>({id:m.id,display_name:m.display_name,email:m.email,role:m.role,setup_pending:!m.user_id}))};
   else if(name==='prepare_task_assignment')result=await proposeTask({entity_type:'tasks',operation:'update',record_id:a.task_id,fields:{owner_member_id:a.member_id}});
   else if(name==='prepare_task_change'||isTaskProposal)result=await proposeTask({entity_type:'tasks',operation:a.operation,record_id:a.record_id,fields:JSON.parse(a.fields_json||'{}')});
   else if(name.startsWith('confirm_')){if(!pending||voice.seq<=pending.voiceSeq||Date.now()-voice.at>=30000||!yes(voice.text))throw error('NEW_CONFIRMATION_REQUIRED','Ask the user to say confirm task in a new voice turn first.');result=await confirmTask();}
   else{if(!pending||voice.seq<=pending.voiceSeq||Date.now()-voice.at>=30000||!no(voice.text))throw error('NEW_CANCELLATION_REQUIRED','Wait for the user to cancel this task.');cancelTask('Task change cancelled.');result={status:'cancelled',saved:false};}
  }catch(e){result={error:e.message||'Task tool failed.',code:e.code||'TASK_TOOL_ERROR',saved:false};}
  if(rtDc?.readyState==='open'){rtDc.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:outputJSON(result)}}));rtDc.send(JSON.stringify({type:'response.create'}));}
 };
 function stamp(){document.querySelectorAll('.portal-version').forEach(e=>e.textContent='v'+VERSION);document.querySelectorAll('button,span,a').forEach(e=>{if(e.childElementCount===0&&/^PORTAL V\d+\.\d+\.\d+$/i.test(e.textContent.trim()))e.textContent='PORTAL V'+VERSION;});}
 const oldRender=renderPage;renderPage=function(){const r=oldRender();stamp();return r;};queueMicrotask(stamp);
})(globalThis);

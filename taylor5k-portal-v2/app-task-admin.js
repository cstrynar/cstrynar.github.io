/* Taylor Portal v3.3.0: member-backed assignments, admin invitations and voice confirmation. */
(function(global){
  'use strict';
  const VERSION='3.3.0';
  const normalize=v=>String(v??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
  const eligible=rows=>(rows||[]).filter(m=>m.active===true&&['admin','super_admin'].includes(m.role))
    .sort((a,b)=>String(a.display_name||a.email).localeCompare(String(b.display_name||b.email)));
  function resolveMember(value,rows,self){
    const q=normalize(value);if(['','unassigned','none','tbd'].includes(q))return null;
    const candidates=eligible(rows);
    if(['me','myself'].includes(q)){
      const own=candidates.find(m=>m.id===self?.id||(self?.user_id&&m.user_id===self.user_id));
      if(!own)throw Error('Your account is not an active task assignee.');return own;
    }
    const exactId=candidates.find(m=>m.id===value||normalize(m.email)===q);
    if(exactId)return exactId;
    const matches=candidates.filter(m=>normalize(m.display_name)===q||
      (!q.includes(' ')&&normalize(m.display_name).replace(/^dr\.?\s+/,'').split(' ')[0]===q));
    if(matches.length===1)return matches[0];
    if(matches.length>1)throw Error('More than one admin matches '+value+'. Please choose: '+matches.map(m=>(m.display_name||m.email)+' ('+m.email+')').join('; '));
    throw Error('No active admin matches '+value+'. Add the person as an admin first, or use their full name or email.');
  }
  const affirmative=t=>/^(yes(?: please)?|yes[, ]+(?:confirm(?: (?:the )?assignment)?|assign(?: it)?|go ahead|do it)|confirm(?: (?:the )?(?:assignment|task|update))?|assign it|go ahead|do it)[.!?\s]*$/i.test(String(t||'').trim());
  const negative=t=>/^(no(?: thanks)?|cancel(?: (?:the )?(?:assignment|task|update))?|never mind|nevermind)[.!?\s]*$/i.test(String(t||'').trim());
  const freshVoice=(turn,pending,now)=>!!pending&&turn.seq>pending.voiceSeq&&now-turn.at<30000&&affirmative(turn.text);
  global.TaylorTaskAdminUtils={eligible,resolveMember,affirmative,negative,freshVoice,version:VERSION};
  if(!global.document)return;

  const manager=()=>me?.active!==false&&['admin','super_admin'].includes(me?.role);
  const editor=()=>me?.active!==false&&['admin','super_admin','editor'].includes(me?.role);
  const nameOf=m=>m?.display_name||m?.email||'Unassigned';
  let pending=null, voiceTurn={seq:0,at:0,text:''}, inviteReturn=null, taskSaving=false;
  const style=document.createElement('style');
  style.textContent='.task-admin-help{font-size:12px;line-height:1.5;margin:7px 0;color:#6d6471}.task-admin-tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 16px}.task-admin-tools p{margin:0;flex:1;min-width:220px}.task-admin-add{margin-top:8px}.admin-invite-modal{z-index:1600}.admin-invite-modal .modal-card{max-width:600px}.admin-invite-modal .form-message{white-space:pre-wrap;font-size:14px;line-height:1.5}.task-assignment-card p{font-size:14px!important;line-height:1.6}.task-assignment-card .proposal-actions{display:flex;gap:12px}.task-assignment-card button{min-height:40px}.task-assignment-card pre{white-space:pre-wrap;font-size:12px}';
  document.head.appendChild(style);
  const invite=document.createElement('div');invite.id='adminInviteModal';invite.className='modal admin-invite-modal';invite.setAttribute('aria-hidden','true');
  invite.innerHTML='<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="adminInviteHeading"><div class="modal-head"><div><p class="eyebrow">TEAM & ACCESS</p><h2 id="adminInviteHeading">Add Admin</h2></div><button class="modal-close" id="adminInviteClose" type="button" aria-label="Close invitation">×</button></div><p class="task-admin-help">Add a trusted team member. They will receive Admin access, including the ability to edit portal planning records and invite other admins. Super Admin controls stay protected.</p><form id="adminInviteForm"><div class="form-grid"><div class="field"><label for="adminInviteName">Name</label><input id="adminInviteName" name="display_name" required maxlength="160" autocomplete="name"></div><div class="field"><label for="adminInviteEmail">Email</label><input id="adminInviteEmail" name="email" type="email" required maxlength="320" autocomplete="email"></div></div><div id="adminInviteStatus" class="form-message" role="status" aria-live="polite"></div><div class="modal-actions"><button class="button ghost" id="adminInviteCancel" type="button">Close</button><button class="button primary" id="adminInviteSave" type="submit">Add Admin & Send Invite</button></div></form></div>';
  document.body.appendChild(invite);
  function closeInvite(){invite.classList.remove('open');invite.setAttribute('aria-hidden','true');inviteReturn?.focus?.();}
  function openInvite(){
    if(!manager())return;
    inviteReturn=document.activeElement;$('#adminInviteForm').reset();$('#adminInviteStatus').textContent='';
    $('#adminInviteSave').disabled=false;invite.classList.add('open');invite.setAttribute('aria-hidden','false');$('#adminInviteName').focus();
  }
  $('#adminInviteClose').onclick=$('#adminInviteCancel').onclick=closeInvite;
  invite.onclick=e=>{if(e.target===invite)closeInvite();};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&invite.classList.contains('open')){e.stopPropagation();closeInvite();}});
  async function refreshMembers(){
    if(DEMO)return eligible(data.team_members);
    const rows=await api('/rest/v1/team_members?select=id,user_id,display_name,email,role,active,protected,added_at&active=eq.true&order=display_name.asc');
    data.team_members=[...(data.team_members||[]).filter(x=>!x.active),...rows];
    return eligible(rows);
  }
  $('#adminInviteForm').onsubmit=async e=>{
    e.preventDefault();if(!manager())return;
    const btn=$('#adminInviteSave'),status=$('#adminInviteStatus');btn.disabled=true;status.textContent='Adding admin…';
    const body={action:'add_admin',display_name:$('#adminInviteName').value.trim(),email:$('#adminInviteEmail').value.trim()};
    let result;
    try{
      if(DEMO){const member={...body,id:'demo-admin-'+Date.now(),role:'admin',active:true,user_id:null};data.team_members.push(member);result={ok:true,member,email_delivery:{sent:false},message:'Preview only: admin added locally. No email was sent.'};}
      else{const r=await fetch(BASE+'/functions/v1/taylor5k-team-admin',{method:'POST',headers:headers(),body:JSON.stringify(body)});result=await r.json();if(!r.ok||!result.ok)throw Error(result.error||'Could not add this admin.');}
      const m=result.member;
      data.team_members=(data.team_members||[]).filter(x=>x.id!==m.id).concat(m);
      status.textContent=(result.message||'Admin added.')+'\n'+nameOf(m)+' is available in the task dropdown.';
      if(editing?.entity==='tasks'){const select=$('#editFields [name="owner_member_id"]');if(select){select.innerHTML=ownerOptions(editing.row,m.id);select.value=m.id;}}
      renderPage();
      // Leave the delivery result visible; never present a failed email as sent.
    }catch(err){status.textContent=err.message||'Could not add admin.';btn.disabled=false;}
  };
  function stampVersion(){
    document.querySelectorAll('.portal-version').forEach(el=>{el.textContent='v'+VERSION;});
    document.querySelectorAll('button,span,a').forEach(el=>{if(el.childElementCount===0&&/^PORTAL V\d+\.\d+\.\d+$/i.test(el.textContent.trim()))el.textContent='PORTAL V'+VERSION;});
  }
  const oldRender=renderPage;
  renderPage=function(){
    const result=oldRender();stampVersion();
    if(manager()&&['team','admin'].includes(currentPage)&&!$('#taskAdminToolbar')){
      const bar=document.createElement('div');bar.id='taskAdminToolbar';bar.className='task-admin-tools';
      bar.innerHTML='<button class="button primary" type="button">+ Add Admin</button><p class="task-admin-help">Add the person as an admin first, then choose them in a task’s Assigned to dropdown. Pending invitations can receive tasks.</p>';
      bar.querySelector('button').onclick=openInvite;$('#content').prepend(bar);
    }
    return result;
  };
  function selectedMember(row){
    if(row?.owner_member_id)return row.owner_member_id;
    const q=normalize(row?.owner_name);
    const matches=eligible(data.team_members).filter(m=>normalize(nameOf(m))===q||normalize(m.email)===q);
    return matches.length===1?matches[0].id:(q&&!['unassigned','tbd'].includes(q)?'__legacy__':'');
  }
  function ownerOptions(row,selected=selectedMember(row)){
    const members=eligible(data.team_members);
    let html='<option value=""'+(!selected?' selected':'')+'>Unassigned</option>';
    if(selected==='__legacy__')html+='<option value="__legacy__" selected>'+esc(row?.owner_name||'Legacy owner')+' — keep existing</option>';
    else if(selected&&!members.some(m=>m.id===selected))html+='<option value="'+esc(selected)+'" selected>'+esc(row?.owner_name||'Previous admin')+' — no longer active</option>';
    return html+members.map(m=>'<option value="'+esc(m.id)+'"'+(m.id===selected?' selected':'')+'>'+esc(nameOf(m))+' — '+esc(m.email)+(m.user_id?'':' (invited / setup pending)')+'</option>').join('');
  }
  editDefs.tasks=editDefs.tasks.map(f=>f[0]==='owner_name'?['owner_member_id','Assigned to','admin-member']:f);
  const oldField=fieldHTML;
  fieldHTML=function(field,row){
    if(field[2]!=='admin-member')return oldField(field,row);
    return '<div class="field"><label for="taskOwnerMember">Assigned to</label><select id="taskOwnerMember" name="owner_member_id">'+ownerOptions(row)+'</select><div class="task-admin-help" id="taskAdminHelp" role="status">Active admins, including pending invitations.</div>'+(manager()?'<button class="button ghost task-admin-add" id="taskAddAdmin" type="button">+ Add Admin</button>':'')+'</div>';
  };
  const oldOpen=openEditor;
  openEditor=function(entity,id){
    oldOpen(entity,id);if(entity!=='tasks'||editing?.entity!=='tasks')return;
    const current=editing;
    $('#taskAddAdmin')?.addEventListener('click',openInvite);
    const save=$('#editForm button[type="submit"]');if(save)save.disabled=true;
    refreshMembers().then(()=>{if(editing!==current)return;const select=$('#taskOwnerMember');if(select)select.innerHTML=ownerOptions(current.row);if(save)save.disabled=false;}).catch(err=>{if(editing===current)$('#taskAdminHelp').textContent='Could not load the admin list. Close and reopen this task to retry. '+err.message;});
  };
  const taskKeys=['title','category','owner_member_id','due_date','status','priority','notes'];
  async function writeTask(id,fields,expected){
    if(!editor())throw Error('Sign in with a portal account that can edit tasks.');
    const body={};for(const k of taskKeys)if(Object.prototype.hasOwnProperty.call(fields,k))body[k]=fields[k];
    if(!Object.keys(body).length)throw Error('No task changes were provided.');
    if('owner_member_id'in body){body.owner_member_id=body.owner_member_id||null;if(body.owner_member_id){
      const m=eligible(data.team_members).find(x=>x.id===body.owner_member_id);
      if(!m){const old=(data.tasks||[]).find(t=>t.id===id);if(old?.owner_member_id===body.owner_member_id)delete body.owner_member_id;else throw Error('Choose an active admin or Unassigned.');}
    }}
    if(!id&&!String(body.title||'').trim())throw Error('Enter a task title.');
    if(DEMO){
      const row=id?(data.tasks||[]).find(t=>t.id===id):{id:'demo-task-'+Date.now()};if(!row)throw Error('Task not found.');
      Object.assign(row,body);if('owner_member_id'in body){const m=(data.team_members||[]).find(x=>x.id===body.owner_member_id);row.owner_name=m?nameOf(m):null;row.owner_user_id=m?.user_id||null;}
      row.updated_at=new Date().toISOString();if(!id)data.tasks.push(row);return row;
    }
    let path='/rest/v1/tasks';
    if(id)path+='?id=eq.'+encodeURIComponent(id)+(expected?'&updated_at=eq.'+encodeURIComponent(expected):'');
    const result=await api(path,{method:id?'PATCH':'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(body)});
    if(!Array.isArray(result)||result.length!==1)throw Error('The task changed or your access changed. Refresh and review the latest task before saving.');
    return result[0];
  }
  const oldSave=saveEdit;
  saveEdit=async function(e){
    if(editing?.entity!=='tasks')return oldSave(e);
    e.preventDefault();if(taskSaving)return;const state=editing,fd=new FormData(e.target),fields={};
    for(const [key,,type] of editDefs.tasks){const value=fd.get(key);if(key==='owner_member_id'&&value==='__legacy__')continue;fields[key]=(key==='owner_member_id'||type==='date')?(value||null):value;}
    taskSaving=true;const btn=$('#editForm button[type="submit"]');btn.disabled=true;$('#editStatus').textContent='Saving…';
    try{await writeTask(state.id,fields,state.row?.updated_at);if(!DEMO)await loadData();closeEditor();renderPage();}
    catch(err){$('#editStatus').textContent=err.message||'Task save failed.';}
    finally{taskSaving=false;btn.disabled=false;}
  };
  $('#editForm').onsubmit=e=>saveEdit(e);

  aiFieldAllow.tasks=[...new Set([...aiFieldAllow.tasks,'owner_member_id'])];
  const oldContext=portalContext;
  portalContext=function(){
    let value={};try{value=JSON.parse(oldContext());}catch{}
    value.member_summary={...(value.member_summary||{}),task_assignment_policy:'Assigning an existing active admin to a task is a planning update, NOT a role/access change. Read tasks and team_members, resolve names unambiguously, and propose a tasks update with owner_member_id set to the team_members.id. Never guess between matching names. Newly invited admins are assignable. The user can confirm the assignment by voice or button. New admin invitations use the Add Admin form, not AI.',assignable_admins:eligible(data.team_members).map(m=>({id:m.id,display_name:m.display_name,email:m.email,user_id:m.user_id||null,role:m.role})),current_member_id:me?.id||null};
    // Keep valid JSON below the agent's input limit; it can retrieve full live records.
    const context=JSON.stringify({member_summary:value.member_summary,...value});
    if(context.length<=65000)return context;
    return JSON.stringify({member_summary:value.member_summary,event:value.event,role:me?.role,live_signups:(value.live_signups||[]).slice(0,50)});
  };
  const hasAssignment=a=>a?.entity_type==='tasks'&&['owner_name','owner_member_id','owner_user_id'].some(k=>Object.prototype.hasOwnProperty.call(a.fields||{},k));
  async function normalizedTaskAction(action){
    if(!editor())throw Error('Your portal account cannot change task assignments.');
    await refreshMembers();let row=null;
    if(action.operation!=='create'){
      if(!action.record_id)throw Error('Choose the task to assign.');
      row=DEMO?(data.tasks||[]).find(t=>t.id===action.record_id):(await api('/rest/v1/tasks?select=*&id=eq.'+encodeURIComponent(action.record_id)))[0];
      if(!row)throw Error('That task no longer exists or is not accessible.');
    }
    const fields=sanitizeAIFields('tasks',action.fields||{});
    if(Object.prototype.hasOwnProperty.call(action.fields||{},'owner_member_id')){
      const id=action.fields.owner_member_id;
      if(id&&!eligible(data.team_members).some(m=>m.id===id))throw Error('That person is not an active admin.');fields.owner_member_id=id||null;
    }else if(Object.prototype.hasOwnProperty.call(action.fields||{},'owner_user_id')){
      const uid=action.fields.owner_user_id;const m=eligible(data.team_members).find(x=>x.user_id&&x.user_id===uid);
      if(uid&&!m)throw Error('That account is not an active admin.');fields.owner_member_id=m?.id||null;
    }else if(Object.prototype.hasOwnProperty.call(fields,'owner_name'))fields.owner_member_id=resolveMember(fields.owner_name,data.team_members,me)?.id||null;
    delete fields.owner_name;delete fields.owner_user_id;
    return {action:{...action,fields},row};
  }
  const oldExecute=executeAIAction;
  executeAIAction=async function(action){
    if(action?.entity_type!=='tasks')return oldExecute(action);
    const normalized=await normalizedTaskAction(action);
    return writeTask(action.operation==='create'?null:action.record_id,normalized.action.fields,normalized.row?.updated_at);
  };
  function cancelPending(message){if(pending){pending.box.remove();pending=null;if(message)aiMessage('system',message);}}
  async function prepareAssignment(action){
    const {action:clean,row}=await normalizedTaskAction(action);
    if(!Object.prototype.hasOwnProperty.call(clean.fields,'owner_member_id'))throw Error('Specify the admin for this task assignment.');
    const member=(data.team_members||[]).find(m=>m.id===clean.fields.owner_member_id);
    const title=clean.fields.title||row?.title||'New task';const summary=member?'Assign “'+title+'” to '+nameOf(member)+' ('+member.email+').':'Mark “'+title+'” as unassigned.';
    cancelPending('The previous assignment draft was replaced.');
    const box=document.createElement('div');box.className='proposal task-assignment-card';
    box.innerHTML='<strong>CONFIRM TASK ASSIGNMENT</strong><p>'+esc(summary)+'</p><pre>'+esc(JSON.stringify(Object.fromEntries(Object.entries(clean.fields).filter(([k])=>k!=='owner_member_id')),null,2))+'</pre><p class="task-admin-help">Say “confirm assignment” in Voice, type it below, or use the button. Nothing is saved yet.</p><div class="proposal-actions"><button class="yes" type="button">Confirm Assignment</button><button class="no" type="button">Cancel</button></div>';
    $('#aiMessages').appendChild(box);
    pending={action:clean,row,box,summary,actor:session?.user?.id,created:Date.now(),voiceSeq:voiceTurn.seq,busy:false};
    box.querySelector('.no').onclick=()=>cancelPending('Assignment cancelled.');
    box.querySelector('.yes').onclick=()=>confirmAssignment().catch(err=>aiMessage('system',err.message));
    $('#aiMessages').scrollTop=$('#aiMessages').scrollHeight;
    return {status:'pending_human_confirmation',summary,message:'Ask the user to say confirm assignment. No change has been saved.'};
  }
  async function confirmAssignment(){
    const p=pending;if(!p)throw Error('There is no pending task assignment.');if(p.busy)throw Error('This assignment is already saving.');
    if(Date.now()-p.created>600000||p.actor!==session?.user?.id){cancelPending();throw Error('That assignment confirmation expired. Please request it again.');}
    p.busy=true;p.box.querySelectorAll('button').forEach(b=>{b.disabled=true;});
    try{
      await refreshMembers();const memberId=p.action.fields.owner_member_id;
      if(memberId&&!eligible(data.team_members).some(m=>m.id===memberId))throw Error('The selected admin is no longer active. Choose a different admin.');
      const row=await writeTask(p.action.operation==='create'?null:p.action.record_id,p.action.fields,p.row?.updated_at);
      if(pending===p)pending=null;p.box.remove();const text='Saved: '+p.summary;aiMessage('assistant',text);
      if(!DEMO){try{await loadData();}catch{aiMessage('system','The assignment saved, but the page could not refresh. Reload the portal.');}}
      renderPage();return {status:'saved',task_id:row.id,summary:p.summary};
    }catch(err){p.busy=false;p.box.querySelectorAll('button').forEach(b=>{b.disabled=false;});throw err;}
  }
  const oldProposal=showProposal;
  showProposal=function(action,summary){if(!hasAssignment(action))return oldProposal(action,summary);return prepareAssignment(action).catch(err=>aiMessage('system',err.message));};
  const oldSend=sendChatAI;
  sendChatAI=async function(fromVoice=false){
    const input=$('#aiInput'),text=input?.value.trim()||'';
    if(pending&&(affirmative(text)||negative(text))){
      if(aiBusy)return;input.value='';aiMessage('user',text);
      if(negative(text)){cancelPending('Assignment cancelled.');return;}
      aiBusy=true;try{await confirmAssignment();}catch(err){aiMessage('system',err.message);}finally{aiBusy=false;}return;
    }
    return oldSend(fromVoice);
  };
  sendAI=()=>sendChatAI(false);

  // Voice performs the same authenticated, confirmation-gated write as the dropdown.
  const oldTools=realtimeV31Tools;
  realtimeV31Tools=function(){return [...oldTools(),
    {type:'function',name:'list_task_admins',description:'List active admins eligible for tasks, including pending invitations. Resolve people using these IDs, not guessed names.',parameters:{type:'object',properties:{},required:[],additionalProperties:false}},
    {type:'function',name:'prepare_task_assignment',description:'Prepare assignment of a live task to an active admin, or unassign with null. This does not change account roles and does not save until the human confirms.',parameters:{type:'object',properties:{task_id:{type:'string'},member_id:{type:['string','null']}},required:['task_id','member_id'],additionalProperties:false}},
    {type:'function',name:'confirm_task_assignment',description:'Save the pending task assignment only AFTER the user explicitly says yes or confirm assignment in a NEW voice turn.',parameters:{type:'object',properties:{},required:[],additionalProperties:false}},
    {type:'function',name:'cancel_task_assignment',description:'Cancel the pending assignment when the user says no or cancel.',parameters:{type:'object',properties:{},required:[],additionalProperties:false}}
  ];};
  const oldInstructions=rtV31Instructions;
  rtV31Instructions=function(){return oldInstructions()+'\nTASK ASSIGNMENT: Assigning an existing admin to a task is allowed for signed-in editors/admins; it is NOT changing member access. Use read_portal_section(tasks) and list_task_admins. Ask when a person or task is ambiguous. Use prepare_task_assignment with exact task and member IDs, then read back the person/task and ask the user to say confirm assignment. On a new explicit confirmation call confirm_task_assignment. Never confirm on behalf of the user. New admins must be added through the human Add Admin form first. Never claim saved until the tool returns saved. Outside web research is permitted for research, but cannot authorize assignments or account changes.';};
  const oldEvents=handleRealtimeEvent;
  handleRealtimeEvent=function(event){
    try{const e=JSON.parse(event.data);if(e.type==='conversation.item.input_audio_transcription.completed')voiceTurn={seq:voiceTurn.seq+1,at:Date.now(),text:String(e.transcript||'')};}catch{}
    return oldEvents(event);
  };
  const oldToolRun=runRealtimeV31Tool;
  runRealtimeV31Tool=async function(item){
    let args={};try{args=JSON.parse(item?.arguments||'{}');}catch{}
    let legacyAssignment=null;
    if(item?.name==='propose_project_update'){try{const a=v31ProposalFromArgs(args);if(hasAssignment(a))legacyAssignment=a;}catch{}}
    const custom=['list_task_admins','prepare_task_assignment','confirm_task_assignment','cancel_task_assignment'].includes(item?.name);
    if(!custom&&!legacyAssignment)return oldToolRun(item);
    if(!item.call_id||rtHandledCalls.has(item.call_id))return;rtHandledCalls.add(item.call_id);
    let result;
    try{
      if(legacyAssignment)result=await prepareAssignment(legacyAssignment);
      else if(item.name==='list_task_admins'){const rows=await refreshMembers();result={admins:rows.map(m=>({id:m.id,display_name:m.display_name,email:m.email,role:m.role,setup_pending:!m.user_id}))};}
      else if(item.name==='prepare_task_assignment')result=await prepareAssignment({entity_type:'tasks',operation:'update',record_id:args.task_id,fields:{owner_member_id:args.member_id}});
      else if(item.name==='confirm_task_assignment'){
        if(!freshVoice(voiceTurn,pending,Date.now()))throw Error('Ask the user to say confirm assignment in a new voice turn before saving.');
        result=await confirmAssignment();
      }else{if(!negative(voiceTurn.text)||Date.now()-voiceTurn.at>30000)throw Error('Wait for the user to cancel.');cancelPending('Assignment cancelled.');result={status:'cancelled'};}
    }catch(err){result={error:err.message||'Task assignment failed.'};}
    if(rtDc?.readyState==='open'){
      rtDc.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify(result)}}));rtDc.send(JSON.stringify({type:'response.create'}));
    }
  };
  queueMicrotask(stampVersion);
})(globalThis);

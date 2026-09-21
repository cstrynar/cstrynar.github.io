/* Task assignment is a core editor feature, not dependent on the optional AI/admin extensions. */
let coreTaskSaving=false;
const coreTaskNorm=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
function coreTaskAdmins(rows=data.team_members){return (Array.isArray(rows)?rows:[]).filter(m=>m?.active===true&&['admin','super_admin'].includes(m.role)).sort((a,b)=>String(a.display_name||a.email).localeCompare(String(b.display_name||b.email)))}
function coreTaskSelected(row,rows=data.team_members){
  if(row?.owner_member_id)return row.owner_member_id;
  const q=coreTaskNorm(row?.owner_name);
  if(!q||['unassigned','tbd'].includes(q))return '';
  const matches=coreTaskAdmins(rows).filter(m=>coreTaskNorm(m.display_name)===q||coreTaskNorm(m.email)===q);
  return matches.length===1?matches[0].id:'__legacy__';
}
function coreTaskOwnerOptions(row,selected=coreTaskSelected(row),rows=data.team_members){
  const members=coreTaskAdmins(rows);
  let html='<option value=""'+(!selected?' selected':'')+'>Unassigned</option>';
  if(selected==='__legacy__')html+='<option value="__legacy__" selected>'+esc(row?.owner_name||'Existing owner')+' — keep existing</option>';
  else if(selected&&!members.some(m=>m.id===selected))html+='<option value="'+esc(selected)+'" selected>'+esc(row?.owner_name||'Previous admin')+' — keep existing (not active)</option>';
  return html+members.map(m=>'<option value="'+esc(m.id)+'"'+(m.id===selected?' selected':'')+'>'+esc(m.display_name||m.email)+' — '+esc(m.email)+(m.user_id?'':' (invited / setup pending)')+'</option>').join('');
}
async function coreTaskRoster(){
  if(DEMO)return coreTaskAdmins();
  const rows=await api('/rest/v1/team_members?select=id,user_id,display_name,email,role,active&active=eq.true&role=in.(admin,super_admin)&order=display_name.asc');
  if(!Array.isArray(rows))throw Error('The admin list could not be read.');
  return coreTaskAdmins(rows);
}
async function refreshCoreTaskOwners(state){
  const select=$('#taskOwnerMember'),help=$('#taskOwnerHelp'),retry=$('#taskOwnerRetry'),save=$('#editForm button[type="submit"]');
  if(!select||!help)return;
  state.coreRosterReady=false;select.disabled=true;save.disabled=true;retry.hidden=true;help.textContent='Loading current admins…';
  try{
    const members=await coreTaskRoster();if(editing!==state)return;
    state.coreRosterReady=true;
    select.innerHTML=coreTaskOwnerOptions(state.row,coreTaskSelected(state.row,members),members);
    select.disabled=false;save.disabled=false;
    help.textContent='Choose an Admin or Super Admin, including pending invitations, or leave Unassigned.';
  }catch(err){
    if(editing!==state)return;
    help.textContent='Could not load admins. Existing assignment has not changed. '+(err.message||'Please retry.');retry.hidden=false;
  }
}
async function saveCoreTask(event){
  event.preventDefault();if(coreTaskSaving||editing?.entity!=='tasks')return;
  const state=editing,btn=$('#editForm button[type="submit"]'),status=$('#editStatus');
  if(!canEdit('tasks')||me?.active===false){status.textContent='Your account cannot edit tasks.';return}
  if($('#taskOwnerHelp')&&!state.coreRosterReady){status.textContent='Load the admin list before saving.';return}
  const fd=new FormData(event.target),fields={};
  for(const [key,,type] of editDefs.tasks){const v=fd.get(key);if(key==='owner_member_id'&&v==='__legacy__')continue;fields[key]=(key==='owner_member_id'||type==='date')?(v||null):v}
  if(!String(fields.title||'').trim()){status.textContent='Enter a task title.';return}
  if(!['Critical','High','Medium','Low'].includes(fields.priority)||!['Not Started','In Progress','Decision Required','Blocked','Complete'].includes(fields.status)){status.textContent='Choose a valid task priority and status.';return}
  coreTaskSaving=true;btn.disabled=true;status.textContent='Saving…';let saved=false;
  try{
    if(Object.prototype.hasOwnProperty.call(fields,'owner_member_id')){
      if(fields.owner_member_id){
        const member=(await coreTaskRoster()).find(m=>m.id===fields.owner_member_id);
        if(!member){if(state.id&&fields.owner_member_id===state.row?.owner_member_id)delete fields.owner_member_id;else throw Error('That admin is no longer active. Close and reopen this task.');}
      }else{fields.owner_name=null;fields.owner_user_id=null}
    }
    let row;
    if(DEMO){
      row=state.id?(data.tasks||[]).find(t=>t.id===state.id):null;
      if(state.id&&(!row||row.updated_at!==state.row?.updated_at))throw Error('This task changed. Close and reopen it before saving.');
      if(!row){row={id:state.coreCreateId||(state.coreCreateId=crypto.randomUUID())};(data.tasks||(data.tasks=[])).push(row)}
      Object.assign(row,fields,{updated_at:new Date().toISOString()});
      if(Object.prototype.hasOwnProperty.call(fields,'owner_member_id')){const member=coreTaskAdmins().find(m=>m.id===fields.owner_member_id);row.owner_name=member?.display_name||member?.email||null;row.owner_user_id=member?.user_id||null}
    }else{
      if(!session?.user?.id)throw Error('Sign in to the portal before saving.');
      let path='/rest/v1/tasks';
      if(state.id){if(!state.row?.updated_at)throw Error('Refresh this task before saving.');path+='?id=eq.'+encodeURIComponent(state.id)+'&updated_at=eq.'+encodeURIComponent(state.row.updated_at)}
      else fields.id=state.coreCreateId||(state.coreCreateId=crypto.randomUUID());
      const rows=await api(path,{method:state.id?'PATCH':'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(fields)});
      if(!Array.isArray(rows)||rows.length!==1)throw Error('The task or your access changed. No update was confirmed. Close and reopen it.');
      row=rows[0];
    }
    saved=true;if(!DEMO)await loadData();coreTaskSaving=false;closeEditor();renderPage();
  }catch(err){status.textContent=saved?'Saved, but the page could not refresh. Reload before editing again.':(err.message||'Task save failed.')}
  finally{coreTaskSaving=false;btn.disabled=false}
}

const editDefs={tasks:[['title','Task','text'],['category','Area','text'],['owner_member_id','Assigned to','admin-member'],['priority','Priority','select',['Critical','High','Medium','Low']],['status','Status','select',['Not Started','In Progress','Decision Required','Blocked','Complete']],['notes','Notes','textarea']],permits:[['approval','Approval / Compliance','text'],['authority','Authority','text'],['owner_name','Owner','text'],['status','Status','select',['Not Started','In Progress','Submitted','Approved','Not Required','Denied']],['notes','Notes','textarea']],sponsors:[['name','Sponsor','text'],['stage','Stage','text'],['level','Level','text'],['ask_amount','Ask Amount','number'],['committed_amount','Committed','number'],['paid_amount','Paid','number'],['owner_name','Owner','text'],['notes','Notes','textarea']],sponsor_opportunities:[['opportunity_type','Type','text'],['name','Opportunity','text'],['target_amount','Target Amount','number'],['status','Status','text']],decisions:[['title','Decision','text'],['status','Status','text'],['context','Why It Matters','textarea'],['decision','Decision / Outcome','textarea']],budget_lines:[['line_type','Type','select',['Revenue','Expense']],['category','Category','text'],['item','Item','text'],['budget_amount','Budget Amount','number'],['actual_amount','Actual Amount','number'],['paid_status','Paid Status','text']],festival_items:[['name','Experience / Item','text'],['status','Status','text'],['funding_source','Funding Source','text'],['owner_name','Owner','text'],['vendor','Vendor','text'],['notes','Notes','textarea']],swag_items:[['item','Item','text'],['audience','Audience','text'],['status','Status','text'],['unit_cost','Unit Cost','number'],['quantity','Quantity','number'],['vendor','Vendor','text'],['notes','Notes','textarea']],team_members:[['display_name','Name','text'],['email','Email','email'],['role','Role','select',['viewer','editor','admin','super_admin']],['active','Active','select',['true','false']]]};
function openEditor(entity,id=null){
  if(!canEdit(entity)){alert('Your portal role is read-only for this area.');return}
  const fields=editDefs[entity];if(!fields)return;
  const found=id?(data[entity]||[]).find(x=>String(x.id)===String(id)):(entity==='tasks'?{priority:'Medium',status:'Not Started'}:{});
  if(id&&!found){alert('That record is no longer available. Refresh the portal.');return}
  editing={entity,id,row:{...found}};
  $('#editTitle').textContent=(id?'Edit ':'Add ')+(entity.replaceAll('_',' '));
  $('#editFields').innerHTML=fields.map(f=>fieldHTML(f,editing.row)).join('');
  $('#editStatus').textContent='';$('#editForm button[type="submit"]').disabled=false;
  $('#editModal').classList.add('open');$('#editModal').setAttribute('aria-hidden','false');
  // app-task-admin supplies its own refreshed roster and invitation controls when loaded.
  // Otherwise the same member-backed dropdown and guarded save work independently here.
  if(entity==='tasks'&&$('#taskOwnerHelp')){const state=editing;$('#taskOwnerRetry').onclick=()=>refreshCoreTaskOwners(state);refreshCoreTaskOwners(state)}
}
function fieldHTML([key,label,type,opts],row){let v=row?.[key]??'';if(type==='admin-member')return '<div class="field"><label for="taskOwnerMember">Assigned to</label><select id="taskOwnerMember" name="owner_member_id" aria-describedby="taskOwnerHelp">'+coreTaskOwnerOptions(row)+'</select><div id="taskOwnerHelp" class="form-message" role="status" aria-live="polite">Loading current admins…</div><button id="taskOwnerRetry" class="button ghost" type="button" hidden>Retry admin list</button></div>';if(type==='textarea')return `<div class="field full"><label>${label}</label><textarea name="${key}">${esc(v)}</textarea></div>`;if(type==='select')return `<div class="field"><label>${label}</label><select name="${key}">${opts.map(o=>`<option value="${esc(o)}" ${String(v)===String(o)?'selected':''}>${esc(o)}</option>`).join('')}</select></div>`;return `<div class="field"><label>${label}</label><input name="${key}" type="${type}" value="${esc(v)}" ${type==='number'?'step="any"':''}/></div>`}
async function saveEdit(e){e.preventDefault();if(!editing)return;if(editing.entity==='tasks')return saveCoreTask(e);const {entity,id}=editing,fd=new FormData(e.target),body={};for(const [key,label,type] of editDefs[entity]){let v=fd.get(key);if(type==='number')v=v===''?null:Number(v);if(entity==='team_members'&&key==='active')v=v==='true';body[key]=v}if(DEMO){if(id){const i=(data[entity]||[]).findIndex(x=>String(x.id)===String(id));if(i>=0)data[entity][i]={...data[entity][i],...body}}else{body.id='demo-'+Date.now();(data[entity]||(data[entity]=[])).push(body)}$('#editStatus').textContent='Saved in preview ✓';setTimeout(closeEditor,300);setTimeout(renderPage,350);return}
if(['tasks','permits','sponsors','festival_items','swag_items','budget_lines'].includes(entity)){body.updated_by=session.user.id;body.updated_at=new Date().toISOString()}if(!id&&['tasks','decisions'].includes(entity))body.created_by=session.user.id;try{$('#editStatus').textContent='Saving…';if(id)await api('/rest/v1/'+entity+'?id=eq.'+encodeURIComponent(id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});else await api('/rest/v1/'+entity,{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(body)});$('#editStatus').textContent='Saved ✓';await loadData();setTimeout(()=>{closeEditor();renderPage()},250)}catch(err){$('#editStatus').textContent=err.message}}
function closeEditor(){if(coreTaskSaving)return;$('#editModal').classList.remove('open');$('#editModal').setAttribute('aria-hidden','true');editing=null}
function bindContent(){$$('[data-go]').forEach(el=>el.onclick=()=>{currentPage=el.dataset.go;renderPage()});$$('[data-page-link]').forEach(el=>el.onclick=()=>{currentPage=el.dataset.pageLink;renderPage()});$$('[data-edit]').forEach(el=>el.onclick=e=>{if(el.dataset.edit&&editDefs[el.dataset.edit])openEditor(el.dataset.edit,el.dataset.id)});$$('[data-add]').forEach(el=>el.onclick=()=>openEditor(el.dataset.add));$$('[data-external]').forEach(el=>el.onclick=()=>window.open(el.dataset.external,'_blank','noopener'));$$('[data-open-ai]').forEach(el=>el.onclick=openAI);$$('[data-chapter-edit]').forEach(b=>b.onclick=()=>toggleChapter(b.dataset.chapterEdit,true));$$('[data-chapter-cancel]').forEach(b=>b.onclick=()=>toggleChapter(b.dataset.chapterCancel,false));$$('[data-chapter-save]').forEach(b=>b.onclick=()=>saveChapter(b.dataset.chapterSave))}
function toggleChapter(id,on){$('#read-'+id)?.classList.toggle('hidden',on);$('#chapter-'+id)?.classList.toggle('hidden',!on);document.querySelector(`[data-chapter-edit="${id}"]`)?.classList.toggle('hidden',on);document.querySelector(`[data-chapter-save="${id}"]`)?.classList.toggle('hidden',!on);document.querySelector(`[data-chapter-cancel="${id}"]`)?.classList.toggle('hidden',!on)}
async function saveChapter(id){const ta=$('#chapter-'+id);if(!ta)return;if(DEMO){const c=(data.chapters||[]).find(x=>x.id===id);if(c)c.body=ta.value;$('#read-'+id).textContent=ta.value;toggleChapter(id,false);return}try{await api('/rest/v1/chapters?id=eq.'+encodeURIComponent(id),{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({body:ta.value,updated_by:session.user.id,updated_at:new Date().toISOString()})});const c=(data.chapters||[]).find(x=>x.id===id);if(c)c.body=ta.value;$('#read-'+id).textContent=ta.value;toggleChapter(id,false)}catch(err){alert(err.message)}}
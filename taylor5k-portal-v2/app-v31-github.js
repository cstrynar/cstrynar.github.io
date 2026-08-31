let githubIntegrationState={connected:false,account_name:null,can_connect:false,can_write:false};

async function refreshGithubIntegrationStatus(){
  if(DEMO){githubIntegrationState={connected:true,account_name:'preview-user',can_connect:true,can_write:true};data.githubIntegration=githubIntegrationState;return githubIntegrationState}
  if(!session?.access_token)return githubIntegrationState;
  try{
    const s=await api('/rest/v1/rpc/github_integration_status',{method:'POST',body:'{}'});
    githubIntegrationState=s||githubIntegrationState;data.githubIntegration=githubIntegrationState;
  }catch(err){githubIntegrationState={connected:false,account_name:null,can_connect:me?.role==='super_admin',can_write:['admin','super_admin'].includes(me?.role||''),error:err.message};data.githubIntegration=githubIntegrationState}
  updateGithubIntegrationUi();return githubIntegrationState;
}
function githubIntegrationSection(){
  return `<div class="page-layout github-integration-extension"><section class="super-section github-connect-section"><div class="super-section-head"><div><h3>GitHub · Taylor 5K Source Access</h3><p>Connect once so approved Taylor AI code fixes can commit safely to the Taylor website and portal source.</p></div><span id="githubConnectBadge" class="integration-badge checking">Checking…</span></div><div class="github-connect-grid"><div class="github-connect-copy"><strong>Scoped repository</strong><p><code>cstrynar/cstrynar.github.io</code></p><div class="integration-scope"><span>✓ Public website</span><span>✓ Planning portal</span><span>✓ Taylor assets</span><span>✓ Exact-match patches only</span></div><p class="integration-note">The token is validated for push access, encrypted in Supabase Vault, and never shown to Taylor AI after connection.</p></div><form id="githubConnectForm" class="github-connect-form"><label>Fine-grained GitHub token<input id="githubTokenInput" type="password" autocomplete="new-password" placeholder="Paste token once to connect"></label><small>Repository access: <b>cstrynar/cstrynar.github.io</b> · Permission: <b>Contents — Read and write</b>.</small><div class="github-connect-actions"><button class="button primary" type="submit" id="githubConnectBtn">Connect GitHub</button><button class="button ghost" type="button" id="githubDisconnectBtn">Disconnect</button><a class="button ghost" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Create Token ↗</a></div><span id="githubConnectStatus"></span></form></div></section></div>`;
}
function updateGithubIntegrationUi(){
  const badge=$('#githubConnectBadge'),connect=$('#githubConnectBtn'),disconnect=$('#githubDisconnectBtn'),status=$('#githubConnectStatus');if(!badge)return;
  if(githubIntegrationState.connected){badge.className='integration-badge connected';badge.textContent='Connected · '+(githubIntegrationState.account_name||'GitHub');if(connect)connect.textContent='Update Connection';if(disconnect)disconnect.disabled=false;if(status)status.textContent='Taylor AI code patches are enabled for Admin/Super Admin after confirmation.'}
  else{badge.className='integration-badge disconnected';badge.textContent='Not Connected';if(connect)connect.textContent='Connect GitHub';if(disconnect)disconnect.disabled=true;if(status&&!githubIntegrationState.error)status.textContent='Connect once to enable structural HTML/CSS/JS fixes from inside Taylor AI.'}
  const pill=$('#aiPanel .project-access-pill');if(pill){pill.title='Live portal, public website, Taylor project files'+(githubIntegrationState.connected?', and confirmed GitHub code patches':'. GitHub source writes are not connected yet.');pill.classList.toggle('github-connected',!!githubIntegrationState.connected)}
}
function bindGithubIntegration(){
  const form=$('#githubConnectForm');if(!form)return;refreshGithubIntegrationStatus();
  form.addEventListener('submit',async e=>{e.preventDefault();const input=$('#githubTokenInput'),status=$('#githubConnectStatus'),btn=$('#githubConnectBtn');const token=input?.value.trim()||'';if(!token){status.textContent='Paste a fine-grained GitHub token first.';return}btn.disabled=true;status.textContent='Validating repository access and encrypting connection…';try{const res=DEMO?{connected:true,account_name:'preview-user'}:await api('/rest/v1/rpc/set_github_integration',{method:'POST',body:JSON.stringify({p_token:token})});if(input)input.value='';githubIntegrationState={...githubIntegrationState,...res,can_connect:true,can_write:true};data.githubIntegration=githubIntegrationState;status.textContent='Connected securely ✓';updateGithubIntegrationUi()}catch(err){status.textContent=err.message||'GitHub connection failed.'}finally{btn.disabled=false}});
  $('#githubDisconnectBtn')?.addEventListener('click',async()=>{if(!confirm('Disconnect the Taylor 5K GitHub code-write connection?'))return;const status=$('#githubConnectStatus');status.textContent='Disconnecting…';try{if(!DEMO)await api('/rest/v1/rpc/disconnect_github_integration',{method:'POST',body:'{}'});githubIntegrationState={connected:false,account_name:null,can_connect:true,can_write:true};data.githubIntegration=githubIntegrationState;status.textContent='GitHub disconnected.';updateGithubIntegrationUi()}catch(err){status.textContent=err.message||'Could not disconnect GitHub.'}});
}

// Add the secure integration card to Super Admin without changing the existing member/time controls.
const superAdminPageV31Github=superAdminPage;
superAdminPage=function(){return superAdminPageV31Github()+githubIntegrationSection()};
const bindSuperAdminV31Github=bindSuperAdmin;
bindSuperAdmin=function(){bindSuperAdminV31Github();bindGithubIntegration()};

// Confirmed structural source-code patches use a safe exact-match RPC.
const executeAIActionV31Github=executeAIAction;
executeAIAction=async function(a){
  if(a?.entity_type!=='github_patch')return executeAIActionV31Github(a);
  if(!['admin','super_admin'].includes(me?.role||''))throw Error('GitHub code patches require Admin access.');
  const f=a.fields||{},path=String(f.path||''),findText=String(f.find_text||''),replaceText=String(f.replace_text??''),message=String(f.message||a.summary||'Taylor 5K AI approved code patch');
  if(!path||!findText)throw Error('This code patch is missing its file path or exact match text.');
  return api('/rest/v1/rpc/github_replace_text',{method:'POST',body:JSON.stringify({p_path:path,p_find_text:findText,p_replace_text:replaceText,p_message:message})});
};
function patchPreview(text,max=850){const s=String(text||'');return s.length>max?s.slice(0,max)+'\n… ['+(s.length-max)+' more characters]':s}
const showProposalV31Github=showProposal;
showProposal=function(action,summary){
  if(action?.entity_type!=='github_patch')return showProposalV31Github(action,summary);
  const f=action.fields||{},box=document.createElement('div');box.className='proposal github-patch-proposal';
  box.innerHTML=`<strong>PROPOSED SOURCE CODE PATCH</strong><p>${esc(summary||'Taylor AI wants to patch a Taylor 5K source file.')}</p><div class="github-patch-file">${esc(f.path||'')}</div><div class="patch-columns"><div><b>Find exactly</b><pre>${esc(patchPreview(f.find_text))}</pre></div><div><b>Replace with</b><pre>${esc(patchPreview(f.replace_text))}</pre></div></div><div class="proposal-actions"><button class="yes">Confirm & Commit</button><button class="no">Cancel</button></div><small class="patch-safety-note">Safety check: the server will commit only if the exact “Find” block still occurs once in the current GitHub file.</small>`;
  $('#aiMessages').appendChild(box);$('#aiMessages').scrollTop=$('#aiMessages').scrollHeight;
  box.querySelector('.no').onclick=()=>{box.remove();aiMessage('system','Code patch cancelled.')};
  box.querySelector('.yes').onclick=async()=>{const yes=box.querySelector('.yes'),no=box.querySelector('.no');yes.disabled=true;no.disabled=true;$('#aiStatus').textContent='Committing…';try{const res=await executeAIAction(action);box.remove();const commit=res?.commit_sha?` Commit ${String(res.commit_sha).slice(0,8)}.`:'';aiMessage('assistant','Source-code patch committed to GitHub.'+commit+' The live site may take a moment to refresh.');await loadData();renderPage();await refreshGithubIntegrationStatus()}catch(err){aiMessage('system',err.message||'GitHub patch failed.');yes.disabled=false;no.disabled=false}finally{$('#aiStatus').textContent='Ready'}};
};

// Teach Realtime voice about secure GitHub patches as well.
const realtimeV31ToolsGithub=realtimeV31Tools;
realtimeV31Tools=function(){const xs=realtimeV31ToolsGithub();const p=xs.find(x=>x.name==='propose_project_update');if(p?.parameters?.properties?.target)p.parameters.properties.target.enum=['portal_record','public_site','marketing_asset','github_patch'];return xs};
const v31ProposalFromArgsGithub=v31ProposalFromArgs;
v31ProposalFromArgs=function(a){if(a?.target!=='github_patch')return v31ProposalFromArgsGithub(a);let f={};try{f=JSON.parse(a.fields_json||'{}')}catch{};return{entity_type:'github_patch',operation:'update',record_id:null,fields:{path:f.path||'',find_text:f.find_text||'',replace_text:f.replace_text||'',message:f.message||a.summary||'Taylor 5K AI approved code patch'},summary:a.summary||'Proposed source-code patch'}};
const rtV31InstructionsGithub=rtV31Instructions;
rtV31Instructions=function(){return rtV31InstructionsGithub()+`\nSecure GitHub code-write connection is currently ${githubIntegrationState.connected?'CONNECTED':'NOT CONNECTED'}. For structural source fixes, inspect the exact current source first, then propose target github_patch with path, exact find_text and replace_text. If GitHub is not connected, tell the user to use Super Admin → GitHub Source Access; never request the token by voice.`};

// Keep GitHub status fresh when opening AI or Super Admin.
const openAIV31Github=openAI;
openAI=function(){openAIV31Github();if(session?.access_token&&['admin','super_admin'].includes(me?.role||''))refreshGithubIntegrationStatus()};
queueMicrotask(()=>{if(session?.access_token&&['admin','super_admin'].includes(me?.role||''))refreshGithubIntegrationStatus()});

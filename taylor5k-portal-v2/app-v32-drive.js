const TAYLOR_DRIVE_GATEWAY='https://vofnxwgjqxgahjiobtqw.supabase.co/functions/v1/taylor5k-google-drive';
const TAYLOR_DRIVE_CHAT_V32='https://vofnxwgjqxgahjiobtqw.supabase.co/functions/v1/taylor5k-drive-chat-v32';
const TAYLOR_DRIVE_TOOLS_V32='https://vofnxwgjqxgahjiobtqw.supabase.co/functions/v1/taylor5k-drive-tools-v32';
const TAYLOR_DRIVE_ROOT_ID='1oj9N5TK5cRrOhA65QAgF5LMrjsx460Yp';
const TAYLOR_DRIVE_ROOT_URL='https://drive.google.com/drive/folders/'+TAYLOR_DRIVE_ROOT_ID;
let driveIntegrationState={client_configured:false,connected:false,account_email:null,root_folder_id:TAYLOR_DRIVE_ROOT_ID,root_folder_name:'Kent Taylor 5K',redirect_uri:'https://vofnxwgjqxgahjiobtqw.supabase.co/functions/v1/taylor5k-google-drive/callback'};

async function driveGateway(body){
  if(DEMO)return {connected:true,client_configured:true,account_email:'preview@example.com',root_folder_id:TAYLOR_DRIVE_ROOT_ID,root_folder_name:'Kent Taylor 5K'};
  const r=await fetch(TAYLOR_DRIVE_GATEWAY,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  const j=await r.json();if(!r.ok)throw Error(j.error||'Google Drive request failed.');return j;
}
async function refreshDriveIntegrationStatus(){
  if(DEMO){driveIntegrationState={...driveIntegrationState,client_configured:true,connected:true,account_email:'preview@example.com'};data.driveIntegration=driveIntegrationState;return driveIntegrationState}
  if(!session?.access_token)return driveIntegrationState;
  try{const s=await api('/rest/v1/rpc/google_drive_integration_status',{method:'POST',body:'{}'});driveIntegrationState={...driveIntegrationState,...(s||{})}}
  catch(err){driveIntegrationState={...driveIntegrationState,error:err.message}}
  data.driveIntegration=driveIntegrationState;updateDriveUi();return driveIntegrationState;
}
function driveIntegrationSection(){
  const callback=driveIntegrationState.redirect_uri||'https://vofnxwgjqxgahjiobtqw.supabase.co/functions/v1/taylor5k-google-drive/callback';
  return `<div class="page-layout drive-integration-extension"><section class="super-section drive-connect-section"><div class="super-section-head"><div><h3>Google Drive · Kent Taylor 5K</h3><p>Authorize Taylor AI to work inside one dedicated Drive tree without using your ChatGPT connector session.</p></div><span id="driveConnectBadge" class="integration-badge checking">Checking…</span></div><div class="drive-connect-grid"><div class="drive-connect-copy"><strong>Project root</strong><p><a href="${TAYLOR_DRIVE_ROOT_URL}" target="_blank" rel="noopener">Kent Taylor 5K ↗</a></p><div class="integration-scope"><span>✓ Folder/search access</span><span>✓ Google Docs</span><span>✓ Sheets & Slides text</span><span>✓ Root-tree enforcement</span></div><p class="integration-note">The portal server enforces this root folder. Google OAuth tokens are encrypted in Supabase Vault and are never shown to Taylor AI.</p></div><div class="drive-setup-stack"><form id="driveOauthClientForm" class="drive-oauth-form"><div class="drive-setup-title"><b>1 · Google OAuth client</b><span id="driveClientState"></span></div><label>Client ID<input id="driveClientId" autocomplete="off" placeholder="...apps.googleusercontent.com"></label><label>Client secret<input id="driveClientSecret" type="password" autocomplete="new-password" placeholder="Paste once"></label><label>Authorized redirect URI<input id="driveRedirectUri" readonly value="${esc(callback)}"></label><div class="drive-connect-actions"><button class="button ghost" type="submit" id="saveDriveClient">Save OAuth Client</button><a class="button ghost" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener">Google Credentials ↗</a><a class="button ghost" href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener">Enable Drive API ↗</a></div><small>Create a Google Cloud <b>Web application</b> OAuth client and add the redirect URI above.</small><span id="driveClientStatus"></span></form><div class="drive-authorize-box"><div class="drive-setup-title"><b>2 · Authorize project Drive</b><span id="driveAccountState"></span></div><p id="driveAccountCopy">Connect the Google account that owns or can edit the Kent Taylor 5K folder.</p><div class="drive-connect-actions"><button class="button primary" type="button" id="driveAuthorizeBtn">Connect Google Drive</button><button class="button ghost" type="button" id="driveDisconnectBtn">Disconnect</button><a class="button ghost" href="${TAYLOR_DRIVE_ROOT_URL}" target="_blank" rel="noopener">Open Folder ↗</a></div><span id="driveConnectStatus"></span></div></div></div></section></div>`;
}
function updateDriveUi(){
  const badge=$('#driveConnectBadge'),clientState=$('#driveClientState'),acct=$('#driveAccountState'),copy=$('#driveAccountCopy'),authorize=$('#driveAuthorizeBtn'),disconnect=$('#driveDisconnectBtn');if(!badge)return;
  if(driveIntegrationState.connected){badge.className='integration-badge connected';badge.textContent='Connected · '+(driveIntegrationState.account_email||'Google Drive');if(acct)acct.textContent='Connected';if(copy)copy.textContent=`Taylor AI can search/read the ${driveIntegrationState.root_folder_name||'Kent Taylor 5K'} Drive tree.`;if(authorize)authorize.textContent='Reconnect Google Drive';if(disconnect)disconnect.disabled=false}
  else{badge.className='integration-badge disconnected';badge.textContent=driveIntegrationState.client_configured?'Ready to Authorize':'Setup Required';if(acct)acct.textContent='Not connected';if(copy)copy.textContent=driveIntegrationState.client_configured?'OAuth client saved. Authorize the project Google account next.':'Save a Google OAuth client first.';if(authorize)authorize.disabled=!driveIntegrationState.client_configured;if(disconnect)disconnect.disabled=true}
  if(clientState)clientState.textContent=driveIntegrationState.client_configured?'Configured':'Not configured';
  const pill=$('#aiPanel .project-access-pill');if(pill){pill.classList.toggle('drive-connected',!!driveIntegrationState.connected);pill.title='Live portal, public website, Taylor files'+(driveIntegrationState.connected?', Google Drive':'')+(githubIntegrationState?.connected?', confirmed GitHub code patches':'')}
}
function bindDriveIntegration(){
  if(!$('#driveOauthClientForm'))return;refreshDriveIntegrationStatus();
  $('#driveOauthClientForm').addEventListener('submit',async e=>{e.preventDefault();const id=$('#driveClientId')?.value.trim()||'',secret=$('#driveClientSecret')?.value.trim()||'',status=$('#driveClientStatus'),btn=$('#saveDriveClient');if(!id||!secret){status.textContent='Enter the Google OAuth client ID and secret.';return}btn.disabled=true;status.textContent='Encrypting OAuth client…';try{const res=DEMO?{configured:true}:await api('/rest/v1/rpc/set_google_drive_oauth_client',{method:'POST',body:JSON.stringify({p_client_id:id,p_client_secret:secret})});$('#driveClientSecret').value='';driveIntegrationState.client_configured=true;status.textContent='OAuth client saved securely ✓';updateDriveUi()}catch(err){status.textContent=err.message||'Could not save OAuth client.'}finally{btn.disabled=false}});
  $('#driveAuthorizeBtn')?.addEventListener('click',async()=>{const status=$('#driveConnectStatus');status.textContent='Preparing Google authorization…';try{const res=await driveGateway({action:'start',return_url:location.origin+location.pathname+'?v=3.2.0'});if(!res.auth_url)throw Error('Google authorization URL was not returned.');location.href=res.auth_url}catch(err){status.textContent=err.message||'Could not start Google Drive authorization.'}});
  $('#driveDisconnectBtn')?.addEventListener('click',async()=>{if(!confirm('Disconnect the Kent Taylor 5K Google Drive integration?'))return;const status=$('#driveConnectStatus');status.textContent='Disconnecting…';try{if(!DEMO)await api('/rest/v1/rpc/disconnect_google_drive',{method:'POST',body:'{}'});driveIntegrationState={...driveIntegrationState,connected:false,account_email:null};status.textContent='Google Drive disconnected.';updateDriveUi()}catch(err){status.textContent=err.message||'Could not disconnect Drive.'}});
}

// Add Drive connection below existing Super Admin integrations.
const superAdminPageV32Drive=superAdminPage;
superAdminPage=function(){return superAdminPageV32Drive()+driveIntegrationSection()};
const bindSuperAdminV32Drive=bindSuperAdmin;
bindSuperAdmin=function(){bindSuperAdminV32Drive();bindDriveIntegration()};

// Route Drive-specific typed questions through a Drive retrieval pass, then the proven v3.1 agent.
const sendChatAIV32Base=sendChatAI;
function looksLikeDriveRequest(t){return /\b(google\s*drive|drive\s+folder|drive\s+file|in\s+drive|from\s+drive|drive\b|folder\s+in\s+google)\b/i.test(String(t||''))}
sendChatAI=async function(fromVoice=false){
  const text=$('#aiInput')?.value.trim()||'';if(!looksLikeDriveRequest(text)||!driveIntegrationState.connected)return sendChatAIV32Base(fromVoice);
  const input=$('#aiInput'),attachments=[...pendingChatAttachments];if((!text&&!attachments.length)||aiBusy)return;const previous=chatHistory.slice(-12);aiBusy=true;renderUserChatMessage(text,attachments);if(input)input.value='';$('#aiStatus').textContent='Checking Google Drive…';chatHistory.push({role:'user',text:text||(attachments.length?`Attached: ${attachments.map(a=>a.name).join(', ')}`:'')});const wait=aiMessage('assistant','Checking the Kent Taylor 5K Drive and project…');
  try{const r=await fetch(TAYLOR_DRIVE_CHAT_V32,{method:'POST',headers:{'Content-Type':'application/json',apikey:AI_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify({message:text,context:portalContext(),allowWeb:$('#webToggle').checked,mode:fromVoice?'voice':'text',history:previous,attachments:attachments.map(a=>({path:a.path,name:a.name,type:a.type,size:a.size}))})});const j=await r.json();wait.remove();if(!r.ok)throw Error(j.error||'AI request failed');const answer=j.text||'Done.';const n=aiMessage('assistant',answer);addCitations(n,j.citations);addV31ToolTrace(n,j.toolsUsed);chatHistory.push({role:'assistant',text:answer});pendingChatAttachments=[];renderAttachmentTray();if(j.proposedAction)showProposal(j.proposedAction,j.proposalSummary)}catch(err){wait.remove();aiMessage('system',err.message||'Taylor 5K AI is temporarily unavailable.')}finally{$('#aiStatus').textContent='Ready';aiBusy=false}
};
try{sendAI=()=>sendChatAI(false)}catch{}

// Realtime Voice gets the same Drive tools.
V31_TOOL_LABELS.list_google_drive='Google Drive';V31_TOOL_LABELS.search_google_drive='Drive Search';V31_TOOL_LABELS.read_google_drive_file='Drive File';
const realtimeV31ToolsV32Drive=realtimeV31Tools;
realtimeV31Tools=function(){return [...realtimeV31ToolsV32Drive(),
 {type:'function',name:'list_google_drive',description:'List files/folders in the authorized Kent Taylor 5K Google Drive tree. Use null folder_id for root.',parameters:{type:'object',properties:{folder_id:{type:['string','null']}},required:['folder_id'],additionalProperties:false}},
 {type:'function',name:'search_google_drive',description:'Search the authorized Kent Taylor 5K Google Drive tree.',parameters:{type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false}},
 {type:'function',name:'read_google_drive_file',description:'Read a Google Doc, Sheet, Slide or text file from the authorized Kent Taylor 5K Drive tree.',parameters:{type:'object',properties:{file_id:{type:'string'}},required:['file_id'],additionalProperties:false}}
]};
const runRealtimeV31ToolV32Drive=runRealtimeV31Tool;
runRealtimeV31Tool=async function(item){
  if(!['list_google_drive','search_google_drive','read_google_drive_file'].includes(item?.name))return runRealtimeV31ToolV32Drive(item);
  const id=item.call_id;if(!id||rtHandledCalls.has(id))return;rtHandledCalls.add(id);let args={};try{args=JSON.parse(item.arguments||'{}')}catch{};setRtUi('Checking Google Drive…','thinking');try{const r=await fetch(TAYLOR_DRIVE_TOOLS_V32,{method:'POST',headers:{'Content-Type':'application/json',apikey:AI_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify({tool:item.name,args})});const j=await r.json(),result=r.ok?(j.result??{}):{error:j.error||'Drive tool failed'};if(rtDc?.readyState==='open'){rtDc.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:id,output:JSON.stringify(result)}}));rtDc.send(JSON.stringify({type:'response.create'}))}}catch(err){if(rtDc?.readyState==='open'){rtDc.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:id,output:JSON.stringify({error:err.message||'Drive tool failed'})}}));rtDc.send(JSON.stringify({type:'response.create'}))}}
};
const rtV31InstructionsV32Drive=rtV31Instructions;
rtV31Instructions=function(){return rtV31InstructionsV32Drive()+`\nGoogle Drive project connection is currently ${driveIntegrationState.connected?'CONNECTED':'NOT CONNECTED'}. When connected, use list_google_drive/search_google_drive/read_google_drive_file whenever the user asks about Drive or folders there. The server enforces the Kent Taylor 5K root folder. Never ask for Google OAuth client secrets or tokens by voice.`};

const openAIV32Drive=openAI;
openAI=function(){openAIV32Drive();if(session?.access_token)refreshDriveIntegrationStatus()};
queueMicrotask(async()=>{if(session?.access_token)await refreshDriveIntegrationStatus();const p=new URLSearchParams(location.search);if(p.get('drive')==='connected'){setTimeout(()=>aiMessage('system','Google Drive connected to the Kent Taylor 5K project ✓'),500)}else if(p.get('drive')==='error'){setTimeout(()=>aiMessage('system','Google Drive connection did not complete: '+(p.get('reason')||'authorization error')),500)}});

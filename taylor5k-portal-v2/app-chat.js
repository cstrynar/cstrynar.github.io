let pendingChatAttachments=[];
let chatHistory=[];
let voiceModeActive=false,voiceModeListening=false,voiceModeSpeaking=false,chatRecognition=null;
const CHAT_MAX_FILES=4,CHAT_MAX_TOTAL=10*1024*1024;
const CHAT_BUCKET='portal-ai-uploads';

function fileMime(file){if(file.type)return file.type;const e=(file.name.split('.').pop()||'').toLowerCase();return({pdf:'application/pdf',txt:'text/plain',csv:'text/csv',md:'text/markdown',json:'application/json',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'})[e]||'application/octet-stream'}
function humanBytes(n){if(n<1024)return n+' B';if(n<1048576)return Math.round(n/1024)+' KB';return (n/1048576).toFixed(1)+' MB'}
function safeFileName(n){return String(n||'file').replace(/[^a-zA-Z0-9._-]+/g,'-').slice(-120)}
function encodedStoragePath(path){return path.split('/').map(encodeURIComponent).join('/')}

function enhanceTaylorChat(){
  const panel=$('#aiPanel'),compose=panel?.querySelector('.ai-compose');if(!panel||!compose)return;
  const subtitle=panel.querySelector('.ai-panel-head small');if(subtitle)subtitle.textContent='CHAT · INTERACTIVE VOICE · FILES & PHOTOS · LIVE RESEARCH';
  compose.innerHTML=`<div id="aiAttachmentTray" class="chat-attachment-tray"></div><div class="chat-composer-box"><textarea id="aiInput" placeholder="Message Taylor 5K AI…"></textarea><div class="chat-compose-actions"><button id="aiAttachBtn" class="chat-circle-btn" type="button" title="Add files or photos">＋</button><input id="aiFileInput" type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/csv,text/markdown,application/json,.docx,.xlsx,.pptx"><span id="aiStatus" class="chat-status">Ready</span><button id="voiceModeBtn" class="chat-voice-btn" type="button">🎙 Voice</button><button id="aiSend" class="chat-send-btn" type="button" title="Send">↑</button></div></div><div class="chat-drop-hint">Drop or paste photos, PDFs and files here · up to 4 files / 10 MB total</div>`;
  panel.insertAdjacentHTML('beforeend','<div id="aiDropOverlay" class="ai-drop-overlay"><div>Drop files into Taylor 5K AI<small>Photos, PDFs, documents and spreadsheets</small></div></div>');
  $('#aiAttachBtn').onclick=()=>$('#aiFileInput').click();
  $('#aiFileInput').onchange=e=>{handleChatFiles([...e.target.files]);e.target.value=''};
  $('#aiSend').onclick=()=>sendChatAI(false);
  $('#aiInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChatAI(false)}};
  $('#voiceModeBtn').onclick=toggleVoiceMode;
  bindChatDrop(panel);
  setupInteractiveVoice();
  renderAttachmentTray();
  try{sendAI=()=>sendChatAI(false)}catch{}
}

function bindChatDrop(panel){
  let depth=0;const overlay=$('#aiDropOverlay');
  panel.addEventListener('dragenter',e=>{e.preventDefault();depth++;overlay?.classList.add('show')});
  panel.addEventListener('dragover',e=>{e.preventDefault();if(e.dataTransfer)e.dataTransfer.dropEffect='copy'});
  panel.addEventListener('dragleave',e=>{e.preventDefault();depth=Math.max(0,depth-1);if(!depth)overlay?.classList.remove('show')});
  panel.addEventListener('drop',e=>{e.preventDefault();depth=0;overlay?.classList.remove('show');handleChatFiles([...e.dataTransfer.files])});
  $('#aiInput')?.addEventListener('paste',e=>{const files=[...(e.clipboardData?.files||[])];if(files.length){e.preventDefault();handleChatFiles(files)}});
}

async function handleChatFiles(files){
  if(!files.length)return;const allowed=['image/jpeg','image/png','image/webp','image/gif','application/pdf','text/plain','text/csv','text/markdown','application/json','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation'];
  for(const file of files){
    if(pendingChatAttachments.length>=CHAT_MAX_FILES){aiMessage('system',`You can attach up to ${CHAT_MAX_FILES} files at a time.`);break}
    const type=fileMime(file);if(!allowed.includes(type)){aiMessage('system',`${file.name} is not a supported AI attachment yet.`);continue}
    const existing=pendingChatAttachments.reduce((s,x)=>s+Number(x.size||0),0);if(file.size>CHAT_MAX_TOTAL||existing+file.size>CHAT_MAX_TOTAL){aiMessage('system','AI attachments are limited to 10 MB total per message.');continue}
    $('#aiStatus').textContent='Uploading…';
    try{const item=await uploadChatFile(file,type);pendingChatAttachments.push(item);renderAttachmentTray();$('#aiStatus').textContent='Ready'}catch(err){$('#aiStatus').textContent='Ready';aiMessage('system',err.message||`Could not upload ${file.name}.`)}
  }
}
async function uploadChatFile(file,type){
  const preview=type.startsWith('image/')?URL.createObjectURL(file):null;
  if(DEMO)return{id:'demo-'+Date.now()+Math.random(),path:'demo/'+safeFileName(file.name),name:file.name,type,size:file.size,preview};
  if(!session?.user?.id)throw Error('Sign in before uploading files.');
  const path=`${session.user.id}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const r=await fetch(`${BASE}/storage/v1/object/${CHAT_BUCKET}/${encodedStoragePath(path)}`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${session.access_token}`,'Content-Type':type,'x-upsert':'false'},body:file});
  if(!r.ok){let detail='';try{detail=(await r.json()).message}catch{}throw Error(detail||`Could not upload ${file.name}.`)}
  let meta=null;try{const rows=await api('/rest/v1/portal_ai_attachments',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({user_id:session.user.id,member_id:me?.id||null,storage_path:path,file_name:file.name,mime_type:type,size_bytes:file.size})});meta=rows?.[0]}catch{}
  return{id:meta?.id||crypto.randomUUID(),path,name:file.name,type,size:file.size,preview};
}
function renderAttachmentTray(){const tray=$('#aiAttachmentTray');if(!tray)return;tray.innerHTML=pendingChatAttachments.map((a,i)=>`<div class="pending-file">${a.preview?`<img src="${esc(a.preview)}" alt="">`:`<span class="file-icon">${a.type==='application/pdf'?'PDF':'▤'}</span>`}<span><b>${esc(a.name)}</b><small>${humanBytes(a.size)}</small></span><button type="button" data-remove-attachment="${i}">×</button></div>`).join('');tray.querySelectorAll('[data-remove-attachment]').forEach(b=>b.onclick=()=>{pendingChatAttachments.splice(Number(b.dataset.removeAttachment),1);renderAttachmentTray()})}
function renderUserChatMessage(text,attachments){const d=aiMessage('user',text||'Attached file');if(attachments.length){const wrap=document.createElement('div');wrap.className='chat-message-files';for(const a of attachments){const chip=document.createElement('div');chip.className='chat-file-chip';chip.innerHTML=`${a.preview?`<img src="${esc(a.preview)}" alt="">`:''}<span><b>${esc(a.name)}</b><small>${humanBytes(a.size)}</small></span>`;wrap.appendChild(chip)}d.appendChild(wrap)}return d}
function addCitations(node,cites){if(!node||!Array.isArray(cites)||!cites.length)return;const wrap=document.createElement('div');wrap.className='assistant-citations';cites.slice(0,6).forEach((c,i)=>{const a=document.createElement('a');a.href=c.url;a.target='_blank';a.rel='noopener';a.textContent=c.title||`Source ${i+1}`;wrap.appendChild(a)});node.appendChild(wrap)}

async function sendChatAI(fromVoice=false){
  const input=$('#aiInput'),text=input?.value.trim()||'',attachments=[...pendingChatAttachments];if((!text&&!attachments.length)||aiBusy)return;
  if(voiceModeListening)try{chatRecognition?.stop()}catch{}
  const previous=chatHistory.slice(-12);aiBusy=true;renderUserChatMessage(text,attachments);if(input)input.value='';$('#aiStatus').textContent='Thinking…';const userHistoryText=text||(attachments.length?`Attached: ${attachments.map(a=>a.name).join(', ')}`:'');chatHistory.push({role:'user',text:userHistoryText});
  if(DEMO){setTimeout(()=>{const ans='Preview mode: files, photos and interactive voice are enabled in the signed-in portal.';const n=aiMessage('assistant',ans);chatHistory.push({role:'assistant',text:ans});pendingChatAttachments=[];renderAttachmentTray();$('#aiStatus').textContent='Ready';aiBusy=false;if(voiceModeActive)speakVoiceReply(ans)},450);return}
  const wait=aiMessage('assistant','Thinking…');
  try{const r=await fetch(AI_URL,{method:'POST',headers:{'Content-Type':'application/json',apikey:AI_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify({message:text,context:portalContext(),allowWeb:$('#webToggle').checked,mode:(fromVoice||voiceModeActive)?'voice':'text',history:previous,attachments:attachments.map(a=>({path:a.path,name:a.name,type:a.type,size:a.size}))})});const j=await r.json();wait.remove();if(!r.ok)throw Error(j.error||'AI request failed');const answer=j.text||'Done.';const n=aiMessage('assistant',answer);addCitations(n,j.citations);chatHistory.push({role:'assistant',text:answer});pendingChatAttachments=[];renderAttachmentTray();if(j.proposedAction)showProposal(j.proposedAction,j.proposalSummary);if(voiceModeActive)speakVoiceReply(answer)}catch(err){wait.remove();aiMessage('system',err.message);if(voiceModeActive)setTimeout(listenVoiceMode,600)}finally{$('#aiStatus').textContent='Ready';aiBusy=false}
}

function setupInteractiveVoice(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){$('#voiceModeBtn').disabled=true;$('#voiceModeBtn').textContent='Voice unavailable';return}chatRecognition=new SR();recognition=chatRecognition;chatRecognition.lang='en-US';chatRecognition.continuous=false;chatRecognition.interimResults=true;chatRecognition.onstart=()=>{voiceModeListening=true;updateVoiceCard('Listening…',true);$('#aiStatus').textContent='Listening…'};chatRecognition.onresult=e=>{let final='',interim='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)final+=t;else interim+=t}if(interim)$('#aiInput').value=interim;if(final){$('#aiInput').value=final;voiceModeListening=false;updateVoiceCard('Got it — thinking…',false);sendChatAI(true)}};chatRecognition.onerror=e=>{voiceModeListening=false;if(e.error==='not-allowed'||e.error==='service-not-allowed'){stopVoiceMode();aiMessage('system','Microphone permission is blocked in the browser. Allow microphone access and try Voice again.')}else if(voiceModeActive)setTimeout(listenVoiceMode,700)};chatRecognition.onend=()=>{voiceModeListening=false;if(voiceModeActive&&!aiBusy&&!voiceModeSpeaking)setTimeout(listenVoiceMode,350)}}
function toggleVoiceMode(){voiceModeActive?stopVoiceMode():startVoiceMode()}
function startVoiceMode(){if(!chatRecognition){aiMessage('system','Interactive voice is not available in this browser.');return}voiceModeActive=true;$('#voiceModeBtn').classList.add('active');$('#voiceModeBtn').textContent='● Voice on';updateVoiceCard('Ready — speak naturally.',false);listenVoiceMode()}
function stopVoiceMode(){voiceModeActive=false;voiceModeListening=false;voiceModeSpeaking=false;try{chatRecognition?.stop()}catch{};try{speechSynthesis.cancel()}catch{};$('#voiceModeBtn')?.classList.remove('active');if($('#voiceModeBtn'))$('#voiceModeBtn').textContent='🎙 Voice';$('#voiceSessionCard')?.remove();if($('#aiStatus'))$('#aiStatus').textContent='Ready'}
function listenVoiceMode(){if(!voiceModeActive||aiBusy||voiceModeSpeaking||voiceModeListening)return;try{chatRecognition.start()}catch{}}
function updateVoiceCard(text,listening){let card=$('#voiceSessionCard');if(!card){card=document.createElement('div');card.id='voiceSessionCard';card.className='voice-session-card';card.innerHTML='<div class="voice-orb">◉</div><div><strong>Interactive Voice</strong><small></small></div><button type="button">End voice</button>';card.querySelector('button').onclick=stopVoiceMode;$('#aiMessages').prepend(card)}card.classList.toggle('listening',!!listening);card.querySelector('small').textContent=text}
function speakVoiceReply(text){if(!voiceModeActive||!('speechSynthesis'in window)){if(voiceModeActive)setTimeout(listenVoiceMode,350);return}voiceModeSpeaking=true;try{chatRecognition?.stop()}catch{};speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(String(text).replace(/https?:\/\/\S+/g,''));const voices=speechSynthesis.getVoices();u.voice=voices.find(v=>/Google US English|Samantha|Microsoft Aria|Ava/i.test(v.name))||voices.find(v=>/^en/i.test(v.lang))||null;u.rate=1.02;u.pitch=1;u.onstart=()=>updateVoiceCard('Taylor 5K AI is speaking…',false);u.onend=()=>{voiceModeSpeaking=false;updateVoiceCard('Your turn…',true);setTimeout(listenVoiceMode,250)};u.onerror=()=>{voiceModeSpeaking=false;setTimeout(listenVoiceMode,350)};speechSynthesis.speak(u)}

window.addEventListener('beforeunload',()=>{pendingChatAttachments.forEach(a=>{if(a.preview)try{URL.revokeObjectURL(a.preview)}catch{}})});
enhanceTaylorChat();

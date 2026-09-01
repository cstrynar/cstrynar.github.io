const TAYLOR_REALTIME_TOKEN_URL='https://vofnxwgjqxgahjiobtqw.supabase.co/functions/v1/taylor5k-realtime-token';
let rtPc=null,rtDc=null,rtStream=null,rtAudio=null,rtActive=false,rtStarting=false,rtAssistantText='',rtLastUserTranscript='';

function compactRealtimeContext(){
  const memberSummary=(data.team_members||[]).map(x=>({name:x.display_name||'',role:x.role,active:x.active!==false,setup_complete:Boolean(x.user_id)}));
  return JSON.stringify({
    event:'Kent Taylor 5K · Fall 2027 · Norton, Massachusetts',
    current_user:{name:me?.display_name||'',role:me?.role||'viewer'},
    members:memberSummary,
    open_tasks:(data.tasks||[]).filter(x=>String(x.status).toLowerCase()!=='complete').map(x=>({id:x.id,title:x.title,category:x.category,owner:x.owner_name,status:x.status,priority:x.priority,due_date:x.due_date,notes:x.notes})),
    decisions:(data.decisions||[]).map(x=>({id:x.id,title:x.title,status:x.status,context:x.context,decision:x.decision})),
    permits:(data.permits||[]).map(x=>({id:x.id,approval:x.approval,authority:x.authority,status:x.status,owner:x.owner_name,due_date:x.due_date,notes:x.notes})),
    sponsors:(data.sponsors||[]).map(x=>({id:x.id,name:x.name,stage:x.stage,level:x.level,ask_amount:x.ask_amount,committed_amount:x.committed_amount,owner:x.owner_name,notes:x.notes})),
    sponsor_opportunities:(data.sponsor_opportunities||[]).map(x=>({id:x.id,name:x.name,type:x.opportunity_type,status:x.status,target_amount:x.target_amount})),
    budget:['admin','super_admin'].includes(me?.role)?(data.budget_lines||[]).map(x=>({id:x.id,type:x.line_type,category:x.category,item:x.item,budget_amount:x.budget_amount,actual_amount:x.actual_amount,status:x.paid_status})):[],
    live_signups:data.live_signups?.rows||[],
    master_plan:(data.chapters||[]).map(x=>({id:x.id,chapter_no:x.chapter_no,title:x.title,status:x.status})),
    site_edits:(data.site_edits||[]).map(x=>({id:x.id,label:x.label,active:x.active}))
  }).slice(0,42000);
}

function realtimeTool(){return {type:'function',name:'propose_portal_update',description:'Propose one Taylor 5K portal or public website update for explicit human confirmation. Never use this tool for member access, invitations, authentication, permissions, or Super Admin controls.',parameters:{type:'object',properties:{entity_type:{type:'string',enum:['tasks','chapters','permits','sponsors','festival_items','swag_items','budget_lines','decisions','site_edits']},operation:{type:'string',enum:['create','update']},record_id:{type:['string','null'],description:'Existing record ID for update; null for create.'},fields_json:{type:'string',description:'JSON object string containing only fields to change.'},summary:{type:'string',description:'Short plain-English summary of the proposed update.'}},required:['entity_type','operation','record_id','fields_json','summary'],additionalProperties:false}}}

function rtVoiceInstructions(){return `You are Taylor 5K AI, the live voice planning copilot inside the private Kent Taylor 5K Planning Portal. Speak like a polished, natural ChatGPT voice assistant: warm, quick, conversational, confident, and not robotic. Use natural contractions and short spoken sentences. Do not over-explain unless asked. You can hear the user's microphone audio, so never say you are text-only or that you cannot hear them.

Use the live project context below as the source of truth for the race. You may answer questions, prioritize work, brainstorm, and help make decisions. If the user asks to change the portal or public website, call propose_portal_update. Never claim the change is saved; the portal will show a confirmation card. Never change members, invitations, permissions, authentication, or Super Admin protection through voice. If asked about those, direct the user to Super Admin controls.

When the user interrupts, stop and listen. Keep a friendly planning-partner tone. Current portal context:
${compactRealtimeContext()}`}

function installRealtimeVoice(){
  const btn=$('#voiceModeBtn'); if(!btn)return;
  try{if(chatRecognition){chatRecognition.onstart=null;chatRecognition.onresult=null;chatRecognition.onerror=null;chatRecognition.onend=null;chatRecognition.stop()}}catch{}
  voiceModeActive=false;voiceModeListening=false;voiceModeSpeaking=false;
  btn.disabled=false;btn.textContent='◉ Voice';btn.title='Start ChatGPT-style live voice';btn.onclick=toggleRealtimeVoice;
  const subtitle=$('#aiPanel .ai-panel-head small');if(subtitle)subtitle.textContent='GPT VOICE · FILES & PHOTOS · LIVE PORTAL · LIVE RESEARCH';
}

async function toggleRealtimeVoice(){if(rtActive||rtStarting)await stopRealtimeVoice();else await startRealtimeVoice()}

async function startRealtimeVoice(){
  if(DEMO){aiMessage('system','Realtime voice is available in the signed-in portal.');return}
  if(!session?.access_token){aiMessage('system','Sign in before starting Voice.');return}
  rtStarting=true;setRtUi('Connecting…','connecting');
  try{
    try{speechSynthesis.cancel()}catch{}
    const tokenRes=await fetch(TAYLOR_REALTIME_TOKEN_URL,{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:AI_KEY,'Content-Type':'application/json'},body:'{}'});
    const tokenData=await tokenRes.json();if(!tokenRes.ok||!tokenData.value)throw Error(tokenData.error||'Could not start Realtime voice.');
    const pc=new RTCPeerConnection();rtPc=pc;
    const audio=document.createElement('audio');audio.autoplay=true;audio.playsInline=true;rtAudio=audio;
    pc.ontrack=e=>{audio.srcObject=e.streams[0];audio.play().catch(()=>{})};
    const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});rtStream=stream;stream.getTracks().forEach(t=>pc.addTrack(t,stream));
    const dc=pc.createDataChannel('oai-events');rtDc=dc;dc.addEventListener('message',handleRealtimeEvent);dc.addEventListener('open',configureRealtimeSession);dc.addEventListener('close',()=>{if(rtActive)stopRealtimeVoice(false)});
    const offer=await pc.createOffer();await pc.setLocalDescription(offer);
    const sdpRes=await fetch('https://api.openai.com/v1/realtime/calls',{method:'POST',body:offer.sdp,headers:{Authorization:'Bearer '+tokenData.value,'Content-Type':'application/sdp'}});
    if(!sdpRes.ok)throw Error('OpenAI Realtime connection failed ('+sdpRes.status+').');
    await pc.setRemoteDescription({type:'answer',sdp:await sdpRes.text()});
    rtActive=true;rtStarting=false;setRtUi('Connected · just talk','listening');
  }catch(err){rtStarting=false;await stopRealtimeVoice(false);aiMessage('system',err.message||'Realtime voice could not start.');}
}

function configureRealtimeSession(){
  if(!rtDc||rtDc.readyState!=='open')return;
  const event={type:'session.update',session:{type:'realtime',model:'gpt-realtime-2.1',output_modalities:['audio'],instructions:rtVoiceInstructions(),tools:[realtimeTool()],tool_choice:'auto',audio:{input:{transcription:{model:'gpt-4o-mini-transcribe'},turn_detection:{type:'semantic_vad',eagerness:'medium',create_response:true,interrupt_response:true}},output:{voice:'marin',speed:1.0}}}};
  rtDc.send(JSON.stringify(event));
}

function handleRealtimeEvent(evt){
  let e;try{e=JSON.parse(evt.data)}catch{return}
  switch(e.type){
    case 'session.created':case 'session.updated':if(rtActive)setRtUi('Connected · just talk','listening');break;
    case 'input_audio_buffer.speech_started':setRtUi('Listening…','listening');break;
    case 'input_audio_buffer.speech_stopped':setRtUi('Thinking…','thinking');break;
    case 'conversation.item.input_audio_transcription.completed':{
      const t=String(e.transcript||'').trim();if(t&&t!==rtLastUserTranscript){rtLastUserTranscript=t;aiMessage('user',t);chatHistory.push({role:'user',text:t})}break;
    }
    case 'response.output_audio_transcript.delta':case 'response.audio_transcript.delta':rtAssistantText+=String(e.delta||'');setRtUi('Speaking…','speaking');break;
    case 'response.output_audio_transcript.done':case 'response.audio_transcript.done':{
      const t=String(e.transcript||e.text||rtAssistantText||'').trim();if(t){aiMessage('assistant',t);chatHistory.push({role:'assistant',text:t})}rtAssistantText='';break;
    }
    case 'response.output_item.done':{
      if(e.item?.type==='function_call'&&e.item?.name==='propose_portal_update')handleRealtimeProposal(e.item);
      if(e.item?.type==='message'&&!rtAssistantText){const t=realtimeMessageText(e.item);if(t){aiMessage('assistant',t);chatHistory.push({role:'assistant',text:t})}}
      break;
    }
    case 'response.done':setRtUi('Listening…','listening');rtAssistantText='';break;
    case 'error':console.warn('Taylor Realtime',e);setRtUi('Voice error','error');break;
  }
}

function realtimeMessageText(item){for(const c of item?.content||[]){const t=c?.transcript||c?.text;if(typeof t==='string'&&t.trim())return t.trim()}return ''}

function handleRealtimeProposal(item){
  let args={};try{args=JSON.parse(item.arguments||'{}')}catch{}
  let fields={};try{fields=JSON.parse(args.fields_json||'{}')}catch{}
  const action={entity_type:args.entity_type,operation:args.operation,record_id:args.record_id||null,fields};
  if(typeof showProposal==='function')showProposal(action,args.summary||'Proposed portal update');
  if(rtDc?.readyState==='open'){
    rtDc.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify({status:'pending_human_confirmation',message:'The portal displayed the proposed update. The user must click Confirm Update before anything is saved.'})}}));
    rtDc.send(JSON.stringify({type:'response.create'}));
  }
}

async function stopRealtimeVoice(updateUi=true){
  rtActive=false;rtStarting=false;
  try{rtDc?.close()}catch{};rtDc=null;
  try{rtPc?.close()}catch{};rtPc=null;
  try{rtStream?.getTracks().forEach(t=>t.stop())}catch{};rtStream=null;
  try{if(rtAudio){rtAudio.pause();rtAudio.srcObject=null;rtAudio.remove()}}catch{};rtAudio=null;
  rtAssistantText='';if(updateUi)setRtUi('Voice off','off');else setRtUi('Voice','off');
}

function setRtUi(label,state){
  const btn=$('#voiceModeBtn'),status=$('#aiStatus');if(btn){btn.classList.toggle('active',state!=='off'&&state!=='error');btn.textContent=(state==='off'||state==='error')?'◉ Voice':'● '+label}if(status)status.textContent=label;
  let card=$('#voiceSessionCard');
  if(state==='off'||state==='error'){card?.remove();return}
  if(!card){card=document.createElement('div');card.id='voiceSessionCard';card.className='voice-session-card realtime-v3';card.innerHTML='<div class="voice-orb">◉</div><div><strong>GPT Realtime Voice</strong><small></small></div><button type="button">End voice</button>';card.querySelector('button').onclick=()=>stopRealtimeVoice();$('#aiMessages')?.prepend(card)}
  card.className='voice-session-card realtime-v3 '+state;card.querySelector('small').textContent=label;
}

window.addEventListener('pagehide',()=>{if(rtActive||rtStarting)stopRealtimeVoice(false)});
queueMicrotask(installRealtimeVoice);

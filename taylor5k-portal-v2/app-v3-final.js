const TAYLOR_CHAT_V3_URL='https://vofnxwgjqxgahjiobtqw.supabase.co/functions/v1/taylor5k-chat-v3';
let rtLastAssistantTranscript='',rtHandledCalls=new Set();

// Upgrade the existing ChatGPT-style composer to the v3 GPT-5.6 endpoint.
sendChatAI=async function(fromVoice=false){
  const input=$('#aiInput'),text=input?.value.trim()||'',attachments=[...pendingChatAttachments];
  if((!text&&!attachments.length)||aiBusy)return;
  const previous=chatHistory.slice(-12);aiBusy=true;renderUserChatMessage(text,attachments);if(input)input.value='';
  $('#aiStatus').textContent='Thinking…';
  const userHistoryText=text||(attachments.length?`Attached: ${attachments.map(a=>a.name).join(', ')}`:'');
  chatHistory.push({role:'user',text:userHistoryText});
  if(DEMO){setTimeout(()=>{const ans='Preview mode: v3 uses GPT-5.6 for project chat and GPT Realtime for live voice.';aiMessage('assistant',ans);chatHistory.push({role:'assistant',text:ans});pendingChatAttachments=[];renderAttachmentTray();$('#aiStatus').textContent='Ready';aiBusy=false},350);return}
  const wait=aiMessage('assistant','Thinking…');
  try{
    const r=await fetch(TAYLOR_CHAT_V3_URL,{method:'POST',headers:{'Content-Type':'application/json',apikey:AI_KEY,Authorization:'Bearer '+session.access_token},body:JSON.stringify({message:text,context:portalContext(),allowWeb:$('#webToggle').checked,mode:fromVoice?'voice':'text',history:previous,attachments:attachments.map(a=>({path:a.path,name:a.name,type:a.type,size:a.size}))})});
    const j=await r.json();wait.remove();if(!r.ok)throw Error(j.error||'AI request failed');
    const answer=j.text||'Done.';const n=aiMessage('assistant',answer);addCitations(n,j.citations);chatHistory.push({role:'assistant',text:answer});
    pendingChatAttachments=[];renderAttachmentTray();if(j.proposedAction)showProposal(j.proposedAction,j.proposalSummary);
  }catch(err){wait.remove();aiMessage('system',err.message||'Taylor 5K AI is temporarily unavailable.')}finally{$('#aiStatus').textContent='Ready';aiBusy=false}
};
try{sendAI=()=>sendChatAI(false)}catch{}

// Replace the early Realtime event handler with a deduplicated version before Voice is started.
handleRealtimeEvent=function(evt){
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
      const t=String(e.transcript||e.text||rtAssistantText||'').trim();if(t&&t!==rtLastAssistantTranscript){rtLastAssistantTranscript=t;aiMessage('assistant',t);chatHistory.push({role:'assistant',text:t})}rtAssistantText='';break;
    }
    case 'response.output_item.done':case 'conversation.item.done':{
      const item=e.item;if(item?.type==='function_call'&&item?.name==='propose_portal_update'&&!rtHandledCalls.has(item.call_id)){rtHandledCalls.add(item.call_id);handleRealtimeProposal(item)}
      if(item?.type==='message'){const t=realtimeMessageText(item);if(t&&t!==rtLastAssistantTranscript){rtLastAssistantTranscript=t;aiMessage('assistant',t);chatHistory.push({role:'assistant',text:t})}}
      break;
    }
    case 'response.done':setRtUi('Listening…','listening');rtAssistantText='';break;
    case 'error':console.warn('Taylor Realtime',e);setRtUi('Voice error','error');break;
  }
};

queueMicrotask(()=>{
  const subtitle=$('#aiPanel .ai-panel-head small');if(subtitle)subtitle.textContent='GPT-5.6 CHAT · GPT REALTIME VOICE · FILES & PHOTOS · LIVE RESEARCH';
  const btn=$('#voiceModeBtn');if(btn)btn.textContent='◉ Voice';
});

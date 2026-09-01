const TAYLOR_NATURAL_TTS_URL='https://vofnxwgjqxgahjiobtqw.supabase.co/functions/v1/taylor5k-tts';
let naturalVoiceAudio=null,naturalVoiceUrl=null,naturalVoiceGeneration=0;

function cleanupNaturalVoice(){
  if(naturalVoiceAudio){try{naturalVoiceAudio.pause()}catch{};naturalVoiceAudio.src='';naturalVoiceAudio=null}
  if(naturalVoiceUrl){try{URL.revokeObjectURL(naturalVoiceUrl)}catch{};naturalVoiceUrl=null}
}
function resumeInteractiveListening(){
  voiceModeSpeaking=false;
  if(voiceModeActive){updateVoiceCard('Your turn…',true);setTimeout(listenVoiceMode,250)}
}
async function fallbackLocalVoice(text,generation){
  if(generation!==naturalVoiceGeneration||!voiceModeActive)return;
  if(!('speechSynthesis'in window)){resumeInteractiveListening();return}
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(String(text).replace(/https?:\/\/\S+/g,''));
  const voices=speechSynthesis.getVoices();
  u.voice=voices.find(v=>/Samantha|Ava|Aria|Google US English/i.test(v.name))||voices.find(v=>/^en-US/i.test(v.lang))||voices.find(v=>/^en/i.test(v.lang))||null;
  u.rate=1.02;u.pitch=1;
  u.onend=resumeInteractiveListening;u.onerror=resumeInteractiveListening;
  speechSynthesis.speak(u);
}

speakVoiceReply=async function(text){
  if(!voiceModeActive)return;
  const generation=++naturalVoiceGeneration;
  voiceModeSpeaking=true;
  try{chatRecognition?.stop()}catch{}
  try{speechSynthesis?.cancel()}catch{}
  cleanupNaturalVoice();
  updateVoiceCard('Taylor 5K AI is speaking…',false);
  try{
    const r=await fetch(TAYLOR_NATURAL_TTS_URL,{method:'POST',headers:{apikey:AI_KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({text:String(text).slice(0,5000),voice:'coral'})});
    if(!r.ok){let j={};try{j=await r.json()}catch{};throw Error(j.error||'Natural voice unavailable')}
    if(generation!==naturalVoiceGeneration||!voiceModeActive)return;
    const blob=await r.blob();naturalVoiceUrl=URL.createObjectURL(blob);naturalVoiceAudio=new Audio(naturalVoiceUrl);
    naturalVoiceAudio.preload='auto';
    naturalVoiceAudio.onended=()=>{if(generation!==naturalVoiceGeneration)return;cleanupNaturalVoice();resumeInteractiveListening()};
    naturalVoiceAudio.onerror=()=>{if(generation!==naturalVoiceGeneration)return;cleanupNaturalVoice();fallbackLocalVoice(text,generation)};
    await naturalVoiceAudio.play();
  }catch(err){if(generation!==naturalVoiceGeneration)return;cleanupNaturalVoice();fallbackLocalVoice(text,generation)}
};

const baseStartVoiceModeNatural=startVoiceMode;
startVoiceMode=function(){baseStartVoiceModeNatural();if($('#voiceModeBtn')&&voiceModeActive)$('#voiceModeBtn').textContent='● Natural Voice on';const card=$('#voiceSessionCard');if(card){card.querySelector('strong').textContent='Natural Voice';card.querySelector('small').textContent='Listening…'}};

const baseStopVoiceModeNatural=stopVoiceMode;
stopVoiceMode=function(){naturalVoiceGeneration++;cleanupNaturalVoice();try{speechSynthesis?.cancel()}catch{};baseStopVoiceModeNatural();if($('#voiceModeBtn'))$('#voiceModeBtn').textContent='🎙 Natural Voice'};

if($('#voiceModeBtn'))$('#voiceModeBtn').textContent='🎙 Natural Voice';
window.addEventListener('pagehide',()=>{naturalVoiceGeneration++;cleanupNaturalVoice()});
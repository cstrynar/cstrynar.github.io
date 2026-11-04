(() => {
 const pendingKey='mercuryDeletePendingV1';
 const dialog=document.createElement('dialog');
 dialog.setAttribute('aria-labelledby','deleteEventTitle');
 dialog.style.cssText='max-width:540px;width:calc(100% - 40px);border:1px solid #ddd;border-radius:12px;padding:24px';
 dialog.innerHTML='<h2 id="deleteEventTitle">Permanently delete event</h2><p id="deleteEventName"></p><p>This permanently removes the event, results, entries, race settings, and Bridge access. This cannot be undone. Stop publishing this event from Mercury Bridge before continuing. Other events and previously created copies are kept.</p><label for="deleteEventConfirm">Type the exact event name to confirm</label><input id="deleteEventConfirm" autocomplete="off" style="width:100%;box-sizing:border-box;margin:8px 0"><p id="deleteEventStatus" role="status"></p><div class="actions"><button type="button" id="confirmDeleteEvent" style="background:#a11020;color:white" disabled>Delete permanently</button><button type="button" id="cancelDeleteEvent">Cancel</button></div>';
 document.body.append(dialog);
 const get=id=>dialog.querySelector('#'+id), confirm=get('deleteEventConfirm'), button=get('confirmDeleteEvent'), message=get('deleteEventStatus');
 let target=null,busy=false;
 function pending(){try{return JSON.parse(sessionStorage.getItem(pendingKey)||'null')}catch{return null}}
 function display(){
  get('deleteEventName').textContent=target.confirm_name+' ('+target.slug+')';
  confirm.value='';button.disabled=true;message.textContent='';dialog.showModal();confirm.focus();
 }
 document.querySelector('#deleteEventBtn').onclick=()=>{
  if(!token)return;
  const saved=pending();
  if(saved){target=saved;display();message.textContent='A previous deletion needs confirmation of its outcome. Retry safely to finish it.';return}
  const context=eventMutationContext();if(!context)return;
  target={event_id:loaded.event.id,confirm_name:loaded.event.name,slug:context.slug};display();
 };
 confirm.oninput=()=>{button.disabled=busy||confirm.value!==target?.confirm_name};
 get('cancelDeleteEvent').onclick=()=>{if(!busy)dialog.close()};
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault()});
 button.onclick=async()=>{
  if(busy||!target||confirm.value!==target.confirm_name)return;
  busy=true;button.disabled=true;get('cancelDeleteEvent').disabled=true;
  try{
   // Save before transport, so a lost response can be retried against the same
   // immutable event ID even if another event later reuses the slug.
   sessionStorage.setItem(pendingKey,JSON.stringify(target));
   message.textContent='Deleting event…';
   const response=await fetch(API+'/admin-delete-event',{method:'POST',headers:authHeaders(),body:JSON.stringify(target)});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'deletion_outcome_unknown');
   if(!result.deleted)throw Error('deletion_outcome_unknown');
   if(result.assets_cleaned){
    sessionStorage.removeItem(pendingKey);dialog.close();
    await loadEvents();alert('Event permanently deleted.');
   }else{
    message.textContent='The event and its results are deleted. Logo cleanup is still pending. Click Delete permanently again to finish cleanup safely.';
    await loadEvents();
   }
  }catch(error){
   const messages={confirmation_mismatch:'The event name changed or does not match. Cancel, refresh, and try again.',duplication_in_progress:'Finish or cancel the pending duplication of this event before deleting it.',event_not_found:'This event no longer exists. Refresh the event list.',unauthorized:'Your session expired. Sign in again, then retry Delete event.'};
   if(['confirmation_mismatch','duplication_in_progress','event_not_found'].includes(error.message))sessionStorage.removeItem(pendingKey);
   message.textContent=messages[error.message]||'Deletion could not be confirmed. Retry Delete event to check and finish the same deletion safely.';
  }finally{busy=false;button.disabled=confirm.value!==target.confirm_name;get('cancelDeleteEvent').disabled=false}
 };
})();

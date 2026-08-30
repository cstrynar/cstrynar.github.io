// Member mutations are handled only by the protected Super Admin workflow.
// Keep the legacy Team & Access roster read-only so it cannot bypass safeguards.
const baseCanEditForAdmin = canEdit;
canEdit = function(entity){
  if(entity==='team_members') return false;
  return baseCanEditForAdmin(entity);
};

// Catch-up initializer: app-5 can finish its demo boot before app-admin.js loads.
// If that happened, install the role-aware shell controls now. In authenticated
// mode the wrapped boot in app-admin.js handles this normally.
queueMicrotask(async()=>{
  try{
    const app=document.querySelector('#app');
    if(app && !app.classList.contains('hidden')){
      installShellControls();
      await loadRoleExtras();
      renderPage();
      startPortalTimeTracking();
    }
  }catch(err){console.warn('Taylor 5K admin init:',err)}
});
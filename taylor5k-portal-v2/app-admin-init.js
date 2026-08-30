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
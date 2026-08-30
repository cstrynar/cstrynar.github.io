const SUPER_ADMIN_URL=BASE+'/functions/v1/portal-super-admin';
let lastInvite=null, portalSessionId=null, portalActiveSeconds=0, portalPageViews=1, portalLastTick=Date.now(), portalLastPage=currentPage, portalVisible=!document.hidden, portalHeartbeatTimer=null;

const baseLoadData=loadData;
loadData=async function(){
  await baseLoadData();
  await loadRoleExtras();
};
async function loadRoleExtras(){
  if(DEMO){
    data.team_members=structuredClone(demoData.team_members||[]);
    data.portal_sessions=[
      {id:'s1',member_id:'t1',user_id:'demo',started_at:new Date(Date.now()-3*60*60*1000).toISOString(),last_seen_at:new Date(Date.now()-4*60*1000).toISOString(),ended_at:null,active_seconds:8240,page_views:32,last_page:'dashboard'},
      {id:'s2',member_id:'t2',user_id:'demo2',started_at:new Date(Date.now()-26*60*60*1000).toISOString(),last_seen_at:new Date(Date.now()-25*60*60*1000).toISOString(),ended_at:new Date(Date.now()-25*60*60*1000).toISOString(),active_seconds:2760,page_views:11,last_page:'plan'}
    ];
    return;
  }
  if(me?.role==='super_admin'){
    try{data.team_members=await api('/rest/v1/team_members?select=*&order=added_at.asc')}catch{}
    try{data.portal_sessions=await api('/rest/v1/portal_sessions?select=*&order=started_at.desc&limit=1000')}catch{data.portal_sessions=[]}
  }
}

const baseRenderNav=renderNav;
renderNav=function(){
  baseRenderNav();
  const nav=$('#sidebarNav');
  if(['admin','super_admin'].includes(me?.role)) appendRoleNav(nav,'admin','Admin Center','activity');
  if(me?.role==='super_admin') appendRoleNav(nav,'superadmin','Super Admin','users');
};
function appendRoleNav(nav,id,label,icon){
  const b=document.createElement('button');b.className='nav-item role-nav '+(currentPage===id?'active':'');b.dataset.rolePage=id;b.innerHTML=ICONS[icon]+`<span>${label}</span>`;b.onclick=()=>openRolePage(id);nav.appendChild(b);
}

const baseRenderPage=renderPage;
renderPage=function(){
  if(currentPage==='admin') return renderAdminCenter();
  if(currentPage==='superadmin') return renderSuperAdminCenter();
  baseRenderPage();
  notePageView();
};
function setCustomHeading(title,tagline){renderNav();$('#pageHeading').textContent=title;$('#pageTagline').textContent=tagline}
async function openRolePage(page){
  if(page==='admin'&&!['admin','super_admin'].includes(me?.role)) return;
  if(page==='superadmin'&&me?.role!=='super_admin') return;
  if(page==='superadmin') await loadRoleExtras();
  currentPage=page;renderPage();closeMenuDrawer();
}

function adminCenterPage(){
  const m=calc(), audit=data.audit_log||[], ai=data.ai_activity||[], team=(data.team_members||[]).filter(x=>x.active!==false);
  return `<div class="page-layout admin-center">
    <div class="page-toolbar"><div><h2>Admin Center</h2><p class="kpi-note">Operational controls, activity, and project-wide shortcuts for Admin roles.</p></div><span class="role-badge admin">ADMIN</span></div>
    <div class="admin-kpis">
      <div class="admin-kpi"><span>${ICONS.tasks}</span><b>${m.open.length}</b><small>Open Tasks</small></div>
      <div class="admin-kpi"><span>${ICONS.decision}</span><b>${m.decisions.length}</b><small>Open Decisions</small></div>
      <div class="admin-kpi"><span>${ICONS.users}</span><b>${team.length}</b><small>Active Members</small></div>
      <div class="admin-kpi"><span>${ICONS.activity}</span><b>${audit.length}</b><small>Recent Audit Rows</small></div>
    </div>
    <div class="dashboard-grid admin-grid">
      <section class="panel admin-quick"><div class="panel-head"><div class="panel-title">Admin Shortcuts</div></div><div class="admin-actions">
        <button data-admin-page="tasks">${ICONS.tasks}<span>Tasks</span></button><button data-admin-page="budget">${ICONS.money}<span>Budget</span></button><button data-admin-page="permits">${ICONS.shield}<span>Permits</span></button><button data-admin-page="sponsors">${ICONS.trophy}<span>Sponsors</span></button><button data-admin-page="activity">${ICONS.activity}<span>Audit / AI</span></button><button data-admin-external="${CURRENT_PORTAL}/master.html">${ICONS.doc}<span>Master Doc</span></button>
      </div></section>
      <section class="panel admin-feed"><div class="panel-head"><div class="panel-title">Recent Portal Activity</div><button class="panel-link" data-admin-page="activity">View all</button></div><div class="activity-list">${audit.slice(0,8).map(x=>`<div class="activity"><span class="activity-icon purple">✎</span><span class="activity-copy"><strong>${esc(x.action||'Update')}</strong><small>${esc(x.entity_type||'Portal')}</small></span><time>${x.created_at?new Date(x.created_at).toLocaleString():''}</time></div>`).join('')||'<div class="admin-empty">No audit activity loaded.</div>'}</div></section>
      <section class="panel admin-ai"><div class="panel-head"><div class="panel-title">Recent AI Activity</div></div><div class="activity-list">${ai.slice(0,6).map(x=>`<div class="activity"><span class="activity-icon purple">✦</span><span class="activity-copy"><strong>${esc(x.question||'AI request')}</strong><small>${esc(x.answer_summary||'')}</small></span><time>${x.created_at?new Date(x.created_at).toLocaleString():''}</time></div>`).join('')||'<div class="admin-empty">No AI activity loaded.</div>'}</div></section>
    </div>
  </div>`;
}
function renderAdminCenter(){
  if(!['admin','super_admin'].includes(me?.role)){currentPage='dashboard';return baseRenderPage()}
  setCustomHeading('Admin Center','Operational controls and project activity.');$('#content').innerHTML=adminCenterPage();bindAdminCenter();notePageView();
}
function bindAdminCenter(){
  $$('[data-admin-page]').forEach(b=>b.onclick=()=>{currentPage=b.dataset.adminPage;renderPage()});
  $$('[data-admin-external]').forEach(b=>b.onclick=()=>window.open(b.dataset.adminExternal,'_blank','noopener'));
}

function formatDuration(sec){sec=Math.max(0,Number(sec)||0);const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);if(h)return `${h}h ${m}m`;if(m)return `${m}m`;return `${Math.floor(sec)}s`}
function memberTimeSummary(){
  const sessions=data.portal_sessions||[], members=data.team_members||[], cutoff=Date.now()-30*24*60*60*1000, map=new Map();
  for(const member of members)map.set(member.id,{member,total:0,last30:0,sessions:0,lastSeen:null,activeNow:false});
  for(const s of sessions){let x=map.get(s.member_id);if(!x){x={member:{id:s.member_id,display_name:'Former / Removed Member',email:'',role:'',active:false},total:0,last30:0,sessions:0,lastSeen:null,activeNow:false};map.set(s.member_id,x)}const seconds=Number(s.active_seconds||0);x.total+=seconds;x.sessions++;if(new Date(s.started_at).getTime()>=cutoff)x.last30+=seconds;const seen=s.last_seen_at?new Date(s.last_seen_at):null;if(seen&&(!x.lastSeen||seen>x.lastSeen))x.lastSeen=seen;if(!s.ended_at&&seen&&Date.now()-seen.getTime()<120000)x.activeNow=true}
  return [...map.values()].sort((a,b)=>b.total-a.total);
}
function inviteBox(){if(!lastInvite)return '';return `<div class="invite-result"><div><span class="eyebrow">ONE-TIME SETUP CREATED</span><strong>${esc(lastInvite.member?.display_name||lastInvite.member?.email||'Member')}</strong><p>Send this setup link and 8-digit code. The code expires ${new Date(lastInvite.setup.expires_at).toLocaleString()}.</p></div><div class="invite-values"><label>Setup link<input readonly id="inviteLink" value="${esc(lastInvite.setup.setup_url)}"></label><label>8-digit code<input readonly id="inviteCode" value="${esc(lastInvite.setup.code)}"></label></div><div class="invite-buttons"><button class="button primary" id="copyInvite">Copy Link + Code</button><a class="button ghost" href="${esc(lastInvite.setup.setup_url)}" target="_blank">Open Setup Page ↗</a></div></div>`}
function superAdminPage(){
  const members=data.team_members||[], stats=memberTimeSummary(), sessions=data.portal_sessions||[], total=stats.reduce((s,x)=>s+x.total,0), total30=stats.reduce((s,x)=>s+x.last30,0), active=stats.filter(x=>x.activeNow).length;
  return `<div class="page-layout super-center">
    <div class="page-toolbar"><div><h2>Super Admin</h2><p class="kpi-note">Member access, one-time setup, protected roles, and portal usage time.</p></div><span class="role-badge super">SUPER ADMIN</span></div>
    <div class="admin-kpis super-kpis"><div class="admin-kpi"><span>${ICONS.users}</span><b>${members.filter(x=>x.active).length}</b><small>Active Members</small></div><div class="admin-kpi"><span>${ICONS.activity}</span><b>${formatDuration(total30)}</b><small>Tracked Time · 30 Days</small></div><div class="admin-kpi"><span>${ICONS.activity}</span><b>${formatDuration(total)}</b><small>Total Tracked Time</small></div><div class="admin-kpi"><span>${ICONS.dashboard}</span><b>${active}</b><small>Active Now</small></div></div>
    ${inviteBox()}
    <section class="super-section"><div class="super-section-head"><div><h3>Add / Invite Member</h3><p>Creates or reactivates the member and generates a one-time 8-digit setup code.</p></div></div><form id="addMemberForm" class="member-add-form"><label>Name<input name="display_name" required placeholder="Full name"></label><label>Email<input name="email" type="email" required placeholder="name@example.com"></label><label>Role<select name="role"><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Admin</option><option value="super_admin">Super Admin</option></select></label><button class="button primary" type="submit">＋ Add Member</button><span id="memberAddStatus"></span></form></section>
    <section class="super-section"><div class="super-section-head"><div><h3>Members & Access</h3><p>Protected Super Admins cannot be removed or demoted.</p></div></div><div class="member-list">${members.map(memberCard).join('')}</div></section>
    <section class="super-section"><div class="super-section-head"><div><h3>Portal Time Tracking</h3><p>Active time is recorded while the portal is visible. Tracking begins with this feature; earlier historical time is not retroactive.</p></div><button class="button ghost" id="exportTimeCsv">Export CSV</button></div><div class="usage-list">${stats.map(timeRow).join('')||'<div class="admin-empty">No tracked sessions yet.</div>'}</div><h4 class="recent-session-title">Recent Sessions</h4><div class="data-card">${sessionTable(sessions.slice(0,25),members)}</div></section>
  </div>`;
}
function memberCard(m){const protectedText=m.protected?'<span class="member-protected">Protected</span>':'';const loginText=m.user_id?'Login active':'Setup pending';return `<div class="member-card" data-member-id="${esc(m.id)}"><div class="member-identity"><div class="member-avatar">${esc(initials(m.display_name||m.email))}</div><div><strong>${esc(m.display_name||m.email)}</strong><small>${esc(m.email)}</small><span class="login-state ${m.user_id?'live':'pending'}">${loginText}</span>${protectedText}</div></div><div class="member-controls"><label>Name<input data-member-name value="${esc(m.display_name||'')}"></label><label>Role<select data-member-role ${m.protected?'disabled':''}>${['viewer','editor','admin','super_admin'].map(r=>`<option value="${r}" ${m.role===r?'selected':''}>${roleLabel(r)}</option>`).join('')}</select></label><label class="active-control"><span>Active</span><input data-member-active type="checkbox" ${m.active?'checked':''} ${m.protected?'disabled':''}></label></div><div class="member-actions"><button class="button ghost" data-save-member>Save</button><button class="button ghost" data-reset-member>New Setup Code</button><button class="button danger" data-remove-member ${m.protected?'disabled':''}>Remove</button></div></div>`}
function timeRow(x){return `<div class="usage-row"><div class="usage-person"><span class="usage-dot ${x.activeNow?'online':''}"></span><div><strong>${esc(x.member.display_name||x.member.email||'Member')}</strong><small>${esc(x.member.email||'')} · ${roleLabel(x.member.role)}</small></div></div><div><small>30 days</small><strong>${formatDuration(x.last30)}</strong></div><div><small>All time</small><strong>${formatDuration(x.total)}</strong></div><div><small>Sessions</small><strong>${x.sessions}</strong></div><div><small>Last seen</small><strong>${x.lastSeen?x.lastSeen.toLocaleString():'Never'}</strong></div></div>`}
function sessionTable(sessions,members){if(!sessions.length)return '<div class="admin-empty">No sessions yet.</div>';const memberMap=new Map(members.map(m=>[m.id,m]));return `<div class="data-table-wrap"><table class="data-table usage-table"><thead><tr><th>Member</th><th>Started</th><th>Active Time</th><th>Page Views</th><th>Last Page</th><th>Last Seen</th></tr></thead><tbody>${sessions.map(s=>{const m=memberMap.get(s.member_id)||{};return `<tr><td>${esc(m.display_name||m.email||'Former member')}</td><td>${s.started_at?new Date(s.started_at).toLocaleString():''}</td><td>${formatDuration(s.active_seconds)}</td><td>${Number(s.page_views||0)}</td><td>${esc(s.last_page||'')}</td><td>${s.last_seen_at?new Date(s.last_seen_at).toLocaleString():''}</td></tr>`}).join('')}</tbody></table></div>`}
function renderSuperAdminCenter(){
  if(me?.role!=='super_admin'){currentPage='dashboard';return baseRenderPage()}
  setCustomHeading('Super Admin','Manage people, permissions, and portal usage.');$('#content').innerHTML=superAdminPage();bindSuperAdmin();notePageView();
}
async function superAction(payload){if(DEMO){await new Promise(r=>setTimeout(r,220));return {ok:true,member:{display_name:payload.display_name||'Preview Member',email:payload.email||'preview@example.com'},setup:{code:'48271539',expires_at:new Date(Date.now()+7*86400000).toISOString(),setup_url:location.origin+location.pathname.replace(/index\.html$/,'')+'setup.html?email='+encodeURIComponent(payload.email||'preview@example.com')}}}const r=await fetch(SUPER_ADMIN_URL,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});const j=await r.json();if(!r.ok)throw Error(j.error||'Super Admin action failed');return j}
function bindSuperAdmin(){
  $('#addMemberForm')?.addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.currentTarget),status=$('#memberAddStatus');status.textContent='Creating invite…';try{const res=await superAction({action:'add_member',display_name:fd.get('display_name'),email:fd.get('email'),role:fd.get('role')});lastInvite=res;status.textContent='Invite ready ✓';if(!DEMO)await loadRoleExtras();renderSuperAdminCenter()}catch(err){status.textContent=err.message}});
  $$('.member-card').forEach(card=>{const id=card.dataset.memberId;card.querySelector('[data-save-member]')?.addEventListener('click',async()=>{const btn=card.querySelector('[data-save-member]');btn.textContent='Saving…';try{await superAction({action:'update_member',member_id:id,display_name:card.querySelector('[data-member-name]').value,role:card.querySelector('[data-member-role]').value,active:card.querySelector('[data-member-active]').checked});await loadRoleExtras();renderSuperAdminCenter()}catch(err){alert(err.message);btn.textContent='Save'}});card.querySelector('[data-reset-member]')?.addEventListener('click',async()=>{try{const member=(data.team_members||[]).find(x=>String(x.id)===String(id));const res=await superAction({action:'regenerate_setup',member_id:id});lastInvite={member,setup:res.setup};renderSuperAdminCenter()}catch(err){alert(err.message)}});card.querySelector('[data-remove-member]')?.addEventListener('click',async()=>{const member=(data.team_members||[]).find(x=>String(x.id)===String(id));if(!confirm(`Remove ${member?.display_name||member?.email||'this member'} from the Taylor 5K portal? Their portal login will also be removed.`))return;try{await superAction({action:'remove_member',member_id:id});await loadRoleExtras();renderSuperAdminCenter()}catch(err){alert(err.message)}})});
  $('#copyInvite')?.addEventListener('click',async()=>{if(!lastInvite)return;const text=`Taylor 5K Portal Setup\n${lastInvite.setup.setup_url}\nInvite code: ${lastInvite.setup.code}`;try{await navigator.clipboard.writeText(text);$('#copyInvite').textContent='Copied ✓'}catch{}});
  $('#exportTimeCsv')?.addEventListener('click',exportTimeCsv);
}
function exportTimeCsv(){const rows=[['Name','Email','Role','30 Day Active Time (seconds)','All Time Active Time (seconds)','Sessions','Last Seen']];for(const x of memberTimeSummary())rows.push([x.member.display_name||'',x.member.email||'',roleLabel(x.member.role),x.last30,x.total,x.sessions,x.lastSeen?x.lastSeen.toISOString():'']);const csv=rows.map(r=>r.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n'),blob=new Blob([csv],{type:'text/csv'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Taylor5K_Portal_Time.csv';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}

const baseSetIdentity=setIdentity;
setIdentity=function(){baseSetIdentity();installShellControls()};
function installShellControls(){
  if(!$('#menuDrawer'))document.body.insertAdjacentHTML('beforeend',`<div id="menuBackdrop" class="menu-backdrop"></div><aside id="menuDrawer" class="menu-drawer" aria-hidden="true"><div class="menu-drawer-head"><div class="brand-lockup compact"><span class="crown">♛</span><div><strong>Kent Taylor <em>5K</em></strong><small>Portal Menu</small></div></div><button id="menuClose" type="button">×</button></div><div id="menuRoleActions" class="menu-role-actions"></div><nav id="hamburgerNav" class="hamburger-nav"></nav><div class="hamburger-external"><a href="${CURRENT_PORTAL}/master.html" target="_blank">Full Master Planning Doc ↗</a><a href="${CURRENT_PORTAL}/marketing.html" target="_blank">Marketing Library ↗</a><a href="https://taylor-5k-preview.vercel.app" target="_blank">Public Website ↗</a></div></aside>`);
  if(!$('#desktopHamburger'))$('.top-actions')?.insertAdjacentHTML('afterbegin','<button id="desktopHamburger" class="hamburger-button" type="button" title="Open menu">☰</button>');
  if(!$('#mobileHamburger'))$('.mobile-head-actions')?.insertAdjacentHTML('afterbegin','<button id="mobileHamburger" class="hamburger-button mobile" type="button" title="Open menu">☰</button>');
  installRoleButtons();renderHamburger();
  $('#desktopHamburger')?.addEventListener('click',openMenuDrawer);$('#mobileHamburger')?.addEventListener('click',openMenuDrawer);$('#menuClose')?.addEventListener('click',closeMenuDrawer);$('#menuBackdrop')?.addEventListener('click',closeMenuDrawer);
}
function installRoleButtons(){const top=$('.top-actions');if(!top)return;if(['admin','super_admin'].includes(me?.role)&&!$('#adminCenterBtn')){const b=document.createElement('button');b.id='adminCenterBtn';b.className='button role-button admin';b.textContent='Admin';b.onclick=()=>openRolePage('admin');top.insertBefore(b,top.querySelector('[data-open-ai]'))}if(me?.role==='super_admin'&&!$('#superAdminBtn')){const b=document.createElement('button');b.id='superAdminBtn';b.className='button role-button super';b.textContent='Super Admin';b.onclick=()=>openRolePage('superadmin');top.insertBefore(b,top.querySelector('[data-open-ai]'))}}
function renderHamburger(){const nav=$('#hamburgerNav'),role=$('#menuRoleActions');if(!nav||!role)return;role.innerHTML=`${['admin','super_admin'].includes(me?.role)?'<button data-menu-role="admin">Admin Center</button>':''}${me?.role==='super_admin'?'<button class="super" data-menu-role="superadmin">Super Admin</button>':''}`;role.querySelectorAll('[data-menu-role]').forEach(b=>b.onclick=()=>openRolePage(b.dataset.menuRole));const visible=navItems.filter(([id])=>id!=='budget'||['admin','super_admin'].includes(me?.role)).filter(([id])=>id!=='activity'||['admin','super_admin'].includes(me?.role));nav.innerHTML=visible.map(([id,label,icon,url])=>`<button ${url?`data-menu-external="${url}"`:`data-menu-page="${id}"`}>${ICONS[icon]}<span>${label}</span></button>`).join('');nav.querySelectorAll('[data-menu-page]').forEach(b=>b.onclick=()=>{currentPage=b.dataset.menuPage;renderPage();closeMenuDrawer()});nav.querySelectorAll('[data-menu-external]').forEach(b=>b.onclick=()=>{window.open(b.dataset.menuExternal,'_blank','noopener');closeMenuDrawer()})}
function openMenuDrawer(){renderHamburger();$('#menuDrawer').classList.add('open');$('#menuBackdrop').classList.add('open');$('#menuDrawer').setAttribute('aria-hidden','false')}
function closeMenuDrawer(){$('#menuDrawer')?.classList.remove('open');$('#menuBackdrop')?.classList.remove('open');$('#menuDrawer')?.setAttribute('aria-hidden','true')}

const baseBoot=boot;
boot=function(){baseBoot();installShellControls();loadRoleExtras();startPortalTimeTracking()};

async function startPortalTimeTracking(){
  if(DEMO||portalSessionId||!session?.user?.id||!me?.id)return;
  try{const rows=await api('/rest/v1/portal_sessions',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({user_id:session.user.id,member_id:me.id,last_page:currentPage,user_agent:String(navigator.userAgent||'').slice(0,500)})});portalSessionId=rows?.[0]?.id||null;portalActiveSeconds=Number(rows?.[0]?.active_seconds||0);portalPageViews=Number(rows?.[0]?.page_views||1);portalLastTick=Date.now();portalVisible=!document.hidden;portalLastPage=currentPage;if(portalSessionId){portalHeartbeatTimer=setInterval(()=>heartbeatPortalTime(false),30000)}}catch{}
}
async function heartbeatPortalTime(ending=false){if(!portalSessionId||DEMO)return;const now=Date.now();if(portalVisible){const delta=Math.max(0,Math.min(60,Math.round((now-portalLastTick)/1000)));portalActiveSeconds+=delta}portalLastTick=now;const body={active_seconds:portalActiveSeconds,page_views:portalPageViews,last_seen_at:new Date().toISOString(),last_page:currentPage};if(ending)body.ended_at=new Date().toISOString();try{await fetch(BASE+'/rest/v1/portal_sessions?id=eq.'+encodeURIComponent(portalSessionId),{method:'PATCH',headers:{...headers(),Prefer:'return=minimal'},body:JSON.stringify(body),keepalive:ending})}catch{}}
function notePageView(){if(!portalSessionId||DEMO||portalLastPage===currentPage)return;portalLastPage=currentPage;portalPageViews++;heartbeatPortalTime(false)}
document.addEventListener('visibilitychange',()=>{if(DEMO||!portalSessionId)return;if(document.hidden&&portalVisible){heartbeatPortalTime(false);portalVisible=false}else if(!document.hidden){portalVisible=true;portalLastTick=Date.now()}});
window.addEventListener('pagehide',()=>heartbeatPortalTime(true));
$('#logoutBtn').onclick=async()=>{if(portalHeartbeatTimer)clearInterval(portalHeartbeatTimer);await heartbeatPortalTime(true);localStorage.removeItem(SESSION_KEY);location.reload()};

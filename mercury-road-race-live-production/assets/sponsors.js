(() => {
  'use strict';
  function safeURL(value) {
    try { const u=new URL(value); return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null; } catch { return null; }
  }
  function render(sponsor) {
    for(const [id,placement] of [['sponsorTop','top'],['sponsorBottom','bottom']]) {
      const host=document.getElementById(id);host.replaceChildren();host.hidden=true;
      const items=(Array.isArray(sponsor?.items)?sponsor.items.slice(0,3):[]).filter(s=>s.name||s.logoUrl);
      if(!sponsor?.[placement]||!items.length)continue;
      const card=document.createElement('section');card.className='event-sponsor';card.setAttribute('aria-label','Event sponsor');
      const label=document.createElement('small');label.textContent=items.length===1?'Event sponsor':'Event sponsors';card.append(label);
      const group=document.createElement('div');group.className='event-sponsor-group';group.dataset.count=String(items.length);card.append(group);
      for(const sponsor of items){
      const url=safeURL(sponsor.website),identity=document.createElement(url?'a':'div');identity.className='event-sponsor-identity';
      if(url){identity.href=url;identity.target='_blank';identity.rel='noopener noreferrer';}
      const logo=safeURL(sponsor.logoUrl);
      if(logo){const img=document.createElement('img');img.src=logo;img.alt=sponsor.alt||`${sponsor.name||'Event sponsor'} logo`;img.onerror=()=>{img.remove();if(!sponsor.name)identity.remove();};identity.append(img);}
      if(sponsor.name){const name=document.createElement('strong');name.textContent=sponsor.name;identity.append(name);}
      if(!logo&&!sponsor.name)continue;
      group.append(identity);}
      host.append(card);host.hidden=false;
    }
  }
  window.MercurySponsors={render};
})();

(function(root){
 const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
 function date(e){
  const raw=e.event_date||e.dateISO||e.date||'';
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
  const match=/^(\w+) (\d{1,2}), (\d{4})$/.exec(raw),month=match?months.indexOf(match[1]):-1;
  return month<0?'':match[3]+'-'+String(month+1).padStart(2,'0')+'-'+match[2].padStart(2,'0');
 }
 function today(){const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day}
 function isPast(e,day=today()){return ['finished','official','archived'].includes(e.status)||!!date(e)&&date(e)<day}
 function filter(events,scope,query='',day=today()){
  const q=query.trim().toLowerCase();
  return events.filter(e=>(scope==='all'||(scope==='past')===isPast(e,day))&&(!q||(e.name+' '+date(e)).toLowerCase().includes(q))).sort((a,b)=>{
   const ap=isPast(a,day),bp=isPast(b,day);if(ap!==bp)return ap?1:-1;
   return (ap?date(b).localeCompare(date(a)):(date(a)||'9999').localeCompare(date(b)||'9999'))||String(a.name).localeCompare(String(b.name))||String(a.slug).localeCompare(String(b.slug));
  });
 }
 root.MercuryHistory={date,isPast,filter};
 if(typeof module!=='undefined')module.exports=root.MercuryHistory;
})(typeof window==='undefined'?globalThis:window);

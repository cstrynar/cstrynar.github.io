const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../admin/index.html'),'utf8');
function fixture(events){
 const nodes=new Map();function node(){return {value:'',textContent:'',options:[],disabled:false,hidden:false,classList:{add(){},remove(){}},replaceChildren(){this.options=[]},append(o){this.options.push(o)},setAttribute(){},focus(){}}}
 const ctx={eventCatalog:events,eventIsCurrent:e=>e.status!=='archived'&&(!e.event_date||e.event_date>='2026-11-04'),document:{createElement:node},$:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},window:{MercuryDuplicate:{hasPending:()=>false,open:async slug=>{ctx.opened=slug}}},setNewEventMode:active=>{ctx.active=active},hideStatus(){}};
 vm.createContext(ctx);vm.runInContext(html.slice(html.indexOf('function pastEventsForDuplication(){'),html.indexOf('function openScratchEvent(){')),ctx);return ctx;
}
test('all past events newest first, including archived; no catalog mutation',()=>{
 const events=[{slug:'old',name:'Old',event_date:'2025-10-19'},{slug:'future',event_date:'2027-10-18'},{slug:'recent',name:'Recent',event_date:'2026-10-25'},{slug:'same-b',name:'Beta',event_date:'2026-10-18'},{slug:'same-a',name:'Alpha',event_date:'2026-10-18'},{slug:'undated',name:'Archive',status:'archived'},{slug:'today',event_date:'2026-11-04'}];const before=JSON.stringify(events);const c=fixture(events);assert.deepEqual(Array.from(c.pastEventsForDuplication(),e=>e.slug),['recent','same-a','same-b','old','undated']);assert.equal(JSON.stringify(events),before);
});
test('source dropdown uses text and requires explicit selection',async()=>{
 const c=fixture([{slug:'past',name:'<img src=x onerror=alert(1)>',event_date:'2026-10-18'}]);c.showPastEventChoice();const select=c.$('#duplicateSourceSelect');assert.equal(select.options.length,2);assert.equal(select.options[1].textContent,'<img src=x onerror=alert(1)> — 2026-10-18');assert.equal(c.$('#continueDuplicateBtn').disabled,true);select.value='past';select.onchange();assert.equal(c.$('#continueDuplicateBtn').disabled,false);await c.continueDuplicateEvent();assert.equal(c.opened,'past');
});
test('no past events disables selection and explains scratch option',()=>{const c=fixture([]);c.showPastEventChoice();assert.equal(c.$('#duplicateSourceSelect').disabled,true);assert.match(c.$('#duplicateSourceHelp').textContent,/create an event from scratch/)});
test('stale or injected source is not passed to duplicate handler',async()=>{const c=fixture([{slug:'future',event_date:'2027-01-01'}]);c.$('#duplicateSourceSelect').value='future';await c.continueDuplicateEvent();assert.equal(c.opened,undefined)});
test('pending creation is recovered before another new event can start',()=>{const c=fixture([]);let recovered=false;c.window.MercuryDuplicate={hasPending:()=>true,open:()=>{recovered=true}};c.openNewEvent();assert.equal(recovered,true);assert.equal(c.active,undefined)});
test('inline admin and duplication scripts compile',()=>{for(const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1]);new vm.Script(fs.readFileSync(path.join(__dirname,'../assets/duplicate-event.js'),'utf8'))});

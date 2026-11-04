const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function fixture(){
 const node=()=>({children:[],textContent:'',hidden:false,append(...x){this.children.push(...x)},replaceChildren(...x){this.children=x}}),panel=node();
 const ctx={window:{},Date,encodeURIComponent,loaded:{event:{slug:'test',name:'Test',status:'finished',is_public:true,current_revision:12,last_published_at:'2026-10-18T10:00:00Z'}},currentSlug:'test',document:{querySelector:()=>panel,createElement:node}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/admin-history.js'),'utf8'),ctx);
 const text=n=>n.textContent+' '+n.children.map(text).join(' ');
 return {ctx,panel,summary:ctx.window.MercuryAdminHistory.summary,text:()=>text(panel)};
}
test('closed event requires verified absence of writer and grants',()=>{const f=fixture();f.summary();assert(!f.text().includes('Closed · no active'));f.summary({clients:[],lease:null});assert(f.text().includes('Closed · no active writer or publishing access'));});
test('publishing grant or active writer prevents clean closeout message',()=>{const f=fixture();f.summary({clients:[{active:true,grant:{can_publish:true}}],lease:null});assert(f.text().includes('review remaining writer/access'));f.summary({clients:[],lease:{expires_at:new Date(Date.now()+60000).toISOString(),client_name:'Primary'}});assert(f.text().includes('review remaining writer/access'));});
test('failed access and mismatched selection cannot retain healthy summary',()=>{const f=fixture();f.summary({clients:[]});f.summary(null,true);assert(f.text().includes('Unavailable'));assert(!f.text().includes('Closed · no active'));f.ctx.currentSlug='other';f.summary();assert(f.panel.hidden);});
test('private event gets no public result link and old timestamps are labeled',()=>{const f=fixture();f.ctx.loaded.event.is_public=false;f.summary({clients:[]});assert(!f.text().includes('View public results'));assert(f.text().includes('not a live connection indicator'));});

const {test}=require('node:test'),assert=require('node:assert/strict');
const model=require('../assets/operator-dashboard.js');
const now=Date.parse('2026-11-04T14:00:00Z');
const data={event:{name:'Race',status:'live',is_public:true,current_revision:5,last_published_at:'2026-10-25T10:00:00Z'},raceMapping:{detectedRaces:[{label:'5K',count:12}],unmappedRaces:[]}};
const access={clients:[{name:'Primary',active:true,grant:{active:true,can_publish:true}}],policy:{require_lease:true},lease:{client_name:'Primary',expires_at:'2026-11-04T14:01:00Z'}};
test('valid lease does not claim connectivity, source freshness or queue health',()=>{const v=model(data,access,now);for(const label of ['Bridge connection','MYLAPS export freshness','Waiting / blocked uploads'])assert.equal(v.cards.find(c=>c[0]===label)[1],'Not reported');assert(v.alerts[0].includes('not verified'));});
test('expired lease alerts for live event without diagnosing internet failure',()=>{const v=model(data,{...access,lease:{expires_at:'2026-11-04T13:59:59Z'}},now);assert(v.alerts.some(a=>a.includes('no active writer lease')));assert.equal(v.cards.find(c=>c[0]==='Writer lease')[1],'No active writer lease');});
test('closed event reports remaining access and missing mapping explicitly',()=>{const v=model({event:{...data.event,status:'finished'},raceMapping:{}},access,now);assert(v.alerts.some(a=>a.includes('closed')));assert(v.alerts.some(a=>a.includes('not confirmed')));});
test('inactive client and inactive grant never count as authorized publisher',()=>{for(const clients of [[{active:false,grant:{active:true,can_publish:true}}],[{active:true,grant:{active:false,can_publish:true}}]])assert(model(data,{...access,clients},now).alerts.some(a=>a.includes('No timing computer')));});
test('private and unmapped races produce actionable alerts',()=>{const v=model({event:{...data.event,is_public:false},raceMapping:{unmappedRaces:[{label:'Unexpected 10K',count:3}]}},access,now);assert(v.alerts.some(a=>a.includes('private')));assert(v.alerts.some(a=>a.includes('Unexpected 10K')));});
test('future or malformed publication timestamps are not presented as verified',()=>{for(const last_published_at of ['bad','2027-01-01T00:00:00Z'])assert.equal(model({event:{...data.event,last_published_at}},access,now).cards.find(c=>c[0]==='Latest cloud publication')[1],'Timestamp unavailable');});

test('saved race row counts distinguish recognized and unmapped identities',()=>{
 const v=model({...data,raceMapping:{detectedRaces:[{label:'5K',count:12},{label:'Race 2',count:3}],unmappedRaces:[{label:'Race 2',count:3}]}},access,now);
 assert.equal(v.cards.find(c=>c[0]==='Saved race data')[1],'15 rows with race labels');
 assert.equal(v.cards.find(c=>c[0]==='Race mappings')[1],'1 need mapping');
 assert(v.cards.find(c=>c[0]==='Race mappings')[2].includes('Race 2: 3 rows — mapping required'));
});
test('empty, missing, malformed and inconsistent mapping reports never imply zero results or ready',()=>{
 for(const raceMapping of [undefined,{}, {detectedRaces:[],unmappedRaces:[]},
  {detectedRaces:[{label:'5K',count:'12'}],unmappedRaces:[]},
  {detectedRaces:[{label:'5K',count:12}]},
  {detectedRaces:[{label:'5K',count:12}],unmappedRaces:[{label:'10K',count:1}]},
  {detectedRaces:[{label:'5K',count:12},{label:'5K',count:12}],unmappedRaces:[]}]){
  const v=model({...data,raceMapping},access,now);
  assert.equal(v.cards.find(c=>c[0]==='Saved race data')[1],'Not confirmed');
  assert.equal(v.cards.find(c=>c[0]==='Race mappings')[1],'Not confirmed');
 }
});
const reportingAccess={...access,clients:[{id:'c1',name:'Primary',active:true,grant:{active:true,can_read:true,can_publish:true}}]};
const report={client_id:'c1',client_name:'Primary',session_id:'session',state:'watching',source_age_seconds:15,pending:false,staged:false,correction:false,received_at:'2026-11-04T13:59:50Z'};
test('fresh report conveys state, advancing export age and waiting flags',()=>{const v=model(data,reportingAccess,now,{reports:[{...report,pending:true}]});assert.match(v.cards[6][1],/recent/);assert.match(v.cards[7][2],/25 seconds/);assert.equal(v.cards[8][1],'Attention needed');assert.match(v.cards[8][2],/pending request/)});
test('stale, revoked and malformed reports never imply health',()=>{for(const r of [{...report,received_at:'2026-11-04T13:57:00Z'},{...report,client_id:'revoked'},{...report,received_at:'2027-01-01'},{...report,pending:'false'}]){const v=model(data,reportingAccess,now,{reports:[r]});assert.ok(!v.cards[6][1].includes('recent'));assert.equal(v.cards[7][1],'Not confirmed');assert.equal(v.cards[8][1],'Not confirmed')}});
test('multiple recent sessions are explicit, including paused reports',()=>{const v=model(data,reportingAccess,now,{reports:[report,{...report,session_id:'other',state:'paused'}]});assert.equal(v.cards[6][1],'2 recent session reports');assert.match(v.cards[6][2],/paused/)});

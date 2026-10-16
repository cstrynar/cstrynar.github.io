// Offline browser regressions. No package install or external requests required.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const ref=process.env.SOURCE_REF;
function source(file){return ref?execFileSync('git',['show',`${ref}:${file}`],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,file),'utf8')}
const admin=source('mercury-road-race-live-production/admin/index.html');
const pub=source('mercury-road-race-live-production/index.html');
const chunk=(s,start,end)=>s.slice(s.indexOf(start),s.indexOf(end,s.indexOf(start)));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mercury-offline-'));
const chrome=process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const proc=spawn(chrome,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--remote-debugging-port=0',`--user-data-dir=${temp}/profile`,'about:blank'],{stdio:['ignore','ignore','pipe']});
let stderr='';proc.stderr.on('data',b=>stderr+=b);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 let port;for(let i=0;i<100;i++){try{port=fs.readFileSync(`${temp}/profile/DevToolsActivePort`,'utf8').split('\n')[0];break}catch{}await pause(100)}
 if(!port)throw Error('Chrome did not start: '+stderr);
 const tabs=await(await fetch(`http://127.0.0.1:${port}/json`)).json();
 const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}};
 const call=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++seq,{resolve,reject});ws.send(JSON.stringify({id:seq,method,params}))});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 await call('Network.enable');await call('Network.setBlockedURLs',{urls:['http://*','https://*']});
 const markup=admin.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 fs.writeFileSync(`${temp}/admin.html`,markup);
 await call('Page.navigate',{url:`file://${temp}/admin.html`});await pause(100);
 const bulk=admin.split('\n').find(l=>l.startsWith("$('#separateGenderAgeGroups').onchange="))||'';
 await evaluate(`window.$=s=>document.querySelector(s);let preservedSpecialDivisions=[];${chunk(admin,'function ageNumber(','function parseElapsedOffset(')}\n${bulk}`);
 const results=[];
 async function test(name,body){try{await evaluate(`(async()=>{const eq=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(JSON.stringify({actual:a,expected:b}))};${body}})()`);results.push({name,pass:true})}catch(e){results.push({name,pass:false,error:e.message})}}
 await test('asymmetric Male/Female groups survive ordinary save and edits',`const groups=[{min:20,max:29,label:'20–29',division:'Male'},{min:30,max:39,label:'30–39',division:'Female'}];renderAwards({overall_places:3,age_groups:groups,special_divisions:[{label:'Veteran'}]});eq(collectAwards().age_groups,groups);document.querySelector('[data-age="label"]').value='Twenties';eq(collectAwards().age_groups[0].division,'Male');eq(collectAwards().special_divisions,[{label:'Veteran'}]);`);
 await test('single gender, combined, symmetric and open-ended groups round trip',`for(const divisions of [['Male'],['Female'],['All'],['Male','Female']]){const groups=divisions.map(division=>({min:80,max:999,label:'80+',division}));renderAwards({overall_places:3,age_groups:groups});eq(collectAwards().age_groups,groups)}`);
 await test('explicit bulk toggle still changes existing rows',`renderAwards({age_groups:[{min:20,max:29,label:'20–29',division:'Male'}]});$('#separateGenderAgeGroups').checked=false;$('#separateGenderAgeGroups').dispatchEvent(new Event('change'));eq(collectAwards().age_groups.map(g=>g.division),['All']);$('#separateGenderAgeGroups').checked=true;$('#separateGenderAgeGroups').dispatchEvent(new Event('change'));eq(collectAwards().age_groups.map(g=>g.division),['Male','Female']);`);
 await test('null and cleared overall count use Top 3 default without becoming zero',`renderAwards({overall_places:null});eq($('#overallPlaces').value,'');eq(collectAwards().overall_places,null);renderAwards({overall_places:20});$('#overallPlaces').value='';eq(collectAwards().overall_places,null);`);
 await test('cleared explicit count saves default instead of zero',`renderAwards({overall_places:3});$('#overallPlaces').value='';eq(collectAwards().overall_places,null);`);
 await test('missing count defaults; added and standard rows respect bulk choice',`renderAwards({});eq(collectAwards().overall_places,null);addAgeGroupRow({min:1,max:9,label:'Juniors'});eq(collectAwards().age_groups.map(g=>g.division),['Male','Female']);$('#separateGenderAgeGroups').checked=false;$('#separateGenderAgeGroups').dispatchEvent(new Event('change'));addAgeGroupRow({min:10,max:19,label:'Teens'});eq(collectAwards().age_groups.map(g=>g.division),['All','All']);useStandardAgeGroups();eq(collectAwards().age_groups.length,20);eq(collectAwards().age_groups.slice(-2).map(g=>g.division),['Male','Female']);`);
 await test('explicit overall 0, 1, 3, 20 and validation',`for(const n of [0,1,3,20]){renderAwards({overall_places:n});eq(collectAwards().overall_places,n)}for(const n of ['-1','21','1.5']){$('#overallPlaces').value=n;let failed=false;try{collectAwards()}catch{failed=true}eq(failed,true)}`);
 await evaluate(`let currentRaceKey='5K',currentEventSlug='mock-event',eventEpoch=1,teamSnapshot={};const requests=[];async function publicJSON(url){return new Promise((resolve,reject)=>requests.push({url,resolve,reject}))};${chunk(pub,'async function loadTeamScores(','async function loadSnapshot(')}`);
 await test('reordered 5K to 10K success cannot overwrite current race',`currentRaceKey='5K';const first=loadTeamScores();currentRaceKey='10K';const second=loadTeamScores();const r=requests.splice(0);eq(r.map(x=>x.url),['team-scores?slug=mock-event&race=5K','team-scores?slug=mock-event&race=10K']);r[1].resolve({event:{slug:'mock-event'},race:'10K'});await second;r[0].resolve({event:{slug:'mock-event'},race:'5K'});await first;eq(teamSnapshot.race,'10K');`);
 await test('stale race failure cannot clear current scores',`currentRaceKey='5K';const first=loadTeamScores();currentRaceKey='10K';const second=loadTeamScores();const r=requests.splice(0);r[1].resolve({event:{slug:'mock-event'},race:'10K'});await second;r[0].reject(Error('mock failure'));await first;eq(teamSnapshot.race,'10K');`);
 await test('stale event response and failure cannot affect new event',`currentRaceKey=null;const first=loadTeamScores();const second=loadTeamScores();const r=requests.splice(0);eventEpoch++;currentEventSlug='new-event';teamSnapshot={race:'new'};r[0].resolve({event:{slug:'mock-event'}});r[1].reject(Error('mock'));await Promise.all([first,second]);eq(teamSnapshot.race,'new');`);
 await test('current success with no selected race is accepted',`currentRaceKey=null;const p=loadTeamScores();const r=requests.shift();eq(r.url,'team-scores?slug=new-event');r.resolve({event:{slug:'new-event'},race:'all'});await p;eq(teamSnapshot.race,'all');`);
 await test('slug-only stale failure does not clear current scores',`const p=loadTeamScores();const r=requests.shift();currentEventSlug='other-event';teamSnapshot={race:'other'};r.reject(Error('mock'));await p;eq(teamSnapshot.race,'other');`);
 await test('current request failure disables scores',`const p=loadTeamScores();requests.shift().reject(Error('mock'));await p;eq(teamSnapshot,{enabled:false,tabActive:false,divisions:[]});`);
 await evaluate(pub.split('\n').find(line=>line.startsWith('function overallAwardPlaces()')));
 // Verify public defaults using the production function independently of admin collection.
 await test('public overall default and explicit counts match admin semantics',`window.snapshot={awards:{}};for(const [value,want] of [[null,3],[undefined,3],[0,0],[1,1],[3,3],[20,20]]){snapshot.awards.overall_places=value;eq(overallAwardPlaces(),want)}`);
 for(const r of results)console.log(`${r.pass?'PASS':'FAIL'} ${r.name}${r.pass?'':'\n'+r.error}`);
 if(process.env.QA_OUTPUT){fs.mkdirSync(process.env.QA_OUTPUT,{recursive:true});await evaluate(`const card=$('#overallPlaces').closest('section');const shell=document.createElement('main');shell.className='shell';shell.append(card);document.body.replaceChildren(shell);renderAwards({overall_places:null,age_groups:[{min:20,max:29,label:'20–29',division:'Male'},{min:30,max:39,label:'30–39',division:'Female'}]});document.querySelector('#overallPlaces').scrollIntoView({block:'center'})`);for(const width of [1440,390]){await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});await pause(100);const layout=await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,scopes:[...document.querySelectorAll('[data-age-scope]')].map(x=>x.textContent)})`);if(layout.scroll>width)throw Error('Awards layout overflows: '+JSON.stringify(layout));console.log('QA '+JSON.stringify(layout));const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.QA_OUTPUT,`awards-${width}.png`),Buffer.from(shot.data,'base64'))}}
 ws.close();proc.kill();console.log(`${results.filter(r=>r.pass).length}/${results.length} passed (${ref||'working tree'}); HTTP(S) blocked.`);process.exitCode=results.some(r=>!r.pass)?1:0;
})().catch(e=>{console.error(e);proc.kill();process.exitCode=1});

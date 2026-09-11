import asyncio,json,pathlib
from playwright.async_api import async_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
HTML='''<!doctype html><html><head><style>label{display:block;margin:10px}textarea{width:350px;height:60px}.proposal{border:1px solid;padding:15px;margin:10px}</style></head><body><span class="portal-version">v3.3.0</span><button>PORTAL V3.3.0</button><div id="content"></div><div id="editModal" hidden><button id="editClose">Close</button><form id="editForm"><div id="editFields"></div><span id="editStatus"></span><button id="editCancel" type="button">Cancel</button><button type="submit">Save Changes</button></form></div><div id="aiMessages"></div><span id="aiStatus"></span><textarea id="aiInput"></textarea></body></html>'''
results=[]
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  async def setup():
   page=await browser.new_page();await page.set_content(HTML)
   await page.add_script_tag(content=(ROOT/'tests/task-workflow-browser-fixture.js').read_text());await page.evaluate('loadData()')
   await page.add_script_tag(content=(ROOT/'app-task-workflow.js').read_text());await page.evaluate('renderPage()');return page
  async def run(name,fn):
   page=await setup()
   try:await fn(page);results.append({'test':name,'passed':True})
   finally:await page.close()
  async def dropdown(page):
   await page.evaluate("openEditor('tasks','task-one')")
   opts=await page.locator('#taskOwnerMember option').all_text_contents();assert len(opts)==3 and any('setup pending' in x for x in opts)
   await page.locator('#taskOwnerMember').select_option('admin-two');await page.locator('#editForm button[type=submit]').click();await page.wait_for_function("database.tasks[0].owner_member_id==='admin-two'")
   assert await page.evaluate("database.tasks[0].owner_name")=='Sam West'
  await run('dropdown assigns a real admin ID, includes pending admins and excludes viewers/inactive',dropdown)
  async def create_typed(page):
   await page.evaluate("showProposal({entity_type:'tasks',operation:'create',fields:{title:'Prepare flyers',owner_name:'Sam West',notes:'One\\nTwo'}})")
   assert await page.locator('.task-change-card').count()==1;assert await page.evaluate('database.tasks.length')==1
   await page.locator('#aiInput').fill('confirm task');await page.evaluate('sendChatAI(false)');assert await page.evaluate('database.tasks.length')==2
   assert await page.evaluate('database.tasks[1].owner_name')=='Sam West'
  await run('typed task creation with assignment waits for typed confirmation',create_typed)
  async def create_unassigned(page):
   await page.evaluate("showProposal({entity_type:'tasks',operation:'create',fields:{title:'Order signs'}})")
   assert await page.evaluate('database.tasks.length')==1;await page.locator('.task-change-card .yes').click();await page.wait_for_function('database.tasks.length===2')
   assert await page.evaluate('database.tasks[1].status')=='Not Started'
  await run('unassigned task creation uses a confirmation card and defaults',create_unassigned)
  async def cancel(page):
   await page.evaluate("showProposal({entity_type:'tasks',operation:'create',fields:{title:'Do not save'}})")
   await page.locator('.task-change-card .no').click();assert await page.evaluate('database.tasks.length')==1
   assert await page.evaluate("calls.filter(c=>c.method==='POST'||c.method==='PATCH').length")==0
  await run('cancelled task creation makes no write request',cancel)
  async def voice_create(page):
   await page.evaluate("runRealtimeV31Tool({name:'prepare_task_change',call_id:'v1',arguments:JSON.stringify({operation:'create',record_id:null,fields_json:JSON.stringify({title:'Voice-created task'})})})")
   assert await page.locator('.task-change-card').count()==1;assert await page.evaluate('database.tasks.length')==1
   await page.evaluate("runRealtimeV31Tool({name:'confirm_task_change',call_id:'v2',arguments:'{}'})")
   assert await page.evaluate('database.tasks.length')==1
   assert await page.evaluate("JSON.parse(rtMessages[rtMessages.length-2].item.output).code")=='NEW_CONFIRMATION_REQUIRED'
   await page.evaluate("handleRealtimeEvent({data:JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:'new-human-turn',transcript:'confirm task'})})")
   await page.evaluate("runRealtimeV31Tool({name:'confirm_task_change',call_id:'v3',arguments:'{}'})")
   assert await page.evaluate('database.tasks.length')==2;assert await page.evaluate("JSON.parse(rtMessages[rtMessages.length-2].item.output).status")=='saved'
   await page.evaluate("runRealtimeV31Tool({name:'confirm_task_change',call_id:'v3',arguments:'{}'})")
   assert await page.evaluate('database.tasks.length')==2
  await run('voice creation requires a NEW human confirmation and deduplicates call IDs',voice_create)
  async def stale(page):
   await page.evaluate("showProposal({entity_type:'tasks',operation:'update',record_id:'task-one',fields:{notes:'Proposed'}})")
   await page.evaluate("database.tasks[0].updated_at='2026-09-11T20:00:00.000Z';database.tasks[0].notes='Another person changed this'")
   await page.locator('.yes').click();await page.wait_for_function("document.querySelector('#aiMessages').textContent.includes('task or your access changed')")
   assert await page.evaluate('database.tasks[0].notes')=='Another person changed this'
  await run('stale confirmation cannot overwrite a concurrent task edit',stale)
  async def invalid_member(page):
   await page.evaluate("showProposal({entity_type:'tasks',operation:'update',record_id:'task-one',fields:{owner_name:'Unknown Person'}})")
   assert await page.locator('.task-change-card').count()==0;assert await page.evaluate("calls.filter(c=>c.method==='PATCH').length")==0
  await run('unknown assignee is rejected before a confirmation card',invalid_member)
  async def member_changed(page):
   await page.evaluate("showProposal({entity_type:'tasks',operation:'update',record_id:'task-one',fields:{owner_member_id:'admin-two'}})")
   await page.evaluate("database.team_members[1].active=false")
   await page.locator('.yes').click();await page.wait_for_function("document.querySelector('#aiMessages').textContent.includes('admin details changed')")
   assert await page.evaluate("calls.filter(c=>c.method==='PATCH').length")==0
  await run('deactivated admin cannot be assigned through an old card',member_changed)
  async def reads(page):
   for i,q in enumerate([None,'volunteers','missing']):
    await page.evaluate("v=>runRealtimeV31Tool({name:'read_portal_section',call_id:'read'+v.i,arguments:JSON.stringify({section:'tasks',query:v.q,limit:50})})",{'i':i,'q':q})
    out=await page.evaluate('JSON.parse(rtMessages[rtMessages.length-2].item.output)');assert isinstance(out,list)
   ctx=await page.evaluate('JSON.parse(portalContext())');assert ctx['live_signups'][0]['name']=='Signup Person'
  await run('broad/filtered/empty task reads work with >70k of chapter data',reads)
  async def bad_read(page):
   await page.evaluate("failRead=true;runRealtimeV31Tool({name:'read_portal_section',call_id:'bad',arguments:JSON.stringify({section:'tasks',query:null,limit:50})})")
   out=await page.evaluate('JSON.parse(rtMessages[rtMessages.length-2].item.output)');assert out['code']=='INVALID_JSON' and out['saved'] is False
  await run('HTML server failure becomes valid structured JSON for voice',bad_read)
  async def readonly(page):
   await page.evaluate("me.role='viewer';showProposal({entity_type:'tasks',operation:'create',fields:{title:'Forbidden'}})")
   assert await page.locator('.task-change-card').count()==0;assert await page.evaluate('database.tasks.length')==1
  await run('read-only members cannot create tasks',readonly)
  async def preserve(page):
   await page.evaluate("showProposal({entity_type:'chapters',operation:'update',fields:{body:'x'}});executeAIAction({entity_type:'site_edits'});runRealtimeV31Tool({name:'read_google_drive_file',call_id:'other',arguments:'{}'})")
   delegates=await page.evaluate('delegated');assert 'other-proposal:chapters' in delegates and 'other-execute:site_edits' in delegates and 'tool:read_google_drive_file' in delegates
   names=await page.evaluate('realtimeV31Tools().map(t=>t.name)');assert all(n in names for n in ['inspect_public_site','read_google_drive_file','search_marketing_library','prepare_task_change'])
   assert await page.locator('#addAdminSentinel').count()==1;assert await page.locator('.portal-version').text_content()=='v3.3.1'
  await run('other project duties, Add Admin control and version display remain available',preserve)
  async def blocked(page):
   await page.evaluate("database.tasks[0].status='Blocked';openEditor('tasks','task-one')")
   assert await page.locator('[name=status]').input_value()=='Blocked'
   await page.locator('[name=notes]').fill('Updated note only');await page.locator('#editForm button[type=submit]').click();await page.wait_for_function("database.tasks[0].notes==='Updated note only'")
   assert await page.evaluate('database.tasks[0].status')=='Blocked'
  await run('opening an existing Blocked task does not reset its status',blocked)
  async def legacy_voice_assignment(page):
   await page.evaluate("runRealtimeV31Tool({name:'prepare_task_assignment',call_id:'assign1',arguments:JSON.stringify({task_id:'task-one',member_id:'admin-two'})})")
   assert await page.evaluate('database.tasks[0].owner_member_id') is None
   await page.evaluate("handleRealtimeEvent({data:JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:'confirm-assignment-turn',transcript:'confirm assignment'})})")
   await page.evaluate("runRealtimeV31Tool({name:'confirm_task_assignment',call_id:'assign2',arguments:'{}'})")
   assert await page.evaluate('database.tasks[0].owner_member_id')=='admin-two'
  await run('existing voice-assignment tools remain compatible and confirmation-gated',legacy_voice_assignment)
  await browser.close()
 print(json.dumps({'passed':len(results),'tests':results},indent=2))
 (ROOT/'tests/browser-results.json').write_text(json.dumps(results,indent=2))
asyncio.run(main())

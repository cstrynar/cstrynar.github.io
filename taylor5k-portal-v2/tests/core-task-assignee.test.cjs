// Run: node --test taylor5k-portal-v2/tests/core-task-assignee.test.cjs
// No network calls or production records are used by these regression checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = process.env.CORE_EDITOR_SOURCE || path.join(__dirname, '..', 'app-4.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const roster = [
  {id:'a',display_name:'Admin',email:'admin@example.test',role:'admin',active:true,user_id:'ua'},
  {id:'s',display_name:'Super Admin',email:'super@example.test',role:'super_admin',active:true,user_id:'us'},
  {id:'p',display_name:'Pending Admin',email:'pending@example.test',role:'admin',active:true,user_id:null},
  {id:'v',display_name:'Viewer',email:'viewer@example.test',role:'viewer',active:true},
  {id:'i',display_name:'Inactive',email:'inactive@example.test',role:'admin',active:false}
];
function setup() {
  const context = vm.createContext({
    data:{team_members:structuredClone(roster)},
    esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  });
  vm.runInContext(source, context);
  return context;
}
test('task dropdown is installed by the core script without optional extensions',()=>{
  const c=setup();
  const fields=JSON.parse(vm.runInContext('JSON.stringify(editDefs.tasks)',c));
  assert.deepEqual(fields.find(f=>f[0]==='owner_member_id'),['owner_member_id','Assigned to','admin-member']);
  assert.equal(fields.some(f=>f[0]==='owner_name'),false);
  assert.match(c.fieldHTML(['owner_member_id','Assigned to','admin-member'],{}),/<select id="taskOwnerMember" name="owner_member_id"/);
});
test('eligible roster includes admins, Super Admins and pending invitations only',()=>{
  const c=setup();
  assert.deepEqual(Array.from(c.coreTaskAdmins(),m=>m.id).sort(),['a','p','s']);
  const html=c.coreTaskOwnerOptions({});
  assert.match(html,/Unassigned/);assert.match(html,/invited \/ setup pending/);
  assert.doesNotMatch(html,/Viewer|Inactive/);
});
test('existing member IDs and legacy names are preserved',()=>{
  const c=setup();
  assert.equal(c.coreTaskSelected({owner_member_id:'i',owner_name:'Inactive'}),'i');
  assert.match(c.coreTaskOwnerOptions({owner_member_id:'i',owner_name:'Inactive'}),/value="i" selected/);
  assert.equal(c.coreTaskSelected({owner_name:'Historical volunteer'}),'__legacy__');
  assert.match(c.coreTaskOwnerOptions({owner_name:'Historical volunteer'}),/keep existing/);
});
test('unique names resolve and ambiguous names are not guessed',()=>{
  const c=setup();
  assert.equal(c.coreTaskSelected({owner_name:'  ADMIN  '}),'a');
  c.data.team_members.push({...c.data.team_members[0],id:'duplicate',email:'other@example.test'});
  assert.equal(c.coreTaskSelected({owner_name:'Admin'}),'__legacy__');
  assert.equal(c.coreTaskSelected({owner_name:'Unassigned'}),'');
});
test('dropdown safely escapes account names and emails',()=>{
  const c=setup();c.data.team_members[0].display_name='<img src=x onerror=alert(1)>';
  const html=c.coreTaskOwnerOptions({});
  assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});
test('other editors retain their owner text field and tasks use database status values',()=>{
  const c=setup();
  const value=JSON.parse(vm.runInContext('JSON.stringify({permit:editDefs.permits.find(f=>f[0]==="owner_name"),status:editDefs.tasks.find(f=>f[0]==="status")[3]})',c));
  assert.deepEqual(value.permit,['owner_name','Owner','text']);
  assert.ok(value.status.includes('Blocked'));assert.ok(!value.status.includes('Waiting'));
});

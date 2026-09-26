// Isolated tests: runs real RPC handlers against an in-memory store, never live accounts.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('../backend/node_modules/typescript');
const rows = [];
const staff = [
  { id: 'staff-a', full_name: 'Officer A', email: 'a@test.invalid', primary_role: 'REGIONAL_CJ', roles: ['REGIONAL_CJ'], is_active: true, password_hash: 'must-not-be-returned' },
  { id: 'staff-b', full_name: 'Officer B', email: 'b@test.invalid', primary_role: 'REGIONAL_CJ', roles: ['REGIONAL_CJ'], is_active: true },
  { id: 'RE', full_name: 'Central RE', email: 'central@test.invalid', primary_role: 'RE', roles: ['RE'], is_active: true, region_id: 'Kano Central', region_name: 'Kano Central' },
  { id: 'RE-EAST', full_name: 'East RE', email: 'east@test.invalid', primary_role: 'RE', roles: ['RE'], is_active: true, region_id: 'Kano East', region_name: 'Kano East' },
  { id: 'inactive', full_name: 'Inactive', email: 'inactive@test.invalid', primary_role: 'TE', roles: ['TE'], is_active: false }
];
let rpc;
const router = { get() {}, use() {}, delete() {}, patch() {}, put() {}, post(path, handler) { if (path === '/rpc/:name') rpc = handler; } };
const store = {
  tableRows: () => [],
  queryTable(table, filters = []) { return rows.filter(row => filters.every(f => f.op === 'eq' && row[f.column] === f.value)); },
  async insertTable(table, row) { const saved = { ...row, id: 'id-' + (rows.length + 1) }; rows.push(saved); return [saved]; },
  appendAudit() {}
};
const source = fs.readFileSync('backend/src/local/data-routes.ts', 'utf8');
const regions = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('backend/src/local/regions.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: regions, require: () => store });
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
vm.runInNewContext(code, { exports: {}, require(name) {
  if (name === 'express') return { Router: () => router, raw: () => () => {} };
  if (name === './store.js') return store;
  if (name === './auth-store.js') return { users: () => staff };
  if (name === './regions.js') return regions;
  if (name === './middleware.js') return { requireLocalAuth() {} };
  return require(name);
} });
const user = role => staff.find(person => person.id === role) || ({ id: role, email: role + '@test.invalid', full_name: role, roles: [role], primary_role: role });
async function call(name, body, role) {
  let response;
  let status = 200;
  const res = { locals: { kedcoUser: user(role) }, status(n) { status = n; return this; }, json(value) { response = value; return this; } };
  await rpc({ params: { name }, body }, res, error => { throw error; });
  return { status, ...response };
}
(async () => {
  const forms = ['daily', 'load33', 'load11', 'jha', 'toolbox', 'of1', 'of2', 'of3', 'of4', 'of17', 'of19'];
  const targets = [['Head PC & M', 'HEAD_PCM'], ['Head MIS', 'HEAD_MIS'], ['Head O & M', 'HEAD_OM'], ['Regional PC & M', 'REGIONAL_PCM_COORD'], ['Regional Cable Jointers', 'REGIONAL_CJ'], ['Regional Electrical Fitters', 'REGIONAL_EF'], ['Regional Engineer (RE)', 'RE'], ['Technical Engineer (TE)', 'TE'], ['Head System Operations / Dispatch', 'HEAD_SO'], ['Dispatch', 'DISPATCH'], ['Regional HSE Officer', 'REGIONAL_HSE_OFFICER'], ['Regional P & I', 'REGIONAL_PI_COORD'], ['Station Operator', 'OPERATOR']];
  for (const form of forms) {
    for (const [label, role] of targets) {
      const sent = await call('kedco_send_central_eform', { requested_form_code: form, requested_reference: form + '-' + role, requested_recipient_role: label, requested_recipient_region: role === 'RE' ? 'Kano Central' : null, requested_payload: { test: form } }, 'DISPATCH');
      assert.equal(sent.status, 200, label);
      assert.ok(sent.data.record.recipient_target_roles.includes(role));
      const inbox = await call('kedco_list_central_eforms', { requested_box: 'inbox' }, role);
      assert.ok(inbox.data.some(row => row.id === sent.data.record.id));
    }
  }
  const original = rows.find(row => row.form_code === 'of19' && row.recipient_role === 'Head PC & M');
  const directory = await call('kedco_list_eform_personnel', {}, 'DISPATCH');
  assert.equal(directory.data.length, 4);
  assert.equal((await call('kedco_list_eform_regions', {}, 'DISPATCH')).data.length, 16);
  const reArgs = { requested_form_code: 'of19', requested_recipient_role: 'Regional Engineer (RE)' };
  assert.equal((await call('kedco_send_central_eform', reArgs, 'DISPATCH')).status, 400);
  assert.equal((await call('kedco_send_central_eform', { ...reArgs, requested_recipient_region: 'Unknown' }, 'DISPATCH')).status, 400);
  assert.equal((await call('kedco_send_central_eform', { ...reArgs, requested_recipient_region: 'Kano West' }, 'DISPATCH')).status, 400);
  const regional = await call('kedco_send_central_eform', { ...reArgs, requested_recipient_region: 'Kano East' }, 'DISPATCH');
  assert.equal(regional.data.record.recipient_user_id, 'RE-EAST');
  assert.equal((await call('kedco_send_central_eform', { ...reArgs, requested_reference: regional.data.record.reference, requested_recipient_region: 'Kano Central' }, 'DISPATCH')).status, 409);
  assert.ok(!(await call('kedco_list_central_eforms', { requested_box: 'inbox' }, 'RE')).data.some(row => row.id === regional.data.record.id));
  const forwardedRE = await call('kedco_forward_central_eform', { requested_id: regional.data.record.id, requested_recipient_role: 'RE', requested_recipient_region: 'Kano Central', requested_request_id: 'regional-forward' }, 'RE-EAST');
  assert.equal(forwardedRE.data.record.recipient_user_id, 'RE');
  staff.push({ ...staff.find(person => person.id === 'RE'), id: 'second-re' });
  assert.equal((await call('kedco_send_central_eform', { ...reArgs, requested_recipient_region: 'Kano Central' }, 'DISPATCH')).status, 400);
  staff.pop();
  let savedUsers = structuredClone(staff);
  const auth = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('backend/src/local/auth-store.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, {
    exports: auth, Buffer, require(name) {
      if (name === './regions.js') return regions;
      if (name === './store.js') return { readJson: () => savedUsers, writeJson: async (file, data) => { savedUsers = data; }, appendAudit() {} };
      return require(name);
    }
  });
  const assigned = await auth.setUserRoles('RE', ['RE'], 'RE', 'Katsina North');
  assert.equal(assigned.region_name, 'Katsina North');
  assert.equal(auth.users().find(person => person.id === 'RE').region_id, 'Katsina North');
  await assert.rejects(auth.setUserRoles('RE', ['RE'], 'RE', 'Invalid region'));
  assert.ok(!JSON.stringify(directory).includes('password'));
  const document = '<form><h2>Trouble Report</h2><input value="Cable fault"></form>';
  const direct = await call('kedco_send_central_eform', { requested_form_code: 'of19', requested_reference: 'direct-person', requested_recipient_role: 'person:staff-a', requested_form_document: document }, 'DISPATCH');
  assert.equal(direct.data.record.recipient, 'Officer A');
  assert.equal(direct.data.record.form_document, document);
  assert.ok((await call('kedco_list_central_eforms', { requested_box: 'inbox' }, 'staff-a')).data.some(row => row.id === direct.data.record.id));
  assert.ok(!(await call('kedco_list_central_eforms', { requested_box: 'inbox' }, 'staff-b')).data.some(row => row.id === direct.data.record.id));
  const directArgs = { requested_id: direct.data.record.id, requested_recipient_role: 'person:staff-b', requested_request_id: 'direct-forward' };
  assert.equal((await call('kedco_forward_central_eform', directArgs, 'staff-b')).status, 403);
  const directForward = await call('kedco_forward_central_eform', directArgs, 'staff-a');
  assert.equal(directForward.data.record.recipient_user_id, 'staff-b');
  assert.equal(directForward.data.record.form_document, document);
  for (const id of ['inactive', 'missing']) assert.equal((await call('kedco_send_central_eform', { requested_form_code: 'of19', requested_recipient_role: 'person:' + id }, 'DISPATCH')).status, 400);
  const args = { requested_id: original.id, requested_recipient_role: 'Regional Cable Jointers', requested_request_id: 'forward-1' };
  assert.equal((await call('kedco_forward_central_eform', args, 'TE')).status, 403);
  const forwarded = await call('kedco_forward_central_eform', args, 'HEAD_PCM');
  assert.equal(forwarded.status, 200);
  assert.deepEqual(forwarded.data.record.payload, original.payload);
  assert.equal(forwarded.data.record.parent_record_id, original.id);
  const retry = await call('kedco_forward_central_eform', args, 'HEAD_PCM');
  assert.equal(retry.data.record.id, forwarded.data.record.id);
  const next = await call('kedco_forward_central_eform', { requested_id: forwarded.data.record.id, requested_recipient_role: 'Technical Engineer (TE)', requested_request_id: 'forward-2' }, 'REGIONAL_CJ');
  assert.equal(next.data.record.root_record_id, original.id);
  assert.equal(next.data.record.route_history.length, 2);
  assert.equal((await call('kedco_send_central_eform', { requested_form_code: 'of19', requested_recipient_role: 'Unknown office' }, 'DISPATCH')).status, 400);
  assert.equal((await call('kedco_forward_central_eform', { ...args, requested_recipient_role: 'Unknown office' }, 'HEAD_PCM')).status, 400);
  original.source_type = 'OPERATOR_WORKFLOW';
  assert.equal((await call('kedco_forward_central_eform', args, 'HEAD_PCM')).status, 400);
  const dispatch = fs.readFileSync('frontend/pages/system-operations/dispatch.html', 'utf8');
  const renderers = dispatch.match(/const FORM_RENDERERS=\{([^}]+)\}/)[1].split(',').map(entry => entry.split(':')[0]);
  assert.deepEqual(renderers.sort(), forms.sort(), 'Every dispatch form must be covered');
  for (const page of ['pcm/regionalpcm', 'pcm/headpcm', 'operations-maintenance/headom', 'operations-maintenance/regionalcj', 'operations-maintenance/regionalef', 'operations-maintenance/re_te', 'operations-maintenance/super_re_te', 'system-operations/dispatch', 'system-operations/headso']) {
    assert.match(fs.readFileSync('frontend/pages/' + page + '.html', 'utf8'), /kedco-central-eform-workflow\.js/);
  }
  console.log('PASS: all 11 dispatch forms across 13 recipient routes; authenticated inboxes; forwarding across two offices; payload/history preservation; retry deduplication; unsupported/unauthorised routes rejected; workflow guard; recipient page coverage.');
})().catch(error => { console.error(error); process.exitCode = 1; });

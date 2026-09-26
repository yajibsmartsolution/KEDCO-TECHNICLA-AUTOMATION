// Run: Get-Content frontend/kedco-central-eform-workflow.js -Raw | node -e "eval(require('fs').readFileSync('tools/eform-announcement-test.cjs','utf8'))"
const assert = require('node:assert/strict');
const vm = require('node:vm');
let source = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => source += chunk);
process.stdin.on('end', async () => {
  try {
    let user = 'recipient';
    let records = [];
    let fail = false;
    const spoken = [];
    const storage = new Map();
    let panel;
    const document = {
      readyState: 'loading', visibilityState: 'visible', addEventListener() {},
      body: { appendChild(element) { panel = element; } },
      createElement() { return { style: {}, setAttribute() {}, appendChild() {}, addEventListener(type, fn) { this[type] = fn; } }; }
    };
    const client = {
      auth: { getSession: async () => ({ data: { session: user ? { user: { id: user } } : null } }) },
      rpc: async (name, args) => {
        assert.equal(name, 'kedco_list_central_eforms');
        assert.equal(args.requested_box, 'inbox');
        return fail ? { error: { message: 'offline' } } : { data: records };
      }
    };
    const window = {
      supabase: { createClient: () => client },
      localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
      speechSynthesis: { speak: speech => spoken.push(speech.text) },
      SpeechSynthesisUtterance: function(text) { this.text = text; }
    };
    vm.runInNewContext(source.replace('global.KEDCO_CENTRAL_EFORM_WORKFLOW =', 'global.checkIncomingTest = checkIncoming; global.routingTest = { ensureFormSendButton, formTitle, compactValue }; global.KEDCO_CENTRAL_EFORM_WORKFLOW ='), { window, document });
    window.location = { pathname: '/pages/system-operations/dispatch.html' };
    for (const code of ['daily', 'load33', 'load11', 'jha', 'toolbox', 'of1', 'of2', 'of3', 'of4', 'of17', 'of19']) {
      const added = [];
      const form = { querySelector: () => null, appendChild: element => added.push(element), getAttribute: () => code };
      const toolbar = { querySelector: () => null, appendChild: element => added.push(element) };
      document.getElementById = () => ({ closest: () => toolbar });
      document.querySelector = () => form;
      const originalCreate = document.createElement;
      document.createElement = () => ({ dataset: {}, setAttribute() {} });
      window.routingTest.ensureFormSendButton();
      document.createElement = originalCreate;
      assert.equal(added.length, 2, code + ' gets routing controls and send button');
      assert.match(added[0].innerHTML, /Regional Cable Jointers/);
      assert.match(added[0].innerHTML, /Regional Electrical Fitters/);
      assert.equal(added[1].dataset.centralFormSend, '1');
      assert.notEqual(window.routingTest.formTitle(form), 'KEDCO e-form');
    }
    const loadFlow = Object.fromEntries(Array.from({ length: 5000 }, (_, index) => ['field' + index, index]));
    assert.equal(Object.keys(window.routingTest.compactValue(loadFlow, 0)).length, 5000, 'large load-flow forms retain all fields');
    const check = window.checkIncomingTest;
    const report = { id: 'report1', sender_id: 'sender', status: 'SENT', form_title: 'Trouble Report', sender_name: '<Alice>', reference: 'TR-1' };
    records = [report, { ...report, id: 'own', sender_id: user }, { ...report, id: 'done', status: 'RECEIVED' }];
    await check();
    assert.equal(spoken.length, 1);
    assert.match(panel.innerHTML, /Trouble Report/);
    assert.match(panel.innerHTML, /&lt;Alice&gt;/);
    assert.doesNotMatch(panel.innerHTML, /data-incoming-dismiss="(?:own|done)"/);
    await check();
    assert.equal(spoken.length, 1, 'polls must not repeat speech');
    panel.click({ target: { closest: selector => selector === '[data-incoming-dismiss]' ? { getAttribute: () => 'report1' } : null } });
    await check();
    assert.equal(panel.hidden, true);
    assert.equal(spoken.length, 1, 'dismissed reports stay quiet');
    records.push({ ...report, id: 'report2' });
    fail = true;
    await check();
    fail = false;
    await check();
    assert.equal(spoken.length, 2, 'recover after a failed request');
    user = 'another-recipient';
    await check();
    assert.match(panel.innerHTML, /data-incoming-dismiss="report1"/, 'dismissals belong to each user');
    user = null;
    await check();
    assert.equal(panel.hidden, true, 'clear alerts on logout');
    user = 'recipient';
    records = [{ ...report, id: 'workflow', sender_id: user, source_type: 'OPERATOR_WORKFLOW', status: 'IN_REVIEW', notification_stage: 'REPAIR' }];
    await check();
    const beforeStageChange = spoken.length;
    assert.equal(panel.hidden, false, 'workflow returning to its sender still announces');
    panel.click({ target: { closest: selector => selector === '[data-incoming-dismiss]' ? { getAttribute: () => 'workflow:REPAIR' } : null } });
    await check();
    assert.equal(spoken.length, beforeStageChange);
    records[0].notification_stage = 'RESTORATION';
    await check();
    assert.equal(spoken.length, beforeStageChange + 1, 'new routing stage must announce again');
    console.log('PASS: recipient inbox, pop-up, speech, escaping, deduplication, dismissal, retry, user isolation and logout.');
  } catch (error) { console.error(error); process.exitCode = 1; }
});

// Uses a temporary Edge profile and synthetic form/staff data; no live backend.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kedco-form-preview-'));
const dispatchPage = fs.readFileSync('frontend/pages/system-operations/dispatch.html', 'utf8');
const faultFunctions = dispatchPage.slice(dispatchPage.indexOf('function populateTroubleReasons(form)'), dispatchPage.indexOf('function bindFormDynamics(id)'));
for (const page of ['dispatch', 'operator', 'super_operator']) {
  const content = fs.readFileSync('frontend/pages/system-operations/' + page + '.html', 'utf8');
  for (const match of content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc=|application\/json/i.test(match[1])) new Function(match[2]);
  }
}
const source = fs.readFileSync('frontend/kedco-central-eform-workflow.js', 'utf8')
  .replace('function mount() {', 'function mount() { return;')
  .replace('global.KEDCO_CENTRAL_EFORM_WORKFLOW =', 'global.previewTest = { captureFormDocument, attachPreview, loadPersonnel, openRecord, recipientFor, syncTroubleRecipient, ensureRegionalSelectors, previewSettled, regionalReBlock, seed: value => { rows = [value]; pendingAlerts = [value]; }, renderIncoming }; global.KEDCO_CENTRAL_EFORM_WORKFLOW =');
const html = `<!doctype html><meta charset="utf-8"><style>.paper { border:2px solid blue } textarea { width:90% }</style>
<form class="paper" id="original" data-form="of19" style="width:1123px;box-sizing:border-box"><h2>Trouble and Repair Report</h2><input name="location" value="old"><textarea name="trouble">old</textarea><input name="safe" type="checkbox"><select name="priority"><option>Normal</option><option>Urgent</option></select><canvas width="30" height="30"></canvas><select name="department" data-trouble-dept><option>PC&M</option><option>O&M</option></select><button>Send</button><fieldset data-central-routing><select name="dispatchTo"></select></fieldset></form>
<select name="sendRecipientRole"></select><pre id="result">RUNNING</pre>
<script>window.supabase = {createClient:()=>({rpc:async(name)=>({data:name==='kedco_list_eform_regions'?[{id:'Kano Central',name:'Kano Central'},{id:'Kano East',name:'Kano East'}]:[{id:'person-a',full_name:'Test Officer',primary_role:'REGIONAL_CJ',email:'test@example.invalid'},{id:'re-central',full_name:'Central RE',primary_role:'RE',email:'re@example.invalid',region_id:'Kano Central'}]})})};const TROUBLE_REASONS={'PC&M':[['Protection fault','Protection description']],'O&M':[['Cable fault','Cable description']]};const $=(selector,root=document)=>root.querySelector(selector);const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;');${faultFunctions}</script>
<script>${source.replace(/<\/script/gi, '<\\/script')}</script>
<script>(async()=>{try {
const assert=(value,message)=>{if(!value)throw Error(message)};
const form=document.getElementById('original');
form.elements.location.value='Kano Station'; form.elements.trouble.value='Cable fault'; form.elements.safe.checked=true; form.elements.priority.value='Urgent';
form.querySelector('canvas').getContext('2d').fillRect(1,1,10,10);
const saved=previewTest.captureFormDocument(form);
const parsed=new DOMParser().parseFromString(saved,'text/html');
assert(parsed.querySelector('h2').textContent==='Trouble and Repair Report','original heading');
assert(parsed.querySelector('[name=location]').value==='Kano Station','input value');
assert(parsed.querySelector('textarea').value==='Cable fault','textarea value');
assert(parsed.querySelector('[name=safe]').checked,'checkbox state');
assert(parsed.querySelector('select').value==='Urgent','selected option');
assert(parsed.querySelector('img').src.startsWith('data:image/png'),'signature image');
assert(!parsed.querySelector('button,[data-central-routing]'),'send controls omitted');
assert(saved.includes('border: 2px solid blue'),'original form styles');
await previewTest.loadPersonnel();
assert(document.querySelector('select[name=dispatchTo] option[value="person:person-a"]'),'send personnel');
assert(document.querySelector('select[name=sendRecipientRole] option[value="person:person-a"]'),'RE/TE personnel');
const department=form.elements.department;
assert(department.querySelector('option[value="person:person-a"]'),'receiving department includes staff');
for(const label of ['Head O & M','Head PC & M','Head HSE','Head MIS','Regional Engineer (RE)','Technical Engineer (TE)','Regional Cable Jointers','Regional Electrical Fitters']) assert(Array.from(department.options).some(option=>option.value===label),'receiving department: '+label);
document.addEventListener('change',previewTest.syncTroubleRecipient);
document.addEventListener('change',previewTest.ensureRegionalSelectors);
department.value='person:person-a'; department.dispatchEvent(new Event('change',{bubbles:true}));
assert(previewTest.recipientFor(form).role==='person:person-a','department routes to selected individual');
assert(form.elements.dispatchTo.value==='person:person-a','send selector follows department');
const faults=document.createElement('select');faults.setAttribute('data-trouble-reason','');form.appendChild(faults);
const faultPreview=document.createElement('div');faultPreview.setAttribute('data-fault-preview','');form.appendChild(faultPreview);
populateTroubleReasons(form);
assert(faults.options.length===3,'individual personnel selection retains both fault categories');
faults.value='Cable fault';updateFaultPreview(form);
assert(faultPreview.textContent.includes('Cable description'),'individual fault preview remains available');
form.elements.dispatchTo.value='Technical Engineer (TE)'; form.elements.dispatchTo.dispatchEvent(new Event('change',{bubbles:true}));
assert(department.value==='Technical Engineer (TE)','department follows changed send recipient');
form.elements.dispatchTo.value='Regional Engineer (RE)';form.elements.dispatchTo.dispatchEvent(new Event('change',{bubbles:true}));
const regionGroup=form.querySelector('[data-re-region-group]');
assert(!regionGroup.hidden,'RE selection reveals regions');
const region=regionGroup.querySelector('select');
assert(region.required&&region.options.length===3,'region selection required with correct choices');
region.value='Kano Central';region.dispatchEvent(new Event('change',{bubbles:true}));
assert(regionGroup.textContent.includes('Central RE'),'region resolves to the assigned RE');
assert(previewTest.recipientFor(form).region==='Kano Central','selected RE region included in send');
region.value='Kano East';region.dispatchEvent(new Event('change',{bubbles:true}));
assert(regionGroup.textContent.includes('No active RE'),'unassigned region is clearly identified');
const centralRegion={id:'Kano Central',name:'Kano Central'};
const eastRegion={id:'Kano East',name:'Kano East'};
assert(/No active RE is assigned to Kano East/.test(previewTest.regionalReBlock('Regional Engineer (RE)',eastRegion,'')),'guard blocks a region with no assigned RE');
assert(previewTest.regionalReBlock('Regional Engineer (RE)',eastRegion,'re-central')==='','guard allows an explicitly selected officer');
assert(previewTest.regionalReBlock('Regional Engineer (RE)',centralRegion,'')==='','guard allows a region with exactly one RE');
assert(/Select the receiving RE's region/.test(previewTest.regionalReBlock('Regional Engineer (RE)',null,'')),'guard requires a region for a regional RE');
assert(previewTest.regionalReBlock('Head O & M',null,'')==='','guard does not apply to non-RE offices');
const row={id:'form-1',form_title:'Trouble and Repair Report',reference:'TR-1',form_document:saved,payload:{},can_update:true};
previewTest.seed(row); previewTest.openRecord(row.id);
await previewTest.previewSettled();
const dialog=document.getElementById('kedcoEformDetails');
assert(dialog.open,'received form dialog opened');
assert(dialog.getBoundingClientRect().width>=window.innerWidth-30,'large form dialog fills screen');
assert(dialog.querySelector('select[data-forward-role] option[value="person:person-a"]'),'forward personnel');
const forwardRole=dialog.querySelector('[data-forward-role]');
forwardRole.value='Regional Engineer (RE)';forwardRole.dispatchEvent(new Event('change',{bubbles:true}));
assert(!dialog.querySelector('[data-re-region-group]').hidden,'forwarding to RE reveals region choices');
assert(dialog.querySelector('[data-forward-office]').disabled,'free text office replaced for regional RE delivery');
const frame=dialog.querySelector('iframe');
assert(frame.getAttribute('sandbox')==='','preview is sandboxed');
assert(frame.srcdoc.includes('Kano Station')&&frame.srcdoc.includes('Cable fault'),'received form content');
assert(frame.srcdoc.includes('min-width:1123px!important'),'original form width is retained');
previewTest.renderIncoming();
await previewTest.previewSettled();
assert(document.querySelector('#kedcoIncomingEformAlert iframe').srcdoc.includes('Cable fault'),'arrival popup shows same form');
assert(document.querySelector('#kedcoIncomingEformAlert').getBoundingClientRect().width>=window.innerWidth-30,'arrival popup fills screen');
document.getElementById('result').textContent='PASS: original layout, field values, signatures, send/forward personnel, popup form and isolated preview.';
}catch(error){document.getElementById('result').textContent='FAIL: '+error.stack}})();</script>`;
const file = path.join(folder, 'test.html');
fs.writeFileSync(file, html);
let output;
try {
  output = execFileSync('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--user-data-dir=' + path.join(folder, 'profile'), '--dump-dom', '--virtual-time-budget=2000', pathToFileURL(file).href], { encoding: 'utf8', timeout: 30000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 10000000 });
} catch (error) {
  // Edge can finish the DOM dump while a background process delays shutdown.
  if (error.code !== 'ETIMEDOUT' || !/<pre id="result">(?:PASS|FAIL):/.test(error.stdout || '')) throw error;
  output = error.stdout;
}
const result = output.match(/<pre id="result">([\s\S]*?)<\/pre>/)?.[1];
console.log(result || 'FAIL: browser did not return a test result');
if (!result?.startsWith('PASS:')) process.exitCode = 1;

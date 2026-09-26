import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.env.KEDCO_TEST_ROOT || path.join(path.dirname(new URL(import.meta.url).pathname), '..'));
const BASE = String(process.env.KEDCO_TEST_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const EMAIL = String(process.env.KEDCO_TEST_EMAIL || '').trim().toLowerCase();
const PASSWORD = String(process.env.KEDCO_TEST_PASSWORD || '');
const stamp = Date.now();
const marker = `KEDCO_SELFTEST_${stamp}`;
const results = [];
let token = '';
const cleanup = { tables: [], files: [], mirrorFiles: new Set() };

function pass(name, detail='') { results.push({ name, ok:true, detail }); console.log(`PASS  ${name}${detail ? ' — '+detail : ''}`); }
function fail(name, detail='') { results.push({ name, ok:false, detail }); console.error(`FAIL  ${name}${detail ? ' — '+detail : ''}`); }
async function request(url, options={}) {
  const response = await fetch(BASE + url, options);
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok) throw new Error(`${response.status} ${url}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  return body;
}
function authJson(body) { return { method:'POST', headers:{authorization:`Bearer ${token}`,'content-type':'application/json'}, body:JSON.stringify(body) }; }
function filters(value) { return encodeURIComponent(JSON.stringify(value)); }
async function deleteRows(table, fspec) {
  try { await request(`/api/local/tables/${encodeURIComponent(table)}?filters=${filters(fspec)}`, { method:'DELETE', headers:{authorization:`Bearer ${token}`} }); } catch {}
}

async function cleanUp() {
  if (!token) return;
  for (const item of cleanup.tables.reverse()) await deleteRows(item.table, item.filters);
  const byBucket = new Map();
  for (const item of cleanup.files) {
    if (!byBucket.has(item.bucket)) byBucket.set(item.bucket, []);
    byBucket.get(item.bucket).push(item.path);
  }
  for (const [bucket, paths] of byBucket) {
    try { await request('/api/local/files', { method:'DELETE', headers:{authorization:`Bearer ${token}`,'content-type':'application/json'}, body:JSON.stringify({bucket,paths}) }); } catch {}
  }
  for (const file of cleanup.mirrorFiles) {
    try {
      if (!fs.existsSync(file)) continue;
      const rows = JSON.parse(fs.readFileSync(file,'utf8'));
      const kept = Array.isArray(rows) ? rows.filter(row => String(row?.station_name || '') !== marker) : [];
      if (kept.length) fs.writeFileSync(file, JSON.stringify(kept,null,2), 'utf8'); else fs.rmSync(file, {force:true});
    } catch {}
  }
}

try {
  if (!EMAIL || !PASSWORD) throw new Error('Test credentials were not supplied.');
  const health = await request('/health');
  if (health.storage_mode === 'local') pass('Local Cloud backend', health.local?.root || 'local'); else throw new Error('Backend is not in local mode.');
  const login = await request('/api/auth/login', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:EMAIL,password:PASSWORD})});
  token = login?.session?.access_token || '';
  if (!token) throw new Error('Login succeeded without a session token.');
  pass('Authentication', login.user?.email || EMAIL);

  // Static page routing.
  const pages=[];
  const pagesDir=path.join(ROOT,'frontend','pages');
  const walk=dir=>{ for(const ent of fs.readdirSync(dir,{withFileTypes:true})) { const f=path.join(dir,ent.name); if(ent.isDirectory()) walk(f); else if(ent.name.endsWith('.html')) pages.push('/'+path.relative(path.join(ROOT,'frontend'),f).replaceAll(path.sep,'/')); } };
  walk(pagesDir);
  const routeErrors=[];
  for (const page of pages) { const r=await fetch(BASE+page); if(!r.ok) routeErrors.push(`${page}:${r.status}`); }
  if (routeErrors.length) throw new Error(`Page route failures: ${routeErrors.join(', ')}`);
  pass('Frontend routes', `${pages.length} pages`);

  // Daily Log.
  const daily = await request('/api/local/tables/daily_log_events', authJson({station:marker,feeder:'SELFTEST FEEDER',category:'fault',reason:marker,opened_at:new Date().toISOString(),status:'open',operator:'Self Test',audit_marker:marker}));
  const dailyId=daily.data?.[0]?.id; if(!dailyId) throw new Error('Daily Log insert failed.');
  cleanup.tables.push({table:'daily_log_events',filters:[{op:'eq',column:'audit_marker',value:marker}]});
  const dailyRead=await request(`/api/local/tables/daily_log_events?filters=${filters([{op:'eq',column:'id',value:dailyId}])}`,{headers:{authorization:`Bearer ${token}`}});
  if(dailyRead.data?.length!==1) throw new Error('Daily Log read failed.');
  await request('/api/local/tables/daily_log_events',{method:'PATCH',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({patch:{status:'closed',closed_at:new Date().toISOString()},filters:[{op:'eq',column:'id',value:dailyId}]})});
  pass('Daily Log create/read/update');

  // File upload.
  const evidencePath=`selftest/${marker}.txt`;
  await request(`/api/local/files/upload?bucket=kedco-evidence&path=${encodeURIComponent(evidencePath)}&upsert=true`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/octet-stream'},body:Buffer.from(marker)});
  cleanup.files.push({bucket:'kedco-evidence',path:evidencePath});
  pass('Evidence upload');

  // Analyzer archive.
  await request('/api/local/tables/yajib_analyzer_uploads',authJson({upload_id:marker,data_type:'selftest',payload:{marker},audit_marker:marker}));
  cleanup.tables.push({table:'yajib_analyzer_uploads',filters:[{op:'eq',column:'audit_marker',value:marker}]});
  const analyzer=await request(`/api/local/tables/yajib_analyzer_uploads?filters=${filters([{op:'eq',column:'upload_id',value:marker}])}`,{headers:{authorization:`Bearer ${token}`}});
  if(analyzer.data?.length!==1) throw new Error('Analyzer archive read failed.');
  pass('Analyzer archive');

  // 33/11 kV Load Flow and mirror files.
  const today=new Date().toISOString().slice(0,10); const [yy,mm,dd]=today.split('-');
  const load=await request('/api/operations/load-flow/batch',authJson({operations:[
    {requested_operation_type:'LOAD_FLOW_33KV',requested_station_name:marker,requested_feeder_name:'SELFTEST 33KV',requested_reading_date:today,requested_reading_hour:1,requested_status:'LIVE',requested_payload:{field_name:`${marker}_33`,value:123.4,audit_marker:marker}},
    {requested_operation_type:'LOAD_FLOW_11KV',requested_station_name:marker,requested_feeder_name:'SELFTEST 11KV',requested_reading_date:today,requested_reading_hour:1,requested_status:'LIVE',requested_payload:{field_name:`${marker}_11`,value:45.6,audit_marker:marker}}
  ]}));
  if(load.saved!==2) throw new Error('Load Flow batch did not save both readings.');
  cleanup.tables.push({table:'kedco_station_live_operations',filters:[{op:'eq',column:'station_name',value:marker}]});
  cleanup.mirrorFiles.add(path.join(ROOT,'cloud data','load-flow','33kv',yy,mm,`${dd}.json`));
  cleanup.mirrorFiles.add(path.join(ROOT,'cloud data','load-flow','11kv',yy,mm,`${dd}.json`));
  const l33=await request(`/api/operations/load-flow/day?form=load33&date=${today}`,{headers:{authorization:`Bearer ${token}`}});
  const l11=await request(`/api/operations/load-flow/day?form=load11&date=${today}`,{headers:{authorization:`Bearer ${token}`}});
  if(!l33.rows?.some(r=>r.station_name===marker)||!l11.rows?.some(r=>r.station_name===marker)) throw new Error('Load Flow day read did not return both voltage levels.');
  pass('33/11 kV hourly save/read');

  const dispatch=fs.readFileSync(path.join(ROOT,'frontend','pages','system-operations','dispatch.html'),'utf8');
  if(!dispatch.includes('const availableDemand = load33AtHour !== null ? load33AtHour : summary.totalLoad;') || dispatch.includes('(load33AtHour || 0) + (load11AtHour || 0)')) throw new Error('Overview still double-counts 11 kV downstream load.');
  pass('Dispatch Overview authority', '33 kV primary / 11 kV downstream');

  // O.F. workflows.
  const required={of1:['JHA_RISK_ASSESSMENT','SINGLE_LINE_DIAGRAM'],of2:['JHA_RISK_ASSESSMENT','TOOLBOX_TALK'],of3:['JHA_RISK_ASSESSMENT','TOOLBOX_TALK'],of4:['JHA_RISK_ASSESSMENT'],of17:['SWITCHING_SCHEDULE'],of19:[]};
  const steps={of1:5,of2:5,of3:5,of4:6,of17:4,of19:4};
  for(const code of Object.keys(required)) {
    const sid=`${marker}_${code}`;
    await request('/api/local/rpc/kedco_save_operator_workflow_draft',authJson({requested_submission_id:sid,requested_form_code:code,requested_form_data:{audit_marker:marker},requested_workflow_context:{source:'selftest'}}));
    cleanup.tables.push({table:'kedco_workflow_submissions',filters:[{op:'eq',column:'id',value:sid}]});
    cleanup.tables.push({table:'kedco_workflow_files',filters:[{op:'eq',column:'submission_id',value:sid}]});
    cleanup.tables.push({table:'kedco_workflow_tasks',filters:[{op:'eq',column:'submission_id',value:sid}]});
    for(const doc of required[code]) {
      const objectPath=`${sid}/${doc}.txt`;
      await request(`/api/local/files/upload?bucket=kedco-workflow-files&path=${encodeURIComponent(objectPath)}&upsert=true`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/octet-stream'},body:Buffer.from(`${marker} ${doc}`)});
      cleanup.files.push({bucket:'kedco-workflow-files',path:objectPath});
      await request('/api/local/rpc/kedco_register_workflow_file',authJson({requested_submission_id:sid,requested_document_type_code:doc,requested_object_path:objectPath,requested_original_file_name:`${doc}.txt`,requested_mime_type:'text/plain',requested_file_size_bytes:10,requested_metadata:{audit_marker:marker}}));
    }
    const validation=await request('/api/local/rpc/kedco_validate_submission_documents',authJson({requested_submission_id:sid}));
    if(validation.data?.valid!==true) throw new Error(`${code} document validation failed.`);
    const submit=await request('/api/local/rpc/kedco_submit_operator_workflow',authJson({requested_submission_id:sid}));
    if(submit.data?.submitted!==true || submit.data?.route_steps?.length!==steps[code]) throw new Error(`${code} routing failed.`);
    const taskRows=await request(`/api/local/tables/kedco_workflow_tasks?filters=${filters([{op:'eq',column:'submission_id',value:sid}])}&limit=100`,{headers:{authorization:`Bearer ${token}`}});
    if(taskRows.data?.length!==steps[code]) throw new Error(`${code} task trail expected ${steps[code]}, got ${taskRows.data?.length||0}.`);
    pass(`eForm ${code} docs + routing`, `${steps[code]} route steps`);
  }

} catch (error) {
  fail('Self-test', error?.stack || String(error));
} finally {
  await cleanUp();
}

const passed=results.filter(x=>x.ok).length, failed=results.length-passed;
console.log(`\nKEDCO LOCAL CLOUD SELF-TEST: ${passed} passed, ${failed} failed.`);
process.exit(failed?1:0);

(function () {
  'use strict';

  const RECORDS_KEY = 'KEDCO_PCM_PRO_EFORMS_RECORDS_V2';
  const SENT_KEY = 'KEDCO_PCM_PRO_EFORMS_SENT_V2';
  const ROUTE_KEY = 'KEDCO_CENTRAL_EFORM_ROUTING_V3';
  const RECEIVED_KEY = 'KEDCO_PCM_PRO_EFORMS_RECEIVED_V3';
  const ENHANCER_VERSION = '2026-09-20-v4';

  const EXTRA_RECIPIENTS = [
    'Headquarters PC & M / Head PC & M',
    'Deputy / Assistant Head PC & M',
    'Corporate Protection Unit',
    'Corporate Control / SCADA Unit',
    'Corporate Metering Unit',
    'Corporate Testing & Commissioning Unit',
    'Regional PC & M Coordinator',
    'Regional Engineer (RE)',
    'Technical Engineer (TE)',
    'Head Technical',
    'Head O & M',
    'Head P & I',
    'Head System Operations / Dispatch',
    'Head HSE',
    'TSP / Technical Services',
    'Stores / Inventory',
    'Procurement / Contracts',
    'Finance / Accounts',
    'MD/CEO / Executive Management',
    'Other'
  ];

  const REGION_OPTIONS = [
    'Kano Central', 'Kano City', 'Kano East', 'Kano Industrial', 'Kano North',
    'Kano Northwest', 'Kano South', 'Kano Southwest', 'Kano West',
    'Katsina Central', 'Katsina North', 'Katsina South', 'Katsina West',
    'Jigawa North', 'Jigawa South', 'Jigawa West'
  ];

  let currentModalRecordId = null;
  let augmentBusy = false;
  let previousBodyOverflow = '';

  function loadArray(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (error) {
      console.warn('[PC&M eForm Enhancer] Could not parse', key, error);
      return [];
    }
  }

  function writeArray(key, value, max = 180) {
    const safe = Array.isArray(value) ? value.slice(0, max) : [];
    try {
      if (typeof window.KEDCO_PCM_SAFE_SET === 'function') return window.KEDCO_PCM_SAFE_SET(key, safe);
      localStorage.setItem(key, JSON.stringify(safe));
      return true;
    } catch (error) {
      console.error('[PC&M eForm Enhancer] Local storage write failed:', key, error);
      return false;
    }
  }

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleString();
  }

  function normalizeRole(value) {
    return String(value || '')
      .toLowerCase().replace(/&/g, ' and ')
      .replace(/\bpc\s*(?:and\s*)?m\b/g, 'pcm')
      .replace(/\bprotection\s+control\s+and\s+metering\b/g, 'pcm')
      .replace(/\bheadquarters\b/g, 'hq')
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function roleValueFromStorage(key) {
    const raw = localStorage.getItem(key); if (!raw) return '';
    try { const parsed = JSON.parse(raw); if (parsed && typeof parsed === 'object') return parsed.roleName || parsed.role || parsed.roleKey || parsed.name || parsed.title || parsed.value || ''; } catch {}
    return raw;
  }
  function currentOffice() {
    for (const key of ['KEDCO_PCM_EFORM_OPERATOR','KEDCO_CURRENT_ROLE','KEDCO_USER_ROLE','KEDCO_AUTH_ROLE']) {
      const value = roleValueFromStorage(key); if (String(value || '').trim()) return String(value).trim();
    }
    return 'Head PC&M';
  }
  function isForCurrentOffice(recipient) {
    const target = normalizeRole(recipient), self = normalizeRole(currentOffice());
    if (!target || !self) return false;
    if (target === self) return true;
    const targetIsHeadPCM = target.includes('head pcm') || (target.includes('hq') && target.includes('pcm'));
    const selfIsHeadPCM = self.includes('head pcm') || (self.includes('hq') && self.includes('pcm'));
    return targetIsHeadPCM && selfIsHeadPCM;
  }

  function records() {
    return loadArray(RECORDS_KEY);
  }

  function sentRecords() {
    return loadArray(SENT_KEY);
  }

  function findRecord(id) {
    return records().find((r) => String(r.id) === String(id));
  }

  function saveRecord(record) {
    const rows = records().filter((r) => String(r.id) !== String(record.id));
    rows.unshift(record); writeArray(RECORDS_KEY, rows, 140); refreshNativeRegister(); syncCounters(); return record;
  }
  function compactSentRecord(record) {
    const data = record?.data || {};
    return {id:record?.id||'',type:record?.type||'',name:record?.name||'',category:record?.category||'',state:record?.state||'',region:record?.region||'',station:record?.station||'',feeder:record?.feeder||'',officer:record?.officer||'',status:record?.status||'SENT',savedAt:record?.savedAt||'',sentAt:record?.sentAt||nowISO(),lastRecipient:record?.lastRecipient||data.dispatchTo||'',lastRecipientRegion:record?.lastRecipientRegion||data.dispatchRegion||'',data:{reference:data.reference||record?.id||'',date:data.date||'',dispatchTo:data.dispatchTo||record?.lastRecipient||'',dispatchRegion:data.dispatchRegion||record?.lastRecipientRegion||'',dispatchNote:data.dispatchNote||''}};
  }
  function upsertSent(record) {
    const rows = sentRecords().filter((r) => String(r.id) !== String(record.id));
    rows.unshift(compactSentRecord({ ...record, sentAt: nowISO() })); writeArray(SENT_KEY, rows, 140); syncCounters();
  }

  function historyEntry(action, from, to, region, note) {
    return {
      action,
      at: nowISO(),
      from: from || currentOffice(),
      to: to || '',
      region: region || '',
      note: note || ''
    };
  }

  function enrichRecord(record, action, to, region, note) {
    const next = { ...record };
    next.workflowHistory = Array.isArray(record.workflowHistory) ? [...record.workflowHistory] : [];
    const from = next.currentHolder || next.lastRecipient || next.officer || currentOffice();
    next.workflowHistory.push(historyEntry(action, from, to, region, note));
    next.lastAction = action;
    next.lastActionAt = nowISO();
    if (to) next.lastRecipient = to;
    if (region) next.lastRecipientRegion = region;
    if (action === 'RECEIVED') next.receivedAt = nowISO();
    if (action === 'FORWARDED') next.forwardedAt = nowISO();
    if (action === 'SENT') next.sentAt = nowISO();
    if (action === 'RECEIVED') next.currentHolder = currentOffice();
    else if (to) next.currentHolder = to;
    next.status = action;
    return next;
  }

  function routeRecordSnapshot(record) {
    const data = { ...(record?.data || {}) };
    Object.keys(data).forEach((key) => {
      if (/signature/i.test(key) && typeof data[key] === 'string' && data[key].length > 8000) data[key] = '[signature retained in source record]';
    });
    return {id:record?.id||'',type:record?.type||'',name:record?.name||'',category:record?.category||'',state:record?.state||'',region:record?.region||'',station:record?.station||'',feeder:record?.feeder||'',officer:record?.officer||'',status:record?.status||'',savedAt:record?.savedAt||'',workflowHistory:Array.isArray(record?.workflowHistory)?record.workflowHistory.slice(-20):[],data};
  }
  function publishRoute(record, action, to, region, note) {
    const envelope={messageId:'PCM-WF-'+Date.now()+'-'+Math.random().toString(36).slice(2,8).toUpperCase(),version:ENHANCER_VERSION,recordId:record.id,formType:record.type||'',formName:record.name||'',action,from:currentOffice(),to:to||'',region:region||'',note:note||'',createdAt:nowISO(),record:routeRecordSnapshot(record)};
    const queue=loadArray(ROUTE_KEY).filter(item=>item?.messageId!==envelope.messageId);queue.unshift(envelope);writeArray(ROUTE_KEY,queue,100);
    try{window.dispatchEvent(new CustomEvent('kedco:eform-route-request',{detail:{envelope,record}}))}catch(error){console.warn('[PC&M eForm Enhancer] Route event dispatch failed',error)}
    return envelope;
  }

  function ensureStyles() {
    if (document.getElementById('pcmWorkflowEnhancerStyles')) return;
    const style = document.createElement('style');
    style.id = 'pcmWorkflowEnhancerStyles';
    style.textContent = `
      .pcm-wf-overlay{position:fixed;inset:0;z-index:4000;display:none;align-items:center;justify-content:center;padding:22px;background:rgba(15,23,42,.68);backdrop-filter:blur(5px);overflow:auto;overscroll-behavior:contain}
      .pcm-wf-overlay.active{display:flex}
      .pcm-wf-modal{width:min(920px,96vw);height:min(860px,90dvh);max-height:90dvh;min-height:0;background:#fff;border-radius:18px;box-shadow:0 28px 70px rgba(0,0,0,.28);display:flex;flex-direction:column;overflow:hidden;border:1px solid #dfe7ef}
      .pcm-wf-head{padding:18px 22px;background:linear-gradient(125deg,#063d31,#08785e);color:#fff;display:flex;align-items:center;justify-content:space-between;gap:16px;position:sticky;top:0;z-index:4;flex:0 0 auto}
      .pcm-wf-head h3{margin:0;font-size:18px}.pcm-wf-head small{display:block;margin-top:3px;color:#d7eee6;font-size:11px}
      .pcm-wf-x{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.12);color:#fff;border-radius:9px;width:40px;height:40px;font-size:24px;cursor:pointer;display:grid;place-items:center;flex:0 0 auto}.pcm-wf-x:hover{background:rgba(255,255,255,.22);transform:rotate(3deg)}
      .pcm-wf-body{padding:20px 22px;overflow:auto;background:#f8fafc;min-height:0;flex:1 1 auto;overscroll-behavior:contain}
      .pcm-wf-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}
      .pcm-wf-card{background:#fff;border:1px solid #dfe7ef;border-radius:11px;padding:11px}.pcm-wf-card small{display:block;color:#64748b;font-size:9px;text-transform:uppercase;font-weight:800;letter-spacing:.05em}.pcm-wf-card b{display:block;margin-top:4px;font-size:12px;color:#17324d;overflow-wrap:anywhere}
      .pcm-wf-routebox{margin-top:14px;background:#fff;border:1px solid #dfe7ef;border-radius:12px;padding:14px}.pcm-wf-routebox h4{margin:0 0 10px;color:#064e3b;font-size:13px}
      .pcm-wf-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.pcm-wf-grid label{display:grid;gap:5px;font-size:10px;font-weight:800;color:#334155}.pcm-wf-grid label.wide{grid-column:1/-1}
      .pcm-wf-grid select,.pcm-wf-grid textarea{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:9px 10px;font:inherit;background:#fff}.pcm-wf-grid textarea{min-height:76px;resize:vertical}
      .pcm-wf-timeline{margin-top:15px;background:#fff;border:1px solid #dfe7ef;border-radius:12px;overflow:hidden}.pcm-wf-timeline h4{margin:0;padding:12px 14px;background:#eef6f2;color:#064e3b;font-size:12px}.pcm-wf-step{padding:10px 14px;border-top:1px solid #edf1f5;font-size:11px}.pcm-wf-step b{color:#0a5b46}.pcm-wf-step small{display:block;color:#64748b;margin-top:3px}
      .pcm-wf-footer{padding:14px 18px;border-top:1px solid #dfe7ef;background:#fff;display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap;position:sticky;bottom:0;z-index:4;flex:0 0 auto;box-shadow:0 -8px 18px rgba(15,23,42,.06)}.pcm-wf-btn{border:0;border-radius:9px;padding:10px 15px;font-size:12px;font-weight:800;cursor:pointer}.pcm-wf-btn.secondary{background:#eef2f7;color:#1e293b;border:1px solid #cfd8e3}.pcm-wf-btn.primary{background:#064e3b;color:#fff}.pcm-wf-btn.gold{background:#d4af37;color:#063d31}
      .pcm-wf-tag{display:inline-flex;padding:4px 8px;border-radius:999px;font-size:9px;font-weight:900}.pcm-wf-tag.received{background:#e8f1ff;color:#1451a5}.pcm-wf-tag.sent,.pcm-wf-tag.forwarded{background:#e9f8f0;color:#087747}.pcm-wf-tag.saved{background:#fff5d9;color:#7c5900}
      .pcm-wf-table-actions{display:flex;gap:5px;flex-wrap:wrap}.pcm-wf-mini{border:1px solid #cfd8e3;background:#fff;border-radius:7px;padding:5px 8px;font-size:9px;font-weight:800;cursor:pointer;color:#24445f}.pcm-wf-mini.forward{background:#eef8f3;color:#087747;border-color:#c8e5d7}
      .pcm-wf-modal{border-top:5px solid #d4af37}
      .pcm-wf-head{background:radial-gradient(circle at 88% 0,rgba(255,222,109,.24),transparent 25%),linear-gradient(125deg,#04382f,#08785e)}
      .pcm-wf-card{box-shadow:0 4px 12px rgba(6,78,59,.035)}
      .pcm-wf-routebox{border-left:4px solid #d4af37}
      .pcm-wf-step{line-height:1.55}
      .pcm-wf-mini:hover{transform:translateY(-1px);box-shadow:0 4px 10px rgba(15,23,42,.07)}
      @media(max-width:760px){.pcm-wf-overlay{padding:8px;align-items:flex-start}.pcm-wf-modal{width:100%;height:94dvh;max-height:94dvh;margin-top:2dvh;border-radius:13px}.pcm-wf-head{padding:14px 15px}.pcm-wf-body{padding:15px}.pcm-wf-footer{padding:10px 11px}.pcm-wf-summary{grid-template-columns:1fr 1fr}.pcm-wf-grid{grid-template-columns:1fr}.pcm-wf-grid label.wide{grid-column:auto}.pcm-wf-btn{flex:1 1 140px;justify-content:center}}
    `;
    document.head.appendChild(style);
  }

  function ensureModal() {
    ensureStyles();
    let overlay = document.getElementById('pcmWorkflowModal');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'pcmWorkflowModal';
    overlay.className = 'pcm-wf-overlay';
    overlay.dataset.pcmWorkflowModal = '1';
    overlay.innerHTML = `
      <div class="pcm-wf-modal" role="dialog" aria-modal="true" aria-labelledby="pcmWorkflowTitle">
        <div class="pcm-wf-head">
          <div><h3 id="pcmWorkflowTitle">PC&M E-Form Workflow</h3><small id="pcmWorkflowSub">Register, receive and forward controlled eForms</small></div>
          <button type="button" class="pcm-wf-x" id="pcmWorkflowTopClose" aria-label="Close">&times;</button>
        </div>
        <div class="pcm-wf-body" id="pcmWorkflowBody"></div>
        <div class="pcm-wf-footer">
          <button type="button" class="pcm-wf-btn secondary" id="pcmWorkflowBottomClose">Close</button>
          <button type="button" class="pcm-wf-btn gold" id="pcmWorkflowOpenForm">Open Form</button>
          <button type="button" class="pcm-wf-btn primary" id="pcmWorkflowForward">Forward to Next Personnel</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const close = (event) => {
      event?.preventDefault();
      event?.stopPropagation();
      closeWorkflowModal();
    };
    document.getElementById('pcmWorkflowTopClose').addEventListener('click', close);
    document.getElementById('pcmWorkflowBottomClose').addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(event);
    });

    document.getElementById('pcmWorkflowOpenForm').addEventListener('click', () => {
      const record = findRecord(currentModalRecordId);
      if (!record) return;
      if (typeof window.openPCMEForm === 'function') {
        window.openPCMEForm(record.type, record.data || null, true);
        closeWorkflowModal();
      }
    });

    document.getElementById('pcmWorkflowForward').addEventListener('click', forwardFromModal);
    return overlay;
  }

  function optionList(items, selected) {
    return ['<option value="">Select next recipient</option>']
      .concat(items.map((item) => `<option value="${esc(item)}"${item === selected ? ' selected' : ''}>${esc(item)}</option>`))
      .join('');
  }

  function showWorkflowModal(record, mode = 'view') {
    if (!record) return;
    const overlay = ensureModal();
    currentModalRecordId = record.id;

    const history = Array.isArray(record.workflowHistory) ? record.workflowHistory : [];
    const status = String(record.status || mode || 'SAVED').toUpperCase();
    const statusClass = status.toLowerCase();
    const destination = record.lastRecipient || record.data?.dispatchTo || '—';
    const destinationRegion = record.lastRecipientRegion || record.data?.dispatchRegion || '—';

    const timeline = history.length
      ? history.slice().reverse().map((item) => `
          <div class="pcm-wf-step">
            <b>${esc(item.action || 'ACTION')}</b> · ${esc(item.from || '—')} → ${esc(item.to || '—')}
            <small>${formatDate(item.at)}${item.region ? ' · Region: ' + esc(item.region) : ''}${item.note ? ' · ' + esc(item.note) : ''}</small>
          </div>`).join('')
      : '<div class="pcm-wf-step">No route history recorded yet.</div>';

    document.getElementById('pcmWorkflowTitle').textContent = mode === 'received'
      ? 'Received PC&M E-Form'
      : mode === 'sent'
        ? 'Sent / Routed PC&M E-Form'
        : 'PC&M E-Form Workflow';

    document.getElementById('pcmWorkflowSub').textContent = `${record.name || record.type || 'E-Form'} · ${record.id || 'No reference'}`;

    document.getElementById('pcmWorkflowBody').innerHTML = `
      <div class="pcm-wf-summary">
        <div class="pcm-wf-card"><small>Reference</small><b>${esc(record.id || '—')}</b></div>
        <div class="pcm-wf-card"><small>Status</small><b><span class="pcm-wf-tag ${esc(statusClass)}">${esc(status)}</span></b></div>
        <div class="pcm-wf-card"><small>Current / Last Recipient</small><b>${esc(destination)}</b></div>
        <div class="pcm-wf-card"><small>Recipient Region</small><b>${esc(destinationRegion)}</b></div>
        <div class="pcm-wf-card"><small>Form</small><b>${esc(record.name || record.type || '—')}</b></div>
        <div class="pcm-wf-card"><small>Originating Officer</small><b>${esc(record.officer || '—')}</b></div>
        <div class="pcm-wf-card"><small>State / Region</small><b>${esc(record.state || '—')} / ${esc(record.region || '—')}</b></div>
        <div class="pcm-wf-card"><small>Last Update</small><b>${formatDate(record.lastActionAt || record.savedAt)}</b></div>
      </div>

      <div class="pcm-wf-routebox">
        <h4>Forward / Escalate to Next Personnel</h4>
        <div class="pcm-wf-grid">
          <label>Next Recipient
            <select id="pcmWfNextRecipient">${optionList(EXTRA_RECIPIENTS, '')}</select>
          </label>
          <label>Recipient Region
            <select id="pcmWfNextRegion"><option value="">Select region / HQ</option>${REGION_OPTIONS.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select>
          </label>
          <label class="wide">Forwarding / Technical Note
            <textarea id="pcmWfForwardNote" placeholder="Reason, instruction, required action or approval note..."></textarea>
          </label>
        </div>
      </div>

      <div class="pcm-wf-timeline">
        <h4>Routing / Register History</h4>
        ${timeline}
      </div>`;

    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    previousBodyOverflow = document.body.style.overflow || '';
    document.body.classList.add('kedco-modal-open');
    document.body.style.overflow = 'hidden';
    document.getElementById('pcmWorkflowTopClose')?.focus({ preventScroll: true });
  }

  function closeWorkflowModal() {
    const overlay = document.getElementById('pcmWorkflowModal');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('kedco-modal-open');
    document.body.style.overflow = previousBodyOverflow;
    previousBodyOverflow = '';
    currentModalRecordId = null;
  }

  function forwardFromModal() {
    const record = findRecord(currentModalRecordId);
    if (!record) return;

    const to = document.getElementById('pcmWfNextRecipient')?.value || '';
    const region = document.getElementById('pcmWfNextRegion')?.value || '';
    const note = document.getElementById('pcmWfForwardNote')?.value?.trim() || '';

    if (!to) {
      alert('Select the next recipient before forwarding the eForm.');
      return;
    }

    const next = enrichRecord(record, 'FORWARDED', to, region, note);
    next.data = { ...(next.data || {}), dispatchTo: to, dispatchRegion: region, dispatchNote: note };
    saveRecord(next);
    upsertSent(next);
    publishRoute(next, 'FORWARDED', to, region, note);
    showWorkflowModal(next, 'sent');
  }

  function enhanceDispatchRecipients() {
    const select = document.querySelector('#eformWorkspace select[name="dispatchTo"]');
    if (!select) return;
    const existing = new Set(Array.from(select.options).map((o) => o.value));
    EXTRA_RECIPIENTS.forEach((name) => {
      if (existing.has(name)) return;
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
  }

  function formSnapshot(form) {
    const data = {};
    new FormData(form).forEach((value, key) => { data[key] = value; });
    form.querySelectorAll('input[type="checkbox"][name]').forEach((input) => {
      data[input.name] = input.checked;
    });
    return data;
  }

  function processNativeSaved(detail) {
    const incoming=detail?.record,action=String(detail?.action||incoming?.status||'SAVED').toUpperCase();
    if(!incoming?.id)return;
    const record=findRecord(incoming.id)||incoming,data=record.data||{},to=data.dispatchTo||record.lastRecipient||'',region=data.dispatchRegion||record.lastRecipientRegion||'',note=data.dispatchNote||'';
    let next={...record,data:{...(record.data||{}),...data}};
    const history=Array.isArray(next.workflowHistory)?next.workflowHistory:[],last=history[history.length-1];
    const duplicate=last&&last.action===action&&last.to===to&&last.note===note&&(Date.now()-new Date(last.at).getTime()<2500);
    if(!duplicate)next=enrichRecord(next,action,to,region,note);else next.status=action;
    saveRecord(next);
    if(action==='SENT'){upsertSent(next);publishRoute(next,'SENT',to,region,note);showWorkflowModal(next,'sent')}
  }
  function enrichAfterNativeAction(form, action) {
    window.setTimeout(()=>{const data=formSnapshot(form),id=data.reference||form.elements?.reference?.value||'';if(!id)return;const record=findRecord(id);if(record)processNativeSaved({record,action})},0);
  }

  function refreshNativeRegister() {
    const search = document.getElementById('eformRecordSearch');
    if (search) search.dispatchEvent(new Event('input', { bubbles: true }));
    window.setTimeout(augmentRegister, 0);
  }

  function syncCounters() {
    const r = records().length;
    const s = sentRecords().length;
    ['efSavedCount', 'efHeroSaved'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(r);
    });
    ['efSentCount', 'efHeroSent'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(s);
    });
  }

  function augmentRegister() {
    if(augmentBusy)return;
    const table=document.getElementById('eformRecordsTable');if(!table)return;augmentBusy=true;
    try{
      const headRow=table.querySelector('thead tr');
      if(headRow&&!headRow.querySelector('[data-pcm-wf-route-head]')){
        const routeHead=document.createElement('th');routeHead.dataset.pcmWfRouteHead='1';routeHead.textContent='Route / Next';
        const workflowHead=document.createElement('th');workflowHead.dataset.pcmWfActionHead='1';workflowHead.textContent='Workflow';headRow.append(routeHead,workflowHead)
      }
      table.querySelectorAll('tbody tr').forEach(row=>{
        if(row.querySelector('.eform-empty'))return;
        const id=row.querySelector('td:first-child b')?.textContent?.trim();if(!id)return;
        const record=findRecord(id);if(!record)return;
        let routeCell=row.querySelector('[data-pcm-wf-route]');
        if(!routeCell){routeCell=document.createElement('td');routeCell.dataset.pcmWfRoute='1';row.appendChild(routeCell)}
        const signature=[record.lastRecipient||record.data?.dispatchTo||'—',record.lastRecipientRegion||record.data?.dispatchRegion||''].join('|');
        if(routeCell.dataset.signature!==signature){routeCell.dataset.signature=signature;routeCell.innerHTML=`<b>${esc(record.lastRecipient||record.data?.dispatchTo||'—')}</b><br><small>${esc(record.lastRecipientRegion||record.data?.dispatchRegion||'')}</small>`}
        let actionCell=row.querySelector('[data-pcm-wf-actions]');
        if(!actionCell){actionCell=document.createElement('td');actionCell.dataset.pcmWfActions='1';row.appendChild(actionCell)}
        if(actionCell.dataset.recordId!==String(id)){actionCell.dataset.recordId=String(id);actionCell.innerHTML=`<div class="pcm-wf-table-actions"><button type="button" class="pcm-wf-mini" data-pcm-wf-view="${esc(id)}">History</button><button type="button" class="pcm-wf-mini forward" data-pcm-wf-forward="${esc(id)}">Forward</button></div>`}
      })
    }finally{augmentBusy=false}
  }

  function compactReceivedRecord(record) {
    return {id:record?.id||'',type:record?.type||'',name:record?.name||'',status:record?.status||'RECEIVED',receivedAt:record?.receivedAt||nowISO(),receivedFrom:record?.receivedFrom||'',routeMessageId:record?.routeMessageId||'',lastRecipient:record?.lastRecipient||'',lastRecipientRegion:record?.lastRecipientRegion||''};
  }
  function registerReceived(payload, options = {}) {
    if(!payload||typeof payload!=='object')return null;
    const incoming=payload.record&&typeof payload.record==='object'?payload.record:payload;
    const data=incoming.data&&typeof incoming.data==='object'?incoming.data:(incoming.formData||{});
    const id=incoming.id||incoming.reference||data.reference||('PCM-RCV-'+Date.now());
    const routeMessageId=payload.routeMessageId||incoming.routeMessageId||'',receivedRows=loadArray(RECEIVED_KEY);
    if(routeMessageId&&receivedRows.some(r=>r.routeMessageId===routeMessageId))return findRecord(id)||null;
    const existing=findRecord(id);
    let record=existing?{...existing}:{id,type:incoming.type||incoming.formType||data.formType||'monthlyPerformance',name:incoming.name||incoming.formName||'Received PC&M E-Form',category:incoming.category||'PC&M',state:incoming.state||data.state||'',region:incoming.region||data.region||'',station:incoming.station||data.station||'',feeder:incoming.feeder||data.feeder||'',officer:incoming.officer||incoming.from||data.preparedName||'External Sender',savedAt:incoming.savedAt||nowISO(),data};
    record.data={...(record.data||{}),...data};
    record=enrichRecord(record,'RECEIVED',currentOffice(),incoming.recipientRegion||incoming.region||payload.region||'',incoming.note||payload.note||'Received into Head PC&M eForm register');
    record.receivedFrom=incoming.from||payload.from||record.officer||'';if(routeMessageId)record.routeMessageId=routeMessageId;
    saveRecord(record);
    const nextReceived=receivedRows.filter(r=>{if(routeMessageId&&r.routeMessageId===routeMessageId)return false;return !(String(r.id)===String(record.id)&&r.status==='RECEIVED')});
    nextReceived.unshift(compactReceivedRecord({...record,receivedAt:nowISO()}));writeArray(RECEIVED_KEY,nextReceived,140);
    if(!options.silent)showWorkflowModal(record,'received');return record;
  }
  function receiveFromRouteEnvelope(envelope, options = {}) {
    if(!envelope||!isForCurrentOffice(envelope.to))return null;
    const existing=findRecord(envelope.recordId),sourceRecord=existing||envelope.record;
    if(!sourceRecord){console.warn('[PC&M eForm Enhancer] Route envelope has no accessible record payload',envelope.recordId);return null}
    if(loadArray(RECEIVED_KEY).some(r=>r.routeMessageId===envelope.messageId))return existing||null;
    return registerReceived({...sourceRecord,record:sourceRecord,routeMessageId:envelope.messageId,from:envelope.from,note:envelope.note,region:envelope.region},options);
  }

  function scanPendingRoutes() {
    loadArray(ROUTE_KEY).slice(0,100).forEach(envelope=>receiveFromRouteEnvelope(envelope,{silent:true}));
  }

  function bindEvents() {
    document.addEventListener('click',(event)=>{
      const view=event.target.closest('[data-pcm-wf-view]');if(view){const record=findRecord(view.dataset.pcmWfView);if(record)showWorkflowModal(record,'view')}
      const forward=event.target.closest('[data-pcm-wf-forward]');if(forward){const record=findRecord(forward.dataset.pcmWfForward);if(record)showWorkflowModal(record,'view')}
    });
    window.addEventListener('kedco:pcm-eform-native-saved',(event)=>processNativeSaved(event.detail||{}));
    document.addEventListener('keydown',(event)=>{if(event.key==='Escape'&&document.getElementById('pcmWorkflowModal')?.classList.contains('active'))closeWorkflowModal()});
    ['kedco:eform-received','kedco:eform:received','KEDCO_EFORM_RECEIVED'].forEach(eventName=>window.addEventListener(eventName,event=>registerReceived(event.detail||{})));
    window.addEventListener('storage',(event)=>{if(event.key!==ROUTE_KEY||!event.newValue)return;try{const queue=JSON.parse(event.newValue);if(Array.isArray(queue)&&queue[0])receiveFromRouteEnvelope(queue[0])}catch(error){console.warn('[PC&M eForm Enhancer] Could not process routing storage event',error)}});
    const workspace=document.getElementById('eformWorkspace');
    if(workspace){let workspaceTimer=0;new MutationObserver(()=>{clearTimeout(workspaceTimer);workspaceTimer=window.setTimeout(()=>{enhanceDispatchRecipients();ensureProfessionalFormCloseControls()},30)}).observe(workspace,{childList:true,subtree:true})}
    const table=document.getElementById('eformRecordsTable');
    if(table){let tableTimer=0;new MutationObserver(()=>{clearTimeout(tableTimer);tableTimer=window.setTimeout(augmentRegister,35)}).observe(table,{childList:true,subtree:true})}
  }

  function addPopupCloseButtonToExternalEFormDialogs() {
    const candidates = Array.from(document.querySelectorAll('.modal-overlay.active, [role="dialog"], .kedco-eform-modal, .eform-modal'));
    const dialogs = [];
    candidates.forEach((candidate) => {
      const dialog = candidate.closest('.modal-overlay, .kedco-eform-modal, .eform-modal') || candidate;
      if (dialog.id === 'pcmWorkflowModal' || dialog.closest('#pcmWorkflowModal')) return;
      if (!dialogs.includes(dialog)) dialogs.push(dialog);
    });
    dialogs.forEach((dialog) => {
      if (dialog.querySelector('[data-pcm-auto-close]')) return;
      const text = (dialog.textContent || '').toLowerCase();
      if (!text.includes('e-form') && !text.includes('eform') && !text.includes('received') && !text.includes('sent')) return;
      const footer = dialog.querySelector('.modal-footer, .footer, [class*="footer"]');
      if (!footer) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.pcmAutoClose = '1';
      button.className = 'btn btn-secondary';
      button.textContent = 'Close';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (dialog.tagName === 'DIALOG' && dialog.open) {
          dialog.close();
          return;
        }
        dialog.classList.remove('active', 'show', 'open');
        if (dialog.style.display === 'block' || dialog.style.display === 'flex') dialog.style.display = 'none';
        document.body.classList.remove('kedco-modal-open');
        if (!document.querySelector('.modal-overlay.active,.pcm-wf-overlay.active,[role="dialog"].open')) document.body.style.overflow = '';
      });
      footer.appendChild(button);
    });
  }

  function ensureProfessionalFormCloseControls() {
    const workspace = document.getElementById('eformWorkspace');
    if (!workspace) return;
    const form = workspace.querySelector('.pcm-form');
    if (!form) return;
    const actionbar = form.querySelector('.actionbar');
    if (actionbar && !actionbar.querySelector('[data-pcm-fallback-close]') && !actionbar.querySelector('[data-close-form]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.pcmFallbackClose = '1';
      button.className = 'btn ghost';
      button.innerHTML = '&#8592; Close / Return';
      button.addEventListener('click', () => {
        if (typeof window.closePCMEForm === 'function') window.closePCMEForm();
        else {
          const host = document.getElementById('eformWorkspace');
          if (host) host.innerHTML = '<div style="padding:40px;text-align:center;color:#64748b">Form closed. Select another e-form to continue.</div>';
          const returnSection = window.KEDCO_PCM_EFORM_RETURN_SECTION;
          if (returnSection && typeof window.showSection === 'function') {
            window.showSection(returnSection, document.querySelector('.nav-item[data-section="' + returnSection + '"]'));
          }
        }
      });
      actionbar.prepend(button);
    }
  }

  function init() {
    ensureModal();
    enhanceDispatchRecipients();
    ensureProfessionalFormCloseControls();
    augmentRegister();
    syncCounters();
    bindEvents();
    scanPendingRoutes();

    window.KEDCO_PCM_WORKFLOW_ENHANCER_VERSION = ENHANCER_VERSION;
    window.KEDCO_PCM_REGISTER_RECEIVED = registerReceived;
    window.KEDCO_PCM_OPEN_WORKFLOW = (id) => {
      const record = findRecord(id);
      if (record) showWorkflowModal(record, 'view');
    };
    window.KEDCO_PCM_FORWARD_RECORD = (id) => {
      const record = findRecord(id);
      if (record) showWorkflowModal(record, 'view');
    };
    window.KEDCO_PCM_WORKFLOW_HEALTH = () => ({
      version: ENHANCER_VERSION,
      office: currentOffice(),
      records: records().length,
      sent: sentRecords().length,
      received: loadArray(RECEIVED_KEY).length,
      queuedRoutes: loadArray(ROUTE_KEY).length
    });

    let popupTimer = 0;
    new MutationObserver(() => {
      clearTimeout(popupTimer);
      popupTimer = window.setTimeout(addPopupCloseButtonToExternalEFormDialogs, 40);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });

    addPopupCloseButtonToExternalEFormDialogs();
    console.info('[PC&M eForm Enhancer] Active', ENHANCER_VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();

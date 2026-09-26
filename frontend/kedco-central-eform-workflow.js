/* Unified central e-form dispatch.
   Every standard e-form keeps its local copy, while this bridge makes the
   authenticated central record the source for delivery and live feedback. */
(function (global) {
  "use strict";

  const LEGACY_RETE_PAGES = new Set(["re_te.html", "super_re_te.html"]);
  const REGISTER_PAGES = new Set(["dispatch.html"]);
  const RECIPIENT_OPTIONS = [
    "CTO / Chief Technical Officer",
    "Head Technical",
    "Head System Operations / Dispatch",
    "Head O & M",
    "Head PC & M",
    "Head P & I / Planning",
    "Head HSE",
    "Head MIS",
    "Head Stores / Inventory",
    "Head Procurement / Contracts",
    "Head Finance / Accounts",
    "Regional Engineer (RE)",
    "Technical Engineer (TE)",
    "Dispatch", "Regional PC & M", "Regional Cable Jointers", "Regional Electrical Fitters",
    "Regional O & M", "Regional P & I", "Regional PPM Coordinator", "Regional HSE Officer",
    "Station Operator", "Transmission"
  ];
  let apiClient = null;
  let rows = [];
  let filterText = "";
  let box = "all";
  let personnel = [];
  let recipientRegions = [];
  let dutyStations = [];
  let approvedTemplates = null;

  async function loadPersonnel() {
    try {
      const client = getClient();
      const [result, regions] = await Promise.all([
        client?.rpc("kedco_list_eform_personnel", {}), client?.rpc("kedco_list_eform_regions", {})
      ]);
      if (!regions?.error && Array.isArray(regions?.data)) recipientRegions = regions.data;
      if (!result?.error && Array.isArray(result?.data)) {
        personnel = result.data;
      }
      try {
        const response = await fetch('/assets/kedco-eform-stations.json');
        if (response.ok) dutyStations = await response.json();
      } catch (_) {}
      ensureRecipientOptions();
    } catch (_) { /* Office routing remains available while the directory is offline. */ }
  }

  function isRegionalRE(role) {
    return role === 'RE' || role === 'Regional Engineer (RE)';
  }
  function regionScopeKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isGlobalRegionScope(value) {
    const key = regionScopeKey(value);
    return !key || ['all', 'all region', 'all regions', 'corporate', 'corporate all regions', 'head office'].includes(key);
  }

  // Empty/all-region scope means the officer is available to receive work
  // from any region. Explicit regional scope remains restrictive.
  function personRegionMatches(person, region) {
    if (!region) return true;
    const values = [person?.region_id, person?.region_name].map(regionScopeKey).filter(Boolean);
    if (!values.length || values.some(isGlobalRegionScope)) return true;
    const target = [region.id, region.name].map(regionScopeKey).filter(Boolean);
    return values.some(value => target.includes(value));
  }

  function rolesForOffice(label) {
    const roles = {
      'CTO / Chief Technical Officer':['CTO','TA_CTO'], 'Head Technical':['HEAD_TECHNICAL'],
      'Head System Operations / Dispatch':['HEAD_SO','DISPATCH_SUPERVISOR','DISPATCH'], 'Head System Operations':['HEAD_SO'],
      'Head O & M':['HEAD_OM'], 'Head PC & M':['HEAD_PCM'], 'Head P & I / Planning':['HEAD_PI'], 'Head P & I':['HEAD_PI'],
      'Head HSE':['HEAD_HSE'], 'Head MIS':['HEAD_MIS'], 'Head Stores / Inventory':['STORE_MANAGER','STORE_OFFICER'],
      'Head Procurement / Contracts':['PROCUREMENT_HEAD','PROCUREMENT_OFFICER'], 'Head Finance / Accounts':['FINANCE_HEAD','FINANCE_OFFICER'],
      'Regional Engineer (RE)':['RE','SUPER_RE_TE'], RE:['RE'], 'Technical Engineer (TE)':['TE','SUPER_RE_TE'], TE:['TE'],
      Dispatch:['DISPATCH','DISPATCH_SUPERVISOR','HEAD_SO'], 'Regional PC & M':['REGIONAL_PCM_COORD','PROTECTION_ENGINEER','CONTROL_SCADA_ENGINEER','METERING_ENGINEER','TEST_ENGINEER'],
      'Regional Cable Jointers':['REGIONAL_CJ','REGIONAL_CJ_LEAD'], 'Regional Electrical Fitters':['REGIONAL_EF','REGIONAL_EF_LEAD'],
      'Regional O & M':['REGIONAL_OM_COORD'], 'Regional P & I':['REGIONAL_PI_COORD','PLANNING_ENGINEER'],
      'Regional PPM Coordinator':['REGIONAL_PPM_COORD'], 'Regional HSE Officer':['REGIONAL_HSE_OFFICER','HSE_OFFICER','HEAD_HSE'],
      'Station Operator':['OPERATOR','STATION_OPERATOR','SUPER_OPERATOR'], Transmission:['TRANSMISSION','SUPER_TRANS']
    };
    return roles[label] || [];
  }

  // Active RE officers assigned to a region, using the same rule as the backend
  // (routeRegionalRE): only active users whose role set includes RE and whose
  // region matches the requested region. Shared so the send guard and the
  // live selector status can never disagree with each other or the backend.
  function regionalReOfficers(region) {
    return personnel.filter(person => {
      const roles = person.roles || [person.primary_role];
      return roles.some(role => String(role).toUpperCase() === 'RE') && personRegionMatches(person, region);
    });
  }

  // Returns an error message when an RE-region send must be blocked, or '' when
  // the destination is valid. Mirrors the backend's hard rejections exactly.
  function regionalReBlock(role, region, personId) {
    if (!isRegionalRE(role)) return '';
    if (!region) return "Select the receiving RE's region before sending.";
    if (personId) {
      const person = personnel.find(item => item.id === personId);
      return person && !personRegionMatches(person, region) ? "The selected officer is not assigned to this region. Choose their assigned region or All regions." : '';
    }
    const officers = regionalReOfficers(region);
    if (!officers.length) return 'No active RE is assigned to ' + region.name + '. Select another region or assign the region in Manage Roles.';
    if (officers.length > 1) return 'More than one RE is assigned to ' + region.name + '. Select the individual officer from Personnel before sending.';
    return '';
  }

  function setOptions(select, options, placeholder) {
    const markup = '<option value="">' + esc(placeholder) + '</option>' + options.map(item => '<option value="' + esc(item.value) + '">' + esc(item.label) + '</option>').join('');
    if (select.dataset.options === markup) return;
    const value = select.value;
    select.innerHTML = markup;
    select.dataset.options = markup;
    select.value = value;
  }

  function ensureRegionalSelectors() {
    document.querySelectorAll('select[name="dispatchTo"], select[name="sendRecipientRole"], select[data-forward-role]').forEach(select => {
      const scope = select.closest('form, dialog');
      if (!scope) return;
      let group = scope.querySelector('[data-re-region-group]');
      if (!group) {
        group = document.createElement('div');
        group.setAttribute('data-re-region-group', '');
        group.setAttribute('data-central-routing', '');
        group.className = 'kedco-routing-choices';
        group.innerHTML = '<label>Receiving region <select name="centralRecipientRegion" data-recipient-region></select></label><label>Personnel <select name="centralRecipientPerson" data-recipient-person></select></label><label>Station / duty location <select name="centralRecipientStation" data-recipient-station></select></label><p data-region-recipient role="status"></p>';
        (select.closest('label, .field, .smart-field') || select).insertAdjacentElement('afterend', group);
      }
      group.hidden = false;
      const regionSelect = group.querySelector('[data-recipient-region]');
      const personSelect = group.querySelector('[data-recipient-person]');
      setOptions(regionSelect, recipientRegions.map(region => ({value:region.id,label:region.name})), isRegionalRE(select.value) ? 'Select receiving region' : 'All regions / central office');
      regionSelect.required = isRegionalRE(select.value);
      regionSelect.disabled = false;
      const region = recipientRegions.find(item => regionScopeKey(item.id) === regionScopeKey(regionSelect.value) || regionScopeKey(item.name) === regionScopeKey(regionSelect.value));
      const targetRoles = rolesForOffice(select.value);
      const officers = personnel.filter(person => (!targetRoles.length || (person.roles || [person.primary_role]).some(role => targetRoles.some(target => String(role).toUpperCase() === String(target).toUpperCase()))) &&
        personRegionMatches(person, region));
      if (!select.value.startsWith('person:')) setOptions(personSelect, officers.map(person => ({value:person.id,label:person.full_name + ' - ' + person.primary_role.replace(/_/g,' ') + (person.region_name ? ' - ' + person.region_name : '')})), 'All personnel in selected office');
      if (select.value.startsWith('person:')) {
        const person = personnel.find(person => 'person:' + person.id === select.value);
        setOptions(personSelect, person ? [{value:person.id,label:person.full_name}] : [], 'Selected individual');
        personSelect.value = person?.id || '';
      }
      personSelect.disabled = select.value.startsWith('person:');
      const stations = [...new Set([...dutyStations, ...personnel.flatMap(person => person.assignments || [])])].sort();
      setOptions(group.querySelector('[data-recipient-station]'), stations.map(station => ({value:station,label:station})), 'No specific duty location');
      const officeDetails = scope.querySelector('input[name="dispatchRegion"], select[name="dispatchRegion"], input[data-forward-office]');
      if (officeDetails) {
        officeDetails.disabled = true;
        (officeDetails.closest('label, .field') || officeDetails).hidden = true;
      }
      const status = group.querySelector('[data-region-recipient]');
      const reBlock = regionalReBlock(select.value, region, personSelect.value);
      const message = !personnel.length ? 'Loading the local personnel directory...' : reBlock ? reBlock : officers.length ?
        (personSelect.value ? 'Recipient: ' + (personnel.find(person => person.id === personSelect.value)?.full_name || '') : officers.length + ' personnel match this office and region. Select one officer or send to the office.') :
        'No active personnel match this region and office. Select another destination.';
      if (status.textContent !== message) status.textContent = message;
    });
  }

  async function prepareFormDocument(form) {
    if (!form) throw new Error('The e-form could not be found. Reopen it before sending.');
    await Promise.all(Array.from(form.querySelectorAll('img')).map(async img => {
      if (!img.complete && img.decode) await img.decode();
      if (!img.naturalWidth) throw new Error('A form image has not loaded. Wait for the complete form before sending.');
    }));
    return captureFormDocument(form);
  }

  function captureFormDocument(form) {
    if (!form) return null;
    const copy = form.cloneNode(true);
    const originalWidth = Math.ceil(form.offsetWidth || form.scrollWidth || (form.classList.contains('landscape') ? 1123 : 794));
    copy.setAttribute('data-kedco-original-width', String(originalWidth));
    const images = form.querySelectorAll('img');
    copy.querySelectorAll('img').forEach((element, index) => {
      const original = images[index];
      if (original.src.startsWith('data:') || !original.naturalWidth) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = original.naturalWidth;
        canvas.height = original.naturalHeight;
        canvas.getContext('2d').drawImage(original, 0, 0);
        element.src = canvas.toDataURL('image/png');
      } catch (_) { /* Cross-origin images cannot be embedded by the browser. */ }
    });
    const originals = form.querySelectorAll('input, textarea, select, canvas');
    copy.querySelectorAll('input, textarea, select, canvas').forEach((element, index) => {
      const original = originals[index];
      if (element.tagName === 'CANVAS') {
        try { const picture = document.createElement('img'); picture.className = original.className; picture.width = original.width; picture.height = original.height; picture.src = original.toDataURL(); picture.style.cssText = original.style.cssText + ';max-width:100%;object-fit:contain'; element.replaceWith(picture); } catch (_) {}
      } else if (element.tagName === 'TEXTAREA') element.textContent = original.value;
      else if (element.tagName === 'SELECT') Array.from(element.options).forEach((option, i) => option.toggleAttribute('selected', original.options[i].selected));
      else { element.setAttribute('value', original.value); element.toggleAttribute('checked', original.checked); }
      if (element.tagName !== 'CANVAS') element.disabled = true;
    });
    copy.querySelectorAll('script,iframe,object,embed,link,meta,base,button,[data-central-routing],[data-kedco-workflow-panel],.dispatch-panel,.dispatch.no-print,.sig-tools,[data-send-status]').forEach(element => element.remove());
    copy.querySelectorAll('*').forEach(element => Array.from(element.attributes).forEach(attribute => {
      if (/^on/i.test(attribute.name) || ['srcdoc', 'formaction', 'action'].includes(attribute.name)) element.removeAttribute(attribute.name);
    }));
    const styles = Array.from(document.styleSheets || []).map(sheet => {
      try { return Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n'); } catch (_) { return ''; }
    }).join('\n').replace(/<\/style/gi, '<\\/style');
    // Keep ancestor classes/IDs used by the approved sheet's CSS.
    let root = copy;
    for (let parent = form.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const wrapper = document.createElement('div');
      wrapper.className = parent.className;
      if (parent.id) wrapper.id = parent.id;
      wrapper.style.cssText = 'display:block!important;position:static!important;transform:none!important;max-width:none!important;padding:0!important;margin:0!important;overflow:visible!important';
      wrapper.appendChild(root); root = wrapper;
    }
    return '<style>' + styles + '\nhtml,body{margin:0!important;padding:12px!important;background:white!important;color:#172333!important;overflow:auto!important}form{display:block!important;position:static!important;width:100%!important;max-width:none!important;margin:0!important}input:disabled,textarea:disabled,select:disabled{opacity:1!important;color:inherit!important;-webkit-text-fill-color:currentColor}button{display:none!important}</style>' + root.outerHTML;
  }

  function fillSavedValues(form, payload) {
    const used = {};
    Array.from(form.elements || []).forEach(element => {
      const value = payload?.[element.name];
      if (value === undefined || value === null) { if (element.tagName !== 'BUTTON') element.value = ''; return; }
      if (element.type === 'checkbox' || element.type === 'radio') {
        element.checked = value === true || (Array.isArray(value) ? value.map(String).includes(element.value) : String(value) === element.value);
      } else {
        const index = used[element.name] || 0; used[element.name] = index + 1;
        const entry = Array.isArray(value) ? value[index] ?? '' : value;
        if (element.tagName === 'SELECT' && !Array.from(element.options).some(option => option.value === String(entry))) element.add(new Option(String(entry), String(entry)));
        element.value = entry;
        if (element.type === 'hidden' && /^data:image\//.test(String(entry))) {
          const canvas = element.parentElement.querySelector('canvas');
          if (canvas) { const picture = document.createElement('img'); picture.src = entry; picture.style.cssText = 'max-width:100%;max-height:150px'; canvas.replaceWith(picture); }
        }
      }
    });
  }

  async function previewDocument(row) {
    if (row.form_document) return row.form_document;
    let markup = '', templateStyles = '';
    // Existing dispatch records predate saved documents. Reuse their source templates on every recipient page.
    if (['dispatch.html','operator.html','super_operator.html'].includes(row.source_page)) {
      if (!approvedTemplates) {
        const response = await fetch('/assets/kedco-approved-eform-templates.json');
        if (!response.ok) throw new Error('The approved form template could not be loaded. Please retry.');
        approvedTemplates = await response.json();
      }
      markup = approvedTemplates.forms[row.form_code] || '';
      templateStyles = approvedTemplates.styles || '';
    }
    if (!markup && row.source_page === pageName()) {
      const renderer = typeof FORM_RENDERERS !== 'undefined' && FORM_RENDERERS[row.form_code];
      if (renderer) markup = renderer();
    }
    if (markup) {
      const wrapper = document.createElement('div'); wrapper.innerHTML = markup;
      const form = wrapper.querySelector('form');
      if (form) {
        fillSavedValues(form, row.payload || {});
        const documentCopy = captureFormDocument(form);
        return documentCopy + '<style>' + templateStyles.replace(/<\/style/gi, '<\\/style') + '</style>';
      }
    }
    return '<h2>' + esc(row.form_title || row.form_code) + '</h2><p>This older record has no saved approved layout. The recorded contents are retained below.</p>' + Object.entries(row.payload || {}).map(([key, value]) => '<p><b>' + esc(key) + '</b>: ' + esc(typeof value === 'object' ? JSON.stringify(value) : value) + '</p>').join('');
  }

  // Tracks the most recent preview so callers (and tests) can await rendering.
  let activePreview = Promise.resolve();
  function previewSettled() { return activePreview; }

  async function attachPreview(host, row, height) {
    const frame = document.createElement('iframe');
    frame.title = row.form_title || 'Received e-form';
    frame.setAttribute('sandbox', '');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.style.cssText = 'display:block;width:100%;height:' + height + ';border:1px solid #ccd6dd;background:white';
    host.textContent = 'Loading the KEDCO form...';
    activePreview = renderPreview(host, row, frame);
    return activePreview;
  }

  async function renderPreview(host, row, frame) {
    let content;
    try { content = await previewDocument(row); } catch (error) { host.textContent = error.message; return; }
    host.textContent = '';
    const width = Number(content.match(/data-kedco-original-width="(\d+)"/)?.[1]) || (/class="[^"]*\blandscape\b/.test(content) || ['of17', 'of19', 'load33', 'load11', 'jha'].includes(row.form_code) ? 1123 : 794);
    frame.srcdoc = '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; style-src \'unsafe-inline\'; img-src data:; form-action \'none\'; base-uri \'none\'">' + content +
      '<style>form{box-sizing:border-box!important;width:' + width + 'px!important;min-width:' + width + 'px!important;max-width:none!important;transform:none!important;zoom:1!important}html,body{overflow:auto!important}</style>';
    host.appendChild(frame);
  }

  // Poll the authenticated inbox separately from the visible register: oversight
  // records and the sender's own copies must never become recipient alerts.
  let checkingInbox = false;
  let alertUser = "";
  let pendingAlerts = [];
  const dismissedAlerts = new Set();
  let alertPanel = null;
  let alertPanelClosed = false;

  function alertKey(id) {
    return "kedco-eform-alert:" + alertUser + ":" + id;
  }

  function wasDismissed(id) {
    try { return dismissedAlerts.has(alertKey(id)) || global.localStorage.getItem(alertKey(id)) === "1"; }
    catch (_) { return dismissedAlerts.has(alertKey(id)); }
  }

  function announceIncoming() {
    if (!pendingAlerts.length || !global.speechSynthesis || !global.SpeechSynthesisUtterance) return;
    const row = pendingAlerts[0];
    const message = pendingAlerts.length === 1
      ? "You have received " + (row.form_title || row.form_code || "an e-form") + " from " + (row.sender_name || "a KEDCO sender") + "."
      : "You have " + pendingAlerts.length + " incoming KEDCO e-forms waiting for your attention.";
    try {
      const speech = new global.SpeechSynthesisUtterance(message);
      speech.lang = "en-NG";
      speech.rate = 0.94;
      global.speechSynthesis.speak(speech);
    } catch (_) { /* The visible alert remains available without browser audio. */ }
  }

  function renderIncoming() {
    if (!alertPanel) {
      alertPanel = document.createElement("section");
      alertPanel.id = "kedcoIncomingEformAlert";
      alertPanel.setAttribute("role", "region");
      alertPanel.setAttribute("aria-label", "Incoming e-form announcements");
      if (isHeadPcmPage()) {
        alertPanel.className = "kedco-headpcm-incoming";
        alertPanel.style.cssText = "position:relative;box-sizing:border-box;width:auto;max-height:min(48vh,560px);overflow:auto;margin:0 0 16px;background:linear-gradient(135deg,#f0fbf6,#fffaf0);color:#142333;border:1px solid #b7d9c8;border-left:5px solid #087c5e;border-radius:12px;padding:14px;box-shadow:0 8px 22px rgba(6,78,59,.12);font:inherit";
        const liveHost = document.getElementById("trouble-reports") || document.getElementById("live-ops") || document.body;
        liveHost.prepend(alertPanel);
      } else {
        alertPanel.style.cssText = "position:fixed;inset:12px;z-index:2147483000;box-sizing:border-box;width:calc(100vw - 24px);height:calc(100dvh - 24px);overflow:auto;background:#fff;color:#142333;border:2px solid #087f5b;border-radius:12px;padding:16px;box-shadow:0 12px 40px #0005;font:15px/1.5 system-ui";
        document.body.appendChild(alertPanel);
      }
      alertPanel.addEventListener("click", event => {
        if (event.target.closest("[data-incoming-speak]")) announceIncoming();
        const close = event.target.closest("[data-incoming-close]");
        if (close) {
          alertPanelClosed = true;
          renderIncoming();
          return;
        }
        const open = event.target.closest("[data-incoming-open]");
        if (open) { openRecord(open.getAttribute('data-incoming-open')); return; }
        const forward = event.target.closest("[data-incoming-forward]");
        if (forward) { openRecord(forward.getAttribute('data-incoming-forward')); return; }
        const button = event.target.closest("[data-incoming-dismiss]");
        if (!button) return;
        const id = button.getAttribute("data-incoming-dismiss");
        dismissedAlerts.add(alertKey(id));
        try { global.localStorage.setItem(alertKey(id), "1"); } catch (_) { /* Retain in memory. */ }
        pendingAlerts = pendingAlerts.filter(row => String(row.alert_id || row.id) !== id);
        renderIncoming();
      });
    }
    alertPanel.hidden = alertPanelClosed || !pendingAlerts.length;
    const headPcm = isHeadPcmPage();
    alertPanel.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap" role="status" aria-live="polite"><strong>' + (headPcm ? 'Incoming Trouble / Repair e-forms (' : 'Incoming e-forms (') + pendingAlerts.length + ')</strong><button type="button" data-incoming-close style="border:1px solid #b8c7d4;background:#fff;border-radius:7px;padding:6px 10px;font-weight:800;cursor:pointer">Close panel</button></div>' +
      '<button type="button" data-incoming-speak style="margin:8px 0">Play announcement</button>' +
      pendingAlerts.map(row => '<article style="border-top:1px solid #ccd6dd;padding:12px 0"><strong>' + esc(row.form_title || row.form_code || "E-form") +
        '</strong><div>From: ' + esc(row.sender_name || row.sender_email || "KEDCO sender") +
        '</div><div>Reference: ' + esc(row.reference || row.id) + '</div>' +
        (row.note ? '<div>' + esc(row.note) + '</div>' : '') +
        (headPcm
          ? '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:8px"><button type="button" data-incoming-open="' + esc(row.id) + '">Open e-form</button><button type="button" data-incoming-forward="' + esc(row.id) + '">Forward / Act</button><button type="button" data-incoming-dismiss="' + esc(row.alert_id || row.id) + '">Dismiss</button></div>'
          : '<button type="button" data-incoming-open="' + esc(row.id) + '">Open e-form / Forward</button> <button type="button" data-incoming-dismiss="' + esc(row.alert_id || row.id) + '">Dismiss announcement</button>') + '</article>').join("");
    if (pendingAlerts.length && !headPcm) attachPreview(alertPanel, pendingAlerts[0], '72vh');
  }

  async function checkIncoming() {
    if (checkingInbox || document.visibilityState === "hidden") return;
    const client = getClient();
    if (!client) return;
    checkingInbox = true;
    try {
      const session = await client.auth.getSession();
      const userId = session.data?.session?.user?.id;
      if (String(userId || "") !== alertUser) {
        alertUser = String(userId || "");
        pendingAlerts = [];
        if (alertPanel) renderIncoming();
      }
      if (!userId || session.error) return;
      const result = await client.rpc("kedco_list_central_eforms", { requested_box: "inbox" });
      if (result.error || !Array.isArray(result.data)) return;
      const incoming = result.data.map(row => ({ ...row, alert_id: row.notification_stage ? row.id + ":" + row.notification_stage : row.id }))
        .filter(row => row.id && (row.source_type === "OPERATOR_WORKFLOW" || String(row.sender_id) !== String(userId)) &&
          (String(row.status || "SENT").toUpperCase() === "SENT" ||
            (row.source_type === "OPERATOR_WORKFLOW" && ["SUBMITTED", "IN_REVIEW"].includes(String(row.status).toUpperCase()))) && !wasDismissed(row.alert_id));
      const previous = new Set(pendingAlerts.map(row => String(row.alert_id || row.id)));
      const hasNew = incoming.some(row => !previous.has(String(row.alert_id)));
      const changed = hasNew || incoming.length !== previous.size;
      if (hasNew) alertPanelClosed = false;
      pendingAlerts = incoming;
      if (changed && (pendingAlerts.length || alertPanel)) renderIncoming();
      if (hasNew) announceIncoming();
    } catch (_) { /* A later poll retries transient connectivity/auth failures. */ }
    finally { checkingInbox = false; }
  }

  function pageName() {
    return String(global.location?.pathname || "").split("/").pop().toLowerCase();
  }

  function isHeadPcmPage() {
    return pageName() === "headpcm.html" || Boolean(document.getElementById("live-ops"));
  }

  function isLegacyRetePage() {
    return LEGACY_RETE_PAGES.has(pageName());
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  function getClient() {
    if (!apiClient && global.supabase?.createClient) apiClient = global.supabase.createClient("", "");
    return apiClient;
  }

  function compactValue(value, depth) {
    if (depth > 4) return "[nested form data]";
    if (typeof value === "string") return value.length > 60000 ? "[large signature/image omitted from central copy]" : value;
    if (Array.isArray(value)) return value.slice(0, 20000).map(item => compactValue(item, depth + 1));
    if (value && typeof value === "object") {
      const output = {};
      Object.keys(value).slice(0, 20000).forEach(key => { output[key] = compactValue(value[key], depth + 1); });
      return output;
    }
    return value;
  }

  function formSnapshot(form) {
    const output = {};
    Array.from(form.elements || []).forEach(element => {
      const name = String(element.name || "").trim();
      if (!name || element.disabled || element.type === "file") return;
      if ((element.type === "checkbox" || element.type === "radio") && !element.checked) return;
      const value = element.type === "checkbox" ? (element.value || true) : element.value;
      if (output[name] === undefined) output[name] = value;
      else output[name] = Array.isArray(output[name]) ? output[name].concat([value]) : [output[name], value];
    });
    form.querySelectorAll("canvas").forEach((canvas, index) => {
      output["signature_" + index] = "[electronic signature retained on the source form]";
    });
    return compactValue(output, 0);
  }

  function valueOf(form, names) {
    for (const name of names) {
      const element = form.elements?.[name] || form.querySelector('[name="' + name + '"]');
      if (element && String(element.value || "").trim()) return String(element.value).trim();
    }
    return "";
  }

  function formTitle(form) {
    const dispatchTitles = { daily: "Daily Operations Report", load33: "33 kV Feeders Load Flow", load11: "11 kV Feeders Load Flow", jha: "Job Hazard Analysis / Risk Assessment", toolbox: "Tool Box Talk Report", of1: "Application for Protection Guarantee", of2: "Work Permit", of3: "Work and Test Permit", of4: "Station Guarantee", of17: "Order to Operate", of19: "Trouble and Repair Report" };
    return String(form.querySelector(".form-head h2, .form-title h2, .form-headline h2, h2, .form-header h3:last-child")?.textContent || dispatchTitles[form.getAttribute("data-form")] || document.title || "KEDCO e-form").replace(/ +/g, " ").trim().slice(0, 240);
  }

  function formCode(form, title) {
    const explicit = String(form.getAttribute("data-form") || form.getAttribute("data-form-code") || form.getAttribute("data-form-type") || "").trim();
    if (explicit) return explicit.toLowerCase().slice(0, 160);
    return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 160) || "kedco-eform";
  }

  function referenceFor(form, data) {
    let reference = valueOf(form, ["reference", "formReference", "ref"]);
    if (!reference) reference = String(data.reference || "").trim();
    if (!reference) reference = "KD-EFORM-" + new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14) + "-" + Math.random().toString(36).slice(2, 7).toUpperCase();
    const input = form.elements?.reference || form.querySelector('[name="reference"]');
    if (input && !input.value) input.value = reference;
    return reference;
  }

  function recipientFor(form) {
    let role = valueOf(form, ["dispatchTo", "sendRecipientRole"]);
    let region = valueOf(form, ["dispatchRegion", "sendRecipientOffice"]);
    const other = valueOf(form, ["dispatchOther", "sendRecipientOther"]);
    const department = valueOf(form, ["department", "receivingDepartment", "receiving_department"]);
    if (department && formCode(form, formTitle(form)) === "of19") role = troubleRecipient(department);
    region = valueOf(form, ['centralRecipientRegion']);
    const person = valueOf(form, ['centralRecipientPerson']);
    if (person) role = 'person:' + person;
    const station = valueOf(form, ['centralRecipientStation']);
    const recipient = role === "Other" ? other : region && !role.toUpperCase().includes("CTO") ? role + " - " + region : role;
    return { role, region, station, other, recipient: recipient || other || role };
  }

  function troubleRecipient(department) {
    return department === 'PC&M' ? 'Head PC & M' : department === 'O&M' ? 'Head O & M' : department;
  }

  function syncTroubleRecipient(event) {
    const select = event.target;
    const form = select.closest?.('form[data-form="of19"]');
    if (!form) return;
    const department = form.querySelector('[data-trouble-dept]');
    const recipient = form.querySelector('[name="dispatchTo"], [name="sendRecipientRole"]');
    if (!department || !recipient) return;
    if (select === department) recipient.value = troubleRecipient(department.value);
    else if (select === recipient && recipient.value) {
      department.value = recipient.value;
      department.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function statusElement(form) {
    return form.querySelector("[data-status], [data-send-status]");
  }

  function setFormStatus(form, message, failed) {
    const status = statusElement(form);
    if (!status) return;
    const dispatchStyle = status.classList.contains("dispatch-status") || status.hasAttribute("data-send-status");
    status.className = dispatchStyle ? "dispatch-status " + (failed ? "error" : "sent") : "status-banner " + (failed ? "warn" : "ok");
    status.textContent = message;
  }

  function ensureRecipientOptions() {
    document.querySelectorAll('select[name="dispatchTo"], select[name="sendRecipientRole"], select[data-forward-role], select[data-trouble-dept]').forEach(select => {
      RECIPIENT_OPTIONS.forEach(label => {
        if ([...select.options].some(option => option.value === label || option.textContent.trim() === label)) return;
        const option = document.createElement("option");
        option.value = label;
        option.textContent = label;
        select.appendChild(option);
      });
      personnel.forEach(person => {
        const value = 'person:' + person.id;
        if ([...select.options].some(option => option.value === value)) return;
        const option = document.createElement('option');
        option.value = value;
        option.textContent = person.full_name + ' — ' + person.primary_role.replace(/_/g, ' ') + ' — ' + person.email;
        select.appendChild(option);
      });
    });
    ensureRegionalSelectors();
  }

  async function centralSend(form, button) {
    if (button.dataset.centralSending === "true") return;
    if (typeof form.reportValidity === "function" && !form.reportValidity()) return;
    button.dataset.centralSending = "true";
    button.disabled = true;
    const data = formSnapshot(form);
    const title = formTitle(form);
    const recipient = recipientFor(form);
    const recipientRegion = recipientRegions.find(region => region.id === recipient.region || region.name === recipient.region);
    const selectedOffice = valueOf(form, ["dispatchTo", "sendRecipientRole"]);
    const reBlock = regionalReBlock(selectedOffice || recipient.role, recipientRegion, String(recipient.role || '').startsWith('person:') ? recipient.role.slice(7) : '');
    if (reBlock) {
      setFormStatus(form, reBlock, true);
      button.disabled = false;
      delete button.dataset.centralSending;
      return;
    }
    if (!recipient.role || (recipient.role === "Other" && !recipient.other)) {
      setFormStatus(form, "Select a Head, RE, TE or CTO recipient before sending.", true);
      button.disabled = false;
      delete button.dataset.centralSending;
      return;
    }
    const reference = referenceFor(form, data);
    const client = getClient();
    if (!client) {
      setFormStatus(form, "Central KEDCO workflow is unavailable. The form was not sent and remains editable.", true);
      button.disabled = false;
      delete button.dataset.centralSending;
      return;
    }
    setFormStatus(form, "Sending to the authenticated central KEDCO register...", false);
    let result;
    try { result = await client.rpc("kedco_send_central_eform", {
      requested_reference: reference,
      requested_form_code: formCode(form, title),
      requested_form_title: title,
      requested_recipient_role: recipient.role,
      requested_recipient: recipient.recipient,
      requested_recipient_office: recipient.region,
      requested_recipient_region: recipient.region || null,
      requested_recipient_station: recipient.station || null,
      requested_note: valueOf(form, ["dispatchNote", "sendNote"]),
      requested_region: valueOf(form, ["region"]),
      requested_state: valueOf(form, ["state"]),
      requested_source_page: pageName(),
      requested_copy_record_id: reference,
      requested_payload: data,
      requested_form_document: await prepareFormDocument(form)
    }); } catch (error) {
      setFormStatus(form, "Central send failed: " + (error?.message || "authenticated workflow unavailable") + ". The form remains editable; retry.", true);
      button.disabled = false;
      delete button.dataset.centralSending;
      return;
    }
    if (result.error || !result.data?.ok || !result.data?.record) {
      setFormStatus(form, "Central send failed: " + (result.error?.message || "the register did not confirm delivery") + ". The form remains editable; retry.", true);
      button.disabled = false;
      delete button.dataset.centralSending;
      return;
    }
    try {
      if (typeof button.onclick === "function") button.onclick.call(button);
    } catch (error) {
      console.warn("[KEDCO central e-form] local copy could not be saved", error);
    }
    const saved = result.data.record;
    setFormStatus(form, "CENTRAL SENT - " + saved.reference + " - Copy recorded. Track receipt, work status and approval in the central workflow panel.", false);
    button.disabled = false;
    delete button.dataset.centralSending;
    void refresh();
  }

  function panelMarkup() {
    const register = REGISTER_PAGES.has(pageName());
    return '<section id="kedcoCentralEformPanel" class="kedco-central-eform-panel">' +
      '<div class="kedco-central-eform-head"><div><span class="kedco-central-kicker">LIVE CENTRAL E-FORM REGISTER</span><h2>' +
      "KEDCO TECHNICAL OPERATIONAL WORK FLOW" +
      '</h2><p>Authenticated copies are searchable by reference and remain available for future technical review.</p></div>' +
      '<div class="kedco-central-tools"><input data-central-search placeholder="Search reference, form, sender, recipient...">' + (register ? '<button type="button" data-central-open-forms>Open E-Forms</button>' : '') + '<button type="button" data-central-refresh>Refresh</button></div></div>' +
      '<nav class="kedco-central-boxes" aria-label="Workflow folders"><button type="button" data-central-box="all">My workflow</button><button type="button" data-central-box="sent">Sent</button><button type="button" data-central-box="inbox">Received</button>' + (register ? '<button type="button" data-central-box="register">Central register</button>' : '') + '</nav><div class="kedco-central-status" data-central-status>Connecting to central KEDCO workflow...</div>' +
      '<div class="kedco-central-table-wrap"><table class="kedco-central-table"><thead><tr><th>Reference / copy</th><th>Form</th><th>Sender</th><th>Recipient</th><th>Sent</th><th>Work / approval</th><th>Feedback</th><th>Action</th></tr></thead><tbody data-central-rows><tr><td colspan="8" class="kedco-central-empty">Loading central records...</td></tr></tbody></table></div></section>';
  }

  function ensureStyles() {
    if (document.getElementById("kedcoCentralEformStyles")) return;
    const style = document.createElement("style");
    style.id = "kedcoCentralEformStyles";
    style.textContent = ".kedco-central-eform-panel{margin:18px 26px 30px;padding:18px;background:#fff;border:1px solid #cfdceb;border-radius:16px;box-shadow:0 10px 28px rgba(7,35,76,.08);color:#172033}.kedco-central-eform-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:12px}.kedco-central-eform-head h2{margin:4px 0 5px;color:#061b3a;font-size:19px}.kedco-central-eform-head p{margin:0;color:#64748b;font-size:10px;line-height:1.55}.kedco-central-kicker{font-size:9px;font-weight:1000;letter-spacing:.13em;color:#0a62b8}.kedco-central-tools{display:flex;gap:8px;align-items:center}.kedco-central-tools input{min-width:270px;border:1px solid #c9d7e7;border-radius:8px;padding:8px 10px;font-size:10px}.kedco-central-tools button{border:1px solid #c9d7e7;background:#f7fbff;color:#0a4386;border-radius:8px;padding:8px 11px;font-size:10px;font-weight:900}.kedco-central-status{padding:8px 10px;border-radius:8px;background:#eef4fa;color:#53657a;font-size:9px;margin-bottom:10px}.kedco-central-status.ok{background:#eaf8f0;color:#087044}.kedco-central-status.error{background:#fff0f1;color:#982131}.kedco-central-table-wrap{overflow:auto;border:1px solid #d9e2ee;border-radius:10px;max-height:500px}.kedco-central-table{width:100%;border-collapse:collapse;min-width:1100px}.kedco-central-table th{padding:9px 10px;background:#092f63;color:#fff;text-align:left;font-size:9px;white-space:nowrap}.kedco-central-table td{padding:9px 10px;border-bottom:1px solid #e6edf5;vertical-align:top;font-size:9px}.kedco-central-table tr:hover td{background:#f8fbff}.kedco-central-empty{text-align:center!important;color:#64748b;padding:24px!important}.kedco-central-ref{font-weight:1000;color:#0a4386;white-space:nowrap}.kedco-central-sub{display:block;color:#64748b;font-size:8px;margin-top:3px;line-height:1.4}.kedco-central-badge{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:8px;font-weight:1000;background:#edf3fb;color:#174a82;white-space:nowrap}.kedco-central-badge.approved,.kedco-central-badge.completed{background:#eaf8f0;color:#087044}.kedco-central-badge.returned{background:#fff0f1;color:#982131}.kedco-central-badge.received,.kedco-central-badge.in-review{background:#fff6d8;color:#805900}.kedco-central-feedback{max-width:240px;color:#53657a;line-height:1.4}.kedco-central-actions{display:flex;gap:4px;flex-wrap:wrap;min-width:180px}.kedco-central-actions button{border:1px solid #c9d7e7;background:#fff;border-radius:6px;padding:5px 7px;color:#174a82;font-size:8px;font-weight:900}.kedco-central-actions button[data-central-action=\"RETURNED\"]{color:#982131;background:#fff7f7}@media(max-width:700px){.kedco-central-eform-panel{margin:14px 12px 24px;padding:13px}.kedco-central-eform-head{display:block}.kedco-central-tools{margin-top:10px}.kedco-central-tools input{min-width:0;flex:1}}";
    style.textContent += '.kedco-routing-choices{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:12px 0;grid-column:1/-1}.kedco-routing-choices label,.kedco-eform-actions label{display:flex;flex-direction:column;gap:5px;font-size:13px}.kedco-routing-choices select,.kedco-eform-actions select,.kedco-eform-actions textarea{box-sizing:border-box;width:100%;min-height:38px;border:1px solid #b6c7d8;border-radius:6px;padding:8px;background:white;color:#172333}.kedco-routing-choices p{grid-column:1/-1;font-size:12px}.kedco-eform-actions{border:1px solid #b6c7d8;border-radius:8px;margin:16px 0;padding:16px}.kedco-eform-actions button,.kedco-central-boxes button{padding:9px 14px;margin:8px 8px 8px 0;cursor:pointer}.kedco-central-boxes [aria-pressed=true]{background:#073965;color:white}';
    document.head.appendChild(style);
  }

  function dateText(value) {
    const stamp = Date.parse(String(value || ""));
    return Number.isNaN(stamp) ? "-" : new Date(stamp).toLocaleString();
  }

  function statusClass(status) {
    return String(status || "SENT").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  function openRecord(id, suppliedRow) {
    const row = suppliedRow || rows.find(item => String(item.id) === String(id)) || pendingAlerts.find(item => String(item.id) === String(id));
    if (!row) return;
    document.getElementById("kedcoEformDetails")?.remove();
    const dialog = document.createElement("dialog");
    dialog.id = "kedcoEformDetails";
    dialog.style.cssText = "box-sizing:border-box;width:min(1100px,calc(100vw - 32px));max-width:1100px;height:min(90dvh,900px);max-height:90dvh;overflow:auto;border:1px solid #087f5b;border-radius:12px;padding:16px;overscroll-behavior:contain";
    dialog.innerHTML = '<h2>' + esc(row.form_title || row.form_code) + '</h2><p>Reference: ' + esc(row.reference) +
      '</p><p>From: ' + esc(row.sender_name) + ' — To: ' + esc(row.recipient) + '</p><p>' + esc(row.note || '') + '</p>' +
      '<p>Status: <strong>' + esc(row.status || 'SENT') + '</strong>' + (row.feedback ? ' - ' + esc(row.feedback) : '') + '</p>' +
      '<div data-eform-preview></div>' +
      (row.can_update ? '<fieldset class="kedco-eform-actions"><legend>Act on this e-form</legend><label>Action <select data-detail-action>' +
        (row.source_type === 'OPERATOR_WORKFLOW' ? (row.pending_task ? '<option value="APPROVED">Approve current step</option><option value="RETURNED">Return to sender</option>' : '') : '<option value="RECEIVED">Acknowledge receipt</option><option value="IN_REVIEW">In review</option><option value="APPROVED">Approve</option><option value="RETURNED">Return to sender</option><option value="COMPLETED">Complete</option>') +
        '</select></label><label>Feedback <textarea data-detail-feedback></textarea></label><button type="button" data-detail-save>Save action</button><p data-detail-status role="status"></p></fieldset>' : '') +
      (row.route_history?.length ? '<h3>Routing history</h3><ul>' + row.route_history.map(step => '<li>' + esc(step.from) + ' → ' + esc(step.to) + ' — ' + esc(step.by) + ' (' + esc(dateText(step.at)) + ')</li>').join('') + '</ul>' : '') +
      ((row.can_forward || row.can_update) ? '<fieldset class="kedco-eform-actions"><legend>Forward this e-form</legend><label>Recipient <select data-forward-role><option value="">Select recipient</option>' + RECIPIENT_OPTIONS.map(label => '<option>' + esc(label) + '</option>').join('') + '</select></label><label>Office / region details <input data-forward-office></label><label>Instructions <textarea data-forward-note></textarea></label><button type="button" data-forward-send>Send to next office</button><p data-forward-status role="status"></p></fieldset>' : '') +
      (row.source_type === 'OPERATOR_WORKFLOW' || row.related_workflow_submission_id ? '<p>This form is linked to an approval workflow. Forwarding sends a copy for action; the current approval step remains with its authorised office.</p>' : '') +
      '<div data-detail-footer style="position:sticky;bottom:-16px;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;background:#fff;border-top:1px solid #dbe4ec;padding:12px 0 0;margin-top:16px;z-index:2">' +
      '<button type="button" data-detail-close>Close</button>' +
      ((row.can_forward || row.can_update) ? '<button type="button" data-detail-bottom-forward style="border:1px solid #087c5e;background:#087c5e;color:#fff;border-radius:7px;padding:8px 12px;font-weight:800;cursor:pointer">Forward to next personnel</button>' : '') +
      '<button type="button" data-detail-bottom-close style="border:1px solid #b8c7d4;background:#fff;color:#173d68;border-radius:7px;padding:8px 12px;font-weight:800;cursor:pointer">Close e-form</button></div>';
    document.body.appendChild(dialog);
    const closeButton = dialog.querySelector('[data-detail-close]');
    closeButton.style.cssText = 'float:right;position:sticky;top:0;z-index:1';
    dialog.prepend(closeButton);
    attachPreview(dialog.querySelector('[data-eform-preview]'), row, '75vh');
    ensureRecipientOptions();
    dialog.querySelector('[data-detail-close]').addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-detail-bottom-close]')?.addEventListener('click', () => dialog.close());
    dialog.querySelector('[data-detail-bottom-forward]')?.addEventListener('click', () => {
      const fieldset = dialog.querySelector('[data-forward-role]')?.closest('fieldset');
      fieldset?.scrollIntoView({behavior: 'smooth', block: 'center'});
      dialog.querySelector('[data-forward-role]')?.focus({preventScroll: true});
    });
    const actionButton = dialog.querySelector('[data-detail-save]');
    actionButton?.addEventListener('click', async () => {
      const action = dialog.querySelector('[data-detail-action]').value;
      const feedback = dialog.querySelector('[data-detail-feedback]').value.trim();
      const status = dialog.querySelector('[data-detail-status]');
      if (!action) { status.textContent = 'There is no pending action for this record.'; return; }
      if (action === 'RETURNED' && !feedback) { status.textContent = 'Enter the reason for returning this form.'; return; }
      actionButton.disabled = true; status.textContent = 'Saving action...';
      try { await saveAction(row, action, feedback); await refresh(); status.textContent = 'Saved: ' + action.replace(/_/g, ' '); }
      catch (error) { status.textContent = error.message || 'The action could not be saved.'; }
      finally { actionButton.disabled = false; }
    });
    const forward = dialog.querySelector('[data-forward-send]');
    let requestId = "";
    forward?.addEventListener('click', async () => {
      const officeRole = dialog.querySelector('[data-forward-role]').value;
      const person = dialog.querySelector('[data-recipient-person]')?.value;
      const role = person ? 'person:' + person : officeRole;
      const status = dialog.querySelector('[data-forward-status]');
      if (!role) { status.textContent = 'Select a recipient office.'; return; }
      const receivingRegion = dialog.querySelector('[data-recipient-region]')?.value || '';
      const receivingRegionRow = recipientRegions.find(region => region.id === receivingRegion || region.name === receivingRegion);
      const reBlock = regionalReBlock(officeRole, receivingRegionRow, person || '');
      if (reBlock) { status.textContent = reBlock; return; }
      if (!requestId) requestId = global.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2);
      forward.disabled = true;
      status.textContent = 'Sending to the next office...';
      try {
        const result = await getClient().rpc('kedco_forward_central_eform', {
          requested_id: row.id, requested_recipient_role: role,
          requested_recipient_office: recipientRegions.find(region => region.id === receivingRegion)?.name || '',
          requested_recipient_region: receivingRegion || null,
          requested_recipient_station: dialog.querySelector('[data-recipient-station]')?.value || '',
          requested_note: dialog.querySelector('[data-forward-note]').value,
          requested_request_id: requestId
        });
        if (result.error || !result.data?.ok) throw new Error(result.error?.message || 'Delivery was not confirmed.');
        status.textContent = 'Forwarded to ' + result.data.record.recipient + '. The original form and routing history were retained.';
        await refresh();
      } catch (error) { status.textContent = error.message || 'Send failed. Please retry.'; forward.disabled = false; }
    });
    dialog.showModal();
    dialog.addEventListener('close', () => dialog.remove(), {once:true});
  }

  function setPanelStatus(message, type) {
    const target = document.querySelector("[data-central-status]");
    if (!target) return;
    target.className = "kedco-central-status" + (type ? " " + type : "");
    target.textContent = message;
  }

  function renderRows() {
    const target = document.querySelector("[data-central-rows]");
    if (!target) return;
    const query = filterText.toLowerCase();
    const visible = rows.filter(row => !query || [row.reference,row.form_title,row.form_code,row.sender_name,row.recipient,row.recipient_region_name,row.recipient_station,row.status].join(' ').toLowerCase().includes(query));
    if (!visible.length) {
      target.innerHTML = '<tr><td colspan="8" class="kedco-central-empty">No central records match this search.</td></tr>';
      return;
    }
    target.innerHTML = visible.map(row => {
      const status = String(row.status || "SENT").toUpperCase();
      const managed = row.source_type === "OPERATOR_WORKFLOW";
      let actions = row.can_update && !managed ? '<div class="kedco-central-actions"><button type="button" data-central-action="RECEIVED" data-central-id="' + esc(row.id) + '">Acknowledge</button><button type="button" data-central-action="IN_REVIEW" data-central-id="' + esc(row.id) + '">In review</button><button type="button" data-central-action="APPROVED" data-central-id="' + esc(row.id) + '">Approve</button><button type="button" data-central-action="RETURNED" data-central-id="' + esc(row.id) + '">Return</button><button type="button" data-central-action="COMPLETED" data-central-id="' + esc(row.id) + '">Complete</button></div>' : '<span class="kedco-central-sub">' + (managed ? "Managed by the authorized workflow" : "Awaiting recipient feedback") + "</span>";
      actions = '<button type="button" data-central-open="' + esc(row.id) + '">Open form' + (row.can_forward || row.can_update ? ' / Act / Forward' : '') + '</button>' + actions;
      return "<tr><td><span class=\"kedco-central-ref\">" + esc(row.reference) + "</span><span class=\"kedco-central-sub\">Copy: " + esc(row.copy_record_id || row.id || "-") + "</span></td><td><b>" + esc(row.form_title || row.form_code || "KEDCO e-form") + "</b><span class=\"kedco-central-sub\">" + esc(row.form_code || "") + "</span></td><td><b>" + esc(row.sender_name || row.sender_email || "-") + "</b><span class=\"kedco-central-sub\">" + esc(row.sender_email || "") + "</span></td><td><b>" + esc(row.recipient || row.recipient_role || "-") + "</b><span class=\"kedco-central-sub\">" + esc(row.region || row.state || "") + "</span></td><td>" + esc(dateText(row.sent_at || row.created_at)) + "</td><td><span class=\"kedco-central-badge " + statusClass(status) + "\">" + esc(status) + "</span></td><td class=\"kedco-central-feedback\">" + esc(row.feedback || "No feedback yet.") + (row.feedback_by_name ? "<span class=\"kedco-central-sub\">By " + esc(row.feedback_by_name) + " - " + esc(dateText(row.feedback_at)) + "</span>" : "") + "</td><td>" + actions + "</td></tr>";
    }).join("");
  }

  async function refresh() {
    const client = getClient();
    if (!client) { setPanelStatus("Central KEDCO client is unavailable.", "error"); return; }
    setPanelStatus("Refreshing live central records...");
    const result = await client.rpc("kedco_list_central_eforms", { requested_box: box, requested_source_page: pageName() });
    if (result.error) { setPanelStatus(result.error.message || "Central register could not be loaded.", "error"); return; }
    rows = Array.isArray(result.data) ? result.data : [];
    document.querySelectorAll('[data-central-box]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.centralBox === box)));
    renderRows();
    setPanelStatus(rows.length + " central record" + (rows.length === 1 ? "" : "s") + " loaded. Updates are shared across authorised pages.", "ok");
  }

  async function saveAction(row, action, feedback) {
    const managed = row.source_type === 'OPERATOR_WORKFLOW';
    if (managed && !row.pending_task) throw new Error('There is no pending approval step. Refresh the workflow.');
    const result = await getClient().rpc(managed ? 'kedco_approve_workflow_task' : 'kedco_update_central_eform', managed ? {
      requested_submission_id: row.source_workflow_submission_id, requested_task_code: row.pending_task.step_code,
      requested_decision: action === 'APPROVED' ? 'APPROVE' : 'REJECT', requested_comment: feedback
    } : {requested_id: row.id, requested_status: action, requested_feedback: feedback});
    if (result.error || !result.data?.ok) throw new Error(result.error?.message || 'The action was not saved.');
  }

  async function updateRecord(id, action) {
    const row = rows.find(item => String(item.id) === String(id));
    if (!row) return;
    let feedback = "";
    if (action === "RETURNED") {
      feedback = global.prompt("Enter the reason / feedback to return this e-form:", "Please correct and resubmit:") || "";
      if (!feedback.trim()) return;
    } else if (action === "APPROVED" || action === "COMPLETED") {
      feedback = global.prompt("Optional feedback for the sender:", "") || "";
    }
    setPanelStatus("Saving " + action.toLowerCase() + " feedback for " + row.reference + "...");
    const result = await getClient().rpc("kedco_update_central_eform", { requested_id: id, requested_status: action, requested_feedback: feedback });
    if (result.error) { setPanelStatus(result.error.message || "Feedback could not be saved.", "error"); return; }
    await refresh();
  }

  function ensureFormSendButton() {
    if (isLegacyRetePage()) return;
    const submit = document.getElementById("submitForm");
    const form = document.querySelector("#formCanvas form");
    const toolbar = submit?.closest(".toolbar");
    if (!submit || !form || !toolbar) return;
    if (!form.querySelector('[name="dispatchTo"], [name="sendRecipientRole"]')) {
      const controls = document.createElement("fieldset");
      controls.setAttribute("data-central-routing", "");
      controls.innerHTML = '<legend>Send this e-form</legend><label>Recipient office <select name="dispatchTo"><option value="">Select recipient</option>' +
        RECIPIENT_OPTIONS.map(label => '<option>' + esc(label) + '</option>').join('') +
        '</select></label><label>Office / region details <input name="dispatchRegion" placeholder="Office or region for the receiving team"></label>' +
        '<label>Routing note <textarea name="dispatchNote"></textarea></label><div data-status role="status"></div>';
      form.appendChild(controls);
    }
    if (toolbar.querySelector("[data-central-form-send]") || form.querySelector("[data-send]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "primary small";
    button.dataset.send = "";
    button.dataset.centralFormSend = "1";
    button.title = "Send this completed e-form to the authenticated Central KEDCO register";
    button.textContent = "Send to Central Register";
    toolbar.appendChild(button);
  }

  function bindPanel() {
    document.querySelectorAll('[data-central-box]').forEach(button => button.addEventListener('click', () => {
      box = button.dataset.centralBox; void refresh();
    }));
    document.querySelector("[data-central-refresh]")?.addEventListener("click", () => { void refresh(); });
    document.querySelector("[data-central-open-forms]")?.addEventListener("click", () => {
      if (typeof global.showView === "function") global.showView("forms");
      else document.querySelector('[data-view="forms"]')?.click();
    });
    document.querySelector("[data-central-search]")?.addEventListener("input", event => { filterText = event.target.value || ""; renderRows(); });
    document.querySelector("[data-central-rows]")?.addEventListener("click", event => {
      const open = event.target.closest("[data-central-open]");
      if (open) { openRecord(open.dataset.centralOpen); return; }
      const button = event.target.closest("[data-central-action]");
      if (button) void updateRecord(button.dataset.centralId, button.dataset.centralAction);
    });
  }

  function bindCapture() {
    if (isLegacyRetePage()) return;
    document.addEventListener("click", event => {
      const button = event.target.closest?.("[data-send]");
      if (!button || button.closest("#kedcoCentralEformPanel")) return;
      const form = button.closest("form") || document.querySelector("#formCanvas form");
      if (!form) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void centralSend(form, button);
    }, true);
  }

  function mount() {
    void loadPersonnel();
    document.addEventListener('change', syncTroubleRecipient);
    document.addEventListener('change', ensureRegionalSelectors);
    void checkIncoming();
    global.setInterval(() => { void checkIncoming(); }, 10000);
    document.addEventListener("visibilitychange", () => { void checkIncoming(); });
    ensureRecipientOptions();
    if (!document.getElementById("kedcoCentralEformPanel")) {
      ensureStyles();
      const registerHost = REGISTER_PAGES.has(pageName()) ? document.querySelector("#view-register") : null;
      const host = registerHost || document.querySelector("main.main, .main, main") || document.body;
      host.insertAdjacentHTML("beforeend", panelMarkup());
      box = REGISTER_PAGES.has(pageName()) ? "register" : "all";
      bindPanel();
      void refresh();
    }
    ensureFormSendButton();
    bindCapture();
    const observer = new MutationObserver(() => { ensureRecipientOptions(); ensureFormSendButton(); });
    observer.observe(document.body, { childList: true, subtree: true });
    global.setInterval(() => { if (document.visibilityState !== "hidden") void refresh(); }, 10000);
  }

  global.KEDCO_CENTRAL_EFORM_WORKFLOW = { refresh, send: centralSend, captureFormDocument, prepareFormDocument, recipientFor, openRecord, previewSettled };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})(window);

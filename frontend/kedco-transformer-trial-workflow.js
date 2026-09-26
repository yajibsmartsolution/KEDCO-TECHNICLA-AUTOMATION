/* KEDCO Transformer Trial Request - shared local workflow */
(function (global) {
  'use strict';
  if (global.KEDCO_TRANSFORMER_TRIAL) return;

  const VOICE_KEY = 'KEDCO_TRANSFORMER_TRIAL_VOICE_V1';
  const STYLE_ID = 'kedco-transformer-trial-style';
  const MODAL_ID = 'kedco-transformer-trial-modal';
  const REVIEWER_ROLES = new Set(['HEAD_PCM', 'SUPER_ADMIN', 'CTO', 'TA_CTO', 'HEAD_TECHNICAL']);
  let client = null;
  let roles = new Set();
  let regions = [];
  let personnel = [];
  let rows = [];
  let open = false;
  let polling = null;
  let knownStatus = new Map();
  let initialPoll = true;

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  const text = value => String(value ?? '').trim();
  const shortReference = value => { const raw = text(value); const suffix = raw.split('-').pop(); return suffix ? 'TR-' + suffix.toUpperCase() : raw; };
  const pageName = () => String(global.location?.pathname || '').split('/').pop().toLowerCase();
  const formatDate = value => { const stamp = Date.parse(value || ''); return Number.isNaN(stamp) ? '—' : new Date(stamp).toLocaleString(); };
  const isReviewer = () => [...REVIEWER_ROLES].some(role => roles.has(role));
  const voiceEnabled = () => { try { return localStorage.getItem(VOICE_KEY) !== '0'; } catch (_) { return true; } };
  const setVoice = value => { try { localStorage.setItem(VOICE_KEY, value ? '1' : '0'); } catch (_) {} };
  const announce = message => {
    if (!voiceEnabled() || !('speechSynthesis' in global)) return;
    try { global.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(message); utterance.rate = 0.92; utterance.pitch = 1; global.speechSynthesis.speak(utterance); } catch (_) {}
  };
  const api = () => client || (client = global.supabase?.createClient?.());
  const call = async (name, args = {}) => {
    const current = api();
    if (!current) throw new Error('KEDCO local data client is not available.');
    const result = await current.rpc(name, args);
    if (result.error) throw result.error;
    return result.data;
  };
  const regionOptions = () => regions.map(region => `<option value="${esc(region.id)}">${esc(region.name)}</option>`).join('');
  const uniqueText = values => [...new Set((values || []).map(value => text(value)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const pageNetworkData = () => {
    const injectionStations = typeof INJECTION_STATIONS !== 'undefined' && Array.isArray(INJECTION_STATIONS) ? INJECTION_STATIONS : [];
    const transmissionFeeders = typeof TRANSMISSION_FEEDERS !== 'undefined' && Array.isArray(TRANSMISSION_FEEDERS) ? TRANSMISSION_FEEDERS : [];
    const feederRows33 = typeof KEDCO_33KV_EFORM_ROWS !== 'undefined' && Array.isArray(KEDCO_33KV_EFORM_ROWS) ? KEDCO_33KV_EFORM_ROWS : [];
    const feederRows11 = typeof KEDCO_11KV_EFORM_ROWS !== 'undefined' && Array.isArray(KEDCO_11KV_EFORM_ROWS) ? KEDCO_11KV_EFORM_ROWS : [];
    return {
      stations: injectionStations.flatMap(row => [row.station, ...(row.destinations || [])]),
      feeders33: [
        ...transmissionFeeders.map(row => row.name),
        ...feederRows33.map(row => row.feeder),
        ...injectionStations.flatMap(row => (row.other33 || []).map(pair => pair[0]))
      ],
      feeders11: [
        ...injectionStations.flatMap(row => (row.feeders || []).map(pair => pair[0])),
        ...feederRows11.filter(row => /^\s*11\s*KV\b/i.test(String(row.feeder || ''))).map(row => String(row.feeder).replace(/^\s*11\s*KV\s*/i, ''))
      ]
    };
  };
  const trialNetwork = () => {
    const base = global.KEDCO_TRANSFORMER_TRIAL_NETWORK || {};
    const page = pageNetworkData();
    return {
      stations: uniqueText([...(base.stations || []), ...page.stations]),
      feeders33: uniqueText([...(base.feeders33 || []), ...page.feeders33]).filter(name => !/^ON\s+SOAK$/i.test(name)),
      feeders11: uniqueText([...(base.feeders11 || []), ...page.feeders11])
    };
  };
  const trialStationOptions = () => {
    const stations = trialNetwork().stations;
    return `<option value="">Select station / injection substation</option>${stations.map(station => `<option value="${esc(station)}">${esc(station)}</option>`).join('')}`;
  };
  const trialFeederOptions = () => {
    const network = trialNetwork();
    return `<option value="" disabled>Select one or more affected feeders / circuits</option><optgroup label="33 kV feeders / circuits">${network.feeders33.map(feeder => `<option value="33 kV ${esc(feeder)}">33 kV — ${esc(feeder)}</option>`).join('')}</optgroup><optgroup label="11 kV feeders / circuits">${network.feeders11.map(feeder => `<option value="11 kV ${esc(feeder)}">11 kV — ${esc(feeder)}</option>`).join('')}</optgroup>`;
  };
  const TRIP_CAUSES = Object.freeze([
    'Over Current (50/51)',
    'Earth Fault (50N/51N)',
    'Over Current and Earth Fault',
    'Restricted Earth Fault (REF)',
    'Differential Protection',
    'Buchholz Relay',
    'Winding / Oil Temperature Protection',
    'Pressure Relief / Sudden Pressure Relay',
    'Low Oil Level Alarm / Trip',
    'Breaker Failure / Circuit Breaker Trip',
    'No Relay Indication',
    'Relay Indication Not Available',
    'External / Downstream Fault',
    'Manual / Operator Initiated Trip',
    'Unknown / Under Investigation',
    'Other Protection Indication'
  ]);
  const trialCauseOptions = () => '<option value="">Select trip cause / protection indication</option>' + TRIP_CAUSES.map(cause => '<option value="' + esc(cause) + '">' + esc(cause) + '</option>').join('');
  const RISK_CONDITIONS = Object.freeze([
    'Normal condition - no known restriction',
    'Standby supply available',
    'Restricted supply / no alternate source',
    'High load / limited reserve',
    'Transformer oil low / oil attention required',
    'Oil leak or abnormal oil level',
    'Protection reset / lockout under investigation',
    'Field maintenance or safety clearance required',
    'Cooling fan / pump unavailable',
    'Manual monitoring required during trial',
    'Other risk condition'
  ]);
  const trialRiskOptions = () => '<option value="">Select risk / trial condition</option>' + RISK_CONDITIONS.map(condition => '<option value="' + esc(condition) + '">' + esc(condition) + '</option>').join('');  const FORWARD_INSTRUCTIONS = Object.freeze([
    'Add transformer oil before trial',
    'Check transformer oil level and top up to approved level before trial',
    'Test transformer oil quality / dielectric strength before trial',
    'Inspect and repair oil leaks before trial',
    'Check Buchholz relay, alarm and trip contacts before trial',
    'Reset protection relay / lockout only after fault clearance',
    'Complete insulation resistance and winding resistance tests',
    'Inspect bushings, cables, terminations and connections',
    'Verify tap changer position and mechanical operation',
    'Confirm cooling fan / pump operation before trial',
    'Perform visual inspection and record pre-trial readings',
    'Obtain field maintenance and safety clearance before trial',
    'Investigate and clear the original fault before trial',
    'Do not attempt trial until Head PC&M conditions are completed',
    'Other approved pre-trial instruction'
  ]);
  const trialForwardInstructionOptions = () => '<option value="">Select required pre-trial action</option>' + FORWARD_INSTRUCTIONS.map(instruction => '<option value="' + esc(instruction) + '">' + esc(instruction) + '</option>').join('');
  const regionKey = value => text(value).toLowerCase().replace(/\s+/g, ' ');
  const globalRegionKey = value => ['all', 'all regions', 'global', 'head office', 'central'].includes(regionKey(value));
  const personnelAssignedToRegion = (person, regionId) => {
    const target = regions.find(region => String(region.id) === String(regionId));
    if (!target) return false;
    const values = [person?.region_id, person?.region_name].map(regionKey).filter(Boolean);
    if (!values.length || values.some(globalRegionKey)) return true;
    return values.includes(regionKey(target.id)) || values.includes(regionKey(target.name));
  };
  const personnelOptions = (regionId = '') => {
    if (!regionId) return '<option value="">Select forwarding region first</option>';
    const people = personnel.filter(person => person && person.id && personnelAssignedToRegion(person, regionId)).sort((a, b) => text(a.full_name || a.email).localeCompare(text(b.full_name || b.email)));
    if (!people.length) return '<option value="">No active personnel assigned to this region</option>';
    return '<option value="">Select KEDCO personnel</option>' + people.map(person => {
      const role = text(person.primary_role || (person.roles || [])[0]).replace(/_/g, ' ');
      const region = text(person.region_name);
      const label = text(person.full_name || person.email) + (role ? ' — ' + role : '') + (region ? ' — ' + region : '') + (person.email ? ' — ' + person.email : '');
      return '<option value="' + esc(person.id) + '">' + esc(label) + '</option>';
    }).join('');
  };  const statusClass = status => String(status || '').toLowerCase().replace(/[^a-z]+/g, '-');
  const showMessage = (message, kind = 'info') => {
    const host = document.querySelector(`#${MODAL_ID} [data-trial-message]`);
    if (host) { host.textContent = message; host.dataset.kind = kind; host.hidden = !message; }
  };

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${MODAL_ID}{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:20px;background:rgba(3,16,34,.72);backdrop-filter:blur(8px)}
      #${MODAL_ID}[hidden]{display:none}
      .kedco-trial-shell{width:min(1080px,100%);max-height:min(900px,94vh);overflow:auto;border:1px solid rgba(255,255,255,.2);border-radius:24px;background:linear-gradient(145deg,#082b4b,#071b35 58%,#062f37);color:#eef7ff;box-shadow:0 32px 90px rgba(0,0,0,.4);font:14px/1.45 Inter,Segoe UI,system-ui,sans-serif}
      .kedco-trial-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;padding:26px 30px 22px;background:radial-gradient(circle at 86% 8%,rgba(227,186,70,.25),transparent 28%),linear-gradient(120deg,#0b4162,#063b37);border-bottom:1px solid rgba(255,255,255,.14)}
      .kedco-trial-kicker{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#f2cc63;font-weight:800}.kedco-trial-head h2{margin:5px 0 6px;font-size:25px;line-height:1.1}.kedco-trial-head p{margin:0;color:#b8d2e5;max-width:700px}.kedco-trial-close{border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;border-radius:11px;width:38px;height:38px;font-size:22px;cursor:pointer}.kedco-trial-close:hover{background:rgba(255,255,255,.17)}
      .kedco-trial-body{padding:24px 30px 30px}.kedco-trial-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px}.kedco-trial-field{grid-column:span 6}.kedco-trial-field.wide{grid-column:1/-1}.kedco-trial-field label{display:block;margin:0 0 6px;color:#c8d9e7;font-size:12px;font-weight:800}.kedco-trial-field input,.kedco-trial-field select,.kedco-trial-field textarea,.kedco-trial-note{width:100%;box-sizing:border-box;border:1px solid #39627a;border-radius:10px;background:#061a31;color:#f4fbff;padding:11px 12px;outline:none}.kedco-trial-field textarea{min-height:76px;resize:vertical}.kedco-trial-field input:focus,.kedco-trial-field select:focus,.kedco-trial-field textarea:focus{border-color:#f0c64e;box-shadow:0 0 0 3px rgba(240,198,78,.12)}
      .kedco-trial-checks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;padding:12px;border:1px solid #294d67;border-radius:12px;background:rgba(0,0,0,.14)}.kedco-trial-checks label{display:flex;gap:8px;align-items:flex-start;color:#d8e8f2;font-weight:600;font-size:12px}.kedco-trial-checks input{accent-color:#d7ad39;margin-top:3px}
      .kedco-trial-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:18px}.kedco-trial-btn{border:0;border-radius:10px;padding:11px 15px;background:#d7ad39;color:#16243b;font-weight:900;cursor:pointer}.kedco-trial-btn:hover{filter:brightness(1.08);transform:translateY(-1px)}.kedco-trial-btn.secondary{background:#174e6c;color:#e4f4ff;border:1px solid #3d718b}.kedco-trial-btn.danger{background:#a9363e;color:#fff}.kedco-trial-btn:disabled{opacity:.55;cursor:not-allowed;transform:none}.kedco-trial-voice{display:flex;align-items:center;gap:7px;margin-left:auto;color:#c4dae6;font-size:12px}.kedco-trial-voice input{accent-color:#d7ad39}
      .kedco-trial-message{padding:11px 13px;border-radius:10px;margin-bottom:15px;background:#143a55;color:#d6efff;border:1px solid #2e6684}.kedco-trial-message[data-kind=success]{background:#123f36;border-color:#2b9977}.kedco-trial-message[data-kind=error]{background:#4a2229;border-color:#dc6973}.kedco-trial-message[hidden]{display:none}
      .kedco-trial-section{margin-top:25px}.kedco-trial-section h3{margin:0 0 5px;font-size:17px}.kedco-trial-section>p{margin:0 0 13px;color:#a9c6d7}.kedco-trial-table-wrap{overflow:auto;border:1px solid #294d67;border-radius:14px;background:rgba(0,0,0,.12)}.kedco-trial-table{width:100%;min-width:830px;border-collapse:collapse;font-size:12px}.kedco-trial-table th{background:#0e395a;color:#f0d275;text-align:left;padding:11px 10px;position:sticky;top:0}.kedco-trial-table td{padding:11px 10px;border-top:1px solid rgba(255,255,255,.09);vertical-align:top}.kedco-trial-status{display:inline-flex;padding:4px 8px;border-radius:999px;background:#244965;color:#d7ebf6;font-weight:800;font-size:10px;white-space:nowrap}.kedco-trial-status.pending-head-pcm{background:#805d1b;color:#fff2b0}.kedco-trial-status.approved{background:#176e50;color:#d6ffec}.kedco-trial-status.rejected,.kedco-trial-status.cancelled,.kedco-trial-status.tripped-again,.kedco-trial-status.failed{background:#792f37;color:#ffd9db}.kedco-trial-status.returned{background:#6e4e26;color:#ffe2a5}.kedco-trial-row-actions{display:flex;gap:6px;flex-wrap:wrap;min-width:220px}.kedco-trial-row-actions button{border:1px solid #4b7790;border-radius:8px;padding:7px 9px;background:#123f5c;color:#e9f6ff;font-weight:800;cursor:pointer}.kedco-trial-row-actions button.approve{background:#176e50;border-color:#3ab48a}.kedco-trial-row-actions button.reject{background:#792f37;border-color:#d65b66}.kedco-trial-row-actions button.result{background:#805d1b;border-color:#d7ad39}.kedco-trial-empty{text-align:center;color:#aac2d0;padding:28px!important}.kedco-trial-footnote{margin-top:16px;color:#8fabbc;font-size:11px}.kedco-trial-alert{animation:kedcoTrialPulse 1.5s ease-in-out}@keyframes kedcoTrialPulse{50%{box-shadow:0 0 0 5px rgba(215,173,57,.25)}}
      .kedco-trial-status.forwarded{background:#6c4c19;color:#fff2b0}.kedco-trial-row-actions button.forward{background:#6c4c19;border-color:#d7ad39;color:#fff2b0}.kedco-trial-forward{margin:18px 0 20px;padding:16px;border:1px solid #c79b35;border-radius:14px;background:linear-gradient(135deg,rgba(215,173,57,.12),rgba(10,43,73,.82));box-shadow:0 12px 30px rgba(0,0,0,.16)}.kedco-trial-forward h3{margin:0 0 4px;font-size:16px;color:#f3d779}.kedco-trial-forward p{margin:0 0 13px;color:#c5dae8;font-size:12px}.kedco-trial-forward-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}.kedco-trial-forward-field{display:grid;gap:5px}.kedco-trial-forward-field.wide{grid-column:1/-1}.kedco-trial-forward-field label{font-size:11px;font-weight:800;color:#c8d9e7}.kedco-trial-forward-field select,.kedco-trial-forward-field textarea{width:100%;box-sizing:border-box;border:1px solid #39627a;border-radius:10px;background:#061a31;color:#f4fbff;padding:10px 11px}.kedco-trial-forward-field textarea{min-height:70px;resize:vertical}.kedco-trial-forward-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}.kedco-trial-forward-summary{padding:9px 11px;border-radius:9px;background:rgba(0,0,0,.18);color:#d8e8f2;font-size:11px;margin-bottom:12px}.kedco-trial-forward-badge{display:inline-flex;padding:3px 7px;border-radius:999px;background:#805d1b;color:#fff2b0;font-size:10px;font-weight:800}      .kedco-trial-row-actions button.safety{background:#176e50;border-color:#3ab48a;color:#d6ffec}.kedco-trial-safety{margin:18px 0 20px;padding:16px;border:1px solid #3ab48a;border-radius:14px;background:linear-gradient(135deg,rgba(23,110,80,.18),rgba(10,43,73,.82));box-shadow:0 12px 30px rgba(0,0,0,.16)}.kedco-trial-safety h3{margin:0 0 4px;color:#b8f3d8;font-size:16px}.kedco-trial-safety p{margin:0 0 13px;color:#c5dae8;font-size:12px}.kedco-trial-safety .kedco-trial-checks{margin-top:12px}      .kedco-trial-field select[multiple]{min-height:142px;padding:7px}.kedco-trial-field-help{display:block;margin-top:6px;color:#8fb0c2;font-size:11px}.kedco-trial-feeder-chip{display:inline-flex;padding:3px 7px;border-radius:6px;background:#123f5c;color:#d9f0fc;font-size:11px}.kedco-trial-safety-pending{color:#f3d779;font-weight:800}.kedco-trial-safety-complete{color:#8fe1bd;font-weight:800}
      .kedco-trial-feeder-picker{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:12px;align-items:stretch;margin-top:8px}.kedco-trial-feeder-list{display:grid;gap:6px;min-width:0}.kedco-trial-feeder-list label{display:flex;justify-content:space-between;gap:8px;color:#c8d9e7;font-size:11px;font-weight:800}.kedco-trial-feeder-list select{width:100%;min-height:178px;box-sizing:border-box;border:1px solid #39627a;border-radius:10px;background:#061a31;color:#f4fbff;padding:7px}.kedco-trial-feeder-list select option{padding:5px 7px}.kedco-trial-feeder-controls{display:grid;align-content:center;gap:7px}.kedco-trial-feeder-btn{border:1px solid #d7ad39;border-radius:8px;padding:8px 10px;background:#d7ad39;color:#16243b;font-size:11px;font-weight:900;cursor:pointer}.kedco-trial-feeder-btn.secondary{background:#174e6c;border-color:#3d718b;color:#e4f4ff}.kedco-trial-feeder-btn:hover{filter:brightness(1.08);transform:translateY(-1px)}.kedco-trial-feeder-count{display:inline-flex;padding:2px 6px;border-radius:999px;background:#174e6c;color:#d7ebf6;font-size:10px;font-weight:800}
      @media(max-width:700px){.kedco-trial-head,.kedco-trial-body{padding:20px}.kedco-trial-field{grid-column:1/-1}.kedco-trial-checks{grid-template-columns:1fr}.kedco-trial-voice{margin-left:0}.kedco-trial-forward-grid{grid-template-columns:1fr}.kedco-trial-forward-field.wide{grid-column:auto}.kedco-trial-feeder-picker{grid-template-columns:1fr}.kedco-trial-feeder-controls{grid-auto-flow:column;justify-content:center;align-items:center}.kedco-trial-feeder-btn{white-space:nowrap}}
    `;
    document.head.appendChild(style);
  }

  function modalMarkup() {
    return `<div id="${MODAL_ID}" hidden role="dialog" aria-modal="true" aria-labelledby="kedco-trial-title">
      <div class="kedco-trial-shell">
        <div class="kedco-trial-head"><div><div class="kedco-trial-kicker">KEDCO Central PC&M Control</div><h2 id="kedco-trial-title">Transformer Trial Request</h2><p>Controlled request, Head PC&M approval and auditable field result for a tripped power transformer.</p></div><button type="button" class="kedco-trial-close" data-trial-close aria-label="Close">×</button></div>
        <div class="kedco-trial-body"><div class="kedco-trial-message" data-trial-message hidden></div><div data-trial-content></div><div class="kedco-trial-footnote">Safety gate: a trial must not proceed from this screen until the authorised Head PC&M approval is recorded and the approved switching instructions are followed.</div></div>
      </div>
    </div>`;
  }

  function requestForm() {
    return '<form data-trial-form novalidate>' +
      '<div class="kedco-trial-grid">' +
      '<div class="kedco-trial-field"><label for="trial-region">Assigned KEDCO region *</label><select id="trial-region" name="region" required><option value="">Select region</option>' + regionOptions() + '</select></div>' +
      '<div class="kedco-trial-field"><label for="trial-station">Station / injection substation *</label><select id="trial-station" name="station" required>' + trialStationOptions() + '</select></div>' +
      '<div class="kedco-trial-field"><label for="trial-transformer">Transformer identification *</label><input id="trial-transformer" name="transformer" required placeholder="e.g. T1 30/40 MVA"></div>' +
      '<div class="kedco-trial-field wide"><label>Affected feeder / circuit(s) *</label><div class="kedco-trial-feeder-picker"><div class="kedco-trial-feeder-list"><label for="trial-feeder-source">Available / deselected feeders</label><select id="trial-feeder-source" data-feeder-source multiple size="9" aria-label="Available or deselected affected feeders">' + trialFeederOptions() + '</select></div><div class="kedco-trial-feeder-controls" aria-label="Feeder selection controls"><button type="button" class="kedco-trial-feeder-btn" data-feeder-transfer="add">Add selected →</button><button type="button" class="kedco-trial-feeder-btn" data-feeder-transfer="all">Add all »</button><button type="button" class="kedco-trial-feeder-btn secondary" data-feeder-transfer="remove">← Remove selected</button><button type="button" class="kedco-trial-feeder-btn secondary" data-feeder-transfer="clear">« Clear selected</button></div><div class="kedco-trial-feeder-list"><label for="trial-feeder">Selected affected feeder / circuit(s) <span class="kedco-trial-feeder-count" data-feeder-count>0 selected</span></label><select id="trial-feeder" name="feeder" data-feeder-selected multiple size="9" required aria-label="Selected affected feeders"></select></div></div><small id="trial-feeder-help" class="kedco-trial-field-help">Select one or more feeders on the left, add them to the selected list, then remove any feeder that is not affected.</small></div>' +
      '<div class="kedco-trial-field"><label for="trial-voltage">Voltage / equipment class</label><select id="trial-voltage" name="voltage"><option value="">Select class</option><option>132/33 kV Power Transformer</option><option>33/11 kV Power Transformer</option><option>33 kV Transformer</option><option>11 kV Transformer</option></select></div>' +
      '<div class="kedco-trial-field"><label for="trial-trip-time">Trip date and time *</label><input id="trial-trip-time" name="tripTime" type="datetime-local" required></div>' +
      '<div class="kedco-trial-field wide"><label for="trial-cause">Trip cause / protection indication *</label><select id="trial-cause" name="cause" required>' + trialCauseOptions() + '</select></div>' +
      '<div class="kedco-trial-field"><label for="trial-risk">Risk / trial conditions *</label><select id="trial-risk" name="risk" required>' + trialRiskOptions() + '</select></div>' +
      '<div class="kedco-trial-field"><label for="trial-risk-detail">Risk / trial detail</label><textarea id="trial-risk-detail" name="riskDetail" placeholder="Add restrictions, standby arrangement or monitoring requirements."></textarea></div>' +
      '<div class="kedco-trial-field wide"><label for="trial-note">Request note</label><textarea id="trial-note" name="note" placeholder="Additional information for Head PC&M."></textarea></div>' +
      '</div><div class="kedco-trial-actions"><button class="kedco-trial-btn" type="submit">Send to Head PC&M for approval</button><button class="kedco-trial-btn secondary" type="button" data-trial-refresh>Refresh requests</button><label class="kedco-trial-voice"><input type="checkbox" data-trial-voice> Voice announcements</label></div></form>';
  }
  const rowFeeders = row => {
    const source = Array.isArray(row?.requested_feeders) && row.requested_feeders.length ? row.requested_feeders : (row?.requested_feeder ? String(row.requested_feeder).split(/\s*,\s*/) : []);
    return [...new Set(source.map(value => text(value)).filter(Boolean))];
  };
  const feederMarkup = row => {
    const feeders = rowFeeders(row);
    return feeders.length ? feeders.map(feeder => `<span class="kedco-trial-feeder-chip">${esc(feeder)}</span>`).join('<br>') : '<span style="color:#8faabd">No feeder stated</span>';
  };

  function renderRows() {
    const body = document.querySelector(`#${MODAL_ID} [data-trial-table-body]`);
    if (!body) return;
    if (!rows.length) { body.innerHTML = '<tr><td colspan="8" class="kedco-trial-empty">No transformer trial requests have been recorded for your authorised scope.</td></tr>'; return; }
    body.innerHTML = rows.map(row => {
      const actions = [];
      if (row.can_review && ['PENDING_HEAD_PCM', 'RETURNED'].includes(row.status)) {
        actions.push(`<button type="button" class="approve" data-trial-action="approve" data-trial-id="${esc(row.id)}">Approve trial</button>`);
        actions.push(`<button type="button" class="reject" data-trial-action="reject" data-trial-id="${esc(row.id)}">Return / reject</button>`);
      }
      if (row.can_forward && ['PENDING_HEAD_PCM', 'RETURNED'].includes(row.status)) {
        actions.push(`<button type="button" class="forward" data-trial-action="forward" data-trial-id="${esc(row.id)}">Forward / assign</button>`);
      }
      if (row.can_complete_forward) {
        actions.push(`<button type="button" class="result" data-trial-action="complete-forward" data-trial-id="${esc(row.id)}">Mark instruction complete</button>`);
      }
      if (row.can_complete_prechecks) {
        actions.push(`<button type="button" class="safety" data-trial-action="prechecks" data-trial-id="${esc(row.id)}">Complete safety pre-checks</button>`);
      }
      if (row.can_record_result && !row.prechecks_required) {
        actions.push(`<button type="button" class="result" data-trial-action="start" data-trial-id="${esc(row.id)}">Start trial</button>`);
        actions.push(`<button type="button" class="result" data-trial-action="complete" data-trial-id="${esc(row.id)}">Record result</button>`);
      }
      const action = actions.length ? `<div class="kedco-trial-row-actions">${actions.join('')}</div>` : '<span style="color:#8faabd">Monitoring</span>';
      const forwarded = row.forwarded_to_name ? `<br><small><span class="kedco-trial-forward-badge">Assigned: ${esc(row.forwarded_to_name)}</span><br>${esc(row.forwarded_instruction || '')}${row.forwarded_note ? '<br>' + esc(row.forwarded_note) : ''}</small>` : '';
      const completed = row.forward_completion_note ? `<br><small>Completed by ${esc(row.forward_completed_by_name || 'assigned personnel')}: ${esc(row.forward_completion_note)}</small>` : '';
      const risk = row.requested_risk ? `<small><strong>${esc(row.requested_risk)}</strong>${row.requested_risk_detail ? '<br>' + esc(row.requested_risk_detail) : ''}</small>` : '<small>Risk condition not stated</small>';
      const safety = row.prechecks_required ? '<br><small class="kedco-trial-safety-pending">Mandatory safety pre-checks pending</small>' : row.prechecks_completed ? '<br><small class="kedco-trial-safety-complete">Safety pre-checks confirmed</small>' : '';
      return `<tr><td><strong>${esc(row.reference)}</strong><br><small>${esc(formatDate(row.created_at))}</small></td><td><strong>${esc(row.requested_transformer)}</strong><br>${esc(row.requested_station)}</td><td>${feederMarkup(row)}</td><td>${esc(row.requested_region_name)}<br><small>${esc(row.requested_voltage || 'Equipment class not stated')}</small><br>${risk}${safety}</td><td>${esc(row.requested_by_name)}<br><small>${esc(row.requested_by_email)}</small></td><td><span class="kedco-trial-status ${statusClass(row.status)}">${esc(row.status)}</span>${row.result_status ? '<br><small>' + esc(row.result_status) + '</small>' : ''}</td><td>${esc(row.reviewed_by_name || 'Awaiting Head PC&M')}<br><small>${esc(row.approval_note || row.result_note || '')}</small>${completed}</td><td>${action}</td></tr>`;
    }).join('');
  }
  function queueMarkup() {
    return `<section class="kedco-trial-section"><h3>${isReviewer() ? 'Head PC&M approval queue' : 'My transformer trial requests'}</h3><p>${isReviewer() ? 'Review live requests, affected feeders, risk conditions and approval actions in one queue.' : 'Track approval, affected feeders, safety readiness and final trial result from one auditable register.'}</p><div data-trial-forward-host></div><div class="kedco-trial-table-wrap"><table class="kedco-trial-table"><thead><tr><th>Reference</th><th>Asset / station</th><th>Affected feeders</th><th>Region / risk</th><th>Requester</th><th>Status</th><th>Decision / result note</th><th>Action</th></tr></thead><tbody data-trial-table-body><tr><td colspan="8" class="kedco-trial-empty">Loading live requests…</td></tr></tbody></table></div><div class="kedco-trial-actions"><button type="button" class="kedco-trial-btn secondary" data-trial-refresh>Refresh live queue</button><label class="kedco-trial-voice"><input type="checkbox" data-trial-voice> Voice announcements</label></div></section>`;
  }
  function updateFeederCount(form) {
    const selected = form?.querySelector('[data-feeder-selected]');
    const count = form?.querySelector('[data-feeder-count]');
    if (count) count.textContent = (selected ? selected.options.length : 0) + ' selected';
  }

  function transferFeeders(button) {
    const form = button.closest('[data-trial-form]');
    if (!form) return;
    const source = form.querySelector('[data-feeder-source]');
    const selected = form.querySelector('[data-feeder-selected]');
    if (!source || !selected) return;
    const action = button.dataset.feederTransfer;
    const sourceOptions = Array.from(source.options).filter(option => option.value);
    const selectedValues = new Set(Array.from(selected.options).map(option => option.value));
    const move = options => options.forEach(option => {
      if (!selectedValues.has(option.value)) selected.appendChild(option);
      else if (action === 'remove' || action === 'clear') source.appendChild(option);
    });
    if (action === 'add') move(Array.from(source.selectedOptions));
    if (action === 'all') move(sourceOptions);
    if (action === 'remove') move(Array.from(selected.selectedOptions));
    if (action === 'clear') move(Array.from(selected.options));
    Array.from(source.options).forEach(option => { option.selected = false; });
    Array.from(selected.options).forEach(option => { option.selected = false; });
    updateFeederCount(form);
  }
  function updateForwardPersonnel(form) {
    const region = form?.elements?.forwardRegion?.value || '';
    const recipient = form?.querySelector('[data-trial-forward-recipient]');
    if (!recipient) return;
    recipient.innerHTML = personnelOptions(region);
    recipient.disabled = !region || recipient.options.length <= 1;
  }
  function bindModal() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal || modal.__trialBound) return;
    modal.__trialBound = true;
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.querySelector('[data-trial-close]').addEventListener('click', close);
    modal.addEventListener('change', event => {
      if (event.target.matches('[data-trial-voice]')) setVoice(event.target.checked);
      if (event.target.matches('[data-trial-forward-region]')) updateForwardPersonnel(event.target.closest('[data-trial-forward-form]'));
    });
    modal.addEventListener('click', event => {
      const button = event.target.closest('[data-trial-action]');
      if (!button) return;
      handleAction(button.dataset.trialAction, button.dataset.trialId);
    });
    modal.addEventListener('click', event => {
      const feederButton = event.target.closest('[data-feeder-transfer]');
      if (feederButton) { event.preventDefault(); transferFeeders(feederButton); return; }
      if (event.target.closest('[data-trial-refresh]')) refresh(true);
    });
    modal.addEventListener('submit', event => {
      if (event.target.matches('[data-trial-form]')) { event.preventDefault(); submit(event.target); return; }
      if (event.target.matches('[data-trial-forward-form]')) { event.preventDefault(); submitForward(event.target); return; }
      if (event.target.matches('[data-trial-completion-form]')) { event.preventDefault(); submitCompletion(event.target); return; }
      if (event.target.matches('[data-trial-safety-form]')) { event.preventDefault(); submitSafety(event.target); }
    });
    modal.addEventListener('click', event => {
      if (event.target.closest('[data-trial-panel-cancel]')) {
        const host = modal.querySelector('[data-trial-forward-host]');
        if (host) host.innerHTML = '';
      }
    });
  }
  async function loadContext() {
    const data = await Promise.all([call('kedco_current_user_role_codes'), call('kedco_list_eform_regions'), call('kedco_list_eform_personnel')]);
    roles = new Set((Array.isArray(data[0]) ? data[0] : []).map(role => text(role).toUpperCase()));
    regions = Array.isArray(data[1]) ? data[1] : [];
    personnel = Array.isArray(data[2]) ? data[2].filter(person => person && person.is_active !== false) : [];
  }

  async function refresh(announceChanges = false) {
    try {
      const data = await call('kedco_list_transformer_trial_requests', { requested_source_page: pageName() });
      const next = Array.isArray(data) ? data : [];
      if (announceChanges && !initialPoll) next.forEach(row => {
        const before = knownStatus.get(row.id);
        const reference = shortReference(row.reference);
        if (before && before !== row.status) {
          const message = row.status === 'APPROVED' ? 'Transformer trial request ' + reference + ' has been approved by Head PC and M.' : row.status === 'FORWARDED' ? 'Transformer trial request ' + reference + ' has been forwarded to ' + (row.forwarded_to_name || 'assigned KEDCO personnel') + '. Instruction: ' + (row.forwarded_instruction || 'complete the assigned pre-trial action') + '.' : 'Transformer trial request ' + reference + ' is now ' + String(row.status).toLowerCase() + '.';
          announce(message);
        } else if (!before && row.status === 'PENDING_HEAD_PCM' && isReviewer()) announce('New transformer trial request ' + reference + ' is waiting for Head PC and M approval.');
      });
      rows = next; rows.forEach(row => knownStatus.set(row.id, row.status));
      initialPoll = false;
      renderRows();
    } catch (error) { showMessage(error.message || 'Could not load transformer trial requests.', 'error'); }
  }
  async function submit(form) {
    const get = name => form.elements[name]?.value?.trim() || '';
    const getMulti = name => Array.from(name === 'feeder' ? (form.querySelector('[data-feeder-selected]')?.options || []) : (form.elements[name]?.selectedOptions || [])).map(option => text(option.value)).filter(Boolean);
    const feeders = getMulti('feeder');
    if (!get('region') || !get('station') || !get('transformer') || !feeders.length || !get('tripTime') || !get('cause') || !get('risk')) return showMessage('Complete region, station, transformer, at least one affected feeder, trip time, trip cause and risk condition.', 'error');
    const button = form.querySelector('button[type=submit]'); button.disabled = true;
    try {
      const data = await call('kedco_create_transformer_trial_request', { requested_region_id: get('region'), requested_station: get('station'), requested_transformer: get('transformer'), requested_feeders: feeders, requested_feeder: feeders.join(', '), requested_voltage: get('voltage'), requested_trip_time: new Date(get('tripTime')).toISOString(), requested_trip_cause: get('cause'), requested_protection_indication: get('cause'), requested_prechecks: {}, requested_risk: get('risk'), requested_risk_detail: get('riskDetail'), requested_note: get('note'), requested_source_page: location.pathname });
      const reference = data?.record?.reference || 'created';
      showMessage('Request ' + reference + ' was sent to Head PC&M for approval.', 'success');
      announce('Transformer trial request ' + shortReference(reference) + ' sent to Head PC and M for approval.');
      form.reset(); const feederSource = form.querySelector('[data-feeder-source]'); const feederSelected = form.querySelector('[data-feeder-selected]'); if (feederSource) feederSource.innerHTML = trialFeederOptions(); if (feederSelected) feederSelected.innerHTML = ''; updateFeederCount(form); const tripTime = form.elements.tripTime; if (tripTime) tripTime.value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16); await refresh();
    } catch (error) { showMessage(error.message || 'The transformer trial request could not be sent.', 'error'); } finally { button.disabled = false; }
  }
  function renderSafetyForm(row) {
    const host = document.querySelector('#' + MODAL_ID + ' [data-trial-forward-host]');
    if (!host) return;
    host.innerHTML = '<section class="kedco-trial-safety"><h3>Mandatory safety pre-checks — approval granted</h3><p>Head PC&M approval is recorded. Confirm every field condition below before starting the transformer trial.</p><div class="kedco-trial-forward-summary"><strong>' + esc(row.reference) + '</strong> · ' + esc(row.requested_transformer) + ' · ' + esc(row.requested_station) + '<br><span class="kedco-trial-forward-badge">Approved — safety confirmation required</span></div><form data-trial-safety-form data-trial-id="' + esc(row.id) + '"><div class="kedco-trial-checks"><label><input type="checkbox" name="faultCleared"> Fault investigation completed and the initiating fault is cleared</label><label><input type="checkbox" name="isolationConfirmed"> Required isolation, clearance and safe switching boundary confirmed</label><label><input type="checkbox" name="protectionReset"> Protection, alarm and lockout status checked/reset as authorised</label><label><input type="checkbox" name="safetyClearance"> Control room, field team and safety clearance confirmed</label></div><div class="kedco-trial-forward-actions"><button class="kedco-trial-btn" type="submit">Confirm safety readiness</button><button class="kedco-trial-btn secondary" type="button" data-trial-panel-cancel>Cancel</button></div></form></section>';
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function submitSafety(form) {
    const checks = { fault_cleared: !!form.elements.faultCleared?.checked, isolation_confirmed: !!form.elements.isolationConfirmed?.checked, protection_reset: !!form.elements.protectionReset?.checked, safety_clearance: !!form.elements.safetyClearance?.checked };
    if (Object.values(checks).some(value => !value)) return showMessage('Complete all four mandatory safety pre-checks before confirming readiness for trial.', 'error');
    const button = form.querySelector('button[type=submit]'); button.disabled = true;
    try {
      const data = await call('kedco_confirm_transformer_trial_prechecks', { requested_id: form.dataset.trialId, requested_prechecks: checks });
      const reference = data?.record?.reference || 'updated';
      showMessage('Mandatory safety pre-checks confirmed for request ' + reference + '.', 'success');
      announce('Mandatory safety pre-checks confirmed for transformer trial request ' + shortReference(reference) + '.');
      const host = document.querySelector('#' + MODAL_ID + ' [data-trial-forward-host]');
      if (host) host.innerHTML = '';
      await refresh();
    } catch (error) {
      showMessage(error.message || 'The mandatory safety pre-checks could not be confirmed.', 'error');
    } finally { button.disabled = false; }
  }
  function renderForwardForm(row) {
    const host = document.querySelector('#' + MODAL_ID + ' [data-trial-forward-host]');
    if (!host) return;
    host.innerHTML = '<section class="kedco-trial-forward"><h3>Head PC&M forwarding / pre-trial instruction</h3><p>Select the destination KEDCO region first. The personnel list will then show active KEDCO personnel assigned to that region.</p><div class="kedco-trial-forward-summary"><strong>' + esc(row.reference) + '</strong> · ' + esc(row.requested_transformer) + ' · ' + esc(row.requested_station) + '<br><span class="kedco-trial-forward-badge">Current status: ' + esc(row.status) + '</span></div><form data-trial-forward-form data-trial-id="' + esc(row.id) + '"><div class="kedco-trial-forward-grid"><div class="kedco-trial-forward-field"><label for="trial-forward-region">Forward to KEDCO region *</label><select id="trial-forward-region" name="forwardRegion" data-trial-forward-region required><option value="">Select destination region</option>' + regionOptions() + '</select></div><div class="kedco-trial-forward-field"><label for="trial-forward-recipient">Forward to KEDCO personnel *</label><select id="trial-forward-recipient" name="recipient" data-trial-forward-recipient required disabled>' + personnelOptions() + '</select></div><div class="kedco-trial-forward-field"><label for="trial-forward-instruction">Required action before trial *</label><select id="trial-forward-instruction" name="instruction" required>' + trialForwardInstructionOptions() + '</select></div><div class="kedco-trial-forward-field wide"><label for="trial-forward-note">Instruction detail / safety condition</label><textarea id="trial-forward-note" name="note" placeholder="Add readings, clearance details, work scope or the exact instruction. Required when Other approved pre-trial instruction is selected."></textarea></div></div><div class="kedco-trial-forward-actions"><button class="kedco-trial-btn" type="submit">Forward request</button><button class="kedco-trial-btn secondary" type="button" data-trial-panel-cancel>Cancel</button></div></form></section>';
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function renderCompletionForm(row) {
    const host = document.querySelector(`#${MODAL_ID} [data-trial-forward-host]`);
    if (!host) return;
    host.innerHTML = `<section class="kedco-trial-forward"><h3>Complete forwarded pre-trial instruction</h3><p>Record what was completed and return the request to Head PC&M for the next approval decision.</p><div class="kedco-trial-forward-summary"><strong>${esc(row.reference)}</strong> · ${esc(row.forwarded_instruction || 'Assigned pre-trial action')}<br>Transformer: ${esc(row.requested_transformer)} · Station: ${esc(row.requested_station)}</div><form data-trial-completion-form data-trial-id="${esc(row.id)}"><div class="kedco-trial-forward-field wide"><label for="trial-completion-note">Completion record *</label><textarea id="trial-completion-note" name="note" required placeholder="Describe the work completed, readings taken, clearance obtained or outstanding limitation."></textarea></div><div class="kedco-trial-forward-actions"><button class="kedco-trial-btn" type="submit">Return to Head PC&M</button><button class="kedco-trial-btn secondary" type="button" data-trial-panel-cancel>Cancel</button></div></form></section>`;
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function submitForward(form) {
    const forwardRegion = form.elements.forwardRegion?.value?.trim() || '';
    const recipient = form.elements.recipient?.value?.trim() || '';
    const instruction = form.elements.instruction?.value?.trim() || '';
    const note = form.elements.note?.value?.trim() || '';
    if (!forwardRegion || !recipient || !instruction) return showMessage('Select the forwarding region, receiving KEDCO personnel and required pre-trial action.', 'error');
    if (instruction === 'Other approved pre-trial instruction' && !note) return showMessage('Describe the other approved instruction before forwarding.', 'error');
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const data = await call('kedco_forward_transformer_trial_request', { requested_id: form.dataset.trialId, requested_forward_region_id: forwardRegion, requested_recipient_user_id: recipient, requested_instruction: instruction, requested_note: note });
      const record = data?.record || {};
      const reference = record.reference || 'forwarded';
      showMessage('Request ' + reference + ' was assigned to ' + (record.forwarded_to_name || 'the selected KEDCO personnel') + '.', 'success');
      announce('Transformer trial request ' + shortReference(reference) + ' forwarded to ' + (record.forwarded_to_name || 'assigned KEDCO personnel') + '.');
      const host = document.querySelector('#' + MODAL_ID + ' [data-trial-forward-host]');
      if (host) host.innerHTML = '';
      await refresh();
    } catch (error) {
      showMessage(error.message || 'The transformer trial request could not be forwarded.', 'error');
    } finally {
      button.disabled = false;
    }
  }
  async function submitCompletion(form) {
    const note = form.elements.note?.value?.trim() || '';
    if (!note) return showMessage('Record what was completed before returning this request to Head PC&M.', 'error');
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      const data = await call('kedco_complete_transformer_trial_forward', { requested_id: form.dataset.trialId, requested_note: note });
      showMessage(`Request ${data?.record?.reference || 'updated'} was returned to Head PC&M.`, 'success');
      announce('Transformer trial instruction completed and returned to Head PC and M.');
      const host = document.querySelector(`#${MODAL_ID} [data-trial-forward-host]`);
      if (host) host.innerHTML = '';
      await refresh();
    } catch (error) {
      showMessage(error.message || 'The forwarded instruction could not be completed.', 'error');
    } finally {
      button.disabled = false;
    }
  }
  async function handleAction(action, id) {
    const row = rows.find(item => String(item.id) === String(id)); if (!row) return;
    if (action === 'prechecks') { renderSafetyForm(row); return; }
    if (action === 'forward') { renderForwardForm(row); return; }
    if (action === 'complete-forward') { renderCompletionForm(row); return; }
    if (action === 'approve' || action === 'reject') {
      const note = global.prompt(action === 'approve' ? 'Approval instruction / operating condition (optional):' : 'Reason for return or rejection (required):', '');
      if (note === null || (action === 'reject' && !note.trim())) return;
      try {
        const data = await call('kedco_review_transformer_trial_request', { requested_id: id, requested_decision: action === 'approve' ? 'APPROVED' : 'REJECTED', requested_note: note });
        const reference = shortReference(data?.record?.reference || row.reference);
        showMessage(reference + ' is now ' + (data?.record?.status || action) + '.', action === 'approve' ? 'success' : 'info');
        announce(action === 'approve' ? 'Transformer trial request ' + shortReference(row.reference) + ' approved by Head PC and M.' : 'Transformer trial request ' + shortReference(row.reference) + ' rejected by Head PC and M.');
        await refresh();
      } catch (error) { showMessage(error.message || 'The approval action could not be completed.', 'error'); }
      return;
    }
    const result = action === 'start' ? 'TRIAL_STARTED' : global.prompt('Enter result: TRIAL_COMPLETED, TRIPPED_AGAIN, FAILED or CANCELLED', 'TRIAL_COMPLETED');
    if (!result) return;
    const note = global.prompt('Record the switching result, measurement or safety note:', '');
    if (note === null || (!note.trim() && result !== 'TRIAL_STARTED')) return;
    try {
      const data = await call('kedco_record_transformer_trial_result', { requested_id: id, requested_result_status: String(result).toUpperCase(), requested_note: note });
      showMessage(shortReference(data?.record?.reference || row.reference) + ' result recorded.', 'success');
      announce('Transformer trial result recorded for ' + shortReference(row.reference) + '.');
      await refresh();
    } catch (error) { showMessage(error.message || 'The trial result could not be recorded.', 'error'); }
  }
  function render() {
    const modal = document.getElementById(MODAL_ID); if (!modal) return;
    const content = modal.querySelector('[data-trial-content]');
    content.innerHTML = isReviewer() ? queueMarkup() : `${requestForm()}${queueMarkup()}`;
    modal.querySelectorAll('[data-trial-voice]').forEach(input => { input.checked = voiceEnabled(); });
    const time = modal.querySelector('[name=tripTime]'); if (time && !time.value) time.value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    renderRows();
  }

  async function openModal() {
    injectStyles();
    if (!document.getElementById(MODAL_ID)) document.body.insertAdjacentHTML('beforeend', modalMarkup());
    bindModal();
    const modal = document.getElementById(MODAL_ID); modal.hidden = false; open = true; document.body.style.overflow = 'hidden';
    const content = modal.querySelector('[data-trial-content]'); content.innerHTML = '<div class="kedco-trial-message">Loading authorised KEDCO workflow…</div>';
    try { await loadContext(); render(); await refresh(); } catch (error) { showMessage(error.message || 'Could not initialise transformer trial workflow.', 'error'); }
  }

  function close() { const modal = document.getElementById(MODAL_ID); if (modal) modal.hidden = true; open = false; document.body.style.overflow = ''; }

  function init() {
    injectStyles();
    document.querySelectorAll('[data-kedco-transformer-trial]').forEach(element => { if (element.__trialTrigger) return; element.__trialTrigger = true; element.addEventListener('click', event => { event.preventDefault(); openModal(); }); });
    if (polling) clearInterval(polling);
    polling = setInterval(async () => { if (!api()) return; try { if (!roles.size) await loadContext(); await refresh(true); } catch (_) {} }, 30000);
  }

  global.KEDCO_TRANSFORMER_TRIAL = { init, open: openModal, close, refresh: () => refresh(true), announce };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})(window);

/* KEDCO Head PC&M live regional register */
(function (global) {
  'use strict';
  let client = null;
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  const date = value => { const stamp = Date.parse(value || ''); return Number.isNaN(stamp) ? '—' : new Date(stamp).toLocaleString(); };
  const currentClient = () => client || (client = global.supabase?.createClient?.());
  const html = (value, fallback = '—') => esc(String(value ?? '').trim() || fallback);
  const regionName = row => String(row?.region_name || row?.state || row?.requested_region_name || 'Unassigned').trim();
  const typeText = row => String(row?.category || row?.operation_type || row?.form_code || row?.form_title || row?.reason || row?.summary || '').toLowerCase();
  const isMetering = row => /meter|metering|energy/.test(typeText(row));
  const isProtection = row => /protect|relay|trip|fault|breaker|overcurrent|earth/.test(typeText(row));
  const isTesting = row => /test|commission|calibrat|inspection/.test(typeText(row));
  const isTrouble = row => String(row?.status || '').toLowerCase() === 'open' || /trouble|fault|alarm|emergency|failure|trip/.test(typeText(row));
  const statusBadge = status => { const value = String(status || '').toLowerCase(); const cls = /critical|locked|open|fault|trip|pending/.test(value) ? 'badge-danger' : /warning|review|active/.test(value) ? 'badge-warning' : 'badge-success'; return `<span class="badge ${cls}">${esc(String(status || 'LIVE').replace(/_/g, ' '))}</span>`; };
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = String(value); };
  const put = (id, content) => { const el = document.getElementById(id); if (el) el.innerHTML = content; };
  const empty = (columns, message) => `<tr><td colspan="${columns}" style="text-align:center;color:#7a8c99;padding:24px;">${esc(message)}</td></tr>`;

  function rowsForRegion(region, records) { return records.filter(row => regionName(row).toLowerCase() === String(region.name || '').toLowerCase()); }

  function renderSnapshot(data) {
    const regions = Array.isArray(data.regions) ? data.regions : [];
    const operations = Array.isArray(data.operations) ? data.operations : [];
    const stationOps = Array.isArray(data.station_operations) ? data.station_operations : [];
    const eforms = Array.isArray(data.eforms) ? data.eforms : [];
    const feeders = Array.isArray(data.feeders) ? data.feeders : [];
    const records = [...operations, ...stationOps, ...eforms];
    const activeTrouble = operations.filter(row => String(row.status || '').toLowerCase() === 'open').length;
    const pending = eforms.filter(row => !['COMPLETED', 'APPROVED'].includes(String(row.status || '').toUpperCase())).length;
    const trips = records.filter(isProtection).length;
    const healthy = feeders.filter(row => !/OPEN|FAULT|TRIP|ALARM|LOCK/.test(String(row.status || '').toUpperCase())).length;
    set('pcmHealthyFeeders', healthy); set('pcmOpenIncidents', activeTrouble); set('pcmPendingActions', pending); set('pcmProtectionTrips', trips);
    set('liveEventCount', stationOps.length); set('liveTroubleCount', activeTrouble); set('liveTryCount', Array.isArray(data.transformer_trials) ? data.transformer_trials.filter(row => ['PENDING_HEAD_PCM', 'APPROVED', 'TRIAL_IN_PROGRESS'].includes(row.status)).length : 0);
    set('pcmLiveUpdated', `Live register updated ${date(data.generated_at)}`);
    set('pcmRelayMetric', records.filter(isProtection).length); set('pcmMeterMetric', records.filter(isMetering).length); set('pcmTestMetric', records.filter(isTesting).length); set('pcmMaintenanceMetric', records.filter(row => /maint|ppm|prevent/.test(typeText(row))).length);

    put('pcmRegionalSnapshotBody', regions.length ? regions.slice(0, 8).map(region => {
      const scoped = rowsForRegion(region, records), trouble = scoped.filter(isTrouble).length, protection = scoped.filter(isProtection).length, metering = scoped.filter(isMetering).length;
      const status = scoped.length === 0 ? 'No live records' : trouble ? 'Attention' : 'Recorded';
      const badge = status === 'Attention' ? 'badge-warning' : status === 'Recorded' ? 'badge-success' : 'badge-info';
      return `<tr><td>${html(region.name)}</td><td>${protection}</td><td>${metering}</td><td>${scoped.length}</td><td>${trouble}</td><td>${scoped.length}</td><td><span class="badge ${badge}">${status}</span></td></tr>`;
    }).join('') : empty(7, 'No KEDCO regions are available from the local register.'));

    put('pcmRegionalOversightBody', regions.map(region => {
      const scoped = rowsForRegion(region, records), trouble = scoped.filter(isTrouble).length, protection = scoped.filter(isProtection).length, metering = scoped.filter(isMetering).length, testing = scoped.filter(isTesting).length;
      const status = scoped.length === 0 ? 'No live records' : trouble ? 'Attention' : 'Recorded';
      const badge = status === 'Attention' ? 'badge-warning' : status === 'Recorded' ? 'badge-success' : 'badge-info';
      return `<tr><td>${html(region.name)}</td><td>${protection}</td><td>${metering}</td><td>${testing}</td><td>${trouble}</td><td>${scoped.length}</td><td><span class="badge ${badge}">${status}</span></td></tr>`;
    }).join('') || empty(7, 'No KEDCO regions are available from the local register.'));

    put('eventsBody', stationOps.length ? stationOps.slice(0, 12).map(row => `<tr><td>${html(date(row.event_time || row.updated_at || row.created_at))}</td><td>${html(row.feeder_name || row.station_name || row.region_name)}</td><td>${html(row.payload?.device || row.operation_type || row.voltage_level)}</td><td>${html(row.summary || row.payload?.event || row.operation_type || 'Station operation')}</td><td>${statusBadge(row.status)}</td></tr>`).join('') : empty(5, 'No protection or control event has been published to the local KEDCO register.'));
    put('troubleBody', operations.filter(isTrouble).slice(0, 12).map(row => `<tr><td>${html(row.id)}</td><td>${html(row.state || row.region_name)}</td><td>${html(row.reason || row.category)}</td><td>${html(row.feeder || row.station)}</td><td>${statusBadge(row.status)}</td><td>${html(row.operator)}</td><td><span class="badge badge-info">Live record</span></td></tr>`).join('') || empty(7, 'No active trouble record is present in daily operations.'));
    const trials = Array.isArray(data.transformer_trials) ? data.transformer_trials : [];
    put('tryRequestsBody', trials.length ? trials.slice(0, 12).map(row => `<tr><td>${html(row.reference)}</td><td>${html(row.requested_station)}<br><small>${html(row.requested_transformer)} · ${html(row.requested_feeder, 'No feeder stated')}</small></td><td>${html(row.requested_protection_indication || row.requested_trip_cause)}</td><td>${html(row.requested_risk, 'Not stated')}</td><td>${html(row.requested_by_name)}</td><td>${statusBadge(row.status)}<br><button type="button" class="btn btn-sm btn-secondary" onclick="window.KEDCO_TRANSFORMER_TRIAL?.open()">Open central queue</button></td></tr>`).join('') : empty(6, 'No transformer trial request is waiting in the authorised local queue.'));
    set('pcmFeederRegisterCount', feeders.length); set('pcmRecordRegisterCount', records.length);
  }

  async function load() {
    const current = currentClient();
    if (!current) return;
    try { const result = await current.rpc('kedco_pcm_live_snapshot'); if (result.error) throw result.error; renderSnapshot(result.data || {}); } catch (error) { set('pcmLiveUpdated', `Live register unavailable · ${error.message || error}`); ['pcmRegionalSnapshotBody', 'pcmRegionalOversightBody', 'eventsBody', 'troubleBody', 'tryRequestsBody'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = empty(7, 'The live KEDCO local register is unavailable. No simulated data is shown.'); }); }
  }

  global.KEDCO_PCM_LIVE_DASHBOARD = { load };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { load(); setInterval(load, 30000); }, { once: true }); else { load(); setInterval(load, 30000); }
})(window);
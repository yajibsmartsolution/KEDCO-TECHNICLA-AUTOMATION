/* ============================================================================
   KEDCO REAL-TIME 33 kV / 11 kV LOAD FLOW v2.6 BACKEND SESSION REFRESH + SOURCE-PROVENANCE + LIVE OVERVIEW
   Authoritative operating rule:
   - Operator AND Dispatch live forms = one shared editable real-time hourly sheet.
   - A value typed or pasted is saved through the local KEDCO backend after a short delay.
   - Local version polling updates the other page when saved data changes.
   - Dispatch Overview = the currently selected 33 kV / 11 kV hourly datasets.
   - Each overview value is evaluated at the last populated hour in its selected dataset.
   - LIVE Today remains displayed until the user explicitly overrides it with View Selected Date.
   - Year/Month/Day selectors stay visible, include today, and are reference/navigation controls only.
   - Selecting today always keeps/returns LIVE Today; historical Reference mode is read-only and exportable.
   ============================================================================ */
(() => {
  "use strict";
  if (window.__KEDCO_REALTIME_LOADFLOW_V2__) return;
  window.__KEDCO_REALTIME_LOADFLOW_V2__ = true;

  // Disable the older source/overview bridges below this script. They mixed selected
  // archive dates and the latest entered hour into the live operating dashboard.
  window.__KEDCO_SUPABASE_LOADFLOW_SOURCE__ = true;
  window.__KEDCO_LIVE_FORM_OVERVIEW_AUTHORITY__ = true;

  const isDispatch = /Central Dispatch/i.test(document.title) || /dispatch\.html/i.test(location.pathname);
  const isOperator = !isDispatch; // retained only for source/audit labels
  const canEditLive = true; // both Operator and Dispatch are peers on the shared live sheet
  const LIVE_TABLE = "kedco_station_live_operations";
  function newSourceRecordId() {
    try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch (_) {}
    // RFC-4122-shaped fallback for older browsers; the local JSON store accepts it as text.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.floor(Math.random()*16), v = c === "x" ? r : ((r & 3) | 8);
      return v.toString(16);
    });
  }
  const FORM_IDS = new Set(["load33", "load11"]);
  const TZ = "Africa/Lagos";
  const stateV2 = window.KEDCO_LOADFLOW_LIVE_V2 = window.KEDCO_LOADFLOW_LIVE_V2 || {
    date: "", hour: 0, load33: [], load11: [], updatedAt: null,
    overview33: [], overview33Date: "", overview33Mode: "live", overview33Source: "live_operations"
  };
  if (!Array.isArray(stateV2.overview33)) stateV2.overview33 = [];
  if (!stateV2.overview33Mode) stateV2.overview33Mode = "live";

  let client = null;
  if (!stateV2.selectedSheets || typeof stateV2.selectedSheets !== 'object') stateV2.selectedSheets = {};
  for (const id of ['load33', 'load11']) {
    const existing = stateV2.selectedSheets[id];
    if (!existing || typeof existing !== 'object') stateV2.selectedSheets[id] = { rows: [], date: '', mode: 'live', source: 'live_operations' };
    if (!Array.isArray(stateV2.selectedSheets[id].rows)) stateV2.selectedSheets[id].rows = [];
    if (!stateV2.selectedSheets[id].mode) stateV2.selectedSheets[id].mode = 'live';
  }
  // Preserve a reference selection created by the previous v2 controller when
  // a page is hot-reloaded without a full navigation.
  if (stateV2.overview33Mode === 'reference' && stateV2.overview33Date && !stateV2.selectedSheets.load33.rows.length) {
    stateV2.selectedSheets.load33 = {
      rows: stateV2.overview33.slice(), date: stateV2.overview33Date,
      mode: 'reference', source: stateV2.overview33Source || 'saved_file'
    };
  }
  let sessionRecoveryPromise = null;
  let channel = null;
  let refreshTimer = 0;
  const publishingForms = new WeakSet();
  const publishTimers = new WeakMap();
  const publishRetryTimers = new WeakMap();
  const monthTimers = new WeakMap();
  const formShadow = new Map();
  const loadingForms = new WeakSet();
  let recentEventsRequest = null;
  let recentEventsLoadedAt = 0;
  const rowFetchPromises = new Map();

  const pad = n => String(n).padStart(2, "0");
  const clean = v => String(v ?? "").trim();
  const normalize = v => clean(v).toUpperCase().replace(/\b(?:11|33)\s*K\s*V\b/g, "").replace(/[^A-Z0-9]+/g, "");
  const numberOrNull = v => {
    const s = clean(v).replace(/,/g, ".");
    if (!s || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return null;
    const n = Number(s); return Number.isFinite(n) ? n : null;
  };
  const DIRTY_PREFIX = "KEDCO_LOADFLOW_DIRTY_V9";

  function dirtyStorageKey(id,date) {
    return `${DIRTY_PREFIX}:${id}:${date}`;
  }

  function persistDirtyBuffer(form,id) {
    if (!form || !FORM_IDS.has(id)) return 0;
    const now = lagosNow();
    const shadow = formShadow.get(form) || new Map();
    const values = {};
    for (const el of trackedInputs(form,id)) {
      if (!el.name) continue;
      const value = clean(el.value);
      if (value !== (shadow.get(el.name) ?? "")) values[el.name] = value;
    }
    const key = dirtyStorageKey(id,now.date);
    try {
      if (Object.keys(values).length) {
        localStorage.setItem(key, JSON.stringify({
          version: 9,
          id,
          date: now.date,
          savedAt: new Date().toISOString(),
          values
        }));
      } else {
        localStorage.removeItem(key);
      }
    } catch (error) {
      console.warn("KEDCO load-flow dirty buffer write failed", error);
    }
    return Object.keys(values).length;
  }

  function dirtyBuffer(form,id,date) {
    try {
      const raw = localStorage.getItem(dirtyStorageKey(id,date));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.date !== date || !parsed.values || typeof parsed.values !== "object") return null;
      return parsed;
    } catch (_) { return null; }
  }

  function restoreDirtyBuffer(form,id,date) {
    if (!form || date !== lagosNow().date) return 0;
    const saved = dirtyBuffer(form,id,date);
    if (!saved) return 0;
    let restored = 0;
    loadingForms.add(form);
    for (const [name,value] of Object.entries(saved.values || {})) {
      const input = form.elements?.namedItem(name);
      if (input && trackedInputs(form,id).includes(input)) {
        input.value = value == null ? "" : String(value);
        restored += 1;
      }
    }
    try { if (typeof refreshKedcoLoadFlow === "function") refreshKedcoLoadFlow(form,id); } catch (_) {}
    loadingForms.delete(form);
    return restored;
  }

  function clearDirtyBuffer(id,date) {
    try { localStorage.removeItem(dirtyStorageKey(id,date)); } catch (_) {}
  }

  function lagosNow() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    }).formatToParts(new Date()).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
    const rawHour = Number(parts.hour || 0);
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      // KEDCO sheet convention is 01..24; midnight maps to H24.
      hour: rawHour === 0 ? 24 : rawHour,
      clockHour: rawHour,
      minute: Number(parts.minute || 0), second: Number(parts.second || 0)
    };
  }

  function getClient() {
    try { if (typeof dailyLocalClient === "function") { const localClient = dailyLocalClient(); if (localClient) return localClient; } } catch (_) {}
    if (client) return client;
    if (!window.supabase?.createClient) return null;
    client = window.supabase.createClient();
    return client;
  }

  async function ensureAuthenticatedClient(form) {
    const c = getClient();
    if (!c) throw new Error("Local data client is not available.");

    let session = null;
    try {
      const current = await c.auth.getSession();
      if (!current?.error) session = current?.data?.session || null;
    } catch (_) {}

    const stored = readStoredSession();

    // First try to activate the session returned by the KEDCO backend login.
    if (!session?.access_token && stored?.access_token && stored?.refresh_token) {
      try {
        const restored = await c.auth.setSession({
          access_token: stored.access_token,
          refresh_token: stored.refresh_token
        });
        if (!restored?.error) session = restored?.data?.session || null;
      } catch (error) {
        console.warn("KEDCO load-flow stored-session activation warning", error);
      }
    }

    // If the page client still has no usable session, do NOT stop here.
    // A valid refresh token may still exist even when the access token is stale.
    const nowSec = Math.floor(Date.now()/1000);
    const expiresAt = Number(session?.expires_at || stored?.expires_at || 0);
    const sessionMissingOrExpiring =
      !session?.access_token || (expiresAt && expiresAt <= nowSec + 60);

    if (sessionMissingOrExpiring && stored?.refresh_token) {
      try {
        session = await refreshThroughBackend(c, session || stored);
      } catch (refreshError) {
        console.warn("KEDCO load-flow backend refresh warning", refreshError);
      }
    }

    if (!session?.access_token) {
      installSessionRecovery(form);
      setStatus(
        form,
        "LOCAL CLOUD SESSION REQUIRED · Sign in / Refresh Session; entered values remain safely stored locally.",
        "warn"
      );
      throw new Error("Authenticated KEDCO session missing");
    }

    writeStoredSession(session);
    return { client: c, session };
  }

  function backendApiBase() {
    const configured = clean(window.KEDCO_LOCAL_CONFIG?.apiBase || localStorage.getItem("KEDCO_API_BASE"));
    if (configured) return configured.replace(/\/$/, "");
    if (location.port === "3000") return location.origin;
    return `http://${location.hostname || "localhost"}:3000`;
  }

  async function backendRequest(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`Local KEDCO backend did not respond within ${Math.round(timeoutMs / 1000)}s`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function storedSessionKey() { return "sb-localhost-auth-token"; }

  const KEDCO_SESSION_STORAGE_KEY = "KEDCO_AUTH_SESSION_V1";

  function readStoredSession() {
    const candidates = [];
    try {
      const dedicated = JSON.parse(localStorage.getItem(KEDCO_SESSION_STORAGE_KEY) || "null");
      const direct = dedicated?.session || dedicated;
      if (direct?.access_token || direct?.refresh_token) candidates.push(direct);
    } catch (_) {}

    try {
      const key = storedSessionKey();
      const saved = key ? JSON.parse(localStorage.getItem(key) || "null") : null;
      const direct = saved?.session || saved;
      if (direct?.access_token || direct?.refresh_token) candidates.push(direct);
    } catch (_) { return null; }
    return candidates.find(session => session?.access_token && session?.refresh_token) || candidates[0] || null;
  }

  function writeStoredSession(session) {
    if (!session?.access_token || !session?.refresh_token) return;
    try {
      localStorage.setItem(KEDCO_SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch (_) {}
    try {
      const key = storedSessionKey();
      if (key) localStorage.setItem(key, JSON.stringify(session));
    } catch (_) {}
  }

  async function recoverSession(form) {
    if (sessionRecoveryPromise) return sessionRecoveryPromise;
    sessionRecoveryPromise = (async () => {
      const c = getClient();
      if (!c) throw new Error("Local data client is not available.");
      const restoreMode = formMode(form);
      const restoreDate = historySelectedDate(form);
      const stored = readStoredSession();
      let session = null;
      if (stored?.refresh_token) {
        try { session = await refreshThroughBackend(c, stored); } catch (_) {}
      }
      if (!session?.access_token) {
        const hint = clean(sessionInfo()?.email || stored?.user?.email);
        const email = window.prompt("KEDCO Local Cloud staff email:", hint);
        if (email === null) throw new Error("Sign-in cancelled.");
        const password = window.prompt("KEDCO Local Cloud staff password:");
        if (password === null) throw new Error("Sign-in cancelled.");
        const result = await c.auth.signInWithPassword({ email: clean(email), password });
        if (result?.error) throw result.error;
        session = result?.data?.session || null;
      }
      if (!session?.access_token) throw new Error("The KEDCO backend did not return an authenticated session.");
      writeStoredSession(session);
      if (form && restoreMode === "reference" && restoreDate) {
        await enterReference(form, form.dataset.form, restoreDate);
      } else if (form) {
        setStatus(form, "KEDCO SESSION RESTORED · LIVE LOAD AND AUTOSAVE RESUMED", "ok");
      }
      scheduleLiveRefresh(40);
      retryDirtyForms(80);
      return session;
    })().finally(() => { sessionRecoveryPromise = null; });
    return sessionRecoveryPromise;
  }

  function installSessionRecovery(form) {
    const controls = form?.querySelector(".lf-history-controls");
    if (!controls || controls.querySelector("[data-lf-session-recover]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lf-history-upload";
    button.dataset.lfSessionRecover = "";
    button.textContent = "Sign in / Refresh Session";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try { await recoverSession(form); }
      catch (error) { setStatus(form, `SESSION RECOVERY FAILED · ${error?.message || error}`, "error"); }
      finally { button.disabled = false; }
    });
    const status = controls.querySelector("[data-lf-history-status]");
    controls.insertBefore(button, status || null);
  }

  async function refreshThroughBackend(c, session) {
    const stored = readStoredSession();
    const refreshToken = clean(session?.refresh_token || stored?.refresh_token);
    if (!refreshToken) throw new Error("KEDCO session expired. Please sign in again.");

    const response = await backendRequest(`${backendApiBase()}/api/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok || !payload?.session?.access_token || !payload?.session?.refresh_token) {
      throw new Error(clean(payload?.error) || "KEDCO session expired. Please sign in again.");
    }

    writeStoredSession(payload.session);
    try {
      const restored = await c.auth.setSession({
        access_token: payload.session.access_token,
        refresh_token: payload.session.refresh_token
      });
      if (!restored?.error && restored?.data?.session) return restored.data.session;
    } catch (_) {}
    return payload.session;
  }

  async function postBackendBatch(c, session, operations, allowRefresh=true) {
    const response = await backendRequest(`${backendApiBase()}/api/operations/load-flow/batch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ operations })
    });

    if (response.status === 401 && allowRefresh) {
      try {
        const refreshedSession = await refreshThroughBackend(c, session);
        return postBackendBatch(c, refreshedSession, operations, false);
      } catch (refreshError) {
        const err = new Error(refreshError?.message || "KEDCO session expired. Please sign in again.");
        err.status = 401;
        throw err;
      }
    }

    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      const main = clean(payload?.error) || `Backend load-flow save failed (${response.status})`;
      const details = clean(payload?.details);
      const code = clean(payload?.code);
      const extra = [code ? `code ${code}` : "", details].filter(Boolean).join(" · ");
      const err = new Error(extra ? `${main} · ${extra}` : main);
      err.status = response.status;
      err.code = code;
      err.details = details;
      throw err;
    }
    return payload;
  }

  async function publishBatch(c, session, operations) {
    const maxPerRequest = 1000;
    let saved = 0;
    try {
      for (let start=0; start<operations.length; start+=maxPerRequest) {
        const payload = await postBackendBatch(c, session, operations.slice(start,start+maxPerRequest));
        saved += Number(payload?.saved || 0);
      }
      return { saved, transport: "backend" };
    } catch (error) {
      if (Number(error?.status) !== 404 && !/failed to fetch|networkerror|load failed/i.test(String(error?.message || error))) throw error;
      for (let start=0; start<operations.length; start+=12) {
        const batch=operations.slice(start,start+12);
        await Promise.all(batch.map(args=>publishOperation(c,args)));
        saved += batch.length;
      }
      return { saved, transport: "direct-rpc-fallback" };
    }
  }

  async function backendFetchRows(id, date, c, session, allowRefresh=true) {
    const qs = new URLSearchParams({ form: id, date });
    const response = await backendRequest(`${backendApiBase()}/api/operations/load-flow/day?${qs}`, {
      headers: { "authorization": `Bearer ${session.access_token}` },
      cache: "no-store"
    });
    if (response.status === 401 && allowRefresh) {
      try {
        const refreshedSession = await refreshThroughBackend(c, session);
        return backendFetchRows(id, date, c, refreshedSession, false);
      } catch (refreshError) {
        const err = new Error(refreshError?.message || "KEDCO session expired. Please sign in again.");
        err.status = 401;
        throw err;
      }
    }
    let payload = {};
    try { payload = await response.json(); } catch (_) {}
    if (!response.ok) {
      const main = clean(payload?.error) || `Backend load-flow read failed (${response.status})`;
      const code = clean(payload?.code);
      const details = clean(payload?.details);
      const extra = [code ? `code ${code}` : "", details].filter(Boolean).join(" · ");
      const err = new Error(extra ? `${main} · ${extra}` : main);
      err.status = response.status;
      err.code = code;
      err.details = details;
      throw err;
    }
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    // Preserve the backend source alongside the rows so the selected-date
    // status can distinguish the shared live table from saved history.
    try {
      Object.defineProperties(rows, {
        kedcoDataSource: { value: clean(payload?.data_source), enumerable: false },
        kedcoSourceLabel: { value: clean(payload?.source_label), enumerable: false },
        kedcoFileAsset: { value: payload?.saved_file || null, enumerable: false }
      });
    } catch (_) {}
    return rows;
  }

  function referenceRowsFromValues(id, date, values, source="saved_file") {
    const prefix = id === "load33" ? "lf33_" : "lf11_";
    const rows = Object.entries(values && typeof values === "object" ? values : {})
      .filter(([field, value]) => String(field).startsWith(prefix) && value !== null && value !== undefined && clean(value) !== "")
      .map(([field, value], index) => {
        const match = String(field).match(/_h(\d+)$/i);
        const hour = match ? Number(match[1]) : null;
        return {
          id: `${source}:${date}:${index}`,
          source_table: source,
          operation_type: id === "load33" ? "LOAD_FLOW_33KV" : "LOAD_FLOW_11KV_SUBMISSION",
          voltage_level: id === "load33" ? "33KV" : "11KV",
          reading_date: date,
          reading_hour: Number.isInteger(hour) && hour >= 1 && hour <= 24 ? hour : null,
          status: "REFERENCE",
          payload: {
            field_name: field,
            field_value: String(value),
            raw_value: String(value),
            entry_mode: "REFERENCE",
            input_source: "LOCAL_SAVED_WORKBOOK"
          }
        };
      });
    try { Object.defineProperty(rows, "kedcoDataSource", { value: source, enumerable: false }); } catch (_) {}
    return rows;
  }

  async function rowsFromSavedWorkbook(form, id, date, auth, asset) {
    if (!asset?.storage_path || typeof window.lfImportPreviousExcel !== "function" || typeof window.lfHistoryGet !== "function") return [];
    const qs = new URLSearchParams({ form: id, date });
    const response = await backendRequest(`${backendApiBase()}/api/operations/load-flow/workbook?${qs}`, {
      headers: { "authorization": `Bearer ${auth.session.access_token}` },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Saved workbook request failed (${response.status}).`);
    const buffer = await response.arrayBuffer();
    const file = new File([buffer], asset.original_name || `${id}-${date}.xlsx`, { type: asset.mime_type || "application/octet-stream" });

    // Reuse the page's existing workbook mapper. It understands both daily
    // 33 kV sheets and the single-sheet 11 kV format, then stores the parsed
    // values in the same local history record used by both pages.
    setHistorySelectorsToDate(form, date);
    await refreshReferenceDays(form, id);
    await window.lfImportPreviousExcel(form, id, file);
    setHistorySelectorsToDate(form, date);
    await refreshReferenceDays(form, id);
    const record = await window.lfHistoryGet(id, date);
    const values = record?.data?.values || {};
    const rows = referenceRowsFromValues(id, date, values, "saved_file");
    try { Object.defineProperty(rows, "kedcoSourceLabel", { value: "local saved Analyzer workbook", enumerable: false }); } catch (_) {}
    return rows;
  }

  function formFor(id) {
    return document.querySelector(`#formCanvas form[data-form="${id}"]`) || document.querySelector(`form[data-form="${id}"]`);
  }

  function formMode(form) { return form?.dataset.kedcoLoadflowMode || "live"; }
  function setStatus(form, text, mode="ok") {
    const el = form?.querySelector("[data-lf-history-status]");
    if (el) { el.textContent = text; el.dataset.mode = mode; el.className = `lf-history-status ${mode}`; }
  }

  function payloads(row) {
    const out = [];
    if (row && typeof row === "object") out.push(row);
    const p = row?.payload;
    if (p && typeof p === "object") {
      out.push(p);
      for (const k of ["values","form_data","data","payload"]) if (p[k] && typeof p[k] === "object") out.push(p[k]);
    }
    for (const k of ["values","form_data","data"]) if (row?.[k] && typeof row[k] === "object") out.push(row[k]);
    return out;
  }
  function payloadValue(row, key) {
    for (const p of payloads(row)) if (Object.prototype.hasOwnProperty.call(p, key)) return p[key];
    return undefined;
  }
  function rowHour(row) {
    const raw = row?.reading_hour ?? row?.hour ?? row?.payload?.reading_hour ?? row?.payload?.hour;
    const n = Number(raw); if (!Number.isFinite(n)) return null;
    if (n === 0) return 24; return n >= 1 && n <= 24 ? n : null;
  }
  function rowTime(row) { return Date.parse(row?.event_time || row?.updated_at || row?.created_at || 0) || 0; }
  function isCleared(row) { return payloadValue(row, "cleared") === true; }
  function rawReading(row) {
    if (isCleared(row)) return "";
    for (const key of ["raw_value","value","mw","load_mw","reading_mw","load","reading","operational_code","operation_code","code","status_code"]) {
      const v = payloadValue(row, key);
      if (v !== undefined && v !== null && clean(v) !== "") return clean(v);
    }
    return "";
  }
  function numericReading(row) { return isCleared(row) ? null : numberOrNull(rawReading(row)); }
  function rowFeeder(row) { return clean(row?.feeder_name || row?.feeder || row?.payload?.feeder_name || row?.payload?.feeder); }
  function rowStation(row) { return clean(row?.station_name || row?.station || row?.payload?.station_name || row?.payload?.station); }

  function latestRows(rows) {
    const map = new Map();
    for (const row of rows || []) {
      const field = clean(payloadValue(row, "field_name"));
      const h = rowHour(row);
      const key = field || `${normalize(rowStation(row))}|${normalize(rowFeeder(row))}|${h ?? "daily"}`;
      const old = map.get(key);
      if (!old || rowTime(row) >= rowTime(old)) map.set(key, row);
    }
    return [...map.values()];
  }

  function selectedSheet(id) {
    const selectedFormField = (form,id,field) => {
      const control=form?.elements?.namedItem(field);
      const input=control?.closest ? control : control?.[0];
      if(!input)return null;
      const selector=id==='load33' ? 'tr[data-lf33-row]' : 'tr[data-lf11-row][data-feeder="1"]';
      const row=input.closest(selector);
      if(!row)return null;
      const feeder=id==='load33'
        ? clean(row.dataset.feeder)
        : clean(row.querySelector('.lf-feeder b')?.textContent||row.querySelector('.lf-feeder')?.textContent).replace(/^11\\s*K\\s*V\\s*/i,'');
      if(!feeder)return null;
      return {feeder_name:feeder,station_name:clean(id==='load33' ? row.dataset.source : row.dataset.station)};
    };
    const enrich=(rows,form=formFor(id))=>(rows||[]).map(row=>{
      if(rowFeeder(row))return row;
      const field=clean(payloadValue(row,'field_name'));
      const metadata=field?selectedFormField(form,id,field):null;
      return metadata?{...row,...metadata}:row;
    });
    stateV2.__enrichOverviewRows=enrich;
    const selected = stateV2.selectedSheets?.[id];
    if(selected && typeof selected === 'object'){
      selected.rows=latestRows(enrich(selected.rows||[]));
      return selected;
    }
    return { rows: [], date: '', mode: 'live', source: 'live_operations' };
  }

  function setSelectedSheet(id, rows, date, mode = 'live', source = 'live_operations') {
    selectedSheet(id);
    const sourceRows=Array.isArray(rows) ? rows : [];
    const enrichedRows=stateV2.__enrichOverviewRows ? stateV2.__enrichOverviewRows(sourceRows) : sourceRows;
    const selected = {
      rows: latestRows(enrichedRows),
      date: clean(date),
      mode: mode === 'reference' ? 'reference' : 'live',
      source: clean(source) || (mode === 'reference' ? 'saved_file' : 'live_operations')
    };
    stateV2.selectedSheets[id] = selected;
    // Keep the old 33 kV fields populated for any page bridge still reading them.
    if (id === 'load33') {
      stateV2.overview33 = selected.rows;
      stateV2.overview33Date = selected.date;
      stateV2.overview33Mode = selected.mode;
      stateV2.overview33Source = selected.source;
    }
    return selected;
  }

  function hasReadingValue(row) {
    if (isCleared(row)) return false;
    const fieldValue = payloadValue(row, 'field_value');
    return (fieldValue !== undefined && fieldValue !== null && clean(fieldValue) !== '')
      || rawReading(row) !== '';
  }

  function latestPopulatedHour(rows) {
    const current = latestRows(rows);
    for (let hour = 24; hour >= 1; hour--) {
      if (current.some(row => rowHour(row) === hour && hasReadingValue(row))) return hour;
    }
    return 0;
  }

  function friendlyLoadError(error) {
    const code = clean(error?.code || "");
    const message = clean(error?.message || error || "");
    if (code === "PGRST002" || /schema cache/i.test(message)) {
      const err = new Error("Local storage table is unavailable. Local readings remain in this browser; check the local backend data files.");
      err.code = "PGRST002";
      err.status = Number(error?.status) || 503;
      return err;
    }
    return error instanceof Error ? error : new Error(message || "Unable to load saved load-flow data.");
  }

  function isMissingKedcoSession(error) {
    const status = Number(error?.status || 0);
    const message = clean(error?.message || error || "");
    return status === 401 || /authenticated kedco session missing|session (?:could not be restored|expired)|sign in again/i.test(message);
  }

  function sessionRequiredMessage(mode) {
    return mode === "reference"
      ? "LOCAL CLOUD SESSION REQUIRED · Sign in / Refresh Session to view the selected date. Live entry remains available locally."
      : "LOCAL CLOUD SESSION REQUIRED · Sign in / Refresh Session to load shared values. Entry remains editable locally; new values will retry save.";
  }

  async function fetchRows(id, date, form=null) {
    const requestKey = `${id}|${date}`;
    const existing = rowFetchPromises.get(requestKey);
    if (existing) return existing;
    const request = (async () => {
    try {
      const auth = await ensureAuthenticatedClient(form);
      const rows = await backendFetchRows(id, date, auth.client, auth.session);
      if (!rows.length && rows.kedcoFileAsset) {
        try {
          const workbookRows = await rowsFromSavedWorkbook(form || formFor(id), id, date, auth, rows.kedcoFileAsset);
          if (workbookRows.length) return workbookRows;
        } catch (error) {
          console.warn("KEDCO saved load-flow workbook fallback unavailable:", error?.message || error);
        }
      }
      return rows;
    } catch (error) {
      // One authoritative read path: browser -> KEDCO backend. The backend
      // selects the live table or saved local history from the requested date.
      // Never fall back to the legacy browser-side dispatch views.
      throw friendlyLoadError(error);
    }
    })();
    rowFetchPromises.set(requestKey, request);
    try { return await request; }
    finally { if (rowFetchPromises.get(requestKey) === request) rowFetchPromises.delete(requestKey); }
  }

  // The visible date selector is calendar-driven. It must not depend on
  // Local storage availability: users can always select valid past dates.
  async function availableDates(_id, year, month) {
    const now = lagosNow();
    const y = Number(year), m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return [];
    const currentYear = Number(now.date.slice(0,4));
    const currentMonth = Number(now.date.slice(5,7));
    const currentDay = Number(now.date.slice(8,10));
    if (y > currentYear || (y === currentYear && m > currentMonth)) return [];
    let last = new Date(y, m, 0).getDate();
    if (y === currentYear && m === currentMonth) last = Math.min(last, currentDay);
    return Array.from({length:last}, (_,i) => `${y}-${pad(m)}-${pad(i+1)}`);
  }

  function historySelectedDate(form) {
    const y = form?.querySelector("[data-lf-history-year]")?.value;
    const m = form?.querySelector("[data-lf-history-month]")?.value;
    const d = form?.querySelector("[data-lf-history-day]")?.value;
    return y && m && d ? `${y}-${pad(m)}-${pad(d)}` : "";
  }

  function trackedInputs(form, id) {
    if (!form) return [];
    if (id === "load33") return [...form.querySelectorAll("[data-lf33-reading],[data-lf33-summary-input]")];
    return [...form.querySelectorAll('[data-lf11-reading],[data-lf11-result="previous"],[data-lf11-result="present"]')];
  }

  function clearTracked(form, id) {
    for (const el of trackedInputs(form,id)) el.value = "";
    try { if (typeof refreshKedcoLoadFlow === "function") refreshKedcoLoadFlow(form,id); } catch (_) {}
  }

  function fieldRow(form, id, input) {
    if (id === "load33") {
      const tr = input.closest("tr[data-lf33-row]");
      return {
        feeder: clean(tr?.dataset.feeder), station: clean(tr?.dataset.source), state: clean(tr?.dataset.state),
        region: "", hour: Number(input.dataset.hour || 0) || null
      };
    }
    const tr = input.closest('tr[data-lf11-row][data-feeder="1"]');
    return {
      feeder: clean(tr?.querySelector(".lf-feeder b")?.textContent || tr?.querySelector(".lf-feeder")?.textContent).replace(/^11\s*K\s*V\s*/i,""),
      station: clean(tr?.dataset.station), state: clean(tr?.dataset.state), region: "",
      hour: Number(input.dataset.hour || 0) || null
    };
  }

  function findFeederInput(form, id, row) {
    const h = rowHour(row); if (!h) return null;
    const feeder = normalize(rowFeeder(row)), station = normalize(rowStation(row));
    if (!feeder || feeder.startsWith("SYSTEMSUMMARY")) return null;
    if (id === "load33") {
      const rows = [...form.querySelectorAll("tr[data-lf33-row]")];
      const tr = rows.find(r => normalize(r.dataset.feeder)===feeder && (!station || normalize(r.dataset.source)===station)) || rows.find(r=>normalize(r.dataset.feeder)===feeder);
      return tr?.querySelector(`[data-lf33-reading][data-hour="${h}"]`) || null;
    }
    const rows = [...form.querySelectorAll('tr[data-lf11-row][data-feeder="1"]')];
    const tr = rows.find(r => normalize(r.querySelector(".lf-feeder")?.textContent)===feeder && (!station || normalize(r.dataset.station)===station)) || rows.find(r=>normalize(r.querySelector(".lf-feeder")?.textContent)===feeder);
    return tr?.querySelector(`[data-lf11-reading][data-hour="${h}"]`) || null;
  }

  function applyRowsToForm(form,id,rows,date) {
    if (!form) return;
    loadingForms.add(form);
    clearTracked(form,id);
    for (const row of latestRows(rows)) {
      const field = clean(payloadValue(row,"field_name"));
      const raw = isCleared(row) ? "" : (payloadValue(row,"field_value") ?? rawReading(row));
      let input = field ? form.elements?.namedItem(field) : null;
      if (!input) input = findFeederInput(form,id,row);
      if (input) input.value = raw == null ? "" : String(raw);
    }
    const prefix = id === "load33" ? "lf33" : "lf11";
    const dateInput = form.elements?.namedItem(`${prefix}_date`); if (dateInput) dateInput.value = date;
    try { if (typeof refreshKedcoLoadFlow === "function") refreshKedcoLoadFlow(form,id); } catch (_) {}
    loadingForms.delete(form);
    snapshotShadow(form,id);
  }

  function snapshotShadow(form,id) {
    const map = new Map();
    for (const el of trackedInputs(form,id)) if (el.name) map.set(el.name, clean(el.value));
    formShadow.set(form,map);
  }

  function hasUnsavedChanges(form,id) {
    const shadow=formShadow.get(form);
    if(!shadow)return false;
    return trackedInputs(form,id).some(el=>el.name && clean(el.value)!==(shadow.get(el.name)??""));
  }

  function setReadOnly(form,id,readOnly) {
    // trackedInputs() intentionally contains only fields that operators/dispatchers
    // are allowed to type or paste into. Calculated MIN/AVG/MAX/variance fields are
    // not in this list. Therefore LIVE mode must explicitly remove any stale
    // readonly attribute left by an older controller/browser cache.
    for (const el of trackedInputs(form,id)) {
      el.readOnly = !!readOnly;
      if (readOnly) el.setAttribute("readonly", "");
      else { el.removeAttribute("readonly"); el.disabled = false; }
      delete el.dataset.kedcoOriginalReadonly;
    }
    for (const el of form.querySelectorAll("[data-lf33-smart-paste],[data-lf11-smart-paste],[data-lf33-apply-paste],[data-lf11-apply-paste]")) el.disabled = !!readOnly;
    const dateInput = form.elements?.namedItem(id === "load33" ? "lf33_date" : "lf11_date"); if (dateInput) dateInput.readOnly = true;
  }

  function setHistorySelectorsToDate(form,date) {
    if (!form || !date) return;
    const [y,m,d] = String(date).split("-").map(Number);
    const year = form.querySelector("[data-lf-history-year]");
    const month = form.querySelector("[data-lf-history-month]");
    const day = form.querySelector("[data-lf-history-day]");
    if (year && y) year.value = String(y);
    if (month && m) month.value = String(m);
    if (day && d) day.dataset.kedcoPreferredDay = String(d);
  }

  function capHistoryMonthsAtToday(form) {
    const now=lagosNow();
    const year=form?.querySelector("[data-lf-history-year]");
    const month=form?.querySelector("[data-lf-history-month]");
    if(!year||!month)return;
    const selectedYear=Number(year.value);
    const currentYear=Number(now.date.slice(0,4));
    const currentMonth=Number(now.date.slice(5,7));
    for(const option of month.options){
      const future=selectedYear===currentYear && Number(option.value)>currentMonth;
      option.disabled=future;
      option.hidden=future;
    }
    if(selectedYear===currentYear && Number(month.value)>currentMonth) month.value=String(currentMonth);
  }

  function decorate(form,id) {
    if (!form || form.dataset.kedcoRealtimeDecorated === "1") return;
    form.dataset.kedcoRealtimeDecorated = "1";
    const now = lagosNow();
    const bar = form.querySelector("[data-lf-history-bar]");
    if (bar) {
      const strong = bar.querySelector(".lf-history-head strong");
      if (strong) strong.textContent = `LIVE TODAY + LOCAL CLOUD HISTORY · 2016 → ${now.date.slice(0,4)}`;
      const view = bar.querySelector("[data-lf-history-view]"); if (view) view.textContent = "View Selected Date";
      const controls = bar.querySelector(".lf-history-controls");
      if (controls && !controls.querySelector("[data-lf-return-live]")) {
        const live = document.createElement("button");
        live.type="button"; live.className="lf-history-primary kedco-live-return"; live.dataset.lfReturnLive=""; live.textContent=`LIVE Today · ${now.date}`;
        controls.insertBefore(live, view || controls.lastElementChild);
      }
      installSessionRecovery(form);
      if (!bar.querySelector("[data-kedco-live-mode-note]")) {
        const note=document.createElement("div"); note.dataset.kedcoLiveModeNote=""; note.className="kedco-live-mode-note";
        bar.appendChild(note);
      }
    }
    form.dataset.kedcoLoadflowMode = "live";
    setReadOnly(form,id,!canEditLive);
    // Initial opening always points the visible selectors at today, but later
    // selector browsing is left untouched until the user explicitly presses a button.
    setHistorySelectorsToDate(form,now.date);
    capHistoryMonthsAtToday(form);
    refreshReferenceDays(form,id);
  }

  function modeNote(form,id,date,mode) {
    const note=form?.querySelector("[data-kedco-live-mode-note]"); if(!note)return;
    const now=lagosNow();
    note.dataset.mode=mode;
    if(mode==="live") note.textContent = `LIVE TODAY · ${isDispatch?"DISPATCH":"OPERATOR"} · ${date} · CURRENT OPERATING HOUR H${pad(now.hour)} · Type/paste readings here. Year/Month/Date remain visible for browsing, but LIVE Today stays on screen until View Selected Date is pressed.`;
    else note.textContent = `REFERENCE OVERRIDE · ${date} · historical Local Cloud sheet · read-only · review/export only. The selectors remain visible; press LIVE Today or select ${now.date} + View Selected Date to return to the shared live sheet.`;
  }

  async function refreshReferenceDays(form,id) {
    const yearEl=form?.querySelector("[data-lf-history-year]");
    const monthEl=form?.querySelector("[data-lf-history-month]");
    const day=form?.querySelector("[data-lf-history-day]");
    if(!yearEl||!monthEl||!day)return;

    const now=lagosNow();
    const year=Number(yearEl.value), month=Number(monthEl.value);
    const currentYear=Number(now.date.slice(0,4));
    const currentMonth=Number(now.date.slice(5,7));
    const currentDay=Number(now.date.slice(8,10));
    if(!Number.isInteger(year)||!Number.isInteger(month)||month<1||month>12)return;

    let lastDay=new Date(year,month,0).getDate();
    const isFuture=year>currentYear || (year===currentYear && month>currentMonth);
    if(isFuture) lastDay=0;
    else if(year===currentYear && month===currentMonth) lastDay=Math.min(lastDay,currentDay);

    const preferredRaw=Number(day.dataset.kedcoPreferredDay || day.value || 0);
    delete day.dataset.kedcoPreferredDay;
    let preferred=preferredRaw;
    if(!(preferred>=1 && preferred<=lastDay)) {
      preferred=(year===currentYear&&month===currentMonth)?currentDay:(lastDay?Math.min(currentDay,lastDay):0);
    }

    const options=[];
    for(let d=1;d<=lastDay;d++){
      const date=`${year}-${pad(month)}-${pad(d)}`;
      const label=date===now.date?`${pad(d)} · LIVE TODAY`:pad(d);
      options.push(`<option value="${d}" ${d===preferred?"selected":""}>${label}</option>`);
    }
    day.innerHTML=options.length?options.join(""):'<option value="">No previous date available</option>';

    const badge=form.querySelector("[data-lf-history-count]");
    if(badge){
      if(!lastDay) badge.textContent="NO PREVIOUS DATE";
      else if(year===currentYear&&month===currentMonth) badge.textContent=`01–${pad(lastDay)} AVAILABLE · LIVE THROUGH TODAY`;
      else badge.textContent=`01–${pad(lastDay)} AVAILABLE FOR REFERENCE`;
    }
    if(id==="load33")scheduleMonth33(form,120);
  }

  async function enterLive(form,id,{syncSelectors=true,forceReload=false}={}) {
    decorate(form,id);
    const now=lagosNow();
    const requestToken=`live:${Date.now()}:${Math.random()}`;
    form.dataset.kedcoLoadflowRequest=requestToken;
    const wasReference=formMode(form)==="reference";

    // LIVE Today is a selected dataset too. Clear only this voltage sheet's
    // reference selection immediately; the fetch below supplies fresh rows.
    const liveRows=stateV2.date===now.date?(stateV2[id]||[]):[];
    setSelectedSheet(id,liveRows,now.date,'live','live_operations');

    // The Dispatch Overview follows the selected 33 kV sheet. Switch it back
    // to the last known live rows immediately when LIVE Today is pressed; the
    // request below then replaces those rows with the newest live values.
    if(isDispatch&&id==="load33"&&(wasReference||stateV2.overview33Mode==="reference")){
      stateV2.overview33=latestRows(stateV2.load33||[]);
      stateV2.overview33Date=now.date;
      stateV2.overview33Mode="live";
      stateV2.overview33Source="live_operations";
      renderOverview();
    }

    // NEVER destroy unsaved operator/dispatcher readings. Persist them before any
    // navigation/reload attempt and keep the visible grid intact until the backend
    // confirms the save.
    const unsaved = hasUnsavedChanges(form,id);
    if (unsaved) persistDirtyBuffer(form,id);

    form.dataset.kedcoLoadflowMode="live";
    setReadOnly(form,id,false);
    modeNote(form,id,now.date,"live");
    if(syncSelectors){setHistorySelectorsToDate(form,now.date);await refreshReferenceDays(form,id);}
    const liveButton=form.querySelector("[data-lf-return-live]");
    if(liveButton)liveButton.textContent=`LIVE Today · ${now.date}`;

    if (unsaved && !forceReload) {
      const dirtyCount = persistDirtyBuffer(form,id);
      setStatus(form,`LIVE TODAY · ${now.date} · ${dirtyCount} UNSAVED LOCAL FIELD${dirtyCount===1?"":"S"} PRESERVED · AUTOSAVE RETRY ACTIVE · LIVE DATA WILL NOT OVERWRITE THEM`,"warn");
      schedulePublish(form,id,80);
      return;
    }

    setStatus(form,`LIVE TODAY · LOADING ${now.date} · H${pad(now.hour)}…`,"warn");
    try{
      const rows=await fetchRows(id,now.date,form);
      if(form.dataset.kedcoLoadflowRequest!==requestToken||formMode(form)!=="live")return;
      stateV2[id]=rows; stateV2.date=now.date; stateV2.hour=now.hour; stateV2.updatedAt=new Date().toISOString();
      setSelectedSheet(id,rows,now.date,'live',rows.kedcoDataSource||'live_operations');
      if(isDispatch&&id==="load33"){
        stateV2.overview33=latestRows(rows);
        stateV2.overview33Date=now.date;
        stateV2.overview33Mode="live";
        stateV2.overview33Source=rows.kedcoDataSource||"live_operations";
        renderOverview();
      }
      applyRowsToForm(form,id,rows,now.date);

      // A failed save from a previous reload/tab is restored on top of local backend data.
      const restored=restoreDirtyBuffer(form,id,now.date);
      setReadOnly(form,id,!canEditLive);
      if(id==="load33")scheduleMonth33(form,180);
      if(restored){
        overlayLocalStateFromForm(form,id);
        setStatus(form,`LIVE TODAY · ${now.date} · ${restored} UNSAVED LOCAL FIELD${restored===1?"":"S"} RESTORED · AUTOSAVE RETRY ACTIVE`,"warn");
        schedulePublish(form,id,120);
      } else {
        setStatus(form,`LIVE TODAY · ${now.date} · CURRENT H${pad(now.hour)} · ${latestRows(rows).length} STORED FIELD RECORD${latestRows(rows).length===1?"":"S"} · EDITABLE + AUTOSAVE`,"ok");
      }
    }catch(e){
      if(form.dataset.kedcoLoadflowRequest!==requestToken||formMode(form)!=="live")return;
      setReadOnly(form,id,false);
      snapshotShadow(form,id);
      const restored=restoreDirtyBuffer(form,id,now.date);
      const missingSession=isMissingKedcoSession(e);
      const restoredNote=restored ? " · " + restored + " LOCAL UNSAVED FIELD" + (restored===1 ? "" : "S") + " RESTORED" : "";
      const statusMessage=missingSession
        ? sessionRequiredMessage("live") + restoredNote
        : "LIVE LOCAL CLOUD LOAD ERROR · " + (e.message||e) + " · ENTRY REMAINS EDITABLE" + restoredNote + "; NEW VALUES WILL RETRY SAVE";
      setStatus(form,statusMessage,missingSession?"warn":"error");
    }
  }

  async function enterReference(form,id,date) {
    if(!date){setStatus(form,"Select a Local Cloud date first.","warn");return;}
    const now=lagosNow();
    const requestToken=`reference:${date}:${Date.now()}:${Math.random()}`;
    form.dataset.kedcoLoadflowRequest=requestToken;
    if(formMode(form)==="live" && hasUnsavedChanges(form,id)) persistDirtyBuffer(form,id);
    // Present date is never treated as a historical reference. Selecting today
    // explicitly keeps/returns the shared editable LIVE Today sheet.
    if(date===now.date){await enterLive(form,id,{syncSelectors:false});return;}
    decorate(form,id); form.dataset.kedcoLoadflowMode="reference"; setReadOnly(form,id,true); modeNote(form,id,date,"reference");
    setStatus(form,`REFERENCE · LOADING ${date}…`,"warn");
    try{
      const rows=await fetchRows(id,date,form);
      if(form.dataset.kedcoLoadflowRequest!==requestToken||formMode(form)!=="reference"||historySelectedDate(form)!==date)return;
      applyRowsToForm(form,id,rows,date);
      setSelectedSheet(id,rows,date,'reference',rows.kedcoDataSource||'saved_file');
      if(isDispatch&&id==="load33"){
        stateV2.overview33=latestRows(rows);
        stateV2.overview33Date=date;
        stateV2.overview33Mode="reference";
        stateV2.overview33Source=rows.kedcoDataSource||"saved_file";
        renderOverview();
      }
      if(id==="load33")scheduleMonth33(form,180);
      const source=rows.kedcoDataSource==="saved_file"?"SAVED WORKBOOK · HEADER ALIGNED 01→01":rows.kedcoDataSource==="saved_snapshot"?"SAVED SNAPSHOT":rows.kedcoDataSource==="saved_folder"?"SAVED FOLDER":"LOCAL CLOUD";
      const emptyMessage=rows.kedcoDataSource==="saved_file"?`REFERENCE · ${date} · SAVED WORKBOOK FOUND · NO MAPPED READINGS`:`REFERENCE · ${date} · NO STORED READINGS`;
      setStatus(form,rows.length?`REFERENCE · ${date} · ${source} · ${latestRows(rows).length} FIELD RECORD${latestRows(rows).length===1?"":"S"} · READ ONLY`:emptyMessage,rows.length?"ok":"warn");
    }catch(e){
      if(form.dataset.kedcoLoadflowRequest===requestToken&&formMode(form)==="reference"){
        const missingSession=isMissingKedcoSession(e);
        setStatus(form,missingSession?sessionRequiredMessage("reference"):"REFERENCE ERROR · " + (e.message||e),missingSession?"warn":"error");
      }
    }
  }

  function sessionInfo() {
    try { return (typeof state !== "undefined" && state?.session) ? state.session : {}; } catch (_) { return {}; }
  }

  function recordArgs(form,id,input,raw) {
    const meta=fieldRow(form,id,input), n=numberOrNull(raw), now=lagosNow(), session=sessionInfo();
    const payload={
      field_name:input.name || "", field_value:raw, raw_value:raw, cleared:raw==="",
      reading_hour:meta.hour, entry_mode:"LIVE", input_source:input.dataset.pasted==="1"?"PASTE":"MANUAL_OR_PASTE",
      operator_name:clean(session?.name || session?.email || "KEDCO Operator"),
      source_form:`${isOperator?"operator":"dispatch"}.html:${id}`, saved_at:new Date().toISOString()
    };
    if(n!==null) payload.mw=n; else if(raw) payload.operational_code=raw;
    const isSummary=id==="load33" && input.matches("[data-lf33-summary-input]");
    if(isSummary && input.name) payload[input.name]=n!==null?n:raw;
    const feeder=isSummary?"__SYSTEM_SUMMARY__":meta.feeder;
    const station=isSummary?"KEDCO SYSTEM":meta.station;
    return {
      requested_operation_type:id==="load33"?"LOAD_FLOW_33KV":"LOAD_FLOW_11KV",
      requested_station_name:station||null, requested_region_name:meta.region||null, requested_state_code:meta.state||null,
      requested_voltage_level:id==="load33"?"33KV":"11KV", requested_feeder_name:feeder||null,
      requested_reading_date:now.date, requested_reading_hour:meta.hour,
      requested_shift:clean(session?.shift)||null, requested_status:"LIVE",
      requested_summary:`${id==="load33"?"33 kV":"11 kV"} · ${feeder||"SYSTEM"} · ${meta.hour?`H${pad(meta.hour)}`:"DAILY"} · ${raw||"CLEARED"}`,
      requested_payload:payload
    };
  }

  function localStateRow(form,id,input,raw) {
    const args=recordArgs(form,id,input,raw);
    const sourceIdentity=newSourceRecordId();
    return {
      source_table: LIVE_TABLE,
      source_record_id: sourceIdentity,
      source_key: sourceIdentity,
      operation_type: args.requested_operation_type,
      station_name: args.requested_station_name,
      region_name: args.requested_region_name,
      state_code: args.requested_state_code,
      voltage_level: args.requested_voltage_level,
      feeder_name: args.requested_feeder_name,
      reading_date: args.requested_reading_date,
      reading_hour: args.requested_reading_hour,
      shift: args.requested_shift,
      status: args.requested_status,
      summary: args.requested_summary,
      payload: args.requested_payload,
      event_time: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      __local_unsaved: true
    };
  }

  // Keep Dispatch Overview tied to the current live sheet even during a transient
  // Local save failure. Only fields that differ from the last saved value
  // snapshot are overlaid, so historical/saved values are never replaced by empty
  // form defaults. Once autosave succeeds, refreshLive() replaces these rows with
  // authoritative local records.
  function overlayLocalStateFromForm(form,id) {
    if (!form || !FORM_IDS.has(id) || formMode(form)!=="live") return 0;
    const now=lagosNow();
    const shadow=formShadow.get(form) || new Map();
    const local=[];
    for (const input of trackedInputs(form,id)) {
      if (!input.name) continue;
      const raw=clean(input.value);
      const old=shadow.get(input.name) ?? "";
      if (raw===old) continue;
      local.push(localStateRow(form,id,input,raw));
    }
    if (!local.length) return 0;
    const base=(stateV2.date===now.date && Array.isArray(stateV2[id])) ? stateV2[id] : [];
    stateV2[id]=latestRows([...base,...local]);
    stateV2.date=now.date;
    stateV2.hour=now.hour;
   stateV2.updatedAt=new Date().toISOString();
    if(selectedSheet(id).mode!=='reference') setSelectedSheet(id,stateV2[id],now.date,'live',selectedSheet(id).source||'live_operations');
   if (isDispatch) renderOverview();
    return local.length;
  }

  async function publishOperation(client,args) {
    const result=await client.rpc("kedco_publish_station_operation",args);
    if(!result?.error)return result;

    // Any RPC failure gets one authenticated direct-table attempt. This is
    // important for upgraded KEDCO schemas where source_table became NOT NULL
    // but an older deployed RPC still inserts without that newer column.
    const sourceIdentity=newSourceRecordId();
    const row={
      source_table: LIVE_TABLE,
      source_record_id: sourceIdentity,
      source_key: sourceIdentity,
      operation_type:args.requested_operation_type,
      station_name:args.requested_station_name,
      region_name:args.requested_region_name,
      state_code:args.requested_state_code,
      voltage_level:args.requested_voltage_level,
      feeder_name:args.requested_feeder_name,
      reading_date:args.requested_reading_date,
      reading_hour:args.requested_reading_hour,
      shift:args.requested_shift,
      status:args.requested_status || "LIVE",
      summary:args.requested_summary,
      payload:args.requested_payload || {}
    };
    const fallback=await client.from(LIVE_TABLE).insert(row).select("id").single();
    if(fallback?.error){
      const rpcMessage=clean(result.error?.message || result.error?.details || result.error);
      const tableMessage=clean(fallback.error?.message || fallback.error?.details || fallback.error);
      const err=new Error([rpcMessage,tableMessage].filter(Boolean).join(" · ") || "Local Cloud rejected this reading");
      err.code=clean(fallback.error?.code || result.error?.code);
      throw err;
    }
    return fallback;
  }

  async function publishChanges(form,id) {
    if(!canEditLive || !form || publishingForms.has(form) || formMode(form)!=="live" || loadingForms.has(form))return;
    const now=lagosNow();
    const dateElement=form.elements?.namedItem(id==="load33"?"lf33_date":"lf11_date");
    if(dateElement && clean(dateElement.value)!==now.date) dateElement.value=now.date;

    const shadow=formShadow.get(form)||new Map(), changes=[];
    for(const el of trackedInputs(form,id)){
      if(!el.name)continue;
      const value=clean(el.value), old=shadow.get(el.name)??"";
      if(value!==old)changes.push({el,value,old});
    }
    if(!changes.length)return;

    let auth;
    try { auth=await ensureAuthenticatedClient(form); }
    catch (e) {
      const oldRetry=publishRetryTimers.get(form); if(oldRetry)clearTimeout(oldRetry);
      publishRetryTimers.set(form,setTimeout(()=>{publishRetryTimers.delete(form);publishChanges(form,id)},5000));
      return;
    }

    publishingForms.add(form);
    setStatus(form,`LIVE · AUTOSAVING ${changes.length} CHANGED FIELD${changes.length===1?"":"S"} THROUGH KEDCO BACKEND…`,"warn");
    let saveSucceeded=false;
    try{
      const operations=changes.map(ch=>recordArgs(form,id,ch.el,ch.value));
      const result=await publishBatch(auth.client,auth.session,operations);
      const savedCount=Number(result?.saved);
      if(result?.transport==="backend"&&Number.isFinite(savedCount)&&savedCount<operations.length)throw new Error(`Backend confirmed ${savedCount} of ${operations.length} pasted fields; the remaining fields will be retried automatically.`);
      for(const ch of changes)shadow.set(ch.el.name,ch.value);
      formShadow.set(form,shadow); saveSucceeded=true;
      if (hasUnsavedChanges(form,id)) persistDirtyBuffer(form,id);
      else clearDirtyBuffer(id,now.date);
      // Remove the just-confirmed local-overlay rows, then immediately re-overlay
      // any edits made while this save request was in flight.
      stateV2[id]=(stateV2[id]||[]).filter(row=>row?.__local_unsaved!==true);
      overlayLocalStateFromForm(form,id);
      const oldRetry=publishRetryTimers.get(form); if(oldRetry)clearTimeout(oldRetry); publishRetryTimers.delete(form);
      setStatus(form,`LIVE AUTOSAVED ✓ · ${now.date} · ${result.saved||changes.length} FIELD${(result.saved||changes.length)===1?"":"S"} · ${result.transport==="backend"?"BACKEND BATCH":"DIRECT RPC FALLBACK"}`,"ok");
      if(id==="load33")scheduleMonth33(form,900);
      scheduleLiveRefresh(350);
      try { document.dispatchEvent(new CustomEvent("kedco:loadflow-autosaved",{detail:{formId:id,count:changes.length,date:now.date}})); } catch (_) {}
    }catch(e){
      console.error("KEDCO live load-flow save failed",e);setReadOnly(form,id,false);
      const dirtyCount=persistDirtyBuffer(form,id);
      setStatus(form,`LIVE AUTOSAVE FAILED · ${e.message||e} · ${dirtyCount} UNSAVED FIELD${dirtyCount===1?"":"S"} SAFELY KEPT LOCALLY + ON SCREEN; AUTOMATIC RETRY IN 5 SECONDS`,"error");
      const oldRetry=publishRetryTimers.get(form); if(oldRetry)clearTimeout(oldRetry);
      publishRetryTimers.set(form,setTimeout(()=>{publishRetryTimers.delete(form);publishChanges(form,id)},5000));
    } finally {
      publishingForms.delete(form);
      if(saveSucceeded&&formMode(form)==="live"&&hasUnsavedChanges(form,id))schedulePublish(form,id,180);
    }
  }

  function schedulePublish(form,id,delay=650){
    const old=publishTimers.get(form);if(old)clearTimeout(old);
    const timer=setTimeout(()=>{publishTimers.delete(form);publishChanges(form,id)},delay);
    publishTimers.set(form,timer);
  }

  function summaryField(rows,name) {
    let best=null;
    for(const row of latestRows(rows)){
      if(clean(payloadValue(row,"field_name"))!==name)continue;
      if(!best||rowTime(row)>=rowTime(best))best=row;
    }
    if(!best||isCleared(best))return null;
    return numberOrNull(payloadValue(best,"field_value") ?? payloadValue(best,name) ?? rawReading(best));
  }

  function feederLatestForHour(rows,hour) {
    const map=new Map();
    for(const row of rows||[]){
      if(rowHour(row)!==hour)continue;
      const feeder=normalize(rowFeeder(row)), station=normalize(rowStation(row));
      if(!feeder||feeder.startsWith("SYSTEMSUMMARY"))continue;
      const key=`${station}|${feeder}`, old=map.get(key); if(!old||rowTime(row)>=rowTime(old))map.set(key,row);
    }
    return [...map.values()];
  }
  function sumHour(rows,hour){const vals=feederLatestForHour(rows,hour).map(numericReading).filter(v=>v!==null);return vals.length?vals.reduce((a,b)=>a+b,0):null;}
  function series(rows){return Array.from({length:24},(_,i)=>sumHour(rows,i+1));}
  function energyThrough(rows,hour){
    let total=0,found=false;
    for(let h=1;h<=hour;h++){
      const recorded=summaryField(rows,`lf33_totalEnergy_h${h}`);
      const v=recorded!==null?recorded:sumHour(rows,h);
      if(v!==null){total+=v;found=true;}
    }
    return found?total/1000:null;
  }
  async function fetch33MonthRows(year,month,form=null){
    const now = lagosNow();
    const y=Number(year), m=Number(month);
    if(!Number.isInteger(y)||!Number.isInteger(m)||m<1||m>12)return [];
    const currentYear=Number(now.date.slice(0,4)), currentMonth=Number(now.date.slice(5,7)), currentDay=Number(now.date.slice(8,10));
    if(y>currentYear || (y===currentYear && m>currentMonth))return [];
    let last=new Date(y,m,0).getDate();
    if(y===currentYear&&m===currentMonth)last=Math.min(last,currentDay);

    let auth;
    try{auth=await ensureAuthenticatedClient(form);}catch(error){throw friendlyLoadError(error);}
    const out=[];
    // Backend-only archive read. Small concurrency keeps the month view responsive
    // while using the local data endpoints.
    for(let start=1;start<=last;start+=5){
      const days=Array.from({length:Math.min(5,last-start+1)},(_,i)=>start+i);
      const pages=await Promise.all(days.map(async d=>{
        const date=`${y}-${pad(m)}-${pad(d)}`;
        try{return await backendFetchRows("load33",date,auth.client,auth.session);}
        catch(error){throw friendlyLoadError(error);}
      }));
      for(const rows of pages)out.push(...rows);
    }
    return out;
  }

  function monthStats33(rows,year,month){
    const byField=new Map();
    for(const row of rows||[]){
      const date=clean(row.reading_date).slice(0,10);if(!date)continue;
      const candidates=[];
      const direct=clean(payloadValue(row,"field_name"));
      if(/^lf33_totalEnergy_h(?:[1-9]|1\d|2[0-4])$/.test(direct))candidates.push([direct,payloadValue(row,"field_value")??rawReading(row),isCleared(row)]);
      // Legacy snapshots may contain all named form fields inside values/form_data/data.
      for(const obj of payloads(row)){
        for(const [key,value] of Object.entries(obj||{}))if(/^lf33_totalEnergy_h(?:[1-9]|1\d|2[0-4])$/.test(key))candidates.push([key,value,false]);
      }
      for(const [field,value,cleared] of candidates){
        const key=`${date}|${field}`,old=byField.get(key);
        if(!old||rowTime(row)>=old.time)byField.set(key,{value,cleared,time:rowTime(row)});
      }
    }
    let totalMWh=0,totalHours=0;const savedDays=new Set();
    for(const [key,item] of byField){if(item.cleared)continue;const n=numberOrNull(item.value);if(n===null)continue;totalMWh+=n;totalHours++;savedDays.add(key.slice(0,10));}
    const daysInMonth=new Date(Number(year),Number(month),0).getDate(),fullHours=daysInMonth*24,avgMW=totalHours?totalMWh/totalHours:0,recordedGWh=totalMWh/1000,coverage=fullHours?totalHours/fullHours:0,complete=totalHours===fullHours,projectedGWh=totalHours?(complete?recordedGWh:avgMW*fullHours/1000):0;
    return {daysInMonth,fullHours,totalHours,saved:savedDays.size,totalMWh,avgMW,recordedGWh,coverage,complete,projectedGWh};
  }

  async function renderSupabaseMonth33(form){
    if(!form||form.dataset.form!=="load33")return;
    const year=Number(form.querySelector("[data-lf-history-year]")?.value)||Number(lagosNow().date.slice(0,4));
    const month=Number(form.querySelector("[data-lf-history-month]")?.value)||Number(lagosNow().date.slice(5,7));
    const labelNames=["January","February","March","April","May","June","July","August","September","October","November","December"];
    const set=(sel,val)=>{const el=form.querySelector(sel);if(el)el.textContent=val};
    set("[data-lf33-month-label]",`${labelNames[month-1]} ${year}`);
    try{
      const rows=await fetch33MonthRows(year,month,form),st=monthStats33(rows,year,month);
      const remaining=Math.max(0,st.projectedGWh-st.recordedGWh),canvas=form.querySelector("[data-lf33-monthly-energy-pie]");
      try{if(canvas&&typeof lfDrawDonut==="function")lfDrawDonut(canvas,[{value:st.recordedGWh,color:"#0d7a48"},{value:remaining,color:"#d7a72b"}])}catch(_){}
      set("[data-lf33-monthly-gwh]",(st.complete?st.recordedGWh:st.projectedGWh).toFixed(3));
      set("[data-lf33-monthly-center-label]",st.complete?"GWh ACTUAL":"GWh PROJECTED");
      set("[data-lf33-month-saved]",`${st.saved} / ${st.daysInMonth}`);
      set("[data-lf33-month-hours]",`${st.totalHours} / ${st.fullHours}`);
      set("[data-lf33-month-avg]",`${st.avgMW.toFixed(2)} MW`);
      set("[data-lf33-month-recorded]",`${st.recordedGWh.toFixed(3)} GWh`);
      set("[data-lf33-month-coverage]",`${(st.coverage*100).toFixed(st.complete?0:1)}%`);
      const summary=form.querySelector("[data-lf33-monthly-energy-summary]");
      if(summary)summary.textContent=st.totalHours?`LOCAL CLOUD monthly archive · ${st.saved} saved day${st.saved===1?"":"s"} · ${st.totalHours}/${st.fullHours} hourly Total Energy Offtake readings · recorded ${st.recordedGWh.toFixed(3)} GWh${st.complete?"":` · projected ${st.projectedGWh.toFixed(3)} GWh`}.`:`No Local Cloud Total Energy Offtake records are available for ${labelNames[month-1]} ${year}.`;
    }catch(e){
      const summary=form.querySelector("[data-lf33-monthly-energy-summary]");
      if(summary)summary.textContent=isMissingKedcoSession(e)?sessionRequiredMessage("live"):"Local Cloud monthly archive unavailable: " + (e.message||e);
    }
  }

  function scheduleMonth33(form,delay=450){
    if(!form||form.dataset.form!=="load33")return;const old=monthTimers.get(form);if(old)clearTimeout(old);const t=setTimeout(()=>{monthTimers.delete(form);renderSupabaseMonth33(form)},delay);monthTimers.set(form,t);
  }

  function classifyRaw(raw){
    const s=clean(raw); if(numberOrNull(s)!==null)return {kind:"on",label:`${numberOrNull(s).toFixed(2)} MW`};
    if(!s)return {kind:"nodata",label:"NO DATA"};
    let group=""; try{if(typeof classifyOperationalCode==="function")group=classifyOperationalCode(s)}catch(_){}
    if(/Active Load/i.test(group)||/^(ON|ON SOAK)$/i.test(s))return {kind:"on",label:s};
    if(/Unknown|Review|Exception|Contamination/i.test(group))return {kind:"review",label:s};
    return {kind:"off",label:s};
  }

  const eventHTML = value => clean(value).replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char]));
  function recentEventView(record, fallback=false) {
    const operation = fallback
      ? clean(record?.type || "OPERATION")
      : (typeof dailyOperationLabel === "function" ? dailyOperationLabel(record?.category) : clean(record?.category || "OPERATION"));
    const station = clean(record?.station || record?.source_station || "ALL NETWORKS");
    const feeder = clean(record?.feeder || "SYSTEM OPERATION");
    const reason = clean(record?.reason || record?.text || "");
    const status = clean(record?.status).toLowerCase()==="closed" ? "RESTORED" : "OPEN / ONGOING";
    const stamp = record?.opened_at || record?.time || record?.created_at || record?.updated_at;
    let time = "--:--";
    try { const date = new Date(stamp); if (!Number.isNaN(date.getTime())) time = date.toLocaleTimeString("en-GB", {hour:"2-digit", minute:"2-digit"}); } catch (_) {}
    const source = `${record?.entry_mode || ""} ${record?.input_source || ""} ${record?.source || ""}`;
    const mode = /AUTO|SYSTEM|IMPORT|QUICK|SYNC/i.test(source) ? "AUTO" : "MANUAL";
    const detail = reason && reason.toLowerCase() !== operation.toLowerCase() ? reason : "";
    return {id:clean(record?.id || `${stamp}|${station}|${feeder}|${operation}`),sortKey:Date.parse(stamp)||0,time,operation,station,feeder,detail,status,mode};
  }

  function installRecentEventLink() {
    const button=document.getElementById("openDailyLogFromEvents");
    if(!button||button.dataset.bound==="1")return;
    button.dataset.bound="1";
    button.addEventListener("click",event=>{
      event.preventDefault();event.stopPropagation();
      if(typeof window.showView==="function")window.showView("daily");
      else document.querySelector('.nav-item[data-view="daily"]')?.click();
    });
  }

  function installRecentEventScroll() {
    const box=document.getElementById("eventList");
    if(!box||box.dataset.autoScrollBound==="1")return;
    box.dataset.autoScrollBound="1";
    let direction=1,pausedUntil=0;
    const pause=()=>{pausedUntil=Date.now()+8000};
    ["mouseenter","pointerdown","wheel","touchstart","keydown"].forEach(type=>box.addEventListener(type,pause,{passive:true}));
    box.addEventListener("mouseleave",()=>{pausedUntil=Date.now()+1500});
    setInterval(()=>{
      if(document.hidden||Date.now()<pausedUntil||!document.getElementById("view-overview")?.classList.contains("active")||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
      const max=box.scrollHeight-box.clientHeight;if(max<=0)return;
      if(box.scrollTop>=max-1)direction=-1;else if(box.scrollTop<=1)direction=1;
      box.scrollTop+=direction;
    },55);
  }

  function renderRecentOperationalEvents(rows, fallback=false, unavailable=false) {
    const box=document.getElementById("eventList");if(!box)return;
    installRecentEventLink();installRecentEventScroll();
    const list=(rows||[]).map(row=>recentEventView(row,fallback)).sort((a,b)=>b.sortKey-a.sortKey||String(b.id).localeCompare(String(a.id))).slice(0,7);
    const signature=JSON.stringify({unavailable,list});
    if(box.dataset.recentEventsSignature===signature)return;
    box.dataset.recentEventsSignature=signature;
    if(!list.length){
      box.innerHTML=`<div class="empty">${unavailable?"DAILY LOG CONNECTION UNAVAILABLE · OPEN THE DAILY LOG TO RETRY":"NO DAILY LOG OPERATIONS RECORDED"}</div>`;
      return;
    }
    box.innerHTML=list.map(item=>`<div class="event" title="${eventHTML(`${item.station} · ${item.feeder} · ${item.status}`)}"><time>${eventHTML(item.time)}</time><b>${eventHTML(item.operation)}<small>${eventHTML(item.status)}</small></b><span><strong>${eventHTML(item.station)} · ${eventHTML(item.feeder)}</strong>${item.detail?`<em>${eventHTML(item.detail)}</em>`:""}</span><i class="event-mode event-mode-${item.mode.toLowerCase()}">${item.mode}</i></div>`).join("");
  }

  async function loadRecentOperationalEvents(force=false) {
    if(!isDispatch)return;
    if(!force&&(recentEventsRequest||Date.now()-recentEventsLoadedAt<15000))return recentEventsRequest;
    recentEventsRequest=(async()=>{
      try{
        const dailyClient=typeof dailyLocalClient==="function"?dailyLocalClient():null;
        if(!dailyClient)throw new Error("Daily Log client unavailable");
        const result=await dailyClient.from("daily_log_events").select("*").order("opened_at",{ascending:false}).limit(7);
        if(result?.error)throw result.error;
        renderRecentOperationalEvents(Array.isArray(result?.data)?result.data:[]);
      }catch(_){
        const fallbackRows=typeof state!=="undefined"&&Array.isArray(state?.events)?state.events.slice(0,7):[];
        renderRecentOperationalEvents(fallbackRows,true,!fallbackRows.length);
      }finally{recentEventsLoadedAt=Date.now();recentEventsRequest=null;}
    })();
    return recentEventsRequest;
  }

  function styledMetricLabel(value){
    const safe=eventHTML(value);
    const hourly=safe.match(/^(.*?)\s+AT\s+(H)?(\d+)\s+HRS\s+IS$/i);
    if(hourly)return `<span class="metric-label-title">${hourly[1]}</span><span class="metric-label-reference">AT ${hourly[2]||""}${hourly[3]} HRS IS</span>`;
    const reserve=safe.match(/^(.*?)\s*·\s*(LOAD\s+H\d+\s*\/\s*GENERATION\s+H\d+\s+IS)$/i);
    if(reserve)return `<span class="metric-label-title">${reserve[1]}</span><span class="metric-label-reference">· ${reserve[2]}</span>`;
    return `<span class="metric-label-title">${safe}</span>`;
  }
  function metric(id,value,unit,dec=1){const el=document.getElementById(id);if(el){const number=value===null?'&#8212;':Number(value).toFixed(dec);el.innerHTML=`<span class="metric-value-number">${number}</span> <span class="metric-value-unit">${eventHTML(unit)}</span>`;}}
  function renderOverview(){
    if(!isDispatch)return;
    const overview=document.getElementById("view-overview"); if(!overview)return;
    const now=lagosNow();
    const selected33=selectedSheet('load33'), selected11=selectedSheet('load11');
    const rows33=latestRows(selected33.rows||[]), rows11=latestRows(selected11.rows||[]);
    const reference33=selected33.mode==='reference';
    const reference11=selected11.mode==='reference';
    const overview33Date=clean(selected33.date)||now.date;
    const overview11Date=clean(selected11.date)||now.date;
    const h33=latestPopulatedHour(rows33), h11=latestPopulatedHour(rows11);
    const systemHour=h33;
    // Legacy overview branches below use h; keep it tied to the 33 kV system
    // hour so every KPI card remains on the same 33 kV reading.
    const h=systemHour;
    const s33=series(rows33), s11=series(rows11);
    const summaryAt=(field,hour)=>summaryField(rows33,`lf33_${field}_h${hour}`);
    // All center KPI cards are 33 kV system values and share one hour.
    const currentLoad=systemHour?(summaryAt('totalLoad',systemHour)??s33[systemHour-1]??null):null;
    const currentGeneration=systemHour?summaryAt('generation',systemHour):null;
    const currentAllocation=systemHour?summaryAt('kedcoAlloc',systemHour):null;
    const loadMetric={value:currentLoad===null?null:Number(currentLoad),hour:systemHour};
    const generationMetric={value:currentGeneration===null?null:Number(currentGeneration),hour:systemHour};
    const allocationMetric={value:currentAllocation===null?null:Number(currentAllocation),hour:systemHour};
    const load33=loadMetric.value;
    const load11=h11?s11[h11-1]:null;
    const energy=energyThrough(rows33,systemHour);
    // Reserve margin is a 33 kV reading pair. Do not substitute static feeder
    // capacity or generation from another hour when the selected hour is incomplete.
    const reserve=generationMetric.value!==null&&generationMetric.value>0&&load33!==null
      ? Math.max(0,(generationMetric.value-load33)/generationMetric.value*100)
      : null;
    const metricHour=()=>systemHour;
    metric("totalGeneration",energy,"GWh",3); metric("totalLoad",load33,"MW",1); metric("totalDemand",generationMetric.value,"MW",1); metric("reserveMargin",reserve,"%",1);
    const fm=document.getElementById("frequencyMirror"); if(fm)fm.innerHTML=allocationMetric.value===null?'&#8212;':`<span class="metric-value-number">${allocationMetric.value.toFixed(2)}</span>`;
    const labels={
      totalEnergyOfftakeLabel:`TOTAL ENERGY OFFTAKE AT ${pad(systemHour)} HRS IS`,
      kedcoTotalLoadLabel:`KEDCO TOTAL LOAD AT ${pad(metricHour(loadMetric))} HRS IS`,
      kedcoAllocationLabel:`KEDCO ALLOCATION AT ${pad(metricHour(allocationMetric))} HRS IS`,
      estimatedDemandLabel:`AVAILABLE GENERATION AT ${pad(metricHour(generationMetric))} HRS IS`,
      reserveMarginLabel:loadMetric.hour===generationMetric.hour
        ? `RESERVE MARGIN AT ${pad(metricHour(loadMetric))} HRS IS`
        : `RESERVE MARGIN · LOAD H${pad(metricHour(loadMetric))} / GENERATION H${pad(metricHour(generationMetric))} IS`
    };
    for(const [id,title] of Object.entries(labels)){const el=document.getElementById(id);if(el){el.innerHTML=styledMetricLabel(title);el.title=`${title} · ${overview33Date}`;}}
    loadRecentOperationalEvents();
    try{if(typeof drawBars==="function")drawBars(document.getElementById("hourlyChart"),s33);if(typeof drawLine==="function")drawLine(document.getElementById("dailyChart"),s11);}catch(_){}
    const chart33Title=document.querySelector("#view-overview .chart-panel-33 .chart-head span");
    if(chart33Title)chart33Title.textContent=`33 kV FEEDER HOURLY LOAD (MW) | ${reference33?'REFERENCE':'LIVE'} ${overview33Date} | H${pad(h33)}`;
    const total33=document.getElementById("hourlyTotal"),total11=document.getElementById("dailyTotal");
    const pastSum=(arr,hour)=>arr.slice(0,hour).filter(v=>v!==null).reduce((a,b)=>a+Number(b),0);
    if(total33)total33.textContent=`${pastSum(s33,h33).toFixed(1)} MWh`; if(total11)total11.textContent=`${pastSum(s11,h11).toFixed(1)} MWh`;

    // Current-hour feeder status — never substitute an older hour.
    const map33=new Map(feederLatestForHour(rows33,h33).map(r=>[normalize(rowFeeder(r)),r]));
    const map11=new Map(feederLatestForHour(rows11,h11).map(r=>[`${normalize(rowStation(r))}|${normalize(rowFeeder(r))}`,r]));
    let master33=[], master11=[];
    try { master33=(typeof TRANSMISSION_FEEDERS!=="undefined" && Array.isArray(TRANSMISSION_FEEDERS)) ? TRANSMISSION_FEEDERS : []; } catch (_) {}
    try { master11=(typeof INJECTION_STATIONS!=="undefined" && Array.isArray(INJECTION_STATIONS)) ? INJECTION_STATIONS : []; } catch (_) {}
    const f33=master33.map(f=>{const r=map33.get(normalize(f.name)),raw=r?rawReading(r):"",c=classifyRaw(raw);return {...f,voltage:"33 kV",conditionKind:c.kind,conditionLabel:c.label,conditionHour:h33,conditionRaw:raw};});
    const f11=master11.flatMap(s=>(s.feeders||[]).map(pair=>{const name=Array.isArray(pair)?pair[0]:pair?.name,band=Array.isArray(pair)?pair[1]:pair?.band;const r=map11.get(`${normalize(s.station)}|${normalize(name)}`)||[...map11.entries()].find(([k])=>k.endsWith(`|${normalize(name)}`))?.[1],raw=r?rawReading(r):"",c=classifyRaw(raw);return {name,band,station:s.station,source:s.sourceFeeder,voltage:"11 kV",conditionKind:c.kind,conditionLabel:c.label,conditionHour:h11,conditionRaw:raw};}));
    const counts=a=>({on:a.filter(x=>x.conditionKind==="on").length,off:a.filter(x=>x.conditionKind==="off").length,nodata:a.filter(x=>x.conditionKind==="nodata").length,review:a.filter(x=>x.conditionKind==="review").length});
    const c33=counts(f33),c11=counts(f11);
    try{if(typeof renderScadaFeeders==="function"){renderScadaFeeders(document.getElementById("scada33List"),f33);renderScadaFeeders(document.getElementById("scada11List"),f11);}if(typeof render33Topology==="function")render33Topology(f33);}catch(_){}
    const topologyTitle=document.querySelector("#kedco33Topology .kedco-topology-head span");
    if(topologyTitle)topologyTitle.textContent=`33 kV SOURCE–FEEDER MAP | ${reference33?'REFERENCE':'LIVE'} LOAD-FLOW | ${overview33Date} | H${pad(h33)}`;
    // Operational classification panel must use this same current hour, not the
    // legacy "latest populated column" or an archived sheet.
    const groupBox=document.getElementById("operationalGroupList");
    if(groupBox){
      let groups=[];try{groups=(typeof KEDCO_OPERATIONAL_GROUPS!=="undefined"&&Array.isArray(KEDCO_OPERATIONAL_GROUPS))?KEDCO_OPERATIONAL_GROUPS:[]}catch(_){}
      if(!groups.length)groups=["Active Load","Load Shedding","Fault/Outage","Breaker Fault","Planned Outage","KEDCO Maintenance/Emergency","TCN Maintenance/Transmission","Frequency Control","Meter Exception","Source Contamination","Ignored","Unknown—Pending Approval"];
      const gc=Object.fromEntries(groups.map(g=>[g,0]));
      for(const item of [...f33,...f11]){let g="Ignored";try{g=typeof classifyOperationalCode==="function"?classifyOperationalCode(item.conditionRaw):((item.conditionKind==="on")?"Active Load":(item.conditionKind==="nodata")?"Ignored":"Fault/Outage")}catch(_){}if(!(g in gc))g="Unknown—Pending Approval";gc[g]=(gc[g]||0)+1;}
      const cls={"Active Load":"group-active","Load Shedding":"group-shedding","Fault/Outage":"group-fault","Breaker Fault":"group-breaker","Planned Outage":"group-planned","KEDCO Maintenance/Emergency":"group-kedco","TCN Maintenance/Transmission":"group-tcn","Frequency Control":"group-frequency","Ignored":"group-ignored"};
      groupBox.innerHTML=groups.map(g=>`<div class="status-cell ${cls[g]||"group-review"}"><div><small>${g}</small><b>${gc[g]||0}</b><em>${reference33?"REFERENCE":"CURRENT"} H${pad(h)} · ${overview33Date}</em></div></div>`).join("");
    }
    const setText=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};
    setText("scada33Total",String(f33.length));setText("scada33On",`${c33.on} ON`);setText("scada33Off",`${c33.off} OFF · ${c33.nodata} NO DATA`);
    setText("scada11Total",String(f11.length));setText("scada11On",`${c11.on} ON`);setText("scada11Off",`${c11.off} OFF · ${c11.nodata} NO DATA`);
    setText("count33Label",`33 kV · ${reference33?"REFERENCE":"LIVE"} ${overview33Date} · H${pad(h)}`);setText("count11Label",`11 kV · LIVE ${now.date} · H${pad(h)}`);
    setText("criticalAlarmCount",String(c33.off+c11.off));setText("warningCount",String(c33.review+c11.review));setText("gridCondition",(c33.off+c11.off)?"ATTENTION":(c33.nodata+c11.nodata)?"CURRENT-HOUR DATA GAP":"NORMAL");
    const hasLocalUnsaved=[...rows33,...rows11].some(r=>r?.__local_unsaved===true);
    const hasCurrentNumeric=currentLoad!==null||currentGeneration!==null||currentAllocation!==null||load11!==null;
    const fallbackNote=!hasCurrentNumeric&&loadMetric.value!==null?` · LAST RECORDED H${pad(loadMetric.hour)}`:"";
    const chip=overview.querySelector(".live-chip");
    if(chip)chip.textContent=reference33?`LOCAL CLOUD REFERENCE · ${overview33Date} · H${pad(h)}`:hasLocalUnsaved?`LOCAL LIVE · AUTOSAVE PENDING · H${pad(h)}`:((load33!==null||load11!==null)?`LOCAL CLOUD LIVE · H${pad(h)}${fallbackNote}`:`WAITING H${pad(h)} READINGS`);
    overview.dataset.liveDate=overview33Date;overview.dataset.liveHour=String(h);overview.dataset.valueHour=String(loadMetric.hour||0);overview.dataset.dataSource=reference33?(stateV2.overview33Source||"saved_file"):hasLocalUnsaved?"local-unsaved-current-hour":"local-storage-current-hour";
    // Final KPI pass: the five center cards are 33 kV system cards and must
    // expose one shared hour even when 11 kV has a different last entry.
    const kpiHour=systemHour?pad(systemHour):'--';
    const kpiLabels={
      totalEnergyOfftakeLabel:`TOTAL ENERGY OFFTAKE AT ${kpiHour} HRS IS`,
      kedcoTotalLoadLabel:`KEDCO TOTAL LOAD AT ${kpiHour} HRS IS`,
      kedcoAllocationLabel:`KEDCO ALLOCATION AT ${kpiHour} HRS IS`,
      estimatedDemandLabel:`AVAILABLE GENERATION AT ${kpiHour} HRS IS`,
      reserveMarginLabel:`RESERVE MARGIN AT ${kpiHour} HRS IS`
    };
    for(const [id,title] of Object.entries(kpiLabels)){
      const el=document.getElementById(id);
      if(el){el.innerHTML=styledMetricLabel(title);el.title=`${title} | 33 kV selected data | ${overview33Date}`;}
    }
    const setTextFinal=(id,t)=>{const e=document.getElementById(id);if(e)e.textContent=t;};
   setTextFinal('count33Label',`33 kV | ${reference33?'REFERENCE':'LIVE'} ${overview33Date} | H${pad(h33)}`);
   setTextFinal('count11Label',`11 kV | ${reference11?'REFERENCE':'LIVE'} ${overview11Date} | H${pad(h11)}`);
    const selectedStatus=`33 kV ${reference33?'REFERENCE':'LIVE'} ${overview33Date} H${pad(h33)} | 11 kV ${reference11?'REFERENCE':'LIVE'} ${overview11Date} H${pad(h11)}`;
    const finalChip=overview.querySelector('.live-chip');
    if(finalChip)finalChip.textContent=reference33||reference11
      ? `LOCAL CLOUD SELECTED | ${selectedStatus}`
      : hasLocalUnsaved ? `LOCAL LIVE | AUTOSAVE PENDING | 33 kV H${pad(systemHour)}`
      : `LOCAL CLOUD LIVE | ${selectedStatus}`;

  }

  async function refreshLive() {
    const now=lagosNow();
    try{
      const local33=(stateV2.date===now.date?(stateV2.load33||[]):[]).filter(row=>row?.__local_unsaved===true);
      const local11=(stateV2.date===now.date?(stateV2.load11||[]):[]).filter(row=>row?.__local_unsaved===true);
      const [r33,r11]=await Promise.all([fetchRows("load33",now.date,formFor("load33")),fetchRows("load11",now.date,formFor("load11"))]);
      const reference33=stateV2.overview33Mode==="reference"&&!!stateV2.overview33Date;
      stateV2.date=now.date;stateV2.hour=now.hour;
      stateV2.load33=latestRows([...r33,...local33]);
      stateV2.load11=latestRows([...r11,...local11]);
      if(selectedSheet('load33').mode!=='reference') setSelectedSheet('load33',stateV2.load33,now.date,'live',r33.kedcoDataSource||'live_operations');
      if(selectedSheet('load11').mode!=='reference') setSelectedSheet('load11',stateV2.load11,now.date,'live',r11.kedcoDataSource||'live_operations');
      if(!reference33){
        stateV2.overview33=stateV2.load33;
        stateV2.overview33Date=now.date;
        stateV2.overview33Mode="live";
        stateV2.overview33Source=r33.kedcoDataSource||"live_operations";
      }
      stateV2.updatedAt=new Date().toISOString();
      for(const id of FORM_IDS){
        const form=formFor(id);
        if(form&&formMode(form)==="live"){
          decorate(form,id);
          const buffered=dirtyBuffer(form,id,now.date);
          if(!hasUnsavedChanges(form,id) && !buffered) applyRowsToForm(form,id,id==="load33"?r33:r11,now.date);
          else overlayLocalStateFromForm(form,id);
          modeNote(form,id,now.date,"live");setReadOnly(form,id,!canEditLive);
        }
      }
      renderOverview();
    }catch(e){console.warn("KEDCO live load-flow refresh failed",e);for(const id of FORM_IDS){const form=formFor(id);if(form&&formMode(form)==="live")setReadOnly(form,id,false);}const chip=document.querySelector("#view-overview .live-chip");if(chip&&isDispatch)chip.textContent="LOCAL CLOUD LIVE ERROR";}
  }
  function scheduleLiveRefresh(delay=100){clearTimeout(refreshTimer);refreshTimer=setTimeout(refreshLive,delay);}

  function bindEvents(){
    document.addEventListener("click",e=>{
      const view=e.target.closest?.("[data-lf-history-view]");
      if(view){const form=view.closest("form[data-form]"),id=form?.dataset.form;if(FORM_IDS.has(id)){e.preventDefault();e.stopImmediatePropagation();enterReference(form,id,historySelectedDate(form));return;}}
      const live=e.target.closest?.("[data-lf-return-live]");
      if(live){const form=live.closest("form[data-form]"),id=form?.dataset.form;if(FORM_IDS.has(id)){e.preventDefault();e.stopImmediatePropagation();enterLive(form,id);return;}}
      const form=e.target.closest?.("form[data-form]"); const id=form?.dataset.form;
      if(canEditLive&&FORM_IDS.has(id)&&formMode(form)==="live"&&e.target.closest?.("[data-lf33-apply-paste],[data-lf11-apply-paste]"))setTimeout(()=>{persistDirtyBuffer(form,id);overlayLocalStateFromForm(form,id);schedulePublish(form,id,150);},50);
    },true);
    document.addEventListener("input",e=>{const form=e.target.closest?.("form[data-form]"),id=form?.dataset.form;if(canEditLive&&FORM_IDS.has(id)&&formMode(form)==="live"&&!loadingForms.has(form)){persistDirtyBuffer(form,id);overlayLocalStateFromForm(form,id);schedulePublish(form,id,600);if(id==="load33")scheduleMonth33(form,1200);}},true);
    document.addEventListener("paste",e=>{
      const form=e.target.closest?.("form[data-form]"),id=form?.dataset.form;
      if(canEditLive&&FORM_IDS.has(id)&&formMode(form)==="live"){
        // First pass catches native paste; second pass catches the page's
        // asynchronous Smart Paste / Google Sheets matrix transformation.
        setTimeout(()=>{persistDirtyBuffer(form,id);overlayLocalStateFromForm(form,id);schedulePublish(form,id,120);},40);
        setTimeout(()=>{persistDirtyBuffer(form,id);overlayLocalStateFromForm(form,id);schedulePublish(form,id,120);},700);
      }
    },true);
    // Capture both window draft notifications and document paste notifications.
    window.addEventListener("kedco:loadflow-updated",e=>{
      const id=e.detail?.formId, form=FORM_IDS.has(id)?formFor(id):null;
      if(canEditLive&&form&&formMode(form)==="live"){persistDirtyBuffer(form,id);overlayLocalStateFromForm(form,id);schedulePublish(form,id,100);}
    },true);
    document.addEventListener("change",e=>{
      const form=e.target.closest?.("form[data-form]"),id=form?.dataset.form;if(!FORM_IDS.has(id))return;
      // Date browsing must never alter or autosave the currently displayed LIVE sheet.
      if(e.target.matches("[data-lf-history-year],[data-lf-history-month]")){capHistoryMonthsAtToday(form);refreshReferenceDays(form,id);return;}
      if(e.target.matches("[data-lf-history-day]"))return;
      if(canEditLive&&formMode(form)==="live"&&!loadingForms.has(form))schedulePublish(form,id,300);
    },true);
    document.addEventListener("kedco:viewchange",e=>{const id=e.detail?.directForm;if(FORM_IDS.has(id))setTimeout(()=>{const f=formFor(id);if(f)enterLive(f,id);},40);if(e.detail?.requested==="overview")scheduleLiveRefresh(20);});
    window.addEventListener("focus",()=>scheduleLiveRefresh(50));
    document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")scheduleLiveRefresh(50)});
    window.addEventListener("beforeunload",()=>{for(const id of FORM_IDS){const form=formFor(id);if(form&&formMode(form)==="live"&&hasUnsavedChanges(form,id))persistDirtyBuffer(form,id);}});
  }

  function retryDirtyForms(delay=80){
    for(const id of FORM_IDS){const form=formFor(id);if(form&&formMode(form)==="live"&&hasUnsavedChanges(form,id))schedulePublish(form,id,delay);}
  }

  function installRealtime(){
    const c=getClient();if(!c||channel)return;
    try{
      channel=c.channel(`kedco-loadflow-live-v2-${isDispatch?"dispatch":"operator"}`).on("postgres_changes",{event:"*",schema:"public",table:LIVE_TABLE},()=>scheduleLiveRefresh(120)).subscribe();
      c.auth?.onAuthStateChange?.((event,session)=>{if(session?.access_token){retryDirtyForms(120);scheduleLiveRefresh(80);}});
      window.addEventListener("storage",event=>{const k=String(event.key||"");if(k==="KEDCO_AUTH_SESSION_V1"||/^sb-.+-auth-token$/i.test(k))retryDirtyForms(120);});
    }catch(e){console.warn("KEDCO realtime subscription failed",e)}
  }

  function installStyles(){
    if(document.getElementById("kedco-live-v2-style"))return;
    const s=document.createElement("style");s.id="kedco-live-v2-style";s.textContent=`
      .kedco-live-mode-note{margin:7px 0 0;padding:8px 10px;border-radius:8px;border:1px solid #9fc8b1;background:#edf9f2;color:#12613c;font-size:8px;font-weight:900;line-height:1.45}
      .kedco-live-mode-note[data-mode="reference"]{border-color:#d4bd75;background:#fff8e5;color:#725600}
      .kedco-live-return{background:#0c7147!important;border-color:#0c7147!important;color:#fff!important}
      .lf-history-status.error{background:#fff0f0!important;color:#9a2020!important}.lf-history-status.warn{background:#fff6dc!important;color:#735300!important}.lf-history-status.ok{background:#eaf8ef!important;color:#10683a!important}
      form[data-kedco-loadflow-mode="reference"] [data-lf33-reading],form[data-kedco-loadflow-mode="reference"] [data-lf11-reading]{background:#fff9e8!important}
      form[data-form="load33"][data-kedco-loadflow-mode="live"] [data-lf33-reading],form[data-form="load11"][data-kedco-loadflow-mode="live"] [data-lf11-reading]{cursor:text}
      form[data-form="load33"][data-kedco-loadflow-mode="reference"] [data-lf33-reading],form[data-form="load11"][data-kedco-loadflow-mode="reference"] [data-lf11-reading]{cursor:not-allowed}
    `;document.head.appendChild(s);
  }

  function boot(){
    installStyles();bindEvents();
    const canvas=document.getElementById("formCanvas");
    if(canvas&&"MutationObserver" in window)new MutationObserver(()=>{for(const id of FORM_IDS){const f=formFor(id);if(f&&!f.dataset.kedcoRealtimeDecorated){decorate(f,id);scheduleLiveRefresh(40);}}}).observe(canvas,{childList:true,subtree:true});
    for(const id of FORM_IDS){const f=formFor(id);if(f)decorate(f,id);}
    document.addEventListener("kedco:viewchange",e=>{const id=e.detail?.directForm;if(FORM_IDS.has(id))setTimeout(()=>{const f=formFor(id);if(f){decorate(f,id);scheduleLiveRefresh(40);}},40);if(e.detail?.requested==="overview")scheduleLiveRefresh(20);});
    scheduleLiveRefresh(80);installRealtime();
    setInterval(()=>{const now=lagosNow();if(stateV2.date!==now.date||stateV2.hour!==now.hour)scheduleLiveRefresh(20);else renderOverview();},15000);
    // scadaLive calls scadaDashboard every 3 seconds. Keep that call useful,
    // while routing it through the live overview renderer.
    if(isDispatch&&typeof window.scadaDashboard==="function"){
      window.scadaDashboard=function(){renderOverview();};
    }
    window.KEDCORefreshRecentOperationalEvents=()=>loadRecentOperationalEvents(true);
    document.addEventListener("kedco:daily-log-updated",()=>loadRecentOperationalEvents(true));
    window.KEDCORefreshSupabaseLoadFlow=()=>refreshLive();
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else setTimeout(boot,0);
})();

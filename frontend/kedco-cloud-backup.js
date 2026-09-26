/* ============================================================
   KEDCO TECHNICAL AUTOMATION
   Cloud Persistence / Evidence / Realtime Extension V2
   2026-09-09

   Safe additive extension. It does not depend on exact internal
   text inside kedco-global-ui.js.
   ============================================================ */
(() => {
  "use strict";

  if (window.__KEDCO_CLOUD_BACKUP_V3__) return;
  window.__KEDCO_CLOUD_BACKUP_V3__ = true;

  const EVIDENCE_BUCKET = "kedco-evidence";
  const FILE_TABLE = "kedco_file_assets";
  const SNAPSHOT_TABLE = "kedco_data_snapshots";
  const FILE_BINDINGS_KEY = "KEDCO_FILE_BINDINGS_V1";
  const META_KEY = "KEDCO_DATA_SYNC_META_V1";
  const MAX_FILE_BYTES = 50 * 1024 * 1024;

  let client = null;
  let bootPromise = null;
  let snapshotChannel = null;
  let snapshotUserId = "";
  let remoteApplying = false;

  function clean(value) {
    return String(value ?? "").trim();
  }

  function pageRoot() {
    const p = window.location.pathname;
    return p.includes("/pages/") ? "../../" : (p.includes("/frontend/") ? "./" : "frontend/");
  }

  function pageName() {
    return clean(window.location.pathname || "/").slice(-180) || "dashboard";
  }

  function moduleFromPage() {
    const p = pageName().toLowerCase();
    if (/tmo|analyzer|trans/.test(p)) return "tmo";
    if (/system-operations|dispatch|operator|headso/.test(p)) return "system_operations";
    if (/\/mis\//.test(p)) return "mis";
    if (/hse/.test(p)) return "hse";
    if (/pcm/.test(p)) return "pcm";
    if (/operations-maintenance/.test(p)) return "operations_maintenance";
    if (/planning-investment/.test(p)) return "planning_investment";
    if (/stores/.test(p)) return "stores";
    if (/contractors/.test(p)) return "contractors";
    if (/executive/.test(p)) return "executive";
    return "general";
  }

  function moduleForKey(key) {
    const value = String(key || "").toLowerCase();
    if (/tmo|analyzer|yajib/.test(value)) return "tmo";
    if (/mis|daily|load33|load11|ops|dispatch|formdraft/.test(value)) return "system_operations_mis";
    if (/hse|safety/.test(value)) return "hse";
    if (/pcm|protection|meter/.test(value)) return "pcm";
    if (/om|regionalef|regionalcj|re_te|rete/.test(value)) return "operations_maintenance";
    if (/pi|planning|investment/.test(value)) return "planning_investment";
    if (/store|inventory|moves|requests/.test(value)) return "stores";
    if (/contract/.test(value)) return "contractors";
    if (/cto|executive|approval/.test(value)) return "executive";
    return "general";
  }

  function snapshotEligible(key) {
    const value = String(key || "");
    if (!value || value.length > 180) return false;
    if (/^sb-.+-auth-token$/i.test(value)) return false;
    if (/^(?:theme|voice|compact|misTheme|misRole|currentForm|kedco_voice|kedco_autosim)$/i.test(value)) return false;
    if (/(?:_USER|_THEME|_VOICE|_AUTOSIM)$/.test(value)) return false;
    if (/^KEDCO_(?:SUPABASE|AUTH|ACTIVE_ROLE|DATA_SYNC_META|API_BASE|GOOGLE_MAPS_API_KEY|PREPAREDNESS_BASE_URL)/i.test(value)) return false;
    if (/(?:^|_)SUPABASE(?:_|$)/i.test(value)) return false;
    return /^(?:KEDCO_|kedco_|formDraft:|formSubmissions:|yajib-|(?:opsEvents|opsLogs|feederStates)(?::|$))/i.test(value);
  }

  function config() {
    const local = window.KEDCO_LOCAL_CONFIG || window.KEDCO_SUPABASE_CONFIG || {};
    return { url: clean(local.apiBase || local.url), key: "kedco-local-mode" };
  }

  function loadScript(src) {
    return new Promise(resolve => {
      const target = new URL(src, location.href).href;
      const existing = [...document.scripts].find(s => {
        try { return s.src && new URL(s.src, location.href).href === target; }
        catch { return false; }
      });
      if (existing) {
        if (window.supabase?.createClient || existing.dataset.kedcoLoaded === "1") return resolve();
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", resolve, { once: true });
        setTimeout(resolve, 1500);
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = () => { script.dataset.kedcoLoaded = "1"; resolve(); };
      script.onerror = resolve;
      document.head.appendChild(script);
    });
  }

  async function ensureDependencies() {
    if (!window.KEDCO_LOCAL_CONFIG?.apiBase) {
      await loadScript(`${pageRoot()}supabase-config.js`);
    }
    if (!window.supabase?.createClient) {
      await loadScript(`${pageRoot()}assets/supabase.js`);
    }
  }

  async function getClient() {
    if (client) return client;
    await ensureDependencies();
    const { url, key } = config();
    if (!url || !key || !window.supabase?.createClient) return null;
    client = window.supabase.createClient({
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    return client;
  }

  async function getSession() {
    const c = await getClient();
    if (!c) return null;
    const { data, error } = await c.auth.getSession();
    if (error) throw error;
    return data?.session || null;
  }

  function accessToken() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (!/^sb-.+-auth-token$/i.test(key)) continue;
        const raw = JSON.parse(localStorage.getItem(key) || "null");
        const session = raw?.currentSession || raw;
        const token = clean(session?.access_token);
        if (token) return token;
      }
    } catch (_) {}
    return "";
  }

  function safeName(name) {
    return clean(name)
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 150) || "file";
  }

  function normalizedVoltage(value) {
    const text = clean(value).toLowerCase().replace(/\s+/g, "");
    if (/^33k?v$/.test(text)) return "33kv";
    if (/^11k?v$/.test(text)) return "11kv";
    return "";
  }

  function voltageFromFileName(name) {
    const text = clean(name);
    if (/(?:^|[^0-9])33\s*k?v(?:$|[^a-z0-9])/i.test(text)) return "33kv";
    if (/(?:^|[^0-9])11\s*k?v(?:$|[^a-z0-9])/i.test(text)) return "11kv";
    return "";
  }

  function safeFolder(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "general";
  }

  function randomId() {
    try { return crypto.randomUUID(); }
    catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  }

  function readBindings() {
    try {
      const value = JSON.parse(localStorage.getItem(FILE_BINDINGS_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }

  function saveBinding(asset) {
    const rows = readBindings();
    rows.unshift(asset);
    try { localStorage.setItem(FILE_BINDINGS_KEY, JSON.stringify(rows.slice(0, 2000))); }
    catch (_) {}
  }

  function contextForInput(input, file) {
    const form = input.closest("form");
    const inputName = clean(input.name || input.id || input.dataset?.kedcoDocCode || "file");
    const inputId = clean(input.id).toLowerCase();
    let galleryCategory = "";
    let voltageLevel = "";
    let storageFolder = "";
    let error = "";

    // Analyzer uploads are shown in the three Local Storage file galleries.  The
    // generic cleaner uses the selected voltage.  The Storage path also gets
    // the same voltage segment, so a 33 kV workbook cannot land beside 11 kV
    // data merely because both use the same evidence bucket.
    if (inputId === "tmofile33") {
      galleryCategory = "tmo";
      voltageLevel = "33kv";
      storageFolder = "33kv";
    } else if (inputId === "tmofile11") {
      galleryCategory = "tmo";
      voltageLevel = "11kv";
      storageFolder = "11kv";
    } else if (inputId === "tmofileforecast") {
      galleryCategory = "tmo";
      storageFolder = "forecast";
    } else if (inputId === "tmofilecommercial") {
      galleryCategory = "tmo";
      storageFolder = "commercial";
    } else if (inputId === "tmomasterfile") {
      galleryCategory = "tmo";
      storageFolder = "master";
    } else if (inputId === "file") {
      voltageLevel = normalizedVoltage(document.querySelector("#voltage")?.value);
      const filenameVoltage = voltageFromFileName(file?.name);
      if (!voltageLevel) error = "Select 33 kV or 11 kV before selecting a workbook.";
      else if (filenameVoltage && filenameVoltage !== voltageLevel) error = `Selected voltage is ${voltageLevel}, but the file name indicates ${filenameVoltage}.`;
      galleryCategory = voltageLevel;
      storageFolder = voltageLevel;
    } else if (inputId === "analyzedfiles") {
      galleryCategory = "analyzed";
      voltageLevel = voltageFromFileName(file?.name);
      storageFolder = voltageLevel || "analyzed";
    }

    return {
      formKey: clean(form?.dataset?.form || form?.id || form?.getAttribute("name")),
      inputName,
      recordKey: clean(
        form?.dataset?.recordKey ||
        form?.querySelector?.('[name="id"], [name="record_id"], [name="reference"], [name="ref"]')?.value
      ),
      storageFolder,
      valid: !error,
      error,
      metadata: galleryCategory ? {
        gallery_category: galleryCategory,
        voltage_level: voltageLevel || null,
        storage_folder: storageFolder || null,
        reporting_period: clean(document.querySelector("#month")?.value || document.querySelector("#tmoMonth")?.value) || null
      } : {}
    };
  }

  function fileStatus(input, text, error = false) {
    if (!input?.parentElement) return;
    let el = input.parentElement.querySelector(":scope > [data-kedco-cloud-file-status]");
    if (!el) {
      el = document.createElement("small");
      el.dataset.kedcoCloudFileStatus = "1";
      el.style.display = "block";
      el.style.marginTop = "4px";
      input.parentElement.appendChild(el);
    }
    el.textContent = text;
    el.style.color = error ? "#b91c1c" : "#166534";
  }

  async function uploadFile(file, context = {}) {
    if (!(file instanceof File)) throw new Error("Invalid file.");
    if (file.size > MAX_FILE_BYTES) throw new Error(`File exceeds 50 MB: ${file.name}`);

    const c = await getClient();
    const session = await getSession();
    const uid = session?.user?.id;
    if (!c || !uid) throw new Error("Sign in before uploading evidence.");

    const now = new Date();
    const module = clean(context.module || moduleFromPage());
    const storageFolder = safeFolder(context.storageFolder || context.metadata?.voltage_level || context.metadata?.gallery_category || "general");
    const path = [
      uid,
      module,
      storageFolder,
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      `${randomId()}-${safeName(file.name)}`
    ].join("/");

    const { error: uploadError } = await c.storage
      .from(EVIDENCE_BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (uploadError) throw uploadError;

    const row = {
      owner_id: uid,
      bucket_id: EVIDENCE_BUCKET,
      storage_path: path,
      original_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      module,
      source_page: pageName(),
      form_key: clean(context.formKey) || null,
      input_name: clean(context.inputName) || null,
      record_key: clean(context.recordKey) || null,
      metadata: context.metadata || {}
    };

    const { data, error } = await c.from(FILE_TABLE).insert(row).select("*").single();
    if (error) {
      try { await c.storage.from(EVIDENCE_BUCKET).remove([path]); } catch (_) {}
      throw error;
    }
    saveBinding(data || row);
    return data || row;
  }

  async function backupInput(input) {
    // operator workflow files already have their own governed storage/RPC path.
    if (input?.hasAttribute?.("data-kedco-doc-code")) return [];
    const files = [...(input?.files || [])];
    if (!files.length) return [];
    const contexts = files.map(file => contextForInput(input, file));
    const invalidContext = contexts.find(item => !item.valid);
    if (invalidContext) {
      fileStatus(input, invalidContext.error || "Select the correct upload destination before choosing a file.", true);
      return [];
    }
    const uploaded = [];
    fileStatus(input, `Backing up ${files.length} file(s) to Local Storage...`);
    try {
      for (let index = 0; index < files.length; index += 1) uploaded.push(await uploadFile(files[index], contexts[index]));
      fileStatus(input, `${uploaded.length} file(s) backed up to Local Storage.`);
      window.dispatchEvent(new CustomEvent("kedco:cloud-files-uploaded", { detail: { input, uploaded } }));
      return uploaded;
    } catch (error) {
      fileStatus(input, `Cloud backup failed: ${error?.message || error}`, true);
      throw error;
    }
  }

  function readMeta() {
    try {
      const value = JSON.parse(localStorage.getItem(META_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch { return {}; }
  }

  function writeMeta(meta) {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (_) {}
  }

  async function writeDeletionTombstone(key) {
    if (!snapshotEligible(key)) return false;

    if (window.KEDCO_DATA_SYNC?.deleteSnapshot) {
      try {
        window.KEDCO_DATA_SYNC.deleteSnapshot(key);
        return true;
      } catch (_) {}
    }

    const c = await getClient();
    const session = await getSession();
    const uid = session?.user?.id;
    if (!c || !uid) return false;

    const timestamp = new Date().toISOString();
    const patch = {
      payload: { __kedco_deleted: true },
      module: moduleForKey(key),
      source_page: pageName(),
      client_updated_at: timestamp,
      is_deleted: true,
      deleted_at: timestamp
    };

    const { data: updated, error: updateError } = await c
      .from(SNAPSHOT_TABLE)
      .update(patch)
      .eq("owner_id", uid)
      .eq("data_key", String(key))
      .select("id")
      .limit(1);

    if (updateError) throw updateError;

    if (!updated?.length) {
      const { error: insertError } = await c.from(SNAPSHOT_TABLE).insert({
        owner_id: uid,
        data_key: String(key),
        ...patch
      });
      if (insertError) throw insertError;
    }

    const meta = readMeta();
    meta[String(key)] = timestamp;
    writeMeta(meta);
    return true;
  }

  function installDeletionHook() {
    if (window.__KEDCO_CLOUD_DELETE_HOOK_V2__) return;
    window.__KEDCO_CLOUD_DELETE_HOOK_V2__ = true;

    const previousRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key) {
      const shouldSync = this === window.localStorage && snapshotEligible(key) && !remoteApplying;
      const result = previousRemoveItem.call(this, key);
      if (shouldSync) {
        void writeDeletionTombstone(String(key)).catch(error => {
          console.warn("KEDCO deletion cloud sync failed; local deletion remains applied:", error?.message || error);
        });
      }
      return result;
    };
  }

  function applyRemoteTombstone(row) {
    const key = row?.data_key;
    if (!key || !snapshotEligible(key)) return;
    const meta = readMeta();
    const remoteTime = Date.parse(row.client_updated_at || row.deleted_at || row.updated_at || "") || Date.now();
    const localTime = Date.parse(meta[key] || "") || 0;
    if (localTime > remoteTime) return;

    try {
      remoteApplying = true;
      localStorage.removeItem(key);
    } finally {
      remoteApplying = false;
    }
    meta[key] = row.client_updated_at || row.deleted_at || row.updated_at || new Date().toISOString();
    writeMeta(meta);
    window.dispatchEvent(new CustomEvent("kedco:data-remote-applied", { detail: row }));
  }

  async function subscribeSnapshotRealtime() {
    const c = await getClient();
    const session = await getSession();
    const uid = session?.user?.id || "";
    if (!c || !uid) return null;

    if (snapshotChannel && snapshotUserId === uid) return snapshotChannel;
    if (snapshotChannel) {
      try { await c.removeChannel(snapshotChannel); } catch (_) {}
      snapshotChannel = null;
    }

    snapshotUserId = uid;
    snapshotChannel = c
      .channel(`kedco-snapshots-${uid}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: SNAPSHOT_TABLE,
        filter: `owner_id=eq.${uid}`
      }, payload => {
        const row = payload.eventType === "DELETE"
          ? { ...(payload.old || {}), is_deleted: true, deleted_at: new Date().toISOString() }
          : payload.new;

        if (row?.is_deleted) {
          applyRemoteTombstone(row);
        } else {
          // Let the existing durable engine perform conflict-aware restoration.
          window.setTimeout(() => window.KEDCO_DATA_SYNC?.sync?.(), 50);
        }
      })
      .subscribe(status => {
        window.KEDCO_CLOUD_REALTIME_STATUS = status;
        window.dispatchEvent(new CustomEvent("kedco:cloud-realtime-status", { detail: { status } }));
      });

    return snapshotChannel;
  }

  function serializeForm(form) {
    const result = {};
    if (!form) return result;
    const fd = new FormData(form);
    for (const [key, value] of fd.entries()) {
      if (value instanceof File) continue;
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        result[key] = Array.isArray(result[key]) ? [...result[key], value] : [result[key], value];
      } else {
        result[key] = value;
      }
    }
    for (const el of form.querySelectorAll("input,select,textarea")) {
      const key = clean(el.name || el.id);
      if (!key || Object.prototype.hasOwnProperty.call(result, key) || el.type === "file") continue;
      if ((el.type === "checkbox" || el.type === "radio") && !el.checked) continue;
      result[key] = el.value;
    }
    return result;
  }

  function loadFlowDate(form, formId) {
    const selectors = formId === "load33"
      ? ['[name="date"]', '#lf33Date', '[data-load-date]']
      : ['[name="date"]', '#lf11Date', '[data-load-date]'];
    for (const selector of selectors) {
      const value = clean(form.querySelector(selector)?.value);
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    }
    return new Date().toISOString().slice(0, 10);
  }

  async function publishLoadFlowForm(form) {
    const formId = clean(form?.dataset?.form).toLowerCase();
    if (!form || !["load33", "load11"].includes(formId)) return null;

    const c = await getClient();
    const session = await getSession();
    if (!c || !session) return null;

    const payload = serializeForm(form);
    const station = clean(
      form.querySelector("[data-station-select]")?.value ||
      form.querySelector("[data-hourly-station]")?.value ||
      payload.station || payload.issuing
    );
    const operationType = formId === "load33" ? "LOAD_FLOW_33KV" : "LOAD_FLOW_11KV_SUBMISSION";
    const voltage = formId === "load33" ? "33KV" : "11KV";

    const { data, error } = await c.rpc("kedco_publish_station_operation", {
      requested_operation_type: operationType,
      requested_station_name: station || null,
      requested_region_name: null,
      requested_state_code: null,
      requested_voltage_level: voltage,
      requested_feeder_name: null,
      requested_reading_date: loadFlowDate(form, formId),
      requested_reading_hour: null,
      requested_shift: clean(payload.shift) || null,
      requested_status: "SUBMITTED",
      requested_summary: `${voltage} load-flow form submitted from ${pageName()}`,
      requested_payload: payload
    });
    if (error) throw error;
    window.dispatchEvent(new CustomEvent("kedco:cloud-loadflow-published", { detail: { formId, data } }));
    return data;
  }

  async function signedFileUrl(storagePath, expiresIn = 900) {
    const c = await getClient();
    if (!c) throw new Error("Local Storage client is unavailable.");
    const { data, error } = await c.storage.from(EVIDENCE_BUCKET).createSignedUrl(storagePath, expiresIn);
    if (error) throw error;
    return data?.signedUrl || "";
  }

  function bindFileBackup() {
    if (window.__KEDCO_CLOUD_FILE_BIND_V2__) return;
    window.__KEDCO_CLOUD_FILE_BIND_V2__ = true;
    document.addEventListener("change", event => {
      const input = event.target?.closest?.('input[type="file"]');
      if (!input) return;
      void backupInput(input).catch(error => {
        console.warn("KEDCO evidence backup failed:", error?.message || error);
      });
    }, true);
  }

  function bindLoadFlowPublishing() {
    if (window.__KEDCO_CLOUD_LOADFLOW_BIND_V2__) return;
    window.__KEDCO_CLOUD_LOADFLOW_BIND_V2__ = true;
    document.addEventListener("click", event => {
      const button = event.target?.closest?.("#submitForm");
      if (!button) return;
      const form = document.querySelector('#formCanvas form[data-form="load33"], #formCanvas form[data-form="load11"]');
      if (!form) return;
      setTimeout(() => {
        publishLoadFlowForm(form).catch(error => {
          console.error("KEDCO realtime load-flow publish failed:", error?.message || error);
        });
      }, 120);
    }, true);
  }

  async function boot() {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      await ensureDependencies();
      installDeletionHook();
      bindFileBackup();
      bindLoadFlowPublishing();

      const c = await getClient();
      if (c) {
        await subscribeSnapshotRealtime();
        c.auth.onAuthStateChange((_event, session) => {
          if (session) {
            window.setTimeout(() => window.KEDCO_DATA_SYNC?.sync?.(), 50);
            void subscribeSnapshotRealtime();
          } else if (snapshotChannel) {
            void c.removeChannel(snapshotChannel).catch(() => {});
            snapshotChannel = null;
            snapshotUserId = "";
          }
        });
      }

      window.dispatchEvent(new CustomEvent("kedco:cloud-ready"));
    })().catch(error => {
      console.warn("KEDCO cloud extension unavailable; existing local fallback remains active:", error?.message || error);
    });
    return bootPromise;
  }

  window.KEDCO_CLOUD = Object.freeze({
    getClient,
    getSession,
    accessToken,
    uploadFile,
    backupInput,
    publishLoadFlowForm,
    subscribeSnapshotRealtime,
    signedFileUrl,
    deleteSnapshot: writeDeletionTombstone,
    syncNow: () => window.KEDCO_DATA_SYNC?.sync?.(),
    getBackupBindings: readBindings
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void boot(), { once: true });
  } else {
    void boot();
  }
})();


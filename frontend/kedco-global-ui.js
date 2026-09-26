/* Shared navigation controls for every KEDCO dashboard page. */
(function () {
  "use strict";

  const MENU_SIZE = "13px";
  const FALLBACK_ROLE_ROUTES = {
    CTO: "./pages/executive/cto.html",
    SUPER_ADMIN: "./pages/developer/dev.html",
    DEVELOPER: "./pages/developer/dev.html",
    MD_CEO: "./pages/executive/cto.html",
    HEAD_TECHNICAL: "./pages/executive/cto.html",
    TA_CTO: "./pages/executive/ta.html",
    HEAD_SO: "./pages/system-operations/headso.html",
    SUPERVISOR: "./pages/system-operations/supervisors.html",
    SUPER_OPERATOR: "./pages/system-operations/super_operator.html",
    DISPATCH_SUPERVISOR: "./pages/system-operations/dispatch.html",
    DISPATCH: "./pages/system-operations/dispatch.html",
    OPERATOR: "./pages/system-operations/operator.html",
    TCN_INTERFACE: "./pages/system-operations/operator.html",
    STATION_OPERATOR: "./pages/system-operations/operator.html",
    HEAD_OM: "./pages/operations-maintenance/headom.html",
    REGIONAL_OM_COORD: "./pages/operations-maintenance/headom.html",
    TSP_TECH_SERVICES: "./pages/operations-maintenance/headom.html",
    REGIONAL_EF_LEAD: "./pages/operations-maintenance/regionalef.html",
    REGIONAL_CJ_LEAD: "./pages/operations-maintenance/regionalcj.html",
    REGIONAL_EF: "./pages/operations-maintenance/regionalef.html",
    REGIONAL_CJ: "./pages/operations-maintenance/regionalcj.html",
    RE: "./pages/operations-maintenance/re_te.html",
    TE: "./pages/operations-maintenance/re_te.html",
    SUPER_RE_TE: "./pages/operations-maintenance/super_re_te.html",
    HEAD_PCM: "./pages/pcm/headpcm.html",
    REGIONAL_PCM_COORD: "./pages/pcm/regionalpcm.html",
    PROTECTION_ENGINEER: "./pages/pcm/regionalpcm.html",
    CONTROL_SCADA_ENGINEER: "./pages/pcm/regionalpcm.html",
    METERING_ENGINEER: "./pages/pcm/regionalpcm.html",
    TEST_ENGINEER: "./pages/pcm/regionalpcm.html",
    REGIONAL_PPM_COORD: "./pages/pcm/regionalpcm.html",
    HEAD_PI: "./pages/planning-investment/headpi.html",
    REGIONAL_PI_COORD: "./pages/planning-investment/regionalpi.html",
    PLANNING_ENGINEER: "./pages/planning-investment/regionalpi.html",
    PROJECT_ENGINEER: "./pages/planning-investment/regionalpi.html",
    HEAD_HSE: "./pages/hse/headhse.html",
    REGIONAL_HSE_OFFICER: "./pages/hse/regionalhse.html",
    HSE_OFFICER: "./pages/hse/regionalhse.html",
    HEAD_MIS: "./pages/mis/mis.html",
    MIS_TEAM_LEAD: "./pages/mis/teamleaddata.html",
    DATA_ANALYST: "./pages/mis/teamleaddata.html",
    TMO: "./pages/tmo/tmo.html",
    ANALYZER: "./pages/tmo/analyzer.html",
    TRANSMISSION: "./pages/tmo/trans.html",
    SUPER_TRANS: "./pages/tmo/super_trans.html",
    STORE_MANAGER: "./pages/stores/store-inventory.html",
    STORE_OFFICER: "./pages/stores/store-inventory.html",
    CONTRACTOR_PM: "./pages/contractors/contractors.html",
    CONTRACTOR_USER: "./pages/contractors/contractors.html",
    PROCUREMENT_HEAD: "./pages/executive/ta.html",
    PROCUREMENT_OFFICER: "./pages/executive/ta.html",
    FINANCE_HEAD: "./pages/executive/ta.html",
    FINANCE_OFFICER: "./pages/executive/ta.html",
    LEGAL_OFFICER: "./pages/executive/ta.html",
    SECURITY_OFFICER: "./pages/executive/ta.html",
    HR_ADMIN_OFFICER: "./pages/executive/ta.html"
  };
  const ROLE_LABELS = {
    DATA_ANALYST: "Data Analyst",
    ANALYZER: "Feeder Performance Analyzer",
    DISPATCH_SUPERVISOR: "Dispatch Supervisor",
    MIS_TEAM_LEAD: "MIS Team Lead",
    TCN_INTERFACE: "TCN Interface",
    STATION_OPERATOR: "Station Operator",
    HEAD_SO: "Head System Operations",
    HEAD_OM: "Head Operations & Maintenance",
    REGIONAL_OM_COORD: "Regional O&M Coordinator",
    TSP_TECH_SERVICES: "TSP Technical Services",
    HEAD_PCM: "Head Protection, Control & Metering",
    REGIONAL_PCM_COORD: "Regional PC&M Coordinator",
    HEAD_PI: "Head Planning & Investment",
    REGIONAL_PI_COORD: "Regional P&I Coordinator",
    HEAD_HSE: "Head HSE",
    REGIONAL_HSE_OFFICER: "Regional HSE Officer",
    HEAD_MIS: "Head MIS",
    SUPER_ADMIN: "Super Administrator",
    SUPERVISOR: "Supervisor Centre",
    SUPER_RE_TE: "RE/TE Supervisor",
    SUPER_OPERATOR: "System Operations Supervisor",
    SUPER_TRANS: "Transmission Supervisor"
  };

  function addSharedStyles() {
    if (document.getElementById("kedco-global-ui-styles")) return;

    const style = document.createElement("style");
    style.id = "kedco-global-ui-styles";
    style.textContent = `
      :root { --kedco-menu-font-size: ${MENU_SIZE}; }
      body nav a,
      body nav button,
      body .nav a,
      body .nav button,
      body .side a,
      body .side button,
      body .sidebar a,
      body .sidebar button {
        font-size: var(--kedco-menu-font-size) !important;
      }
      body .nav-label,
      body .navlabel {
        font-size: 10px !important;
      }
      .kedco-logout {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        margin: 10px 0 0;
        padding: 10px 12px;
        border: 1px solid rgba(255, 255, 255, .18);
        border-radius: 10px;
        background: rgba(196, 55, 55, .18);
        color: #fff;
        cursor: pointer;
        font-family: inherit;
        font-size: var(--kedco-menu-font-size);
        font-weight: 800;
        line-height: 1.2;
      }
      .kedco-logout:hover,
      .kedco-logout:focus-visible {
        background: #b42318;
        outline: 2px solid rgba(255, 226, 147, .8);
        outline-offset: 2px;
      }
      .kedco-logout:disabled { opacity: .65; cursor: wait; }
      .kedco-role-switcher {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 5px;
        width: 100%;
        margin: 10px 0 0;
        padding: 9px 10px;
        border: 1px solid rgba(255, 255, 255, .16);
        border-radius: 10px;
        background: rgba(255, 255, 255, .06);
        color: #dce9f7;
        line-height: 1.3;
      }
      .kedco-role-switcher label {
        display: block;
        color: #9db9d7;
        font-size: 8px;
        font-weight: 900;
        letter-spacing: .08em;
        text-transform: uppercase;
      }
      .kedco-role-switcher select {
        display: block;
        width: 100%;
        min-width: 0;
        padding: 7px 8px;
        border: 1px solid rgba(255, 255, 255, .24);
        border-radius: 7px;
        background: #08274a;
        color: #fff;
        font-family: inherit;
        font-size: 10px;
        font-weight: 800;
        line-height: 1.2;
      }
      .kedco-role-switcher small {
        display: block;
        color: #8fa9c4;
        font-size: 8px;
        line-height: 1.35;
      }
      .kedco-local-cloud-badge {
        position: fixed; right: 14px; bottom: 14px; z-index: 99999;
        display: flex; align-items: center; gap: 7px; padding: 8px 11px;
        border: 1px solid rgba(255,255,255,.25); border-radius: 999px;
        background: rgba(5,35,67,.94); color: #fff; box-shadow: 0 7px 26px rgba(0,0,0,.22);
        font: 800 10px/1.2 system-ui, sans-serif; letter-spacing: .04em;
      }
      .kedco-local-cloud-badge i { width: 8px; height: 8px; border-radius: 50%; background: #43d17a; box-shadow: 0 0 0 3px rgba(67,209,122,.18); }
    `;
    document.head.appendChild(style);
  }

  function installTextRepair() {
    if (window.__KEDCO_TEXT_REPAIR_INSTALLED__) return;
    window.__KEDCO_TEXT_REPAIR_INSTALLED__ = true;
    const bad = (...codes) => String.fromCharCode(...codes);
    const fixes = [
      [bad(0xe2, 0x20ac, 0x201d), "\u2014"], [bad(0xe2, 0x20ac, 0x201c), "\u2013"],
      [bad(0xe2, 0x20ac, 0x00a2), "\u2022"], [bad(0xe2, 0x20ac, 0x00a6), "\u2026"],
      [bad(0xe2, 0x20ac, 0x0153), "\u201c"], [bad(0xe2, 0x20ac, 0x009d), "\u201d"],
      [bad(0xe2, 0x20ac, 0x2122), "\u2019"],
      [bad(0xc3, 0x2014), "\u00d7"], [bad(0xc3, 0x00b7), "\u00f7"],
      [bad(0xc2, 0x00b7), "\u00b7"], [bad(0xc2, 0x00b1), "\u00b1"],
      [bad(0xce, 0x00a3), "\u03a3"], [bad(0xce, 0x201d), "\u0394"],
      [bad(0xce, 0x00b1), "\u03b1"], [bad(0xce, 0x00b2), "\u03b2"],
      [bad(0xce, 0x00b3), "\u03b3"], [bad(0xce, 0x00bc), "\u03bc"],
      [bad(0xce, 0x00a9), "\u03a9"], [bad(0xe2, 0x02c6, 0x2019), "\u2212"],
      [bad(0xe2, 0x0161, 0x00a0), "\u26a0"], [bad(0xe2, 0x0161, 0x2018), "\u2691"], [bad(0xe2, 0x0153, 0x00a6), "\u2726"],
      [bad(0xe2, 0x0153, 0x201c), "\u2713"], [bad(0xe2, 0x0153, 0x201d), "\u2714"],
      [bad(0xe2, 0x0153, 0x2014), "\u2715"], [bad(0xe2, 0x0153, 0x017d), "\u270e"],
      [bad(0xe2, 0x02dc, 0x0081), "\u2601"],
      [bad(0xe2, 0x2020, 0x00aa), "\u21aa"], [bad(0xe2, 0x2013, 0x00a3), "\u25a3"],
      [bad(0xe2, 0x2014, 0x008f), "\u25cf"], [bad(0xe2, 0x2014, 0x00b7), "\u25c7"],
      [bad(0xe2, 0x2014, 0x00ab), "\u25c9"], [bad(0xe2, 0x2020, 0x00bb), "\u21bb"],
      [bad(0xe2, 0x2020, 0x2019), "\u2192"], [bad(0xe2, 0x2030, 0x00a5), "\u2265"],
      [bad(0xe2, 0x015c, 0x0081), "\u2301"],
      [bad(0xe2, 0x0161, 0x2122), "\u2699"], [bad(0xc6, 0x2019), "\u0192"],
      [bad(0xe2, 0x0152, 0x201a), "\u25c9"], [bad(0xe2, 0x0152, 0x0081), "\u2301"],
      [bad(0xe2, 0x0152, 0x2013), "\u25c7"], [bad(0xe2, 0x0161, 0x00a1), "\u26a1"],
      [bad(0xe2, 0x2030, 0x00a3), "\u2263"], [bad(0xe2, 0x2030, 0x00a1), "\u2261"],
      [bad(0xe2, 0x2013, 0x00a4), "\u25a4"], [bad(0xe2, 0x2013, 0x00a6), "\u25a6"],
      [bad(0xe2, 0x2014, 0x2030), "\u25ce"], [bad(0xe2, 0x2014, 0x017d), "\u25ce"],
      [bad(0xe2, 0x2021, 0x00a7), "\u21aa"],
      [bad(0xf0, 0x0178, 0x00a4, 0x2013), "\ud83e\udd16"],
      [bad(0xf0, 0x0178, 0x201d, 0x2019), "\ud83d\udd12"],
      [bad(0xf0, 0x0178, 0x00a7, 0x00a0), "\ud83e\udde0"],
      [bad(0xf0, 0x0178, 0x0161, 0x00ab), "\ud83d\udeab"]
    ];
    const repair = value => fixes.reduce((text, [from, to]) => text.split(from).join(to), String(value ?? ""));
    const repairNode = node => {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/i.test(parent.tagName)) return;
        const next = repair(node.nodeValue);
        if (next !== node.nodeValue) node.nodeValue = next;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let textNode;
      while ((textNode = walker.nextNode())) repairNode(textNode);
      const elements = [node, ...(node.querySelectorAll ? node.querySelectorAll("[title],[placeholder],[aria-label]") : [])];
      elements.forEach(element => ["title", "placeholder", "aria-label"].forEach(attribute => {
        if (!element.hasAttribute(attribute)) return;
        const current = element.getAttribute(attribute), next = repair(current);
        if (next !== current) element.setAttribute(attribute, next);
      }));
    };
    const run = () => repairNode(document.body);
    if (document.body) run();
    if (document.body && "MutationObserver" in window) {
      let queued = false;
      const schedule = () => {
        if (queued) return;
        queued = true;
        setTimeout(() => { queued = false; run(); }, 0);
      };
      new MutationObserver(schedule).observe(document.body, {
        subtree: true, childList: true, characterData: true, attributes: true,
        attributeFilter: ["title", "placeholder", "aria-label"]
      });
    }
  }

  function clearLocalSession() {
    try {
      Object.keys(localStorage).forEach((key) => {
        if (/^sb-.+-auth-token$/.test(key) || /^KEDCO_AUTH_ROLES?$/.test(key) || key === "KEDCO_ACTIVE_ROLE_CODE" || key === "KEDCO_AUTH_SESSION_V1") {
          localStorage.removeItem(key);
        }
      });
    } catch {
      // Storage may be unavailable in a restricted browser context.
    }
    try {
      Object.keys(sessionStorage).forEach((key) => {
        if (/^sb-.+-auth-token$/.test(key) || /^KEDCO_AUTH_ROLES?$/.test(key) || key === "KEDCO_ACTIVE_ROLE_CODE" || key === "KEDCO_AUTH_SESSION_V1") {
          sessionStorage.removeItem(key);
        }
      });
    } catch {}
  }

  function readAuthStorage(key) {
    try {
      const value = sessionStorage.getItem(key);
      if (value !== null) return value;
    } catch {}
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writeAuthStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      try { sessionStorage.removeItem(key); } catch {}
      return true;
    } catch {}
    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function sessionAccessToken() {
    try {
      const value = JSON.parse(readAuthStorage("KEDCO_AUTH_SESSION_V1") || "null");
      return String((value?.session || value?.currentSession || value)?.access_token || "");
    } catch { return ""; }
  }

  function revokeLocalSession() {
    const token = sessionAccessToken();
    if (!token) return;
    const base = String(window.KEDCO_LOCAL_CONFIG?.apiBase || window.KEDCO_SUPABASE_CONFIG?.apiBase || window.location.origin).replace(/\/$/, "");
    try {
      void fetch(`${base}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        keepalive: true
      }).catch(() => {});
    } catch {}
  }

  function siteRoot() {
    const p = window.location.pathname;
    return p.includes("/pages/") ? "../../../" : (p.includes("/frontend/") ? "../" : "./");
  }

  function loginUrl() {
    try {
      return new URL(siteRoot() + "index.html", window.location.href).href;
    } catch {
      return "/index.html";
    }
  }

  function installLogout() {
    if (window.__KEDCO_ACCOUNT_CONTROLS_V5__ || document.getElementById("kedcoAccountV5")) return;
    const sidebar = document.querySelector("aside.side, aside.sidebar, .side, .sidebar");
    if (!sidebar || document.getElementById("kedcoLogout")) return;

    const button = document.createElement("button");
    button.id = "kedcoLogout";
    button.type = "button";
    button.className = "kedco-logout";
    button.setAttribute("aria-label", "Log out of KEDCO");
    button.innerHTML = "<span aria-hidden=\"true\">↪</span><span>Logout</span>";
    button.addEventListener("click", () => {
      button.disabled = true;
      button.lastElementChild.textContent = "Signing out…";
      revokeLocalSession();
      clearLocalSession();
      window.location.replace(loginUrl());
    });

    const footer = sidebar.querySelector(".side-foot, .sidebar-foot, .sidebar-footer");
    if (footer) footer.before(button);
    else sidebar.appendChild(button);
  }

  function roleCodes() {
    try {
      const raw = JSON.parse(readAuthStorage("KEDCO_AUTH_ROLES") || "[]");
      const roles = Array.isArray(raw) ? raw : [];
      return [...new Set(roles.map((role) => String(role || "").trim().toUpperCase()).filter(Boolean))];
    } catch {
      return [];
    }
  }

  function roleLabel(code) {
    return ROLE_LABELS[code] || code.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function pageRoot() {
    const p = window.location.pathname;
    return p.includes("/pages/") ? "../../" : (p.includes("/frontend/") ? "./" : "frontend/");
  }

  // Dashboard pages keep their working state locally for offline use. Mirror
  // only business-data keys to the local backend so signed-in staff can recover
  // uploaded forms, registers and analysis snapshots on a later visit.
  const DATA_SYNC_TABLE = "kedco_data_snapshots";
  const DATA_SYNC_META_KEY = "KEDCO_DATA_SYNC_META_V1";
  const DATA_SYNC_REMOTE_VERSION_KEY = "KEDCO_DATA_SYNC_REMOTE_VERSION_V1";
  const DATA_SYNC_LOCK_KEY = "KEDCO_DATA_SYNC_LOCK_V1";
  const DATA_SYNC_LOCK_TTL = 120000;
  const DATA_SYNC_DEBOUNCE_MS = 5000;
  const DATA_SYNC_POLL_MS = 30000;
  const dataSyncLockOwner = (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
  let dataSyncQueue = new Map();
  let dataSyncTimer = null;
  let dataSyncInterval = null;
  let dataSyncInFlight = false;
  let dataSyncStorageWrite = false;

  function dataSyncEligible(key) {
    const value = String(key || "");
    if (!value || value.length > 180) return false;
    if (/^sb-.+-auth-token$/i.test(value)) return false;
    if (/^(?:theme|voice|compact|misTheme|misRole|currentForm|kedco_voice|kedco_autosim)$/i.test(value)) return false;
    if (/(?:_USER|_THEME|_VOICE|_AUTOSIM)$/.test(value)) return false;
    if (/^KEDCO_(?:SUPABASE|AUTH|ACTIVE_ROLE|DATA_SYNC_META|DATA_SYNC_REMOTE_VERSION|DATA_SYNC_LOCK|API_BASE|GOOGLE_MAPS_API_KEY|PREPAREDNESS_BASE_URL)/i.test(value)) return false;
    if (/(?:^|_)SUPABASE(?:_|$)/i.test(value)) return false;
    return /^(?:KEDCO_|kedco_|formDraft:|formSubmissions:|yajib-|(?:opsEvents|opsLogs|feederStates)(?::|$))/i.test(value);
  }

  function dataSyncSanitize(value, seen = new WeakSet(), depth = 0) {
    if (value === null || typeof value !== "object") return value;
    if (depth > 24) return "[truncated]";
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    if (Array.isArray(value)) return value.map(item => dataSyncSanitize(item, seen, depth + 1));
    const clean = {};
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:key|anonKey|publishableKey|serviceRoleKey|accessToken|refreshToken|password|secret|token)$/i.test(key)) continue;
      if (/(?:api|supabase).*(?:key|token|secret)/i.test(key)) continue;
      clean[key] = dataSyncSanitize(item, seen, depth + 1);
    }
    return clean;
  }

  function dataSyncModule(key) {
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

  function dataSyncSourcePage() {
    return String(window.location.pathname || "").slice(-180) || "dashboard";
  }

  function dataSyncReadMeta() {
    try {
      const value = JSON.parse(localStorage.getItem(DATA_SYNC_META_KEY) || "{}");
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function dataSyncWriteMeta(meta) {
    try {
      dataSyncStorageWrite = true;
      localStorage.setItem(DATA_SYNC_META_KEY, JSON.stringify(meta));
    } catch {}
    finally {
      dataSyncStorageWrite = false;
    }
  }

  function dataSyncReadRemoteVersion(userId) {
    try {
      const value = JSON.parse(localStorage.getItem(DATA_SYNC_REMOTE_VERSION_KEY) || "{}");
      const version = Number(value?.[userId]);
      return Number.isFinite(version) ? version : null;
    } catch {
      return null;
    }
  }

  function dataSyncWriteRemoteVersion(userId, version) {
    if (!Number.isFinite(version)) return;
    try {
      const value = JSON.parse(localStorage.getItem(DATA_SYNC_REMOTE_VERSION_KEY) || "{}");
      const versions = value && typeof value === "object" && !Array.isArray(value) ? value : {};
      versions[userId] = version;
      dataSyncStorageWrite = true;
      localStorage.setItem(DATA_SYNC_REMOTE_VERSION_KEY, JSON.stringify(versions));
    } catch {}
    finally {
      dataSyncStorageWrite = false;
    }
  }

  function dataSyncQueueValue(key, value, clientUpdatedAt = new Date().toISOString()) {
    if (!dataSyncEligible(key) || dataSyncStorageWrite) return;
    let payload = value;
    try {
      payload = JSON.parse(String(value));
    } catch {}
    dataSyncQueue.set(String(key), {
      payload: dataSyncSanitize(payload),
      clientUpdatedAt,
      module: dataSyncModule(key),
      sourcePage: dataSyncSourcePage(),
      isDeleted: false,
      deletedAt: null
    });
    dataSyncSchedule();
  }

  function dataSyncSaveSnapshot(key, payload, module) {
    if (!dataSyncEligible(key)) return false;
    dataSyncQueue.set(String(key), {
      payload: dataSyncSanitize(payload),
      clientUpdatedAt: new Date().toISOString(),
      module: module || dataSyncModule(key),
      sourcePage: dataSyncSourcePage(),
      isDeleted: false,
      deletedAt: null
    });
    dataSyncSchedule();
    return true;
  }

  function dataSyncQueueDeletion(key) {
    if (!dataSyncEligible(key) || dataSyncStorageWrite) return false;
    const timestamp = new Date().toISOString();
    dataSyncQueue.set(String(key), {
      payload: { __kedco_deleted: true },
      clientUpdatedAt: timestamp,
      module: dataSyncModule(key),
      sourcePage: dataSyncSourcePage(),
      isDeleted: true,
      deletedAt: timestamp
    });
    dataSyncSchedule(250);
    return true;
  }

  function dataSyncAuthContext() {
    try {
      const stored = JSON.parse(readAuthStorage("KEDCO_AUTH_SESSION_V1") || "null");
      const session = stored?.session || stored;
      const token = String(session?.access_token || "").trim();
      const userId = String(session?.user?.id || "").trim();
      if (token && userId) return { token, userId };
    } catch {}
    return null;
  }

  function dataSyncConfig() {
    const configured = window.KEDCO_LOCAL_CONFIG || window.KEDCO_SUPABASE_CONFIG || {};
    let apiBase = String(configured.apiBase || "").trim();
    try { apiBase ||= String(localStorage.getItem("KEDCO_API_BASE") || "").trim(); } catch {}
    return { apiBase: apiBase.replace(/\/$/, "") };
  }

  function dataSyncSetLocal(key, value) {
    try {
      dataSyncStorageWrite = true;
      localStorage.setItem(key, value);
    } catch {}
    finally {
      dataSyncStorageWrite = false;
    }
  }

  function dataSyncRemoveLocal(key) {
    try {
      dataSyncStorageWrite = true;
      localStorage.removeItem(key);
    } catch {}
    finally {
      dataSyncStorageWrite = false;
    }
  }

  function dataSyncApplyRemoteSnapshot(row) {
    if (!row?.data_key || !dataSyncEligible(row.data_key)) return false;
    const meta = dataSyncReadMeta();
    const remoteTime = Date.parse(row.client_updated_at || row.updated_at || row.deleted_at || "") || 0;
    const localTime = Date.parse(meta[row.data_key] || "") || 0;
    if (localTime > remoteTime && localStorage.getItem(row.data_key) !== null) return false;
    if (row.is_deleted) {
      dataSyncRemoveLocal(row.data_key);
    } else {
      const restored = typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);
      dataSyncSetLocal(row.data_key, restored);
    }
    meta[row.data_key] = row.client_updated_at || row.updated_at || row.deleted_at || new Date().toISOString();
    dataSyncWriteMeta(meta);
    window.dispatchEvent(new CustomEvent("kedco:data-remote-applied", { detail: row }));
    return true;
  }

  async function dataSyncFetch(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`Local KEDCO backend did not respond within ${Math.round(timeoutMs / 1000)}s`);
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function dataSyncFlush(config, auth, meta) {
    if (!dataSyncQueue.size) return null;
    const pending = [...dataSyncQueue.entries()];
    const rows = pending.map(([dataKey, item]) => ({
      owner_id: auth.userId,
      data_key: dataKey,
      module: item.module || dataSyncModule(dataKey),
      payload: item.payload,
      source_page: item.sourcePage || dataSyncSourcePage(),
      client_updated_at: item.clientUpdatedAt || new Date().toISOString(),
      is_deleted: !!item.isDeleted,
      deleted_at: item.isDeleted ? (item.deletedAt || new Date().toISOString()) : null
    }));
    let localVersion = null;
    for (let start = 0; start < rows.length; start += 250) {
      const response = await dataSyncFetch(`${config.apiBase}/api/local/snapshots`, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rows.slice(start, start + 250) })
      });
      if (!response.ok) throw new Error(`Local snapshot save failed (${response.status}).`);
      try {
        const body = await response.json();
        const version = Number(body?.version);
        if (Number.isFinite(version)) localVersion = version;
      } catch {}
    }
    const timestamp = new Date().toISOString();
    for (const [dataKey, item] of pending) {
      if (dataSyncQueue.get(dataKey) === item) dataSyncQueue.delete(dataKey);
      meta[dataKey] = item.clientUpdatedAt || timestamp;
    }
    dataSyncWriteMeta(meta);
    return localVersion;
  }

  function dataSyncAcquireLock() {
    try {
      const now = Date.now();
      const current = JSON.parse(localStorage.getItem(DATA_SYNC_LOCK_KEY) || "null");
      if (current && Number(current.expires) > now && current.owner !== dataSyncLockOwner) return false;
      localStorage.setItem(DATA_SYNC_LOCK_KEY, JSON.stringify({ owner: dataSyncLockOwner, expires: now + DATA_SYNC_LOCK_TTL }));
      const confirmed = JSON.parse(localStorage.getItem(DATA_SYNC_LOCK_KEY) || "null");
      return confirmed?.owner === dataSyncLockOwner;
    } catch { return true; }
  }

  function dataSyncRenewLock() {
    try {
      const current = JSON.parse(localStorage.getItem(DATA_SYNC_LOCK_KEY) || "null");
      if (current?.owner === dataSyncLockOwner) {
        localStorage.setItem(DATA_SYNC_LOCK_KEY, JSON.stringify({ owner: dataSyncLockOwner, expires: Date.now() + DATA_SYNC_LOCK_TTL }));
      }
    } catch {}
  }

  function dataSyncReleaseLock() {
    try {
      const current = JSON.parse(localStorage.getItem(DATA_SYNC_LOCK_KEY) || "null");
      if (current?.owner === dataSyncLockOwner) localStorage.removeItem(DATA_SYNC_LOCK_KEY);
    } catch {}
  }

  async function dataSync() {
    if (dataSyncInFlight) return;
    const config = dataSyncConfig();
    const auth = dataSyncAuthContext();
    if (!config.apiBase || !auth || !dataSyncAcquireLock()) return;
    dataSyncInFlight = true;
    const lockRenewTimer = window.setInterval(dataSyncRenewLock, 30000);
    try {
      const versionResponse = await dataSyncFetch(`${config.apiBase}/api/local/snapshots/version`, {
        headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json" },
        cache: "no-store"
      }, 3000);
      if (!versionResponse.ok) throw new Error(`Local snapshot version check failed (${versionResponse.status}).`);
      const versionBody = await versionResponse.json();
      const localVersion = Number(versionBody?.version);
      const knownVersion = dataSyncReadRemoteVersion(auth.userId);
      if (!dataSyncQueue.size && Number.isFinite(localVersion) && knownVersion === localVersion) {
        window.KEDCO_DATA_SYNC_STATUS = "synced";
        window.dispatchEvent(new CustomEvent("kedco:data-synced"));
        return;
      }
      const response = await dataSyncFetch(`${config.apiBase}/api/local/snapshots`, {
        headers: { Authorization: `Bearer ${auth.token}`, Accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Local snapshot read failed (${response.status}).`);
      const body = await response.json();
      const rows = Array.isArray(body?.data) ? body.data : [];
      const snapshots = new Map(rows.map(row => [row.data_key, row]));
      const meta = dataSyncReadMeta();
      const keys = Object.keys(localStorage).filter(dataSyncEligible);
      for (const key of keys) {
        const localValue = localStorage.getItem(key);
        const queued = dataSyncQueue.has(key);
        const row = snapshots.get(key);
        if (queued) continue;
        if (!row) {
          if (localValue !== null) dataSyncQueueValue(key, localValue);
          continue;
        }
        if (row.is_deleted) {
          if (localValue !== null) dataSyncRemoveLocal(key);
          meta[key] = row.client_updated_at || row.updated_at || row.deleted_at || new Date().toISOString();
          continue;
        }
        const snapshotTime = Date.parse(row.client_updated_at || row.updated_at || "") || 0;
        const localTime = Date.parse(meta[key] || "") || 0;
        if (localTime > snapshotTime && localValue !== null) {
          dataSyncQueueValue(key, localValue, meta[key]);
          continue;
        }
        const restored = typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);
        if (localValue !== restored) dataSyncSetLocal(key, restored);
        meta[key] = row.client_updated_at || row.updated_at || new Date().toISOString();
      }
      for (const [key, row] of snapshots) {
        if (!dataSyncEligible(key) || dataSyncQueue.has(key)) continue;
        if (row.is_deleted) {
          if (localStorage.getItem(key) !== null) dataSyncRemoveLocal(key);
          meta[key] = row.client_updated_at || row.updated_at || row.deleted_at || new Date().toISOString();
          continue;
        }
        if (localStorage.getItem(key) !== null) continue;
        const restored = typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);
        dataSyncSetLocal(key, restored);
        meta[key] = row.client_updated_at || row.updated_at || new Date().toISOString();
      }
      dataSyncWriteMeta(meta);
      const flushedVersion = await dataSyncFlush(config, auth, meta);
      dataSyncWriteRemoteVersion(auth.userId, Number.isFinite(flushedVersion) ? flushedVersion : localVersion);
      window.KEDCO_DATA_SYNC_STATUS = "synced";
      window.dispatchEvent(new CustomEvent("kedco:data-synced"));
    } catch (error) {
      window.KEDCO_DATA_SYNC_STATUS = "offline";
      console.warn("KEDCO local data sync is unavailable; browser data remains safe:", error?.message || error);
    } finally {
      window.clearInterval(lockRenewTimer);
      dataSyncReleaseLock();
      dataSyncInFlight = false;
    }
  }

  function dataSyncSchedule(delay = DATA_SYNC_DEBOUNCE_MS) {
    if (dataSyncTimer) window.clearTimeout(dataSyncTimer);
    dataSyncTimer = window.setTimeout(() => void dataSync(), delay);
  }

  function installDataSync() {
    if (window.__KEDCO_DATA_SYNC_INSTALLED__) return;
    window.__KEDCO_DATA_SYNC_INSTALLED__ = true;
    window.KEDCO_DATA_SYNC = {
      saveSnapshot: dataSyncSaveSnapshot,
      deleteSnapshot: dataSyncQueueDeletion,
      applyRemoteSnapshot: dataSyncApplyRemoteSnapshot,
      sync: dataSync,
      getStatus: () => window.KEDCO_DATA_SYNC_STATUS || "pending"
    };
    window.dispatchEvent(new CustomEvent("kedco:data-sync-ready"));
    const nativeSetItem = Storage.prototype.setItem;
    const nativeRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key, value) {
      const result = nativeSetItem.call(this, key, value);
      if (this === window.localStorage) {
        if (dataSyncEligible(key)) dataSyncQueueValue(key, value);
        else if (/^sb-.+-auth-token$/i.test(String(key))) dataSyncSchedule(500);
      }
      return result;
    };
    Storage.prototype.removeItem = function (key) {
      const result = nativeRemoveItem.call(this, key);
      if (this === window.localStorage && dataSyncEligible(key) && !dataSyncStorageWrite) {
        dataSyncQueueDeletion(key);
      }
      return result;
    };
    window.addEventListener("storage", event => {
      if (dataSyncEligible(event.key)) dataSyncSchedule(DATA_SYNC_DEBOUNCE_MS);
      else if (/^sb-.+-auth-token$/i.test(String(event.key || ""))) dataSyncSchedule(500);
    });
    if (!dataSyncInterval) dataSyncInterval = window.setInterval(() => void dataSync(), DATA_SYNC_POLL_MS);
  }

  function loadLocalStorageConfig() {
    if (window.KEDCO_LOCAL_CONFIG?.apiBase) return Promise.resolve();
    if (window.__kedcoLocalConfigPromise) return window.__kedcoLocalConfigPromise;
    const source = `${pageRoot()}supabase-config.js`;
    window.__kedcoLocalConfigPromise = new Promise(resolve => {
      const script = document.createElement("script");
      script.src = source;
      script.onload = resolve;
      script.onerror = resolve;
      document.head.appendChild(script);
    });
    return window.__kedcoLocalConfigPromise;
  }

  function roleRoute(code) {
    const route = window.KEDCO_PAGE_ROUTES?.[code] || FALLBACK_ROLE_ROUTES[code] || "";
    if (!route) return "";
    try {
      return new URL(`${pageRoot()}${String(route).replace(/^\.\//, "")}`, window.location.href).href;
    } catch {
      return "";
    }
  }

  function installRoleSwitcher() {
    if (window.__KEDCO_ACCOUNT_CONTROLS_V5__ || document.getElementById("kedcoAccountV5")) return;
    const roles = roleCodes();
    const sidebar = document.querySelector("aside.side, aside.sidebar, .side, .sidebar");
    if (roles.length < 2 || !sidebar || document.getElementById("kedcoRoleSwitcher")) return;

    let current = "";
    try {
      current = String(readAuthStorage("KEDCO_AUTH_ROLE") || readAuthStorage("KEDCO_ACTIVE_ROLE_CODE") || "").trim().toUpperCase();
    } catch {}
    if (!roles.includes(current)) current = roles[0];

    const wrapper = document.createElement("div");
    wrapper.id = "kedcoRoleSwitcher";
    wrapper.className = "kedco-role-switcher";
    const label = document.createElement("label");
    label.htmlFor = "kedcoRoleSelect";
    label.textContent = "Working role";
    const select = document.createElement("select");
    select.id = "kedcoRoleSelect";
    select.setAttribute("aria-label", "Switch working role");
    roles.forEach((code) => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = `${roleLabel(code)} (${code})`;
      select.appendChild(option);
    });
    select.value = current;
    select.addEventListener("change", () => {
      const nextRole = select.value;
      if (!roles.includes(nextRole)) return;
      try {
        writeAuthStorage("KEDCO_AUTH_ROLE", nextRole);
        writeAuthStorage("KEDCO_ACTIVE_ROLE_CODE", nextRole);
      } catch {}
      const nextUrl = roleRoute(nextRole);
      if (!nextUrl) return;
      if (new URL(nextUrl).href === window.location.href) window.location.reload();
      else window.location.assign(nextUrl);
    });
    const hint = document.createElement("small");
    hint.textContent = "Switch role without signing in again";
    wrapper.append(label, select, hint);
    const footer = sidebar.querySelector(".side-foot, .sidebar-foot, .sidebar-footer, .side-note");
    if (footer) footer.before(wrapper);
    else sidebar.appendChild(wrapper);
  }

  function installLocalCloudBadge() {
    if (!window.KEDCO_LOCAL_MODE || document.getElementById("kedcoLocalCloudBadge")) return;
    const badge = document.createElement("div");
    badge.id = "kedcoLocalCloudBadge";
    badge.className = "kedco-local-cloud-badge";
    badge.title = "Persistent Local Cloud storage is active. Data is written under the project cloud data folder.";
    badge.innerHTML = "<i></i><span>LOCAL CLOUD · cloud data/</span>";
    document.body.appendChild(badge);
  }

  function loadPageRoutes() {
    if (window.KEDCO_PAGE_ROUTES) return Promise.resolve();
    if (window.__kedcoPageRoutesPromise) return window.__kedcoPageRoutesPromise;
    const source = `${pageRoot()}kedco-page-routes.js`;
    window.__kedcoPageRoutesPromise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = source;
      script.onload = resolve;
      script.onerror = resolve;
      document.head.appendChild(script);
    });
    return window.__kedcoPageRoutesPromise;
  }

  async function init() {
    addSharedStyles();
    installTextRepair();
    installDataSync();
    await loadLocalStorageConfig();
    installLocalCloudBadge();
    window.setTimeout(() => void dataSync(), 2000);
    installLogout();
    await loadPageRoutes();
    installRoleSwitcher();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();

/* KEDCO cloud evidence + realtime extension loader */
(() => {
  if (window.__KEDCO_CLOUD_BACKUP_LOADER__) return;
  window.__KEDCO_CLOUD_BACKUP_LOADER__ = true;
  const root = (() => { const p = window.location.pathname; return p.includes("/pages/") ? "../../" : (p.includes("/frontend/") ? "./" : "frontend/"); })();
  const script = document.createElement("script");
  script.src = `${root}kedco-cloud-backup.js`;
  script.defer = true;
  document.head.appendChild(script);
})();

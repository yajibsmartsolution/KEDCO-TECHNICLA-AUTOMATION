/* Central RE/TE e-form dispatch and feedback bridge.
   The form pages keep their local register for printing/offline continuity, but
   a form is only reported as SENT after this authenticated central RPC succeeds. */
(function (global) {
  "use strict";

  const FORM_CODES = new Set(["ppe", "toolbox", "risk", "sgapp", "sg", "trouble", "requisition"]);
  const RECEIVER_PAGES = new Set([
    "headso.html", "headom.html", "headpcm.html", "headpi.html",
    "regionalpcm.html", "regionalpi.html", "regionalcj.html", "regionalef.html"
  ]);
  let client = null;
  let box = "sent";
  let rows = [];

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  function pageName() {
    return String(global.location?.pathname || "").split("/").pop().toLowerCase();
  }

  function isSenderPage() {
    return pageName() === "re_te.html" || pageName() === "super_re_te.html";
  }

  function isReceiverPage() {
    return RECEIVER_PAGES.has(pageName());
  }

  function getClient() {
    if (!client && global.supabase?.createClient) client = global.supabase.createClient("", "");
    return client;
  }

  function compactValue(value, depth) {
    if (depth > 4) return "[nested form data]";
    if (typeof value === "string") return value.length > 60000 ? "[large signature/image omitted from central copy]" : value;
    if (Array.isArray(value)) return value.slice(0, 200).map(item => compactValue(item, depth + 1));
    if (value && typeof value === "object") {
      const result = {};
      Object.keys(value).slice(0, 500).forEach(key => { result[key] = compactValue(value[key], depth + 1); });
      return result;
    }
    return value;
  }

  function formCode(record) {
    const value = String(record?.type || "").trim().toLowerCase();
    return FORM_CODES.has(value) ? value : "";
  }

  function dateText(value) {
    const stamp = Date.parse(String(value || ""));
    return Number.isNaN(stamp) ? "-" : new Date(stamp).toLocaleString();
  }

  function statusClass(value) {
    return String(value || "PENDING").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  }

  function panelMarkup() {
    const receiver = isReceiverPage();
    return `<section id="kedcoReteWorkflowPanel" class="kedco-rete-workflow-panel">
      <div class="kedco-rete-workflow-head">
        <div><span class="kedco-rete-kicker">CENTRAL KEDCO WORKFLOW</span><h2>${receiver ? "Incoming RE/TE E-forms" : "RE/TE E-form Dispatch & Feedback"}</h2>
        <p>${receiver ? "Review authenticated RE/TE submissions assigned to your role and return a traceable response." : "Send all seven RE/TE e-form types to the responsible KEDCO office and track receipt, approval and feedback."}</p></div>
        <div class="kedco-rete-workflow-actions"><span class="kedco-rete-count">7 E-FORM TYPES</span><button type="button" data-rete-refresh>Refresh</button></div>
      </div>
      <div class="kedco-rete-workflow-status" data-rete-workflow-status>Connecting to central local cloud...</div>
      <div class="kedco-rete-workflow-table-wrap"><table class="kedco-rete-workflow-table"><thead><tr>${receiver ? "<th>Sender</th>" : "<th>Reference</th>"}<th>Form</th><th>${receiver ? "Region / recipient" : "Recipient"}</th><th>Sent</th><th>Status</th><th>Feedback</th><th>Action</th></tr></thead><tbody data-rete-workflow-rows><tr><td colspan="7" class="kedco-rete-empty">Loading central workflow...</td></tr></tbody></table></div>
    </section>`;
  }

  function ensureStyles() {
    if (document.getElementById("kedcoReteWorkflowStyles")) return;
    const style = document.createElement("style");
    style.id = "kedcoReteWorkflowStyles";
    style.textContent = `
      .kedco-rete-workflow-panel{margin:18px 26px 30px;padding:18px;background:#fff;border:1px solid #cfdceb;border-radius:16px;box-shadow:0 10px 28px rgba(7,35,76,.08);color:#172033}
      .kedco-rete-workflow-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:12px}
      .kedco-rete-workflow-head h2{margin:4px 0 5px;color:#061b3a;font-size:19px}.kedco-rete-workflow-head p{margin:0;color:#64748b;font-size:10px;line-height:1.55}
      .kedco-rete-kicker{font-size:9px;font-weight:1000;letter-spacing:.13em;color:#0a62b8}.kedco-rete-workflow-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.kedco-rete-count{padding:6px 9px;border-radius:999px;background:#fff6d8;color:#805900;font-size:8px;font-weight:1000;white-space:nowrap}.kedco-rete-workflow-actions button{border:1px solid #c9d7e7;background:#f7fbff;color:#0a4386;border-radius:8px;padding:7px 11px;font-size:10px;font-weight:900}
      .kedco-rete-workflow-status{padding:8px 10px;border-radius:8px;background:#eef4fa;color:#53657a;font-size:9px;margin-bottom:10px}.kedco-rete-workflow-status.ok{background:#eaf8f0;color:#087044}.kedco-rete-workflow-status.error{background:#fff0f1;color:#982131}
      .kedco-rete-workflow-table-wrap{overflow:auto;border:1px solid #d9e2ee;border-radius:10px;max-height:440px}.kedco-rete-workflow-table{width:100%;border-collapse:collapse;min-width:850px}.kedco-rete-workflow-table th{padding:9px 10px;background:#092f63;color:#fff;text-align:left;font-size:9px;white-space:nowrap}.kedco-rete-workflow-table td{padding:9px 10px;border-bottom:1px solid #e6edf5;vertical-align:top;font-size:9px}.kedco-rete-workflow-table tr:hover td{background:#f8fbff}.kedco-rete-empty{text-align:center!important;color:#64748b;padding:24px!important}.kedco-rete-ref{font-weight:1000;color:#0a4386;white-space:nowrap}.kedco-rete-sub{display:block;color:#64748b;font-size:8px;margin-top:3px;line-height:1.4}.kedco-rete-badge{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:8px;font-weight:1000;background:#edf3fb;color:#174a82;white-space:nowrap}.kedco-rete-badge.approved,.kedco-rete-badge.completed{background:#eaf8f0;color:#087044}.kedco-rete-badge.returned{background:#fff0f1;color:#982131}.kedco-rete-badge.received,.kedco-rete-badge.in-review{background:#fff6d8;color:#805900}.kedco-rete-row-actions{display:flex;gap:4px;flex-wrap:wrap;min-width:180px}.kedco-rete-row-actions button{border:1px solid #c9d7e7;background:#fff;border-radius:6px;padding:5px 7px;color:#174a82;font-size:8px;font-weight:900}.kedco-rete-row-actions button[data-rete-action="RETURNED"]{color:#982131;background:#fff7f7}.kedco-rete-feedback{max-width:230px;line-height:1.4;color:#53657a}.kedco-rete-detail{margin-top:4px;color:#64748b;font-size:8px}
      @media(max-width:700px){.kedco-rete-workflow-panel{margin:14px 12px 24px;padding:13px}.kedco-rete-workflow-head{display:block}.kedco-rete-workflow-actions{margin-top:10px}}
    `;
    document.head.appendChild(style);
  }

  function rowDetail(row) {
    const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
    const keys = Object.keys(payload).filter(key => String(payload[key] ?? "").trim()).slice(0, 4);
    return keys.length ? `<span class="kedco-rete-detail">Fields: ${esc(keys.join(", "))}</span>` : "";
  }

  function renderRows() {
    const target = document.querySelector("[data-rete-workflow-rows]");
    if (!target) return;
    if (!rows.length) {
      target.innerHTML = `<tr><td colspan="7" class="kedco-rete-empty">No central ${box === "inbox" ? "incoming" : "sent"} RE/TE e-forms found.</td></tr>`;
      return;
    }
    const receiver = isReceiverPage();
    target.innerHTML = rows.map(row => {
      const status = String(row.status || "SENT").toUpperCase();
      const actions = receiver && row.can_update && row.source_type !== "OPERATOR_WORKFLOW" ? `<div class="kedco-rete-row-actions"><button type="button" data-rete-action="RECEIVED" data-rete-id="${esc(row.id)}">Acknowledge</button><button type="button" data-rete-action="IN_REVIEW" data-rete-id="${esc(row.id)}">In review</button><button type="button" data-rete-action="APPROVED" data-rete-id="${esc(row.id)}">Approve</button><button type="button" data-rete-action="RETURNED" data-rete-id="${esc(row.id)}">Return</button><button type="button" data-rete-action="COMPLETED" data-rete-id="${esc(row.id)}">Complete</button></div>` : `<span class="kedco-rete-sub">Awaiting recipient feedback</span>`;
      const senderCell = receiver ? `<b>${esc(row.sender_name || row.sender_email || "RE/TE")}</b><span class="kedco-rete-sub">${esc(row.sender_email || "")}</span>` : `<span class="kedco-rete-ref">${esc(row.reference)}</span>${row.form_code ? `<span class="kedco-rete-sub">${esc(row.reference || "")}</span>` : ""}`;
      const destination = receiver ? `${esc(row.region || "-")}<span class="kedco-rete-sub">${esc(row.recipient || row.recipient_role || "")}</span>` : `<b>${esc(row.recipient || row.recipient_role || "-")}</b>${row.recipient_office ? `<span class="kedco-rete-sub">${esc(row.recipient_office)}</span>` : ""}`;
      return `<tr><td>${senderCell}</td><td><b>${esc(row.form_title || row.form_code || "RE/TE e-form")}</b>${rowDetail(row)}</td><td>${destination}</td><td>${esc(dateText(row.sent_at || row.created_at))}</td><td><span class="kedco-rete-badge ${statusClass(status)}">${esc(status)}</span></td><td class="kedco-rete-feedback">${esc(row.feedback || "No feedback yet.")}${row.feedback_by_name ? `<span class="kedco-rete-sub">By ${esc(row.feedback_by_name)} ? ${esc(dateText(row.feedback_at))}</span>` : ""}</td><td><button type="button" data-rete-open="${esc(row.id)}">Open form / Act / Forward</button>${actions}</td></tr>`;
    }).join("");
  }

  function setStatus(message, type) {
    const element = document.querySelector("[data-rete-workflow-status]");
    if (!element) return;
    element.className = `kedco-rete-workflow-status${type ? ` ${type}` : ""}`;
    element.textContent = message;
  }

  async function refresh() {
    const api = getClient();
    if (!api) { setStatus("Central KEDCO client is unavailable. The form has not been centrally sent.", "error"); return []; }
    setStatus("Refreshing authenticated central workflow...");
    const result = await api.rpc("kedco_list_re_te_eforms", { requested_box: box });
    if (result.error) { setStatus(result.error.message || "Central workflow could not be loaded.", "error"); return []; }
    rows = Array.isArray(result.data) ? result.data : [];
    renderRows();
    setStatus(`${rows.length} central record${rows.length === 1 ? "" : "s"} loaded. Feedback is shared between authorised KEDCO pages.`, "ok");
    return rows;
  }

  async function send(record) {
    const api = getClient();
    if (!api) throw new Error("Central KEDCO client is unavailable.");
    const code = formCode(record);
    if (!code) throw new Error("Unsupported RE/TE e-form type.");
    const form = document.querySelector('form[data-form-type="' + code + '"]');
    const routing = global.KEDCO_CENTRAL_EFORM_WORKFLOW?.recipientFor(form) || {};
    const result = await api.rpc("kedco_send_re_te_eform", {
      requested_reference: record.reference,
      requested_form_code: code,
      requested_form_title: record.formName,
      requested_recipient_role: routing.role || record.recipientRole,
      requested_recipient: record.recipient,
      requested_recipient_office: record.recipientOffice,
      requested_recipient_region: routing.region || null,
      requested_recipient_station: routing.station || null,
      requested_note: record.note,
      requested_region: record.data?.region || record.data?.reteRegion || "",
      requested_state: record.data?.state || "",
      requested_source_page: pageName(),
      requested_copy_record_id: record.reference,
      requested_payload: compactValue(record.data || {}, 0),
      requested_form_document: await global.KEDCO_CENTRAL_EFORM_WORKFLOW?.prepareFormDocument(form)
    });
    if (result.error) throw result.error;
    const recordData = result.data?.record;
    if (!result.data?.ok || !recordData) throw new Error("Central workflow did not confirm the e-form.");
    return recordData;
  }

  async function updateRecord(id, action) {
    const current = rows.find(row => String(row.id) === String(id));
    if (!current) return;
    let feedback = "";
    if (action === "RETURNED") {
      feedback = global.prompt("Enter the reason / feedback to return this e-form:", "Please correct and resubmit:") || "";
      if (!feedback.trim()) return;
    } else if (action === "APPROVED" || action === "COMPLETED") {
      feedback = global.prompt("Optional feedback for the RE/TE sender:", "") || "";
    }
    setStatus(`Saving ${action.toLowerCase()} feedback for ${current.reference}...`);
    const result = await getClient().rpc("kedco_update_re_te_eform", { requested_id: id, requested_status: action, requested_feedback: feedback });
    if (result.error) { setStatus(result.error.message || "Feedback could not be saved.", "error"); return; }
    await refresh();
  }

  function bind() {
    document.querySelector("[data-rete-refresh]")?.addEventListener("click", () => { void refresh(); });
    document.querySelector("[data-rete-workflow-rows]")?.addEventListener("click", event => {
      const open = event.target.closest('[data-rete-open]');
      if (open) { const row = rows.find(row => String(row.id) === open.dataset.reteOpen); global.KEDCO_CENTRAL_EFORM_WORKFLOW?.openRecord(open.dataset.reteOpen, row); return; }
      const button = event.target.closest("[data-rete-action]");
      if (button) void updateRecord(button.dataset.reteId, button.dataset.reteAction);
    });
  }

  function watchLegacyDispatchStatus() {
    if (!isSenderPage() || !global.MutationObserver) return;
    const observer = new MutationObserver(() => {
      document.querySelectorAll("[data-send-status]").forEach(element => {
        if (!element.textContent.includes("Connect the portal to Supabase/server messaging")) return;
        element.innerHTML = element.innerHTML.replace(
          "Recorded in this browser's digital workflow queue. Connect the portal to Supabase/server messaging for delivery between different users/devices.",
          "Central KEDCO delivery confirmed. Receipt, approval, return and completion feedback will appear in the RE/TE workflow panel."
        );
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function mount() {
    if (!isSenderPage() && !isReceiverPage()) return;
    if (document.getElementById("kedcoReteWorkflowPanel")) return;
    ensureStyles();
    const host = document.querySelector("main.main, .main, main") || document.body;
    host.insertAdjacentHTML("beforeend", panelMarkup());
    box = isReceiverPage() ? "inbox" : "sent";
    bind();
    watchLegacyDispatchStatus();
    void refresh();
    global.setInterval(() => { if (document.visibilityState !== "hidden") void refresh(); }, 15000);
  }

  global.KEDCO_RETE_EFORM_WORKFLOW = { send, refresh, compactValue };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})(window);

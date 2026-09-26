(function () {
  "use strict";

  if (window.__kedcoLinkedEformsInstalled) return;
  window.__kedcoLinkedEformsInstalled = true;

  const page = document.body?.dataset.kedcoEformsPage || "dispatch";
  const isOperator = page === "operator";
  const linkedStateFallback = {};

  const parentDocuments = {
    of1: [
      { code: "JHA_RISK_ASSESSMENT", title: "JHA / Risk Assessment", required: true, childFormId: "jha", note: "Required before submission." },
      { code: "SINGLE_LINE_DIAGRAM", title: "Single Line Diagram", required: true, note: "Upload the approved current diagram." },
      { code: "PROTECTION_SETTINGS", title: "Protection Settings", required: false, note: "Upload the applicable settings or study." }
    ],
    of2: [
      { code: "JHA_RISK_ASSESSMENT", title: "JHA / Risk Assessment", required: true, childFormId: "jha", note: "Required before submission." },
      { code: "TOOLBOX_TALK", title: "Tool Box Talk", required: true, childFormId: "toolbox", note: "Required before submission." },
      { code: "SINGLE_LINE_DIAGRAM", title: "Single Line Diagram", required: false, note: "Upload the approved current diagram." }
    ],
    of3: [
      { code: "JHA_RISK_ASSESSMENT", title: "JHA / Risk Assessment", required: true, childFormId: "jha", note: "Required before submission." },
      { code: "TOOLBOX_TALK", title: "Tool Box Talk", required: true, childFormId: "toolbox", note: "Required before submission." }
    ],
    of4: [
      { code: "PPE_CHECKLIST", title: "PPE", required: true, childFormId: "ppe", note: "Complete the existing PPE e-form before submission." },
      { code: "TOOLBOX_TALK", title: "TOOL BOX TALK REPORT FORM", required: true, childFormId: "toolbox", note: "Complete the existing Tool Box Talk Report e-form before submission." },
      { code: "JOB_SAFETY", title: "JOB SAFETY", required: true, childFormId: "jha", note: "Complete the existing Job Safety / Risk Assessment e-form before submission." }
    ],
    of17: [
      { code: "SWITCHING_SCHEDULE", title: "Switching / Isolation Schedule", required: true, note: "Upload the approved switching schedule." },
      { code: "SINGLE_LINE_DIAGRAM", title: "Single Line Diagram", required: false, note: "Upload the approved current diagram." }
    ],
    of19: [
      { code: "FAULT_PHOTO_EVIDENCE", title: "Fault / Site Photo Evidence", required: false, note: "Upload photographs where available." }
    ]
  };

  function appState() {
    try {
      if (typeof state !== "undefined" && state) return state;
    } catch (_) {}
    return linkedStateFallback;
  }

  function currentFormId() {
    const s = appState();
    return String(s.currentForm || document.querySelector("#formCanvas form")?.dataset.form || "");
  }

  function userId() {
    const s = appState();
    return String(s.session?.userId || "anonymous").replace(/[^a-zA-Z0-9_.-]/g, "_");
  }

  function contextStorageKey() {
    return `kedcoLinkedEformContext:${userId()}`;
  }

  function linkStorageKey(parentFormId, docCode) {
    return `kedcoLinkedEform:${userId()}:${parentFormId}:${docCode}`;
  }

  function readStorage(key) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (_) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function loadContextStack() {
    const s = appState();
    if (!Array.isArray(s.kedcoLinkedEformStack)) {
      const saved = readStorage(contextStorageKey());
      s.kedcoLinkedEformStack = Array.isArray(saved) ? saved : [];
    }
    return s.kedcoLinkedEformStack;
  }

  function saveContextStack() {
    writeStorage(contextStorageKey(), loadContextStack());
  }

  function activeContext() {
    const stack = loadContextStack();
    return stack.length ? stack[stack.length - 1] : null;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character]));
  }

  function formTitle(formId) {
    try {
      const definition = (typeof FORM_DEFS !== "undefined" ? FORM_DEFS : []).find(item => item[0] === formId);
      return definition?.[1] || formId;
    } catch (_) {
      return formId;
    }
  }

  function documentDefinition(parentFormId, docCode) {
    return (parentDocuments[parentFormId] || []).find(item => item.code === docCode) || null;
  }

  function readLinkedRecord(parentFormId, docCode) {
    const record = readStorage(linkStorageKey(parentFormId, docCode));
    return record && record.parentFormId === parentFormId && record.docCode === docCode ? record : null;
  }

  function linkedRecords(parentFormId) {
    return (parentDocuments[parentFormId] || [])
      .map(item => readLinkedRecord(parentFormId, item.code))
      .filter(Boolean);
  }

  function readForm(form) {
    try {
      if (typeof serializeForm === "function") return serializeForm(form);
    } catch (_) {}
    const data = {};
    try {
      new FormData(form).forEach((value, key) => { data[key] = value; });
    } catch (_) {}
    return data;
  }

  function scalar(value) {
    if (Array.isArray(value)) return value.length ? value[0] : "";
    return value == null ? "" : value;
  }

  function normalizedInputValue(element, value) {
    let result = scalar(value);
    if (typeof result !== "string") return result;
    if (element.type === "date" && result.includes("T")) result = result.slice(0, 10);
    if (element.type === "datetime-local" && result.includes("T")) result = result.replace(/Z$/, "").slice(0, 16);
    return result;
  }

  function assignElement(element, value, onlyIfBlank) {
    if (!element || !element.name || value == null) return false;
    const result = normalizedInputValue(element, value);
    if (element.type === "checkbox") {
      if (!onlyIfBlank || !element.checked) element.checked = result === true || result === "true" || result === "on" || result === 1;
      return true;
    }
    if (element.type === "radio") {
      if (!onlyIfBlank || !element.checked) element.checked = String(result) === String(element.value);
      return true;
    }
    if (onlyIfBlank && String(element.value || "").trim()) return false;
    if (element.tagName === "SELECT") {
      const option = Array.from(element.options).find(item => String(item.value) === String(result) || String(item.textContent).trim() === String(result));
      if (!option) return false;
      element.value = option.value;
    } else {
      element.value = result;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function applyFormData(form, data, onlyIfBlank) {
    if (!form || !data || typeof data !== "object") return;
    Array.from(form.elements || []).forEach(element => {
      if (!element.name || !(element.name in data)) return;
      assignElement(element, data[element.name], onlyIfBlank);
    });
  }

  function parentContextValue(data, keys) {
    for (const key of keys) {
      const value = scalar(data?.[key]);
      if (String(value).trim()) return value;
    }
    return "";
  }

  function prefillChildForm(form, context, record) {
    if (!form || !context) return;
    if (record?.data) applyFormData(form, record.data, false);
    const parentData = context.parentData || {};
    applyFormData(form, parentData, true);

    const aliases = {
      station: ["station", "dailyStation", "issuing", "protectedStation", "source", "location"],
      feeder: ["feeder", "dailyFeeder", "apparatus", "protectedFeeder"],
      jobactivity: ["jobActivity", "plannedReason", "workReason", "workCategory", "reason"],
      job: ["job", "jobActivity", "plannedReason", "workReason", "workCategory"],
      department: ["department"],
      supervisor: ["supervisor"],
      operator: ["operator", "employee", "applicant", "presenter", "originator"],
      presenter: ["presenter", "operator", "employee", "applicant"],
      applicant: ["applicant", "operator", "employee", "originator"],
      date: ["date", "dailyDate", "dateTime"],
      datetime: ["dateTime", "date", "dailyDatetimeLocal"],
      from: ["from", "requestedFrom", "dailyOpenedAt"],
      to: ["to", "requestedTo", "dailyClosedAt"]
    };

    Array.from(form.elements || []).forEach(element => {
      if (!element.name || element.disabled || element.type === "hidden" || String(element.value || "").trim()) return;
      const key = element.name.toLowerCase();
      let keys = aliases[key];
      if (!keys && key.includes("station")) keys = aliases.station;
      if (!keys && (key.includes("feeder") || key.includes("apparatus"))) keys = aliases.feeder;
      if (!keys && key.includes("supervisor")) keys = aliases.supervisor;
      if (!keys && key.includes("department")) keys = aliases.department;
      if (!keys && key.includes("operator")) keys = aliases.operator;
      if (!keys && key.includes("presenter")) keys = aliases.presenter;
      if (!keys && key.includes("applicant")) keys = aliases.applicant;
      if (!keys && key === "date") keys = aliases.date;
      if (!keys) return;
      const value = parentContextValue(parentData, keys);
      if (value) assignElement(element, value, true);
    });
  }

  function generatedEvidenceFile(context, record) {
    if (typeof File !== "function") return null;
    const definition = documentDefinition(context.parentFormId, context.docCode);
    const payload = {
      documentType: "KEDCO_LINKED_EFORM",
      documentCode: context.docCode,
      documentTitle: definition?.title || context.docCode,
      childForm: record.childFormId,
      childFormTitle: record.childFormTitle,
      parentForm: record.parentFormId,
      parentFormTitle: record.parentFormTitle,
      savedAt: record.savedAt,
      data: record.data
    };
    const filename = `${String(record.childFormId || "eform").replace(/[^a-zA-Z0-9_-]/g, "_")}-${String(context.docCode).toLowerCase()}.json`;
    return new File([JSON.stringify(payload, null, 2)], filename, { type: "application/json", lastModified: Date.now() });
  }

  function attachGeneratedEvidence(input, context, record) {
    if (!input || !record || input.files?.length) return Boolean(input?.files?.length);
    const file = generatedEvidenceFile(context, record);
    if (!file || typeof DataTransfer !== "function") return false;
    try {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dataset.kedcoLinkedAttached = record.savedAt || "1";
      return true;
    } catch (_) {
      return false;
    }
  }

  function statusFor(doc, record, input) {
    const status = doc.querySelector("[data-kedco-linked-status]");
    if (!status) return;
    if (record) {
      const attached = Boolean(input?.files?.length) || input?.dataset.kedcoLinkedAttached;
      status.textContent = attached ? `ADDED · ${record.childFormTitle}` : `ADDED · ${record.childFormTitle} (metadata saved)`;
      status.className = "kedco-linked-status added";
    } else {
      status.textContent = "Not added yet";
      status.className = "kedco-linked-status pending";
    }
  }

  function openChildForm(parentForm, docCode) {
    const parentFormId = currentFormId();
    const definition = documentDefinition(parentFormId, docCode);
    if (!parentForm || !definition?.childFormId) return;
    const s = appState();
    const stack = loadContextStack();
    stack.push({
      parentFormId,
      parentFormTitle: formTitle(parentFormId),
      docCode,
      childFormId: definition.childFormId,
      childFormTitle: formTitle(definition.childFormId),
      parentData: readForm(parentForm),
      openedAt: new Date().toISOString()
    });
    saveContextStack();
    try { if (typeof saveFormDraft === "function") saveFormDraft(); } catch (_) {}
    s.currentForm = definition.childFormId;
    localStorage.setItem("currentForm", s.currentForm);
    try { if (typeof renderFormsPicker === "function") renderFormsPicker(); } catch (_) {}
    if (typeof renderForm === "function") renderForm(definition.childFormId);
  }

  function attachChildAndReturn() {
    const context = activeContext();
    const childForm = document.querySelector("#formCanvas form");
    if (!context || !childForm || currentFormId() !== context.childFormId) return;
    const record = {
      parentFormId: context.parentFormId,
      parentFormTitle: context.parentFormTitle,
      docCode: context.docCode,
      childFormId: context.childFormId,
      childFormTitle: context.childFormTitle,
      savedAt: new Date().toISOString(),
      data: readForm(childForm)
    };
    writeStorage(linkStorageKey(context.parentFormId, context.docCode), record);
    try { if (typeof saveFormDraft === "function") saveFormDraft(); } catch (_) {}
    const stack = loadContextStack();
    stack.pop();
    saveContextStack();
    const s = appState();
    s.currentForm = context.parentFormId;
    localStorage.setItem("currentForm", s.currentForm);
    try { if (typeof renderFormsPicker === "function") renderFormsPicker(); } catch (_) {}
    if (typeof renderForm === "function") renderForm(context.parentFormId);
  }

  function addReturnBanner(form, context) {
    if (form.querySelector("[data-kedco-linked-return]")) return;
    form.insertAdjacentHTML("afterbegin", `<section class="kedco-linked-return" data-kedco-linked-return>
      <div><strong>Linked e-form: ${escapeHtml(context.childFormTitle)}</strong><small>Complete this e-form, then save it and return to ${escapeHtml(context.parentFormTitle)}.</small></div>
      <button type="button" class="kedco-linked-button kedco-linked-return-button" data-kedco-linked-return-action>Save &amp; Return</button>
    </section>`);
    form.querySelector("[data-kedco-linked-return-action]")?.addEventListener("click", attachChildAndReturn);
  }

  function addLinkedControls(doc, parentForm, definition) {
    if (!definition?.childFormId || doc.querySelector("[data-kedco-linked-controls]")) return;
    const controls = document.createElement("div");
    controls.className = "kedco-linked-controls";
    controls.dataset.kedcoLinkedControls = "1";
    controls.innerHTML = `<button type="button" class="kedco-linked-button" data-kedco-linked-open>${escapeHtml(definition.required ? "Add / Open e-form" : "Add / Open optional e-form")}</button><span data-kedco-linked-status>Not added yet</span>`;
    doc.appendChild(controls);
    controls.querySelector("[data-kedco-linked-open]")?.addEventListener("click", () => openChildForm(parentForm, definition.code));
  }

  function enhanceDocument(doc, parentForm, parentFormId, definition) {
    if (!doc || !definition) return;
    const input = doc.querySelector(`[data-kedco-doc-code="${definition.code}"]`);
    if (definition.childFormId) addLinkedControls(doc, parentForm, definition);
    const record = readLinkedRecord(parentFormId, definition.code);
    if (definition.childFormId) {
      const linkedInput = doc.querySelector('input[data-kedco-doc-code]');
      if (linkedInput) linkedInput.remove();
    }
    if (record && input && !definition.childFormId) attachGeneratedEvidence(input, {
      parentFormId,
      docCode: definition.code
    }, record);
    statusFor(doc, record, input);
  }

  function createDispatchPanel(form, parentFormId) {
    if (isOperator || form.querySelector("[data-kedco-linked-panel]")) return;
    const definitions = parentDocuments[parentFormId];
    if (!definitions?.length) return;
    const items = definitions.map(definition => `<div class="kedco-linked-doc ${definition.required ? "required" : "optional"}" data-kedco-linked-doc="${definition.code}">
      <b>${definition.required ? "REQUIRED" : "OPTIONAL"} · ${escapeHtml(definition.title)}</b>
      <small>${escapeHtml(definition.note)}</small>
      <input type="file" data-kedco-doc-code="${definition.code}" ${definition.required ? "data-kedco-required=\"1\"" : ""} multiple>
    </div>`).join("");
    form.insertAdjacentHTML("beforeend", `<section class="kedco-linked-panel" data-kedco-linked-panel>
      <h4>Supporting e-forms and documents</h4>
      <p>These three safety records are existing e-forms. Use Add / Open, save each one, and return here; linked e-form data is included in the parent record and is not converted into a file attachment.</p>
      <div class="kedco-linked-grid">${items}</div>
    </section>`);
  }

  function syncHiddenLinkedForms(form, parentFormId) {
    const records = linkedRecords(parentFormId).map(record => ({
      documentCode: record.docCode,
      documentTitle: record.childFormTitle,
      childForm: record.childFormId,
      savedAt: record.savedAt,
      data: record.data
    }));
    let hidden = form.querySelector("[data-kedco-linked-json]");
    if (!hidden) {
      hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = "linkedEforms";
      hidden.dataset.kedcoLinkedJson = "1";
      form.appendChild(hidden);
    }
    hidden.value = JSON.stringify(records);
  }

  function enhanceCurrentForm() {
    const form = document.querySelector("#formCanvas form");
    if (!form) return;
    const formId = currentFormId();
    const context = activeContext();
    if (context?.childFormId === formId) {
      addReturnBanner(form, context);
      const record = readLinkedRecord(context.parentFormId, context.docCode);
      prefillChildForm(form, context, record);
    }
    if (!isOperator) createDispatchPanel(form, formId);
    const panel = form.querySelector("[data-kedco-workflow-panel], [data-kedco-linked-panel]");
    if (panel) {
      (parentDocuments[formId] || []).forEach(definition => {
        const doc = panel.querySelector(`[data-kedco-doc-code="${definition.code}"]`)?.closest(".kedco-wf-doc, .kedco-linked-doc") || panel.querySelector(`[data-kedco-linked-doc="${definition.code}"]`);
        if (doc) enhanceDocument(doc, form, formId, definition);
      });
      syncHiddenLinkedForms(form, formId);
    }
  }

  const style = document.createElement("style");
  style.id = "kedco-linked-eforms-style";
  style.textContent = `.kedco-linked-panel,.kedco-linked-return{margin:14px 0 4px;padding:13px;border:1px solid #c8d7e8;border-radius:12px;background:linear-gradient(180deg,#f8fbff,#fff);box-shadow:0 7px 18px rgba(7,48,98,.06)}
.kedco-linked-panel h4{margin:0 0 5px;color:#083d79;font-size:10px;text-transform:uppercase;letter-spacing:.04em}.kedco-linked-panel>p{margin:0 0 10px;color:#5d6c7f;font-size:8px;line-height:1.55}.kedco-linked-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.kedco-linked-doc{padding:9px;border:1px solid #d7e2ee;border-radius:9px;background:#fff}.kedco-linked-doc.required,.kedco-wf-doc.required{border-left:4px solid #a32635}.kedco-linked-doc.optional,.kedco-wf-doc.optional{border-left:4px solid #d7a72b}.kedco-linked-doc b,.kedco-wf-doc b{display:block;color:#153e69;font-size:8px;margin-bottom:4px}.kedco-linked-doc small,.kedco-wf-doc small{display:block;color:#6b788a;font-size:7px;line-height:1.45;margin-bottom:6px}.kedco-linked-doc input,.kedco-wf-doc input{font-size:8px;padding:5px}.kedco-linked-controls{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:7px}.kedco-linked-button{border:1px solid #1a73e8;border-radius:7px;padding:6px 9px;background:#1a73e8;color:#fff;font-size:8px;font-weight:800}.kedco-linked-button:hover{filter:brightness(.94)}.kedco-linked-status{font-size:8px;font-weight:800}.kedco-linked-status.added{color:#087044}.kedco-linked-status.pending{color:#982437}.kedco-linked-return{display:flex;align-items:center;justify-content:space-between;gap:12px;border-color:#9fc2e8;background:#eef6ff}.kedco-linked-return strong{display:block;color:#083d79;font-size:10px}.kedco-linked-return small{display:block;margin-top:3px;color:#52677e;font-size:8px}.kedco-linked-return-button{flex:0 0 auto}@media(max-width:800px){.kedco-linked-grid{grid-template-columns:1fr}.kedco-linked-return{align-items:flex-start;flex-direction:column}}`;
  document.head.appendChild(style);

  loadContextStack();
  const originalRenderForm = typeof renderForm === "function" ? renderForm : null;
  if (originalRenderForm) {
    try {
      renderForm = function (id) {
        originalRenderForm(id);
        window.setTimeout(enhanceCurrentForm, 0);
        window.setTimeout(enhanceCurrentForm, 120);
        window.setTimeout(enhanceCurrentForm, 500);
      };
    } catch (_) {}
  }

  const canvas = document.getElementById("formCanvas");
  if (canvas && "MutationObserver" in window) {
    new MutationObserver(() => window.setTimeout(enhanceCurrentForm, 0)).observe(canvas, { childList: true, subtree: true });
  }
  window.setTimeout(enhanceCurrentForm, 0);
  window.setTimeout(enhanceCurrentForm, 200);
})();

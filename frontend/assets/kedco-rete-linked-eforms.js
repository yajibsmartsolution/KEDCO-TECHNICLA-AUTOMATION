(function () {
  "use strict";

  if (window.__kedcoReTeLinkedEformsInstalled) return;
  window.__kedcoReTeLinkedEformsInstalled = true;

  const dependencies = {
    sgapp: [
      {
        code: "PPE_CHECKLIST",
        title: "PPE",
        childFormId: "ppe",
        required: true,
        note: "Complete the existing PPE e-form before the application is sent."
      },
      {
        code: "TOOLBOX_TALK",
        title: "TOOL BOX TALK REPORT FORM",
        childFormId: "toolbox",
        required: true,
        note: "Complete the existing Tool Box Talk Report e-form before the application is sent."
      },
      {
        code: "JOB_SAFETY",
        title: "JOB SAFETY",
        childFormId: "risk",
        required: true,
        note: "Complete the existing Job Safety / Risk Assessment e-form before the application is sent."
      }
    ],
    sg: [
      {
        code: "PPE_CHECKLIST",
        title: "PPE",
        childFormId: "ppe",
        required: true,
        note: "Complete the existing PPE e-form before the Station Guarantee is sent."
      },
      {
        code: "TOOLBOX_TALK",
        title: "TOOL BOX TALK REPORT FORM",
        childFormId: "toolbox",
        required: true,
        note: "Complete the existing Tool Box Talk Report e-form before the Station Guarantee is sent."
      },
      {
        code: "JOB_SAFETY",
        title: "JOB SAFETY",
        childFormId: "risk",
        required: true,
        note: "Complete the existing Job Safety / Risk Assessment e-form before the Station Guarantee is sent."
      }
    ]
  };

  const contextKey = "KEDCO_RE_TE_LINKED_EFORM_CONTEXT_V1";
  const recordKey = (parentFormId, documentCode) => `KEDCO_RE_TE_LINKED_EFORM_V1:${parentFormId}:${documentCode}`;
  const fallbackState = { stack: null, pendingRestore: null };

  function appState() {
    return fallbackState;
  }

  function activeId() {
    try {
      if (typeof activeFormType !== "undefined" && activeFormType) return String(activeFormType);
    } catch (_) {}
    return String(document.querySelector("#formWorkspace .ops-form")?.dataset.formType || "");
  }

  function formTitle(formId) {
    try {
      const item = (typeof formTypes !== "undefined" ? formTypes : []).find(form => form.id === formId);
      return item?.name || formId;
    } catch (_) {
      return formId;
    }
  }

  function escHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character]));
  }

  function readJson(key) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch (_) {
      return null;
    }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function loadStack() {
    const state = appState();
    if (!Array.isArray(state.stack)) {
      const saved = readJson(contextKey);
      state.stack = Array.isArray(saved) ? saved : [];
    }
    return state.stack;
  }

  function saveStack() {
    writeJson(contextKey, loadStack());
  }

  function currentContext() {
    const stack = loadStack();
    return stack.length ? stack[stack.length - 1] : null;
  }

  function definitionFor(parentFormId, documentCode) {
    return (dependencies[parentFormId] || []).find(item => item.code === documentCode) || null;
  }

  function readRecord(parentFormId, documentCode) {
    const record = readJson(recordKey(parentFormId, documentCode));
    return record && record.parentFormId === parentFormId && record.documentCode === documentCode ? record : null;
  }

  function readForm(form) {
    try {
      if (typeof serializeForm === "function") return serializeForm(form);
    } catch (_) {}
    const data = {};
    try { new FormData(form).forEach((value, key) => { data[key] = value; }); } catch (_) {}
    return data;
  }

  function values(value) {
    return Array.isArray(value) ? value.map(item => String(item)) : [String(value ?? "")];
  }

  function assignElement(element, value, onlyIfBlank) {
    if (!element?.name || value == null || element.type === "file") return false;
    const options = values(value);
    if (element.type === "checkbox" || element.type === "radio") {
      if (onlyIfBlank && element.checked) return false;
      element.checked = options.includes(String(element.value)) || options.includes("true") || (options.length === 1 && options[0] === "on");
      return true;
    }
    if (onlyIfBlank && String(element.value || "").trim()) return false;
    const valueText = String(options[0] ?? "");
    if (element.type === "date" && valueText.includes("T")) element.value = valueText.slice(0, 10);
    else if (element.type === "datetime-local" && valueText.includes("T")) element.value = valueText.replace(/Z$/, "").slice(0, 16);
    else if (element.tagName === "SELECT") {
      const option = Array.from(element.options).find(item => String(item.value) === valueText || String(item.textContent).trim() === valueText);
      if (!option) return false;
      element.value = option.value;
    } else element.value = valueText;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function applyFormData(form, data, onlyIfBlank) {
    if (!form || !data || typeof data !== "object") return;
    Array.from(form.elements || []).forEach(element => {
      if (element.name in data) assignElement(element, data[element.name], onlyIfBlank);
    });
  }

  function parentValue(data, keys) {
    for (const key of keys) {
      const value = Array.isArray(data?.[key]) ? data[key][0] : data?.[key];
      if (String(value ?? "").trim()) return value;
    }
    return "";
  }

  function prefillChild(form, context, record) {
    if (!form || !context) return;
    if (record?.data) applyFormData(form, record.data, false);
    applyFormData(form, context.parentData, true);

    const parentData = context.parentData || {};
    const aliases = {
      state: ["state"],
      region: ["region"],
      department: ["department", "issuedAtDepartment"],
      unit: ["unit", "issuedAtUnit"],
      station: ["station", "issuingStation", "applyTo", "jobSite", "location", "locationTrouble"],
      feeder: ["feeder", "workProtected", "isolationGuarantee", "deenergisingGuarantee"],
      jobactivity: ["jobActivity", "plannedReason", "workReason", "job", "description"],
      job: ["job", "jobActivity", "plannedReason", "workReason"],
      supervisor: ["supervisor", "holder"],
      operator: ["operator", "applicant", "employee", "presenter", "preparedBy"],
      presenter: ["presenter", "applicant", "employee"],
      date: ["date", "applicantDate", "approvedDate", "issueDate"]
    };

    Array.from(form.elements || []).forEach(element => {
      if (!element.name || element.disabled || element.type === "hidden" || element.type === "file" || String(element.value || "").trim()) return;
      const key = element.name.toLowerCase();
      let keys = aliases[key];
      if (!keys && key.includes("station")) keys = aliases.station;
      if (!keys && (key.includes("feeder") || key.includes("apparatus") || key.includes("circuit"))) keys = aliases.feeder;
      if (!keys && key.includes("department")) keys = aliases.department;
      if (!keys && key.includes("supervisor")) keys = aliases.supervisor;
      if (!keys && key.includes("presenter")) keys = aliases.presenter;
      if (!keys && key === "date") keys = aliases.date;
      if (!keys) return;
      const value = parentValue(parentData, keys);
      if (value) assignElement(element, value, true);
    });
  }

  function openChildForm(parentForm, documentCode) {
    const parentFormId = activeId();
    const definition = definitionFor(parentFormId, documentCode);
    if (!parentForm || !definition?.childFormId) return;
    const stack = loadStack();
    stack.push({
      parentFormId,
      parentFormTitle: formTitle(parentFormId),
      documentCode,
      childFormId: definition.childFormId,
      childFormTitle: formTitle(definition.childFormId),
      parentData: readForm(parentForm),
      openedAt: new Date().toISOString()
    });
    saveStack();
    if (typeof renderForm === "function") renderForm(definition.childFormId);
  }

  function setYesForJha(parentForm) {
    if (!parentForm) return;
    parentForm.querySelectorAll('[name="jhaAttached"]').forEach(element => {
      element.checked = String(element.value).toLowerCase() === "yes";
    });
  }

  function attachChildAndReturn() {
    const context = currentContext();
    const childForm = document.querySelector("#formWorkspace .ops-form");
    if (!context || !childForm || activeId() !== context.childFormId) return;
    writeJson(recordKey(context.parentFormId, context.documentCode), {
      parentFormId: context.parentFormId,
      parentFormTitle: context.parentFormTitle,
      documentCode: context.documentCode,
      childFormId: context.childFormId,
      childFormTitle: context.childFormTitle,
      savedAt: new Date().toISOString(),
      data: readForm(childForm)
    });
    const state = appState();
    state.pendingRestore = { formId: context.parentFormId, data: context.parentData };
    const stack = loadStack();
    stack.pop();
    saveStack();
    if (typeof renderForm === "function") renderForm(context.parentFormId);
  }

  function addReturnBanner(form, context) {
    if (form.querySelector("[data-kedco-rete-linked-return]")) return;
    form.insertAdjacentHTML("afterbegin", `<section class="kedco-rete-linked-return no-print" data-kedco-rete-linked-return>
      <div><strong>Linked e-form: ${escHtml(context.childFormTitle)}</strong><small>Complete this e-form, then save it and return to ${escHtml(context.parentFormTitle)}.</small></div>
      <button type="button" class="kedco-rete-linked-button" data-kedco-rete-linked-return-action>Save &amp; Return</button>
    </section>`);
    form.querySelector("[data-kedco-rete-linked-return-action]")?.addEventListener("click", attachChildAndReturn);
  }

  function addControls(doc, form, definition) {
    if (!definition?.childFormId || doc.querySelector("[data-kedco-rete-linked-controls]")) return;
    const controls = document.createElement("div");
    controls.className = "kedco-rete-linked-controls no-print";
    controls.dataset.kedcoReteLinkedControls = "1";
    controls.innerHTML = `<button type="button" class="kedco-rete-linked-button" data-kedco-rete-linked-open>${definition.required ? "Add / Open e-form" : "Add / Open optional e-form"}</button><span data-kedco-rete-linked-status>Not added yet</span>`;
    doc.appendChild(controls);
    controls.querySelector("[data-kedco-rete-linked-open]")?.addEventListener("click", () => openChildForm(form, definition.code));
  }

  function updateStatus(doc, record) {
    const status = doc.querySelector("[data-kedco-rete-linked-status]");
    if (!status) return;
    if (record) {
      status.textContent = `ADDED · ${record.childFormTitle}`;
      status.className = "kedco-rete-linked-status added";
    } else {
      status.textContent = "Not added yet";
      status.className = "kedco-rete-linked-status pending";
    }
  }

  function buildPanel(form, formId) {
    if (form.querySelector("[data-kedco-rete-linked-panel]")) return;
    const definitions = dependencies[formId];
    if (!definitions?.length) return;
    const items = definitions.map(definition => `<div class="kedco-rete-linked-doc ${definition.required ? "required" : "optional"}" data-kedco-rete-linked-doc="${definition.code}">
      <b>${definition.required ? "REQUIRED" : "OPTIONAL"} · ${escHtml(definition.title)}</b>
      <small>${escHtml(definition.note)}</small>
    </div>`).join("");
    const panel = document.createElement("section");
    panel.className = "kedco-rete-linked-panel no-print";
    panel.dataset.kedcoReteLinkedPanel = "1";
    panel.innerHTML = `<h4>Required supporting e-forms</h4><p>These forms already exist as KEDCO e-forms. Use Add / Open, save the form, and return here. The saved e-form is linked to the parent record; no file attachment is created.</p><div class="kedco-rete-linked-grid">${items}</div>`;
    const dispatch = form.querySelector("[data-dispatch-panel]");
    if (dispatch) dispatch.before(panel); else form.appendChild(panel);
  }

  function syncLinkedData(form, formId) {
    const recordList = (dependencies[formId] || []).map(definition => readRecord(formId, definition.code)).filter(Boolean).map(record => ({
      documentCode: record.documentCode,
      documentTitle: record.childFormTitle,
      childForm: record.childFormId,
      savedAt: record.savedAt,
      data: record.data
    }));
    let hidden = form.querySelector("[data-kedco-rete-linked-json]");
    if (!hidden) {
      hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = "linkedEforms";
      hidden.dataset.kedcoReteLinkedJson = "1";
      form.appendChild(hidden);
    }
    hidden.value = JSON.stringify(recordList);
    if (formId === "sgapp" && recordList.some(record => record.documentCode === "JOB_SAFETY")) setYesForJha(form);
  }

  function enhanceCurrentForm() {
    const form = document.querySelector("#formWorkspace .ops-form");
    if (!form) return;
    const formId = activeId();
    const state = appState();
    if (state.pendingRestore?.formId === formId) {
      applyFormData(form, state.pendingRestore.data, false);
      state.pendingRestore = null;
    }
    const context = currentContext();
    if (context?.childFormId === formId) {
      addReturnBanner(form, context);
      prefillChild(form, context, readRecord(context.parentFormId, context.documentCode));
    }
    buildPanel(form, formId);
    const panel = form.querySelector("[data-kedco-rete-linked-panel]");
    if (!panel) return;
    (dependencies[formId] || []).forEach(definition => {
      const doc = panel.querySelector(`[data-kedco-rete-linked-doc="${definition.code}"]`);
      if (!doc) return;
      addControls(doc, form, definition);
      updateStatus(doc, readRecord(formId, definition.code));
    });
    syncLinkedData(form, formId);
  }

  const style = document.createElement("style");
  style.id = "kedco-rete-linked-eforms-style";
  style.textContent = `.kedco-rete-linked-panel,.kedco-rete-linked-return{margin:14px auto 0;padding:13px;border:1px solid #c8d7e8;border-radius:12px;background:linear-gradient(180deg,#f8fbff,#fff);box-shadow:0 7px 18px rgba(7,48,98,.06)}
.kedco-rete-linked-panel h4{margin:0 0 5px;color:#083d79;font-size:10px;text-transform:uppercase;letter-spacing:.04em}.kedco-rete-linked-panel>p{margin:0 0 10px;color:#5d6c7f;font-size:8px;line-height:1.55}.kedco-rete-linked-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.kedco-rete-linked-doc{padding:9px;border:1px solid #d7e2ee;border-radius:9px;background:#fff}.kedco-rete-linked-doc.required{border-left:4px solid #a32635}.kedco-rete-linked-doc.optional{border-left:4px solid #d7a72b}.kedco-rete-linked-doc b{display:block;color:#153e69;font-size:8px;margin-bottom:4px}.kedco-rete-linked-doc small{display:block;color:#6b788a;font-size:7px;line-height:1.45;margin-bottom:6px}.kedco-rete-linked-controls{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:7px}.kedco-rete-linked-button{border:1px solid #1a73e8;border-radius:7px;padding:6px 9px;background:#1a73e8;color:#fff;font-size:8px;font-weight:800;cursor:pointer}.kedco-rete-linked-button:hover{filter:brightness(.94)}.kedco-rete-linked-status{font-size:8px;font-weight:800}.kedco-rete-linked-status.added{color:#087044}.kedco-rete-linked-status.pending{color:#982437}.kedco-rete-linked-return{display:flex;align-items:center;justify-content:space-between;gap:12px;border-color:#9fc2e8;background:#eef6ff}.kedco-rete-linked-return strong{display:block;color:#083d79;font-size:10px}.kedco-rete-linked-return small{display:block;margin-top:3px;color:#52677e;font-size:8px}@media(max-width:800px){.kedco-rete-linked-grid{grid-template-columns:1fr}.kedco-rete-linked-return{align-items:flex-start;flex-direction:column}}`;
  document.head.appendChild(style);

  loadStack();
  try {
    const originalRenderForm = typeof renderForm === "function" ? renderForm : null;
    if (originalRenderForm) {
      renderForm = function (type) {
        originalRenderForm(type);
        window.setTimeout(enhanceCurrentForm, 0);
        window.setTimeout(enhanceCurrentForm, 120);
        window.setTimeout(enhanceCurrentForm, 500);
      };
    }
  } catch (_) {}

  const workspace = document.getElementById("formWorkspace");
  if (workspace && "MutationObserver" in window) {
    new MutationObserver(() => window.setTimeout(enhanceCurrentForm, 0)).observe(workspace, { childList: true, subtree: true });
  }
  window.setTimeout(enhanceCurrentForm, 0);
  window.setTimeout(enhanceCurrentForm, 200);
})();

import express, { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { requireLocalAuth } from "./middleware.js";
import { users } from "./auth-store.js";
import { findRegion, localRegions } from "./regions.js";
import { currentSnapshotVersion, currentVersion, deleteTable, insertTable, localRoot, localSummary, queryTable, safeRelativePath, safeSegment, storagePath, tableRows, updateTable, upsertTableByKeys, appendAudit } from "./store.js";

type Filter = { op: string; column: string; value: unknown };
const router = Router();
const PERSONNEL_SCOPED_TABLES = new Set([
  "kedco_re_te_eforms",
  "kedco_transformer_trial_requests",
  "kedco_workflow_submissions",
  "kedco_workflow_tasks",
  "kedco_workflow_files"
]);

function pageName(value: unknown) {
  return String(value || "").split(/[?#]/, 1)[0].split("/").pop()?.trim().toLowerCase() || "";
}

function requestPageName(req: express.Request, args: any = {}) {
  const requested = pageName(args?.requested_source_page);
  if (requested) return requested;
  return pageName(req.headers?.referer || req.headers?.referrer);
}

function isDispatchPage(req: express.Request, args: any = {}) {
  return requestPageName(req, args) === "dispatch.html";
}
function denyScopedTable(res: express.Response) { return res.status(403).end(); }

function parseFilters(value: unknown): Filter[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter(x => x && typeof x.column === "string") : [];
  } catch { return []; }
}
function parseOrder(value: unknown) {
  if (!value) return null;
  try { const parsed = JSON.parse(String(value)); return parsed && parsed.column ? parsed : null; } catch { return null; }
}
function tokenFromRequest(req: express.Request) {
  const header = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return header || String(req.query.token || "").trim();
}

router.get("/health", (_req, res) => res.json({ ok: true, mode: "local", ...localSummary() }));
router.get("/version", (_req, res) => res.json(currentVersion()));

router.use((req, res, next) => {
  if (req.path === "/files/download") return next();
  return requireLocalAuth(req, res, next);
});

router.get("/snapshots/version", (_req, res) => res.json(currentSnapshotVersion()));

router.get("/tables/:table", (req, res) => {
  if (PERSONNEL_SCOPED_TABLES.has(req.params.table)) return denyScopedTable(res);
  const filters = parseFilters(req.query.filters);
  const order = parseOrder(req.query.order);
  const offset = Math.max(0, Number(req.query.offset || 0) || 0);
  const limit = Math.min(10000, Math.max(1, Number(req.query.limit || 1000) || 1000));
  res.json({ data: queryTable(req.params.table, filters, order, offset, limit) });
});
router.post("/tables/:table", async (req, res, next) => {
  if (PERSONNEL_SCOPED_TABLES.has(req.params.table)) return denyScopedTable(res);
  try { const data = await insertTable(req.params.table, req.body); res.json({ data }); } catch (error) { next(error); }
});
router.patch("/tables/:table", async (req, res, next) => {
  if (PERSONNEL_SCOPED_TABLES.has(req.params.table)) return denyScopedTable(res);
  try { const data = await updateTable(req.params.table, req.body?.patch || {}, parseFilters(req.body?.filters)); res.json({ data }); } catch (error) { next(error); }
});
router.delete("/tables/:table", async (req, res, next) => {
  if (PERSONNEL_SCOPED_TABLES.has(req.params.table)) return denyScopedTable(res);
  try { const data = await deleteTable(req.params.table, parseFilters(req.query.filters)); res.json({ data }); } catch (error) { next(error); }
});

router.get("/snapshots", (req, res) => {
  const user = res.locals.kedcoUser;
  const data = queryTable("kedco_data_snapshots", [{ op: "eq", column: "owner_id", value: user.id }], { column: "data_key", ascending: true }, 0, 10000);
  res.json({ data });
});
router.post("/snapshots", async (req, res, next) => {
  try {
    const user = res.locals.kedcoUser;
    const incoming = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const rows = incoming
      .map((row: Record<string, unknown>) => ({ ...row, owner_id: user.id, data_key: String(row?.data_key || "").trim() }))
      .filter((row: Record<string, unknown>) => row.data_key);
    const saved = await upsertTableByKeys("kedco_data_snapshots", rows, ["owner_id", "data_key"]);
    res.json({ ok: true, saved: saved.length, version: currentSnapshotVersion().version });
  } catch (error) { next(error); }
});

router.post("/files/upload", express.raw({ type: "application/octet-stream", limit: "120mb" }), async (req, res, next) => {
  try {
    const bucket = safeSegment(req.query.bucket || "kedco-evidence");
    const objectPath = safeRelativePath(req.query.path || `${crypto.randomUUID()}-file`);
    if (!objectPath) return res.status(400).json({ error: "A file path is required" });
    const file = storagePath(bucket, objectPath);
    if (fs.existsSync(file) && String(req.query.upsert || "false") !== "true") return res.status(409).json({ error: "File already exists" });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || ""));
    appendAudit({ type: "LOCAL_FILE_UPLOAD", user_id: res.locals.kedcoUser.id, bucket, storage_path: objectPath, size: fs.statSync(file).size });
    res.json({ data: { path: objectPath, fullPath: `${bucket}/${objectPath}` } });
  } catch (error) { next(error); }
});

router.get("/files/download", async (req, res) => {
  const { userForAccessToken } = await import("./auth-store.js");
  const user = userForAccessToken(tokenFromRequest(req));
  if (!user) return res.status(401).send("Invalid or expired local KEDCO session");
  const bucket = safeSegment(req.query.bucket || "kedco-evidence");
  const objectPath = safeRelativePath(req.query.path || "");
  const file = storagePath(bucket, objectPath);
  if (!objectPath || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.status(404).send("File not found");
  const registered = queryTable("kedco_file_assets", [
    { op: "eq", column: "bucket_id", value: bucket },
    { op: "eq", column: "storage_path", value: objectPath }
  ], null, 0, 1)[0];
  if (registered && String(registered.owner_id || "") !== String(user.id)) return res.status(403).send("You do not have access to this file");
  if (String(req.query.download || "") === "1") res.setHeader("Content-Disposition", `attachment; filename=\"${path.basename(file).replace(/\"/g, "")}\"`);
  res.sendFile(file);
});

router.delete("/files", async (req, res, next) => {
  try {
    const bucket = safeSegment(req.body?.bucket || "kedco-evidence");
    const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
    const removed: string[] = [];
    for (const value of paths) {
      const objectPath = safeRelativePath(value); const file = storagePath(bucket, objectPath);
      const registered = objectPath ? queryTable("kedco_file_assets", [
        { op: "eq", column: "bucket_id", value: bucket },
        { op: "eq", column: "storage_path", value: objectPath }
      ], null, 0, 1)[0] : null;
      if (registered && String(registered.owner_id || "") === String(res.locals.kedcoUser.id) && fs.existsSync(file)) {
        fs.unlinkSync(file); removed.push(objectPath);
      }
    }
    appendAudit({ type: "LOCAL_FILE_DELETE", user_id: res.locals.kedcoUser.id, bucket, paths: removed });
    res.json({ data: removed.map(name => ({ name })) });
  } catch (error) { next(error); }
});

const REQUIRED_DOCS: Record<string, string[]> = {
  of1: ["JHA_RISK_ASSESSMENT", "SINGLE_LINE_DIAGRAM"],
  of1_hak_bichi: ["JHA_RISK_ASSESSMENT", "SINGLE_LINE_DIAGRAM"],
  of2: ["JHA_RISK_ASSESSMENT", "TOOLBOX_TALK"],
  of3: ["JHA_RISK_ASSESSMENT", "TOOLBOX_TALK"],
  of4: ["JHA_RISK_ASSESSMENT"],
  of17: ["SWITCHING_SCHEDULE"],
  of19: []
};

type WorkflowRouteStep = { step: number; code: string; label: string; target_roles: string[] };
const WORKFLOW_ROUTES: Record<string, { title: string; route_label: string; steps: WorkflowRouteStep[] }> = {
  of1: {
    title: "O.F.1 — Protection Guarantee",
    route_label: "RE review → Head SO approval → Dispatch/Operator issue → surrender → restoration",
    steps: [
      { step: 1, code: "RE_REVIEW", label: "RE review", target_roles: ["RE"] },
      { step: 2, code: "HEAD_SO_APPROVAL", label: "Head SO approval", target_roles: ["HEAD_SO"] },
      { step: 3, code: "ISSUE", label: "Dispatch / Operator issue", target_roles: ["DISPATCH", "OPERATOR"] },
      { step: 4, code: "SURRENDER", label: "Permit surrender", target_roles: ["OPERATOR", "DISPATCH"] },
      { step: 5, code: "RESTORATION", label: "System restoration", target_roles: ["DISPATCH", "HEAD_SO"] }
    ]
  },
  of1_hak_bichi: {
    title: "APPLICATION FOR PROTECTION GUARANTEE - 33 kV HAK",
    route_label: "Head System Operations approval -> Bichi 132 kV TS approval -> Dispatch/Operator issue -> surrender -> restoration",
    steps: [
      { step: 1, code: "HEAD_SO_APPROVAL", label: "Head SO approval", target_roles: ["HEAD_SO"] },
      { step: 2, code: "BICHI_TS_APPROVAL", label: "Bichi 132 kV TS approval", target_roles: ["SUPER_TRANS", "TRANSMISSION"] },
      { step: 3, code: "ISSUE", label: "Dispatch / Operator issue", target_roles: ["DISPATCH", "OPERATOR", "SUPER_OPERATOR"] },
      { step: 4, code: "SURRENDER", label: "Permit surrender", target_roles: ["OPERATOR", "DISPATCH"] },
      { step: 5, code: "RESTORATION", label: "System restoration", target_roles: ["DISPATCH", "HEAD_SO"] }
    ]
  },
  of2: {
    title: "O.F.2 — Work Permit",
    route_label: "Functional review → Head SO approval → Dispatch/Operator issue → surrender → restoration",
    steps: [
      { step: 1, code: "FUNCTIONAL_REVIEW", label: "Functional review", target_roles: [] },
      { step: 2, code: "HEAD_SO_APPROVAL", label: "Head SO approval", target_roles: ["HEAD_SO"] },
      { step: 3, code: "ISSUE", label: "Dispatch / Operator issue", target_roles: ["DISPATCH", "OPERATOR"] },
      { step: 4, code: "SURRENDER", label: "Permit surrender", target_roles: ["OPERATOR", "DISPATCH"] },
      { step: 5, code: "RESTORATION", label: "System restoration", target_roles: ["DISPATCH", "HEAD_SO"] }
    ]
  },
  of3: {
    title: "O.F.3 — Work & Test Permit",
    route_label: "Functional review → Head SO approval → Dispatch/Operator issue → surrender → restoration",
    steps: [
      { step: 1, code: "FUNCTIONAL_REVIEW", label: "Functional review", target_roles: [] },
      { step: 2, code: "HEAD_SO_APPROVAL", label: "Head SO approval", target_roles: ["HEAD_SO"] },
      { step: 3, code: "ISSUE", label: "Dispatch / Operator issue", target_roles: ["DISPATCH", "OPERATOR"] },
      { step: 4, code: "SURRENDER", label: "Permit surrender", target_roles: ["OPERATOR", "DISPATCH"] },
      { step: 5, code: "RESTORATION", label: "System restoration", target_roles: ["DISPATCH", "HEAD_SO"] }
    ]
  },
  of4: {
    title: "O.F.4 — Station Guarantee",
    route_label: "TE prepares application → RE endorsement → Dispatch / Team Lead review → Head SO approval → selected station operator issues the Station Guarantee → surrender → restoration",
    steps: [
      { step: 1, code: "TE_APPLICATION", label: "TE station guarantee application", target_roles: ["TE", "SUPER_RE_TE"] },
      { step: 2, code: "RE_ENDORSEMENT", label: "RE endorsement", target_roles: ["RE", "SUPER_RE_TE"] },
      { step: 3, code: "DISPATCH_TEAM_LEAD_REVIEW", label: "Dispatch / Team Lead review", target_roles: ["DISPATCH_SUPERVISOR", "DISPATCH"] },
      { step: 4, code: "HEAD_SO_APPROVAL", label: "Head SO approval", target_roles: ["HEAD_SO"] },
      { step: 5, code: "STATION_ISSUE", label: "Selected station operator issues the Station Guarantee", target_roles: ["OPERATOR", "STATION_OPERATOR", "SUPER_OPERATOR"] },
      { step: 6, code: "SURRENDER", label: "Guarantee surrender", target_roles: ["OPERATOR", "STATION_OPERATOR", "DISPATCH"] },
      { step: 7, code: "RESTORATION", label: "System restoration", target_roles: ["DISPATCH", "HEAD_SO"] }
    ]
  },
  of17: {
    title: "O.F.17 — Order to Operate",
    route_label: "Head SO authorisation → Dispatch issue → execution → Head SO close",
    steps: [
      { step: 1, code: "HEAD_SO_AUTHORISATION", label: "Head SO authorisation", target_roles: ["HEAD_SO"] },
      { step: 2, code: "DISPATCH_ISSUE", label: "Dispatch issue", target_roles: ["DISPATCH"] },
      { step: 3, code: "EXECUTION", label: "Execution", target_roles: ["OPERATOR", "STATION_OPERATOR"] },
      { step: 4, code: "HEAD_SO_CLOSE", label: "Head SO close", target_roles: ["HEAD_SO"] }
    ]
  },
  of19: {
    title: "O.F.19 — Trouble & Repair",
    route_label: "PC&M / O&M / joint fault routing → repair → Dispatch restoration → Head SO close",
    steps: [
      { step: 1, code: "TECHNICAL_TRIAGE", label: "PC&M / O&M / joint fault routing", target_roles: ["HEAD_PCM", "HEAD_OM"] },
      { step: 2, code: "REPAIR", label: "Regional repair / corrective action", target_roles: ["REGIONAL_PCM_COORD", "REGIONAL_OM_COORD", "REGIONAL_EF", "REGIONAL_EF_LEAD", "REGIONAL_CJ", "REGIONAL_CJ_LEAD", "RE", "TE"] },
      { step: 3, code: "DISPATCH_RESTORATION", label: "Dispatch restoration", target_roles: ["DISPATCH"] },
      { step: 4, code: "HEAD_SO_CLOSE", label: "Head SO close", target_roles: ["HEAD_SO"] }
    ]
  }
};

function resolveWorkflowRouteKey(formCode: string, context: Record<string, unknown>) {
  if (formCode === "of1" && String(context?.workflow_variant || "").trim() === "HAK_BICHI_PROTECTION") return "of1_hak_bichi";
  return formCode;
}

const RETE_FORM_CODES = new Set(["ppe", "toolbox", "risk", "sgapp", "sg", "trouble", "requisition"]);
const RETE_RECIPIENT_TARGETS: Record<string, string[]> = {
  "Head System Operations": ["HEAD_SO"],
  "Head O & M": ["HEAD_OM"],
  "Head PC & M": ["HEAD_PCM"],
  "Head P & I": ["HEAD_PI"],
  "Regional PC & M": ["REGIONAL_PCM_COORD", "PROTECTION_ENGINEER", "CONTROL_SCADA_ENGINEER", "METERING_ENGINEER", "TEST_ENGINEER"],
  "Regional Electrical Fitters": ["REGIONAL_EF", "REGIONAL_EF_LEAD"],
  "Regional Cable Jointers": ["REGIONAL_CJ", "REGIONAL_CJ_LEAD"],
  "Regional PPM Coordinator": ["REGIONAL_PPM_COORD"],
  "RE": ["RE", "SUPER_RE_TE"],
  "TE": ["TE", "SUPER_RE_TE"]
};

function localRoleSet(user: any) {
  return new Set([...(Array.isArray(user?.roles) ? user.roles : []), user?.primary_role]
    .map((role: unknown) => String(role || "").trim().toUpperCase()).filter(Boolean));
}
const TRANSFORMER_TRIAL_REQUESTER_ROLES = new Set([
  "OPERATOR", "STATION_OPERATOR", "SUPER_OPERATOR", "DISPATCH", "DISPATCH_SUPERVISOR",
  "REGIONAL_PCM_COORD", "PROTECTION_ENGINEER", "CONTROL_SCADA_ENGINEER", "METERING_ENGINEER",
  "TEST_ENGINEER", "SUPER_RE_TE", "RE", "TE"
]);
const TRANSFORMER_TRIAL_REVIEWER_ROLES = new Set(["HEAD_PCM", "SUPER_ADMIN", "CTO", "TA_CTO", "HEAD_TECHNICAL"]);
const TRANSFORMER_TRIAL_OPERATION_ROLES = new Set([...TRANSFORMER_TRIAL_REQUESTER_ROLES, ...TRANSFORMER_TRIAL_REVIEWER_ROLES]);
const TRANSFORMER_TRIAL_FORWARD_INSTRUCTIONS = new Set([
  "Add transformer oil before trial",
  "Check transformer oil level and top up to approved level before trial",
  "Test transformer oil quality / dielectric strength before trial",
  "Inspect and repair oil leaks before trial",
  "Check Buchholz relay, alarm and trip contacts before trial",
  "Reset protection relay / lockout only after fault clearance",
  "Complete insulation resistance and winding resistance tests",
  "Inspect bushings, cables, terminations and connections",
  "Verify tap changer position and mechanical operation",
  "Confirm cooling fan / pump operation before trial",
  "Perform visual inspection and record pre-trial readings",
  "Obtain field maintenance and safety clearance before trial",
  "Investigate and clear the original fault before trial",
  "Do not attempt trial until Head PC&M conditions are completed",
  "Other approved pre-trial instruction"
]);
const TRANSFORMER_TRIAL_PRECHECK_KEYS = ["fault_cleared", "isolation_confirmed", "protection_reset", "safety_clearance"];

function trialPrechecksComplete(row: any) {
  if (row?.prechecks_completed === false) return false;
  const checks = trialObject(row?.requested_prechecks);
  return TRANSFORMER_TRIAL_PRECHECK_KEYS.every(key => checks[key] === true);
}

function hasAnyRole(roles: Set<string>, allowed: Set<string>) {
  return [...allowed].some(role => roles.has(role));
}

function trialObject(value: unknown, fallback: Record<string, unknown> = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fallback;
}

function trialRequestVisible(row: any, user: any, roles: Set<string>, options: { dispatchPage?: boolean } = {}) {
  if (options.dispatchPage && hasAnyRole(roles, TRANSFORMER_TRIAL_OPERATION_ROLES)) return true;
  if (!hasAnyRole(roles, TRANSFORMER_TRIAL_OPERATION_ROLES)) return false;
  const userId = String(user?.id || "");
  const userFields = ["requested_by", "forwarded_to_user_id", "forwarded_by", "forward_completed_by", "reviewed_by", "prechecks_completed_by", "result_by"];
  if (userFields.some(field => String(row?.[field] || "") === userId)) return true;
  return roles.has("HEAD_PCM");
}

function trialRequestView(row: any, user: any, roles: Set<string>) {
  const reviewer = hasAnyRole(roles, TRANSFORMER_TRIAL_REVIEWER_ROLES);
  const owner = String(row?.requested_by || "") === String(user?.id || "");
  const forwardedRecipient = String(row?.forwarded_to_user_id || "") === String(user?.id || "");
  const status = String(row?.status || "");
  const approvedForTrial = ["APPROVED", "TRIAL_IN_PROGRESS"].includes(status);
  const prechecksCompleted = trialPrechecksComplete(row);
  return {
    ...row,
    requested_prechecks: trialObject(row?.requested_prechecks),
    requested_feeders: Array.isArray(row?.requested_feeders) ? row.requested_feeders : (row?.requested_feeder ? [String(row.requested_feeder)] : []),
    prechecks_completed: prechecksCompleted,
    prechecks_required: approvedForTrial && !prechecksCompleted,
    can_review: reviewer && ["PENDING_HEAD_PCM", "RETURNED"].includes(status),
    can_forward: reviewer && ["PENDING_HEAD_PCM", "RETURNED"].includes(status),
    can_complete_forward: forwardedRecipient && status === "FORWARDED",
    can_complete_prechecks: approvedForTrial && !prechecksCompleted && (reviewer || owner || forwardedRecipient),
    can_record_result: (reviewer || owner) && ["APPROVED", "TRIAL_IN_PROGRESS"].includes(status)
  };
}
function firstWorkflowValue(...values: unknown[]) {
  for (const value of values) {
    const item = Array.isArray(value) ? value[0] : value;
    if (String(item ?? "").trim()) return String(item).trim();
  }
  return "";
}

function workflowStation(context: unknown, formData: unknown = {}) {
  const routeContext = context && typeof context === "object" ? context as Record<string, unknown> : {};
  const data = formData && typeof formData === "object" ? formData as Record<string, unknown> : {};
  return firstWorkflowValue(
    routeContext.station_name, routeContext.station, routeContext.selected_station, routeContext.requested_station,
    data.station, data.protectedStation, data.issuing, data.issuingStation, data.dailyStation, data.location
  );
}

function stationKey(value: unknown) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function stationAssignmentMatches(user: any, station: unknown) {
  const target = stationKey(station);
  if (!target) return true;
  const assignments = Array.isArray(user?.assignments) ? user.assignments : [];
  if (!assignments.length) return false;
  return assignments.some((assignment: unknown) => {
    const candidate = stationKey(assignment);
    return candidate === target ||
      (candidate.length >= 4 && target.length >= 4 && (candidate.includes(target) || target.includes(candidate)));
  });
}

function regionScopeKey(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function isGlobalRegionScope(value: unknown) {
  const key = regionScopeKey(value);
  return !key || ["all", "all region", "all regions", "corporate", "corporate all regions", "head office"].includes(key);
}

function assignedRegion(user: any) {
  return [user?.region_id, user?.region_name]
    .map(value => findRegion(value))
    .find(Boolean);
}

// A user without an explicit regional scope is a head-office/global recipient.
// That user can receive a regional copy, while an explicit assignment remains
// limited to its own region.
function userRegionMatches(user: any, region: { id: string; name: string } | undefined) {
  if (!region) return true;
  const values = [user?.region_id, user?.region_name].map(regionScopeKey).filter(Boolean);
  if (!values.length || values.some(isGlobalRegionScope)) return true;
  return assignedRegion(user)?.id === region.id;
}
function workflowTaskStationAllowed(task: any, submission: any, user: any, roles: Set<string>) {
  const station = String(task?.target_station || workflowStation(submission?.workflow_context, submission?.form_data) || "").trim();
  if (!station) return true;
  if (roles.has("SUPER_ADMIN") || roles.has("SUPER_OPERATOR")) return true;
  if (!roles.has("OPERATOR") && !roles.has("STATION_OPERATOR")) return true;
  return stationAssignmentMatches(user, station);
}

function reteTargetsForRow(row: any) {
  const values = Array.isArray(row?.recipient_target_roles) ? row.recipient_target_roles : (() => {
    try { const parsed = JSON.parse(String(row?.recipient_target_roles || "[]")); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  })();
  return values.map((role: unknown) => String(role || "").trim().toUpperCase()).filter(Boolean);
}

function canReceiveReteRow(row: any, roles: Set<string>, userId: string) {
  if (row.recipient_user_id) return String(row.recipient_user_id) === String(userId);
  const person = users().find(person => person.id === userId);
  if (row.recipient_region_id) {
    const rowRegion = findRegion(row.recipient_region_id);
    if (!rowRegion || !userRegionMatches(person, rowRegion)) return false;
  }
  if (row.recipient_station && !roles.has("SUPER_OPERATOR") &&
      (roles.has("OPERATOR") || roles.has("STATION_OPERATOR")) &&
      !stationAssignmentMatches(person, row.recipient_station)) return false;
  return reteTargetsForRow(row).some((role: string) => roles.has(role));
}

function recipientPerson(value: unknown) {
  const text = String(value || "");
  return text.startsWith("person:") ? users().find(user => user.id === text.slice(7) && user.is_active !== false) : undefined;
}

function routeRegionalRE(role: string, args: any): { role: string; regionId?: string; regionName?: string; error?: string } {
  const regional = role === "RE" || role === "Regional Engineer (RE)";
  const requested = args.requested_recipient_region || (regional ? args.requested_recipient_office || args.requested_region : "");
  const region = requested ? findRegion(requested) : undefined;
  if (requested && !region) return { role, error: "Select a valid receiving region." };
  if (regional && !region) return { role, error: "Select the receiving RE's region before sending." };
  const person = recipientPerson(role);
  if (person && region && !userRegionMatches(person, region)) {
    return { role, error: "The selected officer is not assigned to this region. Choose their assigned region or All regions." };
  }
  if (regional && region) {
    const officers = users().filter(person => person.is_active !== false && localRoleSet(person).has("RE") && userRegionMatches(person, region));
    if (!officers.length) return { role, error: "No active RE is assigned to " + region.name + ". Select another officer or assign the region in Manage Roles." };
    if (officers.length > 1) return { role, error: "More than one RE is assigned to " + region.name + ". Select the individual officer from Personnel." };
    role = "person:" + officers[0].id;
  }
  if (!person && region && !regional) {
    const targets = centralRecipientTargets(role);
    if (!users().some(person => person.is_active !== false && userRegionMatches(person, region) && targets.some(target => localRoleSet(person).has(target)))) {
      return { role, error: "No active officer in this role is assigned to " + region.name + ". Select another destination." };
    }
  }
  return { role, regionId: region?.id, regionName: region?.name };
}

function sameDestination(row: any, role: string, regionId: string | undefined, station: unknown) {
  const person = recipientPerson(role);
  return String(row.recipient_user_id || "") === String(person?.id || "") &&
    (person || JSON.stringify(reteTargetsForRow(row).sort()) === JSON.stringify(centralRecipientTargets(role).sort())) &&
    String(row.recipient_region_id || "") === String(regionId || person?.region_id || "") &&
    String(row.recipient_station || "") === String(station || "").trim().slice(0, 240);
}

function canForwardRow(row: any, user: any) {
  if (row?.source_type === "OPERATOR_WORKFLOW") return false;
  return canReceiveReteRow(row, localRoleSet(user), user.id) || String(row.sender_id) === String(user.id);
}

function formDocument(value: unknown) {
  return typeof value === "string" && value.length <= 5000000 ? value : null;
}

function centralRecipientTargets(value: unknown) {
  if (String(value || "").startsWith("person:")) {
    const person = recipientPerson(value);
    return person ? [...localRoleSet(person)] : [];
  }
  const exact = RETE_RECIPIENT_TARGETS[String(value || "").trim()];
  if (exact) return exact;
  const key = String(value || "").trim().toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").replace(/ +/g, " ").trim();
  if (!key || key === "OTHER") return [];
  if (key.includes("CTO") || key.includes("CHIEF TECHNICAL")) return ["CTO", "TA_CTO"];
  if (key.includes("MD CEO") || key.includes("EXECUTIVE MANAGEMENT")) return ["MD_CEO"];
  if (key.includes("HEAD TECHNICAL")) return ["HEAD_TECHNICAL"];
  if (key.includes("HEAD SYSTEM") || key.includes("SYSTEM OPERATIONS") || key.includes("CENTRAL DISPATCH") || key === "DISPATCH") return ["HEAD_SO", "DISPATCH_SUPERVISOR", "DISPATCH"];
  if (key.includes("HEAD O AND M")) return ["HEAD_OM"];
  if (key.includes("HEAD PC")) return ["HEAD_PCM"];
  if (key.includes("HEAD P AND I") || key.includes("HEAD PLANNING")) return ["HEAD_PI"];
  if (key.includes("HEAD HSE")) return ["HEAD_HSE"];
  if (key.includes("HEAD MIS")) return ["HEAD_MIS"];
  if (key.includes("STORE") || key.includes("INVENTORY")) return ["STORE_MANAGER", "STORE_OFFICER"];
  if (key.includes("PROCUREMENT")) return ["PROCUREMENT_HEAD", "PROCUREMENT_OFFICER"];
  if (key.includes("FINANCE") || key.includes("ACCOUNTS")) return ["FINANCE_HEAD", "FINANCE_OFFICER"];
  if (key === "RE" || key.includes("REGIONAL ENGINEER")) return ["RE", "SUPER_RE_TE"];
  if (key === "TE" || key.includes("TECHNICAL ENGINEER")) return ["TE", "SUPER_RE_TE"];
  if (key.includes("REGIONAL O AND M")) return ["REGIONAL_OM_COORD"];
  if (key.includes("REGIONAL PC")) return ["REGIONAL_PCM_COORD", "PROTECTION_ENGINEER", "CONTROL_SCADA_ENGINEER", "METERING_ENGINEER", "TEST_ENGINEER"];
  if (key.includes("REGIONAL P AND I")) return ["REGIONAL_PI_COORD", "PLANNING_ENGINEER"];
  if (key.includes("REGIONAL PPM")) return ["REGIONAL_PPM_COORD"];
  if (key.includes("ELECTRICAL FITTER")) return ["REGIONAL_EF", "REGIONAL_EF_LEAD"];
  if (key.includes("CABLE JOINTER")) return ["REGIONAL_CJ", "REGIONAL_CJ_LEAD"];
  if (key.includes("TSP") || key.includes("TECHNICAL SERVICES")) return ["TSP_TECH_SERVICES"];
  if (key.includes("REGIONAL HSE") || key.includes("HSE OFFICER")) return ["REGIONAL_HSE_OFFICER", "HSE_OFFICER", "HEAD_HSE"];
  if (key.includes("STATION OPERATOR")) return ["OPERATOR", "STATION_OPERATOR", "SUPER_OPERATOR"];
  if (key.includes("TRANSMISSION")) return ["TRANSMISSION", "SUPER_TRANS"];
  return [];
}

router.post("/rpc/:name", async (req, res, next) => {
  try {
    const name = req.params.name;
    const user = res.locals.kedcoUser;
    const args = req.body || {};
    if (name === "kedco_list_eform_regions") return res.json({ data: localRegions() });
    if (name === "kedco_list_eform_personnel") {
      return res.json({ data: users().filter(person => person.is_active !== false).map(person => ({
        id: person.id, full_name: person.full_name, email: person.email, primary_role: person.primary_role,
        roles: [...localRoleSet(person)], assignments: person.assignments || [], region_id: person.region_id || null, region_name: person.region_name || null
      })).sort((a, b) => a.full_name.localeCompare(b.full_name)) });
    }
    if (name === "kedco_is_active_user") return res.json({ data: user.is_active !== false });
    if (name === "kedco_primary_role_code") return res.json({ data: user.primary_role });
    if (name === "kedco_current_user_role_codes") return res.json({ data: user.roles || [user.primary_role] });

    if (name === "kedco_send_re_te_eform") {
      const formCode = String(args.requested_form_code || "").trim().toLowerCase();
      let recipientRole = String(args.requested_recipient_role || "").trim();
      const regionalDelivery = routeRegionalRE(recipientRole, args);
      if (regionalDelivery.error) return res.status(400).json({ error: regionalDelivery.error });
      recipientRole = regionalDelivery.role;
      const recipient = String(args.requested_recipient || recipientRole).trim();
      if (!RETE_FORM_CODES.has(formCode)) return res.status(400).json({ error: "Unsupported RE/TE e-form type." });
      if (!recipientRole || !recipient) return res.status(400).json({ error: "A recipient role and recipient are required." });
      const targetRoles = RETE_RECIPIENT_TARGETS[recipientRole] || centralRecipientTargets(recipientRole);
      if (!targetRoles.length) return res.status(400).json({ error: "Select a supported recipient office. This recipient has no delivery route." });
      const requestedReference = String(args.requested_reference || "").trim();
      const reference = requestedReference || `KD-RETE-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
      const duplicate = queryTable("kedco_re_te_eforms", [
        { op: "eq", column: "sender_id", value: user.id },
        { op: "eq", column: "reference", value: reference }
      ], null, 0, 1)[0];
      if (duplicate && !sameDestination(duplicate, recipientRole, regionalDelivery.regionId, args.requested_recipient_station)) return res.status(409).json({ error: "This reference was already sent to a different recipient. Forward the existing record to the selected officer." });
      if (duplicate) return res.json({ data: { ok: true, duplicate: true, record: duplicate } });
      const now = new Date().toISOString();
      const payload = args.requested_payload && typeof args.requested_payload === "object" ? args.requested_payload : {};
      const [saved] = await insertTable("kedco_re_te_eforms", {
        reference,
        form_code: formCode,
        form_title: String(args.requested_form_title || formCode).trim(),
        sender_id: user.id,
        sender_email: user.email,
        sender_name: user.full_name || user.email,
        sender_roles: user.roles || [user.primary_role],
        recipient_role: recipientPerson(recipientRole)?.primary_role || recipientRole,
        recipient_user_id: recipientPerson(recipientRole)?.id || null,
        recipient_region_id: regionalDelivery.regionId || recipientPerson(recipientRole)?.region_id || null,
        recipient_region_name: regionalDelivery.regionName || recipientPerson(recipientRole)?.region_name || null,
        recipient_station: String(args.requested_recipient_station || "").trim().slice(0, 240),
        recipient: recipientPerson(recipientRole)?.full_name || recipient,
        recipient_office: String(args.requested_recipient_office || "").trim(),
        recipient_target_roles: targetRoles,
        note: String(args.requested_note || "").trim().slice(0, 4000),
        region: String(args.requested_region || "").trim(),
        state: String(args.requested_state || "").trim(),
        source_page: String(args.requested_source_page || "RE_TE").trim(),
        workflow_family: "RE_TE",
        copy_record_id: String(args.requested_copy_record_id || "").trim() || null,
        payload,
        form_document: formDocument(args.requested_form_document),
        status: "SENT",
        feedback_status: "PENDING",
        sent_at: now,
        received_at: null,
        feedback: null,
        feedback_by: null,
        feedback_by_name: null,
        feedback_at: null,
        updated_at: now
      });
      appendAudit({ type: "LOCAL_RE_TE_EFORM_SENT", record_id: saved?.id, reference, form_code: formCode, recipient_role: recipientRole, user_id: user.id });
      return res.json({ data: { ok: true, duplicate: false, record: saved } });
    }

    if (name === "kedco_list_re_te_eforms") {
      const requestedBox = String(args.requested_box || "all").trim().toLowerCase();
      if (!["sent", "inbox", "all"].includes(requestedBox)) return res.status(400).json({ error: "The RE/TE e-form box must be sent, inbox or all." });
      const roles = localRoleSet(user);
      const rows = queryTable("kedco_re_te_eforms", [], { column: "updated_at", ascending: false }, 0, 10000)
        .filter((row: any) => {
          const sent = String(row?.sender_id || "") === String(user.id);
          const received = canReceiveReteRow(row, roles, user.id);
          return requestedBox === "sent" ? sent : requestedBox === "inbox" ? received : sent || received;
        })
        .map((row: any) => ({ ...row, can_update: canReceiveReteRow(row, roles, user.id), can_forward: canForwardRow(row, user),
          pending_task: row.source_type === "OPERATOR_WORKFLOW" ? queryTable("kedco_workflow_tasks", [{ op: "eq", column: "submission_id", value: row.source_workflow_submission_id }, { op: "eq", column: "status", value: "PENDING" }], null, 0, 1)[0] || null : null
        }));
      return res.json({ data: rows });
    }

    if (name === "kedco_update_re_te_eform") {
      const requestedId = String(args.requested_id || "").trim();
      const requestedReference = String(args.requested_reference || "").trim();
      const status = String(args.requested_status || "").trim().toUpperCase();
      const feedback = String(args.requested_feedback || "").trim().slice(0, 4000);
      const allowedStatuses = new Set(["RECEIVED", "IN_REVIEW", "APPROVED", "RETURNED", "COMPLETED"]);
      if ((!requestedId && !requestedReference) || !allowedStatuses.has(status)) return res.status(400).json({ error: "A record/reference and valid feedback status are required." });
      if (status === "RETURNED" && !feedback) return res.status(400).json({ error: "A return reason / feedback is required before returning an e-form." });
      const roles = localRoleSet(user);
      const filters = requestedId ? [{ op: "eq", column: "id", value: requestedId }] : [{ op: "eq", column: "reference", value: requestedReference }];
      const row = queryTable("kedco_re_te_eforms", filters, null, 0, 1)[0];
      if (!row) return res.status(404).json({ error: "RE/TE e-form record not found." });
      if (!canReceiveReteRow(row, roles, user.id)) return res.status(403).json({ error: "Your KEDCO role is not authorised to update this e-form." });
      if (row.source_type === "OPERATOR_WORKFLOW") return res.status(400).json({ error: "Use the authorised workflow tasks to update this form." });
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        status,
        feedback_status: status === "RETURNED" ? "ACTION_REQUIRED" : status,
        feedback: feedback || row.feedback || null,
        feedback_by: user.id,
        feedback_by_name: user.full_name || user.email,
        feedback_at: now,
        updated_at: now
      };
      if (status === "RECEIVED" && !row.received_at) patch.received_at = now;
      const updated = await updateTable("kedco_re_te_eforms", patch, filters);
      const saved = updated[0] || { ...row, ...patch };
      appendAudit({ type: "LOCAL_RE_TE_EFORM_FEEDBACK", record_id: saved?.id, reference: saved?.reference, status, user_id: user.id });
      return res.json({ data: { ok: true, record: saved } });
    }

    if (name === "kedco_send_central_eform") {
      const formCode = String(args.requested_form_code || "").trim().toLowerCase().slice(0, 160);
      const formTitle = String(args.requested_form_title || formCode || "KEDCO e-form").trim().slice(0, 240);
      let recipientRole = String(args.requested_recipient_role || "").trim().slice(0, 160);
      const regionalDelivery = routeRegionalRE(recipientRole, args);
      if (regionalDelivery.error) return res.status(400).json({ error: regionalDelivery.error });
      recipientRole = regionalDelivery.role;
      const recipient = String(args.requested_recipient || recipientRole).trim().slice(0, 240);
      if (!formCode) return res.status(400).json({ error: "An e-form type is required." });
      if (!recipientRole || !recipient) return res.status(400).json({ error: "A recipient Head, RE, TE or CTO is required." });
      const targetRoles = centralRecipientTargets(recipientRole);
      if (!targetRoles.length) return res.status(400).json({ error: "Select a supported recipient office. This recipient has no delivery route." });
      const requestedReference = String(args.requested_reference || "").trim().slice(0, 160);
      const reference = requestedReference || `KD-EFORM-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
      const duplicate = queryTable("kedco_re_te_eforms", [{ op: "eq", column: "sender_id", value: user.id }, { op: "eq", column: "reference", value: reference }], null, 0, 1)[0];
      if (duplicate && !sameDestination(duplicate, recipientRole, regionalDelivery.regionId, args.requested_recipient_station)) return res.status(409).json({ error: "This reference was already sent to a different recipient. Forward the existing record to the selected officer." });
      if (duplicate) return res.json({ data: { ok: true, duplicate: true, record: duplicate } });
      const now = new Date().toISOString();
      const payload = args.requested_payload && typeof args.requested_payload === "object" ? args.requested_payload : {};
      const [saved] = await insertTable("kedco_re_te_eforms", {
        reference,
        form_code: formCode,
        form_title: formTitle,
        sender_id: user.id,
        sender_email: user.email,
        sender_name: user.full_name || user.email,
        sender_roles: user.roles || [user.primary_role],
        recipient_role: recipientPerson(recipientRole)?.primary_role || recipientRole,
        recipient_user_id: recipientPerson(recipientRole)?.id || null,
        recipient_region_id: regionalDelivery.regionId || recipientPerson(recipientRole)?.region_id || null,
        recipient_region_name: regionalDelivery.regionName || recipientPerson(recipientRole)?.region_name || null,
        recipient_station: String(args.requested_recipient_station || "").trim().slice(0, 240),
        recipient: recipientPerson(recipientRole)?.full_name || recipient,
        recipient_office: String(args.requested_recipient_office || "").trim().slice(0, 240),
        recipient_target_roles: targetRoles,
        note: String(args.requested_note || "").trim().slice(0, 4000),
        region: String(args.requested_region || "").trim().slice(0, 160),
        state: String(args.requested_state || "").trim().slice(0, 160),
        source_page: String(args.requested_source_page || "CENTRAL_DISPATCH").trim().slice(0, 240),
        workflow_family: "CENTRAL",
        copy_record_id: String(args.requested_copy_record_id || "").trim() || null,
        payload,
        form_document: formDocument(args.requested_form_document),
        status: "SENT",
        feedback_status: "PENDING",
        sent_at: now,
        received_at: null,
        feedback: null,
        feedback_by: null,
        feedback_by_name: null,
        feedback_at: null,
        updated_at: now
      });
      appendAudit({ type: "LOCAL_CENTRAL_EFORM_SENT", record_id: saved?.id, reference, form_code: formCode, recipient_role: recipientRole, user_id: user.id });
      return res.json({ data: { ok: true, duplicate: false, record: saved } });
    }

    if (name === "kedco_forward_central_eform") {
      const row = queryTable("kedco_re_te_eforms", [{ op: "eq", column: "id", value: String(args.requested_id || "") }], null, 0, 1)[0];
      if (!row) return res.status(404).json({ error: "E-form not found." });
      if (row.source_type === "OPERATOR_WORKFLOW") return res.status(400).json({ error: "Use the authorised workflow tasks to route this form." });
      if (!canForwardRow(row, user)) return res.status(403).json({ error: "Only the sender or receiving personnel can forward this e-form." });

      let recipientRole = String(args.requested_recipient_role || "").trim().slice(0, 160);
      const regionalDelivery = routeRegionalRE(recipientRole, args);
      if (regionalDelivery.error) return res.status(400).json({ error: regionalDelivery.error });
      recipientRole = regionalDelivery.role;
      const targetRoles = centralRecipientTargets(recipientRole);
      if (!targetRoles.length) return res.status(400).json({ error: "Select a supported recipient office." });
      const now = new Date().toISOString();
      const office = String(args.requested_recipient_office || "").trim().slice(0, 240);
      const requestId = String(args.requested_request_id || "").trim().slice(0, 160);
      if (!requestId) return res.status(400).json({ error: "A forwarding request ID is required." });
      const existing = queryTable("kedco_re_te_eforms", [{ op: "eq", column: "forward_request_id", value: requestId }, { op: "eq", column: "sender_id", value: user.id }], null, 0, 1)[0];
      if (existing && (String(existing.parent_record_id) !== String(row.id) || !sameDestination(existing, recipientRole, regionalDelivery.regionId, args.requested_recipient_station))) return res.status(409).json({ error: "This forwarding request already delivered to a different recipient. Reopen the record to start a new forwarding request." });
      if (existing) return res.json({ data: { ok: true, duplicate: true, record: existing } });
      const [saved] = await insertTable("kedco_re_te_eforms", {
        reference: row.reference, form_code: row.form_code, form_title: row.form_title,
        payload: row.payload, form_document: row.form_document || null, region: row.region, state: row.state,
        sender_id: user.id, sender_name: user.full_name || user.email, sender_email: user.email,
        sender_roles: user.roles || [user.primary_role], recipient_role: recipientPerson(recipientRole)?.primary_role || recipientRole,
        recipient_user_id: recipientPerson(recipientRole)?.id || null,
        recipient_region_id: regionalDelivery.regionId || recipientPerson(recipientRole)?.region_id || null,
        recipient_region_name: regionalDelivery.regionName || recipientPerson(recipientRole)?.region_name || null,
        recipient_station: String(args.requested_recipient_station || "").trim().slice(0, 240),
        recipient: (recipientPerson(recipientRole)?.full_name || recipientRole) + (office ? " - " + office : ""), recipient_office: office,
        recipient_target_roles: targetRoles, source_page: "CENTRAL_FORWARD", workflow_family: "CENTRAL",
        parent_record_id: row.id, root_record_id: row.root_record_id || row.id,
        related_workflow_submission_id: row.source_workflow_submission_id || row.related_workflow_submission_id || null,
        forward_request_id: requestId, copy_record_id: row.copy_record_id || row.id,
        note: String(args.requested_note || "").trim().slice(0, 4000),
        route_history: [...(Array.isArray(row.route_history) ? row.route_history : []),
          { from: row.recipient, by: user.full_name || user.email, to: recipientPerson(recipientRole)?.full_name || recipientRole, office, region: regionalDelivery.regionName || "", station: String(args.requested_recipient_station || "").trim(), note: String(args.requested_note || "").trim().slice(0, 4000), at: now }],
        status: "SENT", feedback_status: "PENDING", sent_at: now, updated_at: now
      });
      appendAudit({ type: "LOCAL_CENTRAL_EFORM_FORWARDED", record_id: saved?.id, parent_record_id: row.id, user_id: user.id, recipient_role: recipientRole });
      return res.json({ data: { ok: true, record: saved } });
    }

    if (name === "kedco_list_central_eforms") {
      const dispatchPage = isDispatchPage(req, args);
      const requestedBox = String(args.requested_box || "all").trim().toLowerCase();
      if (!["sent", "inbox", "all", "register"].includes(requestedBox)) return res.status(400).json({ error: "The central e-form box must be sent, inbox, all or register." });
      const roles = localRoleSet(user);
      const canRegister = ["SUPER_ADMIN", "CTO", "TA_CTO", "HEAD_TECHNICAL", "HEAD_SO", "DISPATCH_SUPERVISOR", "DISPATCH", "SUPER_OPERATOR", "SUPER_TRANS", "SUPER_RE_TE"].some(role => roles.has(role));
      const canViewOwnRegister = ["OPERATOR", "STATION_OPERATOR"].some(role => roles.has(role));
      const canViewAllRegister = dispatchPage && canRegister;
      if (requestedBox === "register" && (!dispatchPage || (!canRegister && !canViewOwnRegister))) return res.status(403).json({ error: "The broad central register is available only from dispatch.html." });
      const rows = queryTable("kedco_re_te_eforms", [], { column: "updated_at", ascending: false }, 0, 20000)
        .filter((row: any) => {
          const sent = String(row?.sender_id || "") === String(user.id);
          const received = canReceiveReteRow(row, roles, user.id);
          return requestedBox === "register" ? (canViewAllRegister || sent) : requestedBox === "sent" ? sent : requestedBox === "inbox" ? received : sent || received;
        })
        .map((row: any) => ({ ...row, can_update: canReceiveReteRow(row, roles, user.id), can_forward: canForwardRow(row, user),
          pending_task: row.source_type === "OPERATOR_WORKFLOW" ? queryTable("kedco_workflow_tasks", [{ op: "eq", column: "submission_id", value: row.source_workflow_submission_id }, { op: "eq", column: "status", value: "PENDING" }], null, 0, 1)[0] || null : null
        }));
      return res.json({ data: rows });
    }

    if (name === "kedco_update_central_eform") {
      const requestedId = String(args.requested_id || "").trim();
      const requestedReference = String(args.requested_reference || "").trim();
      const status = String(args.requested_status || "").trim().toUpperCase();
      const feedback = String(args.requested_feedback || "").trim().slice(0, 4000);
      const allowedStatuses = new Set(["RECEIVED", "IN_REVIEW", "APPROVED", "RETURNED", "COMPLETED"]);
      if ((!requestedId && !requestedReference) || !allowedStatuses.has(status)) return res.status(400).json({ error: "A record/reference and valid work status are required." });
      if (status === "RETURNED" && !feedback) return res.status(400).json({ error: "A return reason / feedback is required before returning an e-form." });
      const roles = localRoleSet(user);
      const filters = requestedId ? [{ op: "eq", column: "id", value: requestedId }] : [{ op: "eq", column: "reference", value: requestedReference }];
      const row = queryTable("kedco_re_te_eforms", filters, null, 0, 1)[0];
      if (!row) return res.status(404).json({ error: "Central e-form record not found." });
      if (!canReceiveReteRow(row, roles, user.id)) return res.status(403).json({ error: "Your KEDCO role is not authorised to update this e-form." });
      if (row.source_type === "OPERATOR_WORKFLOW") return res.status(400).json({ error: "Use the authorised workflow tasks to update this form." });
      const now = new Date().toISOString();
      const patch: Record<string, unknown> = {
        status,
        feedback_status: status === "RETURNED" ? "ACTION_REQUIRED" : status,
        feedback: feedback || row.feedback || null,
        feedback_by: user.id,
        feedback_by_name: user.full_name || user.email,
        feedback_at: now,
        updated_at: now
      };
      if (status === "RECEIVED" && !row.received_at) patch.received_at = now;
      const updated = await updateTable("kedco_re_te_eforms", patch, filters);
      const saved = updated[0] || { ...row, ...patch };
      appendAudit({ type: "LOCAL_CENTRAL_EFORM_FEEDBACK", record_id: saved?.id, reference: saved?.reference, status, user_id: user.id });
      return res.json({ data: { ok: true, record: saved } });
    }

    if (name === "kedco_pcm_live_snapshot") {
      const roles = localRoleSet(user);
      const dispatchPage = isDispatchPage(req, args);
      if (!hasAnyRole(roles, TRANSFORMER_TRIAL_OPERATION_ROLES) && !roles.has("HEAD_PCM")) return res.status(403).json({ error: "Live PC&M oversight access is restricted to authorised KEDCO technical roles." });
      const operations = queryTable("daily_log_events", [], { column: "opened_at", ascending: false }, 0, 500);
      const stationOperations = queryTable("kedco_station_live_operations", [], { column: "event_time", ascending: false }, 0, 500);
      const eforms = queryTable("kedco_re_te_eforms", [], { column: "updated_at", ascending: false }, 0, 500)
        .filter((row: any) => dispatchPage || String(row?.sender_id || "") === String(user.id) || canReceiveReteRow(row, roles, user.id));
      const trials = queryTable("kedco_transformer_trial_requests", [], { column: "updated_at", ascending: false }, 0, 500)
        .filter(row => trialRequestVisible(row, user, roles, { dispatchPage })).map(row => trialRequestView(row, user, roles));
      const feederMap = new Map<string, any>();
      for (const row of [...operations, ...stationOperations]) {
        const feeder = String(row?.feeder || row?.feeder_name || "").trim();
        if (!feeder) continue;
        const key = `${String(row?.region_name || row?.state || "Unassigned")}::${feeder}`;
        if (!feederMap.has(key)) feederMap.set(key, {
          region_name: row?.region_name || row?.state || "Unassigned", feeder_name: feeder,
          station_name: row?.station || row?.station_name || row?.source_station || "—",
          voltage_level: row?.voltage_level || "—", last_event_at: row?.event_time || row?.opened_at || row?.updated_at || null,
          status: String(row?.status || row?.feeder_state || "LIVE").toUpperCase()
        });
      }
      return res.json({ data: {
        generated_at: new Date().toISOString(), regions: localRegions(), feeders: [...feederMap.values()],
        operations, station_operations: stationOperations, eforms, transformer_trials: trials
      } });
    }

    if (name === "kedco_create_transformer_trial_request") {
      const roles = localRoleSet(user);
      if (!hasAnyRole(roles, TRANSFORMER_TRIAL_REQUESTER_ROLES)) return res.status(403).json({ error: "Only authorised operator, dispatch and PC&M personnel can request a transformer trial." });
      const region = findRegion(args.requested_region_id || args.requested_region_name || args.requested_region);
      const station = String(args.requested_station || "").trim().slice(0, 240);
      const transformer = String(args.requested_transformer || "").trim().slice(0, 240);
      const requestedFeeders = Array.isArray(args.requested_feeders) ? args.requested_feeders : (args.requested_feeder ? [args.requested_feeder] : []);
      const feeders = [...new Set(requestedFeeders.map((feeder: unknown) => String(feeder || "").trim().slice(0, 240)).filter(Boolean))].slice(0, 60);
      const feeder = feeders.join(", ");
      const tripTime = String(args.requested_trip_time || "").trim();
      const tripCause = String(args.requested_trip_cause || "").trim().slice(0, 2000);
      const risk = String(args.requested_risk || "").trim().slice(0, 2000);
      const riskDetail = String(args.requested_risk_detail || "").trim().slice(0, 4000);
      if (!region) return res.status(400).json({ error: "Select a valid KEDCO region for the transformer trial request." });
      if (!station || !transformer) return res.status(400).json({ error: "Station and transformer identification are required." });
      if (!tripCause) return res.status(400).json({ error: "Record the trip cause or protection indication before requesting a trial." });
      if (!tripTime || Number.isNaN(Date.parse(tripTime))) return res.status(400).json({ error: "A valid transformer trip time is required." });
      if (!risk) return res.status(400).json({ error: "Select the risk / trial condition before requesting a trial." });
      const prechecks = trialObject(args.requested_prechecks);
      const now = new Date().toISOString();
      const reference = "TR-" + now.replace(/[-:TZ.]/g, "").slice(0, 14) + "-" + crypto.randomBytes(2).toString("hex").toUpperCase();
      const [saved] = await insertTable("kedco_transformer_trial_requests", {
        reference, status: "PENDING_HEAD_PCM", requested_by: user.id, requested_by_name: user.full_name || user.email,
        requested_by_email: user.email, requested_roles: user.roles || [user.primary_role],
        requested_region_id: region.id, requested_region_name: region.name, requested_station: station,
        requested_transformer: transformer, requested_feeder: feeder || null, requested_feeders: feeders,
        requested_voltage: String(args.requested_voltage || "").trim().slice(0, 80) || null,
        requested_trip_time: new Date(tripTime).toISOString(), requested_trip_cause: tripCause,
        requested_protection_indication: String(args.requested_protection_indication || "").trim().slice(0, 2000) || null,
        requested_prechecks: prechecks, prechecks_completed: false,
        requested_risk: risk, requested_risk_detail: riskDetail || null,
        requested_note: String(args.requested_note || "").trim().slice(0, 4000) || null,
        approval_note: null, reviewed_by: null, reviewed_by_name: null, reviewed_at: null,
        result_status: null, result_note: null, result_by: null, result_by_name: null, result_at: null, created_at: now, updated_at: now
      });
      appendAudit({ type: "LOCAL_TRANSFORMER_TRIAL_REQUESTED", record_id: saved?.id, reference, region: region.name, station, transformer, feeders, user_id: user.id });
      return res.json({ data: { ok: true, record: trialRequestView(saved, user, roles) } });
    }
    if (name === "kedco_list_transformer_trial_requests") {
      const roles = localRoleSet(user);
      const dispatchPage = isDispatchPage(req, args);
      const hasForwardedAssignment = queryTable("kedco_transformer_trial_requests", [{ op: "eq", column: "forwarded_to_user_id", value: user.id }, { op: "eq", column: "status", value: "FORWARDED" }], null, 0, 1).length > 0;
      if (!hasAnyRole(roles, TRANSFORMER_TRIAL_OPERATION_ROLES) && !hasForwardedAssignment) return res.status(403).json({ error: "Transformer trial access is restricted to authorised KEDCO technical roles." });
      const rows = queryTable("kedco_transformer_trial_requests", [], { column: "updated_at", ascending: false }, 0, 500)
        .filter(row => trialRequestVisible(row, user, roles, { dispatchPage })).map(row => trialRequestView(row, user, roles));
      return res.json({ data: rows });
    }

    if (name === "kedco_review_transformer_trial_request") {
      const roles = localRoleSet(user);
      if (!hasAnyRole(roles, TRANSFORMER_TRIAL_REVIEWER_ROLES)) return res.status(403).json({ error: "Only Head PC&M and authorised technical oversight roles can approve transformer trials." });
      const requestedId = String(args.requested_id || "").trim();
      const requestedReference = String(args.requested_reference || "").trim();
      const decision = String(args.requested_decision || "").trim().toUpperCase();
      const note = String(args.requested_note || "").trim().slice(0, 4000);
      if ((!requestedId && !requestedReference) || !["APPROVED", "REJECTED", "RETURNED"].includes(decision)) return res.status(400).json({ error: "Select a request and a valid approval decision." });
      if (["REJECTED", "RETURNED"].includes(decision) && !note) return res.status(400).json({ error: "A reason is required when rejecting or returning a trial request." });
      const filters = requestedId ? [{ op: "eq", column: "id", value: requestedId }] : [{ op: "eq", column: "reference", value: requestedReference }];
      const row = queryTable("kedco_transformer_trial_requests", filters, null, 0, 1)[0];
      if (!row) return res.status(404).json({ error: "Transformer trial request not found." });
      if (!["PENDING_HEAD_PCM", "RETURNED"].includes(String(row.status || ""))) return res.status(409).json({ error: `This request is already ${String(row.status || "processed").toLowerCase()}.` });
      const now = new Date().toISOString();
      const updated = await updateTable("kedco_transformer_trial_requests", {
        status: decision === "APPROVED" ? "APPROVED" : decision, approval_note: note || null,
        prechecks_completed: decision === "APPROVED" ? false : row.prechecks_completed ?? null,
        reviewed_by: user.id, reviewed_by_name: user.full_name || user.email, reviewed_at: now, updated_at: now
      }, filters);
      const saved = updated[0] || { ...row, status: decision, approval_note: note, reviewed_by: user.id, reviewed_by_name: user.full_name || user.email, reviewed_at: now };
      appendAudit({ type: `LOCAL_TRANSFORMER_TRIAL_${decision}`, record_id: saved.id, reference: saved.reference, user_id: user.id, note: note || null });
      return res.json({ data: { ok: true, record: trialRequestView(saved, user, roles) } });
    }

    if (name === "kedco_confirm_transformer_trial_prechecks") {
      const roles = localRoleSet(user);
      const requestedId = String(args.requested_id || "").trim();
      const row = queryTable("kedco_transformer_trial_requests", [{ op: "eq", column: "id", value: requestedId }], null, 0, 1)[0];
      if (!row) return res.status(404).json({ error: "Transformer trial request not found." });
      const reviewer = hasAnyRole(roles, TRANSFORMER_TRIAL_REVIEWER_ROLES);
      const owner = String(row.requested_by || "") === String(user.id || "");
      const forwardedRecipient = String(row.forwarded_to_user_id || "") === String(user.id || "");
      if (!reviewer && !owner && !forwardedRecipient) return res.status(403).json({ error: "Only the requesting operator/engineer, assigned personnel or Head PC&M can confirm these safety pre-checks." });
      if (!["APPROVED", "TRIAL_IN_PROGRESS"].includes(String(row.status || ""))) return res.status(409).json({ error: "Mandatory safety pre-checks become available only after Head PC&M approval." });
      const prechecks = trialObject(args.requested_prechecks);
      const missingPrecheck = TRANSFORMER_TRIAL_PRECHECK_KEYS.find(key => prechecks[key] !== true);
      if (missingPrecheck) return res.status(400).json({ error: "Complete all mandatory safety pre-checks before confirming readiness for trial." });
      const now = new Date().toISOString();
      const filters = [{ op: "eq", column: "id", value: requestedId }];
      const updated = await updateTable("kedco_transformer_trial_requests", {
        requested_prechecks: prechecks, prechecks_completed: true,
        prechecks_completed_by: user.id, prechecks_completed_by_name: user.full_name || user.email,
        prechecks_completed_at: now, updated_at: now
      }, filters);
      const saved = updated[0] || { ...row, requested_prechecks: prechecks, prechecks_completed: true, prechecks_completed_by: user.id, prechecks_completed_by_name: user.full_name || user.email, prechecks_completed_at: now };
      appendAudit({ type: "LOCAL_TRANSFORMER_TRIAL_PRECHECKS_CONFIRMED", record_id: saved.id, reference: saved.reference, user_id: user.id });
      return res.json({ data: { ok: true, record: trialRequestView(saved, user, roles) } });
    }
    if (name === "kedco_forward_transformer_trial_request") {
      const roles = localRoleSet(user);
      if (!hasAnyRole(roles, TRANSFORMER_TRIAL_REVIEWER_ROLES)) return res.status(403).json({ error: "Only Head PC&M and authorised technical oversight roles can forward transformer trial instructions." });
      const requestedId = String(args.requested_id || "").trim();
      const row = queryTable("kedco_transformer_trial_requests", [{ op: "eq", column: "id", value: requestedId }], null, 0, 1)[0];
      if (!row) return res.status(404).json({ error: "Transformer trial request not found." });
      if (!["PENDING_HEAD_PCM", "RETURNED"].includes(String(row.status || ""))) return res.status(409).json({ error: `This request is already ${String(row.status || "processed").toLowerCase()}. Complete the current assignment before forwarding it again.` });
      const forwardRegion = findRegion(args.requested_forward_region_id || args.requested_forward_region_name);
      if (!forwardRegion) return res.status(400).json({ error: "Select the KEDCO region this transformer trial request should be forwarded to." });
      const recipientId = String(args.requested_recipient_user_id || "").trim();
      if (!recipientId || recipientId === String(user.id || "")) return res.status(400).json({ error: "Select another active KEDCO personnel to receive this instruction." });
      const recipient = users().find(person => person.is_active !== false && String(person.id) === recipientId);
      if (!recipient) return res.status(400).json({ error: "Select a valid active KEDCO personnel from the list." });
      if (!userRegionMatches(recipient, forwardRegion)) return res.status(400).json({ error: "The selected KEDCO personnel is not assigned to the selected forwarding region." });
      const instruction = String(args.requested_instruction || "").trim();
      const note = String(args.requested_note || "").trim().slice(0, 4000);
      if (!TRANSFORMER_TRIAL_FORWARD_INSTRUCTIONS.has(instruction)) return res.status(400).json({ error: "Select an approved pre-trial instruction." });
      if (instruction === "Other approved pre-trial instruction" && !note) return res.status(400).json({ error: "Describe the other approved pre-trial instruction before forwarding." });
      const now = new Date().toISOString();
      const recipientRoles = Array.isArray(recipient.roles) ? recipient.roles : [recipient.primary_role];
      const filters = [{ op: "eq", column: "id", value: requestedId }];
      const updated = await updateTable("kedco_transformer_trial_requests", {
        status: "FORWARDED", forward_status: "PENDING",
        forwarded_to_user_id: recipient.id, forwarded_to_name: recipient.full_name || recipient.email,
        forwarded_to_region_id: forwardRegion.id, forwarded_to_region_name: forwardRegion.name,
        forwarded_to_email: recipient.email || null, forwarded_to_role: recipient.primary_role || recipientRoles[0] || null,
        forwarded_instruction: instruction, forwarded_note: note || null,
        forwarded_by: user.id, forwarded_by_name: user.full_name || user.email, forwarded_at: now,
        forward_completed_by: null, forward_completed_by_name: null, forward_completed_at: null,
        forward_completion_note: null, updated_at: now
      }, filters);
      const saved = updated[0] || { ...row, status: "FORWARDED", forward_status: "PENDING", forwarded_to_user_id: recipient.id, forwarded_to_name: recipient.full_name || recipient.email, forwarded_to_region_id: forwardRegion.id, forwarded_to_region_name: forwardRegion.name, forwarded_to_email: recipient.email || null, forwarded_to_role: recipient.primary_role || recipientRoles[0] || null, forwarded_instruction: instruction, forwarded_note: note || null, forwarded_by: user.id, forwarded_by_name: user.full_name || user.email, forwarded_at: now };
      appendAudit({ type: "LOCAL_TRANSFORMER_TRIAL_FORWARDED", record_id: saved.id, reference: saved.reference, user_id: user.id, recipient_user_id: recipient.id, forward_region: forwardRegion.name, instruction });
      return res.json({ data: { ok: true, record: trialRequestView(saved, user, roles) } });
    }

    if (name === "kedco_complete_transformer_trial_forward") {
      const requestedId = String(args.requested_id || "").trim();
      const note = String(args.requested_note || "").trim().slice(0, 4000);
      if (!requestedId || !note) return res.status(400).json({ error: "Record what was done before returning the transformer trial request to Head PC&M." });
      const filters = [{ op: "eq", column: "id", value: requestedId }];
      const row = queryTable("kedco_transformer_trial_requests", filters, null, 0, 1)[0];
      if (!row) return res.status(404).json({ error: "Transformer trial request not found." });
      if (String(row.forwarded_to_user_id || "") !== String(user.id || "")) return res.status(403).json({ error: "Only the assigned KEDCO personnel can complete this forwarded instruction." });
      if (String(row.status || "") !== "FORWARDED") return res.status(409).json({ error: "This forwarded instruction is no longer pending." });
      const roles = localRoleSet(user);
      const now = new Date().toISOString();
      const updated = await updateTable("kedco_transformer_trial_requests", {
        status: "PENDING_HEAD_PCM", forward_status: "COMPLETED",
        forward_completed_by: user.id, forward_completed_by_name: user.full_name || user.email,
        forward_completed_at: now, forward_completion_note: note, updated_at: now
      }, filters);
      const saved = updated[0] || { ...row, status: "PENDING_HEAD_PCM", forward_status: "COMPLETED", forward_completed_by: user.id, forward_completed_by_name: user.full_name || user.email, forward_completed_at: now, forward_completion_note: note };
      appendAudit({ type: "LOCAL_TRANSFORMER_TRIAL_FORWARD_COMPLETED", record_id: saved.id, reference: saved.reference, user_id: user.id, note });
      return res.json({ data: { ok: true, record: trialRequestView(saved, user, roles) } });
    }

    if (name === "kedco_record_transformer_trial_result") {
      const roles = localRoleSet(user);
      if (!hasAnyRole(roles, TRANSFORMER_TRIAL_OPERATION_ROLES)) return res.status(403).json({ error: "Only authorised KEDCO operational personnel can record a transformer trial result." });
      const requestedId = String(args.requested_id || "").trim();
      const requestedReference = String(args.requested_reference || "").trim();
      const resultStatus = String(args.requested_result_status || "").trim().toUpperCase();
      const note = String(args.requested_note || "").trim().slice(0, 4000);
      if ((!requestedId && !requestedReference) || !["TRIAL_STARTED", "TRIAL_COMPLETED", "TRIPPED_AGAIN", "FAILED", "CANCELLED"].includes(resultStatus)) return res.status(400).json({ error: "Select a request and a valid trial result." });
      if (["TRIAL_COMPLETED", "TRIPPED_AGAIN", "FAILED", "CANCELLED"].includes(resultStatus) && !note) return res.status(400).json({ error: "Add the switching or safety note for this trial update." });
      const filters = requestedId ? [{ op: "eq", column: "id", value: requestedId }] : [{ op: "eq", column: "reference", value: requestedReference }];
      const row = queryTable("kedco_transformer_trial_requests", filters, null, 0, 1)[0];
      if (!row) return res.status(404).json({ error: "Transformer trial request not found." });
      const reviewer = hasAnyRole(roles, TRANSFORMER_TRIAL_REVIEWER_ROLES);
      if (!reviewer && String(row.requested_by || "") !== String(user.id || "")) return res.status(403).json({ error: "Only the requesting operator/engineer or Head PC&M can record this trial result." });
      if (String(row.status || "") !== "APPROVED" && !["TRIAL_STARTED", "TRIAL_COMPLETED", "TRIPPED_AGAIN", "FAILED", "CANCELLED"].includes(String(row.result_status || ""))) return res.status(409).json({ error: "The transformer trial must be approved before a result can be recorded." });
      if (resultStatus === "TRIAL_STARTED" && !trialPrechecksComplete(row)) return res.status(409).json({ error: "Complete the mandatory safety pre-checks after approval before starting the transformer trial." });
      const now = new Date().toISOString();
      const updated = await updateTable("kedco_transformer_trial_requests", {
        status: resultStatus === "TRIAL_STARTED" ? "TRIAL_IN_PROGRESS" : "TRIAL_CLOSED", result_status: resultStatus,
        result_note: note || null, result_by: user.id, result_by_name: user.full_name || user.email, result_at: now, updated_at: now
      }, filters);
      const saved = updated[0] || { ...row, result_status: resultStatus, result_note: note, result_by: user.id, result_by_name: user.full_name || user.email, result_at: now };
      appendAudit({ type: `LOCAL_TRANSFORMER_TRIAL_RESULT_${resultStatus}`, record_id: saved.id, reference: saved.reference, user_id: user.id });
      return res.json({ data: { ok: true, record: trialRequestView(saved, user, roles) } });
    }
    if (name === "kedco_daily_feeder_operation") {
      const action = String(args.requested_action || "").trim().toLowerCase();
      const station = String(args.requested_station || "").trim();
      const feeder = String(args.requested_feeder || "").trim();
      const category = String(args.requested_category || "").trim().toLowerCase();
      const operationTime = String(args.requested_operation_time || "").trim();
      const stamp = new Date(operationTime);
      if (!station || !feeder || !["open", "close"].includes(action)) return res.status(400).json({ error: "Station, feeder and OPEN/CLOSE action are required." });
      if (!operationTime || Number.isNaN(stamp.getTime())) return res.status(400).json({ error: "A valid operation time is required." });

      const timedCategories = new Set(["fault", "breaker_fault", "emergency", "planned_outage"]);
      const durationMinutes = Number(args.requested_planned_duration_minutes);
      if (action === "open" && timedCategories.has(category) && (!Number.isFinite(durationMinutes) || durationMinutes <= 0)) {
        return res.status(400).json({ error: "This feeder operation requires a valid duration / clearance target before the feeder can be opened." });
      }

      const openRecord = queryTable("daily_log_events", [
        { op: "eq", column: "station", value: station },
        { op: "eq", column: "feeder", value: feeder },
        { op: "eq", column: "status", value: "open" }
      ], { column: "opened_at", ascending: false }, 0, 1)[0] || null;

      if (action === "open" && openRecord) return res.json({ data: { ok: false, code: "ALREADY_OPEN", message: `${feeder} at ${station} is already OPEN.`, record: openRecord } });
      if (action === "close" && !openRecord) return res.json({ data: { ok: false, code: "ALREADY_CLOSED", message: `${feeder} at ${station} is already CLOSED.` } });

      if (action === "open") {
        const [saved] = await insertTable("daily_log_events", {
          station,
          state: args.requested_state || null,
          source_station: args.requested_source_station || station,
          voltage_level: args.requested_voltage_level || null,
          feeder,
          category,
          planned_duration_minutes: timedCategories.has(category) ? Math.max(1, Math.round(durationMinutes)) : null,
          load_lost_mw: args.requested_load_lost_mw ?? null,
          feeder_state: args.requested_feeder_state || null,
          reason: args.requested_reason || category || "Feeder Operation",
          opened_at: stamp.toISOString(),
          closed_at: null,
          status: "open",
          operator: args.requested_operator || user.full_name || user.email,
          created_by: user.id,
          updated_at: new Date().toISOString()
        });
        appendAudit({ type: "LOCAL_DAILY_FEEDER_OPEN", user_id: user.id, record_id: saved?.id, station, feeder, category });
        return res.json({ data: { ok: true, action: "open", record: saved } });
      }

      const openedAt = Date.parse(String(openRecord.opened_at || ""));
      if (!Number.isNaN(openedAt) && stamp.getTime() < openedAt) return res.status(400).json({ error: "Closing time is earlier than the opening time." });
      const updated = await updateTable("daily_log_events", {
        closed_at: stamp.toISOString(), status: "closed", updated_at: new Date().toISOString()
      }, [
        { op: "eq", column: "id", value: openRecord.id },
        { op: "eq", column: "station", value: station },
        { op: "eq", column: "feeder", value: feeder },
        { op: "eq", column: "status", value: "open" }
      ]);
      if (updated.length !== 1) return res.status(409).json({ error: "Restoration safety check failed: expected exactly one open feeder record to close." });
      const saved = updated[0];
      appendAudit({ type: "LOCAL_DAILY_FEEDER_CLOSE", user_id: user.id, record_id: saved?.id, station, feeder, category: openRecord.category || null });
      return res.json({ data: { ok: true, action: "close", record: saved } });
    }

    if (name === "kedco_publish_station_operation") {
      const now = new Date().toISOString();
      const row = {
        created_by: user.id,
        source_table: "local_cloud_data",
        source_record_id: crypto.randomUUID(),
        source_key: crypto.randomUUID(),
        operation_type: args.requested_operation_type || null,
        station_name: args.requested_station_name || null,
        region_name: args.requested_region_name || null,
        state_code: args.requested_state_code || null,
        voltage_level: args.requested_voltage_level || null,
        feeder_name: args.requested_feeder_name || null,
        reading_date: args.requested_reading_date || null,
        reading_hour: args.requested_reading_hour ?? null,
        shift: args.requested_shift || null,
        status: args.requested_status || "LIVE",
        summary: args.requested_summary || null,
        payload: args.requested_payload || {},
        event_time: now
      };
      const [saved] = await insertTable("kedco_station_live_operations", row);
      return res.json({ data: saved });
    }

    if (name === "kedco_save_operator_workflow_draft") {
      const requestedId = String(args.requested_submission_id || "").trim();
      const submissionId = requestedId || crypto.randomUUID();
      const requestedFormCode = String(args.requested_form_code || "").trim();
      const workflowContext = (args.requested_workflow_context && typeof args.requested_workflow_context === "object") ? args.requested_workflow_context as Record<string, unknown> : {};
      const formCode = resolveWorkflowRouteKey(requestedFormCode, workflowContext);
      const route = WORKFLOW_ROUTES[formCode] || null;
      const row = {
        id: submissionId, owner_id: user.id, form_code: formCode, source_form_code: requestedFormCode,
        form_data: args.requested_form_data || {}, workflow_context: workflowContext,
        form_document: formDocument(args.requested_form_document),
        region_id: args.requested_region_id || null, status: "DRAFT",
        route_title: route?.title || formCode, route_label: route?.route_label || null, route_steps: route?.steps || [],
        current_route_step: 0, updated_at: new Date().toISOString()
      };
      const existing = queryTable("kedco_workflow_submissions", [{ op: "eq", column: "id", value: submissionId }, { op: "eq", column: "owner_id", value: user.id }], null, 0, 1);
      if (existing.length) await updateTable("kedco_workflow_submissions", row, [{ op: "eq", column: "id", value: submissionId }]);
      else await insertTable("kedco_workflow_submissions", row);
      return res.json({ data: { submission_id: submissionId, status: "DRAFT" } });
    }

    if (name === "kedco_register_workflow_file") {
      const [saved] = await insertTable("kedco_workflow_files", {
        submission_id: args.requested_submission_id, document_type_code: args.requested_document_type_code,
        object_path: args.requested_object_path, original_file_name: args.requested_original_file_name,
        mime_type: args.requested_mime_type, file_size_bytes: args.requested_file_size_bytes,
        metadata: args.requested_metadata || {}, uploaded_by: user.id
      });
      return res.json({ data: saved });
    }

    if (name === "kedco_validate_submission_documents") {
      const submissionId = String(args.requested_submission_id || "");
      const submission = queryTable("kedco_workflow_submissions", [{ op: "eq", column: "id", value: submissionId }], null, 0, 1)[0];
      if (!submission) return res.status(404).json({ error: "Workflow submission not found" });
      const needed = REQUIRED_DOCS[String(submission.form_code || "")] || [];
      const files = queryTable("kedco_workflow_files", [{ op: "eq", column: "submission_id", value: submissionId }], null, 0, 1000);
      const present = new Set(files.map((f: any) => String(f.document_type_code || "")));
      const missing = needed.filter(code => !present.has(code)).map(code => ({ document_type_code: code, document_name: code.replaceAll("_", " "), missing: 1 }));
      return res.json({ data: { valid: missing.length === 0, missing_documents: missing } });
    }

    if (name === "kedco_submit_operator_workflow") {
      const submissionId = String(args.requested_submission_id || "");
      const submission = queryTable("kedco_workflow_submissions", [{ op: "eq", column: "id", value: submissionId }], null, 0, 1)[0];
      if (!submission) return res.status(404).json({ error: "Workflow submission not found" });
      const needed = REQUIRED_DOCS[String(submission.form_code || "")] || [];
      const files = queryTable("kedco_workflow_files", [{ op: "eq", column: "submission_id", value: submissionId }], null, 0, 1000);
      const present = new Set(files.map((f: any) => String(f.document_type_code || "")));
      const missing = needed.filter(code => !present.has(code)).map(code => ({ document_type_code: code, document_name: code.replaceAll("_", " "), missing: 1 }));
      if (missing.length) return res.json({ data: { submitted: false, validation: { valid: false, missing_documents: missing } } });
      const route = WORKFLOW_ROUTES[String(submission.form_code || "")] || null;
      const submittedAt = new Date().toISOString();
      await updateTable("kedco_workflow_submissions", {
        status: "SUBMITTED", submitted_at: submittedAt, current_route_step: route?.steps?.length ? 1 : 0,
        route_title: route?.title || submission.route_title || null, route_label: route?.route_label || submission.route_label || null, route_steps: route?.steps || submission.route_steps || []
      }, [{ op: "eq", column: "id", value: submissionId }]);

      const existingTasks = queryTable("kedco_workflow_tasks", [{ op: "eq", column: "submission_id", value: submissionId }], null, 0, 1000);
      if (!existingTasks.length && route?.steps?.length) {
        const targetStation = workflowStation(submission.workflow_context, submission.form_data);
        const tasks = route.steps.map(step => ({
          submission_id: submissionId, form_code: submission.form_code, owner_id: submission.owner_id,
          step_number: step.step, step_code: step.code, step_label: step.label, target_roles: step.target_roles,
          target_station: targetStation || null,
          status: step.step === 1 ? "PENDING" : "QUEUED", route_label: route.route_label, created_at: submittedAt
        }));
        await insertTable("kedco_workflow_tasks", tasks);
      }
      const firstStep = route?.steps?.[0] || null;
      const centralWorkflowFilters = [{ op: "eq", column: "source_workflow_submission_id", value: submissionId }];
      const centralWorkflow = queryTable("kedco_re_te_eforms", centralWorkflowFilters, null, 0, 1)[0];
      const centralWorkflowRow = {
        reference: `KEDCO-WF-${submissionId}`,
        form_code: submission.source_form_code || submission.form_code,
        form_title: route?.title || submission.route_title || submission.form_code,
        sender_id: submission.owner_id,
        sender_email: user.email,
        sender_name: user.full_name || user.email,
        sender_roles: user.roles || [user.primary_role],
        recipient_role: firstStep?.target_roles?.[0] || "",
        recipient: firstStep?.label || "Workflow review",
        recipient_office: "",
        recipient_target_roles: firstStep?.target_roles || [],
        recipient_station: workflowStation(submission.workflow_context, submission.form_data) || "",
        notification_stage: firstStep?.code || "SUBMITTED",
        note: route?.route_label || submission.route_label || "",
        region: submission.region_id || "",
        state: "",
        source_page: "operator.html",
        source_type: "OPERATOR_WORKFLOW",
        source_workflow_submission_id: submissionId,
        workflow_family: "OPERATOR_WORKFLOW",
        copy_record_id: submissionId,
        payload: submission.form_data || {},
        form_document: submission.form_document || null,
        status: "SENT",
        feedback_status: "PENDING",
        sent_at: submittedAt,
        received_at: null,
        feedback: null,
        feedback_by: null,
        feedback_by_name: null,
        feedback_at: null,
        updated_at: submittedAt
      };
      if (centralWorkflow) await updateTable("kedco_re_te_eforms", centralWorkflowRow, centralWorkflowFilters);
      else await insertTable("kedco_re_te_eforms", centralWorkflowRow);
      appendAudit({ type: "LOCAL_WORKFLOW_SUBMITTED", submission_id: submissionId, form_code: submission.form_code, route_label: route?.route_label || null });
      return res.json({ data: { submitted: true, submission_id: submissionId, route_label: route?.route_label || null, route_steps: route?.steps || [] } });
    }

    if (name === "kedco_list_workflow_inbox") {
      const requestedAudience = String(args.requested_audience || "").trim().toLowerCase();
      const roles = new Set([...(Array.isArray(user.roles) ? user.roles : []), user.primary_role].map((role: unknown) => String(role || "").trim().toUpperCase()).filter(Boolean));
      const submissions = queryTable("kedco_workflow_submissions", [], { column: "updated_at", ascending: false }, 0, 10000);
      const tasks = queryTable("kedco_workflow_tasks", [], { column: "created_at", ascending: false }, 0, 10000);
      const rows = tasks.filter((task: any) => {
        const targetRoles = Array.isArray(task.target_roles) ? task.target_roles : (() => { try { const parsed = JSON.parse(String(task.target_roles || "[]")); return Array.isArray(parsed) ? parsed : []; } catch { return []; } })();
        const taskCode = String(task.step_code || "").toUpperCase();
        if (requestedAudience === "head" && taskCode !== "HEAD_SO_APPROVAL") return false;
        if (requestedAudience === "transmission" && taskCode !== "BICHI_TS_APPROVAL") return false;
        const visibleStatuses = ["PENDING", "QUEUED"];
        if (requestedAudience === "head" || requestedAudience === "transmission") visibleStatuses.push("APPROVED");
        const submission = submissions.find((item: any) => String(item.id) === String(task.submission_id));
        return targetRoles.some((role: unknown) => roles.has(String(role || "").trim().toUpperCase())) &&
          workflowTaskStationAllowed(task, submission, user, roles) &&
          visibleStatuses.includes(String(task.status || "").toUpperCase());
      }).map((task: any) => ({
        submission: submissions.find((item: any) => String(item.id) === String(task.submission_id)) || null,
        task
      })).filter((row: any) => row.submission);
      return res.json({ data: rows });
    }

    if (name === "kedco_approve_workflow_task") {
      const submissionId = String(args.requested_submission_id || "").trim();
      const taskCode = String(args.requested_task_code || "").trim();
      const decision = String(args.requested_decision || "").trim().toUpperCase();
      if (!submissionId || !taskCode || !["APPROVE", "REJECT"].includes(decision)) return res.status(400).json({ error: "A submission, task and APPROVE/REJECT decision are required." });

      const roles = new Set([...(Array.isArray(user.roles) ? user.roles : []), user.primary_role].map((role: unknown) => String(role || "").trim().toUpperCase()).filter(Boolean));
      const task = queryTable("kedco_workflow_tasks", [{ op: "eq", column: "submission_id", value: submissionId }, { op: "eq", column: "step_code", value: taskCode }, { op: "eq", column: "status", value: "PENDING" }], null, 0, 1)[0];
      if (!task) return res.status(404).json({ error: "The workflow task is not pending or does not exist." });
      const targetRoles = Array.isArray(task.target_roles) ? task.target_roles : (() => { try { const parsed = JSON.parse(String(task.target_roles || "[]")); return Array.isArray(parsed) ? parsed : []; } catch { return []; } })();
      const submission = queryTable("kedco_workflow_submissions", [{ op: "eq", column: "id", value: submissionId }], null, 0, 1)[0];
      if (!submission) return res.status(404).json({ error: "Workflow submission not found." });
      if (!targetRoles.some((role: unknown) => roles.has(String(role || "").trim().toUpperCase()))) return res.status(403).json({ error: "Your KEDCO role is not authorised for this workflow task." });
      if (!workflowTaskStationAllowed(task, submission, user, roles)) return res.status(403).json({ error: "This Station Guarantee is assigned to a different station operator." });
      const actionedAt = new Date().toISOString();
      const taskFilters = task.id ? [{ op: "eq", column: "id", value: task.id }] : [{ op: "eq", column: "submission_id", value: submissionId }, { op: "eq", column: "step_code", value: taskCode }];
      await updateTable("kedco_workflow_tasks", {
        status: decision === "APPROVE" ? "APPROVED" : "REJECTED",
        actioned_by: user.id,
        actioned_by_name: user.full_name || user.email,
        actioned_at: actionedAt,
        action_comment: args.requested_comment || null,
        updated_at: actionedAt
      }, taskFilters);

      if (decision === "REJECT") {
        await updateTable("kedco_workflow_submissions", { status: "RETURNED", current_route_step: task.step_number, returned_at: actionedAt, returned_by: user.id, updated_at: actionedAt }, [{ op: "eq", column: "id", value: submissionId }]);
        await updateTable("kedco_re_te_eforms", { status: "RETURNED", feedback_status: "ACTION_REQUIRED", feedback: args.requested_comment || "Workflow task returned.", feedback_by: user.id, feedback_by_name: user.full_name || user.email, feedback_at: actionedAt, updated_at: actionedAt }, [{ op: "eq", column: "source_workflow_submission_id", value: submissionId }]);
        appendAudit({ type: "LOCAL_WORKFLOW_TASK_REJECTED", submission_id: submissionId, task_code: taskCode, user_id: user.id });
        return res.json({ data: { ok: true, status: "RETURNED", submission_id: submissionId, task_code: taskCode } });
      }

      const nextTask = queryTable("kedco_workflow_tasks", [{ op: "eq", column: "submission_id", value: submissionId }, { op: "gt", column: "step_number", value: Number(task.step_number) || 0 }, { op: "eq", column: "status", value: "QUEUED" }], { column: "step_number", ascending: true }, 0, 1)[0] || null;
      if (nextTask) {
        const nextFilters = nextTask.id ? [{ op: "eq", column: "id", value: nextTask.id }] : [{ op: "eq", column: "submission_id", value: submissionId }, { op: "eq", column: "step_number", value: nextTask.step_number }];
        await updateTable("kedco_workflow_tasks", { status: "PENDING", updated_at: actionedAt }, nextFilters);
      }
      const nextStatus = nextTask ? "IN_REVIEW" : "APPROVED_FOR_ISSUE";
      await updateTable("kedco_workflow_submissions", { status: nextStatus, current_route_step: nextTask ? nextTask.step_number : task.step_number, updated_at: actionedAt }, [{ op: "eq", column: "id", value: submissionId }]);
      await updateTable("kedco_re_te_eforms", {
        status: nextTask ? "IN_REVIEW" : "APPROVED",
        feedback_status: nextTask ? "IN_REVIEW" : "APPROVED",
        feedback: args.requested_comment || (nextTask ? `Approved: awaiting ${nextTask.step_label || nextTask.step_code}.` : "All approval steps completed."),
        feedback_by: user.id,
        feedback_by_name: user.full_name || user.email,
        feedback_at: actionedAt,
        recipient_role: nextTask?.target_roles?.[0] || "",
        recipient: nextTask?.step_label || "Workflow completed",
        recipient_target_roles: nextTask?.target_roles || [],
        recipient_station: String(nextTask?.target_station || workflowStation(submission.workflow_context, submission.form_data) || ""),
        notification_stage: nextTask?.step_code || "COMPLETED",
        updated_at: actionedAt
      }, [{ op: "eq", column: "source_workflow_submission_id", value: submissionId }]);
      appendAudit({ type: "LOCAL_WORKFLOW_TASK_APPROVED", submission_id: submissionId, task_code: taskCode, user_id: user.id, next_task: nextTask?.step_code || null });
      return res.json({ data: { ok: true, status: nextStatus, submission_id: submissionId, task_code: taskCode, next_task_code: nextTask?.step_code || null } });
    }

    return res.status(404).json({ error: `Local RPC is not implemented: ${name}` });
  } catch (error) { next(error); }
});

export default router;

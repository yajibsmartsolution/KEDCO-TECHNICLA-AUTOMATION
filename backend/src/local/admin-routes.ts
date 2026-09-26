import { Router } from "express";
import { users, publicUser, setUserActive, setUserAssignments, setUserRoles } from "./auth-store.js";
import { readJson, tableRows } from "./store.js";
import { localRegions } from "./regions.js";

const router = Router();

const KEDCO_ROLE_CODES = [
  "CTO","SUPER_ADMIN","DEVELOPER","MD_CEO","HEAD_TECHNICAL","TA_CTO",
  "HEAD_SO","SUPERVISOR","SUPER_RE_TE","SUPER_OPERATOR","SUPER_TRANS","DISPATCH_SUPERVISOR","DISPATCH","OPERATOR","TCN_INTERFACE","STATION_OPERATOR",
  "HEAD_OM","REGIONAL_OM_COORD","TSP_TECH_SERVICES","REGIONAL_EF_LEAD","REGIONAL_CJ_LEAD","REGIONAL_EF","REGIONAL_CJ","RE","TE",
  "HEAD_PCM","REGIONAL_PCM_COORD","PROTECTION_ENGINEER","CONTROL_SCADA_ENGINEER","METERING_ENGINEER","TEST_ENGINEER","REGIONAL_PPM_COORD",
  "HEAD_PI","REGIONAL_PI_COORD","PLANNING_ENGINEER","PROJECT_ENGINEER",
  "HEAD_HSE","REGIONAL_HSE_OFFICER","HSE_OFFICER",
  "HEAD_MIS","MIS_TEAM_LEAD","DATA_ANALYST",
  "PROCUREMENT_HEAD","PROCUREMENT_OFFICER","FINANCE_HEAD","FINANCE_OFFICER","LEGAL_OFFICER","SECURITY_OFFICER","HR_ADMIN_OFFICER",
  "TMO","ANALYZER","TRANSMISSION","STORE_MANAGER","STORE_OFFICER","CONTRACTOR_PM","CONTRACTOR_USER"
];

function adminAllowed(user: any) {
  return user?.roles?.some((r: string) => ["SUPER_ADMIN", "DEVELOPER"].includes(String(r).toUpperCase()));
}

router.get("/health", (_req, res) => res.json({ ok: true, service: "KEDCO Local Developer Administration API", mode: "local" }));

router.get("/bootstrap", (_req, res) => {
  const localUsers = users();
  const roles = KEDCO_ROLE_CODES.map(code => ({ id: code, code, name: code.replaceAll("_", " "), is_active: true }));
  const profiles = localUsers.map(u => ({
    id: u.id, email: u.email, full_name: u.full_name, approval_status: "APPROVED", account_status: u.is_active ? "ACTIVE" : "INACTIVE",
    is_active: u.is_active, role_code: u.primary_role, region_id: u.region_id || null, department_id: null
  }));
  const userRoles = localUsers.flatMap(u => (u.roles || []).map(code => ({ id: `${u.id}:${code}`, user_id: u.id, role_id: code, is_primary: code === u.primary_role })));
  const staff = localUsers.map(u => ({
    ...publicUser(u), account_status: u.is_active ? "ACTIVE" : "INACTIVE", approval_status: "APPROVED", region_id: u.region_id || null, department_id: null,
    roles: (u.roles || []).map(code => ({ id: code, code, name: code.replaceAll("_", " "), is_primary: code === u.primary_role }))
  }));
  const auditText = readJson<any[]>("audit/events.json", []);
  res.json({
    roles, departments: tableRows("kedco_departments"), regions: localRegions(), profiles, userRoles, staff,
    feeders: tableRows("kedco_feeders"), permissions: tableRows("kedco_permissions"), rolePermissions: tableRows("kedco_role_permissions"),
    audit: Array.isArray(auditText) ? auditText : [], authUsers: profiles.map(p => ({ id: p.id, email: p.email, created_at: null, confirmed_at: null, last_sign_in_at: null }))
  });
});

router.post("/users/:userId/roles", async (req, res, next) => {
  try {
    if (!adminAllowed(res.locals.kedcoUser)) return res.status(403).json({ error: "Administrator role required" });
    const roleIds = Array.isArray(req.body?.roleIds) ? req.body.roleIds.map(String) : [];
    const primaryRoleId = String(req.body?.primaryRoleId || roleIds[0] || "");
    const user = await setUserRoles(String(req.params.userId), roleIds, primaryRoleId, req.body.regionId === undefined ? undefined : req.body.regionId || null);
    res.json({ ok: true, user });
  } catch (error) { next(error); }
});

router.post("/users/:userId/assignments", async (req, res, next) => {
  try {
    if (!adminAllowed(res.locals.kedcoUser)) return res.status(403).json({ error: "Administrator role required" });
    const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
    const user = await setUserAssignments(String(req.params.userId), assignments);
    res.json({ ok: true, user });
  } catch (error) { next(error); }
});

router.post("/users/:userId/status", async (req, res, next) => {
  try {
    if (!adminAllowed(res.locals.kedcoUser)) return res.status(403).json({ error: "Administrator role required" });
    const actor = res.locals.kedcoUser;
    const targetId = String(req.params.userId);
    const active = Boolean(req.body?.isActive);
    if (actor?.id === targetId && !active) return res.status(409).json({ error: "You cannot deactivate your current local administrator session." });
    const user = await setUserActive(targetId, active);
    res.json({ ok: true, user });
  } catch (error) { next(error); }
});

router.all("/invitations", (_req, res) => res.status(409).json({
  error: "Email invitation delivery is intentionally disabled in Local Cloud mode. Use Manage-KEDCO-LocalUsers.ps1 so the administrator explicitly sets each local password."
}));

export default router;

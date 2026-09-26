import crypto from "node:crypto";
import { readJson, writeJson, appendAudit } from "./store.js";
import { findRegion } from "./regions.js";

export type LocalUser = {
  id: string;
  email: string;
  full_name: string;
  password_salt: string;
  password_hash: string;
  roles: string[];
  primary_role: string;
  region_id?: string | null;
  region_name?: string | null;
  assignments?: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type SessionRecord = {
  access_token: string;
  refresh_token: string;
  user_id: string;
  created_at: string;
  expires_at: number;
  refresh_expires_at: number;
};

const USERS_FILE = "system/users.json";
const SESSIONS_FILE = "system/sessions.json";

function normEmail(value: unknown) { return String(value ?? "").trim().toLowerCase(); }
function normRole(value: unknown) { return String(value ?? "").trim().toUpperCase(); }

function hashPassword(password: string, saltHex: string) {
  return crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64).toString("hex");
}

export function users(): LocalUser[] {
  const value = readJson<LocalUser[]>(USERS_FILE, []);
  return Array.isArray(value) ? value : [];
}

export async function createUser(args: { email: string; password: string; fullName?: string; roles?: string[]; primaryRole?: string }) {
  const email = normEmail(args.email);
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("A valid email address is required.");
  if (String(args.password || "").length < 8) throw new Error("Local password must contain at least 8 characters.");
  const current = users();
  if (current.some(user => user.email === email)) throw new Error("A local user with this email already exists.");
  const roleList = [...new Set((args.roles || [args.primaryRole || "SUPER_ADMIN"]).map(normRole).filter(Boolean))];
  const primary = normRole(args.primaryRole || roleList[0] || "SUPER_ADMIN");
  if (!roleList.includes(primary)) roleList.unshift(primary);
  const salt = crypto.randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  const user: LocalUser = {
    id: crypto.randomUUID(), email,
    full_name: String(args.fullName || email.split("@")[0]).trim(),
    password_salt: salt,
    password_hash: hashPassword(args.password, salt),
    roles: roleList,
    primary_role: primary,
    is_active: true,
    created_at: now,
    updated_at: now
  };
  current.push(user);
  await writeJson(USERS_FILE, current);
  appendAudit({ type: "LOCAL_USER_CREATED", user_id: user.id, email: user.email, roles: roleList });
  return publicUser(user);
}

export async function setPassword(emailValue: string, password: string) {
  if (password.length < 8) throw new Error("Password must contain at least 8 characters.");
  const email = normEmail(emailValue);
  const current = users();
  const index = current.findIndex(u => u.email === email);
  if (index < 0) throw new Error("Local user not found.");
  const salt = crypto.randomBytes(16).toString("hex");
  current[index] = { ...current[index], password_salt: salt, password_hash: hashPassword(password, salt), updated_at: new Date().toISOString() };
  await writeJson(USERS_FILE, current);
  appendAudit({ type: "LOCAL_PASSWORD_CHANGED", user_id: current[index].id, email });
}

export function verifyUser(emailValue: string, password: string) {
  const email = normEmail(emailValue);
  const user = users().find(u => u.email === email && u.is_active !== false);
  if (!user) return null;
  const actual = Buffer.from(hashPassword(password, user.password_salt), "hex");
  const expected = Buffer.from(user.password_hash, "hex");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  return user;
}

function publicUser(user: LocalUser) {
  return { id: user.id, email: user.email, full_name: user.full_name, roles: user.roles, primary_role: user.primary_role, assignments: Array.isArray(user.assignments) ? user.assignments : [], is_active: user.is_active, region_id: user.region_id || null, region_name: user.region_name || null };
}

function cleanSessions() {
  const now = Math.floor(Date.now() / 1000);
  return readJson<SessionRecord[]>(SESSIONS_FILE, []).filter(s => s.refresh_expires_at > now);
}

export async function createSession(user: LocalUser) {
  const now = Math.floor(Date.now() / 1000);
  const sessions = cleanSessions();
  const record: SessionRecord = {
    access_token: `kedco_local_${crypto.randomBytes(32).toString("hex")}`,
    refresh_token: `kedco_refresh_${crypto.randomBytes(40).toString("hex")}`,
    user_id: user.id,
    created_at: new Date().toISOString(),
    expires_at: now + 8 * 60 * 60,
    refresh_expires_at: now + 30 * 24 * 60 * 60
  };
  sessions.push(record);
  await writeJson(SESSIONS_FILE, sessions.slice(-500));
  appendAudit({ type: "LOCAL_LOGIN", user_id: user.id, email: user.email });
  return sessionPayload(record, user);
}

function sessionPayload(record: SessionRecord, user: LocalUser) {
  return {
    access_token: record.access_token,
    refresh_token: record.refresh_token,
    token_type: "bearer",
    expires_in: Math.max(0, record.expires_at - Math.floor(Date.now() / 1000)),
    expires_at: record.expires_at,
    user: {
      id: user.id,
      email: user.email,
      user_metadata: { full_name: user.full_name },
      app_metadata: { provider: "local", roles: user.roles, primary_role: user.primary_role, assignments: Array.isArray(user.assignments) ? user.assignments : [] }
    }
  };
}

export function userForAccessToken(token: string | null | undefined) {
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const record = cleanSessions().find(s => s.access_token === token && s.expires_at > now);
  if (!record) return null;
  const user = users().find(u => u.id === record.user_id && u.is_active !== false);
  return user || null;
}

export async function refreshSession(refreshToken: string) {
  const sessions = cleanSessions();
  const record = sessions.find(s => s.refresh_token === refreshToken);
  if (!record) return null;
  const user = users().find(u => u.id === record.user_id && u.is_active !== false);
  if (!user) return null;
  const now = Math.floor(Date.now() / 1000);
  record.access_token = `kedco_local_${crypto.randomBytes(32).toString("hex")}`;
  record.expires_at = now + 8 * 60 * 60;
  await writeJson(SESSIONS_FILE, sessions);
  return sessionPayload(record, user);
}

export async function revokeAccessToken(token: string) {
  const sessions = cleanSessions().filter(s => s.access_token !== token);
  await writeJson(SESSIONS_FILE, sessions);
}


export async function setUserRoles(userId: string, roleValues: string[], primaryRoleValue?: string, regionValue?: string | null) {
  const current = users();
  const index = current.findIndex(u => u.id === userId);
  if (index < 0) throw new Error("Local user not found.");
  const roles = [...new Set((roleValues || []).map(normRole).filter(Boolean))];
  if (!roles.length) throw new Error("At least one role is required.");
  const primary = normRole(primaryRoleValue || roles[0]);
  if (!roles.includes(primary)) throw new Error("Primary role must be one of the assigned roles.");
  const region = regionValue ? findRegion(regionValue) : null;
  if (regionValue && !region) throw new Error("Select a valid KEDCO region.");
  const assignment = regionValue === undefined ? {} : { region_id: region?.id || null, region_name: region?.name || null };
  current[index] = { ...current[index], ...assignment, roles, primary_role: primary, updated_at: new Date().toISOString() };
  await writeJson(USERS_FILE, current);
  appendAudit({ type: "LOCAL_USER_ROLES_CHANGED", user_id: userId, email: current[index].email, roles, primary_role: primary, region_id: current[index].region_id || null });
  return publicUser(current[index]);
}

export async function setUserAssignments(userId: string, assignmentValues: unknown[]) {
  const current = users();
  const index = current.findIndex(u => u.id === userId);
  if (index < 0) throw new Error("Local user not found.");
  const assignments = [...new Set((Array.isArray(assignmentValues) ? assignmentValues : [])
    .map(value => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 180))
    .filter(Boolean))].slice(0, 128);
  current[index] = { ...current[index], assignments, updated_at: new Date().toISOString() };
  await writeJson(USERS_FILE, current);
  appendAudit({ type: "LOCAL_USER_STATION_ASSIGNMENTS_CHANGED", user_id: userId, email: current[index].email, assignment_count: assignments.length });
  return publicUser(current[index]);
}

export async function setUserActive(userId: string, isActive: boolean) {
  const current = users();
  const index = current.findIndex(u => u.id === userId);
  if (index < 0) throw new Error("Local user not found.");
  current[index] = { ...current[index], is_active: Boolean(isActive), updated_at: new Date().toISOString() };
  await writeJson(USERS_FILE, current);
  appendAudit({ type: "LOCAL_USER_STATUS_CHANGED", user_id: userId, email: current[index].email, is_active: Boolean(isActive) });
  return publicUser(current[index]);
}

export function userCount() { return users().length; }
export { publicUser };

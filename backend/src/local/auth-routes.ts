import { Router } from "express";
import { createSession, createUser, refreshSession, revokeAccessToken, userCount, verifyUser, users, publicUser, setPassword } from "./auth-store.js";
import { bearerToken, requireLocalAuth } from "./middleware.js";

const router = Router();

router.get("/", (_req, res) => res.json({ ok: true, module: "Local Authentication", mode: "local" }));
router.get("/setup-status", (_req, res) => res.json({ ok: true, setup_required: userCount() === 0, users: userCount() }));

router.post("/setup", async (req, res, next) => {
  try {
    if (userCount() > 0) return res.status(409).json({ error: "Local KEDCO authentication is already initialized." });
    const user = await createUser({
      email: String(req.body?.email || ""),
      password: String(req.body?.password || ""),
      fullName: String(req.body?.full_name || "KEDCO Local Administrator"),
      roles: ["SUPER_ADMIN", "DEVELOPER"],
      primaryRole: "SUPER_ADMIN"
    });
    res.json({ ok: true, user });
  } catch (error) { next(error); }
});

router.post("/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (userCount() === 0) return res.status(503).json({ error: "Local KEDCO login is not initialized. Run Initialize-KEDCO-LocalAdmin.ps1 first." });
    const user = verifyUser(email, password);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    const session = await createSession(user);
    res.json({ user: session.user, role: user.primary_role, roles: user.roles, session });
  } catch (error) { next(error); }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const token = String(req.body?.refresh_token || "").trim();
    const session = await refreshSession(token);
    if (!session) return res.status(401).json({ error: "KEDCO local session expired. Please sign in again." });
    res.json({ user: session.user, session });
  } catch (error) { next(error); }
});

router.post("/logout", requireLocalAuth, async (req, res, next) => {
  try {
    await revokeAccessToken(bearerToken(req.headers.authorization));
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.post("/reset", (_req, res) => {
  res.status(501).json({ error: "Local password reset is administrator-controlled. Use Manage-KEDCO-LocalUsers.ps1." });
});

router.get("/me", requireLocalAuth, (_req, res) => {
  const user = res.locals.kedcoUser;
  res.json({ user: publicUser(user), role: user.primary_role, roles: user.roles });
});

router.get("/local-users", requireLocalAuth, (_req, res) => {
  const actor = res.locals.kedcoUser;
  if (!actor.roles?.some((r: string) => ["SUPER_ADMIN", "DEVELOPER"].includes(r))) return res.status(403).json({ error: "Administrator role required" });
  res.json({ users: users().map(publicUser) });
});

router.post("/local-users", requireLocalAuth, async (req, res, next) => {
  try {
    const actor = res.locals.kedcoUser;
    if (!actor.roles?.some((r: string) => ["SUPER_ADMIN", "DEVELOPER"].includes(r))) return res.status(403).json({ error: "Administrator role required" });
    const user = await createUser({
      email: String(req.body?.email || ""), password: String(req.body?.password || ""), fullName: String(req.body?.full_name || ""),
      roles: Array.isArray(req.body?.roles) ? req.body.roles : [String(req.body?.primary_role || "")], primaryRole: String(req.body?.primary_role || "")
    });
    res.json({ ok: true, user });
  } catch (error) { next(error); }
});

router.post("/local-users/password", requireLocalAuth, async (req, res, next) => {
  try {
    const actor = res.locals.kedcoUser;
    if (!actor.roles?.some((r: string) => ["SUPER_ADMIN", "DEVELOPER"].includes(r))) return res.status(403).json({ error: "Administrator role required" });
    await setPassword(String(req.body?.email || ""), String(req.body?.password || ""));
    res.json({ ok: true });
  } catch (error) { next(error); }
});

export default router;

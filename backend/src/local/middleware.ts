import type { Request, Response, NextFunction } from "express";
import { userForAccessToken } from "./auth-store.js";

export function bearerToken(value: string | undefined) {
  const match = String(value || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export function requireLocalAuth(req: Request, res: Response, next: NextFunction) {
  const token = bearerToken(req.headers.authorization);
  const user = userForAccessToken(token);
  if (!user) return res.status(401).json({ error: "Invalid or expired local KEDCO session" });
  res.locals.kedcoUser = user;
  res.locals.kedcoToken = token;
  next();
}

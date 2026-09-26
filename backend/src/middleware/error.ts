import type { Request, Response, NextFunction } from "express";
export function errorHandler(error: any, _req: Request, res: Response, _next: NextFunction) {
  console.error(error);
  const status = Number(error?.status || error?.statusCode || 500);
  res.status(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500).json({
    error: String(error?.message || "Internal server error")
  });
}

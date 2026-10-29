import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export type AuthRequest = Request & { userId?: number };

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const secret = process.env.JWT_SECRET;

  if (!token || !secret) {
    return res.status(401).json({ error: "Iniciá sesión para continuar." });
  }

  try {
    const payload = jwt.verify(token, secret) as { sub?: string };
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "La sesión no es válida." });
    }
    req.userId = userId;
    next();
  } catch {
    return res.status(401).json({ error: "La sesión venció o no es válida." });
  }
}

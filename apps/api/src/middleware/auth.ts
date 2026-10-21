import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@ytbot/db';
import { ApiError } from '../lib/http';

const ROLE_WEIGHT: Record<UserRole, number> = {
  VIEWER: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3
};

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.session.user) {
    next(new ApiError(401, 'Authentication required', 'AUTH_REQUIRED'));
    return;
  }
  next();
}

export function requireRole(minRole: UserRole) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.session.user) {
      next(new ApiError(401, 'Authentication required', 'AUTH_REQUIRED'));
      return;
    }

    if (ROLE_WEIGHT[req.session.user.role] < ROLE_WEIGHT[minRole]) {
      next(new ApiError(403, 'Insufficient permissions', 'FORBIDDEN'));
      return;
    }

    next();
  };
}

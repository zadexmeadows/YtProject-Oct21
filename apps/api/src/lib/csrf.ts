import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from './http';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function ensureCsrfToken(req: Request): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  if (req.path === '/auth/login') {
    next();
    return;
  }

  const provided = req.header('x-csrf-token');
  if (!req.session.csrfToken || !provided || provided !== req.session.csrfToken) {
    next(new ApiError(403, 'Invalid CSRF token', 'CSRF_INVALID'));
    return;
  }

  next();
}

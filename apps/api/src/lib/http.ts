import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodSchema } from 'zod';
import { logger } from './logger';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = 'API_ERROR',
  ) {
    super(message);
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

export function validateBody<T>(schema: ZodSchema<T>, value: unknown): T {
  return schema.parse(value);
}

export function validateQuery<T>(schema: ZodSchema<T>, value: unknown): T {
  return schema.parse(value);
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: error.flatten()
    });
  }

  if (error instanceof ApiError) {
    return res.status(error.statusCode).json({
      error: error.message,
      code: error.code
    });
  }

  logger.error({ err: error }, 'Unhandled API error');
  return res.status(500).json({
    error: 'Unexpected server error',
    code: 'INTERNAL_ERROR'
  });
}

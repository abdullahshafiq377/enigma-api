import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { ApiError } from '@/utils/ApiError';
import type { ApiFailure } from '@/utils/apiResponse';

/** Centralized error handler — MUST be registered last (4-arg signature). */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let statusCode = 500;
  let message = 'Internal Server Error';
  let details: unknown;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    statusCode = 400;
    message = 'Validation failed';
    details = err.flatten();
  } else if (err instanceof Error) {
    message = err.message;
  }

  if (statusCode >= 500) {
    logger.error({ err }, 'Unhandled error');
  }

  const body: ApiFailure = {
    data: null,
    error: {
      message,
      ...(details !== undefined ? { details } : {}),
      ...(env.isProduction || statusCode < 500
        ? {}
        : { details: err instanceof Error ? err.stack : undefined }),
    },
  };

  res.status(statusCode).json(body);
}

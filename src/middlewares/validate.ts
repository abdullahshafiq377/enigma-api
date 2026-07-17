import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

import { ApiError } from '@/utils/ApiError';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validate request `body`/`query`/`params` against Zod schemas.
 * - `body` is reassigned in place (writable in Express 5).
 * - `query`/`params` are read-only getters in Express 5, so their parsed
 *   results are attached to `req.validated` instead.
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.validated = {};

      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      if (schemas.query) {
        req.validated.query = schemas.query.parse(req.query);
      }
      if (schemas.params) {
        req.validated.params = schemas.params.parse(req.params);
      }

      next();
    } catch (err) {
      // ZodError is translated to a 400 by the centralized error handler.
      next(err instanceof Error ? err : ApiError.badRequest('Validation failed'));
    }
  };
}

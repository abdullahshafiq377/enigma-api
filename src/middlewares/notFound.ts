import type { NextFunction, Request, Response } from 'express';

import { ApiError } from '@/utils/ApiError';

/** Converts unmatched routes into a 404 ApiError forwarded to the error handler. */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

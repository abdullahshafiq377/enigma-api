import type { NextFunction, Request, Response } from 'express';

/**
 * NoSQL-injection guard. `express-mongo-sanitize` is incompatible with Express 5
 * (it reassigns the now read-only `req.query`), so we sanitize in place instead:
 * recursively strip keys starting with `$` or containing `.` from `req.body`
 * and `req.params`. Query parameters are guarded by Zod schemas at the route
 * level (a string schema rejects an injected object like `{ $gt: '' }`).
 */
function stripDangerousKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) stripDangerousKeys(item);
    return;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete (value as Record<string, unknown>)[key];
      } else {
        stripDangerousKeys((value as Record<string, unknown>)[key]);
      }
    }
  }
}

export function mongoSanitize(req: Request, _res: Response, next: NextFunction): void {
  if (req.body) stripDangerousKeys(req.body);
  if (req.params) stripDangerousKeys(req.params);
  next();
}

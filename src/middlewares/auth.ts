import { getAuth } from '@clerk/express';
import type { NextFunction, Request, Response } from 'express';

import { userRepository } from '@/modules/user/user.repository';
import type { AuthUser } from '@/types/express';
import { ApiError } from '@/utils/ApiError';

type Tier = AuthUser['tier'];
type Role = AuthUser['role'];

/**
 * Requires a valid Clerk session and attaches `req.user` with `tier`/`role`.
 * Prefers the session-token custom claims (zero DB cost). If those claims
 * aren't configured in Clerk, it falls back to the Mongo user mirror so
 * authorization still works without the session-customization step.
 *
 * Requires `clerkMiddleware()` to have run (mounted in app.ts when Clerk keys
 * are configured).
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = getAuth(req);
    if (!auth.userId) {
      next(ApiError.unauthorized());
      return;
    }

    const claims = (auth.sessionClaims ?? {}) as { tier?: Tier; role?: Role };
    let tier = claims.tier;
    let role = claims.role;

    // Claims not configured → fall back to the mirror (the source of truth).
    if (!tier || !role) {
      const user = await userRepository.findByClerkId(auth.userId);
      tier = tier ?? user?.tier ?? 'insight';
      role = role ?? user?.role ?? 'member';
    }

    req.user = { clerkId: auth.userId, tier, role };
    next();
  } catch (err) {
    next(err instanceof Error ? err : ApiError.unauthorized());
  }
}

/** Authorize by role (e.g. admin-only routes). Use after `requireAuth`. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(ApiError.forbidden('Insufficient role'));
      return;
    }
    next();
  };
}

/** Authorize by membership tier. Use after `requireAuth`. */
export function requireTier(...tiers: Tier[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }
    if (!tiers.includes(req.user.tier)) {
      next(ApiError.forbidden('Insufficient tier'));
      return;
    }
    next();
  };
}

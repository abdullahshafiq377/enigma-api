import 'express';

/** The authenticated principal attached by the Clerk auth middleware (wired in a later phase). */
export interface AuthUser {
  clerkId: string;
  tier: 'insight' | 'mastery' | 'sovereign';
  role: 'member' | 'admin';
}

declare global {
  namespace Express {
    interface Request {
      /** Populated by `requireAuth`; undefined on public routes. */
      user?: AuthUser;
      /**
       * Parsed/validated query & params from the `validate` middleware.
       * (Express 5 makes `req.query`/`req.params` read-only, so validated
       * values live here; `req.body` is reassigned in place.)
       */
      validated?: {
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

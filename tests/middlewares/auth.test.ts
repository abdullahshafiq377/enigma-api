import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { requireRole } from '@/middlewares/auth';
import type { Role } from '@/modules/user/user.types';

/** Invoke requireRole(...allowed) with a fake authed request; return the next() spy. */
function invoke(role: Role | undefined, allowed: Role[]) {
  const next = vi.fn();
  const req = {
    user: role ? { clerkId: 'c', tier: 'insight', role } : undefined,
  } as unknown as Request;
  requireRole(...allowed)(req, {} as Response, next as unknown as NextFunction);
  return next;
}

describe('requireRole', () => {
  it('lets a matching role pass', () => {
    expect(invoke('admin', ['admin']).mock.calls[0]).toEqual([]);
  });

  it('lets a member into a member-gated route', () => {
    expect(invoke('member', ['member', 'admin']).mock.calls[0]).toEqual([]);
  });

  it('blocks a non-matching role with 403', () => {
    expect(invoke('member', ['admin']).mock.calls[0]?.[0]).toMatchObject({ statusCode: 403 });
  });

  it('401s when unauthenticated', () => {
    expect(invoke(undefined, ['admin']).mock.calls[0]?.[0]).toMatchObject({ statusCode: 401 });
  });
});

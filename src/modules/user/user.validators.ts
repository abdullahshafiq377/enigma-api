import { z } from 'zod';

import { ROLES, TIERS } from '@/modules/user/user.types';

/** Query params for listing users (search + cursor pagination). */
export const listUsersQuerySchema = z.object({
  search: z.string().trim().optional(),
  tier: z.enum(TIERS).optional(),
  role: z.enum(ROLES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

/** Route params carrying a Mongo ObjectId. */
export const userIdParamSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'),
});

export type UserIdParam = z.infer<typeof userIdParamSchema>;

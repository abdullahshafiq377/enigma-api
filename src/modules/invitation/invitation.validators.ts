import { z } from 'zod';

import { TIERS } from '@/modules/user/user.types';

/** Admin creates a single invitation. `tier` is required-with-a-default (Insight). */
export const createInvitationSchema = z.object({
  email: z.string().email(),
  fullName: z.string().trim().min(1).optional(),
  company: z.string().trim().min(1).optional(),
  tier: z.enum(TIERS).default('insight'),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

/** Bulk invite — an array of the same rows. The CSV layer will map onto this later. */
export const bulkInvitationSchema = z.object({
  invitations: z.array(createInvitationSchema).min(1).max(500),
});
export type BulkInvitationInput = z.infer<typeof bulkInvitationSchema>;

/** Public accept-page check: resolve an `/invitation/<token>` link to its row. */
export const checkTokenSchema = z.object({
  token: z.string().min(1),
});
export type CheckTokenQuery = z.infer<typeof checkTokenSchema>;

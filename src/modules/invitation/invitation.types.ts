import type { Types } from 'mongoose';

import type { Tier } from '@/modules/user/user.types';

/** Lifecycle of an admin-created invitation. `joined` is set once the person signs up. */
export const INVITE_STATUSES = ['invited', 'joined'] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

/**
 * A person an admin has added for invitation. This is a SEPARATE collection from
 * `users` — it holds the admin's intent (who to invite + at what tier), not an
 * auth account. The `users` mirror is still created only by the Clerk webhook.
 *
 * `token` is our opaque, unguessable link key (`/invitation/<token>`) used to fetch
 * prefill data + status. `clerkTicket` is Clerk's invitation ticket (the actual
 * tamper-proof, pre-verified-email credential the sign-up consumes).
 */
export interface IInvitation {
  email: string;
  fullName?: string | undefined; // admin-provided → locked on the link; else user fills
  company?: string | undefined; // admin-provided → locked on the link; else user fills
  tier: Tier; // admin-set; source of truth for the member's tier
  invitedByAdmin: Types.ObjectId;
  status: InviteStatus;
  token: string; // our opaque link key
  clerkInvitationId?: string | undefined; // Clerk invite handle (revoke/resend)
  clerkTicket?: string | undefined; // Clerk ticket the sign-up consumes
  invitedAt?: Date | undefined;
  joinedAt?: Date | undefined;
}

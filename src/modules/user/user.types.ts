export const TIERS = ['insight', 'mastery', 'sovereign'] as const;
export type Tier = (typeof TIERS)[number];

export const ROLES = ['member', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** Did the person finish Clerk signup yet? */
export const REGISTRATION_STATUSES = ['pending', 'completed'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** Invite lifecycle / origin: invited (pending) → registration_completed; none = self-signup. */
export const INVITATION_STATUSES = ['invited', 'registration_completed', 'none'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/**
 * Raw user document shape. Usually the MongoDB mirror of a Clerk user, but a row
 * can also exist BEFORE signup (a pending invitation): such rows have no `clerkId`
 * yet, `registrationStatus: 'pending'`, and `invitationStatus: 'invited'`.
 */
export interface IUser {
  clerkId?: string | undefined; // unset until signup completes (invited rows have none)
  email: string;
  firstName?: string | undefined;
  lastName?: string | undefined;
  company?: string | undefined;
  jobTitle?: string | undefined;
  tier: Tier;
  role: Role;
  registrationStatus: RegistrationStatus;
  invitationStatus: InvitationStatus;
  invitedAt?: Date | undefined;
  acceptedAt?: Date | undefined;
  clerkInvitationId?: string | undefined;
  resendCount: number;
  lastActiveAt?: Date | undefined;
}

/** Shape returned to clients (no internal-only fields today, but isolates the contract). */
export interface UserDTO extends IUser {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

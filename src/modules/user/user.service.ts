import type { FilterQuery, Types } from 'mongoose';

import { invitationRepository } from '@/modules/invitation/invitation.repository';
import { Role as RoleModel } from '@/modules/role/role.model';
import { Tier as TierModel } from '@/modules/tier/tier.model';
import { type UserDoc } from '@/modules/user/user.model';
import { userRepository } from '@/modules/user/user.repository';
import type { IUser, Role, Tier, UserDTO } from '@/modules/user/user.types';
import type { ListUsersQuery } from '@/modules/user/user.validators';
import { ApiError } from '@/utils/ApiError';

function toDTO(doc: UserDoc): UserDTO {
  return {
    id: doc.id,
    clerkId: doc.clerkId,
    email: doc.email,
    firstName: doc.firstName,
    lastName: doc.lastName,
    company: doc.company,
    jobTitle: doc.jobTitle,
    tier: doc.tier,
    role: doc.role,
    registrationStatus: doc.registrationStatus,
    invitationStatus: doc.invitationStatus,
    joinedByInvite: doc.joinedByInvite,
    invitedAt: doc.invitedAt,
    acceptedAt: doc.acceptedAt,
    clerkInvitationId: doc.clerkInvitationId,
    resendCount: doc.resendCount,
    lastActiveAt: doc.lastActiveAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export interface PaginatedUsers {
  items: UserDTO[];
  nextCursor: string | null;
}

/** Subset of the Clerk webhook `data` payload we map into our mirror. */
export interface ClerkUserData {
  id: string;
  email_addresses?: Array<{ email_address: string; id: string }>;
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  public_metadata?: { tier?: string; role?: string } | undefined;
  // Sign-up collects these and passes them via Clerk unsafeMetadata; the client
  // promotes them to publicMetadata (or they arrive here) so the mirror persists them.
  unsafe_metadata?: { company?: string; jobTitle?: string } | undefined;
}

function primaryEmail(data: ClerkUserData): string {
  const list = data.email_addresses ?? [];
  const primary = list.find((e) => e.id === data.primary_email_address_id) ?? list[0];
  return primary?.email_address ?? '';
}

/** Resolve the Role/Tier row id for an enum (undefined if the tables aren't seeded yet). */
async function roleIdFor(value: Role): Promise<Types.ObjectId | undefined> {
  const doc = await RoleModel.findOne({ enum: value }).select('_id');
  return doc?._id;
}
async function tierIdFor(value: Tier): Promise<Types.ObjectId | undefined> {
  const doc = await TierModel.findOne({ enum: value }).select('_id');
  return doc?._id;
}

/** Business logic / use-cases for users. Orchestrates the repository; no DB queries here. */
export const userService = {
  async getById(id: string): Promise<UserDTO> {
    const user = await userRepository.findById(id);
    if (!user) throw ApiError.notFound('User not found');
    return toDTO(user);
  },

  async getByClerkId(clerkId: string): Promise<UserDTO> {
    const user = await userRepository.findByClerkId(clerkId);
    if (!user) throw ApiError.notFound('User not synced yet');
    return toDTO(user);
  },

  async list(query: ListUsersQuery): Promise<PaginatedUsers> {
    const filter: FilterQuery<IUser> = {};
    if (query.tier) filter.tier = query.tier;
    if (query.role) filter.role = query.role;
    if (query.search) {
      const rx = new RegExp(query.search, 'i');
      filter.$or = [{ email: rx }, { firstName: rx }, { lastName: rx }, { company: rx }, { jobTitle: rx }];
    }

    const docs = await userRepository.findMany({
      filter,
      cursor: query.cursor,
      limit: query.limit,
    });

    const hasMore = docs.length > query.limit;
    const page = hasMore ? docs.slice(0, query.limit) : docs;
    const last = page.at(-1);

    return {
      items: page.map(toDTO),
      nextCursor: hasMore && last ? last.id : null,
    };
  },

  /**
   * Reconcile the Mongo mirror from a Clerk `user.created`/`user.updated` payload.
   * User-row resolution (order matters):
   *  1. Already mirrored by clerkId → update in place (idempotent, handles retries).
   *  2. A legacy pending placeholder row for this email (no clerkId) → complete it.
   *  3. Otherwise a fresh signup → create it.
   *
   * Independently, the table-backed `invitations` collection (matched by email) is
   * the source of truth for an invited person's TIER, and is flipped
   * `invited → joined` here. This runs whether they used the invite link OR signed
   * up normally with an invited email.
   */
  async syncFromClerk(data: ClerkUserData): Promise<UserDTO> {
    const role = data.public_metadata?.role;
    const email = primaryEmail(data);
    const validRole = role === 'member' || role === 'admin' ? role : undefined;
    const roleId = validRole ? await roleIdFor(validRole) : undefined;
    const company = data.unsafe_metadata?.company?.trim() || undefined;
    const jobTitle = data.unsafe_metadata?.jobTitle?.trim() || undefined;

    // Admin's invitation (new table) wins for tier; else Clerk metadata; else default.
    const invitation = email ? await invitationRepository.findByEmail(email) : null;
    const metaTier = data.public_metadata?.tier;
    const validMetaTier =
      metaTier === 'insight' || metaTier === 'mastery' || metaTier === 'sovereign'
        ? metaTier
        : undefined;
    const resolvedTier = invitation?.tier ?? validMetaTier;
    const tierId = resolvedTier ? await tierIdFor(resolvedTier) : undefined;

    const profile: Partial<IUser> = {
      email,
      firstName: data.first_name ?? undefined,
      lastName: data.last_name ?? undefined,
      ...(company ? { company } : {}),
      ...(jobTitle ? { jobTitle } : {}),
      ...(resolvedTier ? { tier: resolvedTier } : {}),
      ...(validRole ? { role: validRole } : {}),
      ...(tierId ? { tierId } : {}),
      ...(roleId ? { roleId } : {}),
    };

    let user: UserDoc;
    const byClerk = await userRepository.findByClerkId(data.id);
    if (byClerk) {
      // 1. Existing mirror (normal update / webhook retry).
      Object.assign(byClerk, profile);
      await byClerk.save();
      user = byClerk;
    } else {
      const placeholder = email ? await userRepository.findByEmail(email) : null;
      if (placeholder && !placeholder.clerkId) {
        // 2. Legacy pending placeholder row (old Clerk-invitation flow) → complete it.
        Object.assign(placeholder, profile, {
          clerkId: data.id,
          registrationStatus: 'completed',
          invitationStatus: 'registration_completed',
          joinedByInvite: true,
          acceptedAt: new Date(),
        });
        await placeholder.save();
        user = placeholder;
      } else {
        // 3. Fresh signup — self-serve OR a table-backed invite (no users placeholder).
        user = await userRepository.upsertByClerkId(data.id, {
          clerkId: data.id,
          ...profile,
          registrationStatus: 'completed',
          invitationStatus: invitation ? 'registration_completed' : 'none',
          joinedByInvite: Boolean(invitation),
          ...(invitation ? { acceptedAt: new Date() } : {}),
        });
      }
    }

    // Flip the table-backed invitation to joined (idempotent across webhook retries).
    if (invitation && invitation.status === 'invited') {
      invitation.status = 'joined';
      invitation.joinedAt = new Date();
      await invitation.save();
    }

    return toDTO(user);
  },

  async removeByClerkId(clerkId: string): Promise<void> {
    await userRepository.deleteByClerkId(clerkId);
  },
};

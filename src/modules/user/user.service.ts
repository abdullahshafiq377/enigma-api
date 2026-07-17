import type { FilterQuery } from 'mongoose';

import { type UserDoc } from '@/modules/user/user.model';
import { userRepository } from '@/modules/user/user.repository';
import type { IUser, UserDTO } from '@/modules/user/user.types';
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
  unsafe_metadata?: { company?: string; jobTitle?: string } | undefined;
}

function primaryEmail(data: ClerkUserData): string {
  const list = data.email_addresses ?? [];
  const primary = list.find((e) => e.id === data.primary_email_address_id) ?? list[0];
  return primary?.email_address ?? '';
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
      filter.$or = [{ email: rx }, { firstName: rx }, { lastName: rx }, { company: rx }];
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
   * Order matters:
   *  1. Already mirrored by clerkId → update in place (idempotent, handles `user.updated`).
   *  2. A pending invitation exists for this email (no clerkId yet) → complete it
   *     (invited → registration_completed), attaching the new clerkId.
   *  3. Otherwise a fresh self-signup → create with invitationStatus 'none'.
   */
  async syncFromClerk(data: ClerkUserData): Promise<UserDTO> {
    const tier = data.public_metadata?.tier;
    const role = data.public_metadata?.role;
    const email = primaryEmail(data);
    const profile: Partial<IUser> = {
      email,
      firstName: data.first_name ?? undefined,
      lastName: data.last_name ?? undefined,
      company: data.unsafe_metadata?.company ?? undefined,
      jobTitle: data.unsafe_metadata?.jobTitle ?? undefined,
      ...(tier === 'insight' || tier === 'mastery' || tier === 'sovereign' ? { tier } : {}),
      ...(role === 'member' || role === 'admin' ? { role } : {}),
    };

    // 1. Existing mirror (normal update / webhook retry).
    const byClerk = await userRepository.findByClerkId(data.id);
    if (byClerk) {
      Object.assign(byClerk, profile);
      await byClerk.save();
      return toDTO(byClerk);
    }

    // 2. Pending invitation for this email → complete it.
    const invited = email ? await userRepository.findByEmail(email) : null;
    if (invited && !invited.clerkId) {
      Object.assign(invited, profile, {
        clerkId: data.id,
        registrationStatus: 'completed',
        invitationStatus: 'registration_completed',
        acceptedAt: new Date(),
      });
      await invited.save();
      return toDTO(invited);
    }

    // 3. Fresh self-signup.
    const doc = await userRepository.upsertByClerkId(data.id, {
      clerkId: data.id,
      ...profile,
      registrationStatus: 'completed',
      invitationStatus: 'none',
    });
    return toDTO(doc);
  },

  async removeByClerkId(clerkId: string): Promise<void> {
    await userRepository.deleteByClerkId(clerkId);
  },
};

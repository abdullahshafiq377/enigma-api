import { type FilterQuery, Types } from 'mongoose';

import { User, type UserDoc } from '@/modules/user/user.model';
import type { IUser } from '@/modules/user/user.types';

export interface FindManyOptions {
  filter: FilterQuery<IUser>;
  cursor?: string | undefined;
  limit: number;
}

/** Owns all MongoDB access for users. No business logic, no HTTP. */
export const userRepository = {
  findById(id: string): Promise<UserDoc | null> {
    return User.findById(id).exec() as Promise<UserDoc | null>;
  },

  findByClerkId(clerkId: string): Promise<UserDoc | null> {
    return User.findOne({ clerkId }).exec() as Promise<UserDoc | null>;
  },

  findByEmail(email: string): Promise<UserDoc | null> {
    return User.findOne({ email: email.toLowerCase().trim() }).exec() as Promise<UserDoc | null>;
  },

  /**
   * Batch lookup by email — ONE index-backed `$in` query for a whole CSV, instead
   * of N round-trips. Emails are normalized to match the stored (lowercased) form.
   */
  findByEmails(emails: string[]): Promise<UserDoc[]> {
    const normalized = [...new Set(emails.map((e) => e.toLowerCase().trim()).filter(Boolean))];
    if (normalized.length === 0) return Promise.resolve([]);
    return User.find({ email: { $in: normalized } }).exec() as Promise<UserDoc[]>;
  },

  /** Cursor (keyset) pagination on `_id`; returns one extra doc to compute `hasMore`. */
  async findMany({ filter, cursor, limit }: FindManyOptions): Promise<UserDoc[]> {
    const query: FilterQuery<IUser> = { ...filter };
    if (cursor && Types.ObjectId.isValid(cursor)) {
      query._id = { $lt: new Types.ObjectId(cursor) };
    }
    return User.find(query)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .exec() as Promise<UserDoc[]>;
  },

  /** Insert-or-update the mirror keyed on clerkId (idempotent — safe for webhook retries). */
  upsertByClerkId(clerkId: string, data: Partial<IUser>): Promise<UserDoc> {
    return User.findOneAndUpdate(
      { clerkId },
      { $set: data },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec() as Promise<UserDoc>;
  },

  /** Update a mirror row by `_id` — used for members with no clerkId yet. */
  updateById(id: string, data: Partial<IUser>): Promise<UserDoc | null> {
    return User.findByIdAndUpdate(id, { $set: data }, { new: true }).exec() as Promise<UserDoc | null>;
  },

  async deleteByClerkId(clerkId: string): Promise<void> {
    await User.deleteOne({ clerkId }).exec();
  },
};

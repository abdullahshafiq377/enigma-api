import { clerkClient } from '@clerk/express';
import type { FilterQuery } from 'mongoose';

import { parseCsv, toCsv } from '@/modules/admin/csv';
import { Role as RoleModel } from '@/modules/role/role.model';
import { Tier as TierModel } from '@/modules/tier/tier.model';
import { User } from '@/modules/user/user.model';
import { userRepository } from '@/modules/user/user.repository';
import type { InvitationStatus, IUser, RegistrationStatus } from '@/modules/user/user.types';
import { type Role, type Tier, TIERS } from '@/modules/user/user.types';
import { ApiError } from '@/utils/ApiError';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIVE_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type UserStatus = 'active' | 'inactive' | 'invited' | 'missing_data';
export type LastActiveFilter = 'any' | '7d' | '30d' | '90d';

function isTier(value: string): value is Tier {
  return (TIERS as readonly string[]).includes(value);
}

/** Origin filter (maps directly to the stored `invitationStatus`). */
export type OriginFilter = InvitationStatus;

/**
 * Lifecycle/activity badge shown in the table:
 *  - pending registration → `invited`
 *  - registered → `active`/`inactive` by recent activity
 */
export function deriveStatus(
  tier: Tier | undefined,
  registrationStatus: RegistrationStatus,
  lastActiveAt: Date | undefined,
  now: number,
): UserStatus {
  if (!tier) return 'missing_data';
  if (registrationStatus === 'pending') return 'invited';
  if (!lastActiveAt) return 'inactive'; // registered but no activity yet
  return now - lastActiveAt.getTime() <= ACTIVE_WINDOW_DAYS * DAY_MS ? 'active' : 'inactive';
}

export interface AdminUserDTO {
  id: string;
  email: string;
  firstName?: string | undefined;
  lastName?: string | undefined;
  tier: Tier;
  role: Role;
  registrationStatus: RegistrationStatus;
  invitationStatus: InvitationStatus;
  lastActiveAt?: string | undefined;
  status: UserStatus;
}

export interface AdminUserListQuery {
  search?: string | undefined;
  tier?: Tier | undefined;
  status?: UserStatus | undefined;
  origin?: OriginFilter | undefined;
  lastActive?: LastActiveFilter | undefined;
  cursor?: string | undefined;
  limit: number;
}

/** Build the Mongo filter shared by list + export (search, tier, status, last-active). */
function buildFilter(
  query: Omit<AdminUserListQuery, 'cursor' | 'limit'>,
  now: number,
): FilterQuery<IUser> {
  const filter: FilterQuery<IUser> = {};
  if (query.tier) filter.tier = query.tier;
  if (query.search) {
    const rx = new RegExp(query.search, 'i');
    filter.$or = [{ email: rx }, { firstName: rx }, { lastName: rx }];
  }
  if (query.origin) filter.invitationStatus = query.origin;
  if (query.lastActive && query.lastActive !== 'any') {
    const days = query.lastActive === '7d' ? 7 : query.lastActive === '30d' ? 30 : 90;
    filter.lastActiveAt = { $gte: new Date(now - days * DAY_MS) };
  }
  const cutoff7 = new Date(now - ACTIVE_WINDOW_DAYS * DAY_MS);
  if (query.status === 'active') filter.lastActiveAt = { $gte: cutoff7 };
  else if (query.status === 'inactive') filter.lastActiveAt = { $lt: cutoff7 };
  else if (query.status === 'invited') filter.registrationStatus = 'pending';
  return filter;
}

async function setTier(clerkId: string, tier: Tier): Promise<void> {
  await clerkClient.users.updateUserMetadata(clerkId, { publicMetadata: { tier } });
  const doc = await TierModel.findOne({ enum: tier }).select('_id');
  await userRepository.upsertByClerkId(clerkId, { tier, ...(doc ? { tierId: doc._id } : {}) });
}

async function setRole(clerkId: string, role: Role): Promise<void> {
  await clerkClient.users.updateUserMetadata(clerkId, { publicMetadata: { role } });
  const doc = await RoleModel.findOne({ enum: role }).select('_id');
  await userRepository.upsertByClerkId(clerkId, { role, ...(doc ? { roleId: doc._id } : {}) });
}

export interface BulkResult {
  updated: number;
  skipped: string[];
  errors: string[];
}

export interface CsvPreviewRow {
  email: string;
  newTier: Tier | null;
  currentTier?: Tier;
  status: 'ok' | 'unchanged' | 'not_found' | 'invalid' | 'duplicate';
  /** True when the row omitted a tier and the import default was applied. */
  usedDefault?: boolean;
  reason?: string;
}

export const adminUsersService = {
  async list(query: AdminUserListQuery, now: number = Date.now()) {
    const filter = buildFilter(query, now);
    const docs = await userRepository.findMany({
      filter,
      cursor: query.cursor,
      limit: query.limit,
    });
    const hasMore = docs.length > query.limit;
    const page = hasMore ? docs.slice(0, query.limit) : docs;
    const last = page.at(-1);

    const items: AdminUserDTO[] = page.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      tier: u.tier,
      role: u.role,
      registrationStatus: u.registrationStatus,
      invitationStatus: u.invitationStatus,
      lastActiveAt: u.lastActiveAt?.toISOString(),
      status: deriveStatus(u.tier, u.registrationStatus, u.lastActiveAt, now),
    }));
    return { items, nextCursor: hasMore && last ? last.id : null };
  },

  async stats(now: number = Date.now()) {
    const [total, tierRows, recentlyActive] = await Promise.all([
      User.countDocuments(),
      User.aggregate([{ $group: { _id: '$tier', count: { $sum: 1 } } }]) as Promise<
        Array<{ _id: Tier; count: number }>
      >,
      User.countDocuments({ lastActiveAt: { $gte: new Date(now - ACTIVE_WINDOW_DAYS * DAY_MS) } }),
    ]);
    const byTier = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
    for (const r of tierRows) if (r._id in byTier) byTier[r._id] = r.count;
    return { total, byTier, recentlyActive };
  },

  async updateTier(userId: string, tier: Tier): Promise<{ id: string; tier: Tier }> {
    const user = await userRepository.findById(userId);
    if (!user) throw ApiError.notFound('User not found');
    if (!user.clerkId) {
      throw ApiError.badRequest('Cannot change tier: this member has not completed signup yet.');
    }
    await setTier(user.clerkId, tier);
    return { id: user.id, tier };
  },

  /**
   * Assign a role. Writes Clerk publicMetadata.role (JWT source of truth) + the
   * Mongo mirror (role enum + roleId). Behind the admin gate.
   */
  async updateRole(userId: string, role: Role): Promise<{ id: string; role: Role }> {
    const user = await userRepository.findById(userId);
    if (!user) throw ApiError.notFound('User not found');
    if (!user.clerkId) {
      throw ApiError.badRequest('Cannot change role: this member has not completed signup yet.');
    }
    await setRole(user.clerkId, role);
    return { id: user.id, role };
  },

  /** Dry-run: validate a CSV and report per-row outcome WITHOUT applying. */
  async validateCsv(csvText: string, defaultTier: Tier): Promise<{ rows: CsvPreviewRow[] }> {
    const parsed = parseCsv(csvText);
    const rows: CsvPreviewRow[] = [];
    const seen = new Set<string>();
    for (const row of parsed) {
      const email = (row.email ?? '').toLowerCase().trim();
      if (!email) continue;
      const rawTier = row.tier?.trim();
      const usedDefault = !rawTier;
      // Tier values are case-insensitive ("Mastery" === "mastery").
      const normalized = rawTier?.toLowerCase();
      const tier: Tier | null = normalized ? (isTier(normalized) ? normalized : null) : defaultTier;

      if (seen.has(email)) {
        rows.push({ email, newTier: tier, status: 'duplicate', reason: 'Duplicate row in file' });
        continue;
      }
      seen.add(email);

      if (!EMAIL_RE.test(email)) {
        rows.push({ email, newTier: tier, status: 'invalid', reason: 'Invalid email' });
        continue;
      }
      if (tier === null) {
        rows.push({ email, newTier: null, status: 'invalid', reason: `Invalid tier "${rawTier}"` });
        continue;
      }
      const user = await User.findOne({ email }).exec();
      if (!user) {
        rows.push({
          email,
          newTier: tier,
          status: 'not_found',
          reason: 'No member with this email',
        });
      } else if (user.tier === tier) {
        rows.push({ email, newTier: tier, currentTier: user.tier, status: 'unchanged' });
      } else {
        rows.push({
          email,
          newTier: tier,
          currentTier: user.tier,
          status: 'ok',
          ...(usedDefault ? { usedDefault: true } : {}),
        });
      }
    }
    return { rows };
  },

  async bulkAssignFromCsv(csvText: string, defaultTier: Tier): Promise<BulkResult> {
    const { rows } = await this.validateCsv(csvText, defaultTier);
    const result: BulkResult = { updated: 0, skipped: [], errors: [] };
    for (const row of rows) {
      if (row.status === 'invalid') {
        result.errors.push(row.email);
      } else if (row.status === 'not_found' || row.status === 'duplicate') {
        result.skipped.push(row.email);
      } else if (row.status === 'ok' && row.newTier) {
        const user = await User.findOne({ email: row.email }).exec();
        if (user?.clerkId) {
          await setTier(user.clerkId, row.newTier);
          result.updated += 1;
        } else {
          // Invited-but-not-signed-up: no Clerk account to update yet.
          result.skipped.push(row.email);
        }
      }
    }
    return result;
  },

  /** Export the filtered member list as CSV (respects the same filters as the table). */
  async exportCsv(
    query: Omit<AdminUserListQuery, 'cursor' | 'limit'>,
    now: number = Date.now(),
  ): Promise<string> {
    const filter = buildFilter(query, now);
    const users = await User.find(filter).sort({ createdAt: -1 }).exec();
    const rows = users.map((u) => ({
      email: u.email,
      firstName: u.firstName ?? '',
      lastName: u.lastName ?? '',
      tier: u.tier,
      role: u.role,
      status: deriveStatus(u.tier, u.registrationStatus, u.lastActiveAt, now),
      invitationStatus: u.invitationStatus,
      lastActiveAt: u.lastActiveAt?.toISOString() ?? '',
    }));
    return toCsv(rows, [
      'email',
      'firstName',
      'lastName',
      'tier',
      'role',
      'status',
      'invitationStatus',
      'lastActiveAt',
    ]);
  },
};

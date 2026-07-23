import type { FilterQuery } from 'mongoose';

import { connectDatabase, disconnectDatabase } from '@/config/db';
import { logger } from '@/config/logger';
import { Role } from '@/modules/role/role.model';
import { Tier } from '@/modules/tier/tier.model';
import { User } from '@/modules/user/user.model';
import type { IUser } from '@/modules/user/user.types';
import { ROLES, TIERS } from '@/modules/user/user.types';

/**
 * Seed the Role/Tier reference collections, then backfill `roleId`/`tierId` on
 * existing users from their cached `role`/`tier` enum strings. Idempotent —
 * safe to re-run (titles are refreshed, ids re-pointed).
 *
 * Usage: npm run seed-rbac
 */

const ROLE_TITLES: Record<(typeof ROLES)[number], string> = {
  member: 'Member',
  admin: 'Admin',
};

const TIER_TITLES: Record<(typeof TIERS)[number], string> = {
  insight: 'Insight',
  mastery: 'Mastery',
  sovereign: 'Sovereign',
};

async function run(): Promise<void> {
  await connectDatabase();

  // 1. Upsert the reference rows (title kept current on re-run).
  for (const value of ROLES) {
    await Role.findOneAndUpdate(
      { enum: value },
      { $set: { title: ROLE_TITLES[value] } },
      { upsert: true },
    );
  }
  for (const value of TIERS) {
    await Tier.findOneAndUpdate(
      { enum: value },
      { $set: { title: TIER_TITLES[value] } },
      { upsert: true },
    );
  }
  logger.info(`Seeded ${ROLES.length} roles, ${TIERS.length} tiers.`);

  // 1b. Retire the removed `superadmin` role: demote any leftover superadmin
  //     users to `admin` (admin is now the top role), then drop the stale row.
  //     Idempotent — a no-op once the DB no longer has any superadmin.
  // `superadmin` is no longer a valid Role, so cast the legacy filter.
  const legacyRoleFilter = { role: 'superadmin' } as unknown as FilterQuery<IUser>;
  const demoted = await User.updateMany(legacyRoleFilter, { $set: { role: 'admin' } });
  if (demoted.modifiedCount)
    logger.warn(`Demoted ${demoted.modifiedCount} superadmin user(s) → admin.`);
  const dropped = await Role.deleteOne({ enum: 'superadmin' });
  if (dropped.deletedCount) logger.warn('Removed the stale "superadmin" Role row.');

  // 2. Backfill roleId/tierId on existing users from their enum strings.
  let roleBackfilled = 0;
  for (const value of ROLES) {
    const doc = await Role.findOne({ enum: value });
    if (!doc) continue;
    const res = await User.updateMany({ role: value }, { $set: { roleId: doc._id } });
    roleBackfilled += res.modifiedCount;
  }
  let tierBackfilled = 0;
  for (const value of TIERS) {
    const doc = await Tier.findOne({ enum: value });
    if (!doc) continue;
    const res = await User.updateMany({ tier: value }, { $set: { tierId: doc._id } });
    tierBackfilled += res.modifiedCount;
  }
  logger.info(
    `Backfilled roleId on ${roleBackfilled} user(s), tierId on ${tierBackfilled} user(s).`,
  );

  await disconnectDatabase();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'seed-rbac failed');
    process.exit(1);
  });

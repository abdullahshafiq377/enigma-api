import { connectDatabase, disconnectDatabase } from '@/config/db';
import { logger } from '@/config/logger';
import { Invitation } from '@/modules/invitation/invitation.model';
import { User } from '@/modules/user/user.model';

/**
 * Reconcile MongoDB indexes with the current Mongoose schemas.
 *
 * Needed because Mongoose `autoIndex` only *creates missing* indexes — it never
 * alters one whose options changed. When `clerkId` went from `required+unique`
 * to `unique+sparse` (so invited rows can have no clerkId) and `email` went to
 * `unique`, the OLD indexes lingered. `syncIndexes()` drops the stale ones and
 * builds the correct (sparse / unique) versions.
 *
 * Usage: `npm run sync-indexes`
 * NOTE: building the unique `email` index fails if duplicate emails exist —
 * de-duplicate first if it errors.
 */
async function main(): Promise<void> {
  await connectDatabase();
  const userDropped = await User.syncIndexes();
  logger.info({ dropped: userDropped }, 'User indexes synced');
  const inviteDropped = await Invitation.syncIndexes();
  logger.info({ dropped: inviteDropped }, 'Invitation indexes synced');
  await disconnectDatabase();
}

main().catch((err) => {
  logger.error({ err }, 'sync-indexes failed');
  process.exit(1);
});

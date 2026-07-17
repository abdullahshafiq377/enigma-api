import { clerkClient } from '@clerk/express';

import { connectDatabase, disconnectDatabase } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { User } from '@/modules/user/user.model';
import { userRepository } from '@/modules/user/user.repository';

/**
 * Promote a user to admin (role=admin, tier=sovereign) in Clerk publicMetadata
 * (source of truth) + the Mongo mirror.
 *
 * Clerk-authoritative: resolves the CURRENT clerkId from Clerk by email, so it
 * works even if the Mongo mirror is stale (e.g. webhook was down). Also cleans
 * up any stale mirror duplicates for that email.
 *
 * Usage: npm run make-admin -- <email>
 */
const email = process.argv[2]?.toLowerCase();

async function run(): Promise<void> {
  if (!email) {
    logger.error('Usage: npm run make-admin -- <email>');
    process.exit(1);
  }
  if (!env.CLERK_SECRET_KEY) {
    logger.error('CLERK_SECRET_KEY is required. Set it in .env first.');
    process.exit(1);
  }

  await connectDatabase();

  const list = await clerkClient.users.getUserList({ emailAddress: [email] });
  const cu = list.data[0];
  if (!cu) {
    logger.error(`No Clerk user with email "${email}". Sign up with this email first.`);
    await disconnectDatabase();
    process.exit(1);
  }
  const clerkId = cu.id;

  await clerkClient.users.updateUserMetadata(clerkId, {
    publicMetadata: { role: 'admin', tier: 'sovereign' },
  });
  logger.info(`Clerk: ${email} (${clerkId}) → role=admin, tier=sovereign`);

  // Reconcile the mirror: drop stale duplicates for this email, upsert the current one.
  const stale = await User.deleteMany({ email, clerkId: { $ne: clerkId } });
  if (stale.deletedCount)
    logger.warn(`Removed ${stale.deletedCount} stale mirror record(s) for ${email}`);

  await userRepository.upsertByClerkId(clerkId, {
    clerkId,
    email,
    firstName: cu.firstName ?? undefined,
    lastName: cu.lastName ?? undefined,
    role: 'admin',
    tier: 'sovereign',
  });
  logger.info(`Mongo mirror reconciled: ${email} → role=admin, tier=sovereign`);
  logger.info('Done. Log in at http://localhost:3000/admin/login');

  await disconnectDatabase();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'make-admin failed');
    process.exit(1);
  });

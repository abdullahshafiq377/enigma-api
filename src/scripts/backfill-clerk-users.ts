import { clerkClient } from '@clerk/express';

import { connectDatabase, disconnectDatabase } from '@/config/db';
import { logger } from '@/config/logger';
import { type ClerkUserData, userService } from '@/modules/user/user.service';

/**
 * Reconcile the Mongo `users` mirror from Clerk (the auth source of truth). Fixes
 * drift when the `user.created` webhook didn't reach the backend (e.g. the dev
 * tunnel was down at signup). Idempotent — runs the SAME `syncFromClerk` the
 * webhook uses, so existing rows update in place and missing ones are created.
 *
 * Usage: npx tsx src/scripts/backfill-clerk-users.ts
 */
async function run(): Promise<void> {
  await connectDatabase();

  const { data, totalCount } = await clerkClient.users.getUserList({ limit: 100 });
  logger.info(`Clerk reports ${totalCount} users; syncing ${data.length}…`);

  for (const u of data) {
    const payload: ClerkUserData = {
      id: u.id,
      first_name: u.firstName,
      last_name: u.lastName,
      email_addresses: u.emailAddresses.map((e) => ({ id: e.id, email_address: e.emailAddress })),
      primary_email_address_id: u.primaryEmailAddressId,
      public_metadata: u.publicMetadata as { tier?: string; role?: string },
      unsafe_metadata: u.unsafeMetadata as { company?: string; jobTitle?: string },
    };
    const dto = await userService.syncFromClerk(payload);
    console.log(`✓ ${dto.email}  | tier=${dto.tier} role=${dto.role} reg=${dto.registrationStatus}`);
  }

  if (totalCount > data.length) {
    logger.warn(`Only synced the first ${data.length} of ${totalCount}. Re-run with pagination if needed.`);
  }
  await disconnectDatabase();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'backfill-clerk-users failed');
    process.exit(1);
  });

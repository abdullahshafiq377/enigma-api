import { clerkClient } from '@clerk/express';

import { connectDatabase, disconnectDatabase } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { userRepository } from '@/modules/user/user.repository';

/**
 * Seed a ready-to-use admin: creates a Clerk user (with password) flagged
 * role=admin, then mirrors it into Mongo so the admin login works immediately
 * (no dependency on the webhook).
 *
 * Idempotent in both directions — re-running an existing account re-promotes it
 * AND resets its password, so a bad one can be repaired by running the command
 * again.
 *
 * The password is NOT exempted from Clerk's rules. `skipPasswordChecks` used to
 * be set here, which let anything through: a shell that does not expand `$PW`
 * once left an admin account whose password was literally those three
 * characters. Clerk rejects a weak or breached password now, loudly, at the
 * point it is set.
 *
 * Usage: npm run seed-admin -- [email] [password]
 * Defaults: admin@enigmauniversity.com / Enigma!Admin2026
 */
const email = (process.argv[2] ?? 'admin@enigmauniversity.com').toLowerCase();
const password = process.argv[3] ?? 'Enigma!Admin2026';

async function run(): Promise<void> {
  if (!env.CLERK_SECRET_KEY) {
    logger.error('CLERK_SECRET_KEY is required to create a Clerk user. Set it in .env first.');
    process.exit(1);
  }

  await connectDatabase();

  let clerkId: string;
  try {
    const created = await clerkClient.users.createUser({
      emailAddress: [email],
      password,
      firstName: 'Admin',
      lastName: 'User',
      publicMetadata: { role: 'admin', tier: 'sovereign' },
    });
    clerkId = created.id;
    logger.info(`Created Clerk user: ${email}`);
  } catch (err) {
    logger.warn(
      { err: JSON.stringify((err as { errors?: unknown }).errors ?? err) },
      'createUser failed',
    );
    const list = await clerkClient.users.getUserList({ emailAddress: [email] });
    const existing = list.data[0];
    if (!existing) {
      logger.error(`Could not create or find a Clerk user for ${email}.`);
      await disconnectDatabase();
      process.exit(1);
    }
    clerkId = existing.id;
    await clerkClient.users.updateUserMetadata(clerkId, {
      publicMetadata: { role: 'admin', tier: 'sovereign' },
    });
    // The password too, not just the metadata. Without this a re-run could not
    // repair a bad one — which is exactly what a shell that does not expand
    // `$PW` leaves behind — and the docstring's "idempotent" was only half true.
    await clerkClient.users.updateUser(clerkId, { password });
    logger.info(`Clerk user ${email} already existed — promoted to admin, password reset.`);
  }

  // Backend-created emails are unverified, which blocks password sign-in.
  // Mark the primary email verified so the admin can sign in immediately.
  try {
    const fresh = await clerkClient.users.getUser(clerkId);
    const primaryId = fresh.primaryEmailAddressId ?? fresh.emailAddresses[0]?.id;
    if (primaryId) {
      await clerkClient.emailAddresses.updateEmailAddress(primaryId, { verified: true });
      logger.info('Marked admin email as verified.');
    }
  } catch (err) {
    logger.warn({ err }, 'Could not verify email (you may need to verify it in the dashboard)');
  }

  await userRepository.upsertByClerkId(clerkId, {
    clerkId,
    email,
    firstName: 'Admin',
    lastName: 'User',
    role: 'admin',
    tier: 'sovereign',
  });
  logger.info('Mongo mirror upserted (role=admin, tier=sovereign).');

  logger.info('──────────────────────────────────────────');
  logger.info(`  ADMIN READY`);
  logger.info(`  email:    ${email}`);
  logger.info(`  password: ${password}`);
  logger.info(`  login:    http://localhost:5001/sign-in`);
  logger.info('──────────────────────────────────────────');

  await disconnectDatabase();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'seed-admin failed');
    process.exit(1);
  });

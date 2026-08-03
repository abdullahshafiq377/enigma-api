import { connectDatabase, disconnectDatabase } from '@/config/db';
import { Invitation } from '@/modules/invitation/invitation.model';
import { User } from '@/modules/user/user.model';

/** Ad-hoc lookup: find an email across the users + invitations collections.
 *  Usage: npx tsx src/scripts/find-user.ts <email> */
async function run(): Promise<void> {
  const email = (process.argv[2] ?? '').toLowerCase().trim();
  if (!email) {
    console.error('Pass an email: npx tsx src/scripts/find-user.ts you@example.com');
    process.exit(1);
  }

  await connectDatabase();

  const user = await User.findOne({ email }).lean();
  console.log(`\n=== users collection — ${email} ===`);
  if (user) {
    console.log({
      id: String(user._id),
      email: user.email,
      clerkId: user.clerkId ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      company: user.company ?? null,
      tier: user.tier,
      role: user.role,
      registrationStatus: user.registrationStatus,
      invitationStatus: user.invitationStatus,
      invitedAt: user.invitedAt ?? null,
      acceptedAt: user.acceptedAt ?? null,
      createdAt: (user as { createdAt?: Date }).createdAt ?? null,
    });
  } else {
    console.log('(no user row)');
  }

  const inv = await Invitation.findOne({ email }).lean();
  console.log(`\n=== invitations collection — ${email} ===`);
  if (inv) {
    console.log({
      id: String(inv._id),
      email: inv.email,
      fullName: inv.fullName ?? null,
      company: inv.company ?? null,
      tier: inv.tier,
      status: inv.status,
      invitedAt: inv.invitedAt ?? null,
      joinedAt: inv.joinedAt ?? null,
      clerkInvitationId: inv.clerkInvitationId ?? null,
    });
  } else {
    console.log('(no invitation row)');
  }

  await disconnectDatabase();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('find-user failed:', err);
    process.exit(1);
  });

import { clerkClient } from '@clerk/express';

import { env } from '@/config/env';

/** Diagnostic: what does Clerk's createInvitation return for notify=false vs true?
 *  We need `url` (it carries ?__clerk_ticket=…). Usage: npx tsx src/scripts/check-clerk-invite.ts */
async function run(): Promise<void> {
  for (const notify of [false, true] as const) {
    const email = `probe-${notify}-${Math.floor(Math.random() * 1e6)}@example.com`;
    try {
      const inv = await clerkClient.invitations.createInvitation({
        emailAddress: email,
        publicMetadata: { tier: 'insight' },
        redirectUrl: `${env.APP_BASE_URL}/invitation`,
        notify,
        ignoreExisting: true,
      });
      const u = inv.url ? new URL(inv.url) : null;
      const ticket = u?.searchParams.get('ticket') ?? u?.searchParams.get('__clerk_ticket') ?? null;
      console.log(`\nnotify=${notify}`);
      console.log('  id:     ', inv.id);
      console.log('  status: ', inv.status);
      console.log('  url:    ', inv.url ?? '(none)');
      console.log('  ticket: ', ticket ? `${ticket.slice(0, 24)}…` : '(none)');
      console.log('  keys:   ', Object.keys(inv).join(', '));
      await clerkClient.invitations.revokeInvitation(inv.id).catch(() => undefined);
    } catch (err) {
      console.log(`\nnotify=${notify} → threw:`, (err as { message?: string }).message);
    }
  }
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

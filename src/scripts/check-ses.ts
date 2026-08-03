import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

import { env } from '@/config/env';

/**
 * Diagnostic: send one test email via SES and print exactly why it failed if it
 * doesn't work. Usage:
 *   npm run check-ses -- recipient@example.com
 * (defaults the recipient to EMAIL_FROM). In the sandbox, BOTH the from-identity
 * and the recipient must be verified in SES.
 */
async function main(): Promise<void> {
  const to = process.argv[2] ?? env.EMAIL_FROM;

  console.log('— Amazon SES send check —');
  if (!env.AWS_REGION) return fail('AWS_REGION is not set in .env');
  if (!env.EMAIL_FROM) return fail('EMAIL_FROM is not set in .env');
  if (!to) return fail('No recipient. Pass one: npm run check-ses -- you@example.com');

  console.log(`Region: ${env.AWS_REGION}`);
  console.log(`From:   ${env.EMAIL_FROM}`);
  console.log(`To:     ${to}`);
  console.log('Sending…\n');

  const client = new SESv2Client({ region: env.AWS_REGION });
  try {
    const out = await client.send(
      new SendEmailCommand({
        FromEmailAddress: env.EMAIL_FROM,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: 'Enigma — SES test', Charset: 'UTF-8' },
            Body: { Text: { Data: 'If you can read this, SES sending works ✅', Charset: 'UTF-8' } },
          },
        },
      }),
    );
    console.log(`✓ Sent. MessageId: ${out.MessageId}`);
    console.log('Check the inbox (and spam) for the test message.');
    process.exit(0);
  } catch (err) {
    const e = err as { name?: string; message?: string };
    console.error(`✗ Failed: ${e.name ?? 'Error'} — ${e.message ?? ''}`);
    const hint = `${e.name ?? ''} ${e.message ?? ''}`.toLowerCase();
    if (hint.includes('not verified')) {
      console.error('→ Sandbox: both the FROM identity and the RECIPIENT must be verified in SES.');
      console.error('  Verify the recipient (SES → Identities), or send to an already-verified address.');
    } else if (
      hint.includes('accessdenied') ||
      hint.includes('not authorized') ||
      hint.includes('security token')
    ) {
      console.error('→ Credentials/permissions: the IAM user needs ses:SendEmail and valid, active keys.');
    } else if (hint.includes('subscription')) {
      console.error('→ Account not activated for this service (same blocker as Transcribe). Activate the account.');
    } else if (hint.includes('region')) {
      console.error('→ Region mismatch: AWS_REGION must match where SES was verified (you are in us-east-1).');
    }
    process.exit(1);
  }
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

void main();

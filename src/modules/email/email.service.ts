import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import type { Tier } from '@/modules/user/user.types';

/**
 * Transactional email via AWS SES (v2). Best-effort: a send failure never throws
 * to the caller — invites/links still exist, so email is a delivery convenience,
 * not a dependency. No-op until EMAIL_FROM + AWS_REGION are configured.
 */

let client: SESv2Client | undefined;
function sesClient(region: string): SESv2Client {
  client ??= new SESv2Client({ region });
  return client;
}

const TIER_LABEL: Record<Tier, string> = {
  insight: 'Insight',
  mastery: 'Mastery',
  sovereign: 'Sovereign',
};

interface InvitationEmailParams {
  to: string;
  link: string;
  tier: Tier;
  fullName?: string | undefined;
}

function renderInvitation({ link, tier, fullName }: InvitationEmailParams): {
  subject: string;
  html: string;
  text: string;
} {
  const greeting = fullName?.trim() ? `Hi ${fullName.trim()},` : 'Hi,';
  const tierLabel = TIER_LABEL[tier];
  const subject = 'Your invitation to Enigma University';
  const text = [
    greeting,
    '',
    `You've been invited to join Enigma University at the ${tierLabel} tier.`,
    '',
    'Accept your invitation and set a password:',
    link,
    '',
    "If you weren't expecting this, you can ignore this email.",
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#090909;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#090909;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141414;border-radius:12px;padding:32px;">
          <tr><td style="font-size:20px;font-weight:700;padding-bottom:8px;">Enigma University</td></tr>
          <tr><td style="font-size:15px;line-height:1.5;color:#e5e5e5;padding:12px 0;">${greeting}</td></tr>
          <tr><td style="font-size:15px;line-height:1.5;color:#e5e5e5;padding-bottom:20px;">
            You've been invited to join <strong>Enigma University</strong> at the <strong>${tierLabel}</strong> tier. Accept your invitation and set a password to get started.
          </td></tr>
          <tr><td align="center" style="padding:8px 0 24px;">
            <a href="${link}" style="display:inline-block;background:#d11c1c;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 28px;border-radius:8px;">Accept invitation</a>
          </td></tr>
          <tr><td style="font-size:12px;line-height:1.5;color:#8a8a8a;">
            Or paste this link into your browser:<br />
            <a href="${link}" style="color:#d11c1c;word-break:break-all;">${link}</a>
          </td></tr>
          <tr><td style="font-size:12px;color:#6a6a6a;padding-top:24px;">If you weren't expecting this, you can ignore this email.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

export const emailService = {
  /** Send an invitation email. Returns whether it was actually sent. Never throws. */
  async sendInvitationEmail(params: InvitationEmailParams): Promise<{ sent: boolean }> {
    if (!env.EMAIL_FROM || !env.AWS_REGION) {
      logger.debug({ to: params.to }, 'Invite email skipped (EMAIL_FROM/AWS_REGION not set)');
      return { sent: false };
    }
    const { subject, html, text } = renderInvitation(params);
    try {
      await sesClient(env.AWS_REGION).send(
        new SendEmailCommand({
          FromEmailAddress: env.EMAIL_FROM,
          Destination: { ToAddresses: [params.to] },
          ...(env.EMAIL_REPLY_TO ? { ReplyToAddresses: [env.EMAIL_REPLY_TO] } : {}),
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: {
                Html: { Data: html, Charset: 'UTF-8' },
                Text: { Data: text, Charset: 'UTF-8' },
              },
            },
          },
        }),
      );
      return { sent: true };
    } catch (err) {
      logger.warn({ err, to: params.to }, 'Invite email send failed');
      return { sent: false };
    }
  },
};

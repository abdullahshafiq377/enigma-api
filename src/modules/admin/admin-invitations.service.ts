import { clerkClient } from '@clerk/express';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { parseCsv } from '@/modules/admin/csv';
import { User } from '@/modules/user/user.model';
import { userRepository } from '@/modules/user/user.repository';
import { type Tier, TIERS } from '@/modules/user/user.types';
import { ApiError } from '@/utils/ApiError';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACCEPT_PATH = '/accept-invitation';

function isTier(value: string): value is Tier {
  return (TIERS as readonly string[]).includes(value);
}

export type InvitePreviewStatus = 'invite' | 'resend' | 'already_member' | 'invalid' | 'duplicate';

export interface InvitePreviewRow {
  email: string;
  tier: Tier | null;
  status: InvitePreviewStatus;
  usedDefault?: boolean;
  reason?: string;
}

export interface InviteResult {
  invited: string[];
  resent: string[];
  skipped: string[]; // already members
  errors: string[]; // invalid / duplicate / send failures
}

/** Create a Clerk invitation (Clerk emails it) carrying the tier in publicMetadata. */
async function createClerkInvitation(email: string, tier: Tier): Promise<string> {
  const inv = await clerkClient.invitations.createInvitation({
    emailAddress: email,
    publicMetadata: { tier },
    redirectUrl: `${env.APP_BASE_URL}${ACCEPT_PATH}`,
    notify: true,
    ignoreExisting: true,
  });
  // Clerk emails this link (notify: true). Logged in dev so you can also copy it
  // directly to test the accept flow without waiting on email delivery.
  if (!env.isProduction) logger.info({ email, inviteUrl: inv.url }, 'Clerk invitation created');
  return inv.id;
}

async function revokeQuietly(invitationId: string | undefined): Promise<void> {
  if (!invitationId) return;
  await clerkClient.invitations.revokeInvitation(invitationId).catch(() => undefined);
}

export const adminInvitationsService = {
  /**
   * Dry-run: classify each CSV row for the invitation flow WITHOUT sending.
   *  - already a completed member → skip
   *  - pending invitation exists → re-send
   *  - otherwise → invite (new)
   */
  async validateCsv(csvText: string, defaultTier: Tier): Promise<{ rows: InvitePreviewRow[] }> {
    const parsed = parseCsv(csvText);
    const seen = new Set<string>();

    // Pass 1: format-validate + dedupe in memory (no DB). Collect emails to look up.
    type Prelim = {
      email: string;
      tier: Tier | null;
      usedDefault: boolean;
      row?: InvitePreviewRow;
    };
    const prelim: Prelim[] = [];
    const toLookup: string[] = [];
    for (const row of parsed) {
      const email = (row.email ?? '').toLowerCase().trim();
      if (!email) continue;
      const rawTier = row.tier?.trim();
      const usedDefault = !rawTier;
      const normalized = rawTier?.toLowerCase();
      const tier: Tier | null = normalized ? (isTier(normalized) ? normalized : null) : defaultTier;

      if (seen.has(email)) {
        prelim.push({
          email,
          tier,
          usedDefault,
          row: { email, tier, status: 'duplicate', reason: 'Duplicate row in file' },
        });
        continue;
      }
      seen.add(email);

      if (!EMAIL_RE.test(email)) {
        prelim.push({
          email,
          tier,
          usedDefault,
          row: { email, tier, status: 'invalid', reason: 'Invalid email' },
        });
        continue;
      }
      if (tier === null) {
        prelim.push({
          email,
          tier: null,
          usedDefault,
          row: { email, tier: null, status: 'invalid', reason: `Invalid tier "${rawTier}"` },
        });
        continue;
      }
      prelim.push({ email, tier, usedDefault });
      toLookup.push(email);
    }

    // ONE index-backed query for the whole file (vs one query per row).
    const existing = await userRepository.findByEmails(toLookup);
    const byEmail = new Map(existing.map((u) => [u.email, u]));

    // Pass 2: classify against the in-memory map.
    const rows: InvitePreviewRow[] = prelim.map((p) => {
      if (p.row) return p.row;
      const dflt = p.usedDefault ? { usedDefault: true } : {};
      const user = byEmail.get(p.email);
      if (user && user.registrationStatus === 'completed') {
        return {
          email: p.email,
          tier: p.tier,
          status: 'already_member',
          reason: 'Already a member',
        };
      }
      if (user && user.invitationStatus === 'invited') {
        return {
          email: p.email,
          tier: p.tier,
          status: 'resend',
          reason: 'Invitation already pending',
          ...dflt,
        };
      }
      return { email: p.email, tier: p.tier, status: 'invite', ...dflt };
    });
    return { rows };
  },

  /** Send invitations: create for new emails, re-send for pending, skip members. */
  async sendFromCsv(csvText: string, defaultTier: Tier): Promise<InviteResult> {
    const { rows } = await this.validateCsv(csvText, defaultTier);
    const result: InviteResult = { invited: [], resent: [], skipped: [], errors: [] };

    // Pre-fetch the pending rows to re-send in ONE query (Clerk calls stay per-row).
    const resendUsers = await userRepository.findByEmails(
      rows.filter((r) => r.status === 'resend').map((r) => r.email),
    );
    const byEmail = new Map(resendUsers.map((u) => [u.email, u]));

    for (const row of rows) {
      if (row.status === 'invalid' || row.status === 'duplicate' || !row.tier) {
        result.errors.push(row.email);
        continue;
      }
      if (row.status === 'already_member') {
        result.skipped.push(row.email);
        continue;
      }
      try {
        if (row.status === 'resend') {
          const user = byEmail.get(row.email);
          if (!user) {
            result.errors.push(row.email);
            continue;
          }
          await revokeQuietly(user.clerkInvitationId);
          user.clerkInvitationId = await createClerkInvitation(row.email, row.tier);
          user.tier = row.tier;
          user.invitedAt = new Date();
          user.resendCount += 1;
          await user.save();
          result.resent.push(row.email);
        } else {
          const clerkInvitationId = await createClerkInvitation(row.email, row.tier);
          try {
            await User.create({
              email: row.email,
              tier: row.tier,
              registrationStatus: 'pending',
              invitationStatus: 'invited',
              invitedAt: new Date(),
              clerkInvitationId,
            });
          } catch (e) {
            // Roll back the Clerk invitation so we don't orphan it without a local row.
            await revokeQuietly(clerkInvitationId);
            throw e;
          }
          result.invited.push(row.email);
        }
      } catch (err) {
        // Genuine Clerk send failure (e.g. rejected redirect URL, rate limit, config).
        logger.warn({ err, email: row.email, action: row.status }, 'Invitation send failed');
        result.errors.push(row.email);
      }
    }
    return result;
  },

  /** Re-send a single pending invitation by user id. */
  async resendOne(userId: string): Promise<{ id: string }> {
    const user = await userRepository.findById(userId);
    if (!user) throw ApiError.notFound('User not found');
    if (user.registrationStatus !== 'pending' || user.invitationStatus !== 'invited') {
      throw ApiError.badRequest('This user has no pending invitation.');
    }
    await revokeQuietly(user.clerkInvitationId);
    user.clerkInvitationId = await createClerkInvitation(user.email, user.tier);
    user.invitedAt = new Date();
    user.resendCount += 1;
    await user.save();
    return { id: user.id };
  },

  /** Revoke a pending invitation and remove the placeholder row. */
  async revokeOne(userId: string): Promise<{ id: string }> {
    const user = await userRepository.findById(userId);
    if (!user) throw ApiError.notFound('User not found');
    if (user.registrationStatus !== 'pending') {
      throw ApiError.badRequest('Cannot revoke: this user has completed registration.');
    }
    await revokeQuietly(user.clerkInvitationId);
    await User.deleteOne({ _id: user.id }).exec();
    return { id: user.id };
  },
};

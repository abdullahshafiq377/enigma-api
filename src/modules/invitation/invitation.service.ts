import { randomBytes } from 'node:crypto';

import { clerkClient } from '@clerk/express';
import { Types } from 'mongoose';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { emailService } from '@/modules/email/email.service';
import { invitationRepository } from '@/modules/invitation/invitation.repository';
import { userRepository } from '@/modules/user/user.repository';
import type { Tier } from '@/modules/user/user.types';
import { ApiError } from '@/utils/ApiError';

/** Frontend accept page base; the full link is `${APP_BASE_URL}/invitation/<token>`. */
const ACCEPT_PATH = '/invitation';

export interface CreateInvitationParams {
  email: string;
  fullName?: string | undefined;
  company?: string | undefined;
  tier: Tier;
  invitedByAdminId: string;
}

/** Per-row result — reused by both the single and bulk endpoints. */
export type InviteOutcome = 'invited' | 'resent' | 'skipped' | 'error';
export interface InviteRowResult {
  email: string;
  outcome: InviteOutcome;
  link?: string | undefined; // present when invited/resent
  reason?: string | undefined; // present when skipped/error
}

export interface BulkInviteResult {
  results: InviteRowResult[];
  summary: { total: number; invited: number; resent: number; skipped: number; error: number };
}

/** What the public accept page needs to render (prefill + lock + "already joined"). */
export interface InvitationCheck {
  status: 'invited' | 'joined';
  email: string;
  fullName?: string | undefined;
  company?: string | undefined;
  tier?: Tier | undefined;
  /** Clerk ticket the headless sign-up consumes. Only for `invited`. */
  ticket?: string | undefined;
}

/** Unguessable, URL-safe link key (32 chars). Distinct from Clerk's ticket. */
function newToken(): string {
  return randomBytes(24).toString('base64url');
}

/** Create a Clerk invitation and pull its ticket out of the returned URL. */
async function createClerkInvite(email: string, tier: Tier): Promise<{ id: string; ticket: string }> {
  const inv = await clerkClient.invitations.createInvitation({
    emailAddress: email,
    publicMetadata: { tier }, // fallback only — the invitations table is the tier source of truth
    redirectUrl: `${env.APP_BASE_URL}${ACCEPT_PATH}`,
    notify: false, // Option A: we own delivery. Clerk does NOT email; we return the link.
    ignoreExisting: true,
  });
  // Clerk's invitation `url` carries the ticket in the `ticket` param (its own
  // accept endpoint); `__clerk_ticket` is only used when it later redirects to us.
  const url = inv.url ? new URL(inv.url) : null;
  const ticket = url?.searchParams.get('ticket') ?? url?.searchParams.get('__clerk_ticket') ?? null;
  if (!ticket) throw ApiError.internal('Clerk did not return an invitation ticket.');
  return { id: inv.id, ticket };
}

async function revokeQuietly(invitationId: string | undefined): Promise<void> {
  if (!invitationId) return;
  await clerkClient.invitations.revokeInvitation(invitationId).catch(() => undefined);
}

/**
 * Create (or re-create) one invitation. NEVER throws — returns a classified row
 * result so a bad row can't fail a whole bulk batch. The single endpoint turns a
 * non-success outcome into an HTTP error itself.
 */
async function inviteOne(params: CreateInvitationParams): Promise<InviteRowResult> {
  const email = params.email.toLowerCase().trim();
  try {
    // Already a full member → nothing to invite.
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser && existingUser.registrationStatus === 'completed') {
      return { email, outcome: 'skipped', reason: 'Already a member' };
    }

    const existing = await invitationRepository.findByEmail(email);
    if (existing?.status === 'joined') {
      return { email, outcome: 'skipped', reason: 'Already joined with their invitation' };
    }

    // Re-invite: drop the previous Clerk invite before minting a fresh one.
    await revokeQuietly(existing?.clerkInvitationId);

    const { id: clerkInvitationId, ticket } = await createClerkInvite(email, params.tier);
    const token = existing?.token ?? newToken(); // keep the link stable across re-invites

    const doc = await invitationRepository.upsertByEmail(email, {
      email,
      fullName: params.fullName?.trim() || undefined,
      company: params.company?.trim() || undefined,
      tier: params.tier,
      invitedByAdmin: new Types.ObjectId(params.invitedByAdminId),
      status: 'invited',
      token,
      clerkInvitationId,
      clerkTicket: ticket,
      invitedAt: new Date(),
    });

    const link = `${env.APP_BASE_URL}${ACCEPT_PATH}/${token}`;
    if (!env.isProduction) logger.info({ email, link }, 'Invitation created');
    // Best-effort SES send (no-op until EMAIL_FROM is set) — never fails the invite.
    await emailService.sendInvitationEmail({
      to: doc.email,
      link,
      tier: params.tier,
      fullName: params.fullName,
    });
    return { email: doc.email, outcome: existing ? 'resent' : 'invited', link };
  } catch (err) {
    logger.warn({ err, email }, 'Invitation create failed');
    return { email, outcome: 'error', reason: 'Failed to create invitation' };
  }
}

export const invitationService = {
  /** One non-throwing invite — used by the unified bulk-access CSV flow. */
  inviteRow(params: CreateInvitationParams): Promise<InviteRowResult> {
    return inviteOne(params);
  },

  /** Single invite (admin). Turns skip/error outcomes into HTTP errors. */
  async create(params: CreateInvitationParams): Promise<InviteRowResult> {
    const result = await inviteOne(params);
    if (result.outcome === 'skipped') throw ApiError.badRequest(result.reason ?? 'Cannot invite.');
    if (result.outcome === 'error') {
      throw ApiError.internal(result.reason ?? 'Failed to create invitation.');
    }
    return result;
  },

  /**
   * Bulk invite. Dedupes within the batch, then runs each row through the same
   * primitive as the single endpoint. Sequential so we don't hammer Clerk's API.
   * This is what the CSV layer will call later.
   */
  async createMany(
    items: Omit<CreateInvitationParams, 'invitedByAdminId'>[],
    invitedByAdminId: string,
  ): Promise<BulkInviteResult> {
    const seen = new Set<string>();
    const results: InviteRowResult[] = [];

    for (const item of items) {
      const email = item.email.toLowerCase().trim();
      if (seen.has(email)) {
        results.push({ email, outcome: 'skipped', reason: 'Duplicate in list' });
        continue;
      }
      seen.add(email);
      results.push(await inviteOne({ ...item, invitedByAdminId }));
    }

    const summary = {
      total: results.length,
      invited: results.filter((r) => r.outcome === 'invited').length,
      resent: results.filter((r) => r.outcome === 'resent').length,
      skipped: results.filter((r) => r.outcome === 'skipped').length,
      error: results.filter((r) => r.outcome === 'error').length,
    };
    return { results, summary };
  },

  /**
   * Resolve an `/invitation/<token>` link for the public accept page. Returns the
   * prefill fields + the Clerk ticket when still open, or `joined` when used.
   */
  async checkByToken(token: string): Promise<InvitationCheck> {
    const inv = await invitationRepository.findByToken(token);
    if (!inv) throw ApiError.notFound('This invitation link is invalid or has expired.');
    if (inv.status === 'joined') {
      return { status: 'joined', email: inv.email };
    }
    return {
      status: 'invited',
      email: inv.email,
      fullName: inv.fullName,
      company: inv.company,
      tier: inv.tier,
      ticket: inv.clerkTicket,
    };
  },
};

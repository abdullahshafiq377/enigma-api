import { clerkClient } from '@clerk/express';
import type { Request, Response } from 'express';
import { Webhook } from 'svix';

import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { type ClerkUserData, userService } from '@/modules/user/user.service';
import { ApiError } from '@/utils/ApiError';
import { sendSuccess } from '@/utils/apiResponse';
import { asyncHandler } from '@/utils/asyncHandler';

/**
 * Scope requirement: new sign-ups are silently placed on the free "insight"
 * tier. We set it in Clerk publicMetadata (the source of truth + JWT claim) so
 * middleware can route by tier. Best-effort — never fail the webhook on this.
 */
async function ensureDefaultTier(data: ClerkUserData): Promise<void> {
  if (data.public_metadata?.tier) return;
  try {
    await clerkClient.users.updateUserMetadata(data.id, {
      publicMetadata: { tier: 'insight', role: data.public_metadata?.role ?? 'member' },
    });
  } catch (err) {
    logger.error({ err, clerkId: data.id }, 'Failed to set default tier for new user');
  }
}

interface ClerkWebhookEvent {
  type: 'user.created' | 'user.updated' | 'user.deleted' | string;
  data: ClerkUserData & { deleted?: boolean };
}

/**
 * Clerk → MongoDB user-mirror sync. Verifies the Svix signature against the
 * raw request body (see the raw body parser mounted in app.ts), then upserts
 * or deletes the mirror. Idempotent so Svix retries are safe.
 */
export const handleClerkWebhook = asyncHandler(async (req: Request, res: Response) => {
  const secret = env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) throw ApiError.internal('CLERK_WEBHOOK_SIGNING_SECRET not configured');

  const payload = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
  const headers = {
    'svix-id': req.header('svix-id') ?? '',
    'svix-timestamp': req.header('svix-timestamp') ?? '',
    'svix-signature': req.header('svix-signature') ?? '',
  };

  let evt: ClerkWebhookEvent;
  try {
    evt = new Webhook(secret).verify(payload, headers) as ClerkWebhookEvent;
  } catch {
    throw ApiError.badRequest('Invalid webhook signature');
  }

  switch (evt.type) {
    case 'user.created':
      await userService.syncFromClerk(evt.data);
      await ensureDefaultTier(evt.data);
      break;
    case 'user.updated':
      await userService.syncFromClerk(evt.data);
      break;
    case 'user.deleted':
      if (evt.data.id) await userService.removeByClerkId(evt.data.id);
      break;
    default:
      logger.debug({ type: evt.type }, 'Unhandled Clerk webhook event');
  }

  sendSuccess(res, { received: true });
});

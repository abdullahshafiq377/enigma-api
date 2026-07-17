import type { Request, Response } from 'express';

import { progressService } from '@/modules/progress/progress.service';
import type { HeartbeatBody, VideoIdParam } from '@/modules/progress/progress.validators';
import { userRepository } from '@/modules/user/user.repository';
import { ApiError } from '@/utils/ApiError';
import { sendSuccess } from '@/utils/apiResponse';
import { asyncHandler } from '@/utils/asyncHandler';

/** Resolve the authenticated Clerk user to their Mongo `_id` (mirror). */
async function resolveUserId(req: Request): Promise<string> {
  const clerkId = req.user?.clerkId;
  if (!clerkId) throw ApiError.unauthorized();
  const user = await userRepository.findByClerkId(clerkId);
  if (!user) throw ApiError.unauthorized('User not synced yet');
  return user.id;
}

export const progressController = {
  heartbeat: asyncHandler(async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);
    const { videoId } = req.validated?.params as VideoIdParam;
    const summary = await progressService.recordHeartbeat(
      userId,
      videoId,
      req.body as HeartbeatBody,
    );
    sendSuccess(res, summary);
  }),

  complete: asyncHandler(async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);
    const { videoId } = req.validated?.params as VideoIdParam;
    const summary = await progressService.markComplete(userId, videoId);
    sendSuccess(res, summary);
  }),

  continueWatching: asyncHandler(async (req: Request, res: Response) => {
    const userId = await resolveUserId(req);
    const items = await progressService.getContinueWatching(userId);
    sendSuccess(res, items);
  }),
};

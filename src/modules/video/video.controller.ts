import type { Request, Response } from 'express';

import { env } from '@/config/env';
import { userRepository } from '@/modules/user/user.repository';
import type { Viewer } from '@/modules/video/access';
import { videoService } from '@/modules/video/video.service';
import type { ListVideosQuery, VideoIdParam } from '@/modules/video/video.validators';
import { ApiError } from '@/utils/ApiError';
import { sendSuccess } from '@/utils/apiResponse';
import { asyncHandler } from '@/utils/asyncHandler';

/**
 * The caller as an access `Viewer`. The tier comes off the token, but the id has
 * to be the MONGO one — `Module.assignedUserIds` holds those, not Clerk ids — so
 * this resolves the mirror, the same as `moduleController.resolveContext`.
 */
async function viewerOf(req: Request): Promise<Viewer> {
  if (!req.user) throw ApiError.unauthorized();
  const user = await userRepository.findByClerkId(req.user.clerkId);
  if (!user) throw ApiError.unauthorized('User not synced yet');
  return { id: user.id, tier: req.user.tier };
}

export const videoController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const { moduleId } = req.validated?.query as ListVideosQuery;
    const videos = await videoService.listByModule(moduleId, await viewerOf(req));
    sendSuccess(res, videos);
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as VideoIdParam;
    const video = await videoService.getById(id, await viewerOf(req));
    sendSuccess(res, video);
  }),

  playbackGrant: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as VideoIdParam;
    const grant = await videoService.issuePlaybackGrant(id, await viewerOf(req));

    // Set CloudFront signed cookies (sent automatically to cdn.* on playback).
    const cookieOpts = {
      httpOnly: true,
      secure: true,
      sameSite: 'none' as const,
      ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
      path: '/',
    };
    for (const [name, value] of Object.entries(grant.cookies)) {
      res.cookie(name, value, cookieOpts);
    }

    sendSuccess(res, {
      manifestUrl: grant.manifestUrl,
      playbackType: grant.playbackType,
      captionsUrl: grant.captionsUrl,
      transcriptUrl: grant.transcriptUrl,
    });
  }),
};

import type { Request, Response } from 'express';

import { env } from '@/config/env';
import type { Tier } from '@/modules/user/user.types';
import { videoService } from '@/modules/video/video.service';
import type { ListVideosQuery, VideoIdParam } from '@/modules/video/video.validators';
import { ApiError } from '@/utils/ApiError';
import { sendSuccess } from '@/utils/apiResponse';
import { asyncHandler } from '@/utils/asyncHandler';

function tierOf(req: Request): Tier {
  if (!req.user) throw ApiError.unauthorized();
  return req.user.tier;
}

export const videoController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const { moduleId } = req.validated?.query as ListVideosQuery;
    const videos = await videoService.listByModule(moduleId, tierOf(req));
    sendSuccess(res, videos);
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as VideoIdParam;
    const video = await videoService.getById(id, tierOf(req));
    sendSuccess(res, video);
  }),

  playbackGrant: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as VideoIdParam;
    const grant = await videoService.issuePlaybackGrant(id, tierOf(req));

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

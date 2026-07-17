import type { Request, Response } from 'express';

import { analyticsService, type Granularity } from '@/modules/admin/analytics.service';
import { sendSuccess } from '@/utils/apiResponse';
import { asyncHandler } from '@/utils/asyncHandler';

export const analyticsController = {
  overview: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await analyticsService.overview());
  }),
  moduleCompletion: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await analyticsService.moduleCompletion());
  }),
  videoRankings: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await analyticsService.videoRankings());
  }),
  certificates: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await analyticsService.certificateStats());
  }),
  activity: asyncHandler(async (req: Request, res: Response) => {
    const { granularity } = (req.validated?.query ?? {}) as { granularity?: Granularity };
    sendSuccess(res, await analyticsService.activity(granularity));
  }),
};

import type { Request, Response } from 'express';

import {
  type AnalyticsRange,
  analyticsService,
  type Granularity,
} from '@/modules/admin/analytics.service';
import { sendSuccess } from '@/utils/apiResponse';
import { asyncHandler } from '@/utils/asyncHandler';

/** The screen's date chips. Absent means all time (the pre-chip behaviour). */
const rangeOf = (req: Request): AnalyticsRange =>
  ((req.validated?.query as { range?: AnalyticsRange } | undefined)?.range ?? 'all');

export const analyticsController = {
  overview: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await analyticsService.overview(rangeOf(req)));
  }),
  moduleCompletion: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await analyticsService.moduleCompletion(rangeOf(req)));
  }),
  videoRankings: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await analyticsService.videoRankings(rangeOf(req)));
  }),
  certificates: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await analyticsService.certificateStats(rangeOf(req)));
  }),
  // The timeline is NOT range-scoped: its own day/week/month control already
  // sets its window (30 / 84 / 365 days), and two controls fighting over one
  // axis would leave neither meaning anything.
  activity: asyncHandler(async (req: Request, res: Response) => {
    const { granularity, tz } = (req.validated?.query ?? {}) as {
      granularity?: Granularity;
      tz?: string;
    };
    sendSuccess(res, await analyticsService.activity(granularity, tz));
  }),
};

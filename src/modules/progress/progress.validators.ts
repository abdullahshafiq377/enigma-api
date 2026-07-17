import { z } from 'zod';

const segmentSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
});

export const heartbeatBodySchema = z.object({
  segments: z.array(segmentSchema).max(500).default([]),
  lastPositionSec: z.number().nonnegative().default(0),
  durationSec: z.number().positive(),
});
export type HeartbeatBody = z.infer<typeof heartbeatBodySchema>;

export const completeBodySchema = z.object({
  durationSec: z.number().positive().optional(),
});
export type CompleteBody = z.infer<typeof completeBodySchema>;

export const videoIdParamSchema = z.object({
  videoId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid videoId'),
});
export type VideoIdParam = z.infer<typeof videoIdParamSchema>;

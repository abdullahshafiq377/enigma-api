import { z } from 'zod';

export const videoIdParamSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'),
});
export type VideoIdParam = z.infer<typeof videoIdParamSchema>;

export const listVideosQuerySchema = z.object({
  moduleId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid moduleId'),
});
export type ListVideosQuery = z.infer<typeof listVideosQuerySchema>;

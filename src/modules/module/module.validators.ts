import { z } from 'zod';

export const moduleIdParamSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id'),
});
export type ModuleIdParam = z.infer<typeof moduleIdParamSchema>;

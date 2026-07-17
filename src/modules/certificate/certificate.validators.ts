import { z } from 'zod';

export const moduleIdParamSchema = z.object({
  moduleId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid moduleId'),
});
export type ModuleIdParam = z.infer<typeof moduleIdParamSchema>;

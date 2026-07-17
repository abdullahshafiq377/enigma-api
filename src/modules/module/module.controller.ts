import type { Request, Response } from 'express';

import { moduleService } from '@/modules/module/module.service';
import type { ModuleIdParam } from '@/modules/module/module.validators';
import { userRepository } from '@/modules/user/user.repository';
import { ApiError } from '@/utils/ApiError';
import { sendSuccess } from '@/utils/apiResponse';
import { asyncHandler } from '@/utils/asyncHandler';

async function resolveContext(req: Request): Promise<{ userId: string; tier: ModuleTier }> {
  if (!req.user) throw ApiError.unauthorized();
  const user = await userRepository.findByClerkId(req.user.clerkId);
  if (!user) throw ApiError.unauthorized('User not synced yet');
  return { userId: user.id, tier: req.user.tier };
}

type ModuleTier = NonNullable<Request['user']>['tier'];

export const moduleController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const { userId, tier } = await resolveContext(req);
    sendSuccess(res, await moduleService.listForUser(tier, userId));
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const { userId, tier } = await resolveContext(req);
    const { id } = req.validated?.params as ModuleIdParam;
    sendSuccess(res, await moduleService.getForUser(id, tier, userId));
  }),
};

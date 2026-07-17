import type { Request, Response } from 'express';

import { certificateService } from '@/modules/certificate/certificate.service';
import type { ModuleIdParam } from '@/modules/certificate/certificate.validators';
import { userRepository } from '@/modules/user/user.repository';
import { ApiError } from '@/utils/ApiError';
import { sendSuccess } from '@/utils/apiResponse';
import { asyncHandler } from '@/utils/asyncHandler';

async function resolveUser(req: Request): Promise<{ id: string; name: string }> {
  const clerkId = req.user?.clerkId;
  if (!clerkId) throw ApiError.unauthorized();
  const user = await userRepository.findByClerkId(clerkId);
  if (!user) throw ApiError.unauthorized('User not synced yet');
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email;
  return { id: user.id, name };
}

export const certificateController = {
  generate: asyncHandler(async (req: Request, res: Response) => {
    const { id, name } = await resolveUser(req);
    const { moduleId } = req.validated?.params as ModuleIdParam;
    const cert = await certificateService.generate(id, moduleId, name);
    sendSuccess(res, cert, undefined, 201);
  }),

  listMine: asyncHandler(async (req: Request, res: Response) => {
    const { id } = await resolveUser(req);
    sendSuccess(res, await certificateService.listMine(id));
  }),

  download: asyncHandler(async (req: Request, res: Response) => {
    const { id } = await resolveUser(req);
    const { moduleId } = req.validated?.params as ModuleIdParam;
    const url = await certificateService.getDownloadUrl(id, moduleId);
    sendSuccess(res, { url });
  }),
};

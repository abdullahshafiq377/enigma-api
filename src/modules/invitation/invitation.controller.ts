import type { Request, Response } from 'express';

import { invitationService } from '@/modules/invitation/invitation.service';
import type {
  BulkInvitationInput,
  CheckTokenQuery,
  CreateInvitationInput,
} from '@/modules/invitation/invitation.validators';
import { userRepository } from '@/modules/user/user.repository';
import { ApiError } from '@/utils/ApiError';
import { sendSuccess } from '@/utils/apiResponse';
import { asyncHandler } from '@/utils/asyncHandler';

/** Resolve the authenticated admin's Mongo id (for `invitedByAdmin`). */
async function adminId(req: Request): Promise<string> {
  if (!req.user) throw ApiError.unauthorized();
  const admin = await userRepository.findByClerkId(req.user.clerkId);
  if (!admin) throw ApiError.unauthorized('Admin not synced yet.');
  return admin.id;
}

export const invitationController = {
  /** POST /admin/invitations — admin creates one invitation. */
  create: asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as CreateInvitationInput; // validated by createInvitationSchema
    const invitation = await invitationService.create({ ...body, invitedByAdminId: await adminId(req) });
    sendSuccess(res, invitation, undefined, 201);
  }),

  /** POST /admin/invitations/bulk — admin creates many; per-row results returned. */
  createBulk: asyncHandler(async (req: Request, res: Response) => {
    const { invitations } = req.body as BulkInvitationInput; // validated by bulkInvitationSchema
    const result = await invitationService.createMany(invitations, await adminId(req));
    sendSuccess(res, result, undefined, 201);
  }),

  /** GET /invitations/check?token= — PUBLIC. Powers the accept page (prefill + status). */
  check: asyncHandler(async (req: Request, res: Response) => {
    const { token } = req.validated?.query as CheckTokenQuery;
    sendSuccess(res, await invitationService.checkByToken(token));
  }),
};

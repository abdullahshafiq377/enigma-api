import type { Request, Response } from 'express';

import type { IdParam, InviteCsv } from '@/modules/admin/admin.validators';
import { adminInvitationsService } from '@/modules/admin/admin-invitations.service';
import { sendSuccess } from '@/utils/apiResponse';
import { asyncHandler } from '@/utils/asyncHandler';

export const adminInvitationsController = {
  validateCsv: asyncHandler(async (req: Request, res: Response) => {
    const { csv, defaultTier } = req.body as InviteCsv;
    sendSuccess(res, await adminInvitationsService.validateCsv(csv, defaultTier));
  }),

  sendCsv: asyncHandler(async (req: Request, res: Response) => {
    const { csv, defaultTier } = req.body as InviteCsv;
    sendSuccess(res, await adminInvitationsService.sendFromCsv(csv, defaultTier));
  }),

  resend: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    sendSuccess(res, await adminInvitationsService.resendOne(id));
  }),

  revoke: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    sendSuccess(res, await adminInvitationsService.revokeOne(id));
  }),
};

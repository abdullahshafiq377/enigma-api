import type { Request, Response } from 'express';

import type { BulkAccessCsv } from '@/modules/admin/admin.validators';
import { bulkAccessService } from '@/modules/admin/bulk-access.service';
import { userRepository } from '@/modules/user/user.repository';
import { ApiError } from '@/utils/ApiError';
import { sendSuccess } from '@/utils/apiResponse';
import { asyncHandler } from '@/utils/asyncHandler';

async function adminId(req: Request): Promise<string> {
  if (!req.user) throw ApiError.unauthorized();
  const admin = await userRepository.findByClerkId(req.user.clerkId);
  if (!admin) throw ApiError.unauthorized('Admin not synced yet.');
  return admin.id;
}

export const bulkAccessController = {
  /** POST /admin/access/bulk-csv/validate — dry-run classify. */
  validate: asyncHandler(async (req: Request, res: Response) => {
    const { csv, mapping, tierValues } = req.body as BulkAccessCsv;
    sendSuccess(res, await bulkAccessService.validate(csv, { mapping, tierValues }));
  }),

  /** POST /admin/access/bulk-csv/apply — update tiers + send invites. */
  apply: asyncHandler(async (req: Request, res: Response) => {
    const { csv, mapping, tierValues } = req.body as BulkAccessCsv;
    sendSuccess(res, await bulkAccessService.apply(csv, await adminId(req), { mapping, tierValues }));
  }),
};

import type { Request, Response } from 'express';

import type {
  BulkCsv,
  IdParam,
  ListUsersAdminQuery,
  RoleUpdate,
  TierUpdate,
} from '@/modules/admin/admin.validators';
import { adminUsersService } from '@/modules/admin/admin-users.service';
import { sendSuccess } from '@/utils/apiResponse';
import { asyncHandler } from '@/utils/asyncHandler';

export const adminUsersController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const query = req.validated?.query as ListUsersAdminQuery;
    const { items, nextCursor } = await adminUsersService.list(query);
    sendSuccess(res, items, { nextCursor, limit: query.limit });
  }),

  stats: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await adminUsersService.stats());
  }),

  detail: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    sendSuccess(res, await adminUsersService.getDetail(id));
  }),

  updateTier: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    const { tier } = req.body as TierUpdate;
    sendSuccess(res, await adminUsersService.updateTier(id, tier));
  }),

  updateRole: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as IdParam;
    const { role } = req.body as RoleUpdate;
    sendSuccess(res, await adminUsersService.updateRole(id, role));
  }),

  validateCsv: asyncHandler(async (req: Request, res: Response) => {
    const { csv, defaultTier } = req.body as BulkCsv;
    sendSuccess(res, await adminUsersService.validateCsv(csv, defaultTier));
  }),

  bulkCsv: asyncHandler(async (req: Request, res: Response) => {
    const { csv, defaultTier } = req.body as BulkCsv;
    sendSuccess(res, await adminUsersService.bulkAssignFromCsv(csv, defaultTier));
  }),

  exportCsv: asyncHandler(async (req: Request, res: Response) => {
    const query = req.validated?.query as ListUsersAdminQuery;
    const csv = await adminUsersService.exportCsv(query);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    res.send(csv);
  }),
};

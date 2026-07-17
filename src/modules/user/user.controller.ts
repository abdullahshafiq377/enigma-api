import type { Request, Response } from 'express';

import { userService } from '@/modules/user/user.service';
import type { ListUsersQuery, UserIdParam } from '@/modules/user/user.validators';
import { ApiError } from '@/utils/ApiError';
import { sendSuccess } from '@/utils/apiResponse';
import { asyncHandler } from '@/utils/asyncHandler';

/** Thin HTTP layer: extracts validated request context and delegates to the service. */
export const userController = {
  /** Current authenticated user (the mirror) — for profile + greeting. */
  me: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    sendSuccess(res, await userService.getByClerkId(req.user.clerkId));
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const query = req.validated?.query as ListUsersQuery;
    const { items, nextCursor } = await userService.list(query);
    sendSuccess(res, items, { nextCursor, limit: query.limit });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.validated?.params as UserIdParam;
    const user = await userService.getById(id);
    sendSuccess(res, user);
  }),
};

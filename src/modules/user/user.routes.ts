import { Router } from 'express';

import { requireAuth } from '@/middlewares/auth';
import { validate } from '@/middlewares/validate';
import { userController } from '@/modules/user/user.controller';
import { listUsersQuerySchema, userIdParamSchema } from '@/modules/user/user.validators';

const router = Router();

// `/me` must precede `/:id` so it isn't captured as an id.
router.get('/me', requireAuth, userController.me);
router.get('/', validate({ query: listUsersQuerySchema }), userController.list);
router.get('/:id', validate({ params: userIdParamSchema }), userController.getById);

export default router;

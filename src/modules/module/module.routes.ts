import { Router } from 'express';

import { requireAuth } from '@/middlewares/auth';
import { validate } from '@/middlewares/validate';
import { moduleController } from '@/modules/module/module.controller';
import { moduleIdParamSchema } from '@/modules/module/module.validators';

const router = Router();

router.get('/', requireAuth, moduleController.list);
router.get(
  '/:id',
  requireAuth,
  validate({ params: moduleIdParamSchema }),
  moduleController.getById,
);

export default router;

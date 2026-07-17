import { Router } from 'express';

import { requireAuth } from '@/middlewares/auth';
import { validate } from '@/middlewares/validate';
import { certificateController } from '@/modules/certificate/certificate.controller';
import { moduleIdParamSchema } from '@/modules/certificate/certificate.validators';

const router = Router();

router.get('/me', requireAuth, certificateController.listMine);
router.post(
  '/:moduleId',
  requireAuth,
  validate({ params: moduleIdParamSchema }),
  certificateController.generate,
);
router.get(
  '/:moduleId/download',
  requireAuth,
  validate({ params: moduleIdParamSchema }),
  certificateController.download,
);

export default router;

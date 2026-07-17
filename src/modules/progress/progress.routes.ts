import { Router } from 'express';

import { requireAuth } from '@/middlewares/auth';
import { validate } from '@/middlewares/validate';
import { progressController } from '@/modules/progress/progress.controller';
import {
  completeBodySchema,
  heartbeatBodySchema,
  videoIdParamSchema,
} from '@/modules/progress/progress.validators';

const router = Router();

router.get('/me', requireAuth, progressController.continueWatching);

router.post(
  '/:videoId/heartbeat',
  requireAuth,
  validate({ params: videoIdParamSchema, body: heartbeatBodySchema }),
  progressController.heartbeat,
);

router.post(
  '/:videoId/complete',
  requireAuth,
  validate({ params: videoIdParamSchema, body: completeBodySchema }),
  progressController.complete,
);

export default router;

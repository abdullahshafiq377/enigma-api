import { Router } from 'express';

import { requireAuth } from '@/middlewares/auth';
import { validate } from '@/middlewares/validate';
import { videoController } from '@/modules/video/video.controller';
import { listVideosQuerySchema, videoIdParamSchema } from '@/modules/video/video.validators';

const router = Router();

router.get('/', requireAuth, validate({ query: listVideosQuerySchema }), videoController.list);
router.get('/:id', requireAuth, validate({ params: videoIdParamSchema }), videoController.getById);
router.post(
  '/:id/playback-grant',
  requireAuth,
  validate({ params: videoIdParamSchema }),
  videoController.playbackGrant,
);

export default router;

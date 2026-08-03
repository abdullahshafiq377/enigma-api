import { Router } from 'express';

import { validate } from '@/middlewares/validate';
import { invitationController } from '@/modules/invitation/invitation.controller';
import { checkTokenSchema } from '@/modules/invitation/invitation.validators';

// PUBLIC routes — the invitee's accept page calls these before signing in.
// (Admin create/bulk live under the admin router, behind requireRole('admin').)
const router = Router();

router.get('/check', validate({ query: checkTokenSchema }), invitationController.check);

export default router;

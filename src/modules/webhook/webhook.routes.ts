import { Router } from 'express';

import { handleClerkWebhook } from '@/modules/webhook/clerk.webhook.controller';

const router = Router();

// Public route (no auth) — secured by Svix signature verification instead.
router.post('/clerk', handleClerkWebhook);

export default router;

import { Router } from 'express';

import adminRoutes from '@/modules/admin/admin.routes';
import certificateRoutes from '@/modules/certificate/certificate.routes';
import invitationRoutes from '@/modules/invitation/invitation.routes';
import moduleRoutes from '@/modules/module/module.routes';
import progressRoutes from '@/modules/progress/progress.routes';
import userRoutes from '@/modules/user/user.routes';
import videoRoutes from '@/modules/video/video.routes';
import webhookRoutes from '@/modules/webhook/webhook.routes';

/** v1 API router aggregator. Mount each feature module here. */
const v1Router = Router();

v1Router.use('/users', userRoutes);
v1Router.use('/modules', moduleRoutes);
v1Router.use('/videos', videoRoutes);
v1Router.use('/progress', progressRoutes);
v1Router.use('/certificates', certificateRoutes);
v1Router.use('/invitations', invitationRoutes);
v1Router.use('/admin', adminRoutes);
v1Router.use('/webhooks', webhookRoutes);

export default v1Router;

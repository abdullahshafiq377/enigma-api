import { Router } from 'express';

import { requireAuth, requireRole } from '@/middlewares/auth';
import { validate } from '@/middlewares/validate';
import {
  activityQuerySchema,
  attachPdfSchema,
  bulkAccessCsvSchema,
  bulkCsvSchema,
  createModuleSchema,
  createVideoSchema,
  idParamSchema,
  inviteCsvSchema,
  listUsersAdminQuerySchema,
  moduleIdQuerySchema,
  processSchema,
  publishSchema,
  reorderSchema,
  roleUpdateSchema,
  tierUpdateSchema,
  transcribeJobParamSchema,
  transcribeStartSchema,
  updateModuleSchema,
  updateVideoSchema,
  uploadUrlSchema,
} from '@/modules/admin/admin.validators';
import { adminInvitationsController } from '@/modules/admin/admin-invitations.controller';
import { adminUsersController } from '@/modules/admin/admin-users.controller';
import { analyticsController } from '@/modules/admin/analytics.controller';
import { bulkAccessController } from '@/modules/admin/bulk-access.controller';
import { cmsController } from '@/modules/admin/cms.controller';
import { invitationController } from '@/modules/invitation/invitation.controller';
import {
  bulkInvitationSchema,
  createInvitationSchema,
} from '@/modules/invitation/invitation.validators';

const router = Router();

// Every admin route requires an authenticated admin.
router.use(requireAuth, requireRole('admin'));

// --- Analytics ---
router.get('/analytics/overview', analyticsController.overview);
router.get('/analytics/module-completion', analyticsController.moduleCompletion);
router.get('/analytics/video-rankings', analyticsController.videoRankings);
router.get('/analytics/certificates', analyticsController.certificates);
router.get(
  '/analytics/activity',
  validate({ query: activityQuerySchema }),
  analyticsController.activity,
);

// --- User management ---
router.get('/users', validate({ query: listUsersAdminQuerySchema }), adminUsersController.list);
router.get('/users/stats', adminUsersController.stats);
router.get(
  '/users/export',
  validate({ query: listUsersAdminQuerySchema }),
  adminUsersController.exportCsv,
);
// `/users/:id` MUST come after the literal `/users/*` GETs above so it doesn't shadow them.
router.get('/users/:id', validate({ params: idParamSchema }), adminUsersController.detail);
router.post(
  '/users/bulk-csv/validate',
  validate({ body: bulkCsvSchema }),
  adminUsersController.validateCsv,
);
router.post('/users/bulk-csv', validate({ body: bulkCsvSchema }), adminUsersController.bulkCsv);
router.patch(
  '/users/:id/tier',
  validate({ params: idParamSchema, body: tierUpdateSchema }),
  adminUsersController.updateTier,
);
router.patch(
  '/users/:id/role',
  validate({ params: idParamSchema, body: roleUpdateSchema }),
  adminUsersController.updateRole,
);

// --- Member invitations (CSV onboarding) ---
router.post(
  '/invitations/csv/validate',
  validate({ body: inviteCsvSchema }),
  adminInvitationsController.validateCsv,
);
router.post(
  '/invitations/csv',
  validate({ body: inviteCsvSchema }),
  adminInvitationsController.sendCsv,
);
router.post(
  '/invitations/:id/resend',
  validate({ params: idParamSchema }),
  adminInvitationsController.resend,
);
router.post(
  '/invitations/:id/revoke',
  validate({ params: idParamSchema }),
  adminInvitationsController.revoke,
);

// --- Member invitations (table-backed: the new Invitation collection) ---
router.post('/invitations', validate({ body: createInvitationSchema }), invitationController.create);
router.post(
  '/invitations/bulk',
  validate({ body: bulkInvitationSchema }),
  invitationController.createBulk,
);

// --- Unified member-access CSV (update tiers + invite in one upload) ---
router.post(
  '/access/bulk-csv/validate',
  validate({ body: bulkAccessCsvSchema }),
  bulkAccessController.validate,
);
router.post(
  '/access/bulk-csv/apply',
  validate({ body: bulkAccessCsvSchema }),
  bulkAccessController.apply,
);

// --- CMS: catalog overview (stat cards + per-module summaries) ---
router.get('/cms/overview', cmsController.overview);

// --- CMS: modules (literal routes before /:id) ---
router.get('/modules', cmsController.listModules);
router.post('/modules', validate({ body: createModuleSchema }), cmsController.createModule);
router.patch('/modules/reorder', validate({ body: reorderSchema }), cmsController.reorderModules);
router.patch(
  '/modules/:id',
  validate({ params: idParamSchema, body: updateModuleSchema }),
  cmsController.updateModule,
);
router.delete('/modules/:id', validate({ params: idParamSchema }), cmsController.deleteModule);

// --- CMS: videos ---
router.get('/videos', validate({ query: moduleIdQuerySchema }), cmsController.listVideos);
router.post('/videos', validate({ body: createVideoSchema }), cmsController.createVideo);
router.patch('/videos/reorder', validate({ body: reorderSchema }), cmsController.reorderVideos);
router.patch(
  '/videos/:id',
  validate({ params: idParamSchema, body: updateVideoSchema }),
  cmsController.updateVideo,
);
router.post(
  '/videos/:id/publish',
  validate({ params: idParamSchema, body: publishSchema }),
  cmsController.setPublished,
);
router.post(
  '/videos/:id/pdf',
  validate({ params: idParamSchema, body: attachPdfSchema }),
  cmsController.attachPdf,
);
router.post(
  '/videos/:id/process',
  validate({ params: idParamSchema, body: processSchema }),
  cmsController.processVideo,
);

// --- CMS: uploads ---
router.post('/media/upload-url', validate({ body: uploadUrlSchema }), cmsController.uploadUrl);

// --- CMS: transcript (start a job, then poll it) ---
router.post('/transcribe', validate({ body: transcribeStartSchema }), cmsController.startTranscript);
router.get(
  '/transcribe/:jobName',
  validate({ params: transcribeJobParamSchema }),
  cmsController.getTranscript,
);

export default router;

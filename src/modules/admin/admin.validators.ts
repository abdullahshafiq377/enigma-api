import { z } from 'zod';

import { MAX_UPLOAD_BYTES, UPLOAD_KINDS } from '@/modules/media/media.service';
import { ROLES, TIERS } from '@/modules/user/user.types';
import { VIDEO_TIERS } from '@/modules/video/video.model';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const idParamSchema = z.object({ id: objectId });
export type IdParam = z.infer<typeof idParamSchema>;

export const activityQuerySchema = z.object({
  granularity: z.enum(['day', 'week', 'month']).optional(),
  /* IANA zone for the day view's four-hour blocks — they are clock times, so
     "12AM" only means anything against a zone. Validated in the service, which
     falls back to UTC rather than rejecting. */
  tz: z.string().max(64).optional(),
});

/* The analytics screen's date chips. Omitted means all time, which is what
   these endpoints returned before the chips were wired up. */
export const analyticsRangeSchema = z.object({
  range: z.enum(['7d', '30d', '90d', 'all']).optional(),
});

export const listUsersAdminQuerySchema = z.object({
  search: z.string().trim().optional(),
  tier: z.enum(TIERS).optional(),
  status: z.enum(['active', 'inactive', 'invited', 'missing_data']).optional(),
  // Account origin (maps to invitationStatus): invited (pending) / registration_completed
  // (invited then registered) / none (direct sign-up).
  origin: z.enum(['invited', 'registration_completed', 'none']).optional(),
  lastActive: z.enum(['any', '7d', '30d', '90d']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListUsersAdminQuery = z.infer<typeof listUsersAdminQuerySchema>;

export const tierUpdateSchema = z.object({ tier: z.enum(TIERS) });
export const roleUpdateSchema = z.object({ role: z.enum(ROLES) });

export const bulkCsvSchema = z.object({
  csv: z.string().min(1),
  // Tier column is optional per row; rows without one default to insight (the
  // platform's default tier per the scope doc).
  defaultTier: z.enum(TIERS).default('insight'),
});

/** CSV payload for the invitation flow (same shape as the bulk-tier CSV). */
export const inviteCsvSchema = bulkCsvSchema;
export type InviteCsv = z.infer<typeof inviteCsvSchema>;

/**
 * Unified "member access" CSV (update tiers + invite). Tier is detected per-row
 * server-side (regex + aliases). The optional `mapping` overrides which CSV header
 * feeds each field (Map step), and `tierValues` assigns/skips unrecognized tier
 * values (e.g. { "gold": "mastery", "tier 2": "skip" }).
 */
export const bulkAccessCsvSchema = z.object({
  csv: z.string().min(1),
  mapping: z
    .object({
      email: z.string().optional(),
      name: z.string().optional(),
      company: z.string().optional(),
      tier: z.string().optional(),
    })
    .optional(),
  tierValues: z.record(z.string(), z.union([z.enum(TIERS), z.literal('skip')])).optional(),
});
export type BulkAccessCsv = z.infer<typeof bulkAccessCsvSchema>;

export const createModuleSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  order: z.number().int(),
  description: z.string().optional(),
  isPublished: z.boolean().optional(),
  tier: z.enum(VIDEO_TIERS).optional(), // access tier all its videos inherit (default 'free')
  // Partner modules only: the Sovereign members it is assigned to. [] = all of them.
  assignedUserIds: z.array(objectId).optional(),
});
export const updateModuleSchema = createModuleSchema.partial();

export const createVideoSchema = z.object({
  moduleId: objectId,
  title: z.string().min(1),
  description: z.string().optional(),
  order: z.number().int(),
  // No tier here — a video inherits its module's tier on create (see cmsService.createVideo).
  durationSec: z.number().nonnegative().optional(),
  // "Add video" wizard extras:
  publish: z.boolean().optional(), // Save & publish (true) vs Save as draft (false)
  inputKey: z.string().optional(), // uploaded source video S3 key → triggers transcode
  thumbnailInputKey: z.string().optional(), // uploaded poster image S3 key → copied to CDN
  transcript: z
    .array(z.object({ startSec: z.number().nonnegative(), text: z.string() }))
    .optional(), // admin-curated transcript segments
  resources: z
    .array(z.object({ title: z.string().min(1), inputKey: z.string().min(1) }))
    .optional(), // uploaded PDF resources
});

// Transcript generation (Add-video wizard): start a job, then poll it.
export const transcribeStartSchema = z.object({ inputKey: z.string().min(1) });
export const transcribeJobParamSchema = z.object({ jobName: z.string().min(1) });
export const updateVideoSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  order: z.number().int().optional(),
  tier: z.enum(VIDEO_TIERS).optional(),
  durationSec: z.number().nonnegative().optional(),
});

export const reorderSchema = z.object({
  items: z.array(z.object({ id: objectId, order: z.number().int() })).min(1),
});

/* `sizeBytes` is required, not optional: it is signed into the URL as
   ContentLength, so an omitted size would presign an upload of no fixed length
   and hand back exactly the unbounded PUT this limit exists to prevent.

   `kind` is required for the neighbouring reason. One endpoint serves the source
   video, the poster and the PDF resources, and they do not share a ceiling — so
   a size cannot be judged without knowing which it is, and an optional `kind`
   defaulting to the loosest would let a 250MB "PDF" through. The cap is applied
   in a refinement rather than `.max()` because it depends on a sibling field. */
export const uploadUrlSchema = z
  .object({
    filename: z.string().min(1),
    contentType: z.string().min(1),
    sizeBytes: z.number().int().positive(),
    kind: z.enum(UPLOAD_KINDS),
  })
  .refine(({ sizeBytes, kind }) => sizeBytes <= MAX_UPLOAD_BYTES[kind], ({ kind }) => ({
    path: ['sizeBytes'],
    message: `That ${kind} is over the ${MAX_UPLOAD_BYTES[kind] / (1024 * 1024)}MB limit.`,
  }));

/* The key is minted server-side as `inputs/<uuid>/<filename>` but comes BACK
   from the browser on complete/abort, so it is re-checked rather than trusted:
   without this, an admin session could seal or delete a multipart upload
   anywhere in the bucket, including under `outputs/`. */
const inputKey = z
  .string()
  .regex(
    /^inputs\/[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\/.+$/i,
    'Not an upload key',
  );

export const multipartCreateSchema = uploadUrlSchema;

export const multipartCompleteSchema = z.object({
  key: inputKey,
  uploadId: z.string().min(1),
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(10_000),
        etag: z.string().min(1),
      }),
    )
    .min(1),
});

export const multipartAbortSchema = z.object({
  key: inputKey,
  uploadId: z.string().min(1),
});

/* Same key guard as the multipart calls, and for the same reason: this one hands
   back a URL that READS the object, so an unchecked key would presign a download
   of anything in the bucket. */
export const sourceUrlSchema = z.object({ key: inputKey });

export const publishSchema = z.object({ published: z.boolean() });
export const processSchema = z.object({ inputKey: z.string().min(1) });
export const attachPdfSchema = z.object({ title: z.string().min(1), key: z.string().min(1) });
export const moduleIdQuerySchema = z.object({ moduleId: objectId });

export type TierUpdate = z.infer<typeof tierUpdateSchema>;
export type RoleUpdate = z.infer<typeof roleUpdateSchema>;
export type BulkCsv = z.infer<typeof bulkCsvSchema>;
export type CreateModule = z.infer<typeof createModuleSchema>;
export type UpdateModule = z.infer<typeof updateModuleSchema>;
export type CreateVideo = z.infer<typeof createVideoSchema>;
export type UpdateVideo = z.infer<typeof updateVideoSchema>;
export type Reorder = z.infer<typeof reorderSchema>;
export type UploadUrl = z.infer<typeof uploadUrlSchema>;
export type MultipartCreate = z.infer<typeof multipartCreateSchema>;
export type MultipartComplete = z.infer<typeof multipartCompleteSchema>;
export type MultipartAbort = z.infer<typeof multipartAbortSchema>;
export type SourceUrl = z.infer<typeof sourceUrlSchema>;
export type Publish = z.infer<typeof publishSchema>;
export type Process = z.infer<typeof processSchema>;
export type AttachPdf = z.infer<typeof attachPdfSchema>;
export type ModuleIdQuery = z.infer<typeof moduleIdQuerySchema>;
export type TranscribeStart = z.infer<typeof transcribeStartSchema>;
export type TranscribeJobParam = z.infer<typeof transcribeJobParamSchema>;

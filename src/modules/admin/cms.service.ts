import { randomUUID } from 'node:crypto';

import { logger } from '@/config/logger';
import { mediaService, type UploadKind } from '@/modules/media/media.service';
import { Module, type ModuleDoc } from '@/modules/module/module.model';
import { Progress } from '@/modules/progress/progress.model';
import {
  Video,
  type VideoDoc,
  type VideoStatus,
  type VideoTier,
} from '@/modules/video/video.model';
import { ApiError } from '@/utils/ApiError';

export interface CreateModuleInput {
  title: string;
  slug: string;
  order: number;
  description?: string | undefined;
  isPublished?: boolean | undefined;
  /** Access tier all videos in the module inherit (defaults to 'paid'). */
  tier?: VideoTier | undefined;
  /** Partner modules only: the Sovereign members to assign. [] = all of them. */
  assignedUserIds?: string[] | undefined;
}

export interface CreateVideoInput {
  moduleId: string;
  title: string;
  description?: string | undefined;
  order: number;
  // No tier — the video inherits its module's tier (see createVideo below).
  durationSec?: number | undefined;
  /** Save & publish (true) → published; otherwise saved as an unpublished draft. */
  publish?: boolean | undefined;
  /** S3 key of the uploaded source video → triggers MediaConvert + Transcribe. */
  inputKey?: string | undefined;
  /** Admin-curated transcript segments (generated + edited in the wizard). */
  transcript?: { startSec: number; text: string }[] | undefined;
  /** S3 key of the uploaded poster image → copied to the output (CDN) bucket on save. */
  thumbnailInputKey?: string | undefined;
  /** Uploaded PDF resources (in the input bucket) to attach — copied to the output bucket on save. */
  resources?: { title: string; inputKey: string }[] | undefined;
}

export interface UpdateModuleInput {
  title?: string | undefined;
  slug?: string | undefined;
  order?: number | undefined;
  description?: string | undefined;
  isPublished?: boolean | undefined;
  tier?: VideoTier | undefined;
  assignedUserIds?: string[] | undefined;
}

export interface UpdateVideoInput {
  title?: string | undefined;
  description?: string | undefined;
  order?: number | undefined;
  tier?: VideoTier | undefined;
  durationSec?: number | undefined;
  status?: VideoStatus | undefined;
}

export interface ReorderItem {
  id: string;
  order: number;
}

// ---- DTOs (list/overview views) ----
export interface AdminVideoDTO {
  id: string;
  moduleId: string;
  title: string;
  description?: string | undefined;
  order: number;
  durationSec: number;
  tier: VideoTier;
  status: VideoStatus;
  hasVideo: boolean;
  hasThumbnail: boolean;
  hasTranscript: boolean;
  hasCaptions: boolean;
  pdfCount: number;
  needsAttention: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type ModuleCmsStatus = 'empty' | 'needs_attention' | 'active';

export interface AdminModuleSummary {
  id: string;
  title: string;
  slug: string;
  order: number;
  description?: string | undefined;
  isPublished: boolean;
  /** True for the fixed top-slot modules whose title tracks their order. */
  isCore: boolean;
  /** Seeded/system module — the admin can't edit or delete it. */
  isSystem: boolean;
  /** Access tier the module (and every video in it) belongs to. */
  tier: VideoTier;
  /** Partner modules only: assigned Sovereign members. [] = all of them. */
  assignedUserIds: string[];
  videoCount: number;
  publishedCount: number;
  status: ModuleCmsStatus;
  updatedAt: Date;
}

/** Position-derived title for a core module sitting at the given order. */
export const coreModuleTitle = (order: number): string => `Module ${order}`;

/**
 * Position-derived access tier for a CORE module. The curriculum structure is
 * fixed: the first 4 core slots are free (Insight), slot 5 is paid (Mastery).
 * So a core module's tier follows its position — reordering updates it, exactly
 * like the title. (Extra modules keep their own tier, e.g. Partner → partner.)
 */
export const coreModuleTier = (order: number): VideoTier => (order <= 4 ? 'free' : 'paid');

/** Where a wizard transcript job writes its JSON in the output bucket. */
const transcriptOutputKey = (jobName: string): string => `transcripts/${jobName}.json`;

interface RawTranscribeJson {
  results?: {
    audio_segments?: { start_time?: string; transcript?: string }[];
    items?: {
      type?: string;
      start_time?: string;
      alternatives?: { content?: string }[];
    }[];
  };
}

/**
 * Turn an Amazon Transcribe output JSON into readable, timestamped segments.
 * Prefers `audio_segments` (Transcribe already sentence-splits these); falls back
 * to grouping word `items` at sentence-ending punctuation.
 */
export function parseTranscript(json: unknown): { startSec: number; text: string }[] {
  const r = (json as RawTranscribeJson).results;
  if (!r) return [];

  if (r.audio_segments?.length) {
    return r.audio_segments
      .map((s) => ({
        startSec: Math.floor(Number(s.start_time ?? '0')) || 0,
        text: (s.transcript ?? '').trim(),
      }))
      .filter((s) => s.text);
  }

  const out: { startSec: number; text: string }[] = [];
  let text = '';
  let startSec = 0;
  let open = false;
  for (const it of r.items ?? []) {
    const content = it.alternatives?.[0]?.content ?? '';
    if (it.type === 'punctuation') {
      text += content;
      if (/[.!?]/.test(content)) {
        if (text.trim()) out.push({ startSec, text: text.trim() });
        text = '';
        open = false;
      }
    } else {
      if (!open) {
        startSec = Math.floor(Number(it.start_time ?? '0')) || 0;
        open = true;
      }
      text += (text && !text.endsWith(' ') ? ' ' : '') + content;
    }
  }
  if (text.trim()) out.push({ startSec, text: text.trim() });
  return out;
}

export interface CmsOverview {
  stats: {
    modules: number;
    videos: number;
    published: number;
    drafts: number;
    needsAttention: number;
  };
  modules: AdminModuleSummary[];
}

/** Playable when it has an HLS manifest OR a progressive MP4 (MP4-first). */
function hasPlayableVideo(v: VideoDoc): boolean {
  return Boolean(v.hlsManifestKey || v.mp4Key);
}

/** A video "needs attention" when it has no playable file yet. */
function videoNeedsAttention(v: VideoDoc): boolean {
  return !hasPlayableVideo(v);
}

/** Map a video doc to the admin DTO, deriving the asset indicators the CMS shows. */
export function toVideoDTO(v: VideoDoc): AdminVideoDTO {
  return {
    id: v.id,
    moduleId: v.moduleId.toString(),
    title: v.title,
    description: v.description,
    order: v.order,
    durationSec: v.durationSec,
    tier: v.tier,
    status: v.status,
    hasVideo: hasPlayableVideo(v),
    hasThumbnail: Boolean(v.thumbnailKey),
    hasTranscript: Boolean(v.transcriptKey),
    hasCaptions: Boolean(v.captionsKey),
    pdfCount: v.pdfResources.length,
    needsAttention: videoNeedsAttention(v),
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

/** Submit MediaConvert + Transcribe for an uploaded source and record the expected output keys. */
async function submitTranscodeJobs(videoId: string, inputKey: string): Promise<void> {
  const outputPrefix = `videos/${videoId}`;
  await mediaService.submitTranscode(inputKey, outputPrefix);
  await mediaService.submitTranscription(
    inputKey,
    `transcribe-${videoId}`,
    `${outputPrefix}/transcript.json`,
  );
  await Video.findByIdAndUpdate(videoId, {
    $set: {
      hlsManifestKey: `${outputPrefix}/index.m3u8`,
      captionsKey: `${outputPrefix}/captions.vtt`,
      transcriptKey: `${outputPrefix}/transcript.json`,
    },
  }).exec();
}

export const cmsService = {
  /** Catalog overview: global stat cards + per-module counts and derived status. */
  async overview(): Promise<CmsOverview> {
    const [modules, videos] = await Promise.all([
      Module.find().sort({ order: 1 }).exec() as Promise<ModuleDoc[]>,
      Video.find().exec() as Promise<VideoDoc[]>,
    ]);

    const byModule = new Map<string, VideoDoc[]>();
    for (const v of videos) {
      const key = v.moduleId.toString();
      const arr = byModule.get(key);
      if (arr) arr.push(v);
      else byModule.set(key, [v]);
    }

    const moduleSummaries: AdminModuleSummary[] = modules.map((m) => {
      const vids = byModule.get(m.id) ?? [];
      const publishedCount = vids.filter((v) => v.status === 'published').length;
      let status: ModuleCmsStatus;
      if (vids.length === 0) status = 'empty';
      else if (publishedCount < vids.length || vids.some(videoNeedsAttention))
        status = 'needs_attention';
      else status = 'active';
      return {
        id: m.id,
        title: m.title,
        slug: m.slug,
        order: m.order,
        description: m.description,
        isPublished: m.isPublished,
        isCore: m.isCore,
        isSystem: m.isSystem,
        tier: m.tier,
        assignedUserIds: (m.assignedUserIds ?? []).map(String),
        videoCount: vids.length,
        publishedCount,
        status,
        updatedAt: m.updatedAt,
      };
    });

    const published = videos.filter((v) => v.status === 'published').length;
    return {
      stats: {
        modules: modules.length,
        videos: videos.length,
        published,
        drafts: videos.length - published,
        needsAttention: videos.filter(videoNeedsAttention).length,
      },
      modules: moduleSummaries,
    };
  },

  // ---- Modules ----
  listModules(): Promise<ModuleDoc[]> {
    return Module.find().sort({ order: 1 }).exec() as Promise<ModuleDoc[]>;
  },

  async createModule(input: CreateModuleInput): Promise<ModuleDoc> {
    // New modules are always "extra" (never core) and get appended after every
    // existing module, so they can't land inside the fixed core block. Order is
    // assigned server-side (max + 1) rather than trusting the client's guess.
    const [last] = await Module.find().sort({ order: -1 }).limit(1).select('order').lean();
    const order = (last?.order ?? 0) + 1;
    return Module.create({
      isPublished: false,
      ...input,
      order,
      isCore: false,
    }) as Promise<ModuleDoc>;
  },

  async updateModule(id: string, patch: UpdateModuleInput): Promise<ModuleDoc> {
    const doc = await Module.findById(id).exec();
    if (!doc) throw ApiError.notFound('Module not found');
    if (doc.isSystem) throw ApiError.forbidden('System modules cannot be edited.');
    const updated = await Module.findByIdAndUpdate(id, { $set: patch }, { new: true }).exec();
    return updated as ModuleDoc;
  },

  /**
   * Delete a (non-system) module and its videos. Videos belong to exactly one
   * module, so all of this module's videos + their progress are removed. Seeded
   * system modules are protected. Returns how many videos were deleted.
   * (S3 objects are not removed — the runtime IAM role has no s3:DeleteObject.)
   */
  async deleteModule(id: string): Promise<{ deletedVideos: number }> {
    const doc = await Module.findById(id).exec();
    if (!doc) throw ApiError.notFound('Module not found');
    if (doc.isSystem) throw ApiError.forbidden('System modules cannot be deleted.');

    const vids = (await Video.find({ moduleId: id }).select('_id').lean()) as { _id: unknown }[];
    const videoIds = vids.map((v) => v._id);
    if (videoIds.length) {
      await Progress.deleteMany({ videoId: { $in: videoIds } });
      await Video.deleteMany({ moduleId: id });
    }
    await Module.deleteOne({ _id: id });
    return { deletedVideos: videoIds.length };
  },

  /**
   * Persist a new module order. Enforces invariants and re-derives core fields:
   *  - Core modules must stay in a contiguous block above every extra module
   *    (you can't drag an extra into the core zone, or a core below the line).
   *  - Each core module's title AND access tier are re-derived from its slot
   *    ("Module {order}"; slots 1–4 free, slot 5 paid), so reordering keeps both
   *    in sync with position.
   *  - The new tier is cascaded to the module's videos so member access follows.
   * Module writes are atomic via a single bulkWrite.
   */
  async reorderModules(items: ReorderItem[]): Promise<void> {
    const docs = (await Module.find({ _id: { $in: items.map((i) => i.id) } })
      .select('_id isCore')
      .lean()) as { _id: unknown; isCore?: boolean }[];
    const isCoreById = new Map(docs.map((d) => [String(d._id), Boolean(d.isCore)]));

    // Reject any ordering that interleaves extras into the core block.
    let seenExtra = false;
    for (const it of [...items].sort((a, b) => a.order - b.order)) {
      if (isCoreById.get(it.id)) {
        if (seenExtra) throw ApiError.badRequest('Core modules must stay above other modules.');
      } else {
        seenExtra = true;
      }
    }

    const ops = items.map((it) => ({
      updateOne: {
        filter: { _id: it.id },
        update: {
          $set: isCoreById.get(it.id)
            ? { order: it.order, title: coreModuleTitle(it.order), tier: coreModuleTier(it.order) }
            : { order: it.order },
        },
      },
    }));
    if (ops.length) await Module.bulkWrite(ops);

    // Cascade each core module's (possibly new) tier to its videos.
    const videoOps = items
      .filter((it) => isCoreById.get(it.id))
      .map((it) => ({
        updateMany: {
          filter: { moduleId: it.id },
          update: { $set: { tier: coreModuleTier(it.order) } },
        },
      }));
    if (videoOps.length) await Video.bulkWrite(videoOps);
  },

  // ---- Videos ----
  listVideosByModule(moduleId: string): Promise<VideoDoc[]> {
    return Video.find({ moduleId }).sort({ order: 1 }).exec() as Promise<VideoDoc[]>;
  },

  async createVideo(input: CreateVideoInput): Promise<VideoDoc> {
    // `fields` keeps `transcript` (the admin-curated segments) → persisted on create.
    const { publish, inputKey, thumbnailInputKey, resources, ...fields } = input;
    // Access is decided by the module: the video inherits its module's tier.
    const moduleDoc = await Module.findById(input.moduleId).select('tier').lean();
    const tier: VideoTier = (moduleDoc?.tier as VideoTier | undefined) ?? 'paid';
    const video = (await Video.create({
      ...fields,
      tier,
      durationSec: fields.durationSec ?? 0,
      status: publish ? 'published' : 'unpublished',
    })) as VideoDoc;

    const outputPrefix = `videos/${video.id}`;
    let touched = false;

    // Poster image: copy the uploaded thumbnail into the video's output folder so
    // it's served via the CDN alongside the video.
    if (thumbnailInputKey) {
      const ext = thumbnailInputKey.split('.').pop()?.toLowerCase() || 'jpg';
      const key = `${outputPrefix}/thumbnail.${ext}`;
      try {
        await mediaService.copyInputToOutput(thumbnailInputKey, key);
        await Video.findByIdAndUpdate(video.id, { $set: { thumbnailKey: key } }).exec();
        touched = true;
      } catch (err) {
        logger.warn({ err, id: video.id }, 'Thumbnail copy to output bucket failed (skipped)');
      }
    }

    // MP4-first: copy the upload into the CDN (output) bucket so it's playable immediately.
    // HLS transcoding via MediaConvert is a later step (`processVideo`). All AWS steps are
    // non-fatal so the video is always saved.
    if (inputKey) {
      try {
        await mediaService.copyInputToOutput(inputKey, `${outputPrefix}/source.mp4`);
        await Video.findByIdAndUpdate(video.id, {
          $set: { mp4Key: `${outputPrefix}/source.mp4` },
        }).exec();
        touched = true;
      } catch (err) {
        logger.warn(
          { err, id: video.id },
          'MP4 copy to output bucket failed (no playback source yet)',
        );
      }
    }

    // Resource PDFs: copy each uploaded file from the input bucket into the video's
    // output folder so members can download it (via a presigned GET).
    if (resources?.length) {
      const pdfs: { title: string; key: string }[] = [];
      for (let i = 0; i < resources.length; i++) {
        const r = resources[i]!;
        const key = `${outputPrefix}/resources/${i + 1}-${r.title}`;
        try {
          await mediaService.copyInputToOutput(r.inputKey, key);
          pdfs.push({ title: r.title, key });
        } catch (err) {
          logger.warn({ err, id: video.id, title: r.title }, 'Resource PDF copy failed (skipped)');
        }
      }
      if (pdfs.length) {
        await Video.findByIdAndUpdate(video.id, { $set: { pdfResources: pdfs } }).exec();
        touched = true;
      }
    }

    return touched ? ((await Video.findById(video.id).exec()) as VideoDoc) : video;
  },

  async updateVideo(id: string, patch: UpdateVideoInput): Promise<VideoDoc> {
    const doc = await Video.findByIdAndUpdate(id, { $set: patch }, { new: true }).exec();
    if (!doc) throw ApiError.notFound('Video not found');
    return doc as VideoDoc;
  },

  async setPublished(id: string, published: boolean): Promise<VideoDoc> {
    return cmsService.updateVideo(id, { status: published ? 'published' : 'unpublished' });
  },

  async reorderVideos(items: ReorderItem[]): Promise<void> {
    if (!items.length) return;
    await Video.bulkWrite(
      items.map((i) => ({
        updateOne: { filter: { _id: i.id }, update: { $set: { order: i.order } } },
      })),
    );
  },

  async attachPdf(id: string, resource: { title: string; key: string }): Promise<VideoDoc> {
    const doc = await Video.findByIdAndUpdate(
      id,
      { $push: { pdfResources: resource } },
      { new: true },
    ).exec();
    if (!doc) throw ApiError.notFound('Video not found');
    return doc as VideoDoc;
  },

  // ---- AWS media ----
  /** Presigned S3 PUT URL for the admin to upload a source file directly. */
  async createUploadUrl(
    filename: string,
    contentType: string,
    sizeBytes: number,
    kind: UploadKind,
  ) {
    const key = `inputs/${randomUUID()}/${filename}`;
    return mediaService.createUploadUrl(key, contentType, sizeBytes, kind);
  },

  /** Same key scheme as the single PUT — one upload, many presigned parts. */
  async createMultipartUpload(
    filename: string,
    contentType: string,
    sizeBytes: number,
    kind: UploadKind,
  ) {
    const key = `inputs/${randomUUID()}/${filename}`;
    return mediaService.createMultipartUpload(key, contentType, sizeBytes, kind);
  },

  // ---- Transcript (Add-video wizard) ----
  /** Start an Amazon Transcribe job for an uploaded source. Returns the job name. */
  async startTranscript(inputKey: string): Promise<{ jobName: string }> {
    // Job names must be unique + safe; keep them tied to the uploaded object.
    const jobName = `wizard-${randomUUID()}`;
    logger.info({ inputKey, jobName }, '[transcribe] starting job');
    try {
      await mediaService.submitTranscription(inputKey, jobName, transcriptOutputKey(jobName));
    } catch (err) {
      const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
      logger.error(
        {
          name: e.name,
          status: e.$metadata?.httpStatusCode,
          message: e.message,
          inputKey,
          jobName,
        },
        '[transcribe] StartTranscriptionJob FAILED',
      );
      throw err;
    }
    logger.info({ jobName }, '[transcribe] job started OK');
    return { jobName };
  },

  /**
   * Poll a transcript job. While running, returns just the status; once COMPLETED,
   * fetches the Transcribe JSON from the output bucket and parses it into
   * timestamped segments for the editor.
   */
  async getTranscript(
    jobName: string,
  ): Promise<{ status: string; segments?: { startSec: number; text: string }[] }> {
    const status = await mediaService.getTranscriptionStatus(jobName);
    if (status !== 'COMPLETED') return { status };
    const json = await mediaService.getOutputJson(transcriptOutputKey(jobName));
    return { status, segments: parseTranscript(json) };
  },

  /**
   * Kick off transcode + transcription for an uploaded source. Sets the
   * expected output keys; production marks the video `ready` from the
   * MediaConvert completion event (Lambda). Requires AWS to be configured.
   */
  async processVideo(id: string, inputKey: string): Promise<VideoDoc> {
    const video = await Video.findById(id).exec();
    if (!video) throw ApiError.notFound('Video not found');
    await submitTranscodeJobs(id, inputKey);
    const doc = await Video.findByIdAndUpdate(
      id,
      { $set: { status: 'processing' } },
      { new: true },
    ).exec();
    return doc as VideoDoc;
  },
};

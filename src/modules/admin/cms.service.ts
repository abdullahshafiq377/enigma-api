import { randomUUID } from 'node:crypto';

import { logger } from '@/config/logger';
import { mediaService } from '@/modules/media/media.service';
import { Module, type ModuleDoc } from '@/modules/module/module.model';
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
}

export interface CreateVideoInput {
  moduleId: string;
  title: string;
  description?: string | undefined;
  order: number;
  tier: VideoTier;
  durationSec?: number | undefined;
  /** Save & publish (true) → published; otherwise saved as an unpublished draft. */
  publish?: boolean | undefined;
  /** S3 key of the uploaded source video → triggers MediaConvert + Transcribe. */
  inputKey?: string | undefined;
  /** Uploaded PDF resources (in the input bucket) to attach — copied to the output bucket on save. */
  resources?: { title: string; inputKey: string }[] | undefined;
}

export interface UpdateModuleInput {
  title?: string | undefined;
  slug?: string | undefined;
  order?: number | undefined;
  description?: string | undefined;
  isPublished?: boolean | undefined;
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
  videoCount: number;
  publishedCount: number;
  status: ModuleCmsStatus;
  updatedAt: Date;
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

  createModule(input: CreateModuleInput): Promise<ModuleDoc> {
    return Module.create({ isPublished: false, ...input }) as Promise<ModuleDoc>;
  },

  async updateModule(id: string, patch: UpdateModuleInput): Promise<ModuleDoc> {
    const doc = await Module.findByIdAndUpdate(id, { $set: patch }, { new: true }).exec();
    if (!doc) throw ApiError.notFound('Module not found');
    return doc as ModuleDoc;
  },

  async reorderModules(items: ReorderItem[]): Promise<void> {
    await Promise.all(items.map((i) => Module.updateOne({ _id: i.id }, { order: i.order }).exec()));
  },

  // ---- Videos ----
  listVideosByModule(moduleId: string): Promise<VideoDoc[]> {
    return Video.find({ moduleId }).sort({ order: 1 }).exec() as Promise<VideoDoc[]>;
  },

  async createVideo(input: CreateVideoInput): Promise<VideoDoc> {
    const { publish, inputKey, resources, ...fields } = input;
    const video = (await Video.create({
      ...fields,
      durationSec: fields.durationSec ?? 0,
      status: publish ? 'published' : 'unpublished',
    })) as VideoDoc;

    const outputPrefix = `videos/${video.id}`;
    let touched = false;

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
      try {
        await mediaService.submitTranscription(
          inputKey,
          `transcribe-${video.id}`,
          `${outputPrefix}/transcript.json`,
        );
        await Video.findByIdAndUpdate(video.id, {
          $set: { transcriptKey: `${outputPrefix}/transcript.json` },
        }).exec();
        touched = true;
      } catch (err) {
        logger.warn({ err, id: video.id }, 'Transcribe submit failed (no transcript yet)');
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
    await Promise.all(items.map((i) => Video.updateOne({ _id: i.id }, { order: i.order }).exec()));
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
  async createUploadUrl(filename: string, contentType: string) {
    const key = `inputs/${randomUUID()}/${filename}`;
    return mediaService.createUploadUrl(key, contentType);
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

import { type HydratedDocument, model, Schema, type Types } from 'mongoose';

export const VIDEO_TIERS = ['free', 'paid', 'partner'] as const;
export type VideoTier = (typeof VIDEO_TIERS)[number];

export const VIDEO_STATUSES = ['processing', 'ready', 'published', 'unpublished'] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export interface IChapter {
  startSec: number;
  title: string;
}

export interface IPdfResource {
  title: string;
  key: string;
}

export interface IVideo {
  moduleId: Types.ObjectId;
  title: string;
  description?: string | undefined;
  order: number;
  durationSec: number;
  tier: VideoTier;
  thumbnailKey?: string | undefined;
  hlsManifestKey?: string | undefined;
  /** Progressive MP4 in the output bucket — playable before HLS transcoding (MP4-first). */
  mp4Key?: string | undefined;
  status: VideoStatus;
  captionsKey?: string | undefined;
  transcriptKey?: string | undefined;
  chapters: IChapter[];
  pdfResources: IPdfResource[];
}

const videoSchema = new Schema<IVideo>(
  {
    moduleId: { type: Schema.Types.ObjectId, ref: 'Module', required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    order: { type: Number, required: true },
    durationSec: { type: Number, default: 0 },
    tier: { type: String, enum: VIDEO_TIERS, default: 'free', index: true },
    thumbnailKey: { type: String },
    hlsManifestKey: { type: String },
    mp4Key: { type: String },
    status: { type: String, enum: VIDEO_STATUSES, default: 'processing', index: true },
    captionsKey: { type: String },
    transcriptKey: { type: String },
    chapters: [{ startSec: Number, title: String }],
    pdfResources: [{ title: String, key: String }],
  },
  { timestamps: true },
);

videoSchema.index({ moduleId: 1, order: 1 });

export const Video = model<IVideo>('Video', videoSchema);
export type VideoDoc = HydratedDocument<IVideo> & { createdAt: Date; updatedAt: Date };

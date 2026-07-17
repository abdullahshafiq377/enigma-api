import { type HydratedDocument, model, Schema, type Types } from 'mongoose';

export const COMPLETION_TYPES = ['auto90', 'manual'] as const;
export type CompletionType = (typeof COMPLETION_TYPES)[number];

/** A merged [start, end] interval of seconds actually watched at normal speed. */
export interface IWatchedSegment {
  start: number;
  end: number;
}

export interface IProgress {
  userId: Types.ObjectId;
  videoId: Types.ObjectId;
  watchedSegments: IWatchedSegment[];
  coveragePct: number;
  lastPositionSec: number;
  completed: boolean;
  completedAt?: Date | undefined;
  completionType?: CompletionType | undefined;
}

const progressSchema = new Schema<IProgress>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    videoId: { type: Schema.Types.ObjectId, ref: 'Video', required: true },
    watchedSegments: [{ start: Number, end: Number }],
    coveragePct: { type: Number, default: 0 },
    lastPositionSec: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date },
    completionType: { type: String, enum: COMPLETION_TYPES },
  },
  { timestamps: true },
);

// One progress document per (user, video).
progressSchema.index({ userId: 1, videoId: 1 }, { unique: true });

export const Progress = model<IProgress>('Progress', progressSchema);
export type ProgressDoc = HydratedDocument<IProgress> & { createdAt: Date; updatedAt: Date };

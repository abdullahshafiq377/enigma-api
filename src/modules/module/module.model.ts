import { type HydratedDocument, model, Schema, type Types } from 'mongoose';

import { VIDEO_TIERS, type VideoTier } from '@/modules/video/video.model';

export interface IModule {
  title: string;
  slug: string;
  order: number;
  description?: string | undefined;
  coverAssetKey?: string | undefined;
  isPublished: boolean;
  /**
   * Core modules are the fixed top slots whose title is position-derived
   * ("Module 1"…"Module N"): the server relabels them to match their order on
   * every reorder, and they can only be reordered among themselves. Extra
   * modules (isCore=false) keep their own titles and live below the core block.
   */
  isCore: boolean;
  /**
   * Access tier the module belongs to. This is the source of truth for access:
   * every video in the module INHERITS this tier on creation, so the admin sets
   * access once per module rather than per video.
   */
  tier: VideoTier;
  /**
   * Partner modules can be narrowed to named Sovereign members. An empty array
   * is the dialog's "All selected" state — every Sovereign member. Meaningful
   * only while `tier === 'partner'`; stored, not yet enforced by access checks.
   */
  assignedUserIds: Types.ObjectId[];
  /** Seeded/system module — protected: the admin can't edit or delete it. */
  isSystem: boolean;
}

const moduleSchema = new Schema<IModule>(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true },
    order: { type: Number, required: true, index: true },
    description: { type: String, trim: true },
    coverAssetKey: { type: String, trim: true },
    isPublished: { type: Boolean, default: false },
    isCore: { type: Boolean, default: false },
    tier: { type: String, enum: VIDEO_TIERS, default: 'paid' },
    assignedUserIds: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Module = model<IModule>('Module', moduleSchema);
export type ModuleDoc = HydratedDocument<IModule> & { createdAt: Date; updatedAt: Date };

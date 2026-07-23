import { type HydratedDocument, model, Schema } from 'mongoose';

import { type Tier as TierEnum, TIERS } from '@/modules/user/user.types';

/**
 * A membership tier, stored as a row (mirror of the {@link TIERS} enum with a
 * human label) so tiers can be listed/managed without a code change. `enum` is
 * the stable machine key that gates content (mirrored into Clerk
 * `publicMetadata.tier`); users reference a tier via `tierId`.
 */
export interface ITier {
  title: string;
  enum: TierEnum;
}

const tierSchema = new Schema<ITier>(
  {
    title: { type: String, required: true, trim: true },
    enum: { type: String, required: true, enum: TIERS, unique: true, index: true },
  },
  { timestamps: true },
);

export const Tier = model<ITier>('Tier', tierSchema);

export type TierDoc = HydratedDocument<ITier> & { createdAt: Date; updatedAt: Date };

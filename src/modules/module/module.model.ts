import { type HydratedDocument, model, Schema } from 'mongoose';

export interface IModule {
  title: string;
  slug: string;
  order: number;
  description?: string | undefined;
  coverAssetKey?: string | undefined;
  isPublished: boolean;
}

const moduleSchema = new Schema<IModule>(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true },
    order: { type: Number, required: true, index: true },
    description: { type: String, trim: true },
    coverAssetKey: { type: String, trim: true },
    isPublished: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Module = model<IModule>('Module', moduleSchema);
export type ModuleDoc = HydratedDocument<IModule> & { createdAt: Date; updatedAt: Date };

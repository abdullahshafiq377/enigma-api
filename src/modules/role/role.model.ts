import { type HydratedDocument, model, Schema } from 'mongoose';

import { type Role as RoleEnum, ROLES } from '@/modules/user/user.types';

/**
 * A named authorization role, stored as a row so roles can be listed/managed
 * without a code change. `enum` is the stable machine key that code compares
 * against (mirrored into Clerk `publicMetadata.role` for JWT-based auth);
 * `title` is the human label. Users reference a role via `roleId`.
 */
export interface IRole {
  title: string;
  enum: RoleEnum;
}

const roleSchema = new Schema<IRole>(
  {
    title: { type: String, required: true, trim: true },
    enum: { type: String, required: true, enum: ROLES, unique: true, index: true },
  },
  { timestamps: true },
);

export const Role = model<IRole>('Role', roleSchema);

export type RoleDoc = HydratedDocument<IRole> & { createdAt: Date; updatedAt: Date };

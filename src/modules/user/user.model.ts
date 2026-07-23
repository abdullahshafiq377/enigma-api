import { type HydratedDocument, model, Schema } from 'mongoose';

import {
  INVITATION_STATUSES,
  type IUser,
  REGISTRATION_STATUSES,
  ROLES,
  TIERS,
} from '@/modules/user/user.types';

const userSchema = new Schema<IUser>(
  {
    // Optional + sparse-unique: invited rows have no clerkId until signup completes.
    clerkId: { type: String, unique: true, sparse: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    tier: { type: String, enum: TIERS, default: 'insight', index: true },
    role: { type: String, enum: ROLES, default: 'member' },
    // Relational refs to the Role/Tier rows (assignment source of truth); the
    // enum strings above are the synced cache read by auth/DTOs/filters.
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', index: true },
    tierId: { type: Schema.Types.ObjectId, ref: 'Tier', index: true },
    registrationStatus: {
      type: String,
      enum: REGISTRATION_STATUSES,
      default: 'completed',
      index: true,
    },
    invitationStatus: { type: String, enum: INVITATION_STATUSES, default: 'none', index: true },
    invitedAt: { type: Date },
    acceptedAt: { type: Date },
    clerkInvitationId: { type: String },
    resendCount: { type: Number, default: 0 },
    lastActiveAt: { type: Date },
  },
  { timestamps: true },
);

export const User = model<IUser>('User', userSchema);

/** Hydrated document, including the timestamps added by `{ timestamps: true }`. */
export type UserDoc = HydratedDocument<IUser> & { createdAt: Date; updatedAt: Date };

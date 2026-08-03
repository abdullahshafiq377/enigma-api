import { type HydratedDocument, model, Schema } from 'mongoose';

import { type IInvitation, INVITE_STATUSES } from '@/modules/invitation/invitation.types';
import { TIERS } from '@/modules/user/user.types';

const invitationSchema = new Schema<IInvitation>(
  {
    // One invitation row per email (re-inviting reuses the row + keeps a stable link).
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    fullName: { type: String, trim: true },
    company: { type: String, trim: true },
    tier: { type: String, enum: TIERS, required: true },
    invitedByAdmin: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: INVITE_STATUSES, default: 'invited', index: true },
    token: { type: String, required: true, unique: true, index: true },
    clerkInvitationId: { type: String },
    clerkTicket: { type: String },
    invitedAt: { type: Date },
    joinedAt: { type: Date },
  },
  { timestamps: true },
);

// Listing pending/joined invitations newest-first uses match(status) + sort(invitedAt).
invitationSchema.index({ status: 1, invitedAt: -1 });

export const Invitation = model<IInvitation>('Invitation', invitationSchema);

/** Hydrated document, including the timestamps added by `{ timestamps: true }`. */
export type InvitationDoc = HydratedDocument<IInvitation> & { createdAt: Date; updatedAt: Date };

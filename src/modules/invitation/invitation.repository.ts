import { Invitation, type InvitationDoc } from '@/modules/invitation/invitation.model';
import type { IInvitation } from '@/modules/invitation/invitation.types';

export const invitationRepository = {
  findByEmail(email: string): Promise<InvitationDoc | null> {
    return Invitation.findOne({ email: email.toLowerCase().trim() }).exec() as Promise<InvitationDoc | null>;
  },

  findByToken(token: string): Promise<InvitationDoc | null> {
    return Invitation.findOne({ token }).exec() as Promise<InvitationDoc | null>;
  },

  findByEmails(emails: string[]): Promise<InvitationDoc[]> {
    if (emails.length === 0) return Promise.resolve([]);
    const normalized = emails.map((e) => e.toLowerCase().trim());
    return Invitation.find({ email: { $in: normalized } }).exec() as Promise<InvitationDoc[]>;
  },

  /** Upsert by email so re-inviting the same person reuses the row (stable link). */
  upsertByEmail(email: string, data: Partial<IInvitation>): Promise<InvitationDoc> {
    return Invitation.findOneAndUpdate(
      { email: email.toLowerCase().trim() },
      { $set: data },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).exec() as Promise<InvitationDoc>;
  },
};

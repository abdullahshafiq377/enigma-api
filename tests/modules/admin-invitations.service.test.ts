import { beforeEach, describe, expect, it, vi } from 'vitest';

import { adminInvitationsService } from '@/modules/admin/admin-invitations.service';
import { User } from '@/modules/user/user.model';
import { userRepository } from '@/modules/user/user.repository';

// Stub Clerk's invitation API so send/resend paths run without network calls.
const createInvitation = vi.fn().mockResolvedValue({ id: 'inv_new' });
const revokeInvitation = vi.fn().mockResolvedValue({});
vi.mock('@clerk/express', () => ({
  clerkClient: {
    invitations: {
      get createInvitation() {
        return createInvitation;
      },
      get revokeInvitation() {
        return revokeInvitation;
      },
    },
  },
}));

async function seed(): Promise<void> {
  await User.create([
    // a completed member (direct sign-up)
    {
      clerkId: 'm1',
      email: 'member@x.com',
      tier: 'insight',
      registrationStatus: 'completed',
      invitationStatus: 'none',
    },
    // a pending invitation
    {
      email: 'pending@x.com',
      tier: 'mastery',
      registrationStatus: 'pending',
      invitationStatus: 'invited',
      clerkInvitationId: 'inv_old',
    },
  ]);
}

describe('adminInvitationsService.validateCsv (dry-run)', () => {
  beforeEach(seed);

  it('classifies invite / resend / already_member / invalid / duplicate', async () => {
    const csv = [
      'email,tier',
      'new@x.com,mastery', // invite
      'member@x.com,sovereign', // already_member
      'pending@x.com,sovereign', // resend
      'bad-email,insight', // invalid
      'new@x.com,insight', // duplicate (repeat of new@x.com)
    ].join('\n');

    const { rows } = await adminInvitationsService.validateCsv(csv, 'insight');
    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});

    expect(counts).toEqual({ invite: 1, already_member: 1, resend: 1, invalid: 1, duplicate: 1 });
    // dry-run must not create or send anything
    expect(await User.countDocuments()).toBe(2);
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it('defaults the tier to the import default when omitted (flags usedDefault)', async () => {
    const { rows } = await adminInvitationsService.validateCsv('email\nnew@x.com', 'insight');
    expect(rows[0]).toMatchObject({ status: 'invite', tier: 'insight', usedDefault: true });
  });

  it('looks up the whole CSV in ONE batched query (no per-row reads)', async () => {
    const batch = vi.spyOn(userRepository, 'findByEmails');
    const perRow = vi.spyOn(userRepository, 'findByEmail');
    const csv = ['email', 'a@x.com', 'b@x.com', 'c@x.com', 'member@x.com', 'pending@x.com'].join(
      '\n',
    );

    await adminInvitationsService.validateCsv(csv, 'insight');

    expect(batch).toHaveBeenCalledTimes(1); // single $in query for all 5 emails
    expect(perRow).not.toHaveBeenCalled();
    batch.mockRestore();
    perRow.mockRestore();
  });
});

describe('adminInvitationsService.sendFromCsv', () => {
  beforeEach(() => {
    createInvitation.mockClear();
    revokeInvitation.mockClear();
    createInvitation.mockResolvedValue({ id: 'inv_new' });
    return seed();
  });

  it('invites new emails, re-sends pending, skips members', async () => {
    const csv = [
      'email,tier',
      'new@x.com,mastery',
      'member@x.com,sovereign',
      'pending@x.com,sovereign',
    ].join('\n');

    const result = await adminInvitationsService.sendFromCsv(csv, 'insight');

    expect(result.invited).toEqual(['new@x.com']);
    expect(result.skipped).toEqual(['member@x.com']);
    expect(result.resent).toEqual(['pending@x.com']);
    expect(result.errors).toEqual([]);

    // a new invited row was created (pending / invited, no clerkId)
    const fresh = await User.findOne({ email: 'new@x.com' });
    expect(fresh?.registrationStatus).toBe('pending');
    expect(fresh?.invitationStatus).toBe('invited');
    expect(fresh?.clerkId).toBeUndefined();
    expect(fresh?.clerkInvitationId).toBe('inv_new');

    // the pending row was re-sent: old invitation revoked, tier updated, count bumped
    expect(revokeInvitation).toHaveBeenCalledWith('inv_old');
    const pending = await User.findOne({ email: 'pending@x.com' });
    expect(pending?.tier).toBe('sovereign');
    expect(pending?.resendCount).toBe(1);
    expect(pending?.clerkInvitationId).toBe('inv_new');

    expect(createInvitation).toHaveBeenCalledTimes(2); // new + resend
    expect(await User.countDocuments()).toBe(3); // member + pending + new (member not duplicated)
  });
});

describe('adminInvitationsService.resendOne / revokeOne', () => {
  beforeEach(() => {
    createInvitation.mockClear();
    revokeInvitation.mockClear();
    createInvitation.mockResolvedValue({ id: 'inv_resent' });
    return seed();
  });

  it('resends a pending invitation', async () => {
    const pending = await User.findOne({ email: 'pending@x.com' });
    await adminInvitationsService.resendOne(pending!.id);
    const after = await User.findOne({ email: 'pending@x.com' });
    expect(after?.resendCount).toBe(1);
    expect(after?.clerkInvitationId).toBe('inv_resent');
    expect(revokeInvitation).toHaveBeenCalledWith('inv_old');
  });

  it('rejects resend for a completed member', async () => {
    const member = await User.findOne({ email: 'member@x.com' });
    await expect(adminInvitationsService.resendOne(member!.id)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('revokes a pending invitation and removes the row', async () => {
    const pending = await User.findOne({ email: 'pending@x.com' });
    await adminInvitationsService.revokeOne(pending!.id);
    expect(revokeInvitation).toHaveBeenCalledWith('inv_old');
    expect(await User.findOne({ email: 'pending@x.com' })).toBeNull();
  });
});

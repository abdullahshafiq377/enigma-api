import { describe, expect, it } from 'vitest';

import { User } from '@/modules/user/user.model';
import { type ClerkUserData, userService } from '@/modules/user/user.service';

function clerkPayload(overrides: Partial<ClerkUserData> = {}): ClerkUserData {
  return {
    id: 'user_123',
    primary_email_address_id: 'idn_1',
    email_addresses: [{ id: 'idn_1', email_address: 'dana@enigma.test' }],
    first_name: 'Dana',
    last_name: 'Doe',
    public_metadata: { tier: 'mastery' },
    unsafe_metadata: { company: 'Acme', jobTitle: 'PM' },
    ...overrides,
  };
}

describe('userService.syncFromClerk', () => {
  it('creates a mirror user from a Clerk payload (self-signup → none)', async () => {
    const dto = await userService.syncFromClerk(clerkPayload());

    expect(dto.clerkId).toBe('user_123');
    expect(dto.email).toBe('dana@enigma.test');
    expect(dto.tier).toBe('mastery');
    expect(dto.company).toBe('Acme');
    expect(dto.registrationStatus).toBe('completed');
    expect(dto.invitationStatus).toBe('none');
    expect(await User.countDocuments()).toBe(1);
  });

  it('completes a pending invitation on signup (invited → registration_completed)', async () => {
    // A row created at invite time: no clerkId, pending, invited, tier pre-set.
    await User.create({
      email: 'dana@enigma.test',
      tier: 'sovereign',
      registrationStatus: 'pending',
      invitationStatus: 'invited',
      invitedAt: new Date(),
    });

    const dto = await userService.syncFromClerk(clerkPayload());

    expect(await User.countDocuments()).toBe(1); // reconciled, not duplicated
    expect(dto.clerkId).toBe('user_123');
    expect(dto.registrationStatus).toBe('completed');
    expect(dto.invitationStatus).toBe('registration_completed');
    expect(dto.acceptedAt).toBeInstanceOf(Date);
  });

  it('is idempotent — updates instead of duplicating on repeat', async () => {
    await userService.syncFromClerk(clerkPayload());
    await userService.syncFromClerk(clerkPayload({ first_name: 'Daniela' }));

    expect(await User.countDocuments()).toBe(1);
    const user = await User.findOne({ clerkId: 'user_123' });
    expect(user?.firstName).toBe('Daniela');
  });

  it('removes the mirror on delete', async () => {
    await userService.syncFromClerk(clerkPayload());
    await userService.removeByClerkId('user_123');
    expect(await User.countDocuments()).toBe(0);
  });
});

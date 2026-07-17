import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bulkCsvSchema } from '@/modules/admin/admin.validators';
import { adminUsersService, deriveStatus } from '@/modules/admin/admin-users.service';
import { User } from '@/modules/user/user.model';

// The service writes the tier to Clerk before mirroring to Mongo; stub Clerk so
// the write paths exercise the Mongo mirror without a network call.
const updateUserMetadata = vi.fn().mockResolvedValue({});
vi.mock('@clerk/express', () => ({
  clerkClient: {
    users: {
      get updateUserMetadata() {
        return updateUserMetadata;
      },
    },
  },
}));

const NOW = new Date('2026-06-24T12:00:00.000Z').getTime();
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000);

async function seed(): Promise<void> {
  await User.create([
    // active: tier + recent activity
    {
      clerkId: 'c1',
      email: 'ana@enigma.com',
      firstName: 'Ana',
      company: 'Acme',
      tier: 'insight',
      lastActiveAt: daysAgo(2),
    },
    // inactive: tier but stale activity
    {
      clerkId: 'c2',
      email: 'ben@beta.com',
      firstName: 'Ben',
      company: 'Beta',
      tier: 'mastery',
      lastActiveAt: daysAgo(40),
    },
    // invited: tier but never active
    { clerkId: 'c3', email: 'cara@enigma.com', firstName: 'Cara', tier: 'sovereign' },
    // active sovereign for tier-count coverage
    {
      clerkId: 'c4',
      email: 'dan@beta.com',
      firstName: 'Dan',
      company: 'Beta',
      tier: 'mastery',
      lastActiveAt: daysAgo(1),
    },
  ]);
}

describe('deriveStatus', () => {
  it('is missing_data without a tier', () => {
    expect(deriveStatus(undefined, 'completed', daysAgo(1), NOW)).toBe('missing_data');
  });
  it('is invited when registration is pending', () => {
    expect(deriveStatus('insight', 'pending', undefined, NOW)).toBe('invited');
  });
  it('is inactive when registered but no activity yet', () => {
    expect(deriveStatus('insight', 'completed', undefined, NOW)).toBe('inactive');
  });
  it('is active within the 7-day window', () => {
    expect(deriveStatus('insight', 'completed', daysAgo(3), NOW)).toBe('active');
  });
  it('is inactive past the 7-day window', () => {
    expect(deriveStatus('insight', 'completed', daysAgo(8), NOW)).toBe('inactive');
  });
});

describe('bulkCsvSchema', () => {
  it('defaults the import tier to insight when none is provided', () => {
    expect(bulkCsvSchema.parse({ csv: 'email\nana@enigma.com' }).defaultTier).toBe('insight');
  });
});

describe('adminUsersService.list', () => {
  beforeEach(seed);

  it('filters by tier', async () => {
    const { items } = await adminUsersService.list({ limit: 25, tier: 'mastery' }, NOW);
    expect(items.map((u) => u.email).sort()).toEqual(['ben@beta.com', 'dan@beta.com']);
  });

  it('searches across email/name/company (case-insensitive)', async () => {
    const { items } = await adminUsersService.list({ limit: 25, search: 'beta' }, NOW);
    expect(items).toHaveLength(2);
  });

  it('filters by derived status (active)', async () => {
    const { items } = await adminUsersService.list({ limit: 25, status: 'active' }, NOW);
    expect(items.every((u) => u.status === 'active')).toBe(true);
    expect(items.map((u) => u.email).sort()).toEqual(['ana@enigma.com', 'dan@beta.com']);
  });

  it('filters by derived status (invited = pending registration)', async () => {
    await User.create({
      email: 'pending@x.com',
      tier: 'insight',
      registrationStatus: 'pending',
      invitationStatus: 'invited',
    });
    const { items } = await adminUsersService.list({ limit: 25, status: 'invited' }, NOW);
    expect(items.map((u) => u.email)).toEqual(['pending@x.com']);
  });

  it('filters by origin (invitationStatus)', async () => {
    await User.create([
      {
        email: 'inv@x.com',
        tier: 'insight',
        registrationStatus: 'pending',
        invitationStatus: 'invited',
      },
      {
        clerkId: 'rc1',
        email: 'reg@x.com',
        tier: 'mastery',
        registrationStatus: 'completed',
        invitationStatus: 'registration_completed',
      },
    ]);
    const invited = await adminUsersService.list({ limit: 25, origin: 'invited' }, NOW);
    expect(invited.items.map((u) => u.email)).toEqual(['inv@x.com']);

    const fromInvite = await adminUsersService.list(
      { limit: 25, origin: 'registration_completed' },
      NOW,
    );
    expect(fromInvite.items.map((u) => u.email)).toEqual(['reg@x.com']);

    // The 4 seeded users are all direct sign-ups (invitationStatus default 'none').
    const direct = await adminUsersService.list({ limit: 25, origin: 'none' }, NOW);
    expect(direct.items).toHaveLength(4);
  });

  it('filters by last-active window', async () => {
    const { items } = await adminUsersService.list({ limit: 25, lastActive: '7d' }, NOW);
    expect(items.map((u) => u.email).sort()).toEqual(['ana@enigma.com', 'dan@beta.com']);
  });

  it('paginates with a cursor', async () => {
    const first = await adminUsersService.list({ limit: 2 }, NOW);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await adminUsersService.list({ limit: 2, cursor: first.nextCursor! }, NOW);
    const seen = new Set([...first.items, ...second.items].map((u) => u.id));
    expect(seen.size).toBe(4); // no overlap across pages
  });
});

describe('adminUsersService.stats', () => {
  beforeEach(seed);

  it('counts totals, tiers, and recently active', async () => {
    const s = await adminUsersService.stats(NOW);
    expect(s.total).toBe(4);
    expect(s.byTier).toEqual({ insight: 1, mastery: 2, sovereign: 1 });
    expect(s.recentlyActive).toBe(2); // ana + dan within 7d
  });
});

describe('adminUsersService.validateCsv (dry-run)', () => {
  beforeEach(seed);

  it('classifies each row without mutating data', async () => {
    const csv = [
      'email,tier',
      'ana@enigma.com,sovereign', // ok (insight -> sovereign)
      'ben@beta.com,mastery', // unchanged (already mastery)
      'ghost@nowhere.com,insight', // not_found
      'not-an-email,insight', // invalid email
      'cara@enigma.com,platinum', // invalid tier
    ].join('\n');

    const { rows } = await adminUsersService.validateCsv(csv, 'mastery');
    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r]));

    expect(byEmail['ana@enigma.com']?.status).toBe('ok');
    expect(byEmail['ben@beta.com']?.status).toBe('unchanged');
    expect(byEmail['ghost@nowhere.com']?.status).toBe('not_found');
    expect(byEmail['not-an-email']?.status).toBe('invalid');
    expect(byEmail['cara@enigma.com']?.status).toBe('invalid');

    // dry-run must not change anything
    expect((await User.findOne({ email: 'ana@enigma.com' }))?.tier).toBe('insight');
    expect(updateUserMetadata).not.toHaveBeenCalled();
  });

  it('applies the default tier when a row omits one and flags usedDefault', async () => {
    const { rows } = await adminUsersService.validateCsv('email\nana@enigma.com', 'sovereign');
    expect(rows[0]).toMatchObject({
      email: 'ana@enigma.com',
      newTier: 'sovereign',
      status: 'ok',
      usedDefault: true,
    });
  });

  it('accepts tier values case-insensitively', async () => {
    const { rows } = await adminUsersService.validateCsv(
      'email,tier\nana@enigma.com,Sovereign',
      'mastery',
    );
    expect(rows[0]).toMatchObject({ newTier: 'sovereign', status: 'ok' });
    expect(rows[0]?.usedDefault).toBeUndefined();
  });

  it('flags repeated emails as duplicates (first wins)', async () => {
    const csv = ['email,tier', 'ana@enigma.com,sovereign', 'ana@enigma.com,mastery'].join('\n');
    const { rows } = await adminUsersService.validateCsv(csv, 'mastery');
    expect(rows[0]?.status).toBe('ok');
    expect(rows[1]?.status).toBe('duplicate');
  });
});

describe('adminUsersService.bulkAssignFromCsv', () => {
  beforeEach(() => {
    updateUserMetadata.mockClear();
    return seed();
  });

  it('applies ok rows, skips not-found, reports invalid', async () => {
    const csv = [
      'email,tier',
      'ana@enigma.com,sovereign',
      'ghost@nowhere.com,insight',
      'not-an-email,insight',
    ].join('\n');

    const result = await adminUsersService.bulkAssignFromCsv(csv, 'mastery');
    expect(result.updated).toBe(1);
    expect(result.skipped).toEqual(['ghost@nowhere.com']);
    expect(result.errors).toEqual(['not-an-email']);
    expect((await User.findOne({ email: 'ana@enigma.com' }))?.tier).toBe('sovereign');
    expect(updateUserMetadata).toHaveBeenCalledTimes(1);
  });
});

describe('adminUsersService.exportCsv', () => {
  beforeEach(seed);

  it('exports the filtered list as CSV with a header row', async () => {
    const csv = await adminUsersService.exportCsv({ tier: 'mastery' }, NOW);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'email,firstName,lastName,company,tier,role,status,invitationStatus,lastActiveAt',
    );
    expect(lines).toHaveLength(3); // header + ben + dan
    expect(csv).toContain('ben@beta.com');
    expect(csv).toContain('dan@beta.com');
    expect(csv).not.toContain('ana@enigma.com');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';

import { bulkAccessService } from '@/modules/admin/bulk-access.service';
import { User } from '@/modules/user/user.model';

async function seed(): Promise<void> {
  await User.create([
    {
      clerkId: 'm1',
      email: 'member@x.com',
      tier: 'insight',
      registrationStatus: 'completed',
      invitationStatus: 'none',
    },
  ]);
}

describe('bulkAccessService.validate — tier value review', () => {
  beforeEach(seed);

  it('counts every row carrying an unrecognized value, including ones skipped for other reasons', async () => {
    // "Pro" appears twice, but the second row repeats an email already seen, so
    // it is dropped as a duplicate. The review card answers "what is in the
    // file", so both rows still count towards the value.
    const csv = [
      'email,tier',
      'a@x.com,Mastery',
      'b@x.com,Pro',
      'a@x.com,Mastery', // duplicate email
      'b@x.com,Pro', // duplicate email, and the second "Pro"
    ].join('\n');

    const { rows, unrecognizedTiers } = await bulkAccessService.validate(csv);

    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.message === 'Duplicate row in file')).toHaveLength(2);
    expect(unrecognizedTiers).toEqual([{ value: 'Pro', rows: 2 }]);
  });

  it('groups an unrecognized value case-insensitively, keeping the first spelling', async () => {
    // rowTier looks assignments up lowercased, so "Pro" and "pro" are one value
    // to assign — they have to be one row in the list too.
    const csv = ['email,tier', 'a@x.com,Pro', 'b@x.com,pro', 'c@x.com,PRO'].join('\n');

    const { unrecognizedTiers } = await bulkAccessService.validate(csv);

    expect(unrecognizedTiers).toEqual([{ value: 'Pro', rows: 3 }]);
  });

  it('drops a value from the list once it has been assigned', async () => {
    const csv = ['email,tier', 'a@x.com,Pro', 'b@x.com,Gold'].join('\n');

    const { rows, unrecognizedTiers } = await bulkAccessService.validate(csv, {
      tierValues: { pro: 'mastery' },
    });

    expect(unrecognizedTiers).toEqual([{ value: 'Gold', rows: 1 }]);
    expect(rows[0]).toMatchObject({ email: 'a@x.com', newTier: 'mastery' });
    expect(rows[1]).toMatchObject({ email: 'b@x.com', status: 'skip' });
  });

  it('reports nothing to review when every value is a tier keyword', async () => {
    const csv = [
      'email,tier',
      'a@x.com,Insight',
      'b@x.com,Free',
      'c@x.com,Mastery',
      'd@x.com,Paid',
      'e@x.com,Sovereign',
      'f@x.com,Partner',
    ].join('\n');

    const { unrecognizedTiers } = await bulkAccessService.validate(csv);

    expect(unrecognizedTiers).toEqual([]);
  });

  it('calls a header exact only when it IS the field name, and a synonym fuzzy', async () => {
    // 959:647 draws this file: Company matches word for word, Full Name and
    // Access Tier resolve just as confidently but are not the same words.
    const csv = ['full name,email,access tier,company', 'Ada,a@x.com,Insight,Acme'].join('\n');

    const { columns } = await bulkAccessService.validate(csv);

    expect(columns.email).toEqual({ header: 'email', match: 'exact' });
    expect(columns.company).toEqual({ header: 'company', match: 'exact' });
    expect(columns.name).toEqual({ header: 'full name', match: 'fuzzy' });
    expect(columns.tier).toEqual({ header: 'access tier', match: 'fuzzy' });
  });

  it('prefers the field name over a synonym that appears earlier in the file', async () => {
    const csv = ['work email,email,tier', 'nope@x.com,a@x.com,Insight'].join('\n');

    const { columns, rows } = await bulkAccessService.validate(csv);

    expect(columns.email).toEqual({ header: 'email', match: 'exact' });
    expect(rows[0]).toMatchObject({ email: 'a@x.com' });
  });

  it('falls back to the regex when neither the name nor a synonym is present', async () => {
    const csv = ['contact e-mail,membership level', 'a@x.com,Insight'].join('\n');

    const { columns } = await bulkAccessService.validate(csv);

    expect(columns.email).toEqual({ header: 'contact e-mail', match: 'fuzzy' });
    expect(columns.tier).toEqual({ header: 'membership level', match: 'fuzzy' });
  });

  it('reads the tier from an admin override rather than the auto-detected column', async () => {
    // Auto-detection would take "level" for the tier (its matcher includes
    // `level`); the override points it at "plan" instead.
    const csv = ['email,level,plan', 'a@x.com,Gold,Mastery'].join('\n');

    const auto = await bulkAccessService.validate(csv);
    expect(auto.unrecognizedTiers).toEqual([{ value: 'Gold', rows: 1 }]);

    const mapped = await bulkAccessService.validate(csv, { mapping: { tier: 'plan' } });
    expect(mapped.unrecognizedTiers).toEqual([]);
    expect(mapped.columns.tier).toEqual({ header: 'plan', match: 'manual' });
    expect(mapped.rows[0]).toMatchObject({ newTier: 'mastery' });
  });
});

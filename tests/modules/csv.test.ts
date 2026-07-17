import { describe, expect, it } from 'vitest';

import { parseCsv, toCsv } from '@/modules/admin/csv';

describe('parseCsv', () => {
  it('parses header + rows keyed by lower-cased header', () => {
    const rows = parseCsv('Email,Tier\nana@x.com,mastery\nben@y.com,partner');
    expect(rows).toEqual([
      { email: 'ana@x.com', tier: 'mastery' },
      { email: 'ben@y.com', tier: 'partner' },
    ]);
  });

  it('honors quoted fields containing commas', () => {
    const rows = parseCsv('email,note\n"a@x.com","hello, world"');
    expect(rows[0]).toEqual({ email: 'a@x.com', note: 'hello, world' });
  });

  it('skips blank lines and returns [] when no data rows', () => {
    expect(parseCsv('email,tier\n\n')).toEqual([]);
  });
});

describe('toCsv', () => {
  it('serializes rows with a header and escapes special chars', () => {
    const csv = toCsv([{ email: 'a@x.com', name: 'Doe, A' }], ['email', 'name']);
    expect(csv).toBe('email,name\na@x.com,"Doe, A"');
  });
});

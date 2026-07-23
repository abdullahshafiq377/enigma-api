import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '@/app';
import { User } from '@/modules/user/user.model';
import { userService } from '@/modules/user/user.service';

const app = createApp();

async function seedUsers(): Promise<void> {
  await User.create([
    { clerkId: 'c1', email: 'ana@enigma.test', firstName: 'Ana', tier: 'insight' },
    { clerkId: 'c2', email: 'ben@acme.test', firstName: 'Ben', tier: 'mastery' },
    { clerkId: 'c3', email: 'cara@enigma.test', firstName: 'Cara', tier: 'sovereign' },
  ]);
}

describe('userService', () => {
  beforeEach(seedUsers);

  it('lists users with a cursor page', async () => {
    const page = await userService.list({ limit: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();
  });

  it('filters by tier', async () => {
    const page = await userService.list({ limit: 25, tier: 'mastery' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.email).toBe('ben@acme.test');
  });

  it('searches by name/email (case-insensitive)', async () => {
    const page = await userService.list({ limit: 25, search: 'acme' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.firstName).toBe('Ben');
  });

  it('throws 404 for a missing id', async () => {
    await expect(userService.getById('64b7f0000000000000000000')).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('GET /v1/users', () => {
  beforeEach(seedUsers);

  it('returns the success envelope with meta', async () => {
    const res = await request(app).get('/v1/users?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.error).toBeNull();
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.limit).toBe(2);
  });

  it('rejects an invalid id with 400', async () => {
    const res = await request(app).get('/v1/users/not-an-objectid');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Validation failed');
  });
});

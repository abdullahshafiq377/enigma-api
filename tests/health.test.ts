import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '@/app';

const app = createApp();

describe('GET /health', () => {
  it('returns ok with the response envelope', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.error).toBeNull();
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.database).toBe('connected');
  });
});

describe('unknown routes', () => {
  it('returns a 404 failure envelope', async () => {
    const res = await request(app).get('/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.data).toBeNull();
    expect(res.body.error.message).toContain('Route not found');
  });
});

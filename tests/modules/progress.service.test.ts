import { Types } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';

import { progressService } from '@/modules/progress/progress.service';

let userId: string;
let videoId: string;

beforeEach(() => {
  userId = new Types.ObjectId().toString();
  videoId = new Types.ObjectId().toString();
});

describe('progressService.recordHeartbeat', () => {
  it('records coverage from watched segments', async () => {
    const res = await progressService.recordHeartbeat(userId, videoId, {
      segments: [{ start: 0, end: 30 }],
      lastPositionSec: 30,
      durationSec: 100,
    });
    expect(res.coveragePct).toBeCloseTo(0.3);
    expect(res.completed).toBe(false);
  });

  it('auto-completes at ≥90% real coverage', async () => {
    // First (new) heartbeat is trusted; 95% coverage triggers auto-complete.
    const res = await progressService.recordHeartbeat(userId, videoId, {
      segments: [{ start: 0, end: 95 }],
      lastPositionSec: 95,
      durationSec: 100,
    });
    expect(res.coveragePct).toBeGreaterThanOrEqual(0.9);
    expect(res.completed).toBe(true);
  });

  it('accumulates coverage across realistically-spaced heartbeats', async () => {
    const t0 = Date.now();
    await progressService.recordHeartbeat(
      userId,
      videoId,
      { segments: [{ start: 0, end: 50 }], lastPositionSec: 50, durationSec: 100 },
      t0,
    );
    // ~50s later, watching the next 45s is plausible at normal speed.
    const res = await progressService.recordHeartbeat(
      userId,
      videoId,
      { segments: [{ start: 50, end: 95 }], lastPositionSec: 95, durationSec: 100 },
      t0 + 50_000,
    );
    expect(res.coveragePct).toBeGreaterThanOrEqual(0.9);
    expect(res.completed).toBe(true);
  });

  it('rejects an implausible coverage jump (anti-cheat)', async () => {
    const t0 = Date.now();
    await progressService.recordHeartbeat(
      userId,
      videoId,
      { segments: [{ start: 0, end: 5 }], lastPositionSec: 5, durationSec: 1000 },
      t0,
    );
    // 10s later, claim to have watched 0..1000 — impossible at ≤2x speed.
    const res = await progressService.recordHeartbeat(
      userId,
      videoId,
      { segments: [{ start: 0, end: 1000 }], lastPositionSec: 1000, durationSec: 1000 },
      t0 + 10_000,
    );
    // The fraudulent segment is dropped; coverage stays near the first heartbeat.
    expect(res.coveragePct).toBeLessThan(0.1);
  });
});

describe('progressService.markComplete', () => {
  it('marks a video complete manually', async () => {
    const res = await progressService.markComplete(userId, videoId);
    expect(res.completed).toBe(true);
  });
});

import { type Types } from 'mongoose';
import { beforeEach, describe, expect, it } from 'vitest';

import { analyticsService } from '@/modules/admin/analytics.service';
import { Certificate } from '@/modules/certificate/certificate.model';
import { Event } from '@/modules/event/event.model';
import { Module } from '@/modules/module/module.model';
import { Progress } from '@/modules/progress/progress.model';
import { User } from '@/modules/user/user.model';
import { Video } from '@/modules/video/video.model';

let u1: Types.ObjectId;
let u2: Types.ObjectId;
let m1: Types.ObjectId;
let v1: Types.ObjectId;

beforeEach(async () => {
  const a = await User.create({ clerkId: 'a', email: 'a@x.com', tier: 'insight' });
  const b = await User.create({ clerkId: 'b', email: 'b@x.com', tier: 'mastery' });
  u1 = a._id;
  u2 = b._id;

  const mod = await Module.create({ title: 'Module 1', slug: 'm1', order: 1, isPublished: true });
  m1 = mod._id;
  const vid = await Video.create({
    moduleId: m1,
    title: 'V1',
    order: 1,
    tier: 'free',
    status: 'published',
  });
  v1 = vid._id;

  await Progress.create({
    userId: u1,
    videoId: v1,
    coveragePct: 0.8,
    completed: true,
    completedAt: new Date(),
  });
  await Progress.create({ userId: u2, videoId: v1, coveragePct: 0.4, completed: false });

  await Certificate.create({
    userId: u1,
    moduleId: m1,
    recipientName: 'A',
    pdfKey: 'k',
    issuedAt: new Date(),
  });
  await Event.create({ userId: u1, type: 'cert_download', at: new Date() });
});

describe('analyticsService', () => {
  it('overview counts users by tier, certs issued + downloaded', async () => {
    const o = await analyticsService.overview();
    expect(o.totalUsers).toBe(2);
    expect(o.usersByTier.insight).toBe(1);
    expect(o.usersByTier.mastery).toBe(1);
    expect(o.certificatesIssued).toBe(1);
    expect(o.certificateDownloads).toBe(1);
  });

  it('certificateStats reports downloads by tier', async () => {
    const c = await analyticsService.certificateStats();
    expect(c.generated).toBe(1);
    expect(c.downloads).toBe(1);
    expect(c.byTier.insight).toBe(1);
    expect(c.byTier.mastery).toBe(0);
  });

  it('videoRankings includes views, avg completion, and tier', async () => {
    const r = await analyticsService.videoRankings();
    const top = r.top[0];
    expect(top?.views).toBe(2);
    expect(top?.avgCompletion).toBe(60); // avg(0.8, 0.4) = 0.6
    expect(top?.tier).toBe('free');
  });

  it('moduleCompletion computes rate', async () => {
    const mc = await analyticsService.moduleCompletion();
    expect(mc[0]).toMatchObject({ started: 2, completed: 1, completionRate: 50 });
  });

  it('activity returns bucketed series', async () => {
    const a = await analyticsService.activity('week');
    expect(a.length).toBeGreaterThanOrEqual(1);
    const total = a.reduce((s, b) => s + b.activeUsers, 0);
    expect(total).toBeGreaterThanOrEqual(1);
  });
});

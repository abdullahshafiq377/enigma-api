import { Types } from 'mongoose';

import { connectDatabase, disconnectDatabase } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { Certificate } from '@/modules/certificate/certificate.model';
import { Event } from '@/modules/event/event.model';
import { Progress } from '@/modules/progress/progress.model';
import { User } from '@/modules/user/user.model';
import { type Tier } from '@/modules/user/user.types';
import { canAccessVideo } from '@/modules/video/access';
import { Video } from '@/modules/video/video.model';

/**
 * Seeds synthetic analytics data so the admin dashboard is populated:
 * members (by tier) + watch progress + completions + certificates + downloads,
 * dated across the last ~4 weeks so the activity timeline shows multiple bars.
 *
 * Dev-only + idempotent: clears synthetic users (clerkId `seed_*`) and ALL
 * progress/certificates/events, then regenerates. Does NOT touch real
 * (Clerk-synced) users. Requires `npm run seed` first (modules + videos).
 *
 * Usage: npm run seed-analytics
 */
const USER_COUNT = 120;
const TIER_WEIGHTS: Array<[Tier, number]> = [
  ['insight', 70],
  ['mastery', 25],
  ['sovereign', 5],
];

const rand = (min: number, max: number) => Math.random() * (max - min) + min;
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

function pickTier(): Tier {
  const total = TIER_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rand(0, total);
  for (const [tier, w] of TIER_WEIGHTS) {
    if (r < w) return tier;
    r -= w;
  }
  return 'insight';
}

async function run(): Promise<void> {
  if (env.isProduction) throw new Error('Refusing to seed in production');
  await connectDatabase();

  await Promise.all([
    User.deleteMany({ clerkId: { $regex: '^seed_' } }),
    Progress.deleteMany({}),
    Certificate.deleteMany({}),
    Event.deleteMany({}),
  ]);
  logger.info('Cleared synthetic users + all progress/certificates/events');

  const videos = await Video.find({ status: 'published' }).exec();
  if (videos.length === 0) {
    logger.error('No published videos. Run `npm run seed` first.');
    await disconnectDatabase();
    process.exit(1);
  }

  type Vid = (typeof videos)[number];
  const byModule = new Map<string, Vid[]>();
  for (const v of videos) {
    const key = v.moduleId.toString();
    const list = byModule.get(key) ?? [];
    list.push(v);
    byModule.set(key, list);
  }

  // Synthetic members
  const userDocs = Array.from({ length: USER_COUNT }, (_, i) => ({
    clerkId: `seed_user_${i}`,
    email: `member${i}@seed.enigma`,
    firstName: `Member${i}`,
    lastName: 'Seed',
    tier: pickTier(),
    role: 'member' as const,
    lastActiveAt: daysAgo(randInt(0, 28)),
  }));
  const users = await User.insertMany(userDocs);

  const progressRaw: Record<string, unknown>[] = [];
  const certRaw: Record<string, unknown>[] = [];
  const eventRaw: Record<string, unknown>[] = [];

  for (const u of users) {
    const accessible = videos.filter((v) => canAccessVideo(u.tier, v.tier));

    // Modules the user can fully access (every video reachable) → eligible to complete.
    const fullyAccessible = [...byModule.entries()]
      .filter(([, vids]) => vids.length > 0 && vids.every((v) => canAccessVideo(u.tier, v.tier)))
      .map(([id]) => id);
    const toComplete = new Set(
      [...fullyAccessible]
        .sort(() => Math.random() - 0.5)
        .slice(0, randInt(0, Math.min(3, fullyAccessible.length))),
    );

    const completedPerModule = new Map<string, number>();

    for (const v of accessible) {
      const inCompletedModule = toComplete.has(v.moduleId.toString());
      // Skip ~40% of non-completed videos so watch counts vary.
      if (!inCompletedModule && Math.random() < 0.4) continue;

      const coverage = inCompletedModule
        ? Math.round(rand(0.9, 1) * 100) / 100
        : Math.round(rand(0.1, 0.95) * 100) / 100;
      const completed = coverage >= 0.9;
      const when = daysAgo(randInt(0, 28));
      progressRaw.push({
        _id: new Types.ObjectId(),
        userId: u._id,
        videoId: v._id,
        watchedSegments: [{ start: 0, end: Math.round(v.durationSec * coverage) }],
        coveragePct: coverage,
        lastPositionSec: Math.round(v.durationSec * coverage),
        completed,
        ...(completed ? { completedAt: when, completionType: 'auto90' } : {}),
        createdAt: when,
        updatedAt: when,
        __v: 0,
      });
      if (completed) {
        const key = v.moduleId.toString();
        completedPerModule.set(key, (completedPerModule.get(key) ?? 0) + 1);
      }
    }

    // Certificate when every video in a module is completed
    for (const [moduleId, vids] of byModule) {
      if (vids.length > 0 && completedPerModule.get(moduleId) === vids.length) {
        const issuedAt = daysAgo(randInt(0, 28));
        certRaw.push({
          _id: new Types.ObjectId(),
          userId: u._id,
          moduleId: new Types.ObjectId(moduleId),
          recipientName: `${u.firstName} ${u.lastName}`,
          issuedAt,
          pdfKey: `certificates/${u._id.toString()}/${moduleId}.pdf`,
          createdAt: issuedAt,
          updatedAt: issuedAt,
          __v: 0,
        });
        if (Math.random() < 0.7) {
          const at = daysAgo(randInt(0, 28));
          eventRaw.push({
            _id: new Types.ObjectId(),
            userId: u._id,
            type: 'cert_download',
            at,
            meta: { moduleId },
            createdAt: at,
            updatedAt: at,
            __v: 0,
          });
        }
      }
    }
  }

  if (progressRaw.length) await Progress.collection.insertMany(progressRaw);
  if (certRaw.length) await Certificate.collection.insertMany(certRaw);
  if (eventRaw.length) await Event.collection.insertMany(eventRaw);

  logger.info(
    `Seeded ${users.length} members, ${progressRaw.length} progress, ${certRaw.length} certificates, ${eventRaw.length} cert downloads`,
  );
  await disconnectDatabase();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'seed-analytics failed');
    process.exit(1);
  });

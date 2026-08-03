import { connectDatabase, disconnectDatabase } from '@/config/db';
import { logger } from '@/config/logger';
import { Module } from '@/modules/module/module.model';
import { Progress } from '@/modules/progress/progress.model';
import { Role } from '@/modules/role/role.model';
import { Tier } from '@/modules/tier/tier.model';
import { User } from '@/modules/user/user.model';
import type { Tier as TierEnum } from '@/modules/user/user.types';
import { Video } from '@/modules/video/video.model';

/**
 * Seed 50 demo users covering EVERY admin scenario, so the Users screen shows
 * the full range: all tiers (insight/mastery/sovereign) + missing-tier,
 * all statuses (active / inactive / invited / missing_data), member + admin
 * roles, with and without company/job title, and last-active dates across the
 * 7/30/90-day filters (plus never-active).
 *
 * Idempotent: clears prior demo users (…@enigma-seed.test) first, so it's safe
 * to re-run. Real accounts (other domains) are never touched.
 *
 * Status is DERIVED by the API (admin-users.service.deriveStatus):
 *   no tier → missing_data · registrationStatus 'pending' → invited ·
 *   no lastActiveAt or >7d → inactive · lastActiveAt ≤7d → active.
 *
 * Usage: npm run seed-users
 */

const SEED_DOMAIN = 'enigma-seed.test';
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

const FIRST = [
  'Ava', 'Liam', 'Noah', 'Emma', 'Olivia', 'Ethan', 'Sophia', 'Mason', 'Isabella', 'Lucas',
  'Mia', 'Amelia', 'James', 'Harper', 'Benjamin', 'Evelyn', 'Elijah', 'Charlotte', 'Henry', 'Aria',
  'Jack', 'Grace', 'Leo', 'Chloe', 'Owen', 'Zoe', 'Nathan', 'Lily', 'Caleb', 'Nora',
];
const LAST = [
  'Carter', 'Reed', 'Blake', 'Nash', 'Vance', 'Frost', 'Holt', 'Pike', 'Sloan', 'Wren',
  'Cole', 'Dane', 'Ford', 'Hale', 'Knox', 'Lane', 'Mercer', 'Payne', 'Quinn', 'Rowe',
  'Stone', 'Tate', 'Vaughn', 'Webb', 'York', 'Ash', 'Boone', 'Cross', 'Dunn', 'Ellis',
];
const COMPANIES = [
  'Northwind', 'Acme Labs', 'Vertex', 'Lumen', 'Contoso', 'Helix', 'Aster', 'Beacon', 'Cobalt', 'Delta Works',
];
const TITLES = ['Analyst', 'Engineer', 'Security Lead', 'Consultant', 'Researcher', 'Manager', 'Architect', 'Specialist'];

const TIERS: TierEnum[] = ['insight', 'mastery', 'sovereign'];

async function run(): Promise<void> {
  await connectDatabase();
  logger.info(`Seeding into DB "${User.db.name}"…`);

  // Resolve role/tier ids so demo users match the RBAC structure (optional —
  // omitted if seed-rbac hasn't been run yet).
  const roleDocs = await Role.find().lean();
  const tierDocs = await Tier.find().lean();
  const roleRef = (e: string) => {
    const id = roleDocs.find((r) => r.enum === e)?._id;
    return id ? { roleId: id } : {};
  };
  const tierRef = (e: string) => {
    const id = tierDocs.find((t) => t.enum === e)?._id;
    return id ? { tierId: id } : {};
  };

  // Remove prior demo users AND their progress (real accounts are untouched).
  const priorIds = (
    await User.find({ email: new RegExp(`@${SEED_DOMAIN}$`) })
      .select('_id')
      .lean()
  ).map((u) => u._id);
  if (priorIds.length) await Progress.deleteMany({ userId: { $in: priorIds } });
  const del = await User.collection.deleteMany({ email: new RegExp(`@${SEED_DOMAIN}$`) });
  if (del.deletedCount) logger.warn(`Removed ${del.deletedCount} prior demo user(s).`);

  const docs: Record<string, unknown>[] = [];
  for (let i = 0; i < 50; i++) {
    const firstName = FIRST[i % FIRST.length];
    const lastName = LAST[(i * 7) % LAST.length];
    const email = `${firstName}.${lastName}.${i}`.toLowerCase() + `@${SEED_DOMAIN}`;
    // ~80% have company/title, mimicking real signups.
    const org =
      i % 5 !== 0
        ? { company: COMPANIES[i % COMPANIES.length], jobTitle: TITLES[i % TITLES.length] }
        : {};
    const createdAt = daysAgo(20 + ((i * 13) % 700));
    const base: Record<string, unknown> = {
      email,
      firstName,
      lastName,
      ...org,
      role: 'member',
      ...roleRef('member'),
      registrationStatus: 'completed',
      invitationStatus: 'none',
      resendCount: 0,
      createdAt,
      updatedAt: createdAt,
    };

    if (i < 3) {
      // 0–2: admins — sovereign, recently active.
      docs.push({
        ...base,
        role: 'admin',
        ...roleRef('admin'),
        tier: 'sovereign',
        ...tierRef('sovereign'),
        lastActiveAt: daysAgo(i),
      });
    } else if (i < 6) {
      // 3–5: missing tier (no tier field) → status "missing_data".
      docs.push(base);
    } else if (i < 11) {
      // 6–10: invited (pending registration, no clerkId) → status "invited".
      const tier = TIERS[i % 3] as TierEnum;
      docs.push({
        ...base,
        tier,
        ...tierRef(tier),
        registrationStatus: 'pending',
        invitationStatus: 'invited',
        invitedAt: daysAgo(i),
        resendCount: i % 3,
      });
    } else {
      // 11–49: members across tiers with a spread of last-active dates.
      const tier = TIERS[i % 3] as TierEnum;
      const bucket = i % 5;
      const lastActive =
        bucket === 0
          ? { lastActiveAt: daysAgo(i % 7) } // active (≤7d)
          : bucket === 1
            ? { lastActiveAt: daysAgo(8 + (i % 20)) } // inactive, ≤30d
            : bucket === 2
              ? { lastActiveAt: daysAgo(35 + (i % 50)) } // inactive, ≤90d
              : bucket === 3
                ? { lastActiveAt: daysAgo(120 + (i % 200)) } // inactive, old
                : {}; // never active
      docs.push({ ...base, tier, ...tierRef(tier), ...lastActive });
    }
  }

  const inserted = await User.collection.insertMany(docs);
  logger.info(`Seeded ${docs.length} demo users (@${SEED_DOMAIN}).`);

  // Give a handful of members real coverage on the first published module so the
  // details modal's Progress block shows varied % (not just 0%).
  const [module1] = await Module.find({ isPublished: true }).sort({ order: 1 }).limit(1).lean();
  if (!module1) {
    logger.warn('No published module found — skipped progress seeding.');
  } else {
    const videos = await Video.find({ moduleId: module1._id, status: 'published' })
      .sort({ order: 1 })
      .lean();
    if (videos.length === 0) {
      logger.warn(`Module "${module1.title}" has no published videos — skipped progress.`);
    } else {
      const targets = [30, 60, 45, 90, 75, 20, 55, 85]; // % coverage, one per member
      const progressDocs: Record<string, unknown>[] = [];
      targets.forEach((pct, k) => {
        const idx = 12 + k * 3; // spread across the member rows
        const userId = inserted.insertedIds[idx];
        if (!userId) return;
        const stamp = daysAgo(idx % 20);
        let need = (pct / 100) * videos.length; // total coverage to distribute
        for (const v of videos) {
          const cov = need >= 1 ? 1 : need > 0 ? Math.round(need * 100) / 100 : 0;
          need -= cov;
          const completed = cov >= 1;
          progressDocs.push({
            userId,
            videoId: v._id,
            coveragePct: cov,
            completed,
            watchedSegments: [],
            lastPositionSec: 0,
            ...(completed ? { completedAt: stamp, completionType: 'auto90' } : {}),
            createdAt: stamp,
            updatedAt: stamp,
          });
        }
      });
      await Progress.collection.insertMany(progressDocs);
      logger.info(`Seeded progress for ${targets.length} member(s) on "${module1.title}".`);
    }
  }

  await disconnectDatabase();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'seed-users failed');
    process.exit(1);
  });

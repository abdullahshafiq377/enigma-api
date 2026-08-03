import { connectDatabase, disconnectDatabase } from '@/config/db';
import { logger } from '@/config/logger';
import { coreModuleTier, coreModuleTitle } from '@/modules/admin/cms.service';
import { Module } from '@/modules/module/module.model';
import type { VideoTier } from '@/modules/video/video.model';

/**
 * PRODUCTION initial seed — creates the fixed module structure with the correct
 * access tiers. UNLIKE `npm run seed` (dev), this is:
 *   - non-destructive: upserts by slug, NEVER deletes videos/users/progress;
 *   - idempotent: safe to re-run (re-derives structure, keeps admin's publish state);
 *   - production-safe: no demo content, no `isProduction` guard.
 *
 * Structure it guarantees:
 *   Module 1–4      → free    (Insight)     [core, position 1–4]
 *   Module 5        → paid    (Mastery)     [core, position 5]
 *   Partner Track   → partner (Sovereign)   [extra]
 *
 * Titles + tiers of core modules are position-derived (same rules the CMS
 * drag-and-drop reorder uses), so this stays consistent with the live behaviour.
 *
 * Usage: npm run seed-prod
 */

const CORE_COUNT = 5;

interface SeedModule {
  slug: string;
  title: string;
  order: number;
  isCore: boolean;
  tier: VideoTier;
}

async function run(): Promise<void> {
  await connectDatabase();
  logger.info(`Production seed into DB "${Module.db.name}"…`);

  const core: SeedModule[] = Array.from({ length: CORE_COUNT }, (_, i) => {
    const order = i + 1;
    return {
      slug: `module-${order}`,
      title: coreModuleTitle(order), // "Module N"
      order,
      isCore: true,
      tier: coreModuleTier(order), // 1–4 free, 5 paid
    };
  });
  const extras: SeedModule[] = [
    { slug: 'partner-track', title: 'Partner Track', order: CORE_COUNT + 1, isCore: false, tier: 'partner' },
  ];

  for (const m of [...core, ...extras]) {
    await Module.findOneAndUpdate(
      { slug: m.slug },
      {
        // Structure + access are enforced on every run (seeded modules are protected)…
        $set: { title: m.title, order: m.order, isCore: m.isCore, tier: m.tier, isSystem: true },
        // …but publish state is only set on first insert (don't clobber the admin).
        $setOnInsert: { isPublished: false },
      },
      { upsert: true, new: true },
    ).exec();
    logger.info(`✓ ${m.title} (${m.slug}) → tier=${m.tier}, order=${m.order}, core=${m.isCore}`);
  }

  logger.info(`Production seed complete: ${core.length + extras.length} modules (draft until published).`);
  await disconnectDatabase();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'seed-prod failed');
    process.exit(1);
  });

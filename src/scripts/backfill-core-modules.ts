import { connectDatabase, disconnectDatabase } from '@/config/db';
import { logger } from '@/config/logger';
import { coreModuleTitle } from '@/modules/admin/cms.service';
import { Module, type ModuleDoc } from '@/modules/module/module.model';

/**
 * One-off, non-destructive migration for existing databases (does NOT touch
 * videos/progress like `npm run seed` would):
 *
 *  - The first `CORE_COUNT` modules (by current order) become the fixed core
 *    block: isCore=true, title relabelled to "Module N", order normalised 1..N.
 *  - Every remaining module becomes an extra (isCore=false), keeps its own
 *    title, and is renumbered contiguously after the core block.
 *
 * Idempotent — safe to re-run. Usage: `npm run backfill-modules`.
 */

const CORE_COUNT = 5;

async function run(): Promise<void> {
  await connectDatabase();

  const modules = (await Module.find().sort({ order: 1 }).exec()) as ModuleDoc[];
  if (modules.length === 0) {
    logger.warn('No modules found — nothing to backfill.');
    await disconnectDatabase();
    return;
  }

  // Seeded extras (besides the core block) that should stay protected.
  const SEED_EXTRA_SLUGS = ['partner-track'];
  const ops = modules.map((m, i) => {
    const order = i + 1;
    const isCore = i < CORE_COUNT;
    // Seeded = the core block + known seed extras; admin-created modules are not.
    const isSystem = isCore || SEED_EXTRA_SLUGS.includes(m.slug);
    const set: Record<string, unknown> = { order, isCore, isSystem };
    if (isCore) set.title = coreModuleTitle(order); // "Module 1"…"Module N"
    return { updateOne: { filter: { _id: m._id }, update: { $set: set } } };
  });

  await Module.bulkWrite(ops);

  const coreCount = Math.min(CORE_COUNT, modules.length);
  logger.info(
    `Backfilled ${modules.length} module(s): ${coreCount} core (Module 1…${coreCount}), ` +
      `${modules.length - coreCount} extra.`,
  );

  await disconnectDatabase();
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'backfill-core-modules failed');
    process.exit(1);
  });

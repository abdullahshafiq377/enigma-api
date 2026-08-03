import { connectDatabase, disconnectDatabase } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { Module } from '@/modules/module/module.model';
import { Video, type VideoTier } from '@/modules/video/video.model';

/**
 * Seeds sample modules + videos so the dashboards render real content before
 * the admin CMS exists. Faithful to the Scope of Work:
 *  - Modules 1–4: free videos  (open to Insight/free)
 *  - Module 5:    paid videos  (Mastery+; locked for Insight)
 *  - Partner Track: partner videos (Sovereign only)
 *
 * Dev-only + idempotent: wipes Module/Video collections then re-inserts.
 * Does NOT touch users/progress/certificates. Run: `npm run seed`.
 */

interface SeedModule {
  title: string;
  slug: string;
  order: number;
  description: string;
  videoTier: VideoTier;
  videoCount: number;
  /** Core = fixed top slot; title tracks order and is reorderable only among peers. */
  isCore: boolean;
  /** Make the module's last lesson an unpublished draft with no video file (demo "needs attention"). */
  draftLast?: boolean;
}

// Modules 1–5 are the fixed core block: their titles are just "Module N" and
// track their order. "Partner Track" is an extra module below the divider.
const SEED: SeedModule[] = [
  {
    title: 'Module 1',
    slug: 'foundations',
    order: 1,
    description: 'Core concepts that anchor the curriculum.',
    videoTier: 'free',
    videoCount: 3,
    isCore: true,
  },
  {
    title: 'Module 2',
    slug: 'applied-practice',
    order: 2,
    description: 'Turning theory into skill.',
    videoTier: 'free',
    videoCount: 3,
    isCore: true,
  },
  {
    title: 'Module 3',
    slug: 'going-deeper',
    order: 3,
    description: 'Intermediate techniques.',
    videoTier: 'free',
    videoCount: 3,
    isCore: true,
    draftLast: true,
  },
  {
    title: 'Module 4',
    slug: 'advanced-topics',
    order: 4,
    description: 'Advanced material for committed learners.',
    videoTier: 'free',
    videoCount: 3,
    isCore: true,
  },
  {
    title: 'Module 5',
    slug: 'mastery',
    order: 5,
    description: 'Capstone modules and premium resources.',
    videoTier: 'paid',
    videoCount: 3,
    isCore: true,
    draftLast: true,
  },
  {
    title: 'Partner Track',
    slug: 'partner-track',
    order: 6,
    description: 'Partner-specific content.',
    videoTier: 'partner',
    videoCount: 2,
    isCore: false,
  },
];

async function seed(): Promise<void> {
  if (env.isProduction) throw new Error('Refusing to seed in production');

  await connectDatabase();

  await Promise.all([Module.deleteMany({}), Video.deleteMany({})]);
  logger.info('Cleared modules + videos');

  let totalVideos = 0;
  for (const m of SEED) {
    const moduleDoc = await Module.create({
      title: m.title,
      slug: m.slug,
      order: m.order,
      description: m.description,
      isPublished: true,
      isCore: m.isCore,
      tier: m.videoTier, // module owns the access tier; its videos inherit it
      isSystem: true, // seeded modules are protected from edit/delete
    });

    const videos = Array.from({ length: m.videoCount }, (_, i) => {
      // Last lesson of flagged modules is an unpublished draft with no video file.
      const isDraft = m.draftLast === true && i === m.videoCount - 1;
      const base = `videos/${m.slug}/lesson-${i + 1}`;
      return {
        moduleId: moduleDoc._id,
        title: `${m.title.split('—')[1]?.trim() ?? m.title} · Lesson ${i + 1}`,
        description: `Lesson ${i + 1} of ${m.title}.`,
        order: i + 1,
        durationSec: 300 + i * 120,
        tier: m.videoTier,
        status: isDraft ? ('unpublished' as const) : ('published' as const),
        // Simulated asset keys (no real files until AWS): ready videos have a manifest;
        // first two lessons also carry a transcript + captions; drafts have none.
        ...(isDraft
          ? {}
          : { hlsManifestKey: `${base}/index.m3u8`, thumbnailKey: `${base}/thumb.jpg` }),
        ...(!isDraft && i < 2
          ? { transcriptKey: `${base}/transcript.json`, captionsKey: `${base}/captions.vtt` }
          : {}),
        chapters:
          i === 0
            ? [
                { startSec: 0, title: 'Intro' },
                { startSec: 120, title: 'Main' },
              ]
            : [],
        pdfResources:
          i === 0 ? [{ title: 'Worksheet (PDF)', key: `resources/${m.slug}/worksheet.pdf` }] : [],
      };
    });

    await Video.insertMany(videos);
    totalVideos += videos.length;
  }

  logger.info(`Seeded ${SEED.length} modules and ${totalVideos} videos`);
  await disconnectDatabase();
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'Seed failed');
    process.exit(1);
  });

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { connectDatabase, disconnectDatabase } from '@/config/db';
import { env } from '@/config/env';
import { logger } from '@/config/logger';
import { mediaService } from '@/modules/media/media.service';
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


/**
 * One real file behind every seeded lesson.
 *
 * Uploaded ONCE to a shared key that every video points at, rather than copied
 * per lesson: they are all the same bytes, and 22 copies of the same 14MB would
 * be 300MB of bucket for no benefit. It lives outside the `videos/<id>/` prefix
 * a real upload uses so it is obvious which objects are seed data.
 */
const SAMPLE_VIDEO_KEY = 'videos/_seed/enigma-university.mp4';
const SAMPLE_VIDEO_PATH = path.resolve(process.cwd(), '..', 'Data', 'Enigma University.mp4');

/** Same one-object-many-references trick for the poster. */
const SAMPLE_THUMB_KEY = 'videos/_seed/thumbnail.jpg';
const SAMPLE_THUMB_PATH = path.resolve(process.cwd(), '..', 'Data', 'thumbnail.jpg');

/** How many marks each lesson gets, and the pool their titles come from. */
const CHAPTERS_PER_VIDEO = 5;
const CHAPTER_TITLES = [
  'Introduction',
  'Key concept',
  'How it works',
  'Walkthrough',
  'Worked example',
  'Common mistakes',
  'Practice',
  'Deep dive',
  'Recap',
  'What next',
];

/**
 * Read an MP4's duration in seconds from its `mvhd` box.
 *
 * Scans for the signature rather than walking the box tree: `moov` sits at the
 * end of a file that has not been through faststart, so a naive walk from the
 * front finds `mdat` and gives up. Returns 0 if it cannot find a sane value —
 * the caller falls back rather than seeding a duration that is a guess.
 */
function readMp4DurationSec(buf: Buffer): number {
  const at = buf.indexOf('mvhd');
  if (at < 0) return 0;
  const version = buf.readUInt8(at + 4);
  // v0 packs creation/modification as 32-bit, v1 as 64-bit; timescale and
  // duration follow them either way.
  const base = at + 8 + (version === 1 ? 16 : 8);
  const timescale = buf.readUInt32BE(base);
  const duration = version === 1 ? Number(buf.readBigUInt64BE(base + 4)) : buf.readUInt32BE(base + 4);
  if (!timescale || !duration) return 0;
  const secs = Math.round(duration / timescale);
  // A file under a second or over a day means the signature matched something
  // inside `mdat` by chance, not a real header.
  return secs > 0 && secs < 86_400 ? secs : 0;
}

/**
 * `count` chapter marks spread across `durationSec`, with random times and
 * titles so no two lessons look alike.
 *
 * The first is always at 0 — a video whose first chapter starts a minute in
 * leaves that minute belonging to nothing. The rest are distinct seconds, sorted
 * ascending, because that is what the API enforces and the strip assumes; the
 * seed writes straight through Mongoose and would otherwise be the one path in
 * the system that can produce an out-of-order list.
 */
function makeChapters(durationSec: number, count = CHAPTERS_PER_VIDEO) {
  const n = Math.max(1, Math.min(count, durationSec || 1));
  // One mark per equal slice rather than n free picks over the whole length:
  // free picks clump — on an 81s clip they happily land on 20 and 22 and leave
  // half the video unmarked, which reads as a mistake rather than as variety.
  // Slices keep it random inside each band and spread across the whole.
  // Bounds are computed as integers, not from a fractional slice width. With
  // `floor(i * width + random * width)` two neighbouring slices can round onto
  // the same second — on an 81s clip slices 4 and 5 both reach 64 — and the
  // de-duplication below then silently returns four chapters instead of five.
  const bound = (i: number) => Math.floor((i * durationSec) / n);
  const times = Array.from({ length: n }, (_, i) => {
    if (i === 0) return 0;
    const lo = bound(i);
    return lo + Math.floor(Math.random() * Math.max(1, bound(i + 1) - lo));
  });
  const titles = [...CHAPTER_TITLES]
    .map((t) => ({ t, k: Math.random() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, n)
    // Back into pool order so the sequence still reads like a lesson rather
    // than a shuffle: Introduction before Recap, whichever five were drawn.
    .sort((a, b) => CHAPTER_TITLES.indexOf(a.t) - CHAPTER_TITLES.indexOf(b.t))
    .map((x) => x.t);

  // Slices are disjoint so these are already distinct and ascending; sorted and
  // de-duplicated anyway, because the seed writes straight through Mongoose and
  // is the one path in the system the API's own guard never sees.
  return [...new Set(times)]
    .sort((a, b) => a - b)
    .map((startSec, i) => ({ startSec, title: titles[i] ?? `Part ${i + 1}` }));
}

/**
 * Put the sample poster in the output bucket, once. Null on any failure — a
 * missing poster is cosmetic, so it must never take the seed down with it.
 */
async function uploadSampleThumb(): Promise<string | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(SAMPLE_THUMB_PATH);
  } catch {
    logger.warn(`No sample thumbnail at ${SAMPLE_THUMB_PATH} — seeding without posters.`);
    return null;
  }
  try {
    await mediaService.uploadObject(SAMPLE_THUMB_KEY, bytes, 'image/jpeg');
    logger.info(
      `Uploaded sample thumbnail (${(bytes.length / 1024).toFixed(0)}KB) to ${SAMPLE_THUMB_KEY}`,
    );
    return SAMPLE_THUMB_KEY;
  } catch (err) {
    logger.warn({ err }, 'Sample thumbnail upload failed — seeding without posters.');
    return null;
  }
}

/**
 * Put the sample video in the output bucket, once. Returns its key, or null if
 * it could not be uploaded — in which case the seed still runs and the videos
 * are simply left without a playable file, which is what they were before.
 */
async function uploadSampleVideo(): Promise<{ key: string; durationSec: number } | null> {
  let bytes: Buffer;
  try {
    bytes = await readFile(SAMPLE_VIDEO_PATH);
  } catch {
    logger.warn(`No sample video at ${SAMPLE_VIDEO_PATH} — seeding without playable files.`);
    return null;
  }

  // Guarded: the parser reads offsets straight out of the buffer, so a file
  // whose bytes happen to contain "mvhd" near the end can push a read past the
  // end and throw. A duration is a nice-to-have; it must never be fatal.
  let durationSec = 0;
  try {
    durationSec = readMp4DurationSec(bytes);
  } catch {
    durationSec = 0;
  }
  if (!durationSec) logger.warn('Could not read the sample video duration — falling back.');

  try {
    await mediaService.uploadObject(SAMPLE_VIDEO_KEY, bytes, 'video/mp4');
    logger.info(
      `Uploaded sample video (${(bytes.length / 1024 / 1024).toFixed(1)}MB, ${durationSec}s) to ${SAMPLE_VIDEO_KEY}`,
    );
    return { key: SAMPLE_VIDEO_KEY, durationSec };
  } catch (err) {
    logger.warn({ err }, 'Sample video upload failed — seeding without playable files.');
    return null;
  }
}

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

  /* Everything that can fail happens BEFORE anything is deleted.
     Reading a 14MB file, parsing its header and pushing two objects to S3 are
     all things that can go wrong, and with the wipe first a failure in any of
     them left the catalog empty with nothing to put back. Preparing first costs
     one upload on a run that then fails, which is the cheaper mistake. */
  const sample = await uploadSampleVideo();
  const thumbKey = await uploadSampleThumb();

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
        // The real file's length, so the chapter marks and every progress
        // percentage mean something. Only the old made-up ladder if there is no
        // file to measure.
        durationSec: sample?.durationSec || 300 + i * 120,
        tier: m.videoTier,
        status: isDraft ? ('unpublished' as const) : ('published' as const),
        // Every lesson plays the same sample file, drafts included — the draft
        // is a publishing state, not a missing-asset one. `mp4Key` and no
        // manifest is the MP4-first path the wizard also produces; the invented
        // `index.m3u8` that used to sit here pointed at nothing and 404'd the
        // moment anyone pressed play.
        ...(sample ? { mp4Key: sample.key } : {}),
        // The poster goes on drafts too: the CMS table draws a thumbnail for
        // every row, and a draft with no poster is the only one that would fall
        // back to the placeholder glyph. The `${base}/thumb.jpg` that used to
        // sit here pointed at nothing — `hasThumbnail` said yes and the image
        // 404'd, which is why the table has always shown the placeholder.
        ...(thumbKey ? { thumbnailKey: thumbKey } : {}),
        ...(!isDraft && i < 2
          ? { transcriptKey: `${base}/transcript.json`, captionsKey: `${base}/captions.vtt` }
          : {}),
        chapters: makeChapters(sample?.durationSec || 300 + i * 120),
        pdfResources:
          i === 0 ? [{ title: 'Worksheet (PDF)', key: `resources/${m.slug}/worksheet.pdf` }] : [],
      };
    });

    await Video.insertMany(videos);
    totalVideos += videos.length;
  }

  logger.info(
    `Seeded ${SEED.length} modules and ${totalVideos} videos` +
      (sample ? ` — all playable, ${CHAPTERS_PER_VIDEO} chapters each` : ' (no playable files)') +
      (thumbKey ? ', all with posters' : ''),
  );
  await disconnectDatabase();
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'Seed failed');
    process.exit(1);
  });

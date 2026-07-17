import { describe, expect, it, vi } from 'vitest';

import { cmsService, toVideoDTO } from '@/modules/admin/cms.service';
import { Module } from '@/modules/module/module.model';
import { Video, type VideoDoc } from '@/modules/video/video.model';

// Stub the media service so the MP4-first copy path is tested without AWS.
const copyInputToOutput = vi.fn().mockResolvedValue(undefined);
const submitTranscription = vi.fn().mockResolvedValue(undefined);
vi.mock('@/modules/media/media.service', () => ({
  mediaService: {
    get copyInputToOutput() {
      return copyInputToOutput;
    },
    get submitTranscription() {
      return submitTranscription;
    },
    submitTranscode: vi.fn(),
    uploadObject: vi.fn(),
  },
}));

describe('cmsService.overview', () => {
  it('computes catalog stats + per-module derived status', async () => {
    const m1 = await Module.create({ title: 'M1', slug: 'm1', order: 1, isPublished: true });
    const m2 = await Module.create({ title: 'M2', slug: 'm2', order: 2, isPublished: true });
    await Module.create({ title: 'Empty', slug: 'm3', order: 3, isPublished: false });

    // m1: two published, both with a file → active
    await Video.create({
      moduleId: m1._id,
      title: 'a',
      order: 1,
      tier: 'free',
      status: 'published',
      hlsManifestKey: 'k1',
    });
    await Video.create({
      moduleId: m1._id,
      title: 'b',
      order: 2,
      tier: 'free',
      status: 'published',
      hlsManifestKey: 'k2',
    });
    // m2: one ready+published, one unpublished draft with no file → needs_attention
    await Video.create({
      moduleId: m2._id,
      title: 'c',
      order: 1,
      tier: 'paid',
      status: 'published',
      hlsManifestKey: 'k3',
    });
    await Video.create({
      moduleId: m2._id,
      title: 'd',
      order: 2,
      tier: 'paid',
      status: 'unpublished',
    });

    const o = await cmsService.overview();
    expect(o.stats).toEqual({ modules: 3, videos: 4, published: 3, drafts: 1, needsAttention: 1 });

    const bySlug = Object.fromEntries(o.modules.map((m) => [m.slug, m]));
    expect(bySlug.m1).toMatchObject({ videoCount: 2, publishedCount: 2, status: 'active' });
    expect(bySlug.m2).toMatchObject({
      videoCount: 2,
      publishedCount: 1,
      status: 'needs_attention',
    });
    expect(bySlug.m3).toMatchObject({ videoCount: 0, status: 'empty' });
  });
});

describe('cmsService.createVideo (Add-video wizard)', () => {
  it('saves a published video with PDF resources (no upload → no video file yet)', async () => {
    copyInputToOutput.mockClear();
    const m = await Module.create({ title: 'M', slug: 'cm', order: 1, isPublished: true });
    const v = await cmsService.createVideo({
      moduleId: m.id,
      title: 'V',
      order: 1,
      tier: 'free',
      durationSec: 360,
      publish: true,
      resources: [
        { title: 'Worksheet.pdf', inputKey: 'inputs/a/Worksheet.pdf' },
        { title: 'Slides.pdf', inputKey: 'inputs/b/Slides.pdf' },
      ],
    });
    expect(copyInputToOutput).toHaveBeenCalledTimes(2); // both PDFs copied to output
    expect(toVideoDTO(v)).toMatchObject({
      status: 'published',
      hasVideo: false,
      pdfCount: 2,
    });
  });

  it('saves an unpublished draft when publish is false', async () => {
    const m = await Module.create({ title: 'M2', slug: 'cm2', order: 2, isPublished: true });
    const v = await cmsService.createVideo({
      moduleId: m.id,
      title: 'Draft',
      order: 1,
      tier: 'paid',
      publish: false,
    });
    expect(toVideoDTO(v)).toMatchObject({
      status: 'unpublished',
      hasVideo: false,
      pdfCount: 0,
      needsAttention: true,
    });
  });

  it('MP4-first: copies the upload to the output bucket and marks it playable', async () => {
    copyInputToOutput.mockClear();
    const m = await Module.create({ title: 'M3', slug: 'cm3', order: 3, isPublished: true });
    const v = await cmsService.createVideo({
      moduleId: m.id,
      title: 'Uploaded',
      order: 1,
      tier: 'free',
      publish: true,
      inputKey: 'inputs/abc/lesson.mp4',
    });
    expect(copyInputToOutput).toHaveBeenCalledWith(
      'inputs/abc/lesson.mp4',
      `videos/${v.id}/source.mp4`,
    );
    expect(toVideoDTO(v)).toMatchObject({
      status: 'published',
      hasVideo: true,
      needsAttention: false,
    });
  });
});

describe('toVideoDTO', () => {
  it('derives asset indicators', async () => {
    const m = await Module.create({ title: 'M', slug: 'mm', order: 1, isPublished: true });

    const ready = await Video.create({
      moduleId: m._id,
      title: 'v',
      order: 1,
      tier: 'free',
      status: 'published',
      hlsManifestKey: 'k',
      transcriptKey: 't',
      pdfResources: [{ title: 'p', key: 'pk' }],
    });
    expect(toVideoDTO(ready as VideoDoc)).toMatchObject({
      hasVideo: true,
      hasTranscript: true,
      pdfCount: 1,
      needsAttention: false,
    });

    const draft = await Video.create({
      moduleId: m._id,
      title: 'd',
      order: 2,
      tier: 'paid',
      status: 'unpublished',
    });
    expect(toVideoDTO(draft as VideoDoc)).toMatchObject({
      hasVideo: false,
      hasTranscript: false,
      pdfCount: 0,
      needsAttention: true,
    });
  });
});

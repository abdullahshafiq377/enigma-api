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

describe('cmsService.reorderModules (core block + title relabel)', () => {
  it('relabels core modules to "Module {order}" and leaves extras named', async () => {
    const a = await Module.create({ title: 'Module 1', slug: 'ra', order: 1, isCore: true });
    const b = await Module.create({ title: 'Module 2', slug: 'rb', order: 2, isCore: true });
    const partner = await Module.create({ title: 'Partner Track', slug: 'rp', order: 3, isCore: false });

    // Swap the two core modules: b→order1, a→order2. Partner stays at 3.
    await cmsService.reorderModules([
      { id: b.id, order: 1 },
      { id: a.id, order: 2 },
      { id: partner.id, order: 3 },
    ]);

    const [na, nb, np] = await Promise.all([
      Module.findById(a.id),
      Module.findById(b.id),
      Module.findById(partner.id),
    ]);
    expect(nb).toMatchObject({ order: 1, title: 'Module 1' }); // content of b now titled Module 1
    expect(na).toMatchObject({ order: 2, title: 'Module 2' });
    expect(np).toMatchObject({ order: 3, title: 'Partner Track' }); // extra keeps its name
  });

  it('rejects an ordering that pushes an extra into the core block', async () => {
    const core = await Module.create({ title: 'Module 1', slug: 'xa', order: 1, isCore: true });
    const extra = await Module.create({ title: 'Partner Track', slug: 'xp', order: 2, isCore: false });

    await expect(
      cmsService.reorderModules([
        { id: extra.id, order: 1 }, // extra above core → invalid
        { id: core.id, order: 2 },
      ]),
    ).rejects.toThrow(/core modules must stay above/i);
  });

  it('re-derives core tiers by slot (1–4 free, 5 paid) and cascades to videos', async () => {
    const m4 = await Module.create({ title: 'Module 4', slug: 't4', order: 4, isCore: true, tier: 'free' });
    const m5 = await Module.create({ title: 'Module 5', slug: 't5', order: 5, isCore: true, tier: 'paid' });
    const v4 = await Video.create({ moduleId: m4._id, title: 'a', order: 1, tier: 'free' });
    const v5 = await Video.create({ moduleId: m5._id, title: 'b', order: 1, tier: 'paid' });

    // Swap slots 4 and 5.
    await cmsService.reorderModules([
      { id: m5.id, order: 4 },
      { id: m4.id, order: 5 },
    ]);

    const [n4, n5, nv4, nv5] = await Promise.all([
      Module.findById(m4.id),
      Module.findById(m5.id),
      Video.findById(v4._id),
      Video.findById(v5._id),
    ]);
    expect(n5).toMatchObject({ order: 4, tier: 'free', title: 'Module 4' }); // moved to slot 4 → free
    expect(n4).toMatchObject({ order: 5, tier: 'paid', title: 'Module 5' }); // moved to slot 5 → paid
    expect(nv5?.tier).toBe('free'); // video cascaded with its module
    expect(nv4?.tier).toBe('paid');
  });
});

describe('cmsService.createModule', () => {
  it('appends new modules as an extra with a server-assigned order', async () => {
    await Module.create({ title: 'Module 1', slug: 'ca', order: 1, isCore: true });
    await Module.create({ title: 'Partner Track', slug: 'cp', order: 2, isCore: false });

    // Client-sent order is ignored; server appends after the max.
    const created = await cmsService.createModule({ title: 'New One', slug: 'cn', order: 1 });
    expect(created).toMatchObject({ order: 3, isCore: false, title: 'New One' });
  });
});

describe('cmsService.createVideo — access inherited from module', () => {
  it('sets the video tier from its module', async () => {
    const m = await Module.create({ title: 'Paid Mod', slug: 'inh-paid', order: 1, tier: 'paid' });
    const v = await cmsService.createVideo({ moduleId: m.id, title: 'Inherits', order: 1 });
    expect(v.tier).toBe('paid');
  });

  it('defaults to paid (locked) when the module has no explicit tier', async () => {
    const m = await Module.create({ title: 'Default Mod', slug: 'inh-def', order: 1 });
    const v = await cmsService.createVideo({ moduleId: m.id, title: 'Def', order: 1 });
    expect(v.tier).toBe('paid');
  });
});

describe('cmsService.deleteModule / updateModule — system protection', () => {
  it('refuses to delete a system module', async () => {
    const m = await Module.create({ title: 'Sys', slug: 'sys-d', order: 1, isSystem: true });
    await expect(cmsService.deleteModule(m.id)).rejects.toThrow(/system modules cannot be deleted/i);
  });

  it('deletes a custom module and all of its videos', async () => {
    const m = await Module.create({ title: 'Custom', slug: 'cust-d', order: 1, isSystem: false });
    await Video.create({ moduleId: m._id, title: 'v1', order: 1 });
    await Video.create({ moduleId: m._id, title: 'v2', order: 2 });
    const res = await cmsService.deleteModule(m.id);
    expect(res).toEqual({ deletedVideos: 2 });
    expect(await Module.findById(m.id)).toBeNull();
    expect(await Video.countDocuments({ moduleId: m._id })).toBe(0);
  });

  it('refuses to edit a system module', async () => {
    const m = await Module.create({ title: 'Sys2', slug: 'sys-e', order: 1, isSystem: true });
    await expect(cmsService.updateModule(m.id, { title: 'x' })).rejects.toThrow(
      /system modules cannot be edited/i,
    );
  });
});

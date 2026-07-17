import type { ModuleDoc } from '@/modules/module/module.model';
import { moduleRepository } from '@/modules/module/module.repository';
import { progressRepository } from '@/modules/progress/progress.repository';
import type { Tier } from '@/modules/user/user.types';
import { canAccessVideo } from '@/modules/video/access';
import type { VideoDoc, VideoTier } from '@/modules/video/video.model';
import { videoRepository } from '@/modules/video/video.repository';
import { type VideoDTO, videoService } from '@/modules/video/video.service';
import { ApiError } from '@/utils/ApiError';

const TIER_ORDER: Record<VideoTier, number> = { free: 0, paid: 1, partner: 2 };

/** Distinct video tiers present in a module, in canonical free→paid→partner order. */
function distinctTiers(tiers: VideoTier[]): VideoTier[] {
  return [...new Set(tiers)].sort((a, b) => TIER_ORDER[a] - TIER_ORDER[b]);
}

export interface ModuleSummaryDTO {
  id: string;
  title: string;
  slug: string;
  order: number;
  description?: string | undefined;
  coverAssetKey?: string | undefined;
  /** Greyed-out when the member's tier can't reach ANY video in it (per scope). */
  locked: boolean;
  /** Total videos in the module (accessible + locked). */
  videoCount: number;
  /** Videos the member's tier can reach. */
  availableCount: number;
  /** Videos the member's tier cannot reach (videoCount - availableCount). */
  lockedCount: number;
  /** Completed videos counted among the accessible ones. */
  completedCount: number;
  /** Progress over ACCESSIBLE videos — a member can't complete what they can't reach. */
  progressPct: number;
  /** Distinct tiers present, for the access badge (Free / Paid / Partner / Mixed). */
  tiers: VideoTier[];
}

export interface ModuleVideoDTO extends VideoDTO {
  completed: boolean;
  /** Fraction of the video actually watched (0–1). */
  coveragePct: number;
  /** Resume position in seconds. */
  lastPositionSec: number;
}

export interface ModuleDetailDTO extends ModuleSummaryDTO {
  videos: ModuleVideoDTO[];
}

function summarize(
  module: ModuleDoc,
  videos: VideoDoc[],
  userTier: Tier,
  completed: ReadonlySet<string>,
): ModuleSummaryDTO {
  const videoCount = videos.length;
  const accessible = videos.filter((v) => canAccessVideo(userTier, v.tier));
  const availableCount = accessible.length;
  const completedCount = accessible.filter((v) => completed.has(v.id)).length;
  return {
    id: module.id,
    title: module.title,
    slug: module.slug,
    order: module.order,
    description: module.description,
    coverAssetKey: module.coverAssetKey,
    locked: videoCount > 0 && availableCount === 0,
    videoCount,
    availableCount,
    lockedCount: videoCount - availableCount,
    completedCount,
    progressPct: availableCount ? Math.round((completedCount / availableCount) * 100) : 0,
    tiers: distinctTiers(videos.map((v) => v.tier)),
  };
}

export const moduleService = {
  async listForUser(userTier: Tier, userId: string): Promise<ModuleSummaryDTO[]> {
    const [modules, videos] = await Promise.all([
      moduleRepository.findAllPublished(),
      videoRepository.findAllPublished(),
    ]);

    const byModule = new Map<string, VideoDoc[]>();
    for (const v of videos) {
      const key = v.moduleId.toString();
      const list = byModule.get(key) ?? [];
      list.push(v);
      byModule.set(key, list);
    }

    const completed = new Set(
      await progressRepository.findCompletedVideoIds(
        userId,
        videos.map((v) => v.id),
      ),
    );

    return modules.map((m) => summarize(m, byModule.get(m.id) ?? [], userTier, completed));
  },

  async getForUser(id: string, userTier: Tier, userId: string): Promise<ModuleDetailDTO> {
    const module = await moduleRepository.findById(id);
    if (!module || !module.isPublished) throw ApiError.notFound('Module not found');

    const videos = await videoService.listByModule(id, userTier);
    const progressDocs = await progressRepository.findManyByUserAndVideos(
      userId,
      videos.map((v) => v.id),
    );
    const byVideo = new Map(progressDocs.map((p) => [p.videoId.toString(), p]));

    const videosWithProgress: ModuleVideoDTO[] = videos.map((v) => {
      const p = byVideo.get(v.id);
      return {
        ...v,
        completed: p?.completed ?? false,
        coveragePct: p?.coveragePct ?? 0,
        lastPositionSec: p?.lastPositionSec ?? 0,
      };
    });
    const availableCount = videos.filter((v) => !v.locked).length;
    const completedCount = videosWithProgress.filter((v) => v.completed && !v.locked).length;

    return {
      id: module.id,
      title: module.title,
      slug: module.slug,
      order: module.order,
      description: module.description,
      coverAssetKey: module.coverAssetKey,
      locked: videos.length > 0 && availableCount === 0,
      videoCount: videos.length,
      availableCount,
      lockedCount: videos.length - availableCount,
      completedCount,
      progressPct: availableCount ? Math.round((completedCount / availableCount) * 100) : 0,
      tiers: distinctTiers(videos.map((v) => v.tier)),
      videos: videosWithProgress,
    };
  },
};

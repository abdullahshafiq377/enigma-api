import { mediaService, type SignedCookies } from '@/modules/media/media.service';
import type { Tier } from '@/modules/user/user.types';
import { canAccessVideo } from '@/modules/video/access';
import type { VideoDoc } from '@/modules/video/video.model';
import { videoRepository } from '@/modules/video/video.repository';
import { ApiError } from '@/utils/ApiError';

export interface VideoDTO {
  id: string;
  moduleId: string;
  title: string;
  description?: string | undefined;
  order: number;
  durationSec: number;
  tier: VideoDoc['tier'];
  thumbnailKey?: string | undefined;
  chapters: VideoDoc['chapters'];
  /** Resource title + a presigned download URL (URL present only when the member can access). */
  pdfResources: { title: string; downloadUrl?: string | undefined }[];
  hasCaptions: boolean;
  /** True when the member's tier cannot access this video (shown locked). */
  locked: boolean;
}

export interface PlaybackGrant {
  manifestUrl: string;
  /** 'hls' for an adaptive manifest, 'mp4' for progressive (MP4-first before transcoding). */
  playbackType: 'hls' | 'mp4';
  captionsUrl?: string | undefined;
  transcriptUrl?: string | undefined;
  cookies: SignedCookies;
}

function toDTO(video: VideoDoc, userTier: Tier): VideoDTO {
  return {
    id: video.id,
    moduleId: video.moduleId.toString(),
    title: video.title,
    description: video.description,
    order: video.order,
    durationSec: video.durationSec,
    tier: video.tier,
    thumbnailKey: video.thumbnailKey,
    chapters: video.chapters,
    // Titles only here; getById adds presigned download URLs for accessible members.
    pdfResources: video.pdfResources.map((r) => ({ title: r.title })),
    hasCaptions: Boolean(video.captionsKey),
    locked: !canAccessVideo(userTier, video.tier),
  };
}

export const videoService = {
  async getById(id: string, userTier: Tier): Promise<VideoDTO> {
    const video = await videoRepository.findById(id);
    if (!video || video.status !== 'published') throw ApiError.notFound('Video not found');
    const dto = toDTO(video, userTier);

    // Add presigned download URLs for resource PDFs (only for members who can access).
    if (!dto.locked && video.pdfResources.length) {
      dto.pdfResources = await Promise.all(
        video.pdfResources.map(async (r) => {
          if (!r.key) return { title: r.title };
          try {
            return { title: r.title, downloadUrl: await mediaService.getDownloadUrl(r.key) };
          } catch {
            return { title: r.title };
          }
        }),
      );
    }
    return dto;
  },

  async listByModule(moduleId: string, userTier: Tier): Promise<VideoDTO[]> {
    const videos = await videoRepository.findPublishedByModule(moduleId);
    return videos.map((v) => toDTO(v, userTier));
  },

  /**
   * Verify the member's tier, then issue CloudFront signed cookies covering the
   * whole HLS folder plus the signed manifest/captions/transcript URLs.
   */
  async issuePlaybackGrant(
    id: string,
    userTier: Tier,
    now: number = Date.now(),
  ): Promise<PlaybackGrant> {
    const video = await videoRepository.findById(id);
    if (!video || video.status !== 'published') throw ApiError.notFound('Video not found');
    if (!canAccessVideo(userTier, video.tier)) throw ApiError.forbidden('Upgrade required');

    // Prefer HLS; fall back to the progressive MP4 (MP4-first, before transcoding exists).
    const source = video.hlsManifestKey ?? video.mp4Key;
    if (!source) throw ApiError.conflict('Video is not ready for playback');
    const playbackType: 'hls' | 'mp4' = video.hlsManifestKey ? 'hls' : 'mp4';

    const nowSec = Math.floor(now / 1000);

    // Single files (the MP4/manifest, captions, transcript) get signed URLs — these
    // work cross-domain with no cookies, so playback works from localhost too.
    const manifestUrl = mediaService.signObjectUrl(source, nowSec);
    const captionsUrl = video.captionsKey
      ? mediaService.signObjectUrl(video.captionsKey, nowSec)
      : undefined;
    const transcriptUrl = video.transcriptKey
      ? mediaService.signObjectUrl(video.transcriptKey, nowSec)
      : undefined;

    // Cookies still cover the whole folder for HLS segment fan-out (used in prod
    // where the app and CDN share a domain). Harmless for MP4, which uses the URL.
    const pathPrefix = source.split('/').slice(0, -1).join('/');
    const cookies = mediaService.issueSignedCookies(pathPrefix, nowSec);

    return { manifestUrl, playbackType, captionsUrl, transcriptUrl, cookies };
  },
};

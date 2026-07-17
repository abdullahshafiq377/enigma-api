import type { Tier } from '@/modules/user/user.types';
import type { VideoTier } from '@/modules/video/video.model';

/**
 * Which video tiers each membership tier can access:
 *  - insight (free)    → free videos
 *  - mastery (paid)    → free + paid
 *  - sovereign (partner) → free + paid + partner
 */
const ACCESS: Record<Tier, ReadonlySet<VideoTier>> = {
  insight: new Set<VideoTier>(['free']),
  mastery: new Set<VideoTier>(['free', 'paid']),
  sovereign: new Set<VideoTier>(['free', 'paid', 'partner']),
};

export function canAccessVideo(userTier: Tier, videoTier: VideoTier): boolean {
  return ACCESS[userTier].has(videoTier);
}

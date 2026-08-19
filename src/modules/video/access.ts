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

/** The viewer, for rules that need more than a tier. */
export interface Viewer {
  /** Mongo user id — what `Module.assignedUserIds` holds. NOT the Clerk id. */
  id: string;
  tier: Tier;
}

/**
 * Whether a partner module is open to this member.
 *
 * An empty assignment list is the admin dialog's "All selected": every member
 * whose tier already reaches partner content. A non-empty list narrows it to
 * exactly those members.
 *
 * It only ever FILTERS — being named never grants access a tier does not
 * already carry, so an Insight member listed here still cannot get in.
 */
export function isAssignedToModule(userId: string, assignedUserIds?: readonly unknown[]): boolean {
  if (!assignedUserIds || assignedUserIds.length === 0) return true;
  return assignedUserIds.some((id) => String(id) === userId);
}

/**
 * The full rule: the tier ladder, then the partner narrowing.
 *
 * Videos inherit their module's tier, but the assignment lives on the MODULE,
 * so both are needed. Every access decision — locked flags, module counts and
 * the playback grant — goes through here, or the three disagree.
 */
export function canAccessVideoInModule(
  viewer: Viewer,
  videoTier: VideoTier,
  module: { tier: VideoTier; assignedUserIds?: readonly unknown[] },
): boolean {
  if (!canAccessVideo(viewer.tier, videoTier)) return false;
  if (module.tier !== 'partner') return true;
  return isAssignedToModule(viewer.id, module.assignedUserIds);
}

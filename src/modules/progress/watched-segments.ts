import type { IWatchedSegment } from '@/modules/progress/progress.model';

/**
 * Watch-tracking math. Coverage is the fraction of DISTINCT seconds actually
 * played — merged intervals, not a "furthest point reached" high-water mark —
 * so seeking to the end can't fake completion.
 */

/** Merge overlapping/adjacent [start,end] intervals into a minimal sorted set. */
export function mergeSegments(segments: IWatchedSegment[]): IWatchedSegment[] {
  const valid = segments
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);

  const merged: IWatchedSegment[] = [];
  for (const seg of valid) {
    const last = merged[merged.length - 1];
    if (last && seg.start <= last.end) {
      last.end = Math.max(last.end, seg.end);
    } else {
      merged.push({ start: seg.start, end: seg.end });
    }
  }
  return merged;
}

/** Total seconds covered by a set of (already merged or unmerged) segments. */
export function totalCovered(segments: IWatchedSegment[]): number {
  return mergeSegments(segments).reduce((sum, s) => sum + (s.end - s.start), 0);
}

/** Clamp segments to [0, duration] and drop empties. */
export function clampSegments(segments: IWatchedSegment[], durationSec: number): IWatchedSegment[] {
  return segments
    .map((s) => ({ start: Math.max(0, s.start), end: Math.min(durationSec, s.end) }))
    .filter((s) => s.end > s.start);
}

/** Coverage fraction in [0,1]. Returns 0 when duration is unknown. */
export function coverage(segments: IWatchedSegment[], durationSec: number): number {
  if (durationSec <= 0) return 0;
  return Math.min(1, totalCovered(segments) / durationSec);
}

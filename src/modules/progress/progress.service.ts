import { Types } from 'mongoose';

import { Module } from '@/modules/module/module.model';
import { Progress, type ProgressDoc } from '@/modules/progress/progress.model';
import { progressRepository } from '@/modules/progress/progress.repository';
import type { HeartbeatBody } from '@/modules/progress/progress.validators';
import {
  clampSegments,
  coverage,
  mergeSegments,
  totalCovered,
} from '@/modules/progress/watched-segments';
import { User } from '@/modules/user/user.model';
import { Video } from '@/modules/video/video.model';

const COMPLETION_THRESHOLD = 0.9; // 90% real coverage
const MAX_PLAYBACK_RATE = 2; // 2x is the fastest allowed speed
const ANTICHEAT_TOLERANCE = 1.5;
const ANTICHEAT_BUFFER_SEC = 5;

export interface ProgressSummary {
  coveragePct: number;
  completed: boolean;
  lastPositionSec: number;
}

function summarize(doc: ProgressDoc): ProgressSummary {
  return {
    coveragePct: doc.coveragePct,
    completed: doc.completed,
    lastPositionSec: doc.lastPositionSec,
  };
}

export const progressService = {
  /**
   * Merge a heartbeat's watched segments into stored progress, recompute
   * coverage, and auto-complete at ≥90% real coverage. Includes a wall-clock
   * anti-cheat: a single heartbeat can't legitimately add more coverage than
   * could be watched since the last update at max playback speed.
   */
  async recordHeartbeat(
    userId: string,
    videoId: string,
    body: HeartbeatBody,
    now: number = Date.now(),
  ): Promise<ProgressSummary> {
    const doc: ProgressDoc =
      (await progressRepository.findByUserAndVideo(userId, videoId)) ??
      (new Progress({
        userId: new Types.ObjectId(userId),
        videoId: new Types.ObjectId(videoId),
        watchedSegments: [],
      }) as unknown as ProgressDoc);

    const existing = doc.watchedSegments;
    const incoming = clampSegments(body.segments, body.durationSec);
    const candidate = mergeSegments([...existing, ...incoming]);

    const added = totalCovered(candidate) - totalCovered(existing);
    const elapsedSec = doc.isNew ? Infinity : (now - doc.updatedAt.getTime()) / 1000;
    const maxAddable = elapsedSec * MAX_PLAYBACK_RATE * ANTICHEAT_TOLERANCE + ANTICHEAT_BUFFER_SEC;

    // Reject implausible jumps (e.g. client reporting a seeked-over region as watched).
    const finalSegments =
      Number.isFinite(elapsedSec) && added > maxAddable ? mergeSegments(existing) : candidate;

    doc.watchedSegments = finalSegments;
    doc.coveragePct = coverage(finalSegments, body.durationSec);
    doc.lastPositionSec = Math.min(body.lastPositionSec, body.durationSec);

    if (!doc.completed && doc.coveragePct >= COMPLETION_THRESHOLD) {
      doc.completed = true;
      doc.completedAt = new Date(now);
      doc.completionType = 'auto90';
    }

    await doc.save();
    // Mark the member active (powers "last active" + recently-active analytics).
    await User.updateOne({ _id: userId }, { $set: { lastActiveAt: new Date(now) } }).exec();
    return summarize(doc);
  },

  /** Explicit "mark complete" button (manual override). */
  async markComplete(
    userId: string,
    videoId: string,
    now: number = Date.now(),
  ): Promise<ProgressSummary> {
    const doc: ProgressDoc =
      (await progressRepository.findByUserAndVideo(userId, videoId)) ??
      (new Progress({
        userId: new Types.ObjectId(userId),
        videoId: new Types.ObjectId(videoId),
        watchedSegments: [],
      }) as unknown as ProgressDoc);

    doc.completed = true;
    doc.completedAt = new Date(now);
    doc.completionType ??= 'manual';
    await doc.save();
    return summarize(doc);
  },

  /**
   * Recently-watched, still-incomplete videos enriched with their video + module
   * titles (for the dashboard "Continue watching" card). Only published videos.
   */
  async getContinueWatching(userId: string, limit = 10) {
    const docs = await progressRepository.findContinueWatching(userId, limit);
    if (docs.length === 0) return [];

    const videos = await Video.find({
      _id: { $in: docs.map((d) => d.videoId) },
      status: 'published',
    }).exec();
    const videoById = new Map(videos.map((v) => [v.id as string, v]));
    const modules = await Module.find({
      _id: { $in: [...new Set(videos.map((v) => v.moduleId.toString()))] },
    }).exec();
    const moduleById = new Map(modules.map((m) => [m.id as string, m]));

    return docs
      .map((d) => {
        const v = videoById.get(d.videoId.toString());
        if (!v) return null; // unpublished/removed → drop from the list
        const m = moduleById.get(v.moduleId.toString());
        return {
          videoId: d.videoId.toString(),
          videoTitle: v.title,
          moduleId: v.moduleId.toString(),
          moduleTitle: m?.title ?? '',
          durationSec: v.durationSec,
          coveragePct: d.coveragePct,
          lastPositionSec: d.lastPositionSec,
          updatedAt: d.updatedAt,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  },
};

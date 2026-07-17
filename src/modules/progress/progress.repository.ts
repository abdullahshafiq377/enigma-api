import { Progress, type ProgressDoc } from '@/modules/progress/progress.model';

/** Owns all DB access for progress documents. */
export const progressRepository = {
  findByUserAndVideo(userId: string, videoId: string): Promise<ProgressDoc | null> {
    return Progress.findOne({ userId, videoId }).exec() as Promise<ProgressDoc | null>;
  },

  /** Most recently updated, not-yet-completed videos (for "continue watching"). */
  findContinueWatching(userId: string, limit: number): Promise<ProgressDoc[]> {
    return Progress.find({ userId, completed: false })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .exec() as Promise<ProgressDoc[]>;
  },

  /** The subset of `videoIds` the user has completed. */
  async findCompletedVideoIds(userId: string, videoIds: string[]): Promise<string[]> {
    const docs = await Progress.find({ userId, videoId: { $in: videoIds }, completed: true })
      .select('videoId')
      .exec();
    return docs.map((d) => d.videoId.toString());
  },

  /** All progress docs for the user across a set of videos (for the module detail rows). */
  findManyByUserAndVideos(userId: string, videoIds: string[]): Promise<ProgressDoc[]> {
    return Progress.find({ userId, videoId: { $in: videoIds } }).exec() as Promise<ProgressDoc[]>;
  },
};

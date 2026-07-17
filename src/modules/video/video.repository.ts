import { Video, type VideoDoc } from '@/modules/video/video.model';

export const videoRepository = {
  findById(id: string): Promise<VideoDoc | null> {
    return Video.findById(id).exec() as Promise<VideoDoc | null>;
  },

  /** Published videos in a module, in order. */
  findPublishedByModule(moduleId: string): Promise<VideoDoc[]> {
    return Video.find({ moduleId, status: 'published' }).sort({ order: 1 }).exec() as Promise<
      VideoDoc[]
    >;
  },

  /** All published videos (for building the dashboard module grid in one query). */
  findAllPublished(): Promise<VideoDoc[]> {
    return Video.find({ status: 'published' }).sort({ moduleId: 1, order: 1 }).exec() as Promise<
      VideoDoc[]
    >;
  },
};

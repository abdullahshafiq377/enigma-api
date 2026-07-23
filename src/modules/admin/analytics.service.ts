import { Certificate } from '@/modules/certificate/certificate.model';
import { Event } from '@/modules/event/event.model';
import { Module } from '@/modules/module/module.model';
import { Progress } from '@/modules/progress/progress.model';
import { User } from '@/modules/user/user.model';
import { type Tier, TIERS } from '@/modules/user/user.types';
import { Video } from '@/modules/video/video.model';

export type Granularity = 'day' | 'week' | 'month';

interface VideoStat {
  started: number;
  completed: number;
  avgCoverage: number;
}

function emptyTierRecord(): Record<Tier, number> {
  return Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
}

/** Per-video {started, completed, avgCoverage} progress stats, keyed by videoId. */
async function videoStats(): Promise<Map<string, VideoStat>> {
  const rows = (await Progress.aggregate([
    {
      $group: {
        _id: '$videoId',
        started: { $sum: 1 },
        completed: { $sum: { $cond: ['$completed', 1, 0] } },
        avgCoverage: { $avg: '$coveragePct' },
      },
    },
  ])) as Array<{ _id: unknown; started: number; completed: number; avgCoverage: number }>;

  return new Map(
    rows.map((r) => [
      String(r._id),
      { started: r.started, completed: r.completed, avgCoverage: r.avgCoverage ?? 0 },
    ]),
  );
}

export const analyticsService = {
  /** Headline counters: total users, users by tier, certificates issued + downloaded. */
  async overview() {
    const [tierRows, totalUsers, certificatesIssued, certificateDownloads] = await Promise.all([
      User.aggregate([{ $group: { _id: '$tier', count: { $sum: 1 } } }]) as Promise<
        Array<{ _id: Tier; count: number }>
      >,
      User.countDocuments(),
      Certificate.countDocuments(),
      Event.countDocuments({ type: 'cert_download' }),
    ]);

    const usersByTier = emptyTierRecord();
    for (const row of tierRows) if (row._id in usersByTier) usersByTier[row._id] = row.count;

    return { totalUsers, usersByTier, certificatesIssued, certificateDownloads };
  },

  /** Video completion rate per module (completed ÷ started across its videos). */
  async moduleCompletion() {
    const [modules, videos, stats] = await Promise.all([
      Module.find({ isPublished: true }).sort({ order: 1 }).exec(),
      Video.find({ status: 'published' }).exec(),
      videoStats(),
    ]);

    const videosByModule = new Map<string, string[]>();
    for (const v of videos) {
      const key = v.moduleId.toString();
      const list = videosByModule.get(key) ?? [];
      list.push(v.id);
      videosByModule.set(key, list);
    }

    return modules.map((m) => {
      const ids = videosByModule.get(m.id) ?? [];
      let started = 0;
      let completed = 0;
      for (const id of ids) {
        const s = stats.get(id);
        if (s) {
          started += s.started;
          completed += s.completed;
        }
      }
      return {
        moduleId: m.id,
        title: m.title,
        started,
        completed,
        completionRate: started ? Math.round((completed / started) * 100) : 0,
      };
    });
  },

  /** Top 5 most-watched and bottom 5 least-watched published videos (by viewers). */
  async videoRankings() {
    const [videos, modules, stats] = await Promise.all([
      Video.find({ status: 'published' }).select('title tier moduleId').exec(),
      Module.find().select('title').exec(),
      videoStats(),
    ]);
    const moduleTitle = new Map(modules.map((m) => [m.id, m.title]));

    const ranked = videos
      .map((v) => {
        const s = stats.get(v.id);
        return {
          videoId: v.id,
          title: v.title,
          tier: v.tier,
          moduleTitle: moduleTitle.get(v.moduleId.toString()) ?? '',
          views: s?.started ?? 0,
          avgCompletion: s ? Math.round(s.avgCoverage * 100) : 0,
        };
      })
      .sort((a, b) => b.views - a.views);

    return { top: ranked.slice(0, 5), bottom: ranked.slice(-5).reverse() };
  },

  /** Certificate engagement: generated, downloaded (success/error), and downloads by tier. */
  async certificateStats() {
    const [generated, downloads, downloadErrors, byTierRows] = await Promise.all([
      Certificate.countDocuments(),
      Event.countDocuments({ type: 'cert_download' }),
      Event.countDocuments({ type: 'cert_download_error' }),
      Event.aggregate([
        { $match: { type: 'cert_download' } },
        { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'u' } },
        { $unwind: '$u' },
        { $group: { _id: '$u.tier', count: { $sum: 1 } } },
      ]) as Promise<Array<{ _id: Tier; count: number }>>,
    ]);

    const byTier = emptyTierRecord();
    for (const r of byTierRows) if (r._id in byTier) byTier[r._id] = r.count;

    return { generated, downloads, downloadErrors, byTier };
  },

  /**
   * Activity timeline bucketed by `day`/`week`/`month`, with per-period series:
   * activeUsers, watched (progress touches), completed, certificates.
   */
  async activity(granularity: Granularity = 'week', now: number = Date.now()) {
    const days = granularity === 'day' ? 30 : granularity === 'week' ? 84 : 365;
    const cutoff = new Date(now - days * 24 * 60 * 60 * 1000);
    const unit = granularity;
    const keyOf = (d: Date) => new Date(d).toISOString().slice(0, 10);

    const [progressRows, completedRows, certRows] = await Promise.all([
      Progress.aggregate([
        { $match: { updatedAt: { $gte: cutoff } } },
        {
          $group: {
            _id: { $dateTrunc: { date: '$updatedAt', unit } },
            users: { $addToSet: '$userId' },
            watched: { $sum: 1 },
          },
        },
        { $project: { activeUsers: { $size: '$users' }, watched: 1 } },
      ]) as Promise<Array<{ _id: Date; activeUsers: number; watched: number }>>,
      Progress.aggregate([
        { $match: { completed: true, completedAt: { $gte: cutoff } } },
        { $group: { _id: { $dateTrunc: { date: '$completedAt', unit } }, completed: { $sum: 1 } } },
      ]) as Promise<Array<{ _id: Date; completed: number }>>,
      Certificate.aggregate([
        { $match: { issuedAt: { $gte: cutoff } } },
        { $group: { _id: { $dateTrunc: { date: '$issuedAt', unit } }, certificates: { $sum: 1 } } },
      ]) as Promise<Array<{ _id: Date; certificates: number }>>,
    ]);

    const map = new Map<
      string,
      {
        period: string;
        activeUsers: number;
        watched: number;
        completed: number;
        certificates: number;
      }
    >();
    const bucket = (d: Date) => {
      const period = keyOf(d);
      let b = map.get(period);
      if (!b) {
        b = { period, activeUsers: 0, watched: 0, completed: 0, certificates: 0 };
        map.set(period, b);
      }
      return b;
    };

    for (const r of progressRows) {
      const b = bucket(r._id);
      b.activeUsers = r.activeUsers;
      b.watched = r.watched;
    }
    for (const r of completedRows) bucket(r._id).completed = r.completed;
    for (const r of certRows) bucket(r._id).certificates = r.certificates;

    return [...map.values()].sort((a, b) => a.period.localeCompare(b.period));
  },
};

import { Certificate } from '@/modules/certificate/certificate.model';
import { Event } from '@/modules/event/event.model';
import { Module } from '@/modules/module/module.model';
import { Progress } from '@/modules/progress/progress.model';
import { User } from '@/modules/user/user.model';
import { type Tier, TIERS } from '@/modules/user/user.types';
import { Video } from '@/modules/video/video.model';

export type Granularity = 'day' | 'week' | 'month';

/**
 * The admin screen's date chips. Every figure on it is scoped by this — the
 * chips are the one control over what the whole page counts, so a number shown
 * under "Last 7 days" is always a 7-day number.
 *
 * `all` is not offered by the UI; it is the default so an unversioned caller
 * keeps the all-time behaviour these endpoints had before.
 */
export type AnalyticsRange = '7d' | '30d' | '90d' | 'all';

const RANGE_DAYS: Record<Exclude<AnalyticsRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** Start of the window, or null for all time. */
export function rangeStart(range: AnalyticsRange = 'all', now: number = Date.now()): Date | null {
  return range === 'all' ? null : new Date(now - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);
}

/** `{ field: { $gte: start } }`, or nothing at all when the range is all-time. */
const from = (field: string, start: Date | null): Record<string, unknown> =>
  start ? { [field]: { $gte: start } } : {};

/** The day view's six blocks: 12AM, 4AM, 8AM, 12PM, 4PM, 8PM. */
const DAY_BIN_HOURS = 4;
const DAY_BINS = 24 / DAY_BIN_HOURS;
/** The week view's seven days, Monday first. */
const WEEK_BINS = 7;
/**
 * The month view's six groups: 1-5, 6-10, 11-15, 16-20, 21-25, 26-end. Only the
 * last one varies — it absorbs whatever the month has left, so 6 days in a
 * 31-day month, 5 in a 30-day one, 3 in a common February.
 */
const MONTH_GROUP_DAYS = 5;
const MONTH_GROUPS = 6;
const HOUR_MS = 60 * 60 * 1000;

/** Days since Monday, in whatever zone the label was formatted for. */
const DAYS_AFTER_MONDAY: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

/**
 * A zone Intl and Mongo will both accept. Anything unrecognised falls back to
 * UTC — a bad `tz` in a query string should not 500 a dashboard.
 */
function safeZone(tz?: string): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/**
 * Midnight of the current day in `tz`, as the UTC instant it falls on.
 *
 * Derived by subtracting the time already elapsed in that zone rather than by
 * rebuilding a date from parts, which keeps it right for offsets that are not
 * whole hours (India, Nepal, Chatham).
 */
function startOfDayIn(tz: string, now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed =
    at('hour') * HOUR_MS + at('minute') * 60_000 + at('second') * 1_000 + now.getMilliseconds();
  return new Date(now.getTime() - elapsed);
}

/** Midnight on Monday of the current week in `tz`, as the UTC instant it falls on. */
function startOfWeekIn(tz: string, now: Date): Date {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
  const back = DAYS_AFTER_MONDAY[weekday] ?? 0;
  // Step back through midday so a DST change earlier in the week cannot land
  // the arithmetic on the wrong side of a day boundary, then take that day's
  // own local midnight.
  return startOfDayIn(tz, new Date(startOfDayIn(tz, now).getTime() - (back * 24 - 12) * HOUR_MS));
}

/** Midnight on the 1st of the current month in `tz`, as the UTC instant it falls on. */
function startOfMonthIn(tz: string, now: Date): Date {
  const day = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric' }).format(now));
  return startOfDayIn(tz, new Date(startOfDayIn(tz, now).getTime() - ((day - 1) * 24 - 12) * HOUR_MS));
}

interface VideoStat {
  started: number;
  completed: number;
  avgCoverage: number;
}

function emptyTierRecord(): Record<Tier, number> {
  return Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
}

/**
 * Per-video {started, completed, avgCoverage} progress stats, keyed by videoId.
 * Scoped on `updatedAt`: a progress row counts for the window it was last
 * touched in, which is what makes "views in the last 7 days" mean anything.
 */
async function videoStats(start: Date | null): Promise<Map<string, VideoStat>> {
  const rows = (await Progress.aggregate([
    ...(start ? [{ $match: from('updatedAt', start) }] : []),
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
  /**
   * Headline counters: users, users by tier, certificates issued + downloaded.
   *
   * Under a range the user counts are SIGN-UPS in the window, not standing
   * membership — scoped on `createdAt`. The screen relabels the cards to match,
   * because "all accounts" would be a lie once a window is applied.
   */
  async overview(range: AnalyticsRange = 'all') {
    const start = rangeStart(range);
    const joined = from('createdAt', start);
    const [tierRows, totalUsers, certificatesIssued, certificateDownloads] = await Promise.all([
      User.aggregate([
        ...(start ? [{ $match: joined }] : []),
        { $group: { _id: '$tier', count: { $sum: 1 } } },
      ]) as Promise<Array<{ _id: Tier; count: number }>>,
      User.countDocuments(joined),
      Certificate.countDocuments(from('issuedAt', start)),
      Event.countDocuments({ type: 'cert_download', ...from('createdAt', start) }),
    ]);

    const usersByTier = emptyTierRecord();
    for (const row of tierRows) if (row._id in usersByTier) usersByTier[row._id] = row.count;

    return { totalUsers, usersByTier, certificatesIssued, certificateDownloads };
  },

  /** Video completion rate per module (completed ÷ started across its videos). */
  async moduleCompletion(range: AnalyticsRange = 'all') {
    const [modules, videos, stats] = await Promise.all([
      Module.find({ isPublished: true }).sort({ order: 1 }).exec(),
      Video.find({ status: 'published' }).exec(),
      videoStats(rangeStart(range)),
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
  async videoRankings(range: AnalyticsRange = 'all') {
    const [videos, modules, stats] = await Promise.all([
      Video.find({ status: 'published' }).select('title tier moduleId').exec(),
      Module.find().select('title').exec(),
      videoStats(rangeStart(range)),
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
  async certificateStats(range: AnalyticsRange = 'all') {
    const start = rangeStart(range);
    const [generated, downloads, downloadErrors, byTierRows] = await Promise.all([
      Certificate.countDocuments(from('issuedAt', start)),
      Event.countDocuments({ type: 'cert_download', ...from('createdAt', start) }),
      Event.countDocuments({ type: 'cert_download_error', ...from('createdAt', start) }),
      Event.aggregate([
        { $match: { type: 'cert_download', ...from('createdAt', start) } },
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
  async activity(granularity: Granularity = 'week', tz?: string, now: number = Date.now()) {
    const zone = safeZone(tz);
    const nowDate = new Date(now);
    // All three are now ONE calendar period, not a run of them: `day` in six
    // four-hour blocks, `week` in seven days Monday-first, `month` in six
    // day-groups.
    const isDay = granularity === 'day';
    const isWeek = granularity === 'week';
    const isMonth = granularity === 'month';

    const cutoff = isDay
      ? startOfDayIn(zone, nowDate)
      : isWeek
        ? startOfWeekIn(zone, nowDate)
        : startOfMonthIn(zone, nowDate);

    /**
     * Day-of-month → group 1..6. `$ceil(day / 5)` gives 7 on the 31st, which
     * `$min` folds back into group 6 — that is what makes the last group six
     * days long in a 31-day month.
     *
     * Grouped in Mongo rather than folded in JS afterwards, so `$addToSet`
     * counts members who were active ANYWHERE in the group once. Summing six
     * per-day counts would count a member who came back on three days as three.
     */
    const monthGroup = (date: string) => ({
      $min: [
        { $ceil: { $divide: [{ $dayOfMonth: { date, timezone: zone } }, MONTH_GROUP_DAYS] } },
        MONTH_GROUPS,
      ],
    });

    // Every view is a calendar view now, so all three bucket in the caller's
    // zone: "12AM", "Monday" and "the 1st" all start somewhere else on a UTC
    // server.
    const groupId = (date: string) =>
      isDay
        ? { $dateTrunc: { date, unit: 'hour', binSize: DAY_BIN_HOURS, timezone: zone } }
        : isWeek
          ? { $dateTrunc: { date, unit: 'day', timezone: zone } }
          : monthGroup(date);

    /** Local midnight of the first day in month group `n` (1-based). */
    const monthGroupStart = (n: number) =>
      startOfDayIn(
        zone,
        new Date(cutoff.getTime() + ((n - 1) * MONTH_GROUP_DAYS * 24 + 12) * HOUR_MS),
      );

    // The month pipeline groups on a number; the other two on a Date. Both come
    // back out as the instant the period starts, so the client can name it.
    const periodOf = (raw: unknown): Date =>
      isMonth ? monthGroupStart(Number(raw)) : new Date(raw as Date);

    // Keyed on the full instant so the client can name the block, weekday or
    // day-group in the same zone the server bucketed by.
    const keyOf = (d: Date) => new Date(d).toISOString();

    const [progressRows, completedRows, certRows] = await Promise.all([
      Progress.aggregate([
        { $match: { updatedAt: { $gte: cutoff } } },
        {
          $group: {
            _id: groupId('$updatedAt'),
            users: { $addToSet: '$userId' },
            watched: { $sum: 1 },
          },
        },
        { $project: { activeUsers: { $size: '$users' }, watched: 1 } },
      ]) as Promise<Array<{ _id: unknown; activeUsers: number; watched: number }>>,
      Progress.aggregate([
        { $match: { completed: true, completedAt: { $gte: cutoff } } },
        { $group: { _id: groupId('$completedAt'), completed: { $sum: 1 } } },
      ]) as Promise<Array<{ _id: unknown; completed: number }>>,
      Certificate.aggregate([
        { $match: { issuedAt: { $gte: cutoff } } },
        { $group: { _id: groupId('$issuedAt'), certificates: { $sum: 1 } } },
      ]) as Promise<Array<{ _id: unknown; certificates: number }>>,
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

    // The calendar views always show every column, quiet ones included: a chart
    // that drops empty periods reorders itself as data arrives, which is what
    // left the old day view showing TUE, WED, FRI, MON, THU, SUN, MON. Month
    // still returns only the periods that have rows.
    if (isDay)
      for (let i = 0; i < DAY_BINS; i += 1)
        bucket(new Date(cutoff.getTime() + i * DAY_BIN_HOURS * HOUR_MS));
    // Each day's OWN local midnight, not flat 24h steps: a DST change mid-week
    // would put the later steps an hour off the boundaries $dateTrunc produces,
    // and the week would come back with eight columns.
    if (isWeek)
      for (let i = 0; i < WEEK_BINS; i += 1)
        bucket(startOfDayIn(zone, new Date(cutoff.getTime() + (i * 24 + 12) * HOUR_MS)));
    if (isMonth) for (let n = 1; n <= MONTH_GROUPS; n += 1) bucket(monthGroupStart(n));

    for (const r of progressRows) {
      const b = bucket(periodOf(r._id));
      b.activeUsers = r.activeUsers;
      b.watched = r.watched;
    }
    for (const r of completedRows) bucket(periodOf(r._id)).completed = r.completed;
    for (const r of certRows) bucket(periodOf(r._id)).certificates = r.certificates;

    // ISO strings sort chronologically, for both the full instant and the date.
    return [...map.values()].sort((a, b) => a.period.localeCompare(b.period));
  },
};

import { logger } from '@/config/logger';
import { adminUsersService } from '@/modules/admin/admin-users.service';
import { parseCsv } from '@/modules/admin/csv';
import { invitationRepository } from '@/modules/invitation/invitation.repository';
import { invitationService } from '@/modules/invitation/invitation.service';
import { userRepository } from '@/modules/user/user.repository';
import type { Tier } from '@/modules/user/user.types';

/**
 * Unified "CSV member access" flow. Per row it either UPDATES an existing member's
 * tier or INVITES a new email at that tier. Email is mandatory; tier is detected
 * per-row by a case-insensitive keyword scan (NOT trusting the column alone), with
 * the video-tier names accepted as aliases.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Accepted tier words → canonical tier. free/paid/partner are the video-tier aliases. */
const TIER_ALIASES: Record<string, Tier> = {
  insight: 'insight',
  free: 'insight',
  mastery: 'mastery',
  paid: 'mastery',
  sovereign: 'sovereign',
  partner: 'sovereign',
};
const TIER_RE = new RegExp(`\\b(${Object.keys(TIER_ALIASES).join('|')})\\b`, 'i');

/** Access ordering, for upgrade/downgrade classification. */
const TIER_RANK: Record<Tier, number> = { insight: 0, mastery: 1, sovereign: 2 };

export type BulkAccessStatus = 'update' | 'invite' | 'reinvite' | 'skip' | 'error';

export interface BulkAccessRow {
  row: number; // 1-based data row
  email: string;
  name?: string | undefined;
  company?: string | undefined;
  currentTier: Tier | null; // the member's current tier; null when not yet a member
  newTier: Tier | null;
  status: BulkAccessStatus;
  change?: 'upgrade' | 'downgrade' | undefined; // only for `update`
  usedDefault?: boolean | undefined; // invite with no tier → defaulted to Insight (admin informed)
  message: string;
}

export interface BulkAccessSummary {
  total: number;
  applicable: number; // update + invite + reinvite
  update: number;
  invite: number;
  reinvite: number;
  upgrades: number;
  downgrades: number;
  warnings: number; // applied but tier defaulted to Insight (admin informed)
  skipped: number; // not applied (unchanged / unrecognized / duplicate)
  errors: number; // invalid / missing email
}

/** Which CSV header feeds each field, and how confidently it was matched (Map step). */
export type FieldMatch = 'exact' | 'fuzzy' | 'manual' | 'none';
export interface ResolvedColumn {
  header: string | null;
  match: FieldMatch;
}
export interface BulkAccessColumns {
  email: ResolvedColumn;
  name: ResolvedColumn;
  company: ResolvedColumn;
  tier: ResolvedColumn;
}
/** Admin overrides from the Map step. */
export interface ColumnMapping {
  email?: string | undefined;
  name?: string | undefined;
  company?: string | undefined;
  tier?: string | undefined;
}
export type TierAssignments = Record<string, Tier | 'skip'>;
export interface BulkAccessOptions {
  mapping?: ColumnMapping | undefined;
  tierValues?: TierAssignments | undefined;
}
export interface BulkAccessValidation {
  rows: BulkAccessRow[];
  summary: BulkAccessSummary;
  headers: string[];
  columns: BulkAccessColumns;
  /** Distinct tier-column values that matched no keyword and have no assignment yet. */
  unrecognizedTiers: { value: string; rows: number }[];
}

function matchTier(value: string): Tier | null {
  const m = TIER_RE.exec(value);
  return m ? (TIER_ALIASES[m[1]!.toLowerCase()] ?? null) : null;
}

const FIELD_MATCHERS: Record<keyof BulkAccessColumns, { exact: string[]; re: RegExp }> = {
  email: { exact: ['email', 'e-mail', 'work email'], re: /e-?mail/ },
  name: { exact: ['name', 'full name', 'fullname'], re: /name/ },
  company: {
    exact: ['company', 'organization', 'organisation', 'org'],
    re: /company|organi[sz]|org\b/,
  },
  tier: {
    exact: ['tier', 'access tier', 'plan', 'level'],
    re: /tier|access|plan|level|membership/,
  },
};

/** Resolve each field to a CSV header — admin override (manual) → exact → fuzzy → none. */
function resolveColumns(headers: string[], mapping: ColumnMapping | undefined): BulkAccessColumns {
  const resolve = (field: keyof BulkAccessColumns): ResolvedColumn => {
    const override = mapping?.[field];
    if (override && headers.includes(override)) return { header: override, match: 'manual' };
    const { exact, re } = FIELD_MATCHERS[field];
    const ex = headers.find((h) => exact.includes(h));
    if (ex) return { header: ex, match: 'exact' };
    const fz = headers.find((h) => re.test(h));
    if (fz) return { header: fz, match: 'fuzzy' };
    return { header: null, match: 'none' };
  };
  return {
    email: resolve('email'),
    name: resolve('name'),
    company: resolve('company'),
    tier: resolve('tier'),
  };
}

type TierState = 'ok' | 'skip-value' | 'unrecognized' | 'none';

/**
 * Row tier: an explicit tier-column value is authoritative — matched keyword, an
 * admin assignment (`tierValues`), 'skip', else "unrecognized". Only when there's no
 * explicit value do we scan the whole row (so we don't rely on the column alone).
 */
function rowTier(
  row: Record<string, string>,
  tierHeader: string | null,
  tierValues: TierAssignments,
): { tier: Tier | null; raw: string; state: TierState } {
  const raw = tierHeader ? (row[tierHeader] ?? '').trim() : '';
  if (raw) {
    const matched = matchTier(raw);
    if (matched) return { tier: matched, raw, state: 'ok' };
    const assigned = tierValues[raw.toLowerCase()];
    if (assigned === 'skip') return { tier: null, raw, state: 'skip-value' };
    if (assigned) return { tier: assigned, raw, state: 'ok' };
    return { tier: null, raw, state: 'unrecognized' };
  }
  for (const value of Object.values(row)) {
    const matched = matchTier(value);
    if (matched) return { tier: matched, raw: '', state: 'ok' };
  }
  return { tier: null, raw: '', state: 'none' };
}

function tierLabel(tier: Tier): string {
  return tier[0]!.toUpperCase() + tier.slice(1);
}

export const bulkAccessService = {
  /** Dry-run: classify each row (update / invite / skip / error) WITHOUT applying. */
  async validate(csvText: string, opts: BulkAccessOptions = {}): Promise<BulkAccessValidation> {
    const parsed = parseCsv(csvText);
    const emptySummary: BulkAccessSummary = {
      total: 0,
      applicable: 0,
      update: 0,
      invite: 0,
      reinvite: 0,
      upgrades: 0,
      downgrades: 0,
      warnings: 0,
      skipped: 0,
      errors: 0,
    };
    const headers = parsed.length ? Object.keys(parsed[0]!) : [];
    const columns = resolveColumns(headers, opts.mapping);
    if (parsed.length === 0) {
      return { rows: [], summary: emptySummary, headers, columns, unrecognizedTiers: [] };
    }

    // Normalize tier assignments to lowercase keys (rowTier looks up lowercased).
    const tierValues: TierAssignments = {};
    for (const [k, v] of Object.entries(opts.tierValues ?? {}))
      tierValues[k.toLowerCase().trim()] = v;

    const emailKey = columns.email.header;
    const nameKey = columns.name.header;
    const companyKey = columns.company.header;
    const tierKey = columns.tier.header;

    // Resolve email per row (mapped column, else the first email-looking cell).
    const emailFor = (row: Record<string, string>): string => {
      const raw = emailKey
        ? row[emailKey]
        : Object.values(row).find((v) => EMAIL_RE.test(v.trim()));
      return (raw ?? '').toLowerCase().trim();
    };

    // One indexed lookup each for the whole file: members drive update-vs-invite,
    // and pending invitations drive invite-vs-reinvite.
    const emails = parsed.map(emailFor).filter((e) => EMAIL_RE.test(e));
    const uniqueEmails = [...new Set(emails)];
    const [existing, invitations] = await Promise.all([
      userRepository.findByEmails(uniqueEmails),
      invitationRepository.findByEmails(uniqueEmails),
    ]);
    const byEmail = new Map(existing.map((u) => [u.email, u]));
    const invByEmail = new Map(invitations.map((inv) => [inv.email, inv]));

    // Unrecognized tier values are counted over the WHOLE file, in their own
    // pass. Doing it inside the row loop below missed every row that returns
    // early — a duplicate or unreadable email — so a value appearing twice in
    // the file could report one row. This card answers "what is in the file",
    // not "what will change"; the preview and the validate step answer that.
    // Grouped case-insensitively, because tierValues is looked up lowercased:
    // "Pro" and "pro" are one value to assign, so they are one row here too.
    const unrecognized = new Map<string, { value: string; rows: number }>();
    for (const row of parsed) {
      const t = rowTier(row, tierKey, tierValues);
      if (t.state !== 'unrecognized') continue;
      const key = t.raw.toLowerCase();
      const entry = unrecognized.get(key);
      if (entry) entry.rows += 1;
      else unrecognized.set(key, { value: t.raw, rows: 1 });
    }

    const seen = new Set<string>();
    const rows: BulkAccessRow[] = parsed.map((row, i) => {
      const n = i + 1;
      const email = emailFor(row);
      const name = nameKey ? row[nameKey]?.trim() || undefined : undefined;
      const company = companyKey ? row[companyKey]?.trim() || undefined : undefined;
      const base = { row: n, email, name, company, currentTier: null, newTier: null } as const;

      if (!email) return { ...base, status: 'error', message: 'Missing email' };
      if (!EMAIL_RE.test(email)) return { ...base, status: 'error', message: 'Invalid email' };
      if (seen.has(email)) return { ...base, status: 'skip', message: 'Duplicate row in file' };
      seen.add(email);

      const t = rowTier(row, tierKey, tierValues);
      const user = byEmail.get(email);
      const isMember = !!user && user.registrationStatus === 'completed';

      if (isMember) {
        const currentTier = user!.tier;
        if (!t.tier) {
          const message =
            t.state === 'unrecognized'
              ? `Unrecognized tier "${t.raw}"`
              : t.state === 'skip-value'
                ? `Skipped tier "${t.raw}"`
                : 'No tier in row';
          return { ...base, currentTier, status: 'skip', message };
        }
        if (t.tier === currentTier) {
          return {
            ...base,
            currentTier,
            newTier: t.tier,
            status: 'skip',
            message: `Already ${tierLabel(t.tier)}`,
          };
        }
        const change = TIER_RANK[t.tier] > TIER_RANK[currentTier] ? 'upgrade' : 'downgrade';
        return {
          ...base,
          currentTier,
          newTier: t.tier,
          status: 'update',
          change,
          message: `${tierLabel(currentTier)} → ${tierLabel(t.tier)}`,
        };
      }

      // Not a completed member → invite or re-invite.
      if (t.state === 'unrecognized')
        return { ...base, status: 'skip', message: `Unrecognized tier "${t.raw}"` };
      if (t.state === 'skip-value')
        return { ...base, status: 'skip', message: `Skipped tier "${t.raw}"` };
      const invitation = invByEmail.get(email);
      if (invitation?.status === 'joined') {
        return { ...base, status: 'skip', message: 'Already joined' };
      }
      if (invitation) {
        const reTier: Tier = t.tier ?? invitation.tier;
        return {
          ...base,
          newTier: reTier,
          status: 'reinvite',
          message: `Re-inviting at ${tierLabel(reTier)}`,
        };
      }
      const newTier: Tier = t.tier ?? 'insight';
      const usedDefault = !t.tier;
      return {
        ...base,
        newTier,
        status: 'invite',
        usedDefault,
        message: usedDefault
          ? 'No tier in row — defaulting to Insight'
          : `Invite at ${tierLabel(newTier)}`,
      };
    });

    return {
      rows,
      summary: summarize(rows),
      headers,
      columns,
      unrecognizedTiers: [...unrecognized.values()],
    };
  },

  /**
   * Apply: re-validates server-side (fresh), then updates member tiers + sends
   * invites. Sequential so we don't hammer Clerk. Reuses `adminUsersService.updateTier`
   * (Clerk metadata + mirror) and the invitation primitive.
   */
  async apply(
    csvText: string,
    invitedByAdminId: string,
    opts: BulkAccessOptions = {},
  ): Promise<{
    summary: {
      total: number;
      updated: number;
      invited: number;
      resent: number;
      skipped: number;
      failed: number;
    };
  }> {
    const { rows } = await this.validate(csvText, opts);
    const summary = {
      total: rows.length,
      updated: 0,
      invited: 0,
      resent: 0,
      skipped: 0,
      failed: 0,
    };

    for (const row of rows) {
      if (row.status === 'error') {
        summary.failed += 1;
        continue;
      }
      if (row.status === 'skip') {
        summary.skipped += 1;
        continue;
      }
      try {
        if (row.status === 'update' && row.newTier) {
          const user = await userRepository.findByEmail(row.email);
          if (!user) {
            summary.failed += 1;
            continue;
          }
          await adminUsersService.updateTier(user.id, row.newTier);
          summary.updated += 1;
        } else if (row.status === 'invite' || row.status === 'reinvite') {
          const result = await invitationService.inviteRow({
            email: row.email,
            fullName: row.name,
            company: row.company,
            tier: row.newTier ?? 'insight',
            invitedByAdminId,
          });
          if (result.outcome === 'invited') summary.invited += 1;
          else if (result.outcome === 'resent') summary.resent += 1;
          else if (result.outcome === 'skipped') summary.skipped += 1;
          else summary.failed += 1;
        }
      } catch (err) {
        logger.warn({ err, email: row.email, status: row.status }, 'Bulk-access apply row failed');
        summary.failed += 1;
      }
    }

    return { summary };
  },
};

function summarize(rows: BulkAccessRow[]): BulkAccessSummary {
  const update = rows.filter((r) => r.status === 'update');
  const applicable = rows.filter(
    (r) => r.status === 'update' || r.status === 'invite' || r.status === 'reinvite',
  );
  return {
    total: rows.length,
    applicable: applicable.length,
    update: update.length,
    invite: rows.filter((r) => r.status === 'invite').length,
    reinvite: rows.filter((r) => r.status === 'reinvite').length,
    upgrades: update.filter((r) => r.change === 'upgrade').length,
    downgrades: update.filter((r) => r.change === 'downgrade').length,
    warnings: rows.filter((r) => r.usedDefault).length,
    skipped: rows.filter((r) => r.status === 'skip').length,
    errors: rows.filter((r) => r.status === 'error').length,
  };
}

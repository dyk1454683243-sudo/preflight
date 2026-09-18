import { isSameLocalDay, localStartOfDay } from './date.js';

/**
 * Org-reported spend entered by a person in Settings. Stored separately from
 * Preflight's list-price estimate — it never edits or offsets BudgetTracker.
 */
export type ReportedSpendPeriodKind = 'daily' | 'weekly';

export interface ReportedSpend {
  readonly periodKind: ReportedSpendPeriodKind;
  readonly amountUsd: number;
  /** ISO-8601 timestamp set server-side when the value is saved. */
  readonly asOf: string;
}

/** PATCH body shape — `asOf` is assigned on the server, never taken from the client. */
export interface ReportedSpendInput {
  readonly periodKind: ReportedSpendPeriodKind;
  readonly amountUsd: number;
}

export type ReportedSpendPatchResult =
  | { readonly kind: 'clear' }
  | { readonly kind: 'set'; readonly value: ReportedSpendInput }
  | { readonly kind: 'invalid'; readonly error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPeriodKind(value: unknown): value is ReportedSpendPeriodKind {
  return value === 'daily' || value === 'weekly';
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Parse a persisted `reportedSpend` object from disk. Missing or malformed
 * values become `null` so the settings GET never serves a partial figure.
 */
export function parseReportedSpend(value: unknown): ReportedSpend | null {
  if (value == null) return null;
  if (!isRecord(value)) return null;
  if (!isPeriodKind(value.periodKind)) return null;
  if (!isNonNegativeFinite(value.amountUsd)) return null;
  if (typeof value.asOf !== 'string' || Number.isNaN(Date.parse(value.asOf))) return null;
  return {
    periodKind: value.periodKind,
    amountUsd: value.amountUsd,
    asOf: value.asOf,
  };
}

/**
 * Parse a PATCH `/api/settings` `reportedSpend` field. `null` clears the
 * stored value. A client-supplied `asOf` is ignored — the handler stamps it.
 */
export function parseReportedSpendPatch(value: unknown): ReportedSpendPatchResult {
  if (value === null) return { kind: 'clear' };
  if (!isRecord(value)) {
    return { kind: 'invalid', error: 'reportedSpend must be an object or null' };
  }
  if (!isPeriodKind(value.periodKind)) {
    return { kind: 'invalid', error: "reportedSpend.periodKind must be 'daily' or 'weekly'" };
  }
  if (!isNonNegativeFinite(value.amountUsd)) {
    return {
      kind: 'invalid',
      error: 'reportedSpend.amountUsd must be a non-negative number',
    };
  }
  return {
    kind: 'set',
    value: { periodKind: value.periodKind, amountUsd: value.amountUsd },
  };
}

/**
 * Local Monday 00:00 of the ISO week containing `refTs`. Used only for the
 * weekly staleness rule — a reported weekly figure from last week is stale.
 */
export function localStartOfIsoWeek(refTs?: number): number {
  const start = new Date(localStartOfDay(refTs));
  const day = start.getDay(); // 0 Sun … 6 Sat
  const daysFromMonday = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - daysFromMonday);
  return start.getTime();
}

/**
 * A reported figure is stale when `asOf` falls before the start of its
 * period: yesterday for `daily`, before this week's Monday for `weekly`.
 * Stale values stay visible (greyed) rather than being hidden.
 */
export function isReportedSpendStale(reported: ReportedSpend, now: number = Date.now()): boolean {
  const asOf = Date.parse(reported.asOf);
  if (Number.isNaN(asOf)) return true;
  if (reported.periodKind === 'daily') {
    return !isSameLocalDay(asOf, now);
  }
  return asOf < localStartOfIsoWeek(now);
}

/** The Today meter is daily; a weekly figure is stored but not drawn there. */
export function reportedSpendForMeter(
  reported: ReportedSpend | null | undefined,
  meterPeriod: ReportedSpendPeriodKind,
): ReportedSpend | null {
  if (reported == null || reported.periodKind !== meterPeriod) return null;
  return reported;
}

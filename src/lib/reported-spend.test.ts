import { describe, expect, it } from '@jest/globals';

import {
  isReportedSpendStale,
  localStartOfIsoWeek,
  parseReportedSpend,
  parseReportedSpendPatch,
  reportedSpendForMeter,
  type ReportedSpend,
} from './reported-spend.js';

function makeReported(overrides: Partial<ReportedSpend> = {}): ReportedSpend {
  return {
    periodKind: 'daily',
    amountUsd: 12.5,
    asOf: '2026-09-18T15:42:00.000Z',
    ...overrides,
  };
}

describe('parseReportedSpend', () => {
  it('returns a complete object when every field is valid', () => {
    expect(parseReportedSpend(makeReported())).toEqual(makeReported());
  });

  it('returns null for missing, null, or non-object values', () => {
    expect(parseReportedSpend(undefined)).toBeNull();
    expect(parseReportedSpend(null)).toBeNull();
    expect(parseReportedSpend(12.5)).toBeNull();
    expect(parseReportedSpend('daily')).toBeNull();
  });

  it('returns null when periodKind, amountUsd, or asOf is malformed', () => {
    expect(parseReportedSpend(makeReported({ periodKind: 'monthly' as 'daily' }))).toBeNull();
    expect(parseReportedSpend({ ...makeReported(), amountUsd: -1 })).toBeNull();
    expect(parseReportedSpend({ ...makeReported(), amountUsd: Number.NaN })).toBeNull();
    expect(parseReportedSpend({ ...makeReported(), asOf: 'not-a-date' })).toBeNull();
    expect(parseReportedSpend({ periodKind: 'daily', amountUsd: 1 })).toBeNull();
  });
});

describe('parseReportedSpendPatch', () => {
  it('clears on null', () => {
    expect(parseReportedSpendPatch(null)).toEqual({ kind: 'clear' });
  });

  it('accepts periodKind and amountUsd and ignores a client asOf', () => {
    expect(
      parseReportedSpendPatch({
        periodKind: 'weekly',
        amountUsd: 80,
        asOf: '1999-01-01T00:00:00.000Z',
      }),
    ).toEqual({ kind: 'set', value: { periodKind: 'weekly', amountUsd: 80 } });
  });

  it('rejects a non-object, a bad period, and a negative amount', () => {
    expect(parseReportedSpendPatch('daily')).toEqual({
      kind: 'invalid',
      error: 'reportedSpend must be an object or null',
    });
    expect(parseReportedSpendPatch({ periodKind: 'monthly', amountUsd: 1 })).toEqual({
      kind: 'invalid',
      error: "reportedSpend.periodKind must be 'daily' or 'weekly'",
    });
    expect(parseReportedSpendPatch({ periodKind: 'daily', amountUsd: -4 })).toEqual({
      kind: 'invalid',
      error: 'reportedSpend.amountUsd must be a non-negative number',
    });
  });
});

describe('isReportedSpendStale', () => {
  // Friday 18 Sep 2026 15:00 local. Monday of that ISO week is the 14th.
  const fridayAfternoon = new Date(2026, 8, 18, 15, 0, 0).getTime();

  it('treats a daily value from earlier today as fresh', () => {
    const asOf = new Date(2026, 8, 18, 8, 0, 0).toISOString();
    expect(isReportedSpendStale(makeReported({ asOf }), fridayAfternoon)).toBe(false);
  });

  it('treats a daily value from yesterday as stale', () => {
    const asOf = new Date(2026, 8, 17, 15, 42, 0).toISOString();
    expect(isReportedSpendStale(makeReported({ asOf }), fridayAfternoon)).toBe(true);
  });

  it('treats a weekly value from this Monday as fresh and last Sunday as stale', () => {
    const thisMonday = new Date(2026, 8, 14, 9, 0, 0).toISOString();
    const lastSunday = new Date(2026, 8, 13, 18, 0, 0).toISOString();
    expect(
      isReportedSpendStale(
        makeReported({ periodKind: 'weekly', asOf: thisMonday }),
        fridayAfternoon,
      ),
    ).toBe(false);
    expect(
      isReportedSpendStale(
        makeReported({ periodKind: 'weekly', asOf: lastSunday }),
        fridayAfternoon,
      ),
    ).toBe(true);
  });

  it('treats an unparseable asOf as stale', () => {
    expect(isReportedSpendStale(makeReported({ asOf: 'bogus' }), fridayAfternoon)).toBe(true);
  });
});

describe('localStartOfIsoWeek', () => {
  it('returns Monday 00:00 of the week containing Friday', () => {
    const friday = new Date(2026, 8, 18, 15, 0, 0).getTime();
    const start = new Date(localStartOfIsoWeek(friday));
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(14);
    expect(start.getHours()).toBe(0);
  });
});

describe('reportedSpendForMeter', () => {
  it('returns the value only when the period matches the meter', () => {
    const daily = makeReported({ periodKind: 'daily' });
    const weekly = makeReported({ periodKind: 'weekly' });
    expect(reportedSpendForMeter(daily, 'daily')).toEqual(daily);
    expect(reportedSpendForMeter(weekly, 'daily')).toBeNull();
    expect(reportedSpendForMeter(null, 'daily')).toBeNull();
  });
});

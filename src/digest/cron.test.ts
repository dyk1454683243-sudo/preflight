import { describe, it, expect } from '@jest/globals';

import { cronMatches, parseCronExpression, parseDigestSchedule } from './cron.js';

function at(year: number, monthIndex: number, day: number, hour: number, minute: number): Date {
  return new Date(year, monthIndex, day, hour, minute, 0, 0);
}

// 2026-09-21 is a Monday.
const MON_9AM = at(2026, 8, 21, 9, 0);
const MON_901 = at(2026, 8, 21, 9, 1);
const TUE_9AM = at(2026, 8, 22, 9, 0);
const FRI_9AM = at(2026, 8, 18, 9, 0);
const SUN_9AM = at(2026, 8, 20, 9, 0);

describe('parseCronExpression()', () => {
  it('parses the default Monday-9am expression', () => {
    const expr = parseCronExpression('0 9 * * 1');
    expect(expr.minute).toEqual(new Set([0]));
    expect(expr.hour).toEqual(new Set([9]));
    expect(expr.dayOfMonthIsWildcard).toBe(true);
    expect(expr.dayOfWeekIsWildcard).toBe(false);
    expect(expr.dayOfWeek).toEqual(new Set([1]));
  });

  it('accepts extra whitespace between fields', () => {
    const expr = parseCronExpression('  0   9  *  *  1  ');
    expect(expr.raw).toBe('0   9  *  *  1');
    expect(cronMatches(expr, MON_9AM)).toBe(true);
  });

  it('expands lists, ranges, and steps', () => {
    const expr = parseCronExpression('0,30 8-9 1,15 * 1-5');
    expect(expr.minute).toEqual(new Set([0, 30]));
    expect(expr.hour).toEqual(new Set([8, 9]));
    expect(expr.dayOfMonth).toEqual(new Set([1, 15]));
    expect(expr.dayOfWeek).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('expands */n and n/step (n-max/step)', () => {
    const stars = parseCronExpression('*/15 * * * *');
    expect(stars.minute).toEqual(new Set([0, 15, 30, 45]));

    const fromTwo = parseCronExpression('2/20 * * * *');
    expect(fromTwo.minute).toEqual(new Set([2, 22, 42]));
  });

  it('accepts 3-letter month and day-of-week names', () => {
    const expr = parseCronExpression('0 9 * JAN MON');
    expect(expr.month).toEqual(new Set([1]));
    expect(expr.dayOfWeek).toEqual(new Set([1]));
  });

  it('treats day-of-week 7 as Sunday', () => {
    const expr = parseCronExpression('0 9 * * 7');
    expect(expr.dayOfWeek).toEqual(new Set([0]));
    expect(cronMatches(expr, SUN_9AM)).toBe(true);
    expect(cronMatches(expr, MON_9AM)).toBe(false);
  });

  it('rejects empty, wrong field counts, and out-of-range values', () => {
    expect(() => parseCronExpression('')).toThrow(/5-field cron expression/);
    expect(() => parseCronExpression('0 9 * *')).toThrow(/got 4 field/);
    expect(() => parseCronExpression('0 9 * * 1 *')).toThrow(/got 6 field/);
    expect(() => parseCronExpression('60 9 * * 1')).toThrow(/minute value 60 is out of range/);
    expect(() => parseCronExpression('0 24 * * 1')).toThrow(/hour value 24 is out of range/);
    expect(() => parseCronExpression('0 9 0 * 1')).toThrow(/day-of-month value 0 is out of range/);
    expect(() => parseCronExpression('0 9 * 13 1')).toThrow(/month value 13 is out of range/);
    expect(() => parseCronExpression('0 9 * * 8')).toThrow(/day-of-week value 8 is out of range/);
  });

  it('rejects inverted ranges, zero steps, empty list items, and unknown tokens', () => {
    expect(() => parseCronExpression('5-2 * * * *')).toThrow(/inverted/);
    expect(() => parseCronExpression('*/0 * * * *')).toThrow(/step must be a positive integer/);
    expect(() => parseCronExpression('1,,2 * * * *')).toThrow(/empty list item/);
    expect(() => parseCronExpression('foo * * * *')).toThrow(/not a number/);
    expect(() => parseCronExpression('@daily')).toThrow(/5-field cron expression/);
  });
});

describe('parseDigestSchedule()', () => {
  it('prefixes parse errors with the config field name', () => {
    expect(() => parseDigestSchedule('not-cron')).toThrow(
      /Invalid digestSchedule 'not-cron': expected a 5-field cron expression/,
    );
  });

  it('returns the parsed expression for a valid schedule', () => {
    expect(parseDigestSchedule('0 9 * * 1').hour).toEqual(new Set([9]));
  });
});

describe('cronMatches()', () => {
  it('matches the default Monday 9:00 local time and no adjacent minute', () => {
    const expr = parseCronExpression('0 9 * * 1');
    expect(cronMatches(expr, MON_9AM)).toBe(true);
    expect(cronMatches(expr, MON_901)).toBe(false);
    expect(cronMatches(expr, TUE_9AM)).toBe(false);
    expect(cronMatches(expr, FRI_9AM)).toBe(false);
  });

  it('uses Vixie OR when both day-of-month and day-of-week are restricted', () => {
    // 15th OR Monday at 09:00
    const expr = parseCronExpression('0 9 15 * 1');
    const fifteenthTue = at(2026, 8, 15, 9, 0); // Tuesday the 15th
    expect(cronMatches(expr, fifteenthTue)).toBe(true);
    expect(cronMatches(expr, MON_9AM)).toBe(true); // Monday, not the 15th
    expect(cronMatches(expr, TUE_9AM)).toBe(false); // Tuesday the 22nd
  });

  it('uses AND when only one of day-of-month / day-of-week is restricted', () => {
    const fifteenthOnly = parseCronExpression('0 9 15 * *');
    const fifteenthTue = at(2026, 8, 15, 9, 0);
    expect(cronMatches(fifteenthOnly, fifteenthTue)).toBe(true);
    expect(cronMatches(fifteenthOnly, MON_9AM)).toBe(false);

    const weekdays = parseCronExpression('0 9 * * 1-5');
    expect(cronMatches(weekdays, MON_9AM)).toBe(true);
    expect(cronMatches(weekdays, SUN_9AM)).toBe(false);
  });

  it('matches stepped minutes', () => {
    const expr = parseCronExpression('*/15 9 * * 1');
    expect(cronMatches(expr, at(2026, 8, 21, 9, 0))).toBe(true);
    expect(cronMatches(expr, at(2026, 8, 21, 9, 15))).toBe(true);
    expect(cronMatches(expr, at(2026, 8, 21, 9, 7))).toBe(false);
  });
});

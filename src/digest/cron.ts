/**
 * 5-field crontab parser (minute hour day-of-month month day-of-week).
 * Used by `digestSchedule`. Local-timezone matching; day-of-week 0 and 7 are
 * Sunday. When both day-of-month and day-of-week are restricted (not `*`),
 * a date matches if either field matches (Vixie cron).
 */

export interface CronExpression {
  readonly raw: string;
  readonly minute: ReadonlySet<number>;
  readonly hour: ReadonlySet<number>;
  readonly dayOfMonth: ReadonlySet<number>;
  readonly month: ReadonlySet<number>;
  readonly dayOfWeek: ReadonlySet<number>;
  readonly dayOfMonthIsWildcard: boolean;
  readonly dayOfWeekIsWildcard: boolean;
}

const MONTH_ALIASES: Readonly<Record<string, number>> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const DOW_ALIASES: Readonly<Record<string, number>> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

interface FieldSpec {
  readonly min: number;
  readonly max: number;
  readonly name: string;
  readonly aliases?: Readonly<Record<string, number>>;
}

const FIELDS: readonly FieldSpec[] = [
  { min: 0, max: 59, name: 'minute' },
  { min: 0, max: 23, name: 'hour' },
  { min: 1, max: 31, name: 'day-of-month' },
  { min: 1, max: 12, name: 'month', aliases: MONTH_ALIASES },
  { min: 0, max: 7, name: 'day-of-week', aliases: DOW_ALIASES },
];

export function parseCronExpression(raw: string): CronExpression {
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new Error(
      'expected a 5-field cron expression (minute hour day-of-month month day-of-week), e.g. "0 9 * * 1"',
    );
  }
  const tokens = trimmed.split(/\s+/);
  if (tokens.length !== 5) {
    throw new Error(
      `expected a 5-field cron expression (minute hour day-of-month month day-of-week), e.g. "0 9 * * 1"; got ${tokens.length} field(s)`,
    );
  }

  const parsed = tokens.map((token, i) => parseField(token, FIELDS[i]!));
  return {
    raw: trimmed,
    minute: parsed[0]!.values,
    hour: parsed[1]!.values,
    dayOfMonth: parsed[2]!.values,
    month: parsed[3]!.values,
    dayOfWeek: parsed[4]!.values,
    dayOfMonthIsWildcard: parsed[2]!.wildcard,
    dayOfWeekIsWildcard: parsed[4]!.wildcard,
  };
}

/**
 * Same as `parseCronExpression`, but prefixes errors with the config field
 * name so config-load and settings-PATCH messages stay consistent.
 */
export function parseDigestSchedule(value: string): CronExpression {
  try {
    return parseCronExpression(value);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid digestSchedule '${value}': ${detail}`);
  }
}

export function cronMatches(expr: CronExpression, date: Date): boolean {
  if (!expr.minute.has(date.getMinutes())) return false;
  if (!expr.hour.has(date.getHours())) return false;
  if (!expr.month.has(date.getMonth() + 1)) return false;

  const dom = date.getDate();
  const dow = date.getDay();
  const domOk = expr.dayOfMonth.has(dom);
  const dowOk = expr.dayOfWeek.has(dow);

  if (expr.dayOfMonthIsWildcard || expr.dayOfWeekIsWildcard) {
    return domOk && dowOk;
  }
  // Vixie: both restricted → match if either matches.
  return domOk || dowOk;
}

interface ParsedField {
  readonly values: Set<number>;
  readonly wildcard: boolean;
}

function parseField(field: string, spec: FieldSpec): ParsedField {
  const wildcard = field === '*';
  const values = new Set<number>();
  for (const part of field.split(',')) {
    for (const n of parsePart(part, spec)) {
      values.add(n);
    }
  }
  if (values.size === 0) {
    throw new Error(`${spec.name} field '${field}' matched no values`);
  }
  return { values, wildcard };
}

function parsePart(part: string, spec: FieldSpec): readonly number[] {
  if (part === '') {
    throw new Error(`${spec.name} has an empty list item`);
  }
  const slash = part.split('/');
  if (slash.length > 2) {
    throw new Error(`invalid ${spec.name} step '${part}'`);
  }
  let step = 1;
  if (slash.length === 2) {
    if (!/^[1-9]\d*$/.test(slash[1]!)) {
      throw new Error(`${spec.name} step must be a positive integer`);
    }
    step = Number(slash[1]);
  }

  const rangeTok = slash[0]!;
  let start: number;
  let end: number;
  if (rangeTok === '*') {
    start = spec.min;
    end = spec.max;
  } else if (rangeTok.includes('-')) {
    const bits = rangeTok.split('-');
    if (bits.length !== 2 || bits[0] === '' || bits[1] === '') {
      throw new Error(`invalid ${spec.name} range '${rangeTok}'`);
    }
    start = parseValue(bits[0]!, spec);
    end = parseValue(bits[1]!, spec);
    if (start > end) {
      throw new Error(`${spec.name} range '${rangeTok}' is inverted`);
    }
  } else {
    start = parseValue(rangeTok, spec);
    // `n/step` means `n-max/step` (Vixie).
    end = slash.length === 2 ? spec.max : start;
  }

  const out: number[] = [];
  for (let i = start; i <= end; i += step) {
    out.push(normalizeDow(i, spec));
  }
  return out;
}

function parseValue(token: string, spec: FieldSpec): number {
  const lower = token.toLowerCase();
  if (spec.aliases && lower in spec.aliases) {
    return spec.aliases[lower]!;
  }
  if (!/^\d+$/.test(token)) {
    throw new Error(`${spec.name} value '${token}' is not a number`);
  }
  const n = Number(token);
  if (n < spec.min || n > spec.max) {
    throw new Error(`${spec.name} value ${n} is out of range ${spec.min}-${spec.max}`);
  }
  return n;
}

function normalizeDow(n: number, spec: FieldSpec): number {
  if (spec.name === 'day-of-week' && n === 7) return 0;
  return n;
}

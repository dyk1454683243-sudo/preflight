import { readFileSync } from 'node:fs';

import { createLogger } from '../shared/index.js';

import { cronMatches, parseDigestSchedule } from './cron.js';

const logger = createLogger('digest-scheduler');

/** How often the --local daemon re-evaluates `digestSchedule`. */
export const DEFAULT_DIGEST_POLL_MS = 15_000;

export interface DigestSendResult {
  readonly content: ReadonlyArray<{ readonly type: 'text'; readonly text: string }>;
}

export interface DigestSchedulerOptions {
  /**
   * Current 5-field cron expression. Re-read on every tick so a settings
   * PATCH (or env change in the same process) is picked up without restart.
   */
  readonly getSchedule: () => string;
  /** Same path `nr_observe_send_digest` uses. */
  readonly send: () => Promise<DigestSendResult>;
  readonly now?: () => Date;
  readonly intervalMs?: number;
}

/**
 * Resolve `digestSchedule` with the same priority as `loadMcpConfig`:
 * env `NEW_RELIC_AI_DIGEST_SCHEDULE` > config file > fallback.
 */
export function resolveDigestSchedule(configFilePath: string, fallback: string): string {
  if (process.env.NEW_RELIC_AI_DIGEST_SCHEDULE !== undefined) {
    return process.env.NEW_RELIC_AI_DIGEST_SCHEDULE;
  }
  try {
    const raw = JSON.parse(readFileSync(configFilePath, 'utf-8')) as Record<string, unknown>;
    if (typeof raw.digestSchedule === 'string') return raw.digestSchedule;
  } catch {
    /* missing or unreadable config — use the in-memory fallback */
  }
  return fallback;
}

function minuteKey(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${day}T${h}:${mi}`;
}

function parseSendPayload(result: DigestSendResult): {
  readonly ok?: boolean;
  readonly week?: string;
  readonly error?: string;
  readonly message?: string;
} {
  const text = result.content[0]?.text;
  if (typeof text !== 'string') return {};
  try {
    return JSON.parse(text) as {
      ok?: boolean;
      week?: string;
      error?: string;
      message?: string;
    };
  } catch {
    return {};
  }
}

/**
 * Long-running cron ticker for Slack digest delivery. Start only from
 * `--local` — a per-session `--stdio` engine is the wrong lifetime.
 */
export class DigestScheduler {
  private readonly getSchedule: () => string;
  private readonly send: () => Promise<DigestSendResult>;
  private readonly now: () => Date;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastFiredMinute: string | null = null;
  private lastSchedule: string | null = null;
  private inFlight = false;

  constructor(opts: DigestSchedulerOptions) {
    this.getSchedule = opts.getSchedule;
    this.send = opts.send;
    this.now = opts.now ?? (() => new Date());
    this.intervalMs = opts.intervalMs ?? DEFAULT_DIGEST_POLL_MS;
  }

  start(): void {
    if (this.timer !== null) return;
    logger.info('Digest scheduler started', { intervalMs: this.intervalMs });
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info('Digest scheduler stopped');
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;

    let schedule: string;
    try {
      schedule = this.getSchedule();
    } catch (err) {
      logger.warn('Failed to read digestSchedule; skipping tick', { error: String(err) });
      return;
    }

    if (schedule !== this.lastSchedule) {
      if (this.lastSchedule !== null) {
        logger.info('Digest schedule updated', { schedule });
      } else {
        logger.info('Digest schedule loaded', { schedule });
      }
      this.lastSchedule = schedule;
    }

    let expr;
    try {
      expr = parseDigestSchedule(schedule);
    } catch (err) {
      logger.warn('Invalid digestSchedule at tick; skipping', {
        schedule,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const now = this.now();
    if (!cronMatches(expr, now)) return;

    const key = minuteKey(now);
    if (this.lastFiredMinute === key) return;

    this.lastFiredMinute = key;
    this.inFlight = true;
    try {
      const result = await this.send();
      const payload = parseSendPayload(result);
      if (payload.ok) {
        logger.info('Scheduled digest sent', { week: payload.week, schedule });
      } else if (payload.error) {
        logger.warn('Scheduled digest skipped', { error: payload.error, schedule });
      } else {
        logger.warn('Scheduled digest returned an unexpected payload', { schedule });
      }
    } catch (err) {
      logger.warn('Scheduled digest failed', {
        error: err instanceof Error ? err.message : String(err),
        schedule,
      });
    } finally {
      this.inFlight = false;
    }
  }
}

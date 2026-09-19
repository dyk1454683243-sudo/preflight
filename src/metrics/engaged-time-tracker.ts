/**
 * Session engaged-time approximation — gap-coalescing accumulator.
 *
 * `ai.session.duration_ms` is wall clock from MCP-process construction: a
 * session left open overnight counts every hour. Managers want engagement,
 * closer to Claude Code's OTel `active_time.total`.
 *
 * This tracker unions:
 *   - UserPromptSubmit → Stop (or SessionEnd) spans
 *   - Tool-call bursts `[timestamp, timestamp + durationMs]`
 *
 * Intervals whose gap is ≤ `idleGapCapMs` (default 30s, matching
 * TaskDetector's idle timeout) are merged; larger gaps are treated as idle
 * and excluded. An open prompt with no Stop is capped at last activity +
 * the idle gap — so a prompt submitted before lunch does not count the
 * afternoon as engaged.
 *
 * Honest ceiling: hooks cannot see keystroke or window-focus. This is
 * *engaged time*, not Claude Code's "actively typing/reading" definition,
 * and must not be named or documented as parity with `active_time.total`.
 */

import type { ToolCallRecord } from '../storage/types.js';
import type { Resettable } from './tracker-contracts.js';

/**
 * Pauses longer than this between observed hook/tool activity are idle.
 * Matches `TaskDetector`'s default idle timeout — a task-boundary heuristic,
 * not LiveSessionRegistry's 180s liveness window (that answers "is the
 * session still running?", not "is the user still engaged?").
 */
export const DEFAULT_ENGAGED_IDLE_GAP_MS = 30_000;

/**
 * When a tool call has no duration, occupy this much time so an unmeasured
 * call is not treated as an instant. Same buffer as `TurnTracker`.
 */
const NULL_DURATION_BUFFER_MS = 500;

const MAX_INTERVALS = 10_000;

interface Interval {
  start: number;
  end: number;
}

export interface EngagedTimeMetrics {
  /** Approximated engaged milliseconds (never wall-clock session duration). */
  readonly engagedMs: number;
  /** Closed + still-open prompt intervals after coalescing (for tests/debug). */
  readonly intervalCount: number;
}

export interface EngagedTimeTrackerOptions {
  readonly idleGapCapMs?: number;
}

function isFiniteTs(value: number): boolean {
  return Number.isFinite(value);
}

export class EngagedTimeTracker implements Resettable {
  private readonly idleGapCapMs: number;
  /**
   * Already-coalesced engaged milliseconds that can no longer merge with
   * new activity (folded-off oldest intervals, plus `seedFromPersisted`).
   */
  private sealedMs = 0;
  private intervals: Interval[] = [];
  private openPromptStart: number | null = null;
  private lastActivityEnd: number | null = null;

  constructor(options?: EngagedTimeTrackerOptions) {
    this.idleGapCapMs = options?.idleGapCapMs ?? DEFAULT_ENGAGED_IDLE_GAP_MS;
  }

  /**
   * SessionStart is not engagement (opening Claude and walking away must
   * stay 0). Kept as an explicit no-op so the collector/processor wiring
   * has a typed sink and cannot be mistaken for a missing handler.
   */
  recordSessionStart(_timestamp: number): void {
    return;
  }

  recordPromptSubmit(timestamp: number): void {
    if (!isFiniteTs(timestamp)) return;
    if (this.openPromptStart !== null) {
      // Previous turn never got a Stop (user interrupt). Cap that span;
      // do not stretch it to this new prompt if the user was idle.
      this.closeOpenPrompt(timestamp, { honorBoundary: false });
    }
    this.openPromptStart = timestamp;
    this.touch(timestamp);
  }

  recordStop(timestamp: number): void {
    if (!isFiniteTs(timestamp)) return;
    // Stop is the precise end of a prompt→response turn — count the full
    // span even when it contains no tool calls (a long text-only reply).
    this.closeOpenPrompt(timestamp, { honorBoundary: true });
    this.touch(timestamp);
  }

  recordSessionEnd(timestamp: number): void {
    if (!isFiniteTs(timestamp)) return;
    // SessionEnd can fire hours after the last real activity (window left
    // open). Cap idle; do not treat process teardown as engagement.
    this.closeOpenPrompt(timestamp, { honorBoundary: false });
    this.touch(timestamp);
  }

  recordToolCall(record: ToolCallRecord): void {
    const start = record.timestamp;
    if (!isFiniteTs(start)) return;
    const rawDuration = record.durationMs;
    const duration =
      typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration >= 0
        ? rawDuration
        : NULL_DURATION_BUFFER_MS;
    const end = start + duration;
    this.addInterval(start, end);
    this.touch(end);
  }

  getMetrics(now: number = Date.now()): EngagedTimeMetrics {
    const intervals = this.snapshotIntervals(now);
    const coalesced = coalesceIntervals(intervals, this.idleGapCapMs);
    let engagedMs = this.sealedMs;
    for (const interval of coalesced) {
      engagedMs += interval.end - interval.start;
    }
    return {
      engagedMs,
      intervalCount: coalesced.length,
    };
  }

  /**
   * Fold a prior process's persisted engaged total into this (fresh) tracker.
   * Same overlapping-slice rule as other seeders: the next checkpoint is
   * old+new, and `mergeSummaries` takes the max.
   */
  seedFromPersisted(engagedMs: number): void {
    if (typeof engagedMs !== 'number' || !Number.isFinite(engagedMs) || engagedMs <= 0) return;
    this.sealedMs += engagedMs;
  }

  reset(_sessionId: string): void {
    this.sealedMs = 0;
    this.intervals = [];
    this.openPromptStart = null;
    this.lastActivityEnd = null;
  }

  private closeOpenPrompt(timestamp: number, opts: { honorBoundary: boolean }): void {
    if (this.openPromptStart === null) return;
    let end = timestamp;
    if (!opts.honorBoundary && this.lastActivityEnd !== null) {
      end = Math.min(timestamp, this.lastActivityEnd + this.idleGapCapMs);
    }
    end = Math.max(this.openPromptStart, end);
    this.addInterval(this.openPromptStart, end);
    this.openPromptStart = null;
  }

  private touch(timestamp: number): void {
    if (this.lastActivityEnd === null || timestamp > this.lastActivityEnd) {
      this.lastActivityEnd = timestamp;
    }
  }

  private addInterval(start: number, end: number): void {
    if (!isFiniteTs(start) || !isFiniteTs(end) || end <= start) return;
    this.intervals.push({ start, end });
    this.intervals = coalesceIntervals(this.intervals, this.idleGapCapMs);
    this.foldOldestIfCapped();
  }

  private foldOldestIfCapped(): void {
    while (this.intervals.length > MAX_INTERVALS) {
      const oldest = this.intervals.shift();
      if (oldest === undefined) return;
      this.sealedMs += oldest.end - oldest.start;
    }
  }

  private snapshotIntervals(now: number): Interval[] {
    const snapshot = this.intervals.map((interval) => ({
      start: interval.start,
      end: interval.end,
    }));
    if (this.openPromptStart === null) return snapshot;
    const lastEnd = this.lastActivityEnd;
    const openEnd =
      lastEnd === null ? this.openPromptStart : Math.min(now, lastEnd + this.idleGapCapMs);
    if (openEnd > this.openPromptStart) {
      snapshot.push({ start: this.openPromptStart, end: openEnd });
    }
    return snapshot;
  }
}

export function coalesceIntervals(
  intervals: readonly Interval[],
  idleGapCapMs: number,
): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [{ start: sorted[0]!.start, end: sorted[0]!.end }];
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (current.start <= last.end + idleGapCapMs) {
      if (current.end > last.end) last.end = current.end;
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }
  return merged;
}

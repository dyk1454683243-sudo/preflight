import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  EngagedTimeTracker,
  DEFAULT_ENGAGED_IDLE_GAP_MS,
  coalesceIntervals,
} from './engaged-time-tracker.js';
import type { ToolCallRecord } from '../storage/types.js';

let stderrSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
});

function makeRecord(overrides?: Partial<ToolCallRecord>): ToolCallRecord {
  return {
    id: 'rec-001',
    sessionId: 'sess-001',
    toolName: 'Read',
    toolUseId: 'toolu_001',
    timestamp: 1_000,
    durationMs: 100,
    success: true,
    ...overrides,
  };
}

describe('coalesceIntervals', () => {
  it('returns empty for an empty input', () => {
    expect(coalesceIntervals([], 30_000)).toEqual([]);
  });

  it('merges overlapping intervals', () => {
    expect(
      coalesceIntervals(
        [
          { start: 0, end: 100 },
          { start: 50, end: 150 },
        ],
        0,
      ),
    ).toEqual([{ start: 0, end: 150 }]);
  });

  it('fills a gap at or under the idle cap and leaves a larger gap split', () => {
    expect(
      coalesceIntervals(
        [
          { start: 0, end: 100 },
          { start: 130, end: 200 },
        ],
        30,
      ),
    ).toEqual([{ start: 0, end: 200 }]);
    expect(
      coalesceIntervals(
        [
          { start: 0, end: 100 },
          { start: 131, end: 200 },
        ],
        30,
      ),
    ).toEqual([
      { start: 0, end: 100 },
      { start: 131, end: 200 },
    ]);
  });
});

describe('EngagedTimeTracker', () => {
  it('returns 0 for an empty session', () => {
    const tracker = new EngagedTimeTracker();
    expect(tracker.getMetrics(10_000).engagedMs).toBe(0);
    expect(tracker.getMetrics(10_000).intervalCount).toBe(0);
  });

  it('does not count SessionStart alone as engagement', () => {
    const tracker = new EngagedTimeTracker();
    tracker.recordSessionStart(0);
    tracker.recordSessionEnd(3_600_000);
    expect(tracker.getMetrics(3_600_000).engagedMs).toBe(0);
  });

  it('unions a prompt→Stop span with overlapping tool-call bursts', () => {
    const tracker = new EngagedTimeTracker();
    tracker.recordPromptSubmit(0);
    tracker.recordToolCall(makeRecord({ timestamp: 1_000, durationMs: 400 }));
    tracker.recordToolCall(makeRecord({ timestamp: 2_000, durationMs: 300 }));
    tracker.recordStop(8_000);

    const metrics = tracker.getMetrics(8_000);
    expect(metrics.engagedMs).toBe(8_000);
    expect(metrics.intervalCount).toBe(1);
  });

  it('does not count an idle gap larger than the cap between two turns', () => {
    const tracker = new EngagedTimeTracker({ idleGapCapMs: 30_000 });
    tracker.recordPromptSubmit(0);
    tracker.recordStop(5_000);
    // Two hours later — overnight-open must not become engaged time.
    tracker.recordPromptSubmit(5_000 + 2 * 3_600_000);
    tracker.recordStop(5_000 + 2 * 3_600_000 + 4_000);

    const metrics = tracker.getMetrics(5_000 + 2 * 3_600_000 + 4_000);
    expect(metrics.engagedMs).toBe(5_000 + 4_000);
    expect(metrics.intervalCount).toBe(2);
  });

  it('fills an idle gap at or under the cap when unioning adjacent activity', () => {
    const tracker = new EngagedTimeTracker({ idleGapCapMs: 30_000 });
    tracker.recordToolCall(makeRecord({ timestamp: 0, durationMs: 1_000 }));
    tracker.recordToolCall(makeRecord({ timestamp: 20_000, durationMs: 1_000 }));

    expect(tracker.getMetrics(21_000).engagedMs).toBe(21_000);
    expect(tracker.getMetrics(21_000).intervalCount).toBe(1);
  });

  it('caps an open prompt without Stop at last activity plus the idle gap', () => {
    const tracker = new EngagedTimeTracker({ idleGapCapMs: 30_000 });
    tracker.recordPromptSubmit(0);
    tracker.recordToolCall(makeRecord({ timestamp: 2_000, durationMs: 500 }));

    // Two hours later, still no Stop (user interrupt). Do not count the wait.
    const later = 2 * 3_600_000;
    expect(tracker.getMetrics(later).engagedMs).toBe(2_000 + 500 + 30_000);
  });

  it('closes an open prompt on SessionEnd, capping idle if the window sat open', () => {
    const tracker = new EngagedTimeTracker({ idleGapCapMs: 30_000 });
    tracker.recordPromptSubmit(0);
    tracker.recordToolCall(makeRecord({ timestamp: 1_000, durationMs: 200 }));
    tracker.recordSessionEnd(4_000);
    expect(tracker.getMetrics(60_000).engagedMs).toBe(4_000);

    const idle = new EngagedTimeTracker({ idleGapCapMs: 30_000 });
    idle.recordPromptSubmit(0);
    idle.recordToolCall(makeRecord({ timestamp: 1_000, durationMs: 200 }));
    idle.recordSessionEnd(2 * 3_600_000);
    expect(idle.getMetrics(2 * 3_600_000).engagedMs).toBe(1_200 + 30_000);
  });

  it('counts a long tool-less prompt→Stop span in full (Stop is a real boundary)', () => {
    const tracker = new EngagedTimeTracker({ idleGapCapMs: 30_000 });
    tracker.recordPromptSubmit(0);
    tracker.recordStop(120_000);
    expect(tracker.getMetrics(120_000).engagedMs).toBe(120_000);
  });

  it('uses a 500ms buffer for a tool call with no duration', () => {
    const tracker = new EngagedTimeTracker();
    tracker.recordToolCall(makeRecord({ timestamp: 1_000, durationMs: null }));
    expect(tracker.getMetrics(2_000).engagedMs).toBe(500);
  });

  it('ignores a Stop with no matching prompt (tool bursts still count)', () => {
    const tracker = new EngagedTimeTracker();
    tracker.recordToolCall(makeRecord({ timestamp: 1_000, durationMs: 200 }));
    tracker.recordStop(5_000);
    expect(tracker.getMetrics(5_000).engagedMs).toBe(200);
  });

  it('exports the 30s default idle-gap cap matching TaskDetector', () => {
    expect(DEFAULT_ENGAGED_IDLE_GAP_MS).toBe(30_000);
  });

  it('seedFromPersisted adds a prior process total without double-counting empty input', () => {
    const tracker = new EngagedTimeTracker();
    tracker.seedFromPersisted(12_000);
    tracker.seedFromPersisted(0);
    tracker.recordToolCall(makeRecord({ timestamp: 0, durationMs: 1_000 }));
    expect(tracker.getMetrics(1_000).engagedMs).toBe(13_000);
  });

  it('reset clears sealed totals and open spans', () => {
    const tracker = new EngagedTimeTracker();
    tracker.seedFromPersisted(5_000);
    tracker.recordPromptSubmit(0);
    tracker.recordToolCall(makeRecord({ timestamp: 10, durationMs: 10 }));
    tracker.reset('sess-new');
    expect(tracker.getMetrics(1_000).engagedMs).toBe(0);
    expect(tracker.getMetrics(1_000).intervalCount).toBe(0);
  });
});

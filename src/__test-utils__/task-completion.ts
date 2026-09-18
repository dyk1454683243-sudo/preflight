import { TaskCompletionTracker } from '../metrics/task-completion-tracker.js';
import type { AiCodingTask } from '../metrics/task-detector.js';

/**
 * Shared TaskCompletionTracker fixture used to prove GET /api/task-completion
 * returns the same snapshot as `nr_observe_get_task_completion_rate`.
 *
 * Two completed tasks: 60s / 10 calls and 30s / 6 calls →
 * `{ completedTasks: 2, avgTaskDurationMs: 45000, avgToolCallsPerTask: 8 }`.
 */
export function makeCompletedTask(overrides: Partial<AiCodingTask> = {}): AiCodingTask {
  return {
    taskId: 'task-001',
    startTime: 1000,
    endTime: 61_000,
    durationMs: 60_000,
    toolCallCount: 10,
    toolCallsByType: {},
    filesRead: [],
    filesModified: [],
    linesChanged: 50,
    linesAdded: 50,
    linesRemoved: 0,
    bashCommandsRun: 2,
    testsRun: 4,
    testsPassed: 4,
    buildRun: 1,
    buildPassed: 1,
    estimatedCostUsd: 0.5,
    tokensUsed: 5000,
    askedUserQuestions: 0,
    subAgentsSpawned: 0,
    toolCalls: [],
    ...overrides,
  };
}

export function seedTaskCompletionTracker(
  tracker: TaskCompletionTracker = new TaskCompletionTracker(),
): TaskCompletionTracker {
  tracker.recordTask(makeCompletedTask());
  tracker.recordTask(
    makeCompletedTask({ taskId: 'task-002', durationMs: 30_000, toolCallCount: 6 }),
  );
  return tracker;
}

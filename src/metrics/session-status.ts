/**
 * Lifecycle status for a today session, derived read-time (not persisted) so
 * a resumed session's status always reflects its current liveness rather
 * than a stale snapshot from its last checkpoint save.
 */
export type SessionStatus = 'needs_input' | 'ready_for_review' | 'working' | 'completed';

export interface SessionStatusInput {
  /** In the live registry within its liveness window. */
  readonly live: boolean;
  /** The session's most recent tool call, across buffer and persisted timeline. Null when neither has one. */
  readonly lastToolName: string | null;
  /**
   * PR 'create' events whose number is unknown or absent from the window's
   * merged-PR set. A null prNumber always counts as open (conservative).
   */
  readonly openPrCount: number;
}

/** Display order for rendering: highest-precedence status first. */
export const SESSION_STATUSES: readonly SessionStatus[] = [
  'needs_input',
  'ready_for_review',
  'working',
  'completed',
];

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  needs_input: 'Needs input',
  ready_for_review: 'Ready for review',
  working: 'Working',
  completed: 'Completed',
};

/**
 * Ordered highest-precedence-first: a live session waiting on an
 * AskUserQuestion answer needs input even with an open PR; an open PR
 * outranks plain "working"/"completed" either way.
 */
const PRECEDENCE: ReadonlyArray<readonly [(input: SessionStatusInput) => boolean, SessionStatus]> =
  [
    [(input) => input.live && input.lastToolName === 'AskUserQuestion', 'needs_input'],
    [(input) => input.openPrCount > 0, 'ready_for_review'],
    [(input) => input.live, 'working'],
    [() => true, 'completed'],
  ];

export function deriveSessionStatus(input: SessionStatusInput): SessionStatus {
  for (const [predicate, status] of PRECEDENCE) {
    if (predicate(input)) return status;
  }
  // Unreachable: the last entry's predicate is unconditionally true.
  return 'completed';
}

/**
 * Count creates that are still open against a window-wide set of merged
 * PR numbers (every session, not just the creating one).
 *
 * A create with `prNumber: null` stays open — we cannot prove it merged.
 * A merge that happened on a later day is outside the today window and is
 * not in `mergedPrNumbers`, so that create also stays open until the
 * session ages out of the window.
 */
export function countOpenPrCreates(
  creates: readonly { readonly prNumber: string | null }[],
  mergedPrNumbers: ReadonlySet<string>,
): number {
  let open = 0;
  for (const event of creates) {
    if (event.prNumber === null || !mergedPrNumbers.has(event.prNumber)) {
      open++;
    }
  }
  return open;
}

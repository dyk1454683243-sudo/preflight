import type { DecisionTreeResponse, TurnCostsResponse } from '../api/client.js';
import { fmtDateTime, formatDuration, formatUsd } from './format.js';

/**
 * Structural subset of a session list/detail payload. Declared here so the
 * export helpers do not import from a view. Extra fields on the real object
 * are fine — JSON copy keeps them (after content redaction).
 */
export interface ExportableAntiPattern {
  readonly type: string;
  readonly count?: number;
  readonly iterations?: number;
  readonly readCount?: number;
  readonly repeatCount?: number;
  readonly editCount?: number;
  readonly agentCount?: number;
  readonly file?: string;
  readonly command?: string;
}

export interface ExportableSession {
  readonly sessionId: string;
  readonly sessionName?: string | null;
  readonly startTime?: string | number;
  readonly durationMs?: number;
  readonly toolCallCount?: number;
  readonly estimatedCostUsd?: number | null;
  readonly antiPatterns?: ReadonlyArray<ExportableAntiPattern>;
  readonly model?: string | null;
  readonly modelBreakdown?: Readonly<Record<string, unknown>>;
  readonly toolSuccessRate?: number | null;
  readonly toolBreakdown?: Record<string, number>;
  readonly filesRead?: readonly string[];
  readonly filesModified?: readonly string[];
  readonly uniqueFilesRead?: number;
  readonly uniqueFilesWritten?: number;
}

export interface SessionExportInput {
  readonly session: ExportableSession;
  readonly decisionTree?: DecisionTreeResponse;
  readonly turnCosts?: TurnCostsResponse;
  /** Unique file-path count already derived by the caller (never raw paths). */
  readonly uniqueFilesTouched?: number;
}

const TOP_N = 3;

/**
 * Content-bearing keys that must not leave the dashboard via copy. The list
 * endpoint already drops `filesRead` / `filesModified` / `timeline` and
 * `sessionIntent`; the detail endpoint does not. Markdown never includes
 * these; JSON strips them so a paste into a PR or bug report cannot carry
 * raw paths, commands, or the first-user-prompt when `recordContent` is on.
 */
const CONTENT_KEYS = new Set([
  'file',
  'command',
  'filesRead',
  'filesModified',
  'timeline',
  'sessionIntent',
  'session_intent',
]);

function topEntries(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N)
    .map(([name, n]) => `${name} ${n}`)
    .join(', ');
}

/**
 * Persisted anti-patterns rarely have a unified `count` — the detector writes
 * `readCount` / `iterations` / `repeatCount` / etc. A record with none of
 * those still counts as one incident.
 */
function antiPatternCount(pattern: ExportableAntiPattern): number {
  const n =
    pattern.count ??
    pattern.iterations ??
    pattern.readCount ??
    pattern.repeatCount ??
    pattern.editCount ??
    pattern.agentCount;
  return n != null && n > 0 ? n : 1;
}

function sessionTitle(session: ExportableSession): string {
  const name = session.sessionName?.trim();
  return name && name.length > 0 ? name : session.sessionId.slice(0, 8);
}

function filesTouchedLine(session: ExportableSession, uniqueFilesTouched?: number): string | null {
  const read = session.filesRead?.length ?? session.uniqueFilesRead;
  const written = session.filesModified?.length ?? session.uniqueFilesWritten;
  if (read != null || written != null) {
    const parts: string[] = [];
    if (read != null) parts.push(`${read} read`);
    if (written != null) parts.push(`${written} written`);
    return `- Files touched: ${parts.join(', ')}`;
  }
  if (uniqueFilesTouched != null && uniqueFilesTouched > 0) {
    return `- Files touched: ${uniqueFilesTouched}`;
  }
  return null;
}

function collectModels(session: ExportableSession, turnCosts?: TurnCostsResponse): string[] {
  const models = new Set<string>();
  if (session.model) models.add(session.model);
  for (const name of Object.keys(session.modelBreakdown ?? {})) {
    if (name) models.add(name);
  }
  for (const turn of turnCosts?.turns ?? []) {
    if (turn.model) models.add(turn.model);
  }
  return [...models];
}

/**
 * Short Markdown block for a standup note, PR description, or bug report.
 * Missing fields are omitted so the block never shows placeholders. Always
 * stays under fifteen lines. No file paths, commands, or other raw content.
 */
export function sessionToMarkdown({
  session,
  decisionTree,
  turnCosts,
  uniqueFilesTouched,
}: SessionExportInput): string {
  const lines: string[] = [`### Session: ${sessionTitle(session)}`];

  if (session.startTime != null && session.startTime !== '') {
    const duration = session.durationMs != null ? ` (${formatDuration(session.durationMs)})` : '';
    lines.push(`- Started: ${fmtDateTime(session.startTime)}${duration}`);
  } else if (session.durationMs != null) {
    lines.push(`- Duration: ${formatDuration(session.durationMs)}`);
  }

  const cost = session.estimatedCostUsd ?? turnCosts?.totalAttributedCost;
  if (cost != null) {
    // #739's `est.` marker has not landed yet; keep the word in the label so
    // a pasted block still reads as a list-price estimate, not an invoice.
    lines.push(`- Estimated cost: ${formatUsd(cost)}`);
  }

  if (session.toolCallCount != null && session.toolCallCount > 0) {
    const breakdown =
      session.toolBreakdown && Object.keys(session.toolBreakdown).length > 0
        ? ` (${topEntries(session.toolBreakdown)})`
        : '';
    lines.push(`- Tool calls: ${session.toolCallCount}${breakdown}`);
  }

  const filesLine = filesTouchedLine(session, uniqueFilesTouched);
  if (filesLine) lines.push(filesLine);

  if (session.toolSuccessRate != null) {
    lines.push(`- Tool success rate: ${Math.round(session.toolSuccessRate * 100)}%`);
  }

  const models = collectModels(session, turnCosts);
  if (models.length > 0) lines.push(`- Models: ${models.join(', ')}`);

  if (decisionTree && decisionTree.totalBranches > 0) {
    lines.push(`- Longest failure streak: ${decisionTree.longestFailureStreak}`);
  }

  const patternCounts: Record<string, number> = {};
  for (const pattern of session.antiPatterns ?? []) {
    if (!pattern.type) continue;
    patternCounts[pattern.type] = (patternCounts[pattern.type] ?? 0) + antiPatternCount(pattern);
  }
  if (Object.keys(patternCounts).length > 0) {
    lines.push(`- Top anti-patterns: ${topEntries(patternCounts)}`);
  }

  return lines.join('\n');
}

function stripContent(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripContent);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (CONTENT_KEYS.has(key)) continue;
      out[key] = stripContent(nested);
    }
    return out;
  }
  return value;
}

/** Session summary as fetched, pretty-printed, with content-bearing fields removed. */
export function sessionToJson(session: object): string {
  return JSON.stringify(stripContent(session), null, 2);
}

/**
 * Deep link the Sessions view already honors (`?id=` and `?session=` both
 * select a row). Matches the Today pane's "full session →" href.
 */
export function sessionLink(origin: string, sessionId: string): string {
  const base = origin.replace(/\/$/, '');
  return `${base}/sessions?id=${encodeURIComponent(sessionId)}`;
}

/**
 * Insertion-order Map with a hard size cap and optional idle TTL.
 *
 * Used for process-lifetime correlation tables that would otherwise grow
 * without bound on a long-running `--local` daemon (one entry per subagent
 * tool-use or spawned agent). `get` / `set` refresh LRU position so in-flight
 * joins stay resident; the oldest unread entry is evicted once `maxSize` is
 * exceeded. When `ttlMs` is set, an entry that has not been touched for that
 * long is treated as absent.
 *
 * Optional `sessionId` metadata lets callers drop every entry owned by a
 * session that is known closed (or that rolled off the current local day).
 */

export interface BoundedLruMapOptions {
  readonly maxSize: number;
  readonly ttlMs?: number;
  readonly now?: () => number;
}

export interface BoundedLruMapSetOptions {
  readonly sessionId?: string;
}

interface BoundedLruEntry<V> {
  readonly value: V;
  lastAccessMs: number;
  readonly sessionId: string | undefined;
}

/** One entry per subagent tool-use id. Generous enough for concurrent sessions. */
export const DEFAULT_TOOL_USE_ID_MAP_MAX_SIZE = 10_000;

/** One entry per spawned Agent — far fewer than tool-use ids. */
export const DEFAULT_AGENT_TYPE_MAP_MAX_SIZE = 2_048;

/**
 * Idle TTL for both correlation maps. Task analysis closes in tens of
 * seconds; a tool-use id from a session that ended hours ago has no further
 * join use. Two hours covers a long idle-then-resume window without letting
 * a `--local` daemon retain every id it has ever seen.
 */
export const DEFAULT_AGENT_ID_MAP_TTL_MS = 2 * 60 * 60 * 1000;

export class BoundedLruMap<V> {
  private readonly data = new Map<string, BoundedLruEntry<V>>();
  private readonly maxSize: number;
  private readonly ttlMs: number | undefined;
  private readonly now: () => number;

  constructor(options: BoundedLruMapOptions) {
    const { maxSize, ttlMs, now } = options;
    if (!Number.isInteger(maxSize) || maxSize <= 0) {
      throw new RangeError(
        `BoundedLruMap: maxSize must be a positive integer, got ${String(maxSize)}`,
      );
    }
    if (ttlMs !== undefined && (!Number.isInteger(ttlMs) || ttlMs <= 0)) {
      throw new RangeError(`BoundedLruMap: ttlMs must be a positive integer, got ${String(ttlMs)}`);
    }
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.now = now ?? Date.now;
  }

  get size(): number {
    return this.data.size;
  }

  get(key: string): V | undefined {
    const entry = this.data.get(key);
    if (entry === undefined) return undefined;
    if (this.isExpired(entry, this.now())) {
      this.data.delete(key);
      return undefined;
    }
    this.touch(key, entry);
    return entry.value;
  }

  /**
   * Record `key → value`. Re-inserting an existing key refreshes its LRU
   * position (and session id, when provided). Evicts expired entries, then
   * the oldest remaining entry if still over `maxSize`.
   */
  set(key: string, value: V, options?: BoundedLruMapSetOptions): this {
    if (this.data.has(key)) this.data.delete(key);
    this.data.set(key, {
      value,
      lastAccessMs: this.now(),
      sessionId: options?.sessionId,
    });
    this.pruneExpired();
    this.evictOverflow();
    return this;
  }

  has(key: string): boolean {
    const entry = this.data.get(key);
    if (entry === undefined) return false;
    if (this.isExpired(entry, this.now())) {
      this.data.delete(key);
      return false;
    }
    return true;
  }

  delete(key: string): boolean {
    return this.data.delete(key);
  }

  clear(): void {
    this.data.clear();
  }

  /** Drop every entry tagged with `sessionId`. Returns the number removed. */
  pruneSession(sessionId: string): number {
    let removed = 0;
    for (const [key, entry] of this.data) {
      if (entry.sessionId === sessionId) {
        this.data.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Drop entries whose session id is set and not in `sessionIds`. Untagged
   * entries stay (LRU / TTL still bound them). Returns the number removed.
   */
  retainSessions(sessionIds: ReadonlySet<string>): number {
    let removed = 0;
    for (const [key, entry] of this.data) {
      if (entry.sessionId !== undefined && !sessionIds.has(entry.sessionId)) {
        this.data.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** Drop every expired entry. Returns the number removed. */
  pruneExpired(): number {
    const ttlMs = this.ttlMs;
    if (ttlMs === undefined) return 0;
    const now = this.now();
    let removed = 0;
    for (const [key, entry] of this.data) {
      if (now - entry.lastAccessMs >= ttlMs) {
        this.data.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  private isExpired(entry: BoundedLruEntry<V>, now: number): boolean {
    return this.ttlMs !== undefined && now - entry.lastAccessMs >= this.ttlMs;
  }

  private touch(key: string, entry: BoundedLruEntry<V>): void {
    entry.lastAccessMs = this.now();
    this.data.delete(key);
    this.data.set(key, entry);
  }

  private evictOverflow(): void {
    while (this.data.size > this.maxSize) {
      const oldest = this.data.keys().next().value;
      if (oldest === undefined) break;
      this.data.delete(oldest);
    }
  }
}

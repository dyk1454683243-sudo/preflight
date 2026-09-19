import { describe, expect, it } from '@jest/globals';
import { BoundedLruMap } from './bounded-lru-map.js';

function makeClock(startMs = 1_000): { now: () => number; advance: (ms: number) => void } {
  let currentMs = startMs;
  return {
    now: () => currentMs,
    advance: (ms: number) => {
      currentMs += ms;
    },
  };
}

function makeMap(
  overrides?: Partial<{ maxSize: number; ttlMs: number }> & { now?: () => number },
): BoundedLruMap<string> {
  return new BoundedLruMap({
    maxSize: overrides?.maxSize ?? 3,
    ...(overrides?.ttlMs !== undefined ? { ttlMs: overrides.ttlMs } : {}),
    ...(overrides?.now !== undefined ? { now: overrides.now } : {}),
  });
}

describe('BoundedLruMap', () => {
  describe('constructor', () => {
    it('throws on maxSize: 0 (would silently drop every insert)', () => {
      expect(() => new BoundedLruMap({ maxSize: 0 })).toThrow(RangeError);
      expect(() => new BoundedLruMap({ maxSize: 0 })).toThrow(/positive integer/);
    });

    it('throws on negative or non-integer maxSize', () => {
      expect(() => new BoundedLruMap({ maxSize: -1 })).toThrow(RangeError);
      expect(() => new BoundedLruMap({ maxSize: 1.5 })).toThrow(RangeError);
      expect(() => new BoundedLruMap({ maxSize: Number.NaN })).toThrow(RangeError);
    });

    it('throws on non-positive ttlMs when provided', () => {
      expect(() => new BoundedLruMap({ maxSize: 1, ttlMs: 0 })).toThrow(RangeError);
      expect(() => new BoundedLruMap({ maxSize: 1, ttlMs: -5 })).toThrow(RangeError);
      expect(() => new BoundedLruMap({ maxSize: 1, ttlMs: 1.5 })).toThrow(RangeError);
    });

    it('accepts maxSize: 1 (smallest valid value)', () => {
      const map = new BoundedLruMap<string>({ maxSize: 1 });
      map.set('a', '1');
      expect(map.size).toBe(1);
      expect(map.get('a')).toBe('1');
    });
  });

  describe('LRU eviction', () => {
    it('evicts the oldest entry once maxSize is exceeded', () => {
      const map = makeMap({ maxSize: 3 });
      map.set('a', '1');
      map.set('b', '2');
      map.set('c', '3');
      expect(map.size).toBe(3);

      map.set('d', '4');

      expect(map.size).toBe(3);
      expect(map.has('a')).toBe(false);
      expect(map.get('a')).toBeUndefined();
      expect(map.get('b')).toBe('2');
      expect(map.get('c')).toBe('3');
      expect(map.get('d')).toBe('4');
    });

    it('does not grow without bound across many inserts (synthetic --local lifetime)', () => {
      const map = makeMap({ maxSize: 8 });
      for (let i = 0; i < 200; i += 1) {
        map.set(`toolu_${String(i)}`, `agent_${String(i)}`);
      }
      expect(map.size).toBe(8);
      expect(map.get('toolu_0')).toBeUndefined();
      expect(map.get('toolu_199')).toBe('agent_199');
      expect(map.get('toolu_192')).toBe('agent_192');
    });

    it('re-inserting a key refreshes its LRU position', () => {
      const map = makeMap({ maxSize: 3 });
      map.set('a', '1');
      map.set('b', '2');
      map.set('c', '3');
      map.set('a', '1-updated');

      map.set('d', '4');

      expect(map.get('a')).toBe('1-updated');
      expect(map.has('b')).toBe(false);
      expect(map.get('c')).toBe('3');
      expect(map.get('d')).toBe('4');
    });

    it('get() refreshes LRU position so in-flight lookups survive the next insert', () => {
      const map = makeMap({ maxSize: 3 });
      map.set('a', '1');
      map.set('b', '2');
      map.set('c', '3');
      expect(map.get('a')).toBe('1');

      map.set('d', '4');

      expect(map.get('a')).toBe('1');
      expect(map.has('b')).toBe(false);
    });

    it('has() does not refresh LRU position', () => {
      const map = makeMap({ maxSize: 3 });
      map.set('a', '1');
      map.set('b', '2');
      map.set('c', '3');
      expect(map.has('a')).toBe(true);

      map.set('d', '4');

      expect(map.has('a')).toBe(false);
      expect(map.get('b')).toBe('2');
    });
  });

  describe('TTL expiry', () => {
    it('treats an untouched entry as absent once ttlMs has elapsed', () => {
      const clock = makeClock();
      const map = makeMap({ maxSize: 8, ttlMs: 1_000, now: clock.now });
      map.set('toolu_old', 'agent_old');
      clock.advance(1);
      map.set('toolu_fresh', 'agent_fresh');
      clock.advance(999);

      expect(map.get('toolu_old')).toBeUndefined();
      expect(map.has('toolu_old')).toBe(false);
      expect(map.get('toolu_fresh')).toBe('agent_fresh');
      expect(map.size).toBe(1);
    });

    it('get() refreshes idle TTL so a still-joined tool-use is not expired', () => {
      const clock = makeClock();
      const map = makeMap({ maxSize: 8, ttlMs: 1_000, now: clock.now });
      map.set('toolu_live', 'agent_live');

      clock.advance(999);
      expect(map.get('toolu_live')).toBe('agent_live');
      clock.advance(999);
      expect(map.get('toolu_live')).toBe('agent_live');
    });

    it('set() sweeps expired entries even when under the size cap', () => {
      const clock = makeClock();
      const map = makeMap({ maxSize: 8, ttlMs: 500, now: clock.now });
      map.set('a', '1');
      map.set('b', '2');
      clock.advance(500);
      map.set('c', '3');

      expect(map.size).toBe(1);
      expect(map.get('c')).toBe('3');
      expect(map.has('a')).toBe(false);
    });

    it('pruneExpired() drops every stale entry and reports the count', () => {
      const clock = makeClock();
      const map = makeMap({ maxSize: 8, ttlMs: 100, now: clock.now });
      map.set('a', '1');
      map.set('b', '2');
      clock.advance(100);

      expect(map.pruneExpired()).toBe(2);
      expect(map.size).toBe(0);
      expect(map.pruneExpired()).toBe(0);
    });
  });

  describe('session prune', () => {
    it("pruneSession() removes only the closed session's entries", () => {
      const map = makeMap({ maxSize: 8 });
      map.set('toolu_a1', 'agent_a', { sessionId: 'sess-a' });
      map.set('toolu_a2', 'agent_a', { sessionId: 'sess-a' });
      map.set('toolu_b1', 'agent_b', { sessionId: 'sess-b' });

      expect(map.pruneSession('sess-a')).toBe(2);
      expect(map.size).toBe(1);
      expect(map.get('toolu_b1')).toBe('agent_b');
      expect(map.get('toolu_a1')).toBeUndefined();
    });

    it('retainSessions() drops entries whose session rolled off the keep set', () => {
      const map = makeMap({ maxSize: 8 });
      map.set('yesterday', 'agent_old', { sessionId: 'sess-old' });
      map.set('today', 'agent_new', { sessionId: 'sess-new' });
      map.set('untagged', 'agent_loose');

      const removed = map.retainSessions(new Set(['sess-new']));

      expect(removed).toBe(1);
      expect(map.get('today')).toBe('agent_new');
      expect(map.get('untagged')).toBe('agent_loose');
      expect(map.get('yesterday')).toBeUndefined();
    });

    it('pruneSession() is a no-op when the session has no entries', () => {
      const map = makeMap({ maxSize: 2 });
      map.set('a', '1', { sessionId: 'sess-a' });
      expect(map.pruneSession('sess-missing')).toBe(0);
      expect(map.size).toBe(1);
    });
  });
});

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  DigestScheduler,
  resolveDigestSchedule,
  type DigestSendResult,
} from './digest-scheduler.js';

let stderrSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  stderrSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  stderrSpy.mockRestore();
});

function okResult(week = '2026-W39'): DigestSendResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: true, week, message: 'sent' }) }],
  };
}

function errorResult(error: string): DigestSendResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error }) }],
  };
}

type SendFn = jest.Mock<() => Promise<DigestSendResult>>;

function makeScheduler(
  overrides: {
    schedule?: string;
    getSchedule?: () => string;
    send?: SendFn;
    nowRef?: { current: Date };
    intervalMs?: number;
  } = {},
): {
  scheduler: DigestScheduler;
  send: SendFn;
  nowRef: { current: Date };
} {
  const send =
    overrides.send ?? jest.fn<() => Promise<DigestSendResult>>().mockResolvedValue(okResult());
  const nowRef = overrides.nowRef ?? { current: new Date(2026, 8, 21, 8, 59, 0) };
  const getSchedule = overrides.getSchedule ?? (() => overrides.schedule ?? '0 9 * * 1');
  const scheduler = new DigestScheduler({
    getSchedule,
    send,
    now: () => nowRef.current,
    intervalMs: overrides.intervalMs ?? 15_000,
  });
  return { scheduler, send, nowRef };
}

describe('resolveDigestSchedule()', () => {
  const tmpRoot = resolve(tmpdir(), `preflight-digest-sched-${process.pid}`);
  let envSaved: string | undefined;

  beforeEach(() => {
    mkdirSync(tmpRoot, { recursive: true });
    envSaved = process.env.NEW_RELIC_AI_DIGEST_SCHEDULE;
    delete process.env.NEW_RELIC_AI_DIGEST_SCHEDULE;
  });

  afterEach(() => {
    if (envSaved === undefined) delete process.env.NEW_RELIC_AI_DIGEST_SCHEDULE;
    else process.env.NEW_RELIC_AI_DIGEST_SCHEDULE = envSaved;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('prefers the env var over the config file', () => {
    const path = resolve(tmpRoot, 'config.json');
    writeFileSync(path, JSON.stringify({ digestSchedule: '0 8 * * 2' }));
    process.env.NEW_RELIC_AI_DIGEST_SCHEDULE = '30 7 * * 1';
    expect(resolveDigestSchedule(path, '0 9 * * 1')).toBe('30 7 * * 1');
  });

  it('reads digestSchedule from the config file when env is unset', () => {
    const path = resolve(tmpRoot, 'config.json');
    writeFileSync(path, JSON.stringify({ digestSchedule: '0 8 * * 2' }));
    expect(resolveDigestSchedule(path, '0 9 * * 1')).toBe('0 8 * * 2');
  });

  it('falls back when the file is missing or has no digestSchedule', () => {
    expect(resolveDigestSchedule(resolve(tmpRoot, 'missing.json'), '0 9 * * 1')).toBe('0 9 * * 1');
    const path = resolve(tmpRoot, 'empty.json');
    writeFileSync(path, JSON.stringify({}));
    expect(resolveDigestSchedule(path, '0 9 * * 1')).toBe('0 9 * * 1');
  });
});

describe('DigestScheduler', () => {
  it('does not send when the current minute does not match', async () => {
    const { scheduler, send, nowRef } = makeScheduler();
    scheduler.start();
    nowRef.current = new Date(2026, 8, 21, 8, 59, 30);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(send).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('sends once when the clock enters a matching minute', async () => {
    const { scheduler, send, nowRef } = makeScheduler();
    scheduler.start();
    nowRef.current = new Date(2026, 8, 21, 9, 0, 5);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(send).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(send).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('sends immediately on start when the current minute already matches', async () => {
    const { scheduler, send } = makeScheduler({
      nowRef: { current: new Date(2026, 8, 21, 9, 0, 20) },
    });
    scheduler.start();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('does not send twice while a previous send is still in flight', async () => {
    let resolveSend!: (value: DigestSendResult) => void;
    const send = jest.fn<() => Promise<DigestSendResult>>().mockImplementation(
      () =>
        new Promise<DigestSendResult>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const nowRef = { current: new Date(2026, 8, 21, 9, 0, 0) };
    const { scheduler } = makeScheduler({
      schedule: '* * * * *',
      send,
      nowRef,
    });
    scheduler.start();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);

    nowRef.current = new Date(2026, 8, 21, 9, 1, 0);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(send).toHaveBeenCalledTimes(1);

    resolveSend(okResult());
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(15_000);
    expect(send).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('skips an invalid schedule and sends after it becomes valid', async () => {
    let schedule = 'not a cron';
    const { scheduler, send, nowRef } = makeScheduler({
      getSchedule: () => schedule,
      nowRef: { current: new Date(2026, 8, 21, 9, 0, 0) },
    });
    scheduler.start();
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();

    schedule = '0 9 * * 1';
    nowRef.current = new Date(2026, 8, 21, 9, 0, 20);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(send).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('re-reads getSchedule each tick so a PATCH is honored without restart', async () => {
    let schedule = '0 8 * * 1';
    const { scheduler, send, nowRef } = makeScheduler({
      getSchedule: () => schedule,
    });
    scheduler.start();
    nowRef.current = new Date(2026, 8, 21, 9, 0, 5);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(send).not.toHaveBeenCalled();

    schedule = '0 9 * * 1';
    await jest.advanceTimersByTimeAsync(15_000);
    expect(send).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('logs a skip when send reports no webhook, and a failure when send throws', async () => {
    const send = jest
      .fn<() => Promise<DigestSendResult>>()
      .mockResolvedValueOnce(
        errorResult('No webhook URL configured. Call nr_observe_subscribe_digest first.'),
      )
      .mockRejectedValueOnce(new Error('network down'));
    const nowRef = { current: new Date(2026, 8, 21, 9, 0, 0) };
    const { scheduler } = makeScheduler({ send, nowRef, schedule: '* * * * *' });
    scheduler.start();
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);

    nowRef.current = new Date(2026, 8, 21, 9, 1, 0);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(send).toHaveBeenCalledTimes(2);

    const logOutput = stderrSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
    expect(logOutput).toMatch(/Scheduled digest skipped/);
    expect(logOutput).toMatch(/Scheduled digest failed/);
    scheduler.stop();
  });

  it('start() and stop() are idempotent', () => {
    const { scheduler, send } = makeScheduler({
      nowRef: { current: new Date(2026, 8, 18, 12, 0, 0) },
      schedule: '0 9 * * 1',
    });
    scheduler.start();
    scheduler.start();
    scheduler.stop();
    scheduler.stop();
    expect(send).not.toHaveBeenCalled();
  });

  it('stop() prevents further ticks', async () => {
    const { scheduler, send, nowRef } = makeScheduler();
    scheduler.start();
    scheduler.stop();
    nowRef.current = new Date(2026, 8, 21, 9, 0, 5);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(send).not.toHaveBeenCalled();
  });
});

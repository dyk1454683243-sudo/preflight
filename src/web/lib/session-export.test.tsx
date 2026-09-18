import { describe, expect, it } from 'vitest';
import type { TurnCostsResponse } from '../api/client';
import { sessionLink, sessionToJson, sessionToMarkdown } from './session-export.js';

function turn(model: string): TurnCostsResponse['turns'][number] {
  return {
    turnId: model,
    startTime: 0,
    endTime: 1,
    toolCalls: [],
    toolNames: [],
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    model,
    estimatedCostUsd: 0.1,
    costPerToolCall: 0,
  };
}

describe('sessionToMarkdown', () => {
  it('falls back to the short session id and leaves out missing fields', () => {
    expect(sessionToMarkdown({ session: { sessionId: 'abcdef1234567890' } })).toBe(
      '### Session: abcdef12',
    );
  });

  it('treats a blank name as missing', () => {
    expect(
      sessionToMarkdown({
        session: { sessionId: 'abcdef1234567890', sessionName: '   ', toolCallCount: 0 },
      }),
    ).toBe('### Session: abcdef12');
  });

  it('summarises every field it has, under fifteen lines, without raw paths or commands', () => {
    const text = sessionToMarkdown({
      session: {
        sessionId: 's1',
        sessionName: 'preflight',
        startTime: Date.UTC(2026, 8, 18, 10, 0),
        durationMs: 198_000,
        toolCallCount: 12,
        toolBreakdown: { Read: 6, Edit: 3, Bash: 2, Grep: 1 },
        estimatedCostUsd: 0.42,
        toolSuccessRate: 0.917,
        model: 'claude-sonnet-5',
        filesRead: ['src/secret.ts', 'src/index.ts'],
        filesModified: ['src/index.ts'],
        antiPatterns: [
          { type: 're_reading', readCount: 3, file: '/Users/me/.ssh/id_rsa' },
          { type: 'thrashing', repeatCount: 1, command: 'curl https://example.com?token=abc' },
          { type: 'blind_editing' },
        ],
      },
      decisionTree: {
        totalBranches: 4,
        successRate: 0.75,
        failurePoints: [],
        longestFailureStreak: 2,
        firstFailureIndex: null,
        note: '',
      },
      turnCosts: {
        turns: [turn('claude-sonnet-5'), turn('claude-opus-5')],
        costByToolType: {},
        totalAttributedCost: 0.2,
        attributionRate: 1,
      },
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('### Session: preflight');
    expect(lines[1]).toMatch(/^- Started: .+ \(3m 18s\)$/);
    expect(lines.slice(2)).toEqual([
      '- Estimated cost: $0.42',
      '- Tool calls: 12 (Read 6, Edit 3, Bash 2)',
      '- Files touched: 2 read, 1 written',
      '- Tool success rate: 92%',
      '- Models: claude-sonnet-5, claude-opus-5',
      '- Longest failure streak: 2',
      '- Top anti-patterns: re_reading 3, thrashing 1, blind_editing 1',
    ]);
    expect(lines.length).toBeLessThanOrEqual(15);
    expect(text).not.toContain('id_rsa');
    expect(text).not.toContain('token=abc');
    expect(text).not.toContain('src/secret.ts');
  });

  it('counts anti-patterns from detector-specific fields, not only `count`', () => {
    const text = sessionToMarkdown({
      session: {
        sessionId: 's1',
        antiPatterns: [
          { type: 're_reading', readCount: 4 },
          { type: 'thrashing', iterations: 2 },
        ],
      },
    });
    expect(text).toContain('- Top anti-patterns: re_reading 4, thrashing 2');
  });

  it('uses the attributed turn cost when the session has no estimate', () => {
    const text = sessionToMarkdown({
      session: { sessionId: 's1', estimatedCostUsd: null },
      turnCosts: { turns: [], costByToolType: {}, totalAttributedCost: 0.2, attributionRate: 1 },
    });
    expect(text).toContain('- Estimated cost: $0.20');
  });

  it('uses a caller-supplied unique file count when the session has no file lists', () => {
    const text = sessionToMarkdown({
      session: { sessionId: 's1' },
      uniqueFilesTouched: 7,
    });
    expect(text).toContain('- Files touched: 7');
  });

  it('reads models from modelBreakdown when `model` is absent', () => {
    const text = sessionToMarkdown({
      session: {
        sessionId: 's1',
        modelBreakdown: { 'claude-sonnet-5': { requestCount: 2 } },
      },
    });
    expect(text).toContain('- Models: claude-sonnet-5');
  });

  it('shows duration alone when start time is missing', () => {
    const text = sessionToMarkdown({
      session: { sessionId: 's1', durationMs: 45_000 },
    });
    expect(text).toContain('- Duration: 45s');
    expect(text).not.toContain('Started:');
  });
});

describe('sessionToJson', () => {
  it('pretty-prints the session summary', () => {
    const session = { sessionId: 's1', toolCallCount: 2 };
    expect(sessionToJson(session)).toBe('{\n  "sessionId": "s1",\n  "toolCallCount": 2\n}');
  });

  it('strips content-bearing fields so a paste cannot carry secrets', () => {
    const json = sessionToJson({
      sessionId: 's1',
      sessionName: 'preflight',
      filesRead: ['/Users/me/.env'],
      filesModified: ['src/index.ts'],
      antiPatterns: [{ type: 're_reading', file: 'secret.key', command: 'cat ~/.aws/credentials' }],
      timeline: [{ timestamp: 1, toolName: 'Bash', command: 'export AWS_SECRET=1' }],
      sessionIntent: 'here is my API key sk-abc',
    });
    expect(json).toContain('"sessionId": "s1"');
    expect(json).toContain('"type": "re_reading"');
    expect(json).not.toContain('.env');
    expect(json).not.toContain('secret.key');
    expect(json).not.toContain('aws/credentials');
    expect(json).not.toContain('AWS_SECRET');
    expect(json).not.toContain('sk-abc');
    expect(json).not.toContain('sessionIntent');
    expect(json).not.toContain('filesRead');
    expect(json).not.toContain('timeline');
  });
});

describe('sessionLink', () => {
  it('points at the Sessions view and encodes the id', () => {
    expect(sessionLink('http://localhost:7777', 'a b/c')).toBe(
      'http://localhost:7777/sessions?id=a%20b%2Fc',
    );
  });

  it('strips a trailing slash on the origin', () => {
    expect(sessionLink('http://localhost:7777/', 'abc')).toBe(
      'http://localhost:7777/sessions?id=abc',
    );
  });
});

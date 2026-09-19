import { describe, expect, it } from '@jest/globals';
import { parsePrNumberFromToolResponse } from './pr-number.js';

describe('parsePrNumberFromToolResponse', () => {
  it('parses a github.com pull URL from Bash stdout', () => {
    expect(
      parsePrNumberFromToolResponse({
        exitCode: 0,
        stdout: 'https://github.com/newrelic-experimental/preflight/pull/773\n',
      }),
    ).toBe('773');
  });

  it('parses a /pulls/ API-style URL', () => {
    expect(
      parsePrNumberFromToolResponse({
        html_url: 'https://github.com/org/repo/pulls/15',
      }),
    ).toBe('15');
  });

  it('parses owner/repo#N from gh merge output', () => {
    expect(
      parsePrNumberFromToolResponse({
        stdout: '✓ Pull request acme/widgets#42 merged',
      }),
    ).toBe('42');
  });

  it('uses number when the payload also has an html_url', () => {
    expect(
      parsePrNumberFromToolResponse({
        number: 99,
        html_url: 'https://github.com/org/repo/pull/99',
      }),
    ).toBe('99');
  });

  it('ignores a lone number field that is not a PR payload', () => {
    expect(parsePrNumberFromToolResponse({ number: 99, exitCode: 0 })).toBeNull();
  });

  it('returns a collector-extracted prNumber', () => {
    expect(parsePrNumberFromToolResponse({ exitCode: 0, prNumber: '7' })).toBe('7');
  });

  it('parses a bare URL string', () => {
    expect(parsePrNumberFromToolResponse('https://github.com/org/repo/pull/12')).toBe('12');
  });

  it('parses a JSON string MCP body', () => {
    expect(
      parsePrNumberFromToolResponse(
        JSON.stringify({
          number: 3,
          html_url: 'https://github.com/org/repo/pull/3',
        }),
      ),
    ).toBe('3');
  });

  it('walks MCP content[].text blocks', () => {
    expect(
      parsePrNumberFromToolResponse({
        content: [
          {
            type: 'text',
            text: 'https://github.com/org/repo/pull/8',
          },
        ],
      }),
    ).toBe('8');
  });

  it('returns null for empty or unrelated output', () => {
    expect(parsePrNumberFromToolResponse(undefined)).toBeNull();
    expect(parsePrNumberFromToolResponse(null)).toBeNull();
    expect(parsePrNumberFromToolResponse({ stdout: 'lots of output here' })).toBeNull();
    expect(parsePrNumberFromToolResponse('')).toBeNull();
  });

  it('rejects a leading-zero numeric string that is not a URL', () => {
    expect(parsePrNumberFromToolResponse({ prNumber: '007' })).toBeNull();
  });
});

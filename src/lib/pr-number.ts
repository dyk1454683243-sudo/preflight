/**
 * Parse a GitHub pull-request number from a tool response or CLI stdout.
 *
 * `gh pr create` does not put the number on the command line; the hook
 * payload carries it in Bash stdout (a github.com/.../pull/N URL) or in an
 * MCP create_pull_request body (`html_url` / `number`). Only those shapes
 * are accepted — a lone `number` field on an unrelated tool is ignored.
 */

const GH_PR_URL_RE = /(?:github\.com)\/[^/\s]+\/[^/\s]+\/pulls?\/(\d+)/i;
const GH_REPO_HASH_RE = /\b[\w.-]+\/[\w.-]+#(\d+)\b/;
const DIGITS_RE = /^\d+$/;

function parsePrNumberFromText(text: string): string | null {
  const urlMatch = GH_PR_URL_RE.exec(text);
  if (urlMatch) return urlMatch[1];
  const hashMatch = GH_REPO_HASH_RE.exec(text);
  if (hashMatch) return hashMatch[1];
  return null;
}

function isPositiveIntString(value: string): boolean {
  return DIGITS_RE.test(value) && value !== '0' && !value.startsWith('0');
}

function numberFieldToPrNumber(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === 'string' && isPositiveIntString(value)) {
    return value;
  }
  return null;
}

function looksLikePrPayload(obj: Record<string, unknown>): boolean {
  if (typeof obj.html_url === 'string' && GH_PR_URL_RE.test(obj.html_url)) return true;
  if (typeof obj.htmlUrl === 'string' && GH_PR_URL_RE.test(obj.htmlUrl)) return true;
  if (typeof obj.url === 'string' && GH_PR_URL_RE.test(obj.url)) return true;
  return false;
}

/**
 * Best-effort PR number from a hook tool_response, collector metadata, or
 * a raw stdout string. Returns null when nothing parseable is present.
 */
export function parsePrNumberFromToolResponse(output: unknown): string | null {
  if (output === null || output === undefined) return null;
  if (typeof output === 'number') return numberFieldToPrNumber(output);
  if (typeof output === 'string') {
    const trimmed = output.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return parsePrNumberFromToolResponse(JSON.parse(trimmed) as unknown);
      } catch {
        // Fall through and scan the raw string for a URL.
      }
    }
    if (isPositiveIntString(trimmed)) return trimmed;
    return parsePrNumberFromText(output);
  }
  if (typeof output !== 'object') return null;

  if (Array.isArray(output)) {
    for (const entry of output) {
      const parsed = parsePrNumberFromToolResponse(entry);
      if (parsed) return parsed;
    }
    return null;
  }

  const obj = output as Record<string, unknown>;

  const fromMeta = numberFieldToPrNumber(obj.prNumber);
  if (fromMeta) return fromMeta;

  if (looksLikePrPayload(obj)) {
    const fromNumber = numberFieldToPrNumber(obj.number);
    if (fromNumber) return fromNumber;
  }

  for (const key of ['html_url', 'htmlUrl', 'url', 'stdout', 'stderr', 'text', 'result'] as const) {
    const parsed = parsePrNumberFromToolResponse(obj[key]);
    if (parsed) return parsed;
  }

  if (obj.pull_request !== undefined) {
    const nested = parsePrNumberFromToolResponse(obj.pull_request);
    if (nested) return nested;
  }

  if (Array.isArray(obj.content)) {
    const fromContent = parsePrNumberFromToolResponse(obj.content);
    if (fromContent) return fromContent;
  }

  return null;
}

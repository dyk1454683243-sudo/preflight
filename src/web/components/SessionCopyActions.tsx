import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { AlertCircle, Check, Copy, Link } from 'lucide-react';

import type { DecisionTreeResponse, TurnCostsResponse } from '../api/client';
import {
  type ExportableSession,
  sessionLink,
  sessionToJson,
  sessionToMarkdown,
} from '../lib/session-export.js';

export type SessionCopyFormat = 'markdown' | 'json' | 'link';

export interface SessionCopyActionsProps {
  readonly session: ExportableSession;
  readonly decisionTree?: DecisionTreeResponse;
  readonly turnCosts?: TurnCostsResponse;
  readonly uniqueFilesTouched?: number;
}

interface CopyStatus {
  readonly format: SessionCopyFormat;
  readonly ok: boolean;
}

const COPY_LABEL: Record<SessionCopyFormat, string> = {
  markdown: 'Copy Markdown',
  json: 'Copy JSON',
  link: 'Copy link',
};

const COPY_STATUS_RESET_MS = 1500;

const COPY_FORMATS: readonly SessionCopyFormat[] = ['markdown', 'json', 'link'];

export function SessionCopyActions({
  session,
  decisionTree,
  turnCosts,
  uniqueFilesTouched,
}: SessionCopyActionsProps): JSX.Element {
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null);

  useEffect(() => {
    if (copyStatus === null) return;
    const timer = setTimeout(() => setCopyStatus(null), COPY_STATUS_RESET_MS);
    return () => clearTimeout(timer);
  }, [copyStatus]);

  async function handleCopy(format: SessionCopyFormat): Promise<void> {
    const text =
      format === 'markdown'
        ? sessionToMarkdown({ session, decisionTree, turnCosts, uniqueFilesTouched })
        : format === 'json'
          ? sessionToJson(session)
          : sessionLink(window.location.origin, session.sessionId);
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus({ format, ok: true });
    } catch {
      // Clipboard API missing or permission denied (e.g. plain HTTP) — say so
      // instead of leaving the user to assume it worked.
      setCopyStatus({ format, ok: false });
    }
  }

  return (
    <div className="-ml-2 flex flex-wrap items-center gap-1">
      {COPY_FORMATS.map((format) => (
        <CopyButton
          key={format}
          format={format}
          label={COPY_LABEL[format]}
          status={copyStatus?.format === format ? copyStatus.ok : undefined}
          onClick={() => void handleCopy(format)}
        />
      ))}
      <span role="status" className="sr-only">
        {copyStatus === null
          ? ''
          : copyStatus.ok
            ? 'Copied to clipboard'
            : 'Copy failed — clipboard unavailable'}
      </span>
    </div>
  );
}

function CopyButton({
  format,
  label,
  status,
  onClick,
}: {
  format: SessionCopyFormat;
  label: string;
  /** true = just copied, false = copy failed, undefined = idle. */
  status: boolean | undefined;
  onClick: () => void;
}): JSX.Element {
  const Icon =
    status === true ? Check : status === false ? AlertCircle : format === 'link' ? Link : Copy;
  const iconTone =
    status === true ? 'text-accent-green' : status === false ? 'text-accent-red' : '';
  const shown = status === true ? 'Copied' : status === false ? 'Copy failed' : label;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex min-h-6 items-center gap-1 px-2 py-1 rounded-md text-[10px] text-ink-muted hover:text-ink-base hover:bg-surface-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/40"
    >
      <Icon className={`w-3.5 h-3.5 ${iconTone}`} aria-hidden="true" />
      {/* Stack every label in one grid cell so the button keeps the width of the
          longest one and its neighbours don't shift when the text changes. */}
      <span className="grid" aria-hidden="true">
        {[label, 'Copied', 'Copy failed'].map((text) => (
          <span
            key={text}
            className={`col-start-1 row-start-1 ${text === shown ? '' : 'invisible'}`}
          >
            {text}
          </span>
        ))}
      </span>
    </button>
  );
}

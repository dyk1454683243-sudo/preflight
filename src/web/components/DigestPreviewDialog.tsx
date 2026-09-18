import { useEffect } from 'react';
import type { JSX } from 'react';
import { X } from 'lucide-react';

import { Button } from './ui';

export interface DigestPreviewDialogProps {
  readonly open: boolean;
  readonly week: string | undefined;
  readonly text: string | undefined;
  readonly loading: boolean;
  readonly error: string | null;
  readonly canSend: boolean;
  readonly sending: boolean;
  readonly onClose: () => void;
  readonly onSend: () => void;
}

export function DigestPreviewDialog({
  open,
  week,
  text,
  loading,
  error,
  canSend,
  sending,
  onClose,
  onSend,
}: DigestPreviewDialogProps): JSX.Element | null {
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="digest-preview-title"
        className="glass-card animate-overlay-enter max-w-lg w-full mx-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 id="digest-preview-title" className="text-sm font-semibold text-ink-base">
              Digest preview
            </h2>
            {week && <p className="mt-0.5 text-[10px] text-ink-muted tabular-nums">{week}</p>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close digest preview"
            className="px-1 py-1"
          >
            <X size={16} aria-hidden="true" />
          </Button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto mb-4">
          {loading && <p className="text-xs text-ink-muted">Loading preview…</p>}
          {error && <p className="text-xs text-accent-red">{error}</p>}
          {!loading && !error && text && (
            <pre className="text-xs text-ink-base whitespace-pre-wrap font-mono leading-relaxed">
              {text}
            </pre>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          {!canSend && (
            <span className="text-[10px] text-ink-muted mr-auto">
              Configure a Slack webhook to send this digest.
            </span>
          )}
          <Button variant="secondary" size="md" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={onSend}
            disabled={!canSend || sending || loading}
            loading={sending}
          >
            {sending ? 'Sending…' : 'Send now'}
          </Button>
        </div>
      </div>
    </div>
  );
}

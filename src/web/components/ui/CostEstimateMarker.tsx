import { useId, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';

/**
 * Shared copy for why Preflight dollar figures can differ from a bill.
 * Owned here so org-spend pairing (#737) can reuse the same reasons.
 */
export interface CostEstimateReason {
  readonly id: 'pricing' | 'scope' | 'cache' | 'lag';
  readonly title: string;
  readonly detail: string;
}

export const COST_ESTIMATE_HEADING = 'This is a list-price estimate, not a bill.';

export const COST_ESTIMATE_REASONS: readonly CostEstimateReason[] = [
  {
    id: 'pricing',
    title: 'Pricing',
    detail: 'Public list price, not a negotiated rate or a flat-rate subscription.',
  },
  {
    id: 'scope',
    title: 'Scope',
    detail: 'This machine and the platforms Preflight has hooks for, not the whole org.',
  },
  {
    id: 'cache',
    title: 'Cache accounting',
    detail: 'Cache-write tokens are estimated on adapters without exact token data.',
  },
  {
    id: 'lag',
    title: 'Lag and period boundaries',
    detail: 'Billing runs behind and uses its own day and time zone.',
  },
];

export interface CostEstimateMarkerProps {
  /**
   * When true, render a non-focusable hover target so the marker can sit
   * inside another button (e.g. a session row) without nested interactives.
   */
  readonly embedded?: boolean;
}

interface TooltipPosition {
  readonly top: number;
  readonly left: number;
}

export function CostEstimateMarker({ embedded = false }: CostEstimateMarkerProps): JSX.Element {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ top: 0, left: 0 });

  const openTooltip = (): void => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPosition({ top: rect.bottom + 4, left: rect.left });
    }
    setIsOpen(true);
  };

  const closeTooltip = (): void => {
    setIsOpen(false);
  };

  return (
    <span className="relative inline-flex">
      <span
        ref={triggerRef}
        {...(embedded
          ? {}
          : {
              role: 'button',
              tabIndex: 0,
              onFocus: openTooltip,
              onBlur: closeTooltip,
            })}
        aria-label="Why this cost is an estimate"
        aria-describedby={tooltipId}
        onMouseEnter={openTooltip}
        onMouseLeave={closeTooltip}
        className={
          'text-[10px] font-medium uppercase tracking-wider text-ink-muted hover:text-ink-subtle ' +
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/40 ' +
          'focus-visible:ring-offset-1 focus-visible:ring-offset-bg-deep rounded-sm'
        }
      >
        est.
      </span>
      {isOpen &&
        createPortal(
          <span
            id={tooltipId}
            role="tooltip"
            className="fixed z-50 w-72 max-w-[18rem] rounded-md glass-card glass-card-static p-2 text-[10px] leading-snug text-ink-subtle"
            style={{ top: position.top, left: position.left }}
          >
            <span className="block text-ink-base font-medium">{COST_ESTIMATE_HEADING}</span>
            <ul className="mt-1.5 space-y-1">
              {COST_ESTIMATE_REASONS.map((reason) => (
                <li key={reason.id}>
                  <span className="text-ink-base">{reason.title}:</span> {reason.detail}
                </li>
              ))}
            </ul>
          </span>,
          document.body,
        )}
    </span>
  );
}

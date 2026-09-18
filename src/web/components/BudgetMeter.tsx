import type { JSX } from 'react';

import {
  isReportedSpendStale,
  reportedSpendForMeter,
  type ReportedSpend,
  type ReportedSpendPeriodKind,
} from '../../lib/reported-spend.js';
import type { BudgetPeriod } from '../api/client';
import { formatPct, formatUsd } from '../lib/format.js';
import { Card, CostEstimateMarker } from './ui';

export interface BudgetMeterProps {
  readonly daily: BudgetPeriod;
  readonly reported?: ReportedSpend | null;
  readonly now?: number;
  readonly meterPeriod?: ReportedSpendPeriodKind;
}

export function formatReportedAsOf(asOf: string): string {
  const ts = Date.parse(asOf);
  if (Number.isNaN(ts)) return asOf;
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function meterScale(estimateUsd: number, budgetUsd: number | null, reportedUsd: number): number {
  return Math.max(budgetUsd ?? 0, estimateUsd, reportedUsd, 0.01);
}

function barWidthPct(value: number, scale: number): number {
  if (scale <= 0) return 0;
  return Math.min(100, Math.max(0, (value / scale) * 100));
}

interface MeterBarProps {
  readonly label: string;
  readonly widthPct: number;
  readonly fillClass: string;
  readonly stale?: boolean;
}

function MeterBar({ label, widthPct, fillClass, stale = false }: MeterBarProps): JSX.Element {
  return (
    <div
      className={`h-1.5 w-full rounded-full bg-surface-3 overflow-hidden ${stale ? 'opacity-50' : ''}`}
      aria-hidden="true"
    >
      <div
        className={`h-full rounded-full ${fillClass}`}
        style={{ width: `${widthPct}%` }}
        data-testid={`${label}-bar`}
      />
    </div>
  );
}

/**
 * Daily budget meter on Today. The estimate bar is Preflight's local figure;
 * a matching reportedSpend draws a second bar beside it. Stale reported
 * values stay visible and are labelled rather than hidden.
 */
export function BudgetMeter({
  daily,
  reported = null,
  now = Date.now(),
  meterPeriod = 'daily',
}: BudgetMeterProps): JSX.Element | null {
  const matchingReported = reportedSpendForMeter(reported, meterPeriod);
  if (daily.budgetUsd == null && matchingReported == null) return null;

  const estimateUsd = daily.spentUsd;
  const reportedUsd = matchingReported?.amountUsd ?? 0;
  const stale = matchingReported != null && isReportedSpendStale(matchingReported, now);
  const scale = meterScale(estimateUsd, daily.budgetUsd, reportedUsd);

  return (
    <Card padding="md" tone="elevated" className="mb-4">
      <div role="group" aria-label="Daily budget meter">
        <div className="text-[10px] text-ink-muted uppercase tracking-wider font-medium">
          daily budget
        </div>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1 text-[10px] text-ink-muted uppercase tracking-wider font-medium">
              <span>estimate</span>
              <CostEstimateMarker />
            </div>
            <MeterBar
              label="estimate"
              widthPct={barWidthPct(estimateUsd, scale)}
              fillClass="bg-accent-green"
            />
            <div className="mt-1 text-sm font-medium tabular-nums text-ink-base">
              {daily.budgetUsd != null
                ? `${formatUsd(estimateUsd)} / ${formatUsd(daily.budgetUsd)}`
                : formatUsd(estimateUsd)}
            </div>
            {daily.pctUsed !== null && (
              <div className="text-[10px] text-ink-muted mt-0.5">
                {formatPct(daily.pctUsed)} used
              </div>
            )}
          </div>
          {matchingReported && (
            <div
              className={stale ? 'text-ink-muted' : undefined}
              data-stale={stale ? 'true' : 'false'}
            >
              <div className="text-[10px] uppercase tracking-wider font-medium">
                {stale ? 'reported · stale' : 'reported'}
              </div>
              <MeterBar
                label="reported"
                widthPct={barWidthPct(reportedUsd, scale)}
                fillClass={stale ? 'bg-ink-muted' : 'bg-accent-cyan'}
                stale={stale}
              />
              <div className="mt-1 text-sm font-medium tabular-nums">
                {formatUsd(matchingReported.amountUsd)}
              </div>
              <div className="text-[10px] mt-0.5">
                as of {formatReportedAsOf(matchingReported.asOf)}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

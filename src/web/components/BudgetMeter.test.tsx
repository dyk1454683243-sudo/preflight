import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BudgetMeter } from './BudgetMeter';
import type { BudgetPeriod } from '../api/client';
import type { ReportedSpend } from '../../lib/reported-spend.js';
import { COST_ESTIMATE_HEADING } from './ui/CostEstimateMarker';

function makeDaily(overrides: Partial<BudgetPeriod> = {}): BudgetPeriod {
  return {
    budgetUsd: 10,
    spentUsd: 4,
    pctUsed: 40,
    exceeded: false,
    ...overrides,
  };
}

function makeReported(overrides: Partial<ReportedSpend> = {}): ReportedSpend {
  return {
    periodKind: 'daily',
    amountUsd: 12.5,
    asOf: new Date(2026, 8, 18, 15, 42, 0).toISOString(),
    ...overrides,
  };
}

const fridayAfternoon = new Date(2026, 8, 18, 16, 0, 0).getTime();

describe('BudgetMeter', () => {
  it('renders nothing when there is no daily budget and no matching reported value', () => {
    const { container } = render(
      <BudgetMeter
        daily={makeDaily({ budgetUsd: null, pctUsed: null })}
        reported={null}
        now={fridayAfternoon}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the estimate bar without a reported bar when only a daily budget is set', () => {
    render(<BudgetMeter daily={makeDaily()} reported={null} now={fridayAfternoon} />);
    expect(screen.getByLabelText('Daily budget meter')).toBeInTheDocument();
    expect(screen.getByText('estimate')).toBeInTheDocument();
    expect(screen.getByText('$4.00 / $10.00')).toBeInTheDocument();
    expect(screen.getByText('40% used')).toBeInTheDocument();
    expect(screen.queryByText('reported')).toBeNull();
  });

  it('draws a second reported bar with the as-of time when a daily value exists', () => {
    render(<BudgetMeter daily={makeDaily()} reported={makeReported()} now={fridayAfternoon} />);
    expect(screen.getByText('reported')).toBeInTheDocument();
    expect(screen.getByText('$12.50')).toBeInTheDocument();
    expect(screen.getByText(/as of/i)).toBeInTheDocument();
    expect(screen.getByTestId('reported-bar')).toBeInTheDocument();
    expect(screen.queryByText(/stale/i)).toBeNull();
    expect(screen.getByText('reported').closest('[data-stale]')).toHaveAttribute(
      'data-stale',
      'false',
    );
  });

  it('greys a daily value from yesterday and labels it stale', () => {
    const yesterday = new Date(2026, 8, 17, 15, 42, 0).toISOString();
    render(
      <BudgetMeter
        daily={makeDaily()}
        reported={makeReported({ asOf: yesterday })}
        now={fridayAfternoon}
      />,
    );
    expect(screen.getByText('reported · stale')).toBeInTheDocument();
    expect(screen.getByText(/as of/i)).toBeInTheDocument();
    expect(screen.getByText('reported · stale').closest('[data-stale]')).toHaveAttribute(
      'data-stale',
      'true',
    );
    expect(screen.getByTestId('reported-bar').className).toMatch(/bg-ink-muted/);
  });

  it('does not draw a weekly reported value on the daily meter', () => {
    render(
      <BudgetMeter
        daily={makeDaily()}
        reported={makeReported({ periodKind: 'weekly' })}
        now={fridayAfternoon}
      />,
    );
    expect(screen.queryByText('reported')).toBeNull();
    expect(screen.getByText('estimate')).toBeInTheDocument();
  });

  it('puts the estimate marker on the pair so the gap is explained in place', () => {
    render(<BudgetMeter daily={makeDaily()} reported={makeReported()} now={fridayAfternoon} />);
    const trigger = screen.getByRole('button', { name: 'Why this cost is an estimate' });
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent(COST_ESTIMATE_HEADING);
  });
});

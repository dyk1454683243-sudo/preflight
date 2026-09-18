import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  COST_ESTIMATE_HEADING,
  COST_ESTIMATE_REASONS,
  CostEstimateMarker,
} from './CostEstimateMarker';

describe('CostEstimateMarker', () => {
  it('renders an est. marker whose hover lists why the figure can differ from a bill', () => {
    render(<CostEstimateMarker />);
    const trigger = screen.getByRole('button', { name: 'Why this cost is an estimate' });
    expect(trigger).toHaveTextContent('est.');
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(trigger);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent(COST_ESTIMATE_HEADING);
    for (const reason of COST_ESTIMATE_REASONS) {
      expect(tooltip).toHaveTextContent(reason.title);
      expect(tooltip).toHaveTextContent(reason.detail);
    }
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.getAttribute('id'));
  });

  it('exports the four reasons so other surfaces can reuse the same copy', () => {
    expect(COST_ESTIMATE_REASONS.map((r) => r.id)).toEqual(['pricing', 'scope', 'cache', 'lag']);
  });
});

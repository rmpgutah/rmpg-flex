import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import JudgeFlagChip from '../JudgeFlagChip';

describe('<JudgeFlagChip>', () => {
  it('renders nothing when verdict is ok', () => {
    const { container } = render(
      <JudgeFlagChip verdict={{ ok: true, reason: null, suggested_value: null, judge_confidence: 0.9, source: 'heuristic' }} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders an amber chip with the reason when verdict is not ok', () => {
    render(
      <JudgeFlagChip verdict={{ ok: false, reason: 'value not found in any source document', suggested_value: null, judge_confidence: 0.85, source: 'heuristic' }} />,
    );
    expect(screen.getByText(/value not found/i)).toBeInTheDocument();
  });

  it('shows the suggested value when the judge proposed one', () => {
    render(
      <JudgeFlagChip verdict={{ ok: false, reason: 'name mismatch', suggested_value: 'Robert Smith', judge_confidence: 0.7, source: 'claude' }} />,
    );
    expect(screen.getByText(/Robert Smith/i)).toBeInTheDocument();
  });
});

import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import StatTiles from '../StatTiles';
import EscalationLeaderboardWidget from '../EscalationLeaderboardWidget';

describe('dashboard widgets', () => {
  it('StatTiles renders the three counts', () => {
    render(<StatTiles stats={{ active_warrants: 11, on_watchlist: 7, gang_flagged: 4 }} />);
    expect(screen.getByText('11')).toBeInTheDocument();
    expect(screen.getByText('Active Warrants')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('EscalationLeaderboardWidget lists rows and fires onSelect', () => {
    const onSelect = vi.fn();
    render(<EscalationLeaderboardWidget rows={[
      { person_id: 5, label: 'HALE, Vincent', score: 9, trend: 'rising' },
    ]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('HALE, Vincent'));
    expect(onSelect).toHaveBeenCalledWith('person', 5, 'HALE, Vincent');
  });
});

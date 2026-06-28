import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import IntelRail from '../IntelRail';

describe('IntelRail', () => {
  it('renders section links and badge counts', () => {
    render(<MemoryRouter initialEntries={['/intel']}>
      <IntelRail counts={{ watchlist: 7, bolos: 3, alerts: 5, queues: 12, aiOnline: false }} />
    </MemoryRouter>);
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('BOLO Board')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();   // watchlist badge
    expect(screen.getByText('OFFLINE')).toBeInTheDocument(); // AI badge
  });
});

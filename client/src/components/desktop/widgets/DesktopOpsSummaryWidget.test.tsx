import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../../../hooks/useApi', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

import DesktopOpsSummaryWidget from './DesktopOpsSummaryWidget';

describe('DesktopOpsSummaryWidget', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    apiFetchMock.mockImplementation((endpoint: string) => {
      if (endpoint === '/dispatch') return Promise.resolve({ calls: { active: 4 } });
      if (endpoint === '/stats/dashboard') return Promise.resolve({ open_cases: 9, pending_serve: 2 });
      if (endpoint === '/dispatch/stats') return Promise.resolve({ active_warrants: 6 });
      return Promise.resolve({});
    });
  });

  it('renders live counts for calls, cases, warrants, and serves', async () => {
    render(<DesktopOpsSummaryWidget />);
    await waitFor(() => expect(screen.getByText('4')).toBeInTheDocument());
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

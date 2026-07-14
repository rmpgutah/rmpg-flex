import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import FleetioConflictBadge from '../FleetioConflictBadge';

vi.mock('../../hooks/useApi', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../hooks/useApi';
const mockedApiFetch = vi.mocked(apiFetch);

const CONFLICT = { id: 42, field: 'gallons', local_value: '10', remote_value: '12', resolution: null };

beforeEach(() => {
  mockedApiFetch.mockReset();
  mockedApiFetch.mockResolvedValue({ success: true });
});

describe('FleetioConflictBadge compact mode', () => {
  it('clicking the trigger opens a popover with resolve buttons', () => {
    render(<FleetioConflictBadge conflict={CONFLICT} compact />);
    expect(screen.queryByRole('button', { name: /keep local/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /conflict on gallons/i }));
    expect(screen.getByRole('button', { name: /keep local/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use remote/i })).toBeInTheDocument();
    cleanup();
  });

  it('"Keep local" calls resolve with local_wins and shows the resolved state', async () => {
    const onResolved = vi.fn();
    render(<FleetioConflictBadge conflict={CONFLICT} compact onResolved={onResolved} />);
    fireEvent.click(screen.getByRole('button', { name: /conflict on gallons/i }));
    fireEvent.click(screen.getByRole('button', { name: /keep local/i }));
    await waitFor(() => expect(onResolved).toHaveBeenCalled());
    expect(mockedApiFetch).toHaveBeenCalledWith(
      '/fleetio/conflicts/42/resolve',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ resolution: 'local_wins' }) }),
    );
    expect(screen.getByText(/kept local/i)).toBeInTheDocument();
    cleanup();
  });

  it('shows the resolved state directly when conflict.resolution is already set', () => {
    render(<FleetioConflictBadge conflict={{ ...CONFLICT, resolution: 'remote_wins' }} compact />);
    expect(screen.getByText(/used remote/i)).toBeInTheDocument();
    cleanup();
  });

  it('non-compact mode is unaffected — buttons render inline without a click', () => {
    render(<FleetioConflictBadge conflict={CONFLICT} />);
    expect(screen.getByRole('button', { name: /keep local/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /use remote/i })).toBeInTheDocument();
    cleanup();
  });
});

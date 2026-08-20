import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MapContext } from '../../MapContext';
import BeatManagementPanel from '../BeatManagementPanel';

vi.mock('../../../../hooks/useApi', () => ({
  apiFetch: vi.fn().mockResolvedValue([]),
}));

describe('BeatManagementPanel', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MapContext.Provider value={{ map: null, units: [], calls: [], beats: [] }}>
      {children}
    </MapContext.Provider>
  );

  it('renders panel title', () => {
    render(<BeatManagementPanel onClose={vi.fn()} />, { wrapper });
    expect(screen.getByText(/Beat Management/i)).toBeTruthy();
  });

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn();
    render(<BeatManagementPanel onClose={onClose} />, { wrapper });
    screen.getByRole('button', { name: /close/i }).click();
    expect(onClose).toHaveBeenCalled();
  });
});

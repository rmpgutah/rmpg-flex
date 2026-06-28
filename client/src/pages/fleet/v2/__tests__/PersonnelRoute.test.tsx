import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PersonnelRoute } from '../routes/PersonnelRoute';

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify([
    { id: 1, vehicle_id: 12, officer_name: 'Jones, A.', vehicle_name: 'Unit 12', assigned_date: '2026-01-15', ended_date: null },
    { id: 2, vehicle_id: 8, officer_name: 'Smith, B.', vehicle_name: 'Unit 8', assigned_date: '2025-08-01', ended_date: '2026-01-14' },
  ]), { status: 200 }))));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('<PersonnelRoute>', () => {
  it('renders assignments with ACTIVE badge on the open one', async () => {
    render(<MemoryRouter><PersonnelRoute /></MemoryRouter>);
    await screen.findByText(/jones, a\./i, {}, { timeout: 3000 });
    expect(screen.getByText(/smith, b\./i)).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });
});

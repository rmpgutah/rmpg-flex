// Regressions on the Unit Status Board found in the 2026-09-05 live run:
//  1. Under React 18 StrictMode (dev) the board sat on "Loading…" with zero
//     units: mountedRef started true and only a cleanup flipped it, so
//     StrictMode's mount → cleanup → mount left it false and every fetch
//     result was dropped.
//  2. The board read unit_id/badge but GET /dispatch/units returns
//     call_sign/badge_number, so every card showed a blank unit id and "#".
//  3. Status vocabulary ('on-call', 'traffic-stop', 'out-of-service') never
//     matched the API's enum, and the change-status call used PATCH where the
//     Worker only mounts PUT.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import UnitStatusBoardPage, { normalizeUnit } from '../UnitStatusBoardPage';

const mockApiFetch = vi.fn();
let role = 'dispatcher';
vi.mock('../../hooks/useApi', () => ({ apiFetch: (...a: unknown[]) => mockApiFetch(...a) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 2, role, username: 'u' } }) }));
vi.mock('../../components/PanelTitleBar', () => ({ default: ({ title }: { title: string }) => <div>{title}</div> }));

const apiRows = [
  { id: 1, call_sign: 'USB77', status: 'available', officer_id: 3, officer_name: 'Officer One', badge_number: 'O1', current_call_number: null },
  { id: 2, call_sign: 'D190', status: 'enroute', officer_id: 4, officer_name: 'Officer Two', badge_number: 'O2', current_call_number: 'CFS26-00009' },
  { id: 3, call_sign: 'C580', status: 'off_duty', officer_id: null, officer_name: null, badge_number: null, current_call_number: null },
];

beforeEach(() => {
  mockApiFetch.mockReset();
  role = 'dispatcher';
});

describe('normalizeUnit', () => {
  it('maps the API row shape onto the board fields', () => {
    expect(normalizeUnit(apiRows[0] as never)).toMatchObject({ id: 1, unit_id: 'USB77', badge: 'O1', officer_name: 'Officer One', status: 'available' });
    expect(normalizeUnit(apiRows[2] as never)).toMatchObject({ unit_id: 'C580', badge: '', officer_name: 'Unassigned' });
  });
});

describe('UnitStatusBoardPage', () => {
  it('renders fetched units (with call sign + badge) after StrictMode mount/cleanup/remount', async () => {
    mockApiFetch.mockResolvedValue(apiRows);
    render(<React.StrictMode><UnitStatusBoardPage /></React.StrictMode>);
    await waitFor(() => expect(screen.getAllByText('USB77').length).toBeGreaterThan(0));
    expect(screen.getByText('#O1')).toBeTruthy();
    expect(screen.getAllByText('En Route').length).toBeGreaterThan(0);
    expect(screen.getByText(/Call CFS26-00009/)).toBeTruthy();
    expect(screen.queryByText(/Loading…|Loading\.\.\./)).toBeNull();
    expect(mockApiFetch).toHaveBeenCalledWith('/dispatch/units');
  });

  it('counts engaged and out-of-service units with the API status enum', async () => {
    mockApiFetch.mockResolvedValue(apiRows);
    render(<UnitStatusBoardPage />);
    await waitFor(() => expect(screen.getAllByText('USB77').length).toBeGreaterThan(0));
    expect(screen.getByText('All (3)')).toBeTruthy();
    expect(screen.getByText('Available (1)')).toBeTruthy();
    expect(screen.getByText('On Call (1)')).toBeTruthy();
    expect(screen.getByText('Out (1)')).toBeTruthy();
  });

  it('admin status change PUTs an API-enum status to /dispatch/units/:id/status', async () => {
    role = 'admin';
    mockApiFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method) return { ok: true };
      return apiRows;
    });
    render(<UnitStatusBoardPage />);
    await waitFor(() => expect(screen.getAllByText('USB77').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('Officer One'));
    await waitFor(() => expect(screen.getByText('Change Unit Status')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Out of Service/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/dispatch/units/1/status', expect.objectContaining({ method: 'PUT' })));
    const call = mockApiFetch.mock.calls.find((c) => c[0] === '/dispatch/units/1/status')!;
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ status: 'out_of_service' });
  });
});

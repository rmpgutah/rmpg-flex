import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SpillmanCadBoard from '../SpillmanCadBoard';

afterEach(cleanup);

const calls = [
  { id: 'c1', call_number: '2026-000451', incident_type: 'alarm', priority: 'P1', status: 'pending', location: '100 S MAIN ST', assigned_units: [], created_at: '2026-07-02T09:00:00Z' },
  { id: 'c2', call_number: '2026-000452', incident_type: 'patrol_request', priority: 'P3', status: 'dispatched', location: '200 W TEMPLE', assigned_units: ['P12'], created_at: '2026-07-02T09:10:00Z' },
] as any[];
const units = [
  { id: 'u1', call_sign: 'P12', officer_name: 'ZAMORA', status: 'dispatched', current_call_id: 'c2', last_status_change: '2026-07-02T09:11:00Z' },
  { id: 'u2', call_sign: 'S3', officer_name: 'DOE', status: 'available', current_call_id: null, last_status_change: '2026-07-02T08:00:00Z' },
] as any[];

function mount(over: Partial<React.ComponentProps<typeof SpillmanCadBoard>> = {}) {
  const props = {
    calls, units, selectedCallId: null,
    onSelectCall: vi.fn(), onOpenNewCall: vi.fn(),
    onAssignUnitToCall: vi.fn(), onUnassignUnitFromCall: vi.fn(),
    onClearCall: vi.fn(), onCommandFeedback: vi.fn(),
    ...over,
  };
  render(<SpillmanCadBoard {...(props as any)} />);
  return props;
}

function runCmd(value: string) {
  const input = screen.getByLabelText('Command');
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('SpillmanCadBoard', () => {
  it('renders the three status grids with partitioned rows', () => {
    mount();
    expect(screen.getByText('UNDISPATCHED CALLS')).toBeInTheDocument();
    expect(screen.getByText(/^DISPATCHED CALLS$/)).toBeInTheDocument();
    expect(screen.getByText('UNIT STATUS')).toBeInTheDocument();
    expect(screen.getByText('2026-000451')).toBeInTheDocument();
    expect(screen.getAllByText('2026-000452').length).toBeGreaterThan(0);
  });

  it('runs dc <unit> <call#> from the command line', () => {
    const p = mount();
    runCmd('dc S3 451');
    expect(p.onAssignUnitToCall).toHaveBeenCalledWith('c1', 'u2');
  });

  it('ac opens the new-call modal', () => {
    const p = mount();
    runCmd('ac');
    expect(p.onOpenNewCall).toHaveBeenCalled();
  });

  it('uc <unit> unassigns via the unit’s current call', () => {
    const p = mount();
    runCmd('uc P12');
    expect(p.onUnassignUnitFromCall).toHaveBeenCalledWith('c2', 'u1');
  });

  it('cc with no selection and no call# reports an error', () => {
    const p = mount();
    runCmd('cc');
    expect(p.onClearCall).not.toHaveBeenCalled();
    expect(p.onCommandFeedback).toHaveBeenCalledWith('No call selected', 'error');
  });

  it('double-clicking a call row selects the call', () => {
    const p = mount();
    fireEvent.doubleClick(screen.getByText('2026-000451'));
    expect(p.onSelectCall).toHaveBeenCalledWith(calls[0]);
  });
});

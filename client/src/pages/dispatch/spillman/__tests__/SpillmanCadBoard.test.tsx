import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../../../components/ToastProvider';
import { ContextMenuProvider } from '../../../../context/ContextMenuContext';
import SpillmanCadBoard from '../SpillmanCadBoard';

afterEach(cleanup);

const calls = [
  { id: 'c1', call_number: '2026-000451', incident_type: 'alarm', priority: 'P1', status: 'pending', location: '100 S MAIN ST', assigned_units: [], created_at: '2026-07-02T09:00:00Z' },
  { id: 'c2', call_number: '2026-000452', incident_type: 'patrol_request', priority: 'P3', status: 'dispatched', location: '200 W TEMPLE', assigned_units: ['P12'], created_at: '2026-07-02T09:10:00Z' },
] as any[];
const units = [
  { id: 'u1', call_sign: 'P12', officer_name: 'ZAMORA', status: 'dispatched', current_call_id: 'c2', last_status_change: '2026-07-02T09:11:00Z', camera_device_id: 'cpg-1', camera_ignition_state: 'on' },
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
  render(
    <MemoryRouter>
      <ToastProvider>
        <ContextMenuProvider>
          <SpillmanCadBoard {...(props as any)} />
        </ContextMenuProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  return props;
}

function clickUnitRow(callSign: string) {
  const grid = screen.getByText('UNIT STATUS').closest('.spm-status-grid') as HTMLElement;
  fireEvent.click(within(grid).getByText(callSign));
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

  it('Dispatch/Unassign/Clear Call buttons are disabled with nothing selected', () => {
    mount();
    expect(screen.getByText('Dispatch')).toBeDisabled();
    expect(screen.getByText('Unassign')).toBeDisabled();
    expect(screen.getByText('Clear Call')).toBeDisabled();
  });

  it('clicking a unit row selects it, enabling Unassign for an assigned unit', () => {
    const p = mount();
    clickUnitRow('P12');
    expect(screen.getByText('Unassign')).not.toBeDisabled();
    fireEvent.click(screen.getByText('Unassign'));
    expect(p.onUnassignUnitFromCall).toHaveBeenCalledWith('c2', 'u1');
  });

  it('Dispatch button assigns the selected unit to the selected call (no typing required)', () => {
    const p = mount({ selectedCallId: 'c1' });
    clickUnitRow('S3');
    const btn = screen.getByText('Dispatch');
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(p.onAssignUnitToCall).toHaveBeenCalledWith('c1', 'u2');
  });

  it('Clear Call button clears the selected call', () => {
    const p = mount({ selectedCallId: 'c2' });
    fireEvent.click(screen.getByText('Clear Call'));
    expect(p.onClearCall).toHaveBeenCalledWith('c2');
  });

  it('New Call button opens the new-call modal', () => {
    const p = mount();
    fireEvent.click(screen.getByText('New Call'));
    expect(p.onOpenNewCall).toHaveBeenCalled();
  });

  it('right-clicking a call row opens a menu; Clear call fires onClearCall', () => {
    const p = mount();
    fireEvent.contextMenu(screen.getByText('2026-000451'));
    // no unit selected — toBeDisabled() must target the <button> itself, not
    // the inner label <span> (jest-dom doesn't climb from a plain descendant
    // to a disabled ancestor the way it does for <fieldset disabled>).
    expect(screen.getByText('Dispatch selected unit here').closest('button')).toBeDisabled();
    fireEvent.click(screen.getByText('Clear call'));
    expect(p.onClearCall).toHaveBeenCalledWith('c1');
  });

  it('right-clicking a unit row opens a menu; Unassign fires onUnassignUnitFromCall', () => {
    const p = mount();
    fireEvent.contextMenu(within(
      screen.getByText('UNIT STATUS').closest('.spm-status-grid') as HTMLElement,
    ).getByText('P12'));
    const items = screen.getAllByText('Unassign');
    fireEvent.click(items[items.length - 1]); // last match = the context-menu item, not the toolbar button
    expect(p.onUnassignUnitFromCall).toHaveBeenCalledWith('c2', 'u1');
  });

  it('badges the call # cell for a call in hitCallIds, leaves others plain', () => {
    mount({ hitCallIds: new Set(['c1']) });
    const hitCell = screen.getByText('2026-000451').closest('td') as HTMLElement;
    expect(hitCell.querySelector('svg')).toBeInTheDocument();
    const cleanCell = screen.getAllByText('2026-000452')[0].closest('td') as HTMLElement;
    expect(cleanCell.querySelector('svg')).not.toBeInTheDocument();
  });

  it('shows a camera icon for a unit with a dashcam device mapping, none for one without', () => {
    mount();
    const grid = screen.getByText('UNIT STATUS').closest('.spm-status-grid') as HTMLElement;
    const p12Cell = within(grid).getByText('P12').closest('td') as HTMLElement;
    expect(p12Cell.querySelector('svg')).toBeInTheDocument();
    const s3Cell = within(grid).getByText('S3').closest('td') as HTMLElement;
    expect(s3Cell.querySelector('svg')).not.toBeInTheDocument();
  });
});

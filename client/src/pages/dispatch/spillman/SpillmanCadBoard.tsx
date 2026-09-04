// Spillman Flex CAD console — P1 of the structural-replica program.
// Presentation-only shell: all data + mutations are injected by DispatchPage.
// Layout (top→bottom): command band (module label + live clock) → Command:
// line → Undispatched / Dispatched / Unit Status grids. Grids stay dark in
// both day/night themes via the kit's .spm-status-grid (tactical surface).
import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Camera } from 'lucide-react';
import type { CallForService, Unit } from '../../../types';
import { SpillmanStatusGrid, priorityColor, type StatusColumn } from '../../../components/spillman';
import {
  UNDISPATCHED_COLUMNS, DISPATCHED_COLUMNS, UNIT_COLUMNS,
  partitionCalls, callToRow, unitToRow, cadUnitColor,
  type CadCallRow, type CadUnitRow,
} from './cadGridMappers';
import { parseCadCommand, findUnitByCallSign, findCallByNumber } from './cadCommandLine';
import { useContextMenu, type ContextMenuItem } from '../../../context/ContextMenuContext';
import { useMenuActions } from '../../../utils/contextMenuActions';

export interface SpillmanCadBoardProps {
  calls: CallForService[];
  units: Unit[];
  selectedCallId: string | null;
  onSelectCall: (call: CallForService) => void;
  onOpenNewCall: () => void;
  onAssignUnitToCall: (callId: string, unitId: string) => void;
  onUnassignUnitFromCall: (callId: string, unitId: string) => void;
  onClearCall: (callId: string) => void;
  /** Toast/announce channel for command-line feedback (errors, echoes). */
  onCommandFeedback: (message: string, level: 'success' | 'error' | 'info') => void;
  /** Call IDs with an intel-screening hit worth a glance (GET
   *  /dispatch/calls/hits) — stolen/watchlisted vehicle, a linked person
   *  with an active warrant/watchlist entry, or a linked person matched to
   *  the NSOPW sex-offender registry. Badges the call # cell; absent/empty
   *  renders nothing. */
  hitCallIds?: Set<string>;
}

function useCadClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);
  return now.toLocaleString('en-US', {
    timeZone: 'America/Denver',
    weekday: 'short', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

// Column-header click-to-sort, one independent instance per grid (each has
// its own columns/data, so a shared sort state across all three wouldn't
// make sense). SpillmanStatusGrid already sorts internally via sortGridRows
// once handed a sortKey/sortDir — this hook is just the click-to-toggle
// state that was never wired up despite the grid supporting it.
function useGridSort(defaultKey?: string) {
  const [sortKey, setSortKey] = useState<string | undefined>(defaultKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const onSort = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  };
  return { sortKey, sortDir, onSort };
}

export default function SpillmanCadBoard(props: SpillmanCadBoardProps) {
  const {
    calls, units, selectedCallId, onSelectCall, onOpenNewCall,
    onAssignUnitToCall, onUnassignUnitFromCall, onClearCall, onCommandFeedback,
    hitCallIds,
  } = props;

  const clock = useCadClock();
  const [command, setCommand] = useState('');
  // Click-to-select a unit row, so Dispatch/Unassign below work without the
  // command line — the grid previously only supported drag-to-assign.
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

  // Column-header click-to-sort, one instance per grid.
  const undispatchedSort = useGridSort();
  const dispatchedSort = useGridSort();
  const unitSort = useGridSort();

  const { undispatched, dispatched } = useMemo(() => partitionCalls(calls), [calls]);
  const undispatchedRows = useMemo(() => undispatched.map(callToRow), [undispatched]);
  const dispatchedRows = useMemo(() => dispatched.map(callToRow), [dispatched]);
  const callNumberById = useMemo(() => {
    const m = new Map(calls.map((c) => [String(c.id), c.call_number] as const));
    return (id: string | null | undefined) => (id == null ? '' : m.get(String(id)) ?? '');
  }, [calls]);
  const unitRows = useMemo(() => units.map((u) => unitToRow(u, callNumberById)), [units, callNumberById]);

  const runCommand = () => {
    const cmd = parseCadCommand(command);
    if (!cmd) return;
    setCommand('');
    switch (cmd.kind) {
      case 'ac':
        onOpenNewCall();
        return;
      case 'dc': {
        const unit = findUnitByCallSign(units, cmd.unit);
        if (!unit) { onCommandFeedback(`Unknown unit: ${cmd.unit}`, 'error'); return; }
        const call = cmd.call
          ? findCallByNumber(calls, cmd.call)
          : calls.find((c) => c.id === selectedCallId);
        if (!call) { onCommandFeedback(cmd.call ? `Unknown call: ${cmd.call}` : 'No call selected', 'error'); return; }
        onAssignUnitToCall(call.id, unit.id);
        return;
      }
      case 'uc': {
        const unit = findUnitByCallSign(units, cmd.unit);
        if (!unit) { onCommandFeedback(`Unknown unit: ${cmd.unit}`, 'error'); return; }
        if (!unit.current_call_id) { onCommandFeedback(`${unit.call_sign} is not on a call`, 'error'); return; }
        onUnassignUnitFromCall(String(unit.current_call_id), unit.id);
        return;
      }
      case 'cc': {
        const call = cmd.call
          ? findCallByNumber(calls, cmd.call)
          : calls.find((c) => c.id === selectedCallId);
        if (!call) { onCommandFeedback(cmd.call ? `Unknown call: ${cmd.call}` : 'No call selected', 'error'); return; }
        onClearCall(call.id);
        return;
      }
      default:
        onCommandFeedback(`Unknown command: ${cmd.input} (try ac, dc <unit> [call#], uc <unit>, cc [call#])`, 'error');
    }
  };

  // Drag: unit rows are the drag source using the app-wide 'text/unit-id'
  // payload (same one CallCard consumes), call rows are drop targets.
  const onUnitDragStart = (row: CadUnitRow, e: React.DragEvent) => {
    e.dataTransfer.setData('text/unit-id', String(row.unit.id));
    e.dataTransfer.effectAllowed = 'link';
  };
  const onCallDrop = (row: CadCallRow, e: React.DragEvent) => {
    const unitId = e.dataTransfer.getData('text/unit-id');
    if (unitId) onAssignUnitToCall(row.call.id, unitId);
  };

  // Toolbar equivalents of the dc/uc/cc commands, for click-only operation.
  const selectedCall = useMemo(
    () => (selectedCallId ? calls.find((c) => c.id === selectedCallId) ?? null : null),
    [calls, selectedCallId],
  );
  const selectedUnit = useMemo(
    () => (selectedUnitId ? units.find((u) => u.id === selectedUnitId) ?? null : null),
    [units, selectedUnitId],
  );
  const handleDispatchClick = () => {
    if (!selectedUnit) { onCommandFeedback('Select a unit first', 'error'); return; }
    if (!selectedCall) { onCommandFeedback('Select a call first', 'error'); return; }
    onAssignUnitToCall(selectedCall.id, selectedUnit.id);
  };
  const handleUnassignClick = () => {
    if (!selectedUnit) { onCommandFeedback('Select a unit first', 'error'); return; }
    if (!selectedUnit.current_call_id) { onCommandFeedback(`${selectedUnit.call_sign} is not on a call`, 'error'); return; }
    onUnassignUnitFromCall(String(selectedUnit.current_call_id), selectedUnit.id);
  };
  const handleClearClick = () => {
    if (!selectedCall) { onCommandFeedback('Select a call first', 'error'); return; }
    onClearCall(selectedCall.id);
  };

  // Right-click menus — same shared ContextMenuContext/useMenuActions system
  // as UnitStatusBoard.tsx (single global menu instance; works inside table
  // rows), so these are consistent with every other right-click menu in the
  // app rather than a bespoke CAD-only dropdown.
  const { openMenu } = useContextMenu();
  const m = useMenuActions();

  const buildCallMenu = (call: CallForService): ContextMenuItem[] => [
    m.action('Dispatch selected unit here', () => onAssignUnitToCall(call.id, selectedUnit!.id), {
      disabled: !selectedUnit, hint: selectedUnit?.call_sign,
    }),
    m.action('Open call', () => onSelectCall(call)),
    m.action('Clear call', () => onClearCall(call.id), { danger: true }),
    m.separator(),
    m.copy('Copy call #', call.call_number),
    m.copyCoords(call.latitude, call.longitude),
  ];

  const buildUnitMenu = (unit: Unit): ContextMenuItem[] => [
    m.action('Dispatch to selected call', () => onAssignUnitToCall(selectedCall!.id, unit.id), {
      disabled: !selectedCall, hint: selectedCall?.call_number,
    }),
    m.action('Unassign', () => onUnassignUnitFromCall(String(unit.current_call_id), unit.id), {
      disabled: !unit.current_call_id, danger: true,
    }),
    m.separator(),
    m.copy('Copy call sign', unit.call_sign),
    ...(unit.officer_name ? [m.copy('Copy officer', unit.officer_name)] : []),
    m.copyCoords(unit.latitude, unit.longitude),
    m.separator(),
    m.copyId(unit.id),
  ];

  // Badges the call # cell for an intel-screening hit worth a glance (stolen/
  // watchlisted vehicle, a linked person with an active warrant/watchlist
  // entry, or an NSOPW registry match) — see GET /dispatch/calls/hits. Every
  // other column renders as
  // SpillmanStatusGrid's own default (String(row[col.key])).
  const renderCallCell = (r: CadCallRow, col: StatusColumn): React.ReactNode => {
    if (col.key === 'call_number' && hitCallIds?.has(r.call.id)) {
      return (
        <span className="inline-flex items-center gap-1" style={{ color: 'var(--sev-critical)' }}>
          <AlertTriangle style={{ width: 10, height: 10, flexShrink: 0 }} />
          {r.call_number}
        </span>
      );
    }
    return String(r[col.key] ?? '');
  };

  const callGridShared = {
    rowKey: (r: CadCallRow) => r.id,
    rowColor: (r: CadCallRow) => priorityColor(r.pri),
    selectedKey: selectedCallId ?? undefined,
    onSelect: (r: CadCallRow) => onSelectCall(r.call),
    onActivate: (r: CadCallRow) => onSelectCall(r.call),
    onDropRow: onCallDrop,
    onContextMenu: (r: CadCallRow, e: React.MouseEvent) => openMenu(e, buildCallMenu(r.call)),
    renderCell: renderCallCell,
  };

  // Badges the unit call-sign cell for a ClearPathGPS/FlexCam dashcam device
  // mapping (cpg_device_mappings). The device records continuously — this is
  // a capability indicator ("footage exists for this unit if requested"), not
  // a live recording toggle, since there isn't one to show.
  const renderUnitCell = (r: CadUnitRow, col: StatusColumn): React.ReactNode => {
    if (col.key === 'ps_route' && r.unit.ps_route_stops) {
      return (
        <span
          className="inline-flex items-center gap-0.5 font-mono tabular-nums"
          title={`PS Route: ${r.unit.ps_route_stops} stop${r.unit.ps_route_stops === 1 ? '' : 's'} planned today`}
          style={{ color: 'var(--accent-gold-300)' }}
        >
          {r.unit.ps_route_stops}
        </span>
      );
    }
    if (col.key === 'call_sign' && r.unit.camera_device_id) {
      return (
        <span className="inline-flex items-center gap-1" title={`Dashcam mapped${r.unit.camera_ignition_state ? ` — ignition ${r.unit.camera_ignition_state}` : ''}`}>
          <Camera style={{ width: 10, height: 10, flexShrink: 0, opacity: 0.7 }} />
          {r.call_sign}
        </span>
      );
    }
    return String(r[col.key] ?? '');
  };

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="spillman-cad-board">
      {/* Command band — steel-blue strip: module label + live clock */}
      <div
        className="flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wider flex-shrink-0"
        style={{ background: 'var(--surface-raised)', color: 'var(--spm-text)', borderBottom: '1px solid var(--spm-border)' }}
      >
        <span>CAD — Dispatch Console</span>
        <span className="font-mono tabular-nums">{clock}</span>
      </div>

      {/* Command line */}
      <div
        className="flex items-center gap-2 px-2 py-1 flex-shrink-0"
        style={{ background: 'var(--surface-sunken)', borderBottom: '1px solid var(--spm-border)' }}
      >
        <label htmlFor="spm-cad-command" className="text-[10px] font-bold" style={{ color: 'var(--spm-text)' }}>
          Command:
        </label>
        <input
          id="spm-cad-command"
          aria-label="Command"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') runCommand(); if (e.key === 'Escape') setCommand(''); }}
          spellCheck={false}
          autoComplete="off"
          className="flex-1 font-mono text-[11px] px-1.5 py-0.5 outline-none"
          style={{
            background: 'var(--surface-deep)', color: 'var(--spm-stat-avail)',
            border: '1px solid var(--spm-border)', borderRadius: 2, caretColor: 'currentColor',
          }}
          placeholder="ac · dc <unit> [call#] · uc <unit> · cc [call#]"
        />
      </div>

      {/* Click-only action toolbar — same three operations as the command
          line (dc/uc/cc), for dispatchers who never touch the keyboard.
          Select a call row and/or a unit row below, then click a button. */}
      <div
        className="flex items-center gap-1.5 px-2 py-1 flex-shrink-0 text-[10px] font-bold uppercase tracking-wide"
        style={{ background: 'var(--surface-sunken)', borderBottom: '1px solid var(--spm-border)' }}
      >
        <button
          type="button"
          onClick={onOpenNewCall}
          className="px-2 py-0.5 rounded-sm"
          style={{ background: 'var(--surface-raised)', color: 'var(--spm-text)', border: '1px solid var(--spm-border)' }}
        >
          New Call
        </button>
        <button
          type="button"
          onClick={handleDispatchClick}
          disabled={!selectedUnit || !selectedCall}
          className="px-2 py-0.5 rounded-sm disabled:opacity-40"
          style={{ background: 'var(--surface-raised)', color: 'var(--spm-text)', border: '1px solid var(--spm-border)' }}
          title="Dispatch selected unit to selected call"
        >
          Dispatch
        </button>
        <button
          type="button"
          onClick={handleUnassignClick}
          disabled={!selectedUnit?.current_call_id}
          className="px-2 py-0.5 rounded-sm disabled:opacity-40"
          style={{ background: 'var(--surface-raised)', color: 'var(--spm-text)', border: '1px solid var(--spm-border)' }}
          title="Unassign selected unit from its current call"
        >
          Unassign
        </button>
        <button
          type="button"
          onClick={handleClearClick}
          disabled={!selectedCall}
          className="px-2 py-0.5 rounded-sm disabled:opacity-40"
          style={{ background: 'var(--surface-raised)', color: 'var(--spm-text)', border: '1px solid var(--spm-border)' }}
          title="Clear selected call"
        >
          Clear Call
        </button>
        <span className="ml-auto font-normal normal-case" style={{ color: 'var(--spm-text-muted)' }}>
          {selectedCall ? selectedCall.call_number : 'no call selected'}
          {selectedUnit ? ` · ${selectedUnit.call_sign}` : ''}
        </span>
      </div>

      {/* Three status grids */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 p-1">
        <SpillmanStatusGrid<CadCallRow>
          title="UNDISPATCHED CALLS"
          badge={String(undispatchedRows.length)}
          columns={UNDISPATCHED_COLUMNS}
          rows={undispatchedRows}
          {...callGridShared}
          sortKey={undispatchedSort.sortKey}
          sortDir={undispatchedSort.sortDir}
          onSort={undispatchedSort.onSort}
        />
        <SpillmanStatusGrid<CadCallRow>
          title="DISPATCHED CALLS"
          badge={String(dispatchedRows.length)}
          columns={DISPATCHED_COLUMNS}
          rows={dispatchedRows}
          {...callGridShared}
          sortKey={dispatchedSort.sortKey}
          sortDir={dispatchedSort.sortDir}
          onSort={dispatchedSort.onSort}
        />
        <SpillmanStatusGrid<CadUnitRow>
          title="UNIT STATUS"
          badge={String(unitRows.length)}
          columns={UNIT_COLUMNS}
          rows={unitRows}
          rowKey={(r) => r.id}
          rowColor={(r) => cadUnitColor(r.unit.status)}
          selectedKey={selectedUnitId ?? undefined}
          onSelect={(r) => setSelectedUnitId(r.unit.id)}
          onDragStartRow={onUnitDragStart}
          onContextMenu={(r, e) => openMenu(e, buildUnitMenu(r.unit))}
          renderCell={renderUnitCell}
          sortKey={unitSort.sortKey}
          sortDir={unitSort.sortDir}
          onSort={unitSort.onSort}
        />
      </div>
    </div>
  );
}

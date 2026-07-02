// Spillman Flex CAD console — P1 of the structural-replica program.
// Presentation-only shell: all data + mutations are injected by DispatchPage.
// Layout (top→bottom): command band (module label + live clock) → Command:
// line → Undispatched / Dispatched / Unit Status grids. Grids stay dark in
// both day/night themes via the kit's .spm-status-grid (tactical surface).
import React, { useEffect, useMemo, useState } from 'react';
import type { CallForService, Unit } from '../../../types';
import { SpillmanStatusGrid, priorityColor } from '../../../components/spillman';
import {
  UNDISPATCHED_COLUMNS, DISPATCHED_COLUMNS, UNIT_COLUMNS,
  partitionCalls, callToRow, unitToRow, cadUnitColor,
  type CadCallRow, type CadUnitRow,
} from './cadGridMappers';
import { parseCadCommand, findUnitByCallSign, findCallByNumber } from './cadCommandLine';

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
}

function useCadClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);
  return now.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

export default function SpillmanCadBoard(props: SpillmanCadBoardProps) {
  const {
    calls, units, selectedCallId, onSelectCall, onOpenNewCall,
    onAssignUnitToCall, onUnassignUnitFromCall, onClearCall, onCommandFeedback,
  } = props;

  const clock = useCadClock();
  const [command, setCommand] = useState('');

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

  const callGridShared = {
    rowKey: (r: CadCallRow) => r.id,
    rowColor: (r: CadCallRow) => priorityColor(r.pri),
    selectedKey: selectedCallId ?? undefined,
    onSelect: (r: CadCallRow) => onSelectCall(r.call),
    onActivate: (r: CadCallRow) => onSelectCall(r.call),
    onDropRow: onCallDrop,
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
            background: '#000', color: 'var(--spm-stat-avail)',
            border: '1px solid var(--spm-border)', borderRadius: 2, caretColor: 'currentColor',
          }}
          placeholder="ac · dc <unit> [call#] · uc <unit> · cc [call#]"
        />
      </div>

      {/* Three status grids */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 p-1">
        <SpillmanStatusGrid<CadCallRow>
          title="UNDISPATCHED CALLS"
          badge={String(undispatchedRows.length)}
          columns={UNDISPATCHED_COLUMNS}
          rows={undispatchedRows}
          {...callGridShared}
        />
        <SpillmanStatusGrid<CadCallRow>
          title="DISPATCHED CALLS"
          badge={String(dispatchedRows.length)}
          columns={DISPATCHED_COLUMNS}
          rows={dispatchedRows}
          {...callGridShared}
        />
        <SpillmanStatusGrid<CadUnitRow>
          title="UNIT STATUS"
          badge={String(unitRows.length)}
          columns={UNIT_COLUMNS}
          rows={unitRows}
          rowKey={(r) => r.id}
          rowColor={(r) => cadUnitColor(r.unit.status)}
          onDragStartRow={onUnitDragStart}
        />
      </div>
    </div>
  );
}

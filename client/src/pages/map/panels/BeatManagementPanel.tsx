// ============================================================
// RMPG Flex — Beat Management Panel
// Supervisor+ tool: select beats + units + shift window, submit
// to Mapbox Optimization V2, and surface the resulting routes.
// Replaces the former PatrolBeatPlannerModal with a slide-in side panel.
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { X, Map } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import PanelTitleBar from '../../../components/PanelTitleBar';
import { useOptimizationV2 } from '../../../hooks/useOptimizationV2';
import type { V2Route } from '../../../utils/mapboxOptimizationV2';

interface Beat { id: number; beat_code: string; beat_name: string }
interface Unit { id: string; call_sign: string; status: string }

export interface BeatManagementPanelProps {
  onClose(): void;
  onSolutionReady?: (routes: V2Route[]) => void;
}

export default function BeatManagementPanel({ onClose, onSolutionReady }: BeatManagementPanelProps) {
  const [beats, setBeats] = useState<Beat[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedBeatIds, setSelectedBeatIds] = useState<Set<number>>(new Set());
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<string>>(new Set());
  const [shiftStart, setShiftStart] = useState('');
  const [shiftEnd, setShiftEnd] = useState('');
  const optimization = useOptimizationV2();

  useEffect(() => {
    apiFetch<{ results: Beat[] }>('/dispatch/geography/beats')
      .then((r) => setBeats(r.results ?? []))
      .catch(() => {});
    apiFetch<Unit[]>('/dispatch/units')
      .then((r) => { if (!cancelled) setUnits(Array.isArray(r) ? r : []); })
      .catch(() => {});
    const today = new Date().toISOString().split('T')[0];
    setShiftStart(`${today}T13:00`);
    setShiftEnd(`${today}T21:00`);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (optimization.status === 'complete' && optimization.solution) {
      onSolutionReady?.(optimization.solution.routes);
    }
  }, [optimization.status, optimization.solution, onSolutionReady]);

  const canSubmit =
    selectedBeatIds.size > 0 &&
    selectedUnitIds.size > 0 &&
    shiftStart.length > 0 &&
    shiftEnd.length > 0 &&
    optimization.status !== 'pending' &&
    optimization.status !== 'processing';

  const handleSubmit = useCallback(() => {
    void optimization.submit({
      job_type: 'patrol_beat',
      beat_ids: [...selectedBeatIds],
      unit_ids: [...selectedUnitIds].map(Number),
      shift_start: shiftStart + ':00Z',
      shift_end: shiftEnd + ':00Z',
    });
  }, [selectedBeatIds, selectedUnitIds, shiftStart, shiftEnd, optimization]);

  const toggleBeat = (id: number) =>
    setSelectedBeatIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const toggleUnit = (id: string) =>
    setSelectedUnitIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  return (
    <div className="absolute right-0 top-0 h-full w-80 bg-surface-base border-l border-brand-700/40 flex flex-col z-20 shadow-xl">
      <PanelTitleBar title="BEAT MANAGEMENT" icon={Map}>
        <button onClick={onClose} aria-label="Close" className="ml-auto text-brand-400 hover:text-brand-100">
          <X size={14} />
        </button>
      </PanelTitleBar>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Beat selection */}
        <section>
          <span className="text-[11px] font-semibold" style={{ color: 'var(--field-label-color)' }}>Beats</span>
          <div className="mt-1 space-y-0.5">
            {beats.length === 0 && (
              <span className="text-[10px] text-rmpg-500">No beats loaded</span>
            )}
            {beats.map((b) => (
              <label key={b.id} className="flex items-center gap-1.5 text-[11px] text-rmpg-300 cursor-pointer py-0.5">
                <input
                  type="checkbox"
                  checked={selectedBeatIds.has(b.id)}
                  onChange={() => toggleBeat(b.id)}
                  className="accent-rmpg-400"
                />
                {b.beat_code} {b.beat_name}
              </label>
            ))}
          </div>
        </section>

        {/* Unit selection */}
        <section>
          <span className="text-[11px] font-semibold" style={{ color: 'var(--field-label-color)' }}>Units</span>
          <div className="mt-1 space-y-0.5">
            {units.length === 0 && (
              <span className="text-[10px] text-rmpg-500">No units loaded</span>
            )}
            {units.map((u) => (
              <label key={u.id} className="flex items-center gap-1.5 text-[11px] text-rmpg-300 cursor-pointer py-0.5">
                <input
                  type="checkbox"
                  checked={selectedUnitIds.has(u.id)}
                  onChange={() => toggleUnit(u.id)}
                  className="accent-rmpg-400"
                />
                {u.call_sign}
                <span className="text-rmpg-500">({u.status})</span>
              </label>
            ))}
          </div>
        </section>

        {/* Shift window */}
        <section>
          <span className="text-[11px] font-semibold" style={{ color: 'var(--field-label-color)' }}>Shift Window (UTC)</span>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px]" style={{ color: 'var(--field-label-color)' }}>Start</label>
              <input
                type="datetime-local"
                value={shiftStart}
                step={60}
                onChange={(e) => setShiftStart(e.target.value)}
                className="text-[11px] bg-surface-raised border border-rmpg-600 px-2 py-1 text-rmpg-200"
                style={{ borderRadius: 2 }}
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-[10px]" style={{ color: 'var(--field-label-color)' }}>End</label>
              <input
                type="datetime-local"
                value={shiftEnd}
                step={60}
                onChange={(e) => setShiftEnd(e.target.value)}
                className="text-[11px] bg-surface-raised border border-rmpg-600 px-2 py-1 text-rmpg-200"
                style={{ borderRadius: 2 }}
              />
            </div>
          </div>
        </section>
      </div>

      {/* Status + actions */}
      <div className="p-3 border-t border-brand-700/40 space-y-2">
        {optimization.status === 'error' && (
          <div className="text-xs text-red-400">
            {optimization.error === 'timed_out'
              ? 'Optimization timed out — try fewer beats or units'
              : `Error: ${optimization.error}`}
          </div>
        )}
        {optimization.status === 'complete' && (
          <div className="text-xs" style={{ color: 'var(--sev-ok)' }}>
            Routes ready — {optimization.solution?.routes.length ?? 0} vehicle(s) assigned
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-1 text-xs text-rmpg-400 hover:text-rmpg-200">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-3 py-1.5 text-xs font-medium bg-rmpg-600 hover:bg-rmpg-500 text-rmpg-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            style={{ borderRadius: 2 }}
          >
            {optimization.status === 'pending' || optimization.status === 'processing'
              ? `Planning… ${Math.round(optimization.elapsedMs / 1000)}s`
              : 'Plan Beats'}
          </button>
        </div>
      </div>
    </div>
  );
}

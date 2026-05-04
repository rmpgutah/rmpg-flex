import { useState, useEffect, useCallback } from 'react';
import { Users, Radio, ChevronDown } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useRadioCheck } from '../../hooks/useRadioCheck';

interface DispatchUnit {
  id: number;
  call_sign: string;
  status: string;
  unit_type?: string;
}

const STATUS_LED: Record<string, { color: string; hollow?: boolean }> = {
  available: { color: '#22c55e' },
  on_patrol: { color: '#22c55e' },
  dispatched: { color: '#dc2626' },
  enroute: { color: '#d4a017' },
  on_scene: { color: '#d4a017' },
  unavailable: { color: '#dc2626' },
  out_of_service: { color: '#555555', hollow: true },
};

interface UnitSelectorProps {
  onRadioCheckResult?: (callSign: string, status: string, latencyMs: number | null) => void;
}

export default function UnitSelector({ onRadioCheckResult }: UnitSelectorProps) {
  const [units, setUnits] = useState<DispatchUnit[]>([]);
  const [selectedUnitId, setSelectedUnitId] = useState<string>('all');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { sendRadioCheck, results } = useRadioCheck();

  // Fetch units on mount
  useEffect(() => {
    apiFetch<DispatchUnit[]>('/dispatch/units')
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  // Report radio check results to parent (TransmissionLog)
  useEffect(() => {
    if (!onRadioCheckResult || results.length === 0) return;
    const latest = results[0];
    if (latest.status === 'ok' || latest.status === 'no_response') {
      onRadioCheckResult(
        latest.callSign,
        latest.status === 'ok' ? `OK ${latest.latencyMs}ms` : 'NO RESPONSE',
        latest.latencyMs,
      );
    }
  }, [results, onRadioCheckResult]);

  const handleRadioCheck = useCallback(() => {
    if (selectedUnitId === 'all') {
      // Broadcast radio check to all online units
      units
        .filter((u) => u.status !== 'out_of_service')
        .forEach((u) => sendRadioCheck(String(u.id), u.call_sign));
    } else {
      const unit = units.find((u) => String(u.id) === selectedUnitId);
      if (unit) {
        sendRadioCheck(String(unit.id), unit.call_sign);
      }
    }
  }, [selectedUnitId, units, sendRadioCheck]);

  const selectedLabel =
    selectedUnitId === 'all'
      ? 'ALL UNITS (broadcast)'
      : units.find((u) => String(u.id) === selectedUnitId)?.call_sign || '---';

  return (
    <div className="border border-[#222222] rounded-[2px] p-2 bg-[#0d0d0d]">
      <div className="text-[9px] font-semibold text-[#888888] uppercase tracking-[0.5px] mb-1.5">
        UNIT SELECTOR
      </div>

      {/* Unit chips grid */}
      <div className="grid grid-cols-4 gap-1 mb-2">
        {units.map((unit) => {
          const ledCfg = STATUS_LED[unit.status] || { color: '#555555', hollow: true };
          return (
            <button
              key={unit.id}
              onClick={() => {
                setSelectedUnitId(String(unit.id));
                setDropdownOpen(false);
              }}
              className="flex items-center gap-1 px-1 py-0.5 rounded-[2px] border transition-colors"
              style={{
                background: String(unit.id) === selectedUnitId ? '#1a1a1a' : '#0a0a0a',
                borderColor: String(unit.id) === selectedUnitId ? '#d4a017' : '#222222',
              }}
              title={`${unit.call_sign} — ${unit.status}`}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: ledCfg.hollow ? 'transparent' : ledCfg.color,
                  border: ledCfg.hollow ? `1px solid ${ledCfg.color}` : 'none',
                  boxShadow: ledCfg.hollow ? 'none' : `0 0 3px ${ledCfg.color}`,
                  flexShrink: 0,
                }}
              />
              <span className="text-[9px] font-mono text-[#cccccc] truncate">
                {unit.call_sign}
              </span>
            </button>
          );
        })}
        {units.length === 0 && (
          <div className="col-span-4 text-[9px] text-[#555555] italic py-1">No units online</div>
        )}
      </div>

      {/* Target selector dropdown */}
      <div className="relative mb-2">
        <button
          onClick={() => setDropdownOpen((p) => !p)}
          className="w-full flex items-center justify-between px-2 py-1 rounded-[2px] border border-[#333333] bg-[#111111] text-[10px] font-mono text-[#cccccc] hover:border-[#d4a017] transition-colors"
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className="w-3 h-3 text-[#888888] shrink-0 ml-1" />
        </button>
        {dropdownOpen && (
          <div
            className="absolute left-0 right-0 top-full mt-0.5 bg-[#111111] border border-[#333333] rounded-[2px] z-20 max-h-32 overflow-y-auto scrollbar-dark"
          >
            <button
              onClick={() => { setSelectedUnitId('all'); setDropdownOpen(false); }}
              className="w-full text-left px-2 py-1 text-[10px] font-mono text-[#d4a017] hover:bg-[#1a1a1a] transition-colors"
            >
              ALL UNITS (broadcast)
            </button>
            {units.map((u) => (
              <button
                key={u.id}
                onClick={() => { setSelectedUnitId(String(u.id)); setDropdownOpen(false); }}
                className="w-full text-left px-2 py-1 text-[10px] font-mono text-[#cccccc] hover:bg-[#1a1a1a] transition-colors"
              >
                {u.call_sign}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-1">
        <button
          className="flex-1 flex items-center justify-center gap-1 py-1 px-2 rounded-[2px] border border-[#333333] bg-[#111111] text-[9px] font-bold uppercase tracking-wide text-[#888888] hover:text-[#d4a017] hover:border-[#d4a017] transition-colors"
          title="Page Group (coming soon)"
        >
          <Users className="w-3 h-3" />
          PAGE GROUP
        </button>
        <button
          onClick={handleRadioCheck}
          className="flex-1 flex items-center justify-center gap-1 py-1 px-2 rounded-[2px] border border-[#333333] bg-[#111111] text-[9px] font-bold uppercase tracking-wide text-[#888888] hover:text-[#22c55e] hover:border-[#22c55e] transition-colors"
          title="Send Radio Check"
        >
          <Radio className="w-3 h-3" />
          RADIO CHECK
        </button>
      </div>
    </div>
  );
}

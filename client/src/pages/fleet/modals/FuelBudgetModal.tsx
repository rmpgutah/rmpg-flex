// ═══════════════════════════════════════════════════════════════
// RMPG Flex — Fuel Budget Modal
//
// Create / edit a fuel budget that scopes to a vehicle or the whole
// fleet. The modal is deliberately minimal — operators typically set
// one or two budgets per year and rarely revisit them, so the UI
// favors a single-screen form over a multi-step flow.
//
// Fields:
//   Scope               — fleet-wide vs. this vehicle
//   Period              — monthly | quarterly | annual
//   Budget amount       — USD, positive
//   Alert threshold (%) — defaults to 80; turns the progress bar amber
//   Effective from / to — ISO dates; `to` optional (open-ended)
//   Notes               — free text (budget rationale, approver, etc.)
// ═══════════════════════════════════════════════════════════════

import { useEffect, useId, useState } from 'react';
import { DollarSign, Calendar, AlertTriangle, Save, X as XIcon } from 'lucide-react';
import PanelTitleBar from '../../../components/PanelTitleBar';
import type { FleetFuelBudget, FuelBudgetPeriod } from '../../../types';

import RichTextArea from '../../../components/RichTextArea';
interface Props {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initial?: Partial<FleetFuelBudget> | null;
  vehicleId?: number | null;  // when provided + scope=vehicle, binds to this vehicle
  vehicleLabel?: string;      // "#47 — 2022 Explorer" for display
  onSave: (payload: {
    vehicle_id: number | null;
    period_type: FuelBudgetPeriod;
    budget_amount: number;
    alert_threshold_pct: number;
    effective_from: string;
    effective_to: string | null;
    notes: string | null;
  }) => Promise<void>;
  onClose: () => void;
  saving: boolean;
}

const PERIODS: { value: FuelBudgetPeriod; label: string; days: string }[] = [
  { value: 'monthly',   label: 'Monthly',   days: '~30 days' },
  { value: 'quarterly', label: 'Quarterly', days: '~90 days' },
  { value: 'annual',    label: 'Annual',    days: '~365 days' },
];

export default function FuelBudgetModal({
  isOpen, mode, initial, vehicleId, vehicleLabel, onSave, onClose, saving,
}: Props) {
  const titleId = useId();
  const [scope, setScope] = useState<'fleet' | 'vehicle'>(
    initial?.vehicle_id != null ? 'vehicle' : (vehicleId != null ? 'vehicle' : 'fleet')
  );
  const [periodType, setPeriodType] = useState<FuelBudgetPeriod>(initial?.period_type || 'monthly');
  const [amount, setAmount] = useState<string>(initial?.budget_amount != null ? String(initial.budget_amount) : '');
  const [threshold, setThreshold] = useState<string>(
    initial?.alert_threshold_pct != null ? String(initial.alert_threshold_pct) : '80'
  );
  const [effectiveFrom, setEffectiveFrom] = useState<string>(
    initial?.effective_from || new Date().toISOString().slice(0, 10)
  );
  const [effectiveTo, setEffectiveTo] = useState<string>(initial?.effective_to || '');
  const [notes, setNotes] = useState<string>(initial?.notes || '');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  const submit = async () => {
    setError('');
    const amt = parseFloat(amount);
    if (!isFinite(amt) || amt <= 0) { setError('Budget amount must be a positive number'); return; }
    const thr = parseFloat(threshold);
    if (!isFinite(thr) || thr < 0 || thr > 100) { setError('Alert threshold must be 0–100'); return; }
    if (!effectiveFrom) { setError('Effective-from date is required'); return; }
    try {
      await onSave({
        vehicle_id: scope === 'vehicle' ? (vehicleId ?? initial?.vehicle_id ?? null) : null,
        period_type: periodType,
        budget_amount: amt,
        alert_threshold_pct: thr,
        effective_from: effectiveFrom,
        effective_to: effectiveTo || null,
        notes: notes.trim() || null,
      });
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center"
      role="dialog" aria-modal="true" aria-labelledby={titleId}
      style={{ background: 'rgba(0,0,0,0.6)' }} onClick={saving ? undefined : onClose}>
      <div className="panel-beveled w-[480px] max-w-full mx-4 max-h-[90vh] flex flex-col bg-surface-raised"
        onClick={(e) => e.stopPropagation()}>
        <PanelTitleBar title={mode === 'edit' ? 'EDIT FUEL BUDGET' : 'NEW FUEL BUDGET'} icon={DollarSign} id={titleId}>
          <button type="button" className="toolbar-btn text-[9px]" onClick={onClose}>X</button>
        </PanelTitleBar>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {error && (
            <div className="panel-beveled p-2 border border-red-700/40 bg-red-900/20">
              <div className="flex items-center gap-1.5 text-[10px] text-red-400"><AlertTriangle className="w-3 h-3" />{error}</div>
            </div>
          )}

          {/* Scope — fleet vs vehicle */}
          <div>
            <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-1">Scope</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button"
                className={`panel-beveled p-2 text-[10px] text-left ${scope === 'fleet' ? 'border-brand-500 bg-brand-900/20 text-brand-300' : 'bg-surface-sunken text-rmpg-400'}`}
                onClick={() => setScope('fleet')}>
                <div className="font-bold text-[10px]">Fleet-Wide</div>
                <div className="text-[8px] text-rmpg-500">Applies across all vehicles</div>
              </button>
              <button type="button"
                className={`panel-beveled p-2 text-[10px] text-left ${scope === 'vehicle' ? 'border-brand-500 bg-brand-900/20 text-brand-300' : 'bg-surface-sunken text-rmpg-400'}`}
                onClick={() => setScope('vehicle')}
                disabled={!vehicleId}
                title={!vehicleId ? 'Open a vehicle first to create a vehicle-scoped budget' : ''}>
                <div className="font-bold text-[10px]">This Vehicle</div>
                <div className="text-[8px] text-rmpg-500 truncate">{vehicleLabel || '(no vehicle selected)'}</div>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Period</label>
              <select className="select-dark w-full text-[11px] min-h-[36px]" value={periodType}
                onChange={(e) => setPeriodType(e.target.value as FuelBudgetPeriod)}>
                {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label} ({p.days})</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Budget Amount ($)</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.01" min="0"
                value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 5000.00" />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Alert Threshold (%)</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="1" min="0" max="100"
                value={threshold} onChange={(e) => setThreshold(e.target.value)} />
              <div className="text-[8px] text-rmpg-500 mt-0.5">Amber when spending reaches this % of budget</div>
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5 flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5" />Effective From
              </label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="date"
                value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5 flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5" />Effective To <span className="text-rmpg-600 normal-case">(optional — open-ended when blank)</span>
              </label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="date"
                value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Notes</label>
            <RichTextArea className="input-dark w-full text-[10px] h-14 resize-none min-h-[36px]" value={notes}
              onChange={(e) => setNotes(e.target.value)} maxLength={2000}
              placeholder="Approver, rationale, etc." />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button type="button" className="toolbar-btn" onClick={onClose} disabled={saving}>
            <XIcon className="w-3 h-3" /> Cancel
          </button>
          <button type="button" className="toolbar-btn toolbar-btn-primary" onClick={submit} disabled={saving}>
            <Save className="w-3 h-3" /> {saving ? 'Saving...' : mode === 'edit' ? 'Update Budget' : 'Create Budget'}
          </button>
        </div>
      </div>
    </div>
  );
}

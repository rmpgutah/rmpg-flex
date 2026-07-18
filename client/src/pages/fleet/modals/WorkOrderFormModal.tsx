import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { VmrsPicker, type VmrsSelection } from '../../../components/fleet/VmrsPicker';
import { apiFetch } from '../../../hooks/useApi';
import type { WorkOrder, WorkOrderStatus } from '../../../types';

export interface WorkOrderFormVehicle {
  id: number;
  vehicle_number: string | null;
  vehicle_name: string | null;
}

interface Props {
  vehicles: WorkOrderFormVehicle[];
  onClose: () => void;
  onCreated: () => void;
}

export default function WorkOrderFormModal({ vehicles, onClose, onCreated }: Props) {
  const [vehicleId, setVehicleId] = useState('');
  const [number, setNumber] = useState('');
  const [summary, setSummary] = useState('');
  const [status, setStatus] = useState<WorkOrderStatus>('open');
  const [estCost, setEstCost] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState('normal');
  const [scheduledDate, setScheduledDate] = useState('');
  const [failureCategory, setFailureCategory] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [vmrsSelection, setVmrsSelection] = useState<VmrsSelection | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose, saving]);

  const handleSave = () => {
    setErr(null);
    if (!vehicleId) {
      setErr('Vehicle is required.');
      return;
    }
    setSaving(true);
    apiFetch<{ data: WorkOrder }>('/work-orders', {
      method: 'POST',
      body: JSON.stringify({
        vehicle_id: parseInt(vehicleId, 10),
        number: number.trim() || null,
        summary: summary.trim() || null,
        status,
        priority,
        scheduled_date: scheduledDate || null,
        failure_category: failureCategory || null,
        estimated_hours: estimatedHours ? parseFloat(estimatedHours) : null,
        vmrs_system_code: vmrsSelection?.systemCode ?? null,
        vmrs_assembly_code: vmrsSelection?.assemblyCode ?? null,
        vmrs_component_code: vmrsSelection?.componentCode ?? null,
        est_cost: estCost ? parseFloat(estCost) : null,
        notes: notes.trim() || null,
      }),
    })
      .then(() => { setSaving(false); onCreated(); })
      .catch((e) => {
        setSaving(false);
        setErr(e instanceof Error ? e.message : 'Failed to create work order');
      });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-wo-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={saving ? undefined : onClose}
    >
      <div
        className="bg-surface-raised border border-rmpg-700 rounded-sm w-[480px] max-w-full mx-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700">
          <h2 id="new-wo-title" className="text-sm font-semibold text-rmpg-100">New Work Order</h2>
          <button type="button" onClick={onClose} className="text-rmpg-400 hover:text-rmpg-100 p-1" disabled={saving} aria-label="Close">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>
        <div className="p-4 space-y-3">
          {err ? (
            <div className="px-3 py-2 rounded-sm border border-red-500/40 text-red-300 text-xs">{err}</div>
          ) : null}
          <Field label="Vehicle *" htmlFor="wo-vehicle">
            <select
              id="wo-vehicle"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              aria-required
            >
              <option value="">— select vehicle —</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vehicle_number ?? v.vehicle_name ?? `Vehicle ${v.id}`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="WO Number (optional)">
            <input
              type="text"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Shop-assigned number"
            />
          </Field>
          <Field label="Summary">
            <input
              type="text"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Short one-liner"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                value={status}
                onChange={(e) => setStatus(e.target.value as WorkOrderStatus)}
              >
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="waiting_parts">Waiting parts</option>
              </select>
            </Field>
            <Field label="Priority">
              <select
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="emergency">Emergency</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Scheduled Date">
              <input
                type="date"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
              />
            </Field>
            <Field label="Est. hours">
              <input
                type="number"
                inputMode="decimal"
                step="0.5"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(e.target.value)}
                placeholder="e.g. 2.5"
              />
            </Field>
          </div>
          <Field label="Failure Category">
            <select
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
              value={failureCategory}
              onChange={(e) => setFailureCategory(e.target.value)}
            >
              <option value="">— None —</option>
              <option value="mechanical">Mechanical</option>
              <option value="electrical">Electrical</option>
              <option value="body">Body / Cosmetics</option>
              <option value="tires">Tires / Wheels</option>
              <option value="brakes">Brakes</option>
              <option value="engine">Engine</option>
              <option value="transmission">Transmission</option>
              <option value="hvac">HVAC</option>
              <option value="lights">Lights / Sirens</option>
              <option value="radio">Radio / Comms</option>
              <option value="computer">Computer / MDT</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="VMRS Code (optional)">
            <VmrsPicker value={vmrsSelection} onChange={setVmrsSelection} />
          </Field>
          <Field label="Est. cost ($)">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
              value={estCost}
              onChange={(e) => setEstCost(e.target.value)}
            />
          </Field>
          <Field label="Notes">
            <textarea
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 h-16 resize-none"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>
        <footer className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button type="button" onClick={onClose} disabled={saving} className="px-2 py-1 text-[11px] border border-rmpg-700 rounded-sm hover:bg-rmpg-800 text-rmpg-100">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="px-2 py-1 text-[11px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110 disabled:opacity-50">
            {saving ? 'Saving…' : 'Create'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[10px] text-rmpg-400 uppercase tracking-wide mb-0.5">{label}</label>
      {children}
    </div>
  );
}

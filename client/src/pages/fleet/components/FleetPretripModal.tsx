import { useCallback, useId, useRef, useState, useEffect } from 'react';
import RichTextArea from '../../../components/RichTextArea';
import { useToast } from '../../../components/ToastProvider';
import DiscardUnsavedDialog from '../../../components/DiscardUnsavedDialog';
import { apiFetch } from '../../../hooks/useApi';
import type { FleetVehicle } from '../../../types';

const PRETRIP_ITEMS: { key: string; label: string }[] = [
  { key: 'lights_ok', label: 'Lights & Signals' },
  { key: 'brakes_ok', label: 'Brakes' },
  { key: 'radio_ok', label: 'Radio/Comms' },
  { key: 'mdt_ok', label: 'MDT/Computer' },
  { key: 'camera_ok', label: 'Dash Camera' },
  { key: 'tires_ok', label: 'Tires' },
  { key: 'fluids_ok', label: 'Fluids (Oil/Coolant)' },
  { key: 'exterior_ok', label: 'Exterior Condition' },
  { key: 'interior_ok', label: 'Interior Condition' },
  { key: 'emergency_equipment_ok', label: 'Emergency Equipment' },
];

const PRETRIP_DEFAULTS = PRETRIP_ITEMS.reduce<Record<string, boolean>>(
  (acc, i) => { acc[i.key] = true; return acc; }, {},
);

type PretripForm = Record<string, boolean | string> & { notes: string };

interface Props {
  vehicle: FleetVehicle | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export default function FleetPretripModal({ vehicle, isOpen, onClose, onSaved }: Props) {
  const { addToast } = useToast();
  const titleId = useId();
  const firstItemRef = useRef<HTMLInputElement | null>(null);

  const [form, setForm] = useState<PretripForm>({ ...PRETRIP_DEFAULTS, notes: '' });
  const [saving, setSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const isDirty = PRETRIP_ITEMS.some((it) => !(form as Record<string, unknown>)[it.key])
    || form.notes.trim() !== '';

  const close = useCallback(() => {
    if (saving) return;
    if (isDirty) { setDiscardOpen(true); return; }
    setForm({ ...PRETRIP_DEFAULTS, notes: '' } as PretripForm);
    onClose();
  }, [saving, isDirty, onClose]);

  const confirmDiscard = () => {
    setDiscardOpen(false);
    setForm({ ...PRETRIP_DEFAULTS, notes: '' } as PretripForm);
    onClose();
  };

  const submit = useCallback(async () => {
    if (!vehicle) return;
    setSaving(true);
    try {
      const result = await apiFetch<{ overall_pass: boolean }>('/fleet/pretrip', {
        method: 'POST',
        body: JSON.stringify({ vehicle_id: vehicle.id, ...form }),
      });
      addToast(
        result.overall_pass ? 'Pre-trip PASSED' : 'Pre-trip FAILED - check items',
        result.overall_pass ? 'success' : 'error',
      );
      setForm({ ...PRETRIP_DEFAULTS, notes: '' } as PretripForm);
      onSaved?.();
      onClose();
    } catch (err: unknown) {
      addToast((err as Error)?.message || 'Failed to submit pre-trip', 'error');
    } finally { setSaving(false); }
  }, [vehicle, form, addToast, onClose, onSaved]);

  useEffect(() => {
    if (isOpen) firstItemRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  if (!isOpen || !vehicle) return null;

  return (
    <div
      data-testid="pretrip-backdrop"
      className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 p-2"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-surface-raised border border-rmpg-600 w-[450px] max-w-[95vw] max-h-[90vh] md:max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b border-rmpg-600">
          <h3 id={titleId} className="text-sm font-bold text-rmpg-100">
            Pre-Trip Inspection: {vehicle.vehicle_number}
          </h3>
          <button type="button" onClick={close} aria-label="Close pre-trip inspection" className="text-rmpg-400 hover:text-rmpg-100 text-lg">&times;</button>
        </div>
        <div className="p-3 flex-1 overflow-auto space-y-2">
          {PRETRIP_ITEMS.map((item, idx) => {
            const inputId = `ff-pretrip-${item.key}`;
            const checked = !!(form as Record<string, unknown>)[item.key];
            return (
              <label key={item.key} htmlFor={inputId} className="flex items-center gap-3 p-2 min-h-[44px] bg-surface-base cursor-pointer hover:bg-surface-raised">
                <input
                  id={inputId}
                  ref={idx === 0 ? firstItemRef : undefined}
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => setForm((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                  className="w-4 h-4 accent-green-500"
                />
                <span className={`text-sm ${checked ? 'text-green-300' : 'text-red-300'}`}>{item.label}</span>
                <span className="ml-auto text-[10px] font-mono">{checked ? 'PASS' : 'FAIL'}</span>
              </label>
            );
          })}
          <RichTextArea
            value={form.notes as string}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            className="input-dark w-full h-16 text-sm mt-2 min-h-[36px]"
            placeholder="Notes (defects, damage, etc.)..."
          />
        </div>
        <div className="flex justify-end gap-2 p-3 border-t border-rmpg-600">
          <button type="button" onClick={close} className="toolbar-btn">Cancel</button>
          <button type="button" onClick={submit} disabled={saving} className="toolbar-btn toolbar-btn-primary print:hidden">
            {saving ? 'Saving...' : 'Submit Pre-Trip'}
          </button>
        </div>
      </div>
      <DiscardUnsavedDialog
        isOpen={discardOpen}
        onClose={() => setDiscardOpen(false)}
        onConfirm={confirmDiscard}
        message="Discard this pre-trip checklist?"
      />
    </div>
  );
}

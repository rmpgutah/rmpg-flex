import React, { useId, useEffect, useRef } from 'react';
import { Fuel, DollarSign, Paperclip, X as XIcon, Image as ImageIcon, FileText } from 'lucide-react';
import PanelTitleBar from '../../../components/PanelTitleBar';
import type { FuelType } from '../../../types';

export interface FuelFormState {
  fuel_date: string;
  gallons: string;
  cost_per_gallon: string;
  total_cost: string;
  odometer_reading: string;
  fuel_type: FuelType;
  station: string;
  notes: string;
  // 2026-04-14 enhancement: optional receipt file staged for upload.
  // Handled outside the main POST/PUT payload — after the log is saved
  // and we have its ID, the caller uploads this separately to
  // POST /fleet/fuel/:id/receipt. Null/undefined = no change.
  receiptFile?: File | null;
  // Indicator (edit mode only) that an existing receipt is attached so
  // we can show a preview link + remove button without fetching it.
  existingReceipt?: boolean;
  // v2: attribution — stringified for <select> value binding. Server
  // coerces the empty string to null in the POST/PUT handlers.
  driver_officer_id?: string;
  fuel_card_id?: string;
}

export const EMPTY_FUEL_FORM: FuelFormState = {
  fuel_date: '', gallons: '', cost_per_gallon: '', total_cost: '',
  odometer_reading: '', fuel_type: 'regular', station: '', notes: '',
  receiptFile: null, existingReceipt: false,
  driver_officer_id: '', fuel_card_id: '',
};

/** Minimal officer option used by the driver dropdown. */
export interface DriverOption {
  id: number | string;
  full_name?: string | null;
  username?: string | null;
  badge?: string | null;
}

/** Minimal fuel card option used by the card dropdown. */
export interface FuelCardOption {
  id: number | string;
  card_number: string;
  provider?: string | null;
  status?: string | null;
  vehicle_id?: number | string | null;
}

const FUEL_TYPES: { value: FuelType; label: string }[] = [
  { value: 'regular', label: 'Regular' },
  { value: 'premium', label: 'Premium' },
  { value: 'diesel', label: 'Diesel' },
];

const FUEL_GRADE: Record<FuelType, { led: string; desc: string }> = {
  regular: { led: 'led-green', desc: 'Unleaded 87' },
  premium: { led: 'led-amber', desc: 'Unleaded 91-93' },
  diesel:  { led: 'led-gray',  desc: 'Diesel #2' },
};

interface Props {
  isOpen: boolean;
  mode?: 'create' | 'edit';
  form: FuelFormState;
  onChange: (form: FuelFormState) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  /** Optional: fires when the user clicks "Remove receipt" on an existing entry. */
  onRemoveReceipt?: () => void;
  /** Optional: if the entry already has warnings (from detectFuelLogFlags on save), surface them. */
  flagWarnings?: string[];
  /** v2: optional attribution dropdowns. Omit either prop to hide the section. */
  drivers?: DriverOption[];
  fuelCards?: FuelCardOption[];
  /** Current vehicle ID — used to auto-prefer its assigned card in the dropdown. */
  currentVehicleId?: number | string | null;
}

export default function FuelLogModal({
  isOpen, mode = 'create', form, onChange, onSave, onClose, saving,
  onRemoveReceipt, flagWarnings,
  drivers, fuelCards, currentVehicleId,
}: Props) {
  const titleId = useId();
  const receiptInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  const setField = (field: keyof FuelFormState, value: string) => {
    const updated = { ...form, [field]: value };
    // Auto-compute total_cost when gallons or cost_per_gallon change
    if ((field === 'gallons' || field === 'cost_per_gallon') && updated.gallons && updated.cost_per_gallon) {
      const total = parseFloat(updated.gallons) * parseFloat(updated.cost_per_gallon);
      if (!isNaN(total)) {
        // Preserve full precision — round to cents only for display, not storage
        updated.total_cost = String(Math.round(total * 100) / 100);
      }
    }
    onChange(updated);
  };

  const grade = FUEL_GRADE[form.fuel_type] || FUEL_GRADE.regular;

  return (
    <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ background: 'rgba(0,0,0,0.6)' }} onClick={saving ? undefined : onClose}>
      <div className="panel-beveled w-[520px] max-w-full mx-4 max-h-[80vh] flex flex-col bg-surface-raised" onClick={(e) => e.stopPropagation()}>
        <PanelTitleBar title={mode === 'edit' ? 'EDIT FUEL ENTRY' : 'LOG FUEL ENTRY'} icon={Fuel} id={titleId}>
          <button type="button" className="toolbar-btn text-[9px]" onClick={onClose}>X</button>
        </PanelTitleBar>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Date / Time *</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="datetime-local" step="1"
                value={form.fuel_date}
                onChange={(e) => setField('fuel_date', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Fuel Type</label>
              <select className="select-dark w-full text-[11px] min-h-[36px]" value={form.fuel_type}
                onChange={(e) => setField('fuel_type', e.target.value)}>
                {FUEL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <div className="flex items-center gap-2 mt-1">
                <span className={`led-dot ${grade.led}`} />
                <span className="text-[8px] text-rmpg-500 uppercase">{grade.desc}</span>
              </div>
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Gallons *</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.001" value={form.gallons}
                onChange={(e) => setField('gallons', e.target.value)} placeholder="e.g. 15.500" />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Cost per Gallon ($)</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.001" value={form.cost_per_gallon}
                onChange={(e) => setField('cost_per_gallon', e.target.value)} placeholder="e.g. 3.450" />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Total Cost ($)</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.01" value={form.total_cost}
                onChange={(e) => setField('total_cost', e.target.value)} />
            </div>
            <div>
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Odometer Reading</label>
              <input className="input-dark w-full text-[11px] font-mono min-h-[36px]" type="number" step="0.1" value={form.odometer_reading}
                onChange={(e) => setField('odometer_reading', e.target.value)} />
            </div>

            {/* Live Cost Calculator */}
            {(form.gallons || form.cost_per_gallon) && (
              <div className="col-span-2 panel-beveled p-2.5 flex items-center justify-between bg-surface-sunken">
                <div className="flex items-center gap-3 text-[10px] font-mono">
                  <DollarSign className="w-3 h-3 text-green-500" />
                  <span className="text-rmpg-400">{form.gallons || '0.000'} gal</span>
                  <span className="text-rmpg-500">&times;</span>
                  <span className="text-rmpg-400">${form.cost_per_gallon || '0.000'}/gal</span>
                  <span className="text-rmpg-500">=</span>
                  <span className="text-green-400 font-bold text-xs">${form.total_cost || '0.00'}</span>
                </div>
                <span className="text-[8px] text-rmpg-500 uppercase tracking-wider">Computed Total</span>
              </div>
            )}

            <div className="col-span-2">
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Station</label>
              <input className="input-dark w-full text-[11px] min-h-[36px]" value={form.station}
                onChange={(e) => setField('station', e.target.value)} placeholder="e.g. Shell - Main St" />
            </div>

            {/* v2: attribution — optional driver + fuel card dropdowns.
                Only render the section when the caller supplies at least one
                of these lists, so legacy consumers (e.g. the CSV import
                preview) don't see empty pickers. */}
            {(drivers || fuelCards) && (
              <>
                {drivers && (
                  <div>
                    <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Driver Officer</label>
                    <select className="select-dark w-full text-[11px] min-h-[36px]"
                      value={form.driver_officer_id || ''}
                      onChange={(e) => onChange({ ...form, driver_officer_id: e.target.value })}>
                      <option value="">— unassigned —</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.full_name || d.username || `user-${d.id}`}{d.badge ? ` (${d.badge})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {fuelCards && (
                  <div>
                    <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Fuel Card</label>
                    <select className="select-dark w-full text-[11px] min-h-[36px]"
                      value={form.fuel_card_id || ''}
                      onChange={(e) => onChange({ ...form, fuel_card_id: e.target.value })}>
                      <option value="">— no card —</option>
                      {/* Preferred assignment first so the auto-matching card
                          appears at the top of the list, with a "★" marker. */}
                      {fuelCards
                        .slice()
                        .sort((a, b) => {
                          const aPreferred = currentVehicleId != null && String(a.vehicle_id) === String(currentVehicleId) ? 0 : 1;
                          const bPreferred = currentVehicleId != null && String(b.vehicle_id) === String(currentVehicleId) ? 0 : 1;
                          if (aPreferred !== bPreferred) return aPreferred - bPreferred;
                          return String(a.card_number).localeCompare(String(b.card_number));
                        })
                        .map((c) => {
                          const preferred = currentVehicleId != null && String(c.vehicle_id) === String(currentVehicleId);
                          return (
                            <option key={c.id} value={c.id}>
                              {preferred ? '★ ' : ''}{c.card_number}{c.provider ? ` · ${c.provider}` : ''}{c.status && c.status !== 'active' ? ` · ${c.status}` : ''}
                            </option>
                          );
                        })}
                    </select>
                  </div>
                )}
              </>
            )}

            {/* Receipt attachment — image or PDF, stored on the server after save */}
            <div className="col-span-2">
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5 flex items-center gap-1">
                <Paperclip className="w-2.5 h-2.5" /> Receipt (image or PDF, max 10 MB)
              </label>
              {form.receiptFile ? (
                <div className="panel-beveled bg-surface-sunken p-2 flex items-center gap-2">
                  {form.receiptFile.type.startsWith('image/')
                    ? <ImageIcon className="w-3 h-3 text-cyan-400" />
                    : <FileText className="w-3 h-3 text-cyan-400" />}
                  <span className="text-[10px] font-mono text-rmpg-300 truncate flex-1">{form.receiptFile.name}</span>
                  <span className="text-[9px] text-rmpg-500">{(form.receiptFile.size / 1024).toFixed(0)} KB</span>
                  <button type="button" className="p-0.5 text-rmpg-500 hover:text-red-400"
                    onClick={() => onChange({ ...form, receiptFile: null })}
                    title="Remove staged receipt">
                    <XIcon className="w-3 h-3" />
                  </button>
                </div>
              ) : form.existingReceipt ? (
                <div className="panel-beveled bg-surface-sunken p-2 flex items-center gap-2">
                  <Paperclip className="w-3 h-3 text-green-400" />
                  <span className="text-[10px] text-rmpg-300 flex-1">Receipt attached</span>
                  <button type="button" className="toolbar-btn text-[9px]"
                    onClick={() => receiptInputRef.current?.click()}>Replace</button>
                  {onRemoveReceipt && (
                    <button type="button" className="p-0.5 text-rmpg-500 hover:text-red-400"
                      onClick={onRemoveReceipt} title="Remove receipt">
                      <XIcon className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ) : (
                <button type="button"
                  className="w-full panel-beveled bg-surface-sunken border-dashed p-2 flex items-center justify-center gap-2 text-[10px] text-rmpg-500 hover:text-brand-400 transition-colors"
                  onClick={() => receiptInputRef.current?.click()}>
                  <Paperclip className="w-3 h-3" />
                  <span>Attach receipt image or PDF</span>
                </button>
              )}
              <input
                ref={receiptInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onChange({ ...form, receiptFile: f });
                  if (receiptInputRef.current) receiptInputRef.current.value = '';
                }}
              />
            </div>

            <div className="col-span-2">
              <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-0.5">Notes</label>
              <textarea className="input-dark w-full text-[10px] h-14 resize-none min-h-[36px]" value={form.notes}
                onChange={(e) => setField('notes', e.target.value)} maxLength={2000} />
              <div className="text-[8px] text-rmpg-500 text-right mt-0.5">{form.notes.length}/2000</div>
            </div>

            {/* Flag warnings — server flagged this entry on save as a possible outlier */}
            {flagWarnings && flagWarnings.length > 0 && (
              <div className="col-span-2 panel-beveled p-2 border border-amber-700/40 bg-amber-900/20">
                <div className="text-[9px] text-amber-400 font-bold uppercase mb-1">Warnings ({flagWarnings.length})</div>
                <ul className="text-[10px] text-amber-300 space-y-0.5 list-disc list-inside">
                  {flagWarnings.map((w, i) => <li key={i} className="font-mono">{w}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button type="button" className="toolbar-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={onSave} disabled={saving || !form.fuel_date || !form.gallons}>
            {saving ? 'Saving...' : mode === 'edit' ? 'Update Fuel' : 'Log Fuel'}
          </button>
        </div>
      </div>
    </div>
  );
}

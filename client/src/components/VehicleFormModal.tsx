import React, { useState, useEffect, useRef } from 'react';
import { Car, Loader2 } from 'lucide-react';
import FormModal from './FormModal';
import FormField from './records/FormField';
import { useFormDraft } from '../hooks/useFormDraft';
import type { Vehicle } from '../types';
import AddressAutocomplete from './AddressAutocomplete';
import { formatPhoneInput } from '../utils/formatters';
import { apiFetch } from '../hooks/useApi';
import ConfirmDialog from './ConfirmDialog';
import { useToastSafe } from './ToastProvider';

import RichTextArea from './RichTextArea';
import { composeAddressUnit, splitAddressUnit } from '../utils/addressUnit';
import {
  VEHICLE_BODY_STYLE_OPTIONS, VEHICLE_COLOR_OPTIONS,
  VEHICLE_FUEL_OPTIONS, VEHICLE_TRANSMISSION_OPTIONS,
  VEHICLE_DRIVE_OPTIONS, VEHICLE_USE_OPTIONS,
  PLATE_TYPE_OPTIONS, STOLEN_STATUS_OPTIONS,
  TOW_STATUS_OPTIONS, TITLE_STATUS_OPTIONS,
  VEHICLE_CONDITION_OPTIONS,
} from '../constants/lawEnforcementEnums';

const VEHICLE_FLAG_OPTIONS = [
  'BOLO', 'Warrant', 'Known Offender', 'Mental Health', 'Trespass Warning',
  'Violent History', 'Drug History', 'Gang Affiliated', 'Officer Safety',
];
interface VehicleFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: VehicleFormData) => void;
  isSubmitting: boolean;
  editingVehicle?: Vehicle;
  submitError?: string | null;
}

export interface VehicleFormData {
  plate_number: string;
  state: string;
  make: string;
  model: string;
  year: string;
  color: string;
  secondary_color: string;
  body_style: string;
  doors: string;
  vin: string;
  insurance_company: string;
  insurance_policy: string;
  registration_expiry: string;
  damage_description: string;
  distinguishing_features: string;
  trim: string;
  engine_type: string;
  fuel_type: string;
  transmission: string;
  drive_type: string;
  tow_status: string;
  tow_company: string;
  tow_date: string;
  plate_type: string;
  commercial_vehicle: boolean;
  hazmat: boolean;
  odometer: string;
  owner_address: string;
  owner_phone: string;
  lien_holder: string;
  stolen_status: string;
  stolen_date: string;
  recovery_date: string;
  notes: string;
  title_status: string;
  exterior_condition: string;
  interior_condition: string;
  estimated_value: string;
  window_tint: string;
  modifications: string;
  equipment_notes: string;
  owner_name: string;
  registered_owner: string;
  registration_state: string;
  insurance_expiry: string;
  owner_dob: string;
  owner_dl_number: string;
  tow_location: string;
  ncic_entry_number: string;
  primary_driver_name: string;
  vehicle_use: string;
  flags: string[];
  tow_lot_location: string;
  tow_release_date: string;
  tow_release_to: string;
  tow_reason: string;
}

const EMPTY_FORM: VehicleFormData = {
  plate_number: '',
  state: 'UT',
  make: '',
  model: '',
  year: '',
  color: '',
  secondary_color: '',
  body_style: '',
  doors: '',
  vin: '',
  insurance_company: '',
  insurance_policy: '',
  registration_expiry: '',
  damage_description: '',
  distinguishing_features: '',
  trim: '',
  engine_type: '',
  fuel_type: '',
  transmission: '',
  drive_type: '',
  tow_status: '',
  tow_company: '',
  tow_date: '',
  plate_type: '',
  commercial_vehicle: false,
  hazmat: false,
  odometer: '',
  owner_address: '',
  owner_phone: '',
  lien_holder: '',
  stolen_status: '',
  stolen_date: '',
  recovery_date: '',
  notes: '',
  title_status: '',
  exterior_condition: '',
  interior_condition: '',
  estimated_value: '',
  window_tint: '',
  modifications: '',
  equipment_notes: '',
  owner_name: '',
  registered_owner: '',
  registration_state: '',
  insurance_expiry: '',
  owner_dob: '',
  owner_dl_number: '',
  tow_location: '',
  ncic_entry_number: '',
  primary_driver_name: '',
  vehicle_use: '',
  flags: [],
  tow_lot_location: '',
  tow_release_date: '',
  tow_release_to: '',
  tow_reason: '',
};

// US_STATES and COMMON_MAKES kept local — broad reference data
// not specific to LE workflows. ENGINE_OPTIONS and WINDOW_TINT_OPTIONS
// also stay local; F2 module focuses on NCIC/NIBRS-aligned values
// and these are vehicle-mechanical, not enforcement classifications.
//
// Body style, color, fuel, transmission, drive, vehicle use, plate
// type, stolen status, tow status, title status, condition — all
// migrated to client/src/constants/lawEnforcementEnums.ts (richer
// NCIC option lists, single source of truth across modals).
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
  'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

const COMMON_MAKES = [
  'Acura','Audi','BMW','Buick','Cadillac','Chevrolet','Chrysler','Dodge','Fiat','Ford',
  'GMC','Honda','Hyundai','Infiniti','Jaguar','Jeep','Kia','Land Rover','Lexus','Lincoln',
  'Mazda','Mercedes-Benz','Mini','Mitsubishi','Nissan','Porsche','Ram','Subaru','Tesla',
  'Toyota','Volkswagen','Volvo','Other',
];

const ENGINE_OPTIONS = ['4-Cylinder', 'V6', 'V8', 'V10', 'V12', 'Electric', 'Hybrid', 'Diesel', 'Rotary', 'Other'];
const WINDOW_TINT_OPTIONS = ['None', 'Factory', 'Light (50%+)', 'Medium (35-50%)', 'Dark (20-35%)', 'Limo (5-20%)', 'Illegal (<5%)', 'Unknown'];

export default function VehicleFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  editingVehicle,
  submitError,
}: VehicleFormModalProps) {
  const {
    form,
    setForm,
    isDirty,
    wasRestored,
    clearDraft,
    signalSaved,
    snapshot,
  } = useFormDraft<VehicleFormData>({
    storageKey: `rmpg_vehicle_form_${editingVehicle?.id ?? 'new'}`,
    defaultValue: EMPTY_FORM,
    isActive: isOpen,
  });
  const [activeSection, setActiveSection] = useState<'vehicle' | 'mechanical' | 'registration' | 'condition'>('vehicle');

  useEffect(() => {
    if (isOpen) {
      setActiveSection('vehicle');
      if (editingVehicle) {
        const initial: VehicleFormData = {
          plate_number: editingVehicle.license_plate || '',
          state: editingVehicle.plate_state || 'UT',
          make: editingVehicle.make || '',
          model: editingVehicle.model || '',
          year: editingVehicle.year ? String(editingVehicle.year) : '',
          color: editingVehicle.color || '',
          secondary_color: editingVehicle.secondary_color || '',
          body_style: editingVehicle.body_style || '',
          doors: editingVehicle.doors ? String(editingVehicle.doors) : '',
          vin: editingVehicle.vin || '',
          insurance_company: editingVehicle.insurance_company || '',
          insurance_policy: editingVehicle.insurance_policy || '',
          registration_expiry: editingVehicle.registration_expiry || '',
          damage_description: editingVehicle.damage_description || '',
          distinguishing_features: editingVehicle.distinguishing_features || '',
          trim: editingVehicle.trim || '',
          engine_type: editingVehicle.engine_type || '',
          fuel_type: editingVehicle.fuel_type || '',
          transmission: editingVehicle.transmission || '',
          drive_type: editingVehicle.drive_type || '',
          tow_status: editingVehicle.tow_status || '',
          tow_company: editingVehicle.tow_company || '',
          tow_date: editingVehicle.tow_date || '',
          plate_type: editingVehicle.plate_type || '',
          commercial_vehicle: editingVehicle.commercial_vehicle || false,
          hazmat: editingVehicle.hazmat || false,
          odometer: editingVehicle.odometer || '',
          owner_address: editingVehicle.owner_address || '',
          owner_phone: editingVehicle.owner_phone || '',
          lien_holder: editingVehicle.lien_holder || '',
          stolen_status: editingVehicle.stolen_status || '',
          stolen_date: editingVehicle.stolen_date || '',
          recovery_date: editingVehicle.recovery_date || '',
          notes: editingVehicle.notes || '',
          title_status: editingVehicle.title_status || '',
          exterior_condition: editingVehicle.exterior_condition || '',
          interior_condition: editingVehicle.interior_condition || '',
          estimated_value: editingVehicle.estimated_value || '',
          window_tint: editingVehicle.window_tint || '',
          modifications: editingVehicle.modifications || '',
          equipment_notes: editingVehicle.equipment_notes || '',
          owner_name: editingVehicle.owner_name || '',
          registered_owner: editingVehicle.registered_owner || '',
          registration_state: editingVehicle.registration_state || '',
          insurance_expiry: editingVehicle.insurance_expiry || '',
          owner_dob: editingVehicle.owner_dob || '',
          owner_dl_number: editingVehicle.owner_dl_number || '',
          tow_location: editingVehicle.tow_location || '',
          ncic_entry_number: editingVehicle.ncic_entry_number || '',
          primary_driver_name: editingVehicle.primary_driver_name || '',
          vehicle_use: editingVehicle.vehicle_use || '',
          flags: Array.isArray(editingVehicle.flags)
            ? editingVehicle.flags.map((f: any) => typeof f === 'object' ? f.type : f)
            : [],
          tow_lot_location: (editingVehicle as any).tow_lot_location || '',
          tow_release_date: (editingVehicle as any).tow_release_date || '',
          tow_release_to: (editingVehicle as any).tow_release_to || '',
          tow_reason: (editingVehicle as any).tow_reason || '',
        };
        // Split stored "123 Main St #2B" back into street + unit fields
        const { street, unit } = splitAddressUnit(editingVehicle.owner_address || '');
        initial.owner_address = street;
        setOwnerAddressUnit(unit);
        setForm(initial);
        snapshot();
      } else {
        setForm(EMPTY_FORM);
        snapshot();
      }
    }
  }, [isOpen, editingVehicle, snapshot]);

  const [ownerAddressUnit, setOwnerAddressUnit] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ year?: string; vin?: string }>({});
  const [showNcicReminder, setShowNcicReminder] = useState(false);
  const [vinDecoding, setVinDecoding] = useState(false);
  const [dupPlateOpen, setDupPlateOpen] = useState(false);
  const toast = useToastSafe();
  const ncicFieldRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      setForm((prev) => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setForm((prev) => {
        const next = { ...prev, [name]: value };
        if (name === 'body_style' && !prev.doors) {
          const m = value.match(/(\d+)-Door/i);
          if (m) next.doors = m[1];
        }
        if (name === 'stolen_status') {
          const isActiveStolen = value === 'Stolen' || value === 'Active';
          if (isActiveStolen && !prev.ncic_entry_number) {
            setShowNcicReminder(true);
            setTimeout(() => {
              ncicFieldRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
              ncicFieldRef.current?.focus();
            }, 100);
          } else {
            setShowNcicReminder(false);
          }
        }
        if (name === 'ncic_entry_number' && value) {
          setShowNcicReminder(false);
        }
        return next;
      });
    }
    if (name === 'year' || name === 'vin') {
      setFieldErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleFlagToggle = (flag: string) => {
    setForm((prev) => {
      const next = prev.flags.includes(flag)
        ? prev.flags.filter((f) => f !== flag)
        : [...prev.flags, flag];
      return { ...prev, flags: next };
    });
  };

  const handleVinDecode = async () => {
    if (!form.vin || form.vin.length !== 17) return;
    setVinDecoding(true);
    try {
      const result = await apiFetch<any>(`/records/vehicles/decode-vin?vin=${encodeURIComponent(form.vin)}`);
      if (result) {
        setForm((prev) => ({
          ...prev,
          make: result.make || prev.make,
          model: result.model || prev.model,
          year: result.year ? String(result.year) : prev.year,
          body_style: result.body_style || prev.body_style,
          fuel_type: result.fuel_type || prev.fuel_type,
          trim: result.trim || prev.trim,
        }));
      }
    } catch { /* ignore decode errors */ } finally {
      setVinDecoding(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: { year?: string; vin?: string } = {};
    if (form.year) {
      const yearNum = parseInt(form.year, 10);
      if (isNaN(yearNum) || yearNum < 1900 || yearNum > 2030) {
        errs.year = 'Year must be between 1900 and 2030.';
      }
    }
    if (form.vin && form.vin.length !== 17) {
      errs.vin = `VIN must be exactly 17 characters (currently ${form.vin.length}).`;
    }
    if (errs.year || errs.vin) {
      setFieldErrors(errs);
      // Scroll the first invalid field into view + focus it.
      const firstBadName = errs.year ? 'year' : 'vin';
      const el = document.querySelector<HTMLElement>(`[name="${firstBadName}"], [id="${firstBadName}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      (el as HTMLInputElement | null)?.focus?.();
      return;
    }
    setFieldErrors({});
    if (!editingVehicle && form.plate_number) {
      try {
        const existing = await apiFetch<any[]>(
          `/records/vehicles/plate-lookup?plate=${encodeURIComponent(form.plate_number)}${form.state ? `&state=${encodeURIComponent(form.state)}` : ''}`
        );
        if (Array.isArray(existing) && existing.length > 0) {
          setDupPlateOpen(true);
          return;
        }
      } catch {
        toast?.addToast('Could not check for an existing plate. You can still create the record.', 'warning');
      }
    }
    signalSaved();
    onSubmit({ ...form, owner_address: composeAddressUnit(form.owner_address, ownerAddressUnit) });
  };

  const submitAfterDupConfirm = () => {
    setDupPlateOpen(false);
    signalSaved();
    onSubmit({ ...form, owner_address: composeAddressUnit(form.owner_address, ownerAddressUnit) });
  };

  return (
    <>
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title={editingVehicle ? 'Edit Vehicle' : 'New Vehicle'}
      icon={Car}
      submitLabel={editingVehicle ? 'Update' : 'Create'}
      isSubmitting={isSubmitting}
      maxWidth="max-w-3xl"
      isDirty={isDirty}
      draftRestored={wasRestored}
      onDiscardDraft={clearDraft}
    >
      {/* Submit Error */}
      {submitError && (
        <div className="px-3 py-2 -mt-2 mb-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">
          {submitError}
        </div>
      )}

      {/* Inline validation errors (year, VIN). Surfaces the silent
          handleSubmit returns the operator was previously hitting blind. */}
      {(fieldErrors.year || fieldErrors.vin) && (
        <div className="px-3 py-2 -mt-2 mb-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">
          <div className="font-semibold mb-1">Please fix:</div>
          <ul className="list-disc pl-4 space-y-0.5">
            {fieldErrors.year ? <li><span className="font-mono">year</span> — {fieldErrors.year}</li> : null}
            {fieldErrors.vin ? <li><span className="font-mono">vin</span> — {fieldErrors.vin}</li> : null}
          </ul>
        </div>
      )}

      {/* Section Tabs */}
      <div className="flex gap-1 -mt-2 mb-3 border-b border-rmpg-700 pb-2">
        {[
          { id: 'vehicle' as const, label: 'Vehicle Info' },
          { id: 'mechanical' as const, label: 'Mechanical' },
          { id: 'registration' as const, label: 'Registration' },
          { id: 'condition' as const, label: 'Condition' },
        ].map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveSection(s.id)}
            className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
              activeSection === s.id
                ? 'text-red-400 bg-red-900/20 border border-red-700/40'
                : 'text-fg-muted hover:text-fg-primary hover:bg-rmpg-700/40 border border-transparent'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {activeSection === 'vehicle' && (
        <>
          {/* Plate / State */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Plate Number">
              <input name="plate_number" type="text" required className="input-dark mt-1" value={form.plate_number} onChange={handleChange} />
            </FormField>
            <FormField label="State">
              <select name="state" className="select-dark mt-1" value={form.state} onChange={handleChange}>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </FormField>
          </div>

          {/* Make / Model / Year / Body */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <FormField label="Make">
              <select name="make" className="select-dark mt-1" value={form.make} onChange={handleChange}>
                <option value="">-- Select --</option>
                {COMMON_MAKES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </FormField>
            <FormField label="Model">
              <input name="model" type="text" required className="input-dark mt-1" value={form.model} onChange={handleChange} />
            </FormField>
            <FormField label="Year">
              <input name="year" type="number" min="1900" max="2030" className="input-dark mt-1" placeholder="e.g. 2024" value={form.year} onChange={handleChange} />
            </FormField>
            <FormField label="Body Style">
              <select name="body_style" className="select-dark mt-1" value={form.body_style} onChange={handleChange}>
                <option value="">-- Select --</option>
                {VEHICLE_BODY_STYLE_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </FormField>
          </div>

          {/* Color / Secondary Color / Doors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="Primary Color">
              <select name="color" className="select-dark mt-1" value={form.color} onChange={handleChange}>
                <option value="">-- Select --</option>
                {VEHICLE_COLOR_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </FormField>
            <FormField label="Secondary Color">
              <select name="secondary_color" className="select-dark mt-1" value={form.secondary_color} onChange={handleChange}>
                <option value="">None</option>
                {VEHICLE_COLOR_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </FormField>
            <FormField label="Doors">
              <select name="doors" className="select-dark mt-1" value={form.doors} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="2">2 Door</option>
                <option value="3">3 Door</option>
                <option value="4">4 Door</option>
                <option value="5">5 Door</option>
              </select>
            </FormField>
          </div>

          {/* VIN */}
          <FormField label="VIN">
            <div className="flex gap-2">
              <input name="vin" type="text" required maxLength={17} className="input-dark mt-1 font-mono uppercase flex-1" placeholder="17-character VIN" value={form.vin} onChange={handleChange} pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{17}" title="VIN must be 17 alphanumeric characters (no I, O, or Q)" />
              <button type="button" onClick={handleVinDecode} disabled={vinDecoding || form.vin.length !== 17} className="mt-1 px-2 py-1 text-[9px] font-bold bg-surface-raised border border-rmpg-600 text-fg-secondary hover:text-fg-primary hover:border-brand-500/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center gap-1">
                {vinDecoding ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Decode
              </button>
            </div>
          </FormField>
        </>
      )}

      {activeSection === 'mechanical' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="Trim / Package">
              <input name="trim" type="text" className="input-dark mt-1" placeholder="e.g. LX, Sport, Limited" value={form.trim} onChange={handleChange} />
            </FormField>
            <FormField label="Engine Type">
              <select name="engine_type" className="select-dark mt-1" value={form.engine_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                {ENGINE_OPTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </FormField>
            <FormField label="Fuel Type">
              <select name="fuel_type" className="select-dark mt-1" value={form.fuel_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                {VEHICLE_FUEL_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="Transmission">
              <select name="transmission" className="select-dark mt-1" value={form.transmission} onChange={handleChange}>
                <option value="">-- Select --</option>
                {VEHICLE_TRANSMISSION_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </FormField>
            <FormField label="Drive Type">
              <select name="drive_type" className="select-dark mt-1" value={form.drive_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                {VEHICLE_DRIVE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </FormField>
            <FormField label="Odometer">
              <input name="odometer" type="text" className="input-dark mt-1" placeholder="e.g. 45,230 mi" value={form.odometer} onChange={handleChange} />
            </FormField>
          </div>
        </>
      )}

      {activeSection === 'registration' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="Plate Type">
              <select name="plate_type" className="select-dark mt-1" value={form.plate_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                {PLATE_TYPE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </FormField>
            <FormField label="Registration Expiry">
              <input name="registration_expiry" type="date" className="input-dark mt-1" value={form.registration_expiry} onChange={handleChange} />
            </FormField>
            <FormField label="Lien Holder">
              <input name="lien_holder" type="text" className="input-dark mt-1" placeholder="Bank or finance company" value={form.lien_holder} onChange={handleChange} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="Title Status">
              <select name="title_status" className="select-dark mt-1" value={form.title_status} onChange={handleChange}>
                <option value="">-- Select --</option>
                {TITLE_STATUS_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </FormField>
            <FormField label="Registration State">
              <select name="registration_state" className="select-dark mt-1" value={form.registration_state} onChange={handleChange}>
                <option value="">-- Select --</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </FormField>
            <FormField label="Estimated Value">
              <input name="estimated_value" type="text" className="input-dark mt-1" placeholder="$" value={form.estimated_value} onChange={handleChange} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Insurance Company">
              <input name="insurance_company" type="text" className="input-dark mt-1" value={form.insurance_company} onChange={handleChange} />
            </FormField>
            <FormField label="Policy Number">
              <input name="insurance_policy" type="text" className="input-dark mt-1" value={form.insurance_policy} onChange={handleChange} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="Insurance Expiry">
              <input name="insurance_expiry" type="date" className="input-dark mt-1" value={form.insurance_expiry} onChange={handleChange} />
            </FormField>
            <FormField label="Vehicle Use">
              <select name="vehicle_use" className="select-dark mt-1" value={form.vehicle_use} onChange={handleChange}>
                <option value="">-- Select --</option>
                {VEHICLE_USE_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </FormField>
            <FormField label="Primary Driver">
              <input name="primary_driver_name" type="text" className="input-dark mt-1" placeholder="Name of primary driver" value={form.primary_driver_name} onChange={handleChange} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="NCIC Entry #">
              <input ref={ncicFieldRef} name="ncic_entry_number" type="text" className="input-dark mt-1" placeholder="NCIC stolen vehicle entry number" value={form.ncic_entry_number} onChange={handleChange} />
              {showNcicReminder && (
                <p className="mt-1 text-[9px] text-amber-400 bg-amber-900/20 border border-amber-700/40 px-2 py-1">Remember to enter NCIC entry number</p>
              )}
            </FormField>
          </div>

          <div className="border-t border-rmpg-700 pt-3">
            <label htmlFor="ff-vehicleformmodal-addrunit" className="text-[10px] text-fg-muted uppercase font-semibold mb-2 block">Owner Information</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Owner Name">
                <input name="owner_name" type="text" className="input-dark mt-1" placeholder="Vehicle owner name" value={form.owner_name} onChange={handleChange} />
              </FormField>
              <FormField label="Registered Owner">
                <input name="registered_owner" type="text" className="input-dark mt-1" placeholder="Registered owner (if different)" value={form.registered_owner} onChange={handleChange} />
              </FormField>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-3">
              <FormField label="Owner Address">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <AddressAutocomplete
                      name="owner_address"
                      className="input-dark mt-1"
                      placeholder="Owner address"
                      value={form.owner_address}
                      onChange={(val) => setForm((prev) => ({ ...prev, owner_address: val }))}
                      onSelect={(addr) => setForm((prev) => ({ ...prev, owner_address: addr.formatted || addr.street }))}
                    />
                  </div>
                  <input
                    id="ff-vehicleformmodal-addrunit" type="text"
                    className="input-dark mt-1 w-20" value={ownerAddressUnit}
                    onChange={(e) => setOwnerAddressUnit(e.target.value)}
                    placeholder="Apt #" aria-label="Owner address apartment or unit"
                  />
                </div>
              </FormField>
              <FormField label="Owner Phone">
                <input name="owner_phone" type="tel" className="input-dark mt-1" value={form.owner_phone} onChange={(e) => setForm(prev => ({ ...prev, owner_phone: formatPhoneInput(e.target.value) }))} placeholder="(801) 555-1234" pattern="[0-9\(\)\-\s+]{7,20}" />
              </FormField>
              <FormField label="Owner Date of Birth">
                <input name="owner_dob" type="date" className="input-dark mt-1" value={form.owner_dob} onChange={handleChange} />
              </FormField>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
              <FormField label="Owner DL #">
                <input name="owner_dl_number" type="text" className="input-dark mt-1" placeholder="Owner's driver license number" value={form.owner_dl_number} onChange={handleChange} />
              </FormField>
            </div>
          </div>

          <div className="border-t border-rmpg-700 pt-3">
            <label className="text-[10px] text-red-400 uppercase font-semibold mb-2 block">Stolen / Tow Status</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <FormField label="Stolen Status">
                <select name="stolen_status" className="select-dark mt-1" value={form.stolen_status} onChange={handleChange}>
                  <option value="">-- Select --</option>
                  {STOLEN_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </FormField>
              <FormField label="Stolen Date">
                <input name="stolen_date" type="date" className="input-dark mt-1" value={form.stolen_date} onChange={handleChange} />
              </FormField>
              <FormField label="Recovery Date">
                <input name="recovery_date" type="date" className="input-dark mt-1" value={form.recovery_date} onChange={handleChange} />
              </FormField>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-3">
              <FormField label="Tow Status">
                <select name="tow_status" className="select-dark mt-1" value={form.tow_status} onChange={handleChange}>
                  <option value="">-- Select --</option>
                  {TOW_STATUS_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </FormField>
              <FormField label="Tow Company">
                <input name="tow_company" type="text" className="input-dark mt-1" value={form.tow_company} onChange={handleChange} />
              </FormField>
              <FormField label="Tow Date">
                <input name="tow_date" type="date" className="input-dark mt-1" value={form.tow_date} onChange={handleChange} />
              </FormField>
            </div>
            <FormField label="Tow Location / Impound Lot" className="mt-3">
              <input name="tow_location" type="text" className="input-dark mt-1" placeholder="Where vehicle was towed / impounded" value={form.tow_location} onChange={handleChange} />
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-3">
              <FormField label="Tow Lot Location">
                <input name="tow_lot_location" type="text" className="input-dark mt-1" placeholder="Lot name or address" value={form.tow_lot_location} onChange={handleChange} />
              </FormField>
              <FormField label="Tow Release Date">
                <input name="tow_release_date" type="date" className="input-dark mt-1" value={form.tow_release_date} onChange={handleChange} />
              </FormField>
              <FormField label="Tow Release To">
                <input name="tow_release_to" type="text" className="input-dark mt-1" placeholder="Released to (name)" value={form.tow_release_to} onChange={handleChange} />
              </FormField>
            </div>
            <FormField label="Tow Reason" className="mt-3">
              <input name="tow_reason" type="text" className="input-dark mt-1" placeholder="Reason for tow" value={form.tow_reason} onChange={handleChange} />
            </FormField>
          </div>

          <div className="flex items-center gap-6 py-2">
            <label className="flex items-center gap-2 text-xs text-fg-secondary cursor-pointer">
              <input type="checkbox" name="commercial_vehicle" checked={form.commercial_vehicle} onChange={handleChange}
                className="w-4 h-4 bg-rmpg-800 border-rmpg-600 text-brand-500 focus:ring-brand-500" />
              Commercial Vehicle
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-secondary cursor-pointer">
              <input type="checkbox" name="hazmat" checked={form.hazmat} onChange={handleChange}
                className="w-4 h-4 bg-rmpg-800 border-rmpg-600 text-red-600 focus:ring-red-500" />
              HAZMAT
            </label>
          </div>
        </>
      )}

      {activeSection === 'condition' && (
        <>
          {/* Flags */}
          <div className="border-b border-rmpg-700 pb-3 mb-3">
            <label className="text-[10px] text-red-400 uppercase font-semibold mb-2 block">Flags</label>
            <div className="flex flex-wrap gap-1.5">
              {VEHICLE_FLAG_OPTIONS.map((flag) => {
                const active = form.flags.includes(flag);
                return (
                  <button
                    key={flag}
                    type="button"
                    onClick={() => handleFlagToggle(flag)}
                    className={`px-2 py-0.5 text-[9px] font-bold border transition-colors ${
                      active
                        ? 'bg-red-900/40 border-red-600/60 text-red-300'
                        : 'bg-transparent border-rmpg-700 text-fg-muted hover:border-rmpg-500 hover:text-fg-secondary'
                    }`}
                  >
                    {flag}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Condition Dropdowns */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="Exterior Condition">
              <select name="exterior_condition" className="select-dark mt-1" value={form.exterior_condition} onChange={handleChange}>
                <option value="">-- Select --</option>
                {VEHICLE_CONDITION_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </FormField>
            <FormField label="Interior Condition">
              <select name="interior_condition" className="select-dark mt-1" value={form.interior_condition} onChange={handleChange}>
                <option value="">-- Select --</option>
                {VEHICLE_CONDITION_OPTIONS.map((c) => <option key={`int-${c}`} value={c}>{c}</option>)}
              </select>
            </FormField>
            <FormField label="Window Tint">
              <select name="window_tint" className="select-dark mt-1" value={form.window_tint} onChange={handleChange}>
                <option value="">-- Select --</option>
                {WINDOW_TINT_OPTIONS.map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </FormField>
          </div>

          {/* Damage / Features */}
          <FormField label="Damage Description">
            <input name="damage_description" type="text" className="input-dark mt-1" placeholder="Dents, scratches, broken glass, etc." value={form.damage_description} onChange={handleChange} />
          </FormField>
          <FormField label="Distinguishing Features">
            <input name="distinguishing_features" type="text" className="input-dark mt-1" placeholder="Bumper stickers, custom rims, tinted windows, etc." value={form.distinguishing_features} onChange={handleChange} />
          </FormField>

          {/* Modifications / Equipment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Modifications">
              <RichTextArea name="modifications" rows={2} className="input-dark mt-1" placeholder="Lift kit, exhaust, aftermarket bumper, etc." value={form.modifications} onChange={handleChange} maxLength={2000} />
            </FormField>
            <FormField label="Equipment Notes">
              <RichTextArea name="equipment_notes" rows={2} className="input-dark mt-1" placeholder="Aftermarket parts, accessories, etc." value={form.equipment_notes} onChange={handleChange} maxLength={2000} />
            </FormField>
          </div>

          {/* Notes */}
          <div>
            <FormField label="Notes">
              <RichTextArea name="notes" rows={3} className="input-dark mt-1" value={form.notes} onChange={handleChange} maxLength={5000} />
            </FormField>
            <div className="text-[9px] text-fg-muted text-right mt-0.5">{form.notes.length}/5000</div>
          </div>
        </>
      )}
    </FormModal>
      <ConfirmDialog
        isOpen={dupPlateOpen}
        onClose={() => setDupPlateOpen(false)}
        onConfirm={submitAfterDupConfirm}
        title="Duplicate plate"
        message={`A vehicle with plate ${form.plate_number} already exists. Create anyway?`}
        confirmLabel="Create anyway"
        confirmVariant="warning"
      />
    </>
  );
}

import React, { useState, useEffect } from 'react';
import { Car } from 'lucide-react';
import FormModal from './FormModal';
import { useFormDirty } from '../hooks/useFormDirty';
import type { Vehicle } from '../types';
import AddressAutocomplete from './AddressAutocomplete';

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
};

const BODY_STYLES = [
  'Sedan', 'Coupe', 'SUV', 'Truck', 'Van', 'Minivan', 'Wagon',
  'Hatchback', 'Convertible', 'Crossover', 'Motorcycle', 'Bus', 'RV', 'Trailer', 'Other',
];

const COLOR_OPTIONS = [
  'Black', 'White', 'Silver', 'Gray', 'Red', 'Blue', 'Green', 'Brown', 'Tan',
  'Gold', 'Orange', 'Yellow', 'Purple', 'Maroon', 'Beige', 'Other',
];

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
const FUEL_OPTIONS = ['Gasoline', 'Diesel', 'Electric', 'Hybrid', 'Flex Fuel', 'Other'];
const TRANSMISSION_OPTIONS = ['Automatic', 'Manual', 'CVT', 'Other'];
const DRIVE_OPTIONS = ['FWD', 'RWD', 'AWD', '4WD'];
const TOW_STATUS_OPTIONS = ['None', 'Towed', 'Impounded', 'Released'];
const PLATE_TYPE_OPTIONS = ['Regular', 'Temporary', 'Dealer', 'Government', 'Military', 'Disabled', 'Other'];
const STOLEN_STATUS_OPTIONS = ['None', 'Stolen', 'Recovered', 'Attempt'];

export default function VehicleFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  editingVehicle,
  submitError,
}: VehicleFormModalProps) {
  const [form, setForm] = useState<VehicleFormData>(EMPTY_FORM);
  const { isDirty, snapshot } = useFormDirty(form, isOpen);
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
        };
        setForm(initial);
        snapshot(initial);
      } else {
        setForm(EMPTY_FORM);
        snapshot(EMPTY_FORM);
      }
    }
  }, [isOpen, editingVehicle]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      setForm((prev) => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  return (
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
    >
      {/* Submit Error */}
      {submitError && (
        <div className="px-3 py-2 -mt-2 mb-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">
          {submitError}
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
                : 'text-rmpg-400 hover:text-white hover:bg-rmpg-700/40 border border-transparent'
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
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Plate Number</label>
              <input name="plate_number" type="text" className="input-dark mt-1" value={form.plate_number} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">State</label>
              <select name="state" className="select-dark mt-1" value={form.state} onChange={handleChange}>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Make / Model / Year / Body */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Make</label>
              <select name="make" className="select-dark mt-1" value={form.make} onChange={handleChange}>
                <option value="">-- Select --</option>
                {COMMON_MAKES.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Model</label>
              <input name="model" type="text" className="input-dark mt-1" value={form.model} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Year</label>
              <input name="year" type="number" min="1900" max="2030" className="input-dark mt-1" placeholder="e.g. 2024" value={form.year} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Body Style</label>
              <select name="body_style" className="select-dark mt-1" value={form.body_style} onChange={handleChange}>
                <option value="">-- Select --</option>
                {BODY_STYLES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>

          {/* Color / Secondary Color / Doors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Primary Color</label>
              <select name="color" className="select-dark mt-1" value={form.color} onChange={handleChange}>
                <option value="">-- Select --</option>
                {COLOR_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Secondary Color</label>
              <select name="secondary_color" className="select-dark mt-1" value={form.secondary_color} onChange={handleChange}>
                <option value="">None</option>
                {COLOR_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Doors</label>
              <select name="doors" className="select-dark mt-1" value={form.doors} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="2">2 Door</option>
                <option value="3">3 Door</option>
                <option value="4">4 Door</option>
                <option value="5">5 Door</option>
              </select>
            </div>
          </div>

          {/* VIN */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">VIN</label>
            <input name="vin" type="text" maxLength={17} className="input-dark mt-1 font-mono uppercase" placeholder="17-character VIN" value={form.vin} onChange={handleChange} pattern="[A-HJ-NPR-Za-hj-npr-z0-9]{17}" title="VIN must be 17 alphanumeric characters (no I, O, or Q)" />
          </div>
        </>
      )}

      {activeSection === 'mechanical' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Trim / Package</label>
              <input name="trim" type="text" className="input-dark mt-1" placeholder="e.g. LX, Sport, Limited" value={form.trim} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Engine Type</label>
              <select name="engine_type" className="select-dark mt-1" value={form.engine_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                {ENGINE_OPTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Fuel Type</label>
              <select name="fuel_type" className="select-dark mt-1" value={form.fuel_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                {FUEL_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Transmission</label>
              <select name="transmission" className="select-dark mt-1" value={form.transmission} onChange={handleChange}>
                <option value="">-- Select --</option>
                {TRANSMISSION_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Drive Type</label>
              <select name="drive_type" className="select-dark mt-1" value={form.drive_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                {DRIVE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Odometer</label>
              <input name="odometer" type="text" className="input-dark mt-1" placeholder="e.g. 45,230 mi" value={form.odometer} onChange={handleChange} />
            </div>
          </div>
        </>
      )}

      {activeSection === 'registration' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Plate Type</label>
              <select name="plate_type" className="select-dark mt-1" value={form.plate_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                {PLATE_TYPE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Registration Expiry</label>
              <input name="registration_expiry" type="date" className="input-dark mt-1" value={form.registration_expiry} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Lien Holder</label>
              <input name="lien_holder" type="text" className="input-dark mt-1" placeholder="Bank or finance company" value={form.lien_holder} onChange={handleChange} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Insurance Company</label>
              <input name="insurance_company" type="text" className="input-dark mt-1" value={form.insurance_company} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Policy Number</label>
              <input name="insurance_policy" type="text" className="input-dark mt-1" value={form.insurance_policy} onChange={handleChange} />
            </div>
          </div>

          <div className="border-t border-rmpg-700 pt-3">
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold mb-2 block">Owner Information</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Owner Address</label>
                <AddressAutocomplete
                  name="owner_address"
                  className="input-dark mt-1"
                  placeholder="Owner address"
                  value={form.owner_address}
                  onChange={(val) => setForm((prev) => ({ ...prev, owner_address: val }))}
                />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Owner Phone</label>
                <input name="owner_phone" type="tel" className="input-dark mt-1" value={form.owner_phone} onChange={handleChange} placeholder="(801) 555-1234" pattern="[0-9()\-\s+]{7,20}" />
              </div>
            </div>
          </div>

          <div className="border-t border-rmpg-700 pt-3">
            <label className="text-[10px] text-red-400 uppercase font-semibold mb-2 block">Stolen / Tow Status</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Stolen Status</label>
                <select name="stolen_status" className="select-dark mt-1" value={form.stolen_status} onChange={handleChange}>
                  <option value="">-- Select --</option>
                  {STOLEN_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Stolen Date</label>
                <input name="stolen_date" type="date" className="input-dark mt-1" value={form.stolen_date} onChange={handleChange} />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Recovery Date</label>
                <input name="recovery_date" type="date" className="input-dark mt-1" value={form.recovery_date} onChange={handleChange} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 mt-3">
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Tow Status</label>
                <select name="tow_status" className="select-dark mt-1" value={form.tow_status} onChange={handleChange}>
                  <option value="">-- Select --</option>
                  {TOW_STATUS_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Tow Company</label>
                <input name="tow_company" type="text" className="input-dark mt-1" value={form.tow_company} onChange={handleChange} />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Tow Date</label>
                <input name="tow_date" type="date" className="input-dark mt-1" value={form.tow_date} onChange={handleChange} />
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6 py-2">
            <label className="flex items-center gap-2 text-xs text-rmpg-200 cursor-pointer">
              <input type="checkbox" name="commercial_vehicle" checked={form.commercial_vehicle} onChange={handleChange}
                className="w-4 h-4 bg-rmpg-800 border-rmpg-600 text-brand-500 focus:ring-brand-500" />
              Commercial Vehicle
            </label>
            <label className="flex items-center gap-2 text-xs text-rmpg-200 cursor-pointer">
              <input type="checkbox" name="hazmat" checked={form.hazmat} onChange={handleChange}
                className="w-4 h-4 bg-rmpg-800 border-rmpg-600 text-red-600 focus:ring-red-500" />
              HAZMAT
            </label>
          </div>
        </>
      )}

      {activeSection === 'condition' && (
        <>
          {/* Damage / Features */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Damage Description</label>
            <input name="damage_description" type="text" className="input-dark mt-1" placeholder="Dents, scratches, broken glass, etc." value={form.damage_description} onChange={handleChange} />
          </div>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Distinguishing Features</label>
            <input name="distinguishing_features" type="text" className="input-dark mt-1" placeholder="Bumper stickers, custom rims, tinted windows, etc." value={form.distinguishing_features} onChange={handleChange} />
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Notes</label>
            <textarea name="notes" rows={3} className="input-dark mt-1" value={form.notes} onChange={handleChange} maxLength={5000} />
            <div className="text-[9px] text-rmpg-500 text-right mt-0.5">{form.notes.length}/5000</div>
          </div>
        </>
      )}
    </FormModal>
  );
}

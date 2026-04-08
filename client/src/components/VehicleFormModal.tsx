import React, { useState, useEffect } from 'react';
import { Car } from 'lucide-react';
import FormModal from './FormModal';
import { useFormDirty } from '../hooks/useFormDirty';
import type { Vehicle } from '../types';
import AddressAutocomplete from './AddressAutocomplete';
import { formatPhoneInput } from '../utils/formatters';

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
  // Appearance
  interior_color: string;
  wrap_or_paint_custom: string;
  license_plate_frame: string;
  window_tint_level: string;
  sunroof: boolean;
  roof_rack: boolean;
  trailer_hitch: boolean;
  lift_kit: boolean;
  lowered: boolean;
  rideshare_sticker: string;
  // Mechanical
  seat_material: string;
  // Registration / Ownership
  registered_owner_name: string;
  registered_owner_dob: string;
  registered_owner_phone: string;
  registered_owner_address: string;
  temporary_plate_expiry: string;
  title_number: string;
  title_status: string;
  registration_status: string;
  registration_state: string;
  insurance_status: string;
  insurance_expiry: string;
  insurance_verified_at: string;
  insurance_verified_by: string;
  insurance_agent_name: string;
  insurance_agent_phone: string;
  insurance_policy_number: string;
  insurance_coverage_type: string;
  insurance_verified_date: string;
  sr22_required: boolean;
  lien_holder_address: string;
  lien_balance: string;
  // Condition — Status & Impound
  last_seen_date: string;
  last_seen_location: string;
  is_stolen: boolean;
  vehicle_alert_code: string;
  impound_status: string;
  impound_date: string;
  impound_lot: string;
  impound_case_number: string;
  repossession_status: string;
  repossession_date: string;
  repossession_company: string;
  rear_bumper_damage: string;
  rust_locations: string;
  // Condition — Tow Information
  tow_reason: string;
  tow_lot_location: string;
  tow_release_date: string;
  tow_release_to: string;
  tow_fee: string;
  tow_driver_name: string;
  tow_company_phone: string;
  storage_fee_daily: string;
  // Condition — Vehicle Condition
  mileage_last_recorded: string;
  mileage_date_recorded: string;
  emissions_status: string;
  emissions_test_date: string;
  catalytic_converter_status: string;
  tire_condition: string;
  brake_condition: string;
  headlight_type: string;
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
  // Appearance
  interior_color: '',
  wrap_or_paint_custom: '',
  license_plate_frame: '',
  window_tint_level: '',
  sunroof: false,
  roof_rack: false,
  trailer_hitch: false,
  lift_kit: false,
  lowered: false,
  rideshare_sticker: '',
  // Mechanical
  seat_material: '',
  // Registration / Ownership
  registered_owner_name: '',
  registered_owner_dob: '',
  registered_owner_phone: '',
  registered_owner_address: '',
  temporary_plate_expiry: '',
  title_number: '',
  title_status: '',
  registration_status: '',
  registration_state: '',
  insurance_status: '',
  insurance_expiry: '',
  insurance_verified_at: '',
  insurance_verified_by: '',
  insurance_agent_name: '',
  insurance_agent_phone: '',
  insurance_policy_number: '',
  insurance_coverage_type: '',
  insurance_verified_date: '',
  sr22_required: false,
  lien_holder_address: '',
  lien_balance: '',
  // Condition — Status & Impound
  last_seen_date: '',
  last_seen_location: '',
  is_stolen: false,
  vehicle_alert_code: '',
  impound_status: '',
  impound_date: '',
  impound_lot: '',
  impound_case_number: '',
  repossession_status: '',
  repossession_date: '',
  repossession_company: '',
  rear_bumper_damage: '',
  rust_locations: '',
  // Condition — Tow Information
  tow_reason: '',
  tow_lot_location: '',
  tow_release_date: '',
  tow_release_to: '',
  tow_fee: '',
  tow_driver_name: '',
  tow_company_phone: '',
  storage_fee_daily: '',
  // Condition — Vehicle Condition
  mileage_last_recorded: '',
  mileage_date_recorded: '',
  emissions_status: '',
  emissions_test_date: '',
  catalytic_converter_status: '',
  tire_condition: '',
  brake_condition: '',
  headlight_type: '',
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
const TRANSMISSION_OPTIONS = ['Automatic', 'Manual', 'CVT', 'Dual-Clutch', 'Unknown', 'Other'];
const DRIVE_OPTIONS = ['FWD', 'RWD', 'AWD', '4WD'];
// Legacy option arrays kept for reference; inline <option> elements used in form now

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
          // Appearance
          interior_color: (editingVehicle as any).interior_color || '',
          wrap_or_paint_custom: (editingVehicle as any).wrap_or_paint_custom || '',
          license_plate_frame: (editingVehicle as any).license_plate_frame || '',
          window_tint_level: (editingVehicle as any).window_tint_level || '',
          sunroof: !!(editingVehicle as any).sunroof,
          roof_rack: !!(editingVehicle as any).roof_rack,
          trailer_hitch: !!(editingVehicle as any).trailer_hitch,
          lift_kit: !!(editingVehicle as any).lift_kit,
          lowered: !!(editingVehicle as any).lowered,
          rideshare_sticker: (editingVehicle as any).rideshare_sticker || '',
          // Mechanical
          seat_material: (editingVehicle as any).seat_material || '',
          // Registration / Ownership
          registered_owner_name: (editingVehicle as any).registered_owner_name || '',
          registered_owner_dob: (editingVehicle as any).registered_owner_dob || '',
          registered_owner_phone: (editingVehicle as any).registered_owner_phone || '',
          registered_owner_address: (editingVehicle as any).registered_owner_address || '',
          temporary_plate_expiry: (editingVehicle as any).temporary_plate_expiry || '',
          title_number: (editingVehicle as any).title_number || '',
          title_status: (editingVehicle as any).title_status || '',
          registration_status: (editingVehicle as any).registration_status || '',
          registration_state: (editingVehicle as any).registration_state || '',
          insurance_status: (editingVehicle as any).insurance_status || '',
          insurance_expiry: (editingVehicle as any).insurance_expiry || '',
          insurance_verified_at: (editingVehicle as any).insurance_verified_at || '',
          insurance_verified_by: (editingVehicle as any).insurance_verified_by || '',
          insurance_agent_name: (editingVehicle as any).insurance_agent_name || '',
          insurance_agent_phone: (editingVehicle as any).insurance_agent_phone || '',
          insurance_policy_number: (editingVehicle as any).insurance_policy_number || '',
          insurance_coverage_type: (editingVehicle as any).insurance_coverage_type || '',
          insurance_verified_date: (editingVehicle as any).insurance_verified_date || '',
          sr22_required: !!(editingVehicle as any).sr22_required,
          lien_holder_address: (editingVehicle as any).lien_holder_address || '',
          lien_balance: (editingVehicle as any).lien_balance ? String((editingVehicle as any).lien_balance) : '',
          // Condition — Status & Impound
          last_seen_date: (editingVehicle as any).last_seen_date || '',
          last_seen_location: (editingVehicle as any).last_seen_location || '',
          is_stolen: !!(editingVehicle as any).is_stolen,
          vehicle_alert_code: (editingVehicle as any).vehicle_alert_code || '',
          impound_status: (editingVehicle as any).impound_status || '',
          impound_date: (editingVehicle as any).impound_date || '',
          impound_lot: (editingVehicle as any).impound_lot || '',
          impound_case_number: (editingVehicle as any).impound_case_number || '',
          repossession_status: (editingVehicle as any).repossession_status || '',
          repossession_date: (editingVehicle as any).repossession_date || '',
          repossession_company: (editingVehicle as any).repossession_company || '',
          rear_bumper_damage: (editingVehicle as any).rear_bumper_damage || '',
          rust_locations: (editingVehicle as any).rust_locations || '',
          // Condition — Tow Information
          tow_reason: (editingVehicle as any).tow_reason || '',
          tow_lot_location: (editingVehicle as any).tow_lot_location || '',
          tow_release_date: (editingVehicle as any).tow_release_date || '',
          tow_release_to: (editingVehicle as any).tow_release_to || '',
          tow_fee: (editingVehicle as any).tow_fee ? String((editingVehicle as any).tow_fee) : '',
          tow_driver_name: (editingVehicle as any).tow_driver_name || '',
          tow_company_phone: (editingVehicle as any).tow_company_phone || '',
          storage_fee_daily: (editingVehicle as any).storage_fee_daily ? String((editingVehicle as any).storage_fee_daily) : '',
          // Condition — Vehicle Condition
          mileage_last_recorded: (editingVehicle as any).mileage_last_recorded ? String((editingVehicle as any).mileage_last_recorded) : '',
          mileage_date_recorded: (editingVehicle as any).mileage_date_recorded || '',
          emissions_status: (editingVehicle as any).emissions_status || '',
          emissions_test_date: (editingVehicle as any).emissions_test_date || '',
          catalytic_converter_status: (editingVehicle as any).catalytic_converter_status || '',
          tire_condition: (editingVehicle as any).tire_condition || '',
          brake_condition: (editingVehicle as any).brake_condition || '',
          headlight_type: (editingVehicle as any).headlight_type || '',
        };
        setForm(initial);
        snapshot(initial);
      } else {
        setForm(EMPTY_FORM);
        snapshot(EMPTY_FORM);
      }
    }
  }, [isOpen, editingVehicle, snapshot]);

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
    // Validate year if provided
    if (form.year) {
      const yearNum = parseInt(form.year, 10);
      if (isNaN(yearNum) || yearNum < 1900 || yearNum > 2030) return;
    }
    // Validate VIN length if provided
    if (form.vin && form.vin.length !== 17) return;
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

          {/* Appearance Details */}
          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Appearance Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Interior Color</label>
              <input name="interior_color" type="text" className="input-dark mt-1" value={form.interior_color} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Wrap / Custom Paint</label>
              <input name="wrap_or_paint_custom" type="text" className="input-dark mt-1" value={form.wrap_or_paint_custom} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">License Plate Frame</label>
              <input name="license_plate_frame" type="text" className="input-dark mt-1" value={form.license_plate_frame} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Window Tint Level</label>
              <select name="window_tint_level" className="select-dark mt-1" value={form.window_tint_level} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="None">None</option>
                <option value="Light">Light</option>
                <option value="Medium">Medium</option>
                <option value="Dark">Dark</option>
                <option value="Limo">Limo</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Rideshare Sticker</label>
              <input name="rideshare_sticker" type="text" className="input-dark mt-1" value={form.rideshare_sticker} onChange={handleChange} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-1">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="sunroof" checked={form.sunroof as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">Sunroof</span>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="roof_rack" checked={form.roof_rack as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">Roof Rack</span>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="trailer_hitch" checked={form.trailer_hitch as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">Trailer Hitch</span>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="lift_kit" checked={form.lift_kit as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">Lift Kit</span>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="lowered" checked={form.lowered as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">Lowered</span>
            </label>
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

          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Interior</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Seat Material</label>
              <select name="seat_material" className="select-dark mt-1" value={form.seat_material} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Cloth">Cloth</option>
                <option value="Leather">Leather</option>
                <option value="Vinyl">Vinyl</option>
                <option value="Alcantara">Alcantara</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
        </>
      )}

      {activeSection === 'registration' && (
        <>
          {/* Plate & Registration */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Plate Type</label>
              <select name="plate_type" className="select-dark mt-1" value={form.plate_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Standard">Standard</option>
                <option value="Temporary">Temporary</option>
                <option value="Dealer">Dealer</option>
                <option value="Government">Government</option>
                <option value="Exempt">Exempt</option>
                <option value="Disabled">Disabled</option>
                <option value="Personalized">Personalized</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Registration Expiry</label>
              <input name="registration_expiry" type="date" className="input-dark mt-1" value={form.registration_expiry} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Temporary Plate Expiry</label>
              <input name="temporary_plate_expiry" type="date" className="input-dark mt-1" value={form.temporary_plate_expiry} onChange={handleChange} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Registration Status</label>
              <select name="registration_status" className="select-dark mt-1" value={form.registration_status} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Current">Current</option>
                <option value="Expired">Expired</option>
                <option value="Suspended">Suspended</option>
                <option value="Revoked">Revoked</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Registration State</label>
              <input name="registration_state" type="text" className="input-dark mt-1" value={form.registration_state} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Title Number</label>
              <input name="title_number" type="text" className="input-dark mt-1" value={form.title_number} onChange={handleChange} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Title Status</label>
              <select name="title_status" className="select-dark mt-1" value={form.title_status} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Clean">Clean</option>
                <option value="Salvage">Salvage</option>
                <option value="Rebuilt">Rebuilt</option>
                <option value="Flood">Flood</option>
                <option value="Junk">Junk</option>
                <option value="Bonded">Bonded</option>
              </select>
            </div>
          </div>

          {/* Registered Owner */}
          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Registered Owner</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Registered Owner Name</label>
              <input name="registered_owner_name" type="text" className="input-dark mt-1" value={form.registered_owner_name} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Registered Owner DOB</label>
              <input name="registered_owner_dob" type="date" className="input-dark mt-1" value={form.registered_owner_dob} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Registered Owner Phone</label>
              <input name="registered_owner_phone" type="tel" className="input-dark mt-1" value={form.registered_owner_phone} onChange={handleChange} placeholder="(801) 555-1234" />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Registered Owner Address</label>
              <AddressAutocomplete
                name="registered_owner_address"
                className="input-dark mt-1"
                placeholder="Registered owner address"
                value={form.registered_owner_address}
                onChange={(val) => setForm((prev) => ({ ...prev, registered_owner_address: val }))}
              />
            </div>
          </div>

          {/* Owner Contact */}
          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Owner Contact</h3>
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

          {/* Insurance */}
          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Insurance</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Insurance Company</label>
              <input name="insurance_company" type="text" className="input-dark mt-1" value={form.insurance_company} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Policy Number</label>
              <input name="insurance_policy" type="text" className="input-dark mt-1" value={form.insurance_policy} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Insurance Policy Number</label>
              <input name="insurance_policy_number" type="text" className="input-dark mt-1" value={form.insurance_policy_number} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Insurance Status</label>
              <select name="insurance_status" className="select-dark mt-1" value={form.insurance_status} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Active">Active</option>
                <option value="Expired">Expired</option>
                <option value="Cancelled">Cancelled</option>
                <option value="Unknown">Unknown</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Coverage Type</label>
              <select name="insurance_coverage_type" className="select-dark mt-1" value={form.insurance_coverage_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Liability">Liability</option>
                <option value="Full Coverage">Full Coverage</option>
                <option value="Comprehensive">Comprehensive</option>
                <option value="Collision">Collision</option>
                <option value="Minimum">Minimum</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Insurance Expiry</label>
              <input name="insurance_expiry" type="date" className="input-dark mt-1" value={form.insurance_expiry} onChange={handleChange} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Agent Name</label>
              <input name="insurance_agent_name" type="text" className="input-dark mt-1" value={form.insurance_agent_name} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Agent Phone</label>
              <input name="insurance_agent_phone" type="tel" className="input-dark mt-1" value={form.insurance_agent_phone} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Verified By</label>
              <input name="insurance_verified_by" type="text" className="input-dark mt-1" value={form.insurance_verified_by} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Verified Date</label>
              <input name="insurance_verified_date" type="date" className="input-dark mt-1" value={form.insurance_verified_date} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Verified At</label>
              <input name="insurance_verified_at" type="date" className="input-dark mt-1" value={form.insurance_verified_at} onChange={handleChange} />
            </div>
          </div>

          <div className="flex items-center gap-6 py-1">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="sr22_required" checked={form.sr22_required as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">SR-22 Required</span>
            </label>
          </div>

          {/* Lien */}
          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Lien Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Lien Holder</label>
              <input name="lien_holder" type="text" className="input-dark mt-1" placeholder="Bank or finance company" value={form.lien_holder} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Lien Holder Address</label>
              <input name="lien_holder_address" type="text" className="input-dark mt-1" value={form.lien_holder_address} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Lien Balance</label>
              <input name="lien_balance" type="number" step="0.01" className="input-dark mt-1" value={form.lien_balance} onChange={handleChange} />
            </div>
          </div>

          {/* Vehicle Flags */}
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Rear Bumper Damage</label>
              <input name="rear_bumper_damage" type="text" className="input-dark mt-1" value={form.rear_bumper_damage} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Rust Locations</label>
              <input name="rust_locations" type="text" className="input-dark mt-1" value={form.rust_locations} onChange={handleChange} />
            </div>
          </div>

          {/* Stolen & Alert Status */}
          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Stolen / Alert Status</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Stolen Status</label>
              <select name="stolen_status" className="select-dark mt-1" value={form.stolen_status} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Not Stolen">Not Stolen</option>
                <option value="Reported Stolen">Reported Stolen</option>
                <option value="Recovered">Recovered</option>
                <option value="Attempted Theft">Attempted Theft</option>
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
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Last Seen Date</label>
              <input name="last_seen_date" type="date" className="input-dark mt-1" value={form.last_seen_date} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Last Seen Location</label>
              <input name="last_seen_location" type="text" className="input-dark mt-1" value={form.last_seen_location} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Vehicle Alert Code</label>
              <input name="vehicle_alert_code" type="text" className="input-dark mt-1" value={form.vehicle_alert_code} onChange={handleChange} />
            </div>
          </div>
          <div className="flex items-center gap-6 py-1">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="is_stolen" checked={form.is_stolen as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">Is Stolen</span>
            </label>
          </div>

          {/* Impound */}
          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Impound</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Impound Status</label>
              <select name="impound_status" className="select-dark mt-1" value={form.impound_status} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="None">None</option>
                <option value="Impounded">Impounded</option>
                <option value="Released">Released</option>
                <option value="Pending Release">Pending Release</option>
                <option value="Auctioned">Auctioned</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Impound Date</label>
              <input name="impound_date" type="date" className="input-dark mt-1" value={form.impound_date} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Impound Lot</label>
              <input name="impound_lot" type="text" className="input-dark mt-1" value={form.impound_lot} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Impound Case Number</label>
              <input name="impound_case_number" type="text" className="input-dark mt-1" value={form.impound_case_number} onChange={handleChange} />
            </div>
          </div>

          {/* Repossession */}
          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Repossession</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Repossession Status</label>
              <select name="repossession_status" className="select-dark mt-1" value={form.repossession_status} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="None">None</option>
                <option value="Repo Order">Repo Order</option>
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Repossession Date</label>
              <input name="repossession_date" type="date" className="input-dark mt-1" value={form.repossession_date} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Repossession Company</label>
              <input name="repossession_company" type="text" className="input-dark mt-1" value={form.repossession_company} onChange={handleChange} />
            </div>
          </div>

          {/* Tow Information */}
          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Tow Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Tow Status</label>
              <select name="tow_status" className="select-dark mt-1" value={form.tow_status} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="None">None</option>
                <option value="Ordered">Ordered</option>
                <option value="In Transit">In Transit</option>
                <option value="Completed">Completed</option>
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
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Tow Reason</label>
              <input name="tow_reason" type="text" className="input-dark mt-1" value={form.tow_reason} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Tow Lot Location</label>
              <input name="tow_lot_location" type="text" className="input-dark mt-1" value={form.tow_lot_location} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Tow Release Date</label>
              <input name="tow_release_date" type="date" className="input-dark mt-1" value={form.tow_release_date} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Tow Release To</label>
              <input name="tow_release_to" type="text" className="input-dark mt-1" value={form.tow_release_to} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Tow Driver Name</label>
              <input name="tow_driver_name" type="text" className="input-dark mt-1" value={form.tow_driver_name} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Tow Company Phone</label>
              <input name="tow_company_phone" type="tel" className="input-dark mt-1" value={form.tow_company_phone} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Tow Fee</label>
              <input name="tow_fee" type="number" step="0.01" className="input-dark mt-1" value={form.tow_fee} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Storage Fee (Daily)</label>
              <input name="storage_fee_daily" type="number" step="0.01" className="input-dark mt-1" value={form.storage_fee_daily} onChange={handleChange} />
            </div>
          </div>

          {/* Vehicle Condition */}
          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Vehicle Condition</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Mileage Last Recorded</label>
              <input name="mileage_last_recorded" type="number" className="input-dark mt-1" value={form.mileage_last_recorded} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Mileage Date Recorded</label>
              <input name="mileage_date_recorded" type="date" className="input-dark mt-1" value={form.mileage_date_recorded} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Emissions Status</label>
              <select name="emissions_status" className="select-dark mt-1" value={form.emissions_status} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Passed">Passed</option>
                <option value="Failed">Failed</option>
                <option value="Exempt">Exempt</option>
                <option value="Pending">Pending</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Emissions Test Date</label>
              <input name="emissions_test_date" type="date" className="input-dark mt-1" value={form.emissions_test_date} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Catalytic Converter Status</label>
              <select name="catalytic_converter_status" className="select-dark mt-1" value={form.catalytic_converter_status} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Present">Present</option>
                <option value="Missing">Missing</option>
                <option value="Aftermarket">Aftermarket</option>
                <option value="Shield Installed">Shield Installed</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Tire Condition</label>
              <select name="tire_condition" className="select-dark mt-1" value={form.tire_condition} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Good">Good</option>
                <option value="Fair">Fair</option>
                <option value="Poor">Poor</option>
                <option value="Bald">Bald</option>
                <option value="Mismatched">Mismatched</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Brake Condition</label>
              <select name="brake_condition" className="select-dark mt-1" value={form.brake_condition} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Good">Good</option>
                <option value="Fair">Fair</option>
                <option value="Poor">Poor</option>
                <option value="Metal-on-Metal">Metal-on-Metal</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Headlight Type</label>
              <select name="headlight_type" className="select-dark mt-1" value={form.headlight_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Halogen">Halogen</option>
                <option value="LED">LED</option>
                <option value="HID/Xenon">HID/Xenon</option>
                <option value="Aftermarket">Aftermarket</option>
              </select>
            </div>
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

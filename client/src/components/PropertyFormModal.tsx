import React, { useState, useEffect } from 'react';
import { Building2 } from 'lucide-react';
import FormModal from './FormModal';
import { useFormDirty } from '../hooks/useFormDirty';
import type { Property } from '../types';
import AddressAutocomplete, { type ParsedAddress } from './AddressAutocomplete';

interface PropertyFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: PropertyFormData) => void;
  isSubmitting: boolean;
  editingProperty?: Property;
  clients?: { id: string; name: string; status: string }[];
  submitError?: string | null;
}

export interface PropertyFormData {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  client_id: string;
  property_type: string;
  gate_code: string;
  alarm_code: string;
  emergency_contact: string;
  post_orders: string;
  hazard_notes: string;
  access_instructions: string;
  latitude: string;
  longitude: string;
  is_active: boolean;
  notes: string;
  // Building Information
  building_year_built: string;
  building_square_footage: string;
  building_floors: string;
  building_material: string;
  roof_type: string;
  roof_access: boolean;
  basement_present: boolean;
  basement_access: string;
  elevator_count: string;
  stairwell_count: string;
  loading_dock_count: string;
  entry_points_count: string;
  entry_points_notes: string;
  occupancy_capacity: string;
  ada_accessible: boolean;
  // Security Systems
  security_system_type: string;
  security_company: string;
  security_company_phone: string;
  security_company_account: string;
  security_panel_location: string;
  security_code_day: string;
  security_code_night: string;
  duress_code: string;
  security_zones_count: string;
  security_last_tested: string;
  fire_panel_location: string;
  fire_sprinkler_system: boolean;
  backup_generator: boolean;
  // CCTV
  cctv_camera_count: string;
  cctv_recording_location: string;
  cctv_retention_days: string;
  cctv_remote_viewable: boolean;
  cctv_vendor: string;
  cctv_access_credentials: string;
  cctv_ptz_capable: boolean;
  cctv_audio_recording: boolean;
  // Access & Keys
  key_type: string;
  key_location: string;
  key_box_code: string;
  key_holder_name: string;
  key_holder_phone: string;
  key_holder_secondary_name: string;
  key_holder_secondary_phone: string;
  access_card_system: string;
  restricted_access_areas: string;
  // Property Management
  owner_name: string;
  owner_phone: string;
  property_manager_name: string;
  property_manager_phone: string;
  property_manager_email: string;
  tenant_count: string;
  tenant_list: string;
  lease_expiry: string;
  after_hours_contact_name: string;
  after_hours_contact_phone: string;
  // Utilities & Infrastructure
  water_source: string;
  septic_or_sewer: string;
  internet_provider: string;
  phone_system_type: string;
  utility_shutoff_locations: string;
  dumpster_locations: string;
  // Patrol & Safety
  patrol_frequency: string;
  patrol_priority: string;
  last_patrol_date: string;
  parking_lot_spaces: string;
  parking_lot_gated: boolean;
  lighting_description: string;
  lighting_timer: string;
  officer_caution_notes: string;
  sensitive_areas: string;
  hazmat_on_site: boolean;
  weapons_on_premises: boolean;
  problem_type_tags: string;
}

const EMPTY_FORM: PropertyFormData = {
  name: '',
  address: '',
  city: '',
  state: 'UT',
  zip: '',
  client_id: '',
  property_type: '',
  gate_code: '',
  alarm_code: '',
  emergency_contact: '',
  post_orders: '',
  hazard_notes: '',
  access_instructions: '',
  latitude: '',
  longitude: '',
  is_active: true,
  notes: '',
  // Building Information
  building_year_built: '',
  building_square_footage: '',
  building_floors: '',
  building_material: '',
  roof_type: '',
  roof_access: false,
  basement_present: false,
  basement_access: '',
  elevator_count: '',
  stairwell_count: '',
  loading_dock_count: '',
  entry_points_count: '',
  entry_points_notes: '',
  occupancy_capacity: '',
  ada_accessible: false,
  // Security Systems
  security_system_type: '',
  security_company: '',
  security_company_phone: '',
  security_company_account: '',
  security_panel_location: '',
  security_code_day: '',
  security_code_night: '',
  duress_code: '',
  security_zones_count: '',
  security_last_tested: '',
  fire_panel_location: '',
  fire_sprinkler_system: false,
  backup_generator: false,
  // CCTV
  cctv_camera_count: '',
  cctv_recording_location: '',
  cctv_retention_days: '',
  cctv_remote_viewable: false,
  cctv_vendor: '',
  cctv_access_credentials: '',
  cctv_ptz_capable: false,
  cctv_audio_recording: false,
  // Access & Keys
  key_type: '',
  key_location: '',
  key_box_code: '',
  key_holder_name: '',
  key_holder_phone: '',
  key_holder_secondary_name: '',
  key_holder_secondary_phone: '',
  access_card_system: '',
  restricted_access_areas: '',
  // Property Management
  owner_name: '',
  owner_phone: '',
  property_manager_name: '',
  property_manager_phone: '',
  property_manager_email: '',
  tenant_count: '',
  tenant_list: '',
  lease_expiry: '',
  after_hours_contact_name: '',
  after_hours_contact_phone: '',
  // Utilities & Infrastructure
  water_source: '',
  septic_or_sewer: '',
  internet_provider: '',
  phone_system_type: '',
  utility_shutoff_locations: '',
  dumpster_locations: '',
  // Patrol & Safety
  patrol_frequency: '',
  patrol_priority: '',
  last_patrol_date: '',
  parking_lot_spaces: '',
  parking_lot_gated: false,
  lighting_description: '',
  lighting_timer: '',
  officer_caution_notes: '',
  sensitive_areas: '',
  hazmat_on_site: false,
  weapons_on_premises: false,
  problem_type_tags: '',
};

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
  'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

const PROPERTY_TYPES = [
  'Commercial', 'Residential', 'Industrial', 'Government', 'Education',
  'Healthcare', 'Retail', 'Mixed Use', 'Other',
];

const TAB_LABELS: Record<string, string> = {
  basic: 'Basic',
  building: 'Building',
  security: 'Security',
  access: 'Access',
  management: 'Management',
  patrol: 'Patrol',
};

export default function PropertyFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  editingProperty,
  clients = [],
  submitError,
}: PropertyFormModalProps) {
  const [form, setForm] = useState<PropertyFormData>(EMPTY_FORM);
  const [activeTab, setActiveTab] = useState<'basic' | 'building' | 'security' | 'access' | 'management' | 'patrol'>('basic');
  const { isDirty, snapshot } = useFormDirty(form, isOpen);

  useEffect(() => {
    if (isOpen) {
      setActiveTab('basic');
      if (editingProperty) {
        const ep = editingProperty as any;
        const initial: PropertyFormData = {
          name: ep.name || '',
          address: ep.address || '',
          city: ep.city || '',
          state: ep.state || 'UT',
          zip: ep.zip || '',
          client_id: ep.client_id || '',
          property_type: ep.property_type || '',
          gate_code: ep.gate_code || '',
          alarm_code: ep.alarm_code || '',
          emergency_contact: ep.emergency_contact || '',
          post_orders: ep.post_orders || '',
          hazard_notes: ep.hazard_notes || '',
          access_instructions: ep.access_instructions || '',
          latitude: ep.latitude != null ? String(ep.latitude) : '',
          longitude: ep.longitude != null ? String(ep.longitude) : '',
          is_active: ep.is_active ?? true,
          notes: ep.notes || '',
          // Building Information
          building_year_built: ep.building_year_built != null ? String(ep.building_year_built) : '',
          building_square_footage: ep.building_square_footage != null ? String(ep.building_square_footage) : '',
          building_floors: ep.building_floors != null ? String(ep.building_floors) : '',
          building_material: ep.building_material || '',
          roof_type: ep.roof_type || '',
          roof_access: !!ep.roof_access,
          basement_present: !!ep.basement_present,
          basement_access: ep.basement_access || '',
          elevator_count: ep.elevator_count != null ? String(ep.elevator_count) : '',
          stairwell_count: ep.stairwell_count != null ? String(ep.stairwell_count) : '',
          loading_dock_count: ep.loading_dock_count != null ? String(ep.loading_dock_count) : '',
          entry_points_count: ep.entry_points_count != null ? String(ep.entry_points_count) : '',
          entry_points_notes: ep.entry_points_notes || '',
          occupancy_capacity: ep.occupancy_capacity != null ? String(ep.occupancy_capacity) : '',
          ada_accessible: !!ep.ada_accessible,
          // Security Systems
          security_system_type: ep.security_system_type || '',
          security_company: ep.security_company || '',
          security_company_phone: ep.security_company_phone || '',
          security_company_account: ep.security_company_account || '',
          security_panel_location: ep.security_panel_location || '',
          security_code_day: ep.security_code_day || '',
          security_code_night: ep.security_code_night || '',
          duress_code: ep.duress_code || '',
          security_zones_count: ep.security_zones_count != null ? String(ep.security_zones_count) : '',
          security_last_tested: ep.security_last_tested || '',
          fire_panel_location: ep.fire_panel_location || '',
          fire_sprinkler_system: !!ep.fire_sprinkler_system,
          backup_generator: !!ep.backup_generator,
          // CCTV
          cctv_camera_count: ep.cctv_camera_count != null ? String(ep.cctv_camera_count) : '',
          cctv_recording_location: ep.cctv_recording_location || '',
          cctv_retention_days: ep.cctv_retention_days != null ? String(ep.cctv_retention_days) : '',
          cctv_remote_viewable: !!ep.cctv_remote_viewable,
          cctv_vendor: ep.cctv_vendor || '',
          cctv_access_credentials: ep.cctv_access_credentials || '',
          cctv_ptz_capable: !!ep.cctv_ptz_capable,
          cctv_audio_recording: !!ep.cctv_audio_recording,
          // Access & Keys
          key_type: ep.key_type || '',
          key_location: ep.key_location || '',
          key_box_code: ep.key_box_code || '',
          key_holder_name: ep.key_holder_name || '',
          key_holder_phone: ep.key_holder_phone || '',
          key_holder_secondary_name: ep.key_holder_secondary_name || '',
          key_holder_secondary_phone: ep.key_holder_secondary_phone || '',
          access_card_system: ep.access_card_system || '',
          restricted_access_areas: ep.restricted_access_areas || '',
          // Property Management
          owner_name: ep.owner_name || '',
          owner_phone: ep.owner_phone || '',
          property_manager_name: ep.property_manager_name || '',
          property_manager_phone: ep.property_manager_phone || '',
          property_manager_email: ep.property_manager_email || '',
          tenant_count: ep.tenant_count != null ? String(ep.tenant_count) : '',
          tenant_list: ep.tenant_list || '',
          lease_expiry: ep.lease_expiry || '',
          after_hours_contact_name: ep.after_hours_contact_name || '',
          after_hours_contact_phone: ep.after_hours_contact_phone || '',
          // Utilities & Infrastructure
          water_source: ep.water_source || '',
          septic_or_sewer: ep.septic_or_sewer || '',
          internet_provider: ep.internet_provider || '',
          phone_system_type: ep.phone_system_type || '',
          utility_shutoff_locations: ep.utility_shutoff_locations || '',
          dumpster_locations: ep.dumpster_locations || '',
          // Patrol & Safety
          patrol_frequency: ep.patrol_frequency || '',
          patrol_priority: ep.patrol_priority || '',
          last_patrol_date: ep.last_patrol_date || '',
          parking_lot_spaces: ep.parking_lot_spaces != null ? String(ep.parking_lot_spaces) : '',
          parking_lot_gated: !!ep.parking_lot_gated,
          lighting_description: ep.lighting_description || '',
          lighting_timer: ep.lighting_timer || '',
          officer_caution_notes: ep.officer_caution_notes || '',
          sensitive_areas: ep.sensitive_areas || '',
          hazmat_on_site: !!ep.hazmat_on_site,
          weapons_on_premises: !!ep.weapons_on_premises,
          problem_type_tags: ep.problem_type_tags || '',
        };
        setForm(initial);
        snapshot(initial);
      } else {
        setForm(EMPTY_FORM);
        snapshot(EMPTY_FORM);
      }
    }
  }, [isOpen, editingProperty]);

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
      title={editingProperty ? 'Edit Property' : 'New Property'}
      icon={Building2}
      submitLabel={editingProperty ? 'Update' : 'Create'}
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

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-[#222] mb-4">
        {(['basic', 'building', 'security', 'access', 'management', 'patrol'] as const).map((tab) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-[10px] uppercase font-semibold tracking-wider border-b-2 transition-colors ${
              activeTab === tab ? 'border-[#d4a017] text-[#d4a017]' : 'border-transparent text-rmpg-400 hover:text-rmpg-300'
            }`}
          >{TAB_LABELS[tab]}</button>
        ))}
      </div>

      {/* ===== BASIC TAB ===== */}
      {activeTab === 'basic' && (
        <div className="space-y-4">
          {/* Row 1: Name */}
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
              Property Name <span className="text-red-400">*</span>
            </label>
            <input
              name="name"
              type="text"
              required
              autoFocus
              className="input-dark w-full text-xs"
              placeholder="e.g. Sunrise Office Park"
              value={form.name}
              onChange={handleChange}
            />
          </div>

          {/* Row 2: Address */}
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
              Address <span className="text-red-400">*</span>
            </label>
            <AddressAutocomplete
              name="address"
              required
              className="input-dark w-full text-xs"
              placeholder="Street address"
              value={form.address}
              onChange={(val) => setForm((prev) => ({ ...prev, address: val }))}
              onSelect={(addr: ParsedAddress) => {
                setForm((prev) => ({
                  ...prev,
                  address: addr.street || addr.formatted,
                  city: addr.city || prev.city,
                  state: addr.state || prev.state,
                  zip: addr.zip || prev.zip,
                  latitude: (addr.latitude as any) ?? prev.latitude,
                  longitude: (addr.longitude as any) ?? prev.longitude,
                }));
              }}
            />
          </div>

          {/* Row 3: City, State, Zip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">City</label>
              <input
                name="city"
                type="text"
                className="input-dark w-full text-xs"
                value={form.city}
                onChange={handleChange}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">State</label>
              <select name="state" className="select-dark w-full text-xs" value={form.state} onChange={handleChange}>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Zip</label>
              <input
                name="zip"
                type="text"
                className="input-dark w-full text-xs"
                value={form.zip}
                onChange={handleChange}
                pattern="\d{5}(-\d{4})?"
                maxLength={10}
                placeholder="e.g. 84101"
              />
            </div>
          </div>

          {/* Row 4: Client, Property Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Client</label>
              <select name="client_id" className="select-dark w-full text-xs" value={form.client_id} onChange={handleChange}>
                <option value="">No Client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Property Type</label>
              <select name="property_type" className="select-dark w-full text-xs" value={form.property_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Row 5: Gate Code, Alarm Code, Emergency Contact */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Gate Code</label>
              <input
                name="gate_code"
                type="text"
                className="input-dark w-full text-xs"
                placeholder="e.g. #1234"
                value={form.gate_code}
                onChange={handleChange}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Alarm Code</label>
              <input
                name="alarm_code"
                type="text"
                className="input-dark w-full text-xs"
                placeholder="e.g. 5678"
                value={form.alarm_code}
                onChange={handleChange}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Emergency Contact</label>
              <input
                name="emergency_contact"
                type="text"
                className="input-dark w-full text-xs"
                placeholder="Name / Phone"
                value={form.emergency_contact}
                onChange={handleChange}
              />
            </div>
          </div>

          {/* Row 6: Latitude, Longitude */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Latitude</label>
              <input
                name="latitude"
                type="text"
                className="input-dark w-full text-xs"
                placeholder="e.g. 40.7608"
                value={form.latitude}
                onChange={handleChange}
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Longitude</label>
              <input
                name="longitude"
                type="text"
                className="input-dark w-full text-xs"
                placeholder="e.g. -111.8910"
                value={form.longitude}
                onChange={handleChange}
              />
            </div>
          </div>

          {/* Row 7: Post Orders */}
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Post Orders</label>
            <textarea
              name="post_orders"
              rows={3}
              className="input-dark w-full text-xs"
              placeholder="Standing instructions for officers at this property"
              value={form.post_orders}
              onChange={handleChange}
              maxLength={5000}
            />
            <div className="text-[9px] text-rmpg-500 text-right mt-0.5">{form.post_orders.length}/5000</div>
          </div>

          {/* Row 8: Hazard Notes */}
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Hazard Notes</label>
            <textarea
              name="hazard_notes"
              rows={3}
              className="input-dark w-full text-xs"
              placeholder="Known hazards, safety concerns, or officer caution notes"
              value={form.hazard_notes}
              onChange={handleChange}
              maxLength={3000}
            />
            <div className="text-[9px] text-rmpg-500 text-right mt-0.5">{form.hazard_notes.length}/3000</div>
          </div>

          {/* Row 9: Access Instructions */}
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Access Instructions</label>
            <textarea
              name="access_instructions"
              rows={2}
              className="input-dark w-full text-xs"
              placeholder="How to access the property, key locations, entry points"
              value={form.access_instructions}
              onChange={handleChange}
            />
          </div>

          {/* Row 10: Notes */}
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Notes</label>
            <textarea
              name="notes"
              rows={2}
              className="input-dark w-full text-xs"
              value={form.notes}
              onChange={handleChange}
            />
          </div>

          {/* Row 11: Is Active */}
          <div className="flex items-center gap-3 py-2">
            <label className="flex items-center gap-2 text-xs text-rmpg-200 cursor-pointer">
              <input
                type="checkbox"
                name="is_active"
                checked={form.is_active}
                onChange={handleChange}
                className="w-4 h-4 bg-rmpg-800 border-rmpg-600 text-brand-500 focus:ring-brand-500"
              />
              Active Property
            </label>
          </div>
        </div>
      )}

      {/* ===== BUILDING TAB ===== */}
      {activeTab === 'building' && (
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider">Building Details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Year Built</label>
              <input name="building_year_built" type="number" className="input-dark w-full text-xs" placeholder="e.g. 1995" value={form.building_year_built} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Square Footage</label>
              <input name="building_square_footage" type="number" className="input-dark w-full text-xs" placeholder="e.g. 25000" value={form.building_square_footage} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Floors</label>
              <input name="building_floors" type="number" className="input-dark w-full text-xs" placeholder="e.g. 3" value={form.building_floors} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Building Material</label>
              <select name="building_material" className="select-dark w-full text-xs" value={form.building_material} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Wood">Wood</option>
                <option value="Brick">Brick</option>
                <option value="Concrete">Concrete</option>
                <option value="Steel">Steel</option>
                <option value="Mixed">Mixed</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Roof Type</label>
              <select name="roof_type" className="select-dark w-full text-xs" value={form.roof_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Flat">Flat</option>
                <option value="Pitched">Pitched</option>
                <option value="Metal">Metal</option>
                <option value="Tile">Tile</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Occupancy Capacity</label>
              <input name="occupancy_capacity" type="number" className="input-dark w-full text-xs" placeholder="Max occupants" value={form.occupancy_capacity} onChange={handleChange} />
            </div>
          </div>

          <div className="flex flex-wrap gap-6 py-2">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="roof_access" checked={form.roof_access as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">Roof Access</span>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="basement_present" checked={form.basement_present as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">Basement Present</span>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="ada_accessible" checked={form.ada_accessible as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">ADA Accessible</span>
            </label>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Basement Access</label>
            <input name="basement_access" type="text" className="input-dark w-full text-xs" placeholder="How to access basement" value={form.basement_access} onChange={handleChange} />
          </div>

          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Entry & Circulation</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Elevator Count</label>
              <input name="elevator_count" type="number" className="input-dark w-full text-xs" value={form.elevator_count} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Stairwell Count</label>
              <input name="stairwell_count" type="number" className="input-dark w-full text-xs" value={form.stairwell_count} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Loading Dock Count</label>
              <input name="loading_dock_count" type="number" className="input-dark w-full text-xs" value={form.loading_dock_count} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Entry Points Count</label>
              <input name="entry_points_count" type="number" className="input-dark w-full text-xs" value={form.entry_points_count} onChange={handleChange} />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Entry Points Notes</label>
            <textarea name="entry_points_notes" rows={2} className="input-dark w-full text-xs" placeholder="Describe entry points, locations, access methods" value={form.entry_points_notes} onChange={handleChange} />
          </div>
        </div>
      )}

      {/* ===== SECURITY TAB ===== */}
      {activeTab === 'security' && (
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider">Security Systems</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Security System Type</label>
              <select name="security_system_type" className="select-dark w-full text-xs" value={form.security_system_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="None">None</option>
                <option value="Alarm">Alarm</option>
                <option value="Camera">Camera</option>
                <option value="Both">Both</option>
                <option value="Full Suite">Full Suite</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Security Company</label>
              <input name="security_company" type="text" className="input-dark w-full text-xs" value={form.security_company} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Security Company Phone</label>
              <input name="security_company_phone" type="text" className="input-dark w-full text-xs" value={form.security_company_phone} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Security Account #</label>
              <input name="security_company_account" type="text" className="input-dark w-full text-xs" value={form.security_company_account} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Security Panel Location</label>
              <input name="security_panel_location" type="text" className="input-dark w-full text-xs" value={form.security_panel_location} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Security Zones Count</label>
              <input name="security_zones_count" type="number" className="input-dark w-full text-xs" value={form.security_zones_count} onChange={handleChange} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Day Code</label>
              <input name="security_code_day" type="text" className="input-dark w-full text-xs" value={form.security_code_day} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Night Code</label>
              <input name="security_code_night" type="text" className="input-dark w-full text-xs" value={form.security_code_night} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Duress Code</label>
              <input name="duress_code" type="text" className="input-dark w-full text-xs" value={form.duress_code} onChange={handleChange} />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Security Last Tested</label>
            <input name="security_last_tested" type="date" className="input-dark w-full text-xs" value={form.security_last_tested} onChange={handleChange} />
          </div>

          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Fire & Backup</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Fire Panel Location</label>
              <input name="fire_panel_location" type="text" className="input-dark w-full text-xs" value={form.fire_panel_location} onChange={handleChange} />
            </div>
          </div>
          <div className="flex flex-wrap gap-6 py-2">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="fire_sprinkler_system" checked={form.fire_sprinkler_system as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">Fire Sprinkler System</span>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="backup_generator" checked={form.backup_generator as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">Backup Generator</span>
            </label>
          </div>

          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">CCTV System</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Camera Count</label>
              <input name="cctv_camera_count" type="number" className="input-dark w-full text-xs" value={form.cctv_camera_count} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Recording Location</label>
              <input name="cctv_recording_location" type="text" className="input-dark w-full text-xs" value={form.cctv_recording_location} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Retention Days</label>
              <input name="cctv_retention_days" type="number" className="input-dark w-full text-xs" value={form.cctv_retention_days} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">CCTV Vendor</label>
              <input name="cctv_vendor" type="text" className="input-dark w-full text-xs" value={form.cctv_vendor} onChange={handleChange} />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">CCTV Access Credentials</label>
            <input name="cctv_access_credentials" type="text" className="input-dark w-full text-xs" value={form.cctv_access_credentials} onChange={handleChange} />
          </div>
          <div className="flex flex-wrap gap-6 py-2">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="cctv_remote_viewable" checked={form.cctv_remote_viewable as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">Remote Viewable</span>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="cctv_ptz_capable" checked={form.cctv_ptz_capable as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">PTZ Capable</span>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="cctv_audio_recording" checked={form.cctv_audio_recording as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">Audio Recording</span>
            </label>
          </div>
        </div>
      )}

      {/* ===== ACCESS TAB ===== */}
      {activeTab === 'access' && (
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider">Keys & Access</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Key Type</label>
              <select name="key_type" className="select-dark w-full text-xs" value={form.key_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Standard">Standard</option>
                <option value="Electronic">Electronic</option>
                <option value="Card">Card</option>
                <option value="Biometric">Biometric</option>
                <option value="Combination">Combination</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Key Location</label>
              <input name="key_location" type="text" className="input-dark w-full text-xs" value={form.key_location} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Key Box Code</label>
              <input name="key_box_code" type="text" className="input-dark w-full text-xs" value={form.key_box_code} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Access Card System</label>
              <input name="access_card_system" type="text" className="input-dark w-full text-xs" value={form.access_card_system} onChange={handleChange} />
            </div>
          </div>

          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Primary Key Holder</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Name</label>
              <input name="key_holder_name" type="text" className="input-dark w-full text-xs" value={form.key_holder_name} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Phone</label>
              <input name="key_holder_phone" type="text" className="input-dark w-full text-xs" value={form.key_holder_phone} onChange={handleChange} />
            </div>
          </div>

          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Secondary Key Holder</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Name</label>
              <input name="key_holder_secondary_name" type="text" className="input-dark w-full text-xs" value={form.key_holder_secondary_name} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Phone</label>
              <input name="key_holder_secondary_phone" type="text" className="input-dark w-full text-xs" value={form.key_holder_secondary_phone} onChange={handleChange} />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Restricted Access Areas</label>
            <textarea name="restricted_access_areas" rows={2} className="input-dark w-full text-xs" placeholder="Areas with restricted access, clearance requirements" value={form.restricted_access_areas} onChange={handleChange} />
          </div>
        </div>
      )}

      {/* ===== MANAGEMENT TAB ===== */}
      {activeTab === 'management' && (
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider">Owner</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Owner Name</label>
              <input name="owner_name" type="text" className="input-dark w-full text-xs" value={form.owner_name} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Owner Phone</label>
              <input name="owner_phone" type="text" className="input-dark w-full text-xs" value={form.owner_phone} onChange={handleChange} />
            </div>
          </div>

          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Property Manager</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Manager Name</label>
              <input name="property_manager_name" type="text" className="input-dark w-full text-xs" value={form.property_manager_name} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Manager Phone</label>
              <input name="property_manager_phone" type="text" className="input-dark w-full text-xs" value={form.property_manager_phone} onChange={handleChange} />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Manager Email</label>
            <input name="property_manager_email" type="text" className="input-dark w-full text-xs" value={form.property_manager_email} onChange={handleChange} />
          </div>

          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Tenants</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Tenant Count</label>
              <input name="tenant_count" type="number" className="input-dark w-full text-xs" value={form.tenant_count} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Lease Expiry</label>
              <input name="lease_expiry" type="date" className="input-dark w-full text-xs" value={form.lease_expiry} onChange={handleChange} />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Tenant List</label>
            <textarea name="tenant_list" rows={2} className="input-dark w-full text-xs" placeholder="List of tenants, suite numbers" value={form.tenant_list} onChange={handleChange} />
          </div>

          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">After Hours Contact</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Contact Name</label>
              <input name="after_hours_contact_name" type="text" className="input-dark w-full text-xs" value={form.after_hours_contact_name} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Contact Phone</label>
              <input name="after_hours_contact_phone" type="text" className="input-dark w-full text-xs" value={form.after_hours_contact_phone} onChange={handleChange} />
            </div>
          </div>

          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Utilities & Infrastructure</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Water Source</label>
              <select name="water_source" className="select-dark w-full text-xs" value={form.water_source} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Municipal">Municipal</option>
                <option value="Well">Well</option>
                <option value="Spring">Spring</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Septic / Sewer</label>
              <select name="septic_or_sewer" className="select-dark w-full text-xs" value={form.septic_or_sewer} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Sewer">Sewer</option>
                <option value="Septic">Septic</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Internet Provider</label>
              <input name="internet_provider" type="text" className="input-dark w-full text-xs" value={form.internet_provider} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Phone System Type</label>
              <input name="phone_system_type" type="text" className="input-dark w-full text-xs" value={form.phone_system_type} onChange={handleChange} />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Utility Shutoff Locations</label>
            <textarea name="utility_shutoff_locations" rows={2} className="input-dark w-full text-xs" placeholder="Gas, water, electric shutoff locations" value={form.utility_shutoff_locations} onChange={handleChange} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Dumpster Locations</label>
            <input name="dumpster_locations" type="text" className="input-dark w-full text-xs" value={form.dumpster_locations} onChange={handleChange} />
          </div>
        </div>
      )}

      {/* ===== PATROL TAB ===== */}
      {activeTab === 'patrol' && (
        <div className="space-y-4">
          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider">Patrol Settings</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Patrol Frequency</label>
              <select name="patrol_frequency" className="select-dark w-full text-xs" value={form.patrol_frequency} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Hourly">Hourly</option>
                <option value="Every 2 Hours">Every 2 Hours</option>
                <option value="Every 4 Hours">Every 4 Hours</option>
                <option value="Twice Daily">Twice Daily</option>
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
                <option value="As Needed">As Needed</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Patrol Priority</label>
              <select name="patrol_priority" className="select-dark w-full text-xs" value={form.patrol_priority} onChange={handleChange}>
                <option value="">-- Select --</option>
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Last Patrol Date</label>
              <input name="last_patrol_date" type="date" className="input-dark w-full text-xs" value={form.last_patrol_date} onChange={handleChange} />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Parking Lot Spaces</label>
              <input name="parking_lot_spaces" type="number" className="input-dark w-full text-xs" value={form.parking_lot_spaces} onChange={handleChange} />
            </div>
          </div>

          <div className="flex flex-wrap gap-6 py-2">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="parking_lot_gated" checked={form.parking_lot_gated as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">Parking Lot Gated</span>
            </label>
          </div>

          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Lighting</h3>
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Lighting Description</label>
            <textarea name="lighting_description" rows={2} className="input-dark w-full text-xs" placeholder="Exterior/interior lighting details" value={form.lighting_description} onChange={handleChange} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Lighting Timer</label>
            <input name="lighting_timer" type="text" className="input-dark w-full text-xs" placeholder="e.g. Dusk to dawn, 6pm-6am" value={form.lighting_timer} onChange={handleChange} />
          </div>

          <h3 className="text-xs font-bold text-rmpg-400 uppercase tracking-wider pt-3 border-t border-[#222]">Safety & Hazards</h3>
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Officer Caution Notes</label>
            <textarea name="officer_caution_notes" rows={2} className="input-dark w-full text-xs" placeholder="Safety warnings, known threats, special precautions" value={form.officer_caution_notes} onChange={handleChange} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Sensitive Areas</label>
            <textarea name="sensitive_areas" rows={2} className="input-dark w-full text-xs" placeholder="Server rooms, evidence storage, high-value areas" value={form.sensitive_areas} onChange={handleChange} />
          </div>

          <div className="flex flex-wrap gap-6 py-2">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="hazmat_on_site" checked={form.hazmat_on_site as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">HAZMAT on Site</span>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" name="weapons_on_premises" checked={form.weapons_on_premises as any} onChange={handleChange} className="accent-[#d4a017]" />
              <span className="text-rmpg-300">Weapons on Premises</span>
            </label>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">Problem Type Tags</label>
            <input name="problem_type_tags" type="text" className="input-dark w-full text-xs" placeholder="e.g. trespassing, vandalism, theft" value={form.problem_type_tags} onChange={handleChange} />
          </div>
        </div>
      )}
    </FormModal>
  );
}

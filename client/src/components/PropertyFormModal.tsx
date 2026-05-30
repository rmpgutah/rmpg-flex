import React, { useState, useEffect } from 'react';
import { Building2, MapPin, Shield, Key, Wrench, FileWarning, FileText } from 'lucide-react';
import FormModal from './FormModal';
import FormSection from './records/FormSection';
import FormField from './records/FormField';
import { useFormDraft } from '../hooks/useFormDraft';
import type { Property } from '../types';
import AddressAutocomplete, { type ParsedAddress } from './AddressAutocomplete';
import { formatPhoneInput } from '../utils/formatters';

import RichTextArea from './RichTextArea';
import { ALARM_SYSTEM_OPTIONS } from '../constants/lawEnforcementEnums';
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
  business_type: string;
  structure_type: string;
  occupancy_status: string;
  year_built: string;
  square_footage: string;
  number_of_stories: string;
  security_features: string;
  key_holder_name: string;
  key_holder_phone: string;
  key_holder_relationship: string;
  owner_name: string;
  owner_phone: string;
  last_inspection_date: string;
  inspection_status: string;
  alarm_company: string;
  alarm_account: string;
  // F5 advanced detail (alarm architecture)
  alarm_system: string;
  camera_system: string;
  parking_info: string;
  roof_access: string;
  utility_shutoffs: string;
  known_hazards: string;
  contact_email: string;
  secondary_contact_name: string;
  secondary_contact_phone: string;
  patrol_frequency: string;
  opening_hours: string;
  closing_hours: string;
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
  business_type: '',
  structure_type: '',
  occupancy_status: '',
  year_built: '',
  square_footage: '',
  number_of_stories: '',
  security_features: '',
  key_holder_name: '',
  key_holder_phone: '',
  key_holder_relationship: '',
  owner_name: '',
  owner_phone: '',
  last_inspection_date: '',
  inspection_status: '',
  alarm_company: '',
  alarm_account: '',
  alarm_system: '',
  camera_system: '',
  parking_info: '',
  roof_access: '',
  utility_shutoffs: '',
  known_hazards: '',
  contact_email: '',
  secondary_contact_name: '',
  secondary_contact_phone: '',
  patrol_frequency: '',
  opening_hours: '',
  closing_hours: '',
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

const BUSINESS_TYPE_OPTIONS = ['Office', 'Retail', 'Restaurant', 'Warehouse', 'Medical', 'Financial', 'Church', 'School', 'Government', 'Parking', 'Gas Station', 'Hotel', 'Bar/Nightclub', 'Gym/Fitness', 'Auto Dealer', 'Storage Facility', 'Construction Site', 'Other'];
const STRUCTURE_TYPE_OPTIONS = ['Single Building', 'Multi-Building Complex', 'High-Rise', 'Strip Mall', 'Shopping Center', 'Standalone', 'Warehouse', 'Open Lot', 'Gated Community', 'Other'];
const OCCUPANCY_OPTIONS = ['Occupied', 'Vacant', 'Seasonal', 'Under Construction', 'Condemned', 'Partially Occupied', 'Unknown'];
const SECURITY_FEATURES_OPTIONS = ['None', 'Cameras', 'Alarm System', 'Guard Service', 'Fenced', 'Gated', 'Key Card Access', 'Cameras + Alarm', 'Full Security Suite', 'Other'];
const INSPECTION_STATUS_OPTIONS = ['Current', 'Expired', 'Pending', 'Failed', 'Not Required', 'Unknown'];
const CAMERA_SYSTEM_OPTIONS = ['None', 'Analog CCTV', 'IP/Network', 'Cloud-Based', 'Ring/Doorbell', 'Body Worn', 'Unknown'];
const ROOF_ACCESS_OPTIONS = ['None', 'Ladder', 'Stairwell', 'Hatch', 'Fire Escape', 'Elevator', 'Unknown'];
const PATROL_FREQUENCY_OPTIONS = ['Every 15 min', 'Every 30 min', 'Every Hour', 'Every 2 Hours', 'Every 4 Hours', 'Twice Per Shift', 'Once Per Shift', 'As Needed', 'Continuous', 'Other'];

export default function PropertyFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  editingProperty,
  clients = [],
  submitError,
}: PropertyFormModalProps) {
  const {
    form,
    setForm,
    isDirty,
    wasRestored,
    clearDraft,
    snapshot,
  } = useFormDraft<PropertyFormData>({
    storageKey: 'rmpg_property_form',
    defaultValue: EMPTY_FORM,
    isActive: isOpen,
  });

  useEffect(() => {
    if (isOpen) {
      if (editingProperty) {
        const initial: PropertyFormData = {
          name: editingProperty.name || '',
          address: editingProperty.address || '',
          city: editingProperty.city || '',
          state: editingProperty.state || 'UT',
          zip: editingProperty.zip || '',
          client_id: editingProperty.client_id || '',
          property_type: editingProperty.property_type || '',
          gate_code: editingProperty.gate_code || '',
          alarm_code: editingProperty.alarm_code || '',
          emergency_contact: editingProperty.emergency_contact || '',
          post_orders: editingProperty.post_orders || '',
          hazard_notes: editingProperty.hazard_notes || '',
          access_instructions: editingProperty.access_instructions || '',
          latitude: editingProperty.latitude != null ? String(editingProperty.latitude) : '',
          longitude: editingProperty.longitude != null ? String(editingProperty.longitude) : '',
          is_active: editingProperty.is_active ?? true,
          notes: (editingProperty as any).notes || '',
          business_type: (editingProperty as any).business_type || '',
          structure_type: (editingProperty as any).structure_type || '',
          occupancy_status: (editingProperty as any).occupancy_status || '',
          year_built: (editingProperty as any).year_built || '',
          square_footage: (editingProperty as any).square_footage || '',
          number_of_stories: (editingProperty as any).number_of_stories || '',
          security_features: (editingProperty as any).security_features || '',
          key_holder_name: (editingProperty as any).key_holder_name || '',
          key_holder_phone: (editingProperty as any).key_holder_phone || '',
          key_holder_relationship: (editingProperty as any).key_holder_relationship || '',
          owner_name: (editingProperty as any).owner_name || '',
          owner_phone: (editingProperty as any).owner_phone || '',
          last_inspection_date: (editingProperty as any).last_inspection_date || '',
          inspection_status: (editingProperty as any).inspection_status || '',
          alarm_company: (editingProperty as any).alarm_company || '',
          alarm_account: (editingProperty as any).alarm_account || '',
          alarm_system: (editingProperty as any).alarm_system || '',
          camera_system: (editingProperty as any).camera_system || '',
          parking_info: (editingProperty as any).parking_info || '',
          roof_access: (editingProperty as any).roof_access || '',
          utility_shutoffs: (editingProperty as any).utility_shutoffs || '',
          known_hazards: (editingProperty as any).known_hazards || '',
          contact_email: (editingProperty as any).contact_email || '',
          secondary_contact_name: (editingProperty as any).secondary_contact_name || '',
          secondary_contact_phone: (editingProperty as any).secondary_contact_phone || '',
          patrol_frequency: (editingProperty as any).patrol_frequency || '',
          opening_hours: (editingProperty as any).opening_hours || '',
          closing_hours: (editingProperty as any).closing_hours || '',
        };
        setForm(initial);
        snapshot();
      } else {
        setForm(EMPTY_FORM);
        snapshot();
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
      draftRestored={wasRestored}
      onDiscardDraft={clearDraft}
    >
      {/* Submit Error */}
      {submitError && (
        <div className="px-3 py-2 -mt-2 mb-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">
          {submitError}
        </div>
      )}

      {/* Address / Client */}
      <FormSection title="Address & Client" icon={MapPin}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormField label="Property Name" required className="sm:col-span-3">
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
          </FormField>
          <FormField label="Address" required className="sm:col-span-3">
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
                  address: addr.formatted || addr.street,
                  city: addr.city || prev.city,
                  state: addr.state || prev.state,
                  zip: addr.zip || prev.zip,
                  latitude: (addr.latitude as any) ?? prev.latitude,
                  longitude: (addr.longitude as any) ?? prev.longitude,
                }));
              }}
            />
          </FormField>
          <FormField label="City">
            <input
              name="city"
              type="text"
              className="input-dark w-full text-xs"
              value={form.city}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="State">
            <select name="state" className="select-dark w-full text-xs" value={form.state} onChange={handleChange}>
              {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </FormField>
          <FormField label="Zip">
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
          </FormField>
          <FormField label="Client">
            <select name="client_id" className="select-dark w-full text-xs" value={form.client_id} onChange={handleChange}>
              <option value="">No Client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Latitude">
            <input
              name="latitude"
              type="text"
              className="input-dark w-full text-xs"
              placeholder="e.g. 40.7608"
              value={form.latitude}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="Longitude">
            <input
              name="longitude"
              type="text"
              className="input-dark w-full text-xs"
              placeholder="e.g. -111.8910"
              value={form.longitude}
              onChange={handleChange}
            />
          </FormField>
        </div>
      </FormSection>

      {/* Property Details */}
      <FormSection title="Property Details" icon={Building2}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormField label="Property Type">
            <select name="property_type" className="select-dark w-full text-xs" value={form.property_type} onChange={handleChange}>
              <option value="">-- Select --</option>
              {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Business Type">
            <select name="business_type" className="select-dark w-full text-xs" value={form.business_type} onChange={handleChange}>
              <option value="">-- Select --</option>
              {BUSINESS_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Structure Type">
            <select name="structure_type" className="select-dark w-full text-xs" value={form.structure_type} onChange={handleChange}>
              <option value="">-- Select --</option>
              {STRUCTURE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Occupancy Status">
            <select name="occupancy_status" className="select-dark w-full text-xs" value={form.occupancy_status} onChange={handleChange}>
              <option value="">-- Select --</option>
              {OCCUPANCY_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Year Built">
            <input
              name="year_built"
              type="text"
              className="input-dark w-full text-xs"
              placeholder="e.g. 2005"
              value={form.year_built}
              onChange={handleChange}
              maxLength={4}
            />
          </FormField>
          <FormField label="Square Footage">
            <input
              name="square_footage"
              type="text"
              className="input-dark w-full text-xs"
              placeholder="e.g. 12000"
              value={form.square_footage}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="Number of Stories">
            <input
              name="number_of_stories"
              type="text"
              className="input-dark w-full text-xs"
              placeholder="e.g. 3"
              value={form.number_of_stories}
              onChange={handleChange}
            />
          </FormField>
        </div>
      </FormSection>

      {/* Security & Access */}
      <FormSection title="Security & Access" icon={Shield} accent="amber">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormField label="Gate Code">
            <input
              name="gate_code"
              type="text"
              className="input-dark w-full text-xs"
              placeholder="e.g. #1234"
              value={form.gate_code}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="Alarm Code">
            <input
              name="alarm_code"
              type="text"
              className="input-dark w-full text-xs"
              placeholder="e.g. 5678"
              value={form.alarm_code}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="Emergency Contact">
            <input
              name="emergency_contact"
              type="text"
              className="input-dark w-full text-xs"
              placeholder="Name / Phone"
              value={form.emergency_contact}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="Security Features">
            <select name="security_features" className="select-dark w-full text-xs" value={form.security_features} onChange={handleChange}>
              <option value="">-- Select --</option>
              {SECURITY_FEATURES_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Camera System">
            <select name="camera_system" className="select-dark w-full text-xs" value={form.camera_system} onChange={handleChange}>
              <option value="">-- Select --</option>
              {CAMERA_SYSTEM_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Roof Access">
            <select name="roof_access" className="select-dark w-full text-xs" value={form.roof_access} onChange={handleChange}>
              <option value="">-- Select --</option>
              {ROOF_ACCESS_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Alarm System">
            <select
              name="alarm_system"
              className="select-dark w-full text-xs"
              value={form.alarm_system}
              onChange={handleChange}
            >
              <option value="">-- Select --</option>
              {ALARM_SYSTEM_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </FormField>
          <FormField label="Alarm Company">
            <input
              name="alarm_company"
              type="text"
              className="input-dark w-full text-xs"
              placeholder="e.g. ADT, Vivint"
              value={form.alarm_company}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="Alarm Account #">
            <input
              name="alarm_account"
              type="text"
              className="input-dark w-full text-xs"
              placeholder="Account number"
              value={form.alarm_account}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="Parking Info" className="sm:col-span-3">
            <RichTextArea
              name="parking_info"
              rows={2}
              className="input-dark w-full text-xs"
              placeholder="Parking layout, reserved spots, lot access"
              value={form.parking_info}
              onChange={handleChange}
            />
          </FormField>
        </div>
      </FormSection>

      {/* Key Holder & Owner */}
      <FormSection title="Key Holder & Owner" icon={Key}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormField label="Key Holder Name">
            <input
              name="key_holder_name"
              type="text"
              className="input-dark w-full text-xs"
              placeholder="Full name"
              value={form.key_holder_name}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="Key Holder Phone">
            <input
              name="key_holder_phone"
              type="tel"
              className="input-dark w-full text-xs"
              placeholder="(801) 555-0100"
              value={form.key_holder_phone}
              onChange={(e) => setForm(prev => ({ ...prev, key_holder_phone: formatPhoneInput(e.target.value) }))}
            />
          </FormField>
          <FormField label="Key Holder Relationship">
            <input
              name="key_holder_relationship"
              type="text"
              className="input-dark w-full text-xs"
              placeholder="e.g. Property Manager"
              value={form.key_holder_relationship}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="Secondary Contact Name">
            <input
              name="secondary_contact_name"
              type="text"
              className="input-dark w-full text-xs"
              placeholder="Backup contact name"
              value={form.secondary_contact_name}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="Secondary Contact Phone">
            <input
              name="secondary_contact_phone"
              type="tel"
              className="input-dark w-full text-xs"
              placeholder="(801) 555-0200"
              value={form.secondary_contact_phone}
              onChange={(e) => setForm(prev => ({ ...prev, secondary_contact_phone: formatPhoneInput(e.target.value) }))}
            />
          </FormField>
          <FormField label="Contact Email">
            <input
              name="contact_email"
              type="email"
              className="input-dark w-full text-xs"
              placeholder="Primary contact email"
              value={form.contact_email}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="Owner Name">
            <input
              name="owner_name"
              type="text"
              className="input-dark w-full text-xs"
              placeholder="Property owner full name"
              value={form.owner_name}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="Owner Phone">
            <input
              name="owner_phone"
              type="tel"
              className="input-dark w-full text-xs"
              placeholder="(801) 555-0100"
              value={form.owner_phone}
              onChange={(e) => setForm(prev => ({ ...prev, owner_phone: formatPhoneInput(e.target.value) }))}
            />
          </FormField>
        </div>
      </FormSection>

      {/* Patrol Operations */}
      <FormSection title="Patrol Operations" icon={Shield}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormField label="Patrol Frequency">
            <select name="patrol_frequency" className="select-dark w-full text-xs" value={form.patrol_frequency} onChange={handleChange}>
              <option value="">-- Select --</option>
              {PATROL_FREQUENCY_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
          <FormField label="Opening Hours">
            <input
              name="opening_hours"
              type="text"
              className="input-dark w-full text-xs"
              placeholder="e.g. 08:00"
              value={form.opening_hours}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="Closing Hours">
            <input
              name="closing_hours"
              type="text"
              className="input-dark w-full text-xs"
              placeholder="e.g. 22:00"
              value={form.closing_hours}
              onChange={handleChange}
            />
          </FormField>
        </div>
      </FormSection>

      {/* Inspection */}
      <FormSection title="Inspection" icon={Wrench}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label="Last Inspection Date">
            <input
              name="last_inspection_date"
              type="date"
              className="input-dark w-full text-xs"
              value={form.last_inspection_date}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="Inspection Status">
            <select name="inspection_status" className="select-dark w-full text-xs" value={form.inspection_status} onChange={handleChange}>
              <option value="">-- Select --</option>
              {INSPECTION_STATUS_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </FormField>
        </div>
      </FormSection>

      {/* Post Orders */}
      <FormSection title="Post Orders" icon={Shield}>
        <FormField label="Post Orders">
          <RichTextArea
            name="post_orders"
            rows={3}
            className="input-dark w-full text-xs"
            placeholder="Standing instructions for officers at this property"
            value={form.post_orders}
            onChange={handleChange}
            maxLength={5000}
          />
          <div className="text-[9px] text-rmpg-500 text-right mt-0.5">{form.post_orders.length}/5000</div>
        </FormField>
      </FormSection>

      {/* Hazard Notes */}
      <FormSection title="Hazard Notes" icon={FileWarning} accent="red">
        <div className="space-y-4">
          <FormField label="Hazard Notes">
            <RichTextArea
              name="hazard_notes"
              rows={3}
              className="input-dark w-full text-xs"
              placeholder="Known hazards, safety concerns, or officer caution notes"
              value={form.hazard_notes}
              onChange={handleChange}
              maxLength={3000}
            />
            <div className="text-[9px] text-rmpg-500 text-right mt-0.5">{form.hazard_notes.length}/3000</div>
          </FormField>
          <FormField label="Utility Shutoffs">
            <RichTextArea
              name="utility_shutoffs"
              rows={2}
              className="input-dark w-full text-xs"
              placeholder="Gas, water, electric shutoff locations"
              value={form.utility_shutoffs}
              onChange={handleChange}
            />
          </FormField>
          <FormField label="Known Hazards">
            <RichTextArea
              name="known_hazards"
              rows={2}
              className="input-dark w-full text-xs"
              placeholder="Chemical storage, structural issues, aggressive animals, etc."
              value={form.known_hazards}
              onChange={handleChange}
            />
          </FormField>
        </div>
      </FormSection>

      {/* Access Instructions */}
      <FormSection title="Access Instructions" icon={MapPin}>
        <FormField label="Access Instructions">
          <RichTextArea
            name="access_instructions"
            rows={2}
            className="input-dark w-full text-xs"
            placeholder="How to access the property, key locations, entry points"
            value={form.access_instructions}
            onChange={handleChange}
          />
        </FormField>
      </FormSection>

      {/* Notes */}
      <FormSection title="Notes" icon={FileText}>
        <FormField label="Notes">
          <RichTextArea
            name="notes"
            rows={2}
            className="input-dark w-full text-xs"
            value={form.notes}
            onChange={handleChange}
          />
        </FormField>
        <div className="flex items-center gap-3 pt-3">
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
      </FormSection>
    </FormModal>
  );
}

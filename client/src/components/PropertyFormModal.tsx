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
  const { isDirty, snapshot } = useFormDirty(form, isOpen);

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
    </FormModal>
  );
}

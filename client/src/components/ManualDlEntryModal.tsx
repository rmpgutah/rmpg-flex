// ============================================================
// Manual DL Entry Modal
// Officers input DL/person data from physical license
// examination during field contacts.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { CreditCard } from 'lucide-react';
import FormModal from './FormModal';
import { useFormDraft } from '../hooks/useFormDraft';
import AddressAutocomplete from './AddressAutocomplete';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
  'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

const DL_STATUS_OPTIONS = ['VALID', 'EXPIRED', 'SUSPENDED', 'REVOKED', 'CANCELLED', 'UNKNOWN'];
const GENDER_OPTIONS = [
  { value: 'M', label: 'Male' },
  { value: 'F', label: 'Female' },
  { value: 'X', label: 'Non-Binary' },
];
const EYE_COLOR_OPTIONS = ['BLK', 'BLU', 'BRO', 'GRY', 'GRN', 'HAZ', 'MAR', 'MUL', 'PNK'];
const HAIR_COLOR_OPTIONS = ['BLK', 'BLN', 'BRO', 'GRY', 'RED', 'SDY', 'WHI'];
const RACE_OPTIONS = [
  { value: 'W', label: 'White' },
  { value: 'B', label: 'Black' },
  { value: 'H', label: 'Hispanic' },
  { value: 'A', label: 'Asian' },
  { value: 'I', label: 'American Indian' },
  { value: 'P', label: 'Pacific Islander' },
  { value: 'U', label: 'Unknown' },
];

export interface ManualDlFormData {
  dl_number: string;
  dl_state: string;
  dl_class: string;
  dl_status: string;
  dl_expiration: string;
  dl_issue_date: string;
  dl_restrictions: string;
  dl_endorsements: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  suffix: string;
  date_of_birth: string;
  gender: string;
  height: string;
  weight: string;
  eye_color: string;
  hair_color: string;
  race: string;
  address: string;
  address2: string;
  city: string;
  address_state: string;
  postal_code: string;
}

const EMPTY_FORM: ManualDlFormData = {
  dl_number: '', dl_state: 'UT', dl_class: 'D', dl_status: 'VALID',
  dl_expiration: '', dl_issue_date: '', dl_restrictions: '', dl_endorsements: '',
  first_name: '', middle_name: '', last_name: '', suffix: '',
  date_of_birth: '', gender: '', height: '', weight: '',
  eye_color: '', hair_color: '', race: '',
  address: '', address2: '', city: '', address_state: 'UT', postal_code: '',
};

interface ManualDlEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ManualDlFormData) => void;
  isSubmitting: boolean;
}

export default function ManualDlEntryModal({ isOpen, onClose, onSubmit, isSubmitting }: ManualDlEntryModalProps) {
  const {
    form,
    setForm,
    isDirty,
    wasRestored,
    clearDraft,
    snapshot,
  } = useFormDraft<ManualDlFormData>({
    storageKey: 'rmpg_manual_dl_entry_form',
    defaultValue: { ...EMPTY_FORM },
    isActive: isOpen,
  });

  useEffect(() => {
    if (isOpen) {
      const initial = { ...EMPTY_FORM };
      setForm(initial);
      snapshot();
    }
  }, [isOpen, snapshot]);

  const set = useCallback((field: keyof ManualDlFormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  }, [form, onSubmit]);

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title="Manual DL Entry"
      icon={CreditCard}
      submitLabel="Save DL Record"
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      draftRestored={wasRestored}
      onDiscardDraft={clearDraft}
      maxWidth="max-w-3xl"
    >
      {/* License Information */}
      <fieldset>
        <legend className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider mb-2">License Information</legend>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="field-label">DL Number *</label>
            <input className="input-dark w-full" value={form.dl_number} onChange={e => set('dl_number', e.target.value)} required />
          </div>
          <div>
            <label className="field-label">State *</label>
            <select className="select-dark w-full" value={form.dl_state} onChange={e => set('dl_state', e.target.value)} required>
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Class</label>
            <input className="input-dark w-full" value={form.dl_class} onChange={e => set('dl_class', e.target.value)} placeholder="D" />
          </div>
          <div>
            <label className="field-label">Status</label>
            <select className="select-dark w-full" value={form.dl_status} onChange={e => set('dl_status', e.target.value)}>
              <option value="">—</option>
              {DL_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Expiration</label>
            <input className="input-dark w-full" type="date" value={form.dl_expiration} onChange={e => set('dl_expiration', e.target.value)} />
          </div>
          <div>
            <label className="field-label">Issue Date</label>
            <input className="input-dark w-full" type="date" value={form.dl_issue_date} onChange={e => set('dl_issue_date', e.target.value)} />
          </div>
          <div>
            <label className="field-label">Restrictions</label>
            <input className="input-dark w-full" value={form.dl_restrictions} onChange={e => set('dl_restrictions', e.target.value)} placeholder="NONE" />
          </div>
          <div>
            <label className="field-label">Endorsements</label>
            <input className="input-dark w-full" value={form.dl_endorsements} onChange={e => set('dl_endorsements', e.target.value)} placeholder="NONE" />
          </div>
        </div>
      </fieldset>

      {/* Subject Information */}
      <fieldset>
        <legend className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider mb-2">Subject Information</legend>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="field-label">Last Name *</label>
            <input className="input-dark w-full" value={form.last_name} onChange={e => set('last_name', e.target.value)} required />
          </div>
          <div>
            <label className="field-label">First Name *</label>
            <input className="input-dark w-full" value={form.first_name} onChange={e => set('first_name', e.target.value)} required />
          </div>
          <div>
            <label className="field-label">Middle Name</label>
            <input className="input-dark w-full" value={form.middle_name} onChange={e => set('middle_name', e.target.value)} />
          </div>
          <div>
            <label className="field-label">Suffix</label>
            <input className="input-dark w-full" value={form.suffix} onChange={e => set('suffix', e.target.value)} placeholder="Jr, Sr, III" />
          </div>
          <div>
            <label className="field-label">DOB</label>
            <input className="input-dark w-full" type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} />
          </div>
          <div>
            <label className="field-label">Gender</label>
            <select className="select-dark w-full" value={form.gender} onChange={e => set('gender', e.target.value)}>
              <option value="">—</option>
              {GENDER_OPTIONS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Height</label>
            <input className="input-dark w-full" value={form.height} onChange={e => set('height', e.target.value)} placeholder="510" />
          </div>
          <div>
            <label className="field-label">Weight</label>
            <input className="input-dark w-full" value={form.weight} onChange={e => set('weight', e.target.value)} placeholder="180" />
          </div>
          <div>
            <label className="field-label">Eye Color</label>
            <select className="select-dark w-full" value={form.eye_color} onChange={e => set('eye_color', e.target.value)}>
              <option value="">—</option>
              {EYE_COLOR_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Hair Color</label>
            <select className="select-dark w-full" value={form.hair_color} onChange={e => set('hair_color', e.target.value)}>
              <option value="">—</option>
              {HAIR_COLOR_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Race</label>
            <select className="select-dark w-full" value={form.race} onChange={e => set('race', e.target.value)}>
              <option value="">—</option>
              {RACE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
        </div>
      </fieldset>

       {/* Address */}
       <fieldset>
         <legend className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider mb-2">Address</legend>
         <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
           <div className="col-span-2">
             <label className="field-label">Street Address</label>
             <AddressAutocomplete
               value={form.address}
               onChange={(value) => set('address', value)}
               placeholder="Enter street address..."
               className="input-dark w-full"
               name="address"
               onSelect={(addr) => {
                 // Auto-fill related fields when address is selected
                 set('address', addr.formatted);
                 set('city', addr.city);
                 set('address_state', addr.state);
                 set('postal_code', addr.zip);
               }}
             />
           </div>
           <div>
             <label className="field-label">Apt / Unit</label>
             <input className="input-dark w-full" value={form.address2} onChange={e => set('address2', e.target.value)} />
           </div>
           <div>
             <label className="field-label">City</label>
             <input className="input-dark w-full" value={form.city} onChange={e => set('city', e.target.value)} />
           </div>
           <div>
             <label className="field-label">State</label>
             <select className="select-dark w-full" value={form.address_state} onChange={e => set('address_state', e.target.value)}>
               {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
             </select>
           </div>
           <div>
             <label className="field-label">ZIP</label>
             <input className="input-dark w-full" value={form.postal_code} onChange={e => set('postal_code', e.target.value)} placeholder="84101" />
           </div>
         </div>
       </fieldset>
    </FormModal>
  );
}

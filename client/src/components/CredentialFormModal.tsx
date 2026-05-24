import React, { useState, useEffect } from 'react';
import { Award } from 'lucide-react';
import FormModal from './FormModal';
import { useFormDraft } from '../hooks/useFormDraft';

import RichTextArea from './RichTextArea';
export interface CredentialFormData {
  officer_id: string;
  credential_type: string;
  credential_number: string;
  issuing_authority: string;
  issued_date: string;
  expiry_date: string;
  notes: string;
}

interface CredentialFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: CredentialFormData) => void;
  isSubmitting: boolean;
  officers: { id: string; name: string }[];
  initialData?: Partial<CredentialFormData> & { id?: string };
  mode?: 'create' | 'edit';
}

const EMPTY_FORM: CredentialFormData = {
  officer_id: '',
  credential_type: '',
  credential_number: '',
  issuing_authority: '',
  issued_date: '',
  expiry_date: '',
  notes: '',
};

const CREDENTIAL_TYPES = [
  'Guard Card',
  'Armed Guard Permit',
  'Firearms Permit',
  'First Aid/CPR',
  'AED Certification',
  'Taser Certification',
  'OC Spray Certification',
  'Baton Certification',
  'Handcuff Certification',
  'Defensive Tactics',
  'Driver Safety',
  'Supervisor Certification',
  'Field Training Officer',
  'De-Escalation Training',
  'Active Shooter Response',
  'HAZMAT Awareness',
  'Blood-Borne Pathogens',
  'Crowd Control',
  'Report Writing',
  'Radio Operations',
  'State License',
  'Other',
];

export default function CredentialFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  officers,
  initialData,
  mode = 'create',
}: CredentialFormModalProps) {
  const {
    form,
    setForm,
    isDirty,
    wasRestored,
    clearDraft,
    snapshot,
  } = useFormDraft<CredentialFormData>({
    storageKey: 'rmpg_credential_form',
    defaultValue: EMPTY_FORM,
    isActive: isOpen,
  });

  useEffect(() => {
    if (isOpen && initialData) {
      const initial: CredentialFormData = {
        officer_id: initialData.officer_id || '',
        credential_type: initialData.credential_type || '',
        credential_number: initialData.credential_number || '',
        issuing_authority: initialData.issuing_authority || '',
        issued_date: initialData.issued_date || '',
        expiry_date: initialData.expiry_date || '',
        notes: initialData.notes || '',
      };
      setForm(initial);
      snapshot();
    } else if (isOpen && !initialData) {
      setForm(EMPTY_FORM);
      snapshot();
    }
  }, [isOpen, initialData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  const handleClose = () => {
    clearDraft();
    onClose();
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={handleClose}
      onSubmit={handleSubmit}
      title={mode === 'edit' ? 'Edit Credential' : 'Add Credential'}
      icon={Award}
      submitLabel={mode === 'edit' ? 'Update Credential' : 'Add Credential'}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
      draftRestored={wasRestored}
      onDiscardDraft={clearDraft}
    >
      {/* Officer */}
      <div>
        <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
          Officer <span className="text-red-400">*</span>
        </label>
        <select
          required
          value={form.officer_id}
          onChange={(e) => setForm((prev) => ({ ...prev, officer_id: e.target.value }))}
          className="w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500"
          disabled={mode === 'edit'}
        >
          <option value="">Select officer...</option>
          {officers.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>

      {/* Credential Type */}
      <div>
        <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
          Credential Type <span className="text-red-400">*</span>
        </label>
        <select
          required
          value={form.credential_type}
          onChange={(e) => setForm((prev) => ({ ...prev, credential_type: e.target.value }))}
          className="w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500"
        >
          <option value="">Select type...</option>
          {CREDENTIAL_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Number / Authority */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
            Credential Number
          </label>
          <input
            type="text"
            value={form.credential_number}
            onChange={(e) => setForm((prev) => ({ ...prev, credential_number: e.target.value }))}
            placeholder="License/Cert #"
            className="w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
            Issuing Authority
          </label>
          <input
            type="text"
            value={form.issuing_authority}
            onChange={(e) => setForm((prev) => ({ ...prev, issuing_authority: e.target.value }))}
            placeholder="e.g. State of Utah"
            className="w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {/* Dates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
            Issued Date
          </label>
          <input
            type="date"
            value={form.issued_date}
            onChange={(e) => setForm((prev) => ({ ...prev, issued_date: e.target.value }))}
            className="w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
            Expiry Date
          </label>
          <input
            type="date"
            value={form.expiry_date}
            onChange={(e) => setForm((prev) => ({ ...prev, expiry_date: e.target.value }))}
            className="w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1">
          Notes
        </label>
        <RichTextArea
          value={form.notes}
          onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
          rows={3}
          placeholder="Additional notes..."
          maxLength={2000}
          className="w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500 resize-none"
        />
        <div className="text-[9px] text-rmpg-500 text-right mt-0.5">{form.notes.length}/2000</div>
      </div>
    </FormModal>
  );
}

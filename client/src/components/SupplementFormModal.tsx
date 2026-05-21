import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import FormModal from './FormModal';
import { useFormDraft } from '../hooks/useFormDraft';
import type { SupplementalReportType } from '../types';

export interface SupplementFormData {
  report_type: SupplementalReportType;
  subject: string;
  narrative: string;
}

interface SupplementFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: SupplementFormData) => Promise<void>;
  isSubmitting: boolean;
  incidentNumber: string;
}

const EMPTY_FORM: SupplementFormData = {
  report_type: 'supplemental',
  subject: '',
  narrative: '',
};

const REPORT_TYPES: { value: SupplementalReportType; label: string }[] = [
  { value: 'supplemental', label: 'Supplemental Report' },
  { value: 'follow_up', label: 'Follow-Up Report' },
  { value: 'witness_statement', label: 'Witness Statement' },
  { value: 'forensic', label: 'Forensic Report' },
  { value: 'supervisor_review', label: 'Supervisor Review' },
];

export default function SupplementFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  incidentNumber,
}: SupplementFormModalProps) {
  const {
    form,
    setForm,
    isDirty,
    wasRestored,
    clearDraft,
    snapshot,
  } = useFormDraft<SupplementFormData>({
    storageKey: 'rmpg_supplement_form',
    defaultValue: EMPTY_FORM,
    isActive: isOpen,
  });

  React.useEffect(() => {
    if (isOpen) {
      setForm(EMPTY_FORM);
      snapshot();
    }
  }, [isOpen, snapshot]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await onSubmit(form);
      clearDraft();
    } catch {
      // Keep form data on failure so user can retry
    }
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title={`NEW SUPPLEMENT — ${incidentNumber}`}
      icon={FileText}
      submitLabel="Create Supplement"
      isSubmitting={isSubmitting}
      maxWidth="max-w-xl"
      isDirty={isDirty}
      draftRestored={wasRestored}
      onDiscardDraft={clearDraft}
    >
      <div className="space-y-3">
        <div>
          <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-1">Report Type</label>
          <select
            className="select-dark w-full text-[11px]"
            value={form.report_type}
            onChange={(e) => setForm((prev) => ({ ...prev, report_type: e.target.value as SupplementalReportType }))}
          >
            {REPORT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-1">Subject *</label>
          <input
            className="input-dark w-full text-[11px]"
            value={form.subject}
            onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
            placeholder="Brief subject of this supplement"
            required
            autoFocus
            maxLength={200}
          />
        </div>
        <div>
          <label className="text-[9px] text-rmpg-500 uppercase font-semibold block mb-1">Narrative *</label>
          <textarea
            className="textarea-dark w-full text-[11px]"
            rows={10}
            value={form.narrative}
            onChange={(e) => setForm((prev) => ({ ...prev, narrative: e.target.value }))}
            placeholder="Enter detailed narrative..."
            required
            maxLength={10000}
          />
          <div className="text-[9px] text-rmpg-500 text-right mt-0.5">{form.narrative.length}/10000</div>
        </div>
      </div>
    </FormModal>
  );
}

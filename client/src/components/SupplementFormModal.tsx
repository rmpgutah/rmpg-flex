import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import FormModal from './FormModal';
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
  const [reportType, setReportType] = useState<SupplementalReportType>('supplemental');
  const [subject, setSubject] = useState('');
  const [narrative, setNarrative] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({ report_type: reportType, subject, narrative });
    setReportType('supplemental');
    setSubject('');
    setNarrative('');
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
    >
      <div className="space-y-3">
        <div>
          <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-1">Report Type</label>
          <select
            className="select-dark w-full text-[11px]"
            value={reportType}
            onChange={(e) => setReportType(e.target.value as SupplementalReportType)}
          >
            {REPORT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-1">Subject *</label>
          <input
            className="input-dark w-full text-[11px]"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Brief subject of this supplement"
            required
          />
        </div>
        <div>
          <label className="text-[9px] text-gray-500 uppercase font-semibold block mb-1">Narrative *</label>
          <textarea
            className="textarea-dark w-full text-[11px]"
            rows={10}
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            placeholder="Enter detailed narrative..."
            required
          />
        </div>
      </div>
    </FormModal>
  );
}

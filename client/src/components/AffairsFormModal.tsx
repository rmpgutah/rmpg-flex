import React, { useState, useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';
import FormModal from '../components/FormModal';
import { useFormDraft } from '../hooks/useFormDraft';

export interface AffairsFormData {
  complainant_name: string; complainant_contact: string;
  subject_officer_id: string; complaint_type: string;
  description: string; incident_date: string;
  incident_location: string; witnesses: string;
  status: string; finding: string; discipline: string;
}

interface AffairsFormModalProps {
  isOpen: boolean; onClose: () => void; onSubmit: (d: AffairsFormData) => void;
  isSubmitting: boolean; editingRecord?: any; submitError?: string | null;
}

const EMPTY_FORM: AffairsFormData = {
  complainant_name: '', complainant_contact: '',
  subject_officer_id: '', complaint_type: 'other',
  description: '', incident_date: '',
  incident_location: '', witnesses: '',
  status: 'received', finding: '', discipline: '',
};

export default function AffairsFormModal({ isOpen, onClose, onSubmit, isSubmitting, editingRecord, submitError }: AffairsFormModalProps) {
  const { form, setForm, isDirty, wasRestored, clearDraft, snapshot } = useFormDraft<AffairsFormData>({
    storageKey: 'rmpg_affairs_form', defaultValue: EMPTY_FORM, isActive: isOpen,
  });

  useEffect(() => {
    if (isOpen) {
      if (editingRecord) {
        const r = editingRecord;
        setForm({
          complainant_name: r.complainant_name || '', complainant_contact: r.complainant_contact || '',
          subject_officer_id: r.subject_officer_id ? String(r.subject_officer_id) : '',
          complaint_type: r.complaint_type || 'other', description: r.description || '',
          incident_date: r.incident_date || '', incident_location: r.incident_location || '',
          witnesses: r.witnesses || '', status: r.status || 'received',
          finding: r.finding || '', discipline: r.discipline || '',
        });
      } else { setForm({ ...EMPTY_FORM }); }
      snapshot();
    }
  }, [isOpen, editingRecord]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  return (
    <FormModal isOpen={isOpen} onClose={onClose} onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}
      title={editingRecord ? 'Edit Complaint' : 'New Complaint'} icon={ShieldAlert}
      submitLabel={editingRecord ? 'Update' : 'Create'} isSubmitting={isSubmitting}
      isDirty={isDirty} draftRestored={wasRestored} onDiscardDraft={clearDraft}
    >
      {submitError && <div className="px-3 py-2 -mt-2 mb-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">{submitError}</div>}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Complainant Name</label>
            <input name="complainant_name" className="input-dark mt-1" value={form.complainant_name} onChange={handleChange} autoFocus /></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Contact</label>
            <input name="complainant_contact" className="input-dark mt-1" value={form.complainant_contact} onChange={handleChange} /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Complaint Type</label>
            <select name="complaint_type" className="select-dark mt-1" value={form.complaint_type} onChange={handleChange}>
              {['excessive_force','discourtesy','dishonesty','policy_violation','criminal','other'].map(t=>
                <option key={t} value={t}>{t.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>)}
            </select></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Officer ID</label>
            <input name="subject_officer_id" type="number" className="input-dark mt-1" value={form.subject_officer_id} onChange={handleChange} /></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Status</label>
            <select name="status" className="select-dark mt-1" value={form.status} onChange={handleChange}>
              {['received','assigned','under_investigation','sustained','not_sustained','exonerated','unfounded','closed'].map(s=>
                <option key={s} value={s}>{s.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>)}
            </select></div>
        </div>
        <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Incident Date</label>
          <input name="incident_date" type="date" className="input-dark mt-1" value={form.incident_date} onChange={handleChange} /></div>
        <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Location</label>
          <input name="incident_location" className="input-dark mt-1" value={form.incident_location} onChange={handleChange} /></div>
        <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Description <span className="text-red-500">*</span></label>
          <textarea name="description" rows={4} className="input-dark mt-1" value={form.description} onChange={handleChange} /></div>
        <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Witnesses</label>
          <textarea name="witnesses" rows={2} className="input-dark mt-1" value={form.witnesses} onChange={handleChange} /></div>
        {editingRecord && (<>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Finding</label>
            <textarea name="finding" rows={2} className="input-dark mt-1" value={form.finding} onChange={handleChange} /></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Discipline</label>
            <input name="discipline" className="input-dark mt-1" value={form.discipline} onChange={handleChange} /></div>
        </>)}
      </div>
    </FormModal>
  );
}

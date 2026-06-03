import React, { useState, useEffect } from 'react';
import { DollarSign } from 'lucide-react';
import FormModal from '../components/FormModal';
import { useFormDraft } from '../hooks/useFormDraft';

export interface BillingFormData {
  client_id: string; contract_id: string; tax_rate: string;
  due_date: string; status: string; notes: string;
}

interface BillingFormModalProps {
  isOpen: boolean; onClose: () => void; onSubmit: (d: BillingFormData) => void;
  isSubmitting: boolean; editingRecord?: any; submitError?: string | null;
}

const EMPTY_FORM: BillingFormData = {
  client_id: '', contract_id: '', tax_rate: '0',
  due_date: '', status: 'draft', notes: '',
};

export default function BillingFormModal({ isOpen, onClose, onSubmit, isSubmitting, editingRecord, submitError }: BillingFormModalProps) {
  const { form, setForm, isDirty, wasRestored, clearDraft, snapshot } = useFormDraft<BillingFormData>({
    storageKey: 'rmpg_invoice_form', defaultValue: EMPTY_FORM, isActive: isOpen,
  });

  useEffect(() => {
    if (isOpen) {
      if (editingRecord) {
        const r = editingRecord;
        setForm({
          client_id: r.client_id ? String(r.client_id) : '',
          contract_id: r.contract_id ? String(r.contract_id) : '',
          tax_rate: r.tax_rate != null ? String(r.tax_rate) : '0',
          due_date: r.due_date || '',
          status: r.status || 'draft', notes: r.notes || '',
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
      title={editingRecord ? 'Edit Invoice' : 'New Invoice'} icon={DollarSign}
      submitLabel={editingRecord ? 'Update' : 'Create'} isSubmitting={isSubmitting}
      isDirty={isDirty} draftRestored={wasRestored} onDiscardDraft={clearDraft}
    >
      {submitError && <div className="px-3 py-2 -mt-2 mb-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">{submitError}</div>}
      <div className="space-y-3">
        <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Client ID <span className="text-red-500">*</span></label>
          <input name="client_id" type="number" className="input-dark mt-1" value={form.client_id} onChange={handleChange} autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Contract ID</label>
            <input name="contract_id" type="number" className="input-dark mt-1" value={form.contract_id} onChange={handleChange} /></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Tax Rate</label>
            <input name="tax_rate" type="number" step="0.01" className="input-dark mt-1" value={form.tax_rate} onChange={handleChange} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Due Date</label>
            <input name="due_date" type="date" className="input-dark mt-1" value={form.due_date} onChange={handleChange} /></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Status</label>
            <select name="status" className="select-dark mt-1" value={form.status} onChange={handleChange}>
              {['draft','sent','partial','paid','overdue','void','cancelled'].map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
            </select></div>
        </div>
        <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Notes</label>
          <textarea name="notes" rows={3} className="input-dark mt-1" value={form.notes} onChange={handleChange} /></div>
      </div>
    </FormModal>
  );
}

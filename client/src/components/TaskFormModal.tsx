import React, { useState, useEffect } from 'react';
import { ClipboardList } from 'lucide-react';
import FormModal from '../components/FormModal';
import { useFormDraft } from '../hooks/useFormDraft';

export interface TaskFormData {
  task_title: string; description: string; priority: string;
  status: string; assigned_to: string; due_date: string;
  linked_entity_type: string; linked_entity_id: string; notes: string;
}

interface TaskFormModalProps {
  isOpen: boolean; onClose: () => void; onSubmit: (d: TaskFormData) => void;
  isSubmitting: boolean; editingRecord?: any; submitError?: string | null;
}

const EMPTY_FORM: TaskFormData = {
  task_title: '', description: '', priority: 'normal',
  status: 'pending', assigned_to: '', due_date: '',
  linked_entity_type: '', linked_entity_id: '', notes: '',
};

export default function TaskFormModal({ isOpen, onClose, onSubmit, isSubmitting, editingRecord, submitError }: TaskFormModalProps) {
  const { form, setForm, isDirty, wasRestored, clearDraft, snapshot } = useFormDraft<TaskFormData>({
    storageKey: 'rmpg_task_form', defaultValue: EMPTY_FORM, isActive: isOpen,
  });

  useEffect(() => {
    if (isOpen) {
      if (editingRecord) {
        const r = editingRecord;
        setForm({
          task_title: r.task_title || '', description: r.description || '',
          priority: r.priority || 'normal', status: r.status || 'pending',
          assigned_to: r.assigned_to ? String(r.assigned_to) : '', due_date: r.due_date || '',
          linked_entity_type: r.linked_entity_type || '', linked_entity_id: r.linked_entity_id ? String(r.linked_entity_id) : '',
          notes: r.notes || '',
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
      title={editingRecord ? 'Edit Task' : 'New Task'} icon={ClipboardList}
      submitLabel={editingRecord ? 'Update' : 'Create'} isSubmitting={isSubmitting}
      isDirty={isDirty} draftRestored={wasRestored} onDiscardDraft={clearDraft}
    >
      {submitError && <div className="px-3 py-2 -mt-2 mb-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">{submitError}</div>}
      <div className="space-y-3">
        <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Title <span className="text-red-500">*</span></label>
          <input name="task_title" className="input-dark mt-1" value={form.task_title} onChange={handleChange} autoFocus /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Priority</label>
            <select name="priority" className="select-dark mt-1" value={form.priority} onChange={handleChange}>
              {['low','normal','high','urgent'].map(p=><option key={p} value={p}>{p.charAt(0).toUpperCase()+p.slice(1)}</option>)}
            </select></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Status</label>
            <select name="status" className="select-dark mt-1" value={form.status} onChange={handleChange}>
              {['pending','in_progress','review','completed','cancelled'].map(s=><option key={s} value={s}>{s.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}</option>)}
            </select></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Assigned To (User ID)</label>
            <input name="assigned_to" type="number" className="input-dark mt-1" value={form.assigned_to} onChange={handleChange} /></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Due Date</label>
            <input name="due_date" type="date" className="input-dark mt-1" value={form.due_date} onChange={handleChange} /></div>
        </div>
        <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Description</label>
          <textarea name="description" rows={3} className="input-dark mt-1" value={form.description} onChange={handleChange} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Linked Entity Type</label>
            <input name="linked_entity_type" className="input-dark mt-1" placeholder="call, incident, case..." value={form.linked_entity_type} onChange={handleChange} /></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Linked Entity ID</label>
            <input name="linked_entity_id" type="number" className="input-dark mt-1" value={form.linked_entity_id} onChange={handleChange} /></div>
        </div>
        <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Notes</label>
          <textarea name="notes" rows={2} className="input-dark mt-1" value={form.notes} onChange={handleChange} /></div>
      </div>
    </FormModal>
  );
}

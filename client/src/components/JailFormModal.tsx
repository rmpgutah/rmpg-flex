import React, { useState, useEffect } from 'react';
import { Building2 } from 'lucide-react';
import FormModal from '../components/FormModal';
import { useFormDraft } from '../hooks/useFormDraft';
import { localToday } from '../utils/dateUtils';

export interface JailFormData {
  last_name: string; first_name: string; middle_name: string;
  dob: string; gender: string; race: string;
  height_inches: string; weight_lbs: string;
  hair_color: string; eye_color: string; skin_tone: string;
  marks_scars_tattoos: string;
  housing_unit: string; housing_cell: string;
  arresting_agency: string; arresting_officer_id: string;
  arrest_incident_id: string;
  bail_amount: string; bond_type: string;
  status: string; notes: string;
}

interface JailFormModalProps {
  isOpen: boolean; onClose: () => void; onSubmit: (d: JailFormData) => void;
  isSubmitting: boolean; editingRecord?: any; submitError?: string | null;
}

const EMPTY_FORM: JailFormData = {
  last_name: '', first_name: '', middle_name: '',
  dob: '', gender: '', race: '',
  height_inches: '', weight_lbs: '',
  hair_color: '', eye_color: '', skin_tone: '',
  marks_scars_tattoos: '',
  housing_unit: '', housing_cell: '',
  arresting_agency: 'RMPG', arresting_officer_id: '',
  arrest_incident_id: '',
  bail_amount: '', bond_type: '',
  status: 'booked', notes: '',
};

type SectionId = 'identity' | 'physical' | 'housing' | 'notes';

export default function JailFormModal({ isOpen, onClose, onSubmit, isSubmitting, editingRecord, submitError }: JailFormModalProps) {
  const { form, setForm, isDirty, wasRestored, clearDraft, snapshot } = useFormDraft<JailFormData>({
    storageKey: 'rmpg_jail_form', defaultValue: EMPTY_FORM, isActive: isOpen,
  });
  const [activeSection, setActiveSection] = useState<SectionId>('identity');

  useEffect(() => {
    if (isOpen) {
      setActiveSection('identity');
      if (editingRecord) {
        const r = editingRecord;
        setForm({
          last_name: r.last_name || '', first_name: r.first_name || '', middle_name: r.middle_name || '',
          dob: r.dob || '', gender: r.gender || '', race: r.race || '',
          height_inches: r.height_inches != null ? String(r.height_inches) : '', weight_lbs: r.weight_lbs != null ? String(r.weight_lbs) : '',
          hair_color: r.hair_color || '', eye_color: r.eye_color || '', skin_tone: r.skin_tone || '',
          marks_scars_tattoos: r.marks_scars_tattoos || '',
          housing_unit: r.housing_unit || '', housing_cell: r.housing_cell || '',
          arresting_agency: r.arresting_agency || 'RMPG', arresting_officer_id: r.arresting_officer_id ? String(r.arresting_officer_id) : '',
          arrest_incident_id: r.arrest_incident_id ? String(r.arrest_incident_id) : '',
          bail_amount: r.bail_amount != null ? String(r.bail_amount) : '', bond_type: r.bond_type || '',
          status: r.status || 'booked', notes: r.notes || '',
        });
      } else {
        setForm({ ...EMPTY_FORM });
      }
      snapshot();
    }
  }, [isOpen, editingRecord]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onSubmit(form); };

  const sections: { id: SectionId; label: string }[] = [
    { id: 'identity', label: 'Identity' }, { id: 'physical', label: 'Physical' },
    { id: 'housing', label: 'Housing' }, { id: 'notes', label: 'Notes' },
  ];

  return (
    <FormModal isOpen={isOpen} onClose={onClose} onSubmit={handleSubmit}
      title={editingRecord ? 'Edit Inmate' : 'Book Inmate'} icon={Building2}
      submitLabel={editingRecord ? 'Update' : 'Book'}
      isSubmitting={isSubmitting} maxWidth="max-w-3xl"
      isDirty={isDirty} draftRestored={wasRestored} onDiscardDraft={clearDraft}
    >
      {submitError && <div className="px-3 py-2 -mt-2 mb-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">{submitError}</div>}
      <div className="flex gap-1 -mt-2 mb-3 border-b border-rmpg-700 pb-2">
        {sections.map(s => (
          <button key={s.id} type="button" onClick={() => setActiveSection(s.id)}
            className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${activeSection === s.id ? 'text-red-400 bg-red-900/20 border border-red-700/40' : 'text-rmpg-400 hover:text-white'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {activeSection === 'identity' && (<>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Last Name <span className="text-red-500">*</span></label>
            <input name="last_name" className="input-dark mt-1" value={form.last_name} onChange={handleChange} autoFocus /></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">First Name <span className="text-red-500">*</span></label>
            <input name="first_name" className="input-dark mt-1" value={form.first_name} onChange={handleChange} /></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Middle</label>
            <input name="middle_name" className="input-dark mt-1" value={form.middle_name} onChange={handleChange} /></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">DOB</label>
            <input name="dob" type="date" className="input-dark mt-1" value={form.dob} onChange={handleChange} /></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Gender</label>
            <select name="gender" className="select-dark mt-1" value={form.gender} onChange={handleChange}>
              <option value="">--</option>
              {['Male','Female','Non-Binary','Unknown'].map(g=><option key={g} value={g}>{g}</option>)}
            </select></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Race</label>
            <select name="race" className="select-dark mt-1" value={form.race} onChange={handleChange}>
              <option value="">--</option>
              {['White','Black','Hispanic','Asian','Native American','Pacific Islander','Other','Unknown'].map(r=><option key={r} value={r}>{r}</option>)}
            </select></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Status</label>
            <select name="status" className="select-dark mt-1" value={form.status} onChange={handleChange}>
              {['booked','housed','court','medical','released','transferred'].map(s=><option key={s} value={s}>{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
            </select></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Agency</label>
            <input name="arresting_agency" className="input-dark mt-1" value={form.arresting_agency} onChange={handleChange} /></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Officer ID</label>
            <input name="arresting_officer_id" type="number" className="input-dark mt-1" value={form.arresting_officer_id} onChange={handleChange} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Bail Amount</label>
            <input name="bail_amount" type="number" className="input-dark mt-1" value={form.bail_amount} onChange={handleChange} /></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Bond Type</label>
            <select name="bond_type" className="select-dark mt-1" value={form.bond_type} onChange={handleChange}>
              <option value="">--</option>
              {['Cash','Surety','Property','ROR','Federal'].map(b=><option key={b} value={b}>{b}</option>)}
            </select></div>
        </div>
      </>)}

      {activeSection === 'physical' && (<>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Height (in.)</label>
            <input name="height_inches" type="number" className="input-dark mt-1" value={form.height_inches} onChange={handleChange} /></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Weight (lbs)</label>
            <input name="weight_lbs" type="number" className="input-dark mt-1" value={form.weight_lbs} onChange={handleChange} /></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Skin Tone</label>
            <input name="skin_tone" className="input-dark mt-1" value={form.skin_tone} onChange={handleChange} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Hair Color</label>
            <select name="hair_color" className="select-dark mt-1" value={form.hair_color} onChange={handleChange}>
              <option value="">--</option>
              {['Black','Brown','Blonde','Red','Gray','White','Bald','Other'].map(h=><option key={h} value={h}>{h}</option>)}
            </select></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Eye Color</label>
            <select name="eye_color" className="select-dark mt-1" value={form.eye_color} onChange={handleChange}>
              <option value="">--</option>
              {['Brown','Blue','Green','Hazel','Gray','Other'].map(e=><option key={e} value={e}>{e}</option>)}
            </select></div>
        </div>
        <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Marks / Scars / Tattoos</label>
          <textarea name="marks_scars_tattoos" rows={3} className="input-dark mt-1" value={form.marks_scars_tattoos} onChange={handleChange} /></div>
      </>)}

      {activeSection === 'housing' && (<>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Housing Unit</label>
            <input name="housing_unit" className="input-dark mt-1" value={form.housing_unit} onChange={handleChange} /></div>
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Cell</label>
            <input name="housing_cell" className="input-dark mt-1" value={form.housing_cell} onChange={handleChange} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Arrest Incident ID</label>
            <input name="arrest_incident_id" type="number" className="input-dark mt-1" value={form.arrest_incident_id} onChange={handleChange} /></div>
        </div>
      </>)}

      {activeSection === 'notes' && (
        <div><label className="text-[10px] text-rmpg-400 uppercase font-semibold">Notes</label>
          <textarea name="notes" rows={6} className="input-dark mt-1" value={form.notes} onChange={handleChange} maxLength={5000} />
          <div className="text-[9px] text-rmpg-500 text-right mt-0.5">{form.notes.length}/5000</div>
        </div>
      )}
    </FormModal>
  );
}

import { useState } from 'react';
import type { BoloCreate } from '../useBolos';

const INPUT = 'w-full bg-surface-sunken border border-border-default rounded-[2px] px-2 py-[6px] text-[12px] text-rmpg-200 focus:border-[#d4a017] outline-none';
const LABEL = 'font-mono text-[8px] tracking-widest text-[#888] uppercase';

export default function BoloCreateModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (payload: BoloCreate) => void;
}) {
  const [type, setType] = useState('person');
  const [priority, setPriority] = useState('P3');
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [description, setDescription] = useState('');

  const submit = () => {
    if (!title.trim()) return;
    onCreate({
      type, title: title.trim(), priority,
      subject_description: subject.trim() || undefined,
      vehicle_description: vehicle.trim() || undefined,
      description: description.trim() || undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-surface-overlay border border-border-subtle rounded-[2px]" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border-default font-mono text-[10px] tracking-widest text-[#d4a017] uppercase">New BOLO</div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className={LABEL}>Type</div>
              <select value={type} onChange={(e) => setType(e.target.value)} className={INPUT}>
                <option value="person">Person</option>
                <option value="vehicle">Vehicle</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <div className={LABEL}>Priority</div>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={INPUT}>
                <option value="P1">P1 — Critical</option>
                <option value="P2">P2 — High</option>
                <option value="P3">P3 — Routine</option>
              </select>
            </div>
          </div>
          <div><div className={LABEL}>Title *</div><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title / headline" className={INPUT} /></div>
          {type !== 'vehicle' && <div><div className={LABEL}>Subject description</div><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject description" className={INPUT} /></div>}
          {type !== 'person' && <div><div className={LABEL}>Vehicle description</div><input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="Vehicle description" className={INPUT} /></div>}
          <div><div className={LABEL}>Details</div><textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Narrative / details" rows={3} className={INPUT} /></div>
        </div>
        <div className="px-4 py-3 border-t border-border-default flex justify-end gap-2">
          <button onClick={onClose} className="font-mono text-[9px] tracking-wide text-[#888] border border-border-default rounded-[2px] px-3 py-[6px] uppercase">Cancel</button>
          <button onClick={submit} className="font-mono text-[9px] tracking-wide text-black bg-[#d4a017] rounded-[2px] px-3 py-[6px] uppercase">Create BOLO</button>
        </div>
      </div>
    </div>
  );
}

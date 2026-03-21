// ============================================================
// RMPG Flex — Arrest / Booking Form Modal
// Create or edit manual booking records with tabbed sections.
// Follows VehicleFormModal pattern: FormModal wrapper,
// useFormDirty hook, 4-tab layout, EMPTY_FORM constant.
// ============================================================

import React, { useState, useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';
import FormModal from './FormModal';
import { localToday } from '../utils/dateUtils';
import { useFormDirty } from '../hooks/useFormDirty';

// ── Types ─────────────────────────────────────────────────

export interface ArrestFormData {
  full_name: string;
  date_of_birth: string;
  booking_date: string;
  release_date: string;
  county: string;
  status: string;
  booking_number: string;
  agency: string;
  gender: string;
  race: string;
  height: string;
  weight: string;
  hair_color: string;
  eye_color: string;
  address: string;
  charges: string;       // One charge per line (converted to JSON array on submit)
  bail_amount: string;
  hold_reason: string;
  notes: string;
}

interface ArrestFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ArrestFormData) => void;
  isSubmitting: boolean;
  editingRecord?: any;
  submitError?: string | null;
}

// ── Constants ─────────────────────────────────────────────

const EMPTY_FORM: ArrestFormData = {
  full_name: '',
  date_of_birth: '',
  booking_date: localToday(),
  release_date: '',
  county: '',
  status: 'active',
  booking_number: '',
  agency: 'RMPG',
  gender: '',
  race: '',
  height: '',
  weight: '',
  hair_color: '',
  eye_color: '',
  address: '',
  charges: '',
  bail_amount: '',
  hold_reason: '',
  notes: '',
};

const STATUS_OPTIONS = ['active', 'released', 'transferred', 'bonded'];
const GENDER_OPTIONS = ['Male', 'Female', 'Non-Binary', 'Unknown'];
const RACE_OPTIONS = [
  'White', 'Black', 'Hispanic', 'Asian', 'Native American',
  'Pacific Islander', 'Middle Eastern', 'Other', 'Unknown',
];
const HAIR_OPTIONS = ['Black', 'Brown', 'Blonde', 'Red', 'Auburn', 'Gray', 'White', 'Bald', 'Other'];
const EYE_OPTIONS = ['Brown', 'Blue', 'Green', 'Hazel', 'Gray', 'Amber', 'Other'];
const COUNTY_OPTIONS = [
  'Salt Lake', 'Utah', 'Davis', 'Weber', 'Washington', 'Cache',
  'Tooele', 'Iron', 'Summit', 'Uinta', 'Box Elder', 'Beaver',
  'Carbon', 'Duchesne', 'Emery', 'Garfield', 'Grand', 'Juab',
  'Kane', 'Millard', 'Morgan', 'Piute', 'Rich', 'San Juan',
  'Sanpete', 'Sevier', 'Wasatch', 'Wayne', 'Daggett',
];

type SectionId = 'booking' | 'description' | 'charges' | 'notes';

// ── Component ─────────────────────────────────────────────

export default function ArrestFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  editingRecord,
  submitError,
}: ArrestFormModalProps) {
  const [form, setForm] = useState<ArrestFormData>(EMPTY_FORM);
  const { isDirty, snapshot } = useFormDirty(form, isOpen);
  const [activeSection, setActiveSection] = useState<SectionId>('booking');

  // ── Init form on open ───────────────────────────────────

  useEffect(() => {
    if (isOpen) {
      setActiveSection('booking');
      if (editingRecord) {
        // Parse charges from JSON array back to one-per-line text
        let chargesText = '';
        try {
          const arr = typeof editingRecord.charges === 'string'
            ? JSON.parse(editingRecord.charges)
            : editingRecord.charges;
          if (Array.isArray(arr)) chargesText = arr.join('\n');
        } catch {
          chargesText = editingRecord.charges || '';
        }

        const initial: ArrestFormData = {
          full_name: editingRecord.full_name || '',
          date_of_birth: editingRecord.date_of_birth || '',
          booking_date: editingRecord.booking_date || '',
          release_date: editingRecord.release_date || '',
          county: editingRecord.county || '',
          status: editingRecord.status || 'active',
          booking_number: editingRecord.booking_number || '',
          agency: editingRecord.agency || '',
          gender: editingRecord.gender || '',
          race: editingRecord.race || '',
          height: editingRecord.height || '',
          weight: editingRecord.weight || '',
          hair_color: editingRecord.hair_color || '',
          eye_color: editingRecord.eye_color || '',
          address: editingRecord.address || '',
          charges: chargesText,
          bail_amount: editingRecord.bail_amount != null ? String(editingRecord.bail_amount) : '',
          hold_reason: editingRecord.hold_reason || '',
          notes: editingRecord.notes || '',
        };
        setForm(initial);
        snapshot(initial);
      } else {
        const fresh = { ...EMPTY_FORM, booking_date: localToday() };
        setForm(fresh);
        snapshot(fresh);
      }
    }
  }, [isOpen, editingRecord]);

  // ── Handlers ────────────────────────────────────────────

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Convert charges textarea (one per line) to JSON array before submitting
    const chargeLines = form.charges
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);
    onSubmit({
      ...form,
      charges: JSON.stringify(chargeLines),
    });
  };

  // ── Section Tabs ────────────────────────────────────────

  const sections: { id: SectionId; label: string }[] = [
    { id: 'booking', label: 'Booking Info' },
    { id: 'description', label: 'Description' },
    { id: 'charges', label: 'Charges & Bail' },
    { id: 'notes', label: 'Notes' },
  ];

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title={editingRecord ? 'Edit Booking' : 'New Booking'}
      icon={ShieldAlert}
      submitLabel={editingRecord ? 'Update' : 'Create'}
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

      {/* Section Tabs */}
      <div className="flex gap-1 -mt-2 mb-3 border-b border-rmpg-700 pb-2">
        {sections.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActiveSection(s.id)}
            className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
              activeSection === s.id
                ? 'text-red-400 bg-red-900/20 border border-red-700/40'
                : 'text-rmpg-400 hover:text-white hover:bg-rmpg-700/40 border border-transparent'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Tab: Booking Info ────────────────────────────── */}
      {activeSection === 'booking' && (
        <>
          {/* Full Name (required) */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              name="full_name"
              type="text"
              className="input-dark mt-1"
              placeholder="Last, First Middle"
              value={form.full_name}
              onChange={handleChange}
              autoFocus
            />
          </div>

          {/* Booking Date / Release Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Booking Date</label>
              <input name="booking_date" type="date" className="input-dark mt-1" value={form.booking_date} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Release Date</label>
              <input name="release_date" type="date" className="input-dark mt-1" value={form.release_date} onChange={handleChange} />
            </div>
          </div>

          {/* Booking Number / Agency / Status */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Booking Number</label>
              <input name="booking_number" type="text" className="input-dark mt-1" value={form.booking_number} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Agency</label>
              <input name="agency" type="text" className="input-dark mt-1" value={form.agency} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Status</label>
              <select name="status" className="select-dark mt-1" value={form.status} onChange={handleChange}>
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* County */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">County</label>
            <select name="county" className="select-dark mt-1" value={form.county} onChange={handleChange}>
              <option value="">-- Select County --</option>
              {COUNTY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </>
      )}

      {/* ── Tab: Description ─────────────────────────────── */}
      {activeSection === 'description' && (
        <>
          {/* DOB */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Date of Birth</label>
              <input name="date_of_birth" type="date" className="input-dark mt-1" value={form.date_of_birth} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Gender</label>
              <select name="gender" className="select-dark mt-1" value={form.gender} onChange={handleChange}>
                <option value="">-- Select --</option>
                {GENDER_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>

          {/* Race / Height / Weight */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Race</label>
              <select name="race" className="select-dark mt-1" value={form.race} onChange={handleChange}>
                <option value="">-- Select --</option>
                {RACE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Height</label>
              <input name="height" type="text" className="input-dark mt-1" placeholder="e.g. 5'11&quot;" value={form.height} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Weight</label>
              <input name="weight" type="text" className="input-dark mt-1" placeholder="e.g. 180 lbs" value={form.weight} onChange={handleChange} />
            </div>
          </div>

          {/* Hair / Eye */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Hair Color</label>
              <select name="hair_color" className="select-dark mt-1" value={form.hair_color} onChange={handleChange}>
                <option value="">-- Select --</option>
                {HAIR_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Eye Color</label>
              <select name="eye_color" className="select-dark mt-1" value={form.eye_color} onChange={handleChange}>
                <option value="">-- Select --</option>
                {EYE_OPTIONS.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Address</label>
            <input name="address" type="text" className="input-dark mt-1" placeholder="Street address" value={form.address} onChange={handleChange} />
          </div>
        </>
      )}

      {/* ── Tab: Charges & Bail ──────────────────────────── */}
      {activeSection === 'charges' && (
        <>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">
              Charges <span className="text-rmpg-500">(one per line)</span>
            </label>
            <textarea
              name="charges"
              rows={6}
              className="input-dark mt-1 font-mono text-xs"
              placeholder="e.g.&#10;Assault — Class A Misdemeanor&#10;Theft — 3rd Degree Felony"
              value={form.charges}
              onChange={handleChange}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Bail Amount</label>
              <input
                name="bail_amount"
                type="text"
                className="input-dark mt-1"
                placeholder="e.g. 5000"
                value={form.bail_amount}
                onChange={handleChange}
              />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Hold Reason</label>
              <input
                name="hold_reason"
                type="text"
                className="input-dark mt-1"
                placeholder="e.g. No Bail, Parole Hold"
                value={form.hold_reason}
                onChange={handleChange}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Tab: Notes ───────────────────────────────────── */}
      {activeSection === 'notes' && (
        <div>
          <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Notes</label>
          <textarea
            name="notes"
            rows={8}
            className="input-dark mt-1"
            placeholder="Additional booking notes, officer observations, etc."
            value={form.notes}
            onChange={handleChange}
          />
        </div>
      )}
    </FormModal>
  );
}

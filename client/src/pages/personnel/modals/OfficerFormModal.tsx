import React, { useEffect } from 'react';
import { User } from 'lucide-react';
import FormModal from '../../../components/FormModal';
import { useFormDraft } from '../../../hooks/useFormDraft';
import type { UserRole } from '../../../types';
import AddressAutocomplete, { type ParsedAddress } from '../../../components/AddressAutocomplete';
import { formatPhoneInput } from '../../../utils/formatters';

export interface OfficerFormData {
  // Account (create only)
  username: string;
  password: string;
  role: UserRole;
  full_name: string;
  // Personal
  first_name: string;
  last_name: string;
  middle_name: string;
  date_of_birth: string;
  // Professional
  badge_number: string;
  rank: string;
  department: string;
  hire_date: string;
  shift_preference: string;
  employee_id: string;
  // Contact
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  // Emergency
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  // Medical
  blood_type: string;
  allergies: string;
  uniform_size: string;
  // DL
  dl_number: string;
  dl_state: string;
  dl_expiry: string;
  // Notes
  notes: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: OfficerFormData) => void;
  isSubmitting: boolean;
  initialData?: Partial<OfficerFormData> & { id?: string };
  mode?: 'create' | 'edit';
}

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'officer', label: 'Officer' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'manager', label: 'Manager' },
  { value: 'dispatcher', label: 'Dispatcher' },
  { value: 'admin', label: 'Admin' },
];

const RANKS = ['', 'Officer', 'Corporal', 'Sergeant', 'Lieutenant', 'Captain', 'Major', 'Chief'];
const SHIFTS = ['', 'day', 'swing', 'night', 'rotating'];
const BLOOD_TYPES = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const UNIFORM_SIZES = ['', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];

const EMPTY: OfficerFormData = {
  username: '', password: '', role: 'officer', full_name: '',
  first_name: '', last_name: '', middle_name: '', date_of_birth: '',
  badge_number: '', rank: '', department: '', hire_date: '', shift_preference: '', employee_id: '',
  phone: '', email: '', address: '', city: '', state: '', zip: '',
  emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '',
  blood_type: '', allergies: '', uniform_size: '',
  dl_number: '', dl_state: '', dl_expiry: '',
  notes: '',
};

// Section divider component
function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mt-4 mb-3">
      <span className="field-label text-brand-400 whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-rmpg-700" />
    </div>
  );
}

export default function OfficerFormModal({
  isOpen, onClose, onSubmit, isSubmitting, initialData, mode = 'create',
}: Props) {
  const {
    form,
    setForm,
    isDirty,
    wasRestored,
    clearDraft,
    snapshot,
  } = useFormDraft<OfficerFormData>({
    storageKey: 'rmpg_personnel_officer_form',
    defaultValue: EMPTY,
    isActive: isOpen,
  });

  useEffect(() => {
    if (isOpen && initialData) {
      const initial = { ...EMPTY, ...initialData };
      setForm(initial);
      snapshot();
    } else if (isOpen) {
      setForm(EMPTY);
      snapshot();
    }
  }, [isOpen, initialData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  const handleClose = () => { setForm(EMPTY); onClose(); };
  const set = (key: keyof OfficerFormData, val: string) => setForm(p => ({ ...p, [key]: val }));

  return (
    <FormModal
      isOpen={isOpen}
      onClose={handleClose}
      onSubmit={handleSubmit}
      title={mode === 'edit' ? 'Edit Officer' : 'New Officer'}
      icon={User}
      submitLabel={mode === 'edit' ? 'Update' : 'Create Officer'}
      isSubmitting={isSubmitting}
      maxWidth="max-w-3xl"
      isDirty={isDirty}
      draftRestored={wasRestored}
      onDiscardDraft={clearDraft}
    >
      {/* Account — create only */}
      {mode === 'create' && (
        <>
          <SectionDivider label="Account" />
          <div className="panel-inset p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="field-label">Username <span className="text-red-400">*</span></label>
                <input type="text" required value={form.username} onChange={e => set('username', e.target.value)} placeholder="Login username" className="input-dark min-h-[36px]" />
              </div>
              <div>
                <label className="field-label">Password <span className="text-red-400">*</span></label>
                <input type="password" autoComplete="new-password" required value={form.password} onChange={e => set('password', e.target.value)} placeholder="Initial password" className="input-dark min-h-[36px]" />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="field-label">Role <span className="text-red-400">*</span></label>
                <select required value={form.role} onChange={e => set('role', e.target.value)} className="select-dark">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">Full Name (Display)</label>
                <input type="text" value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="Auto-generated if blank" className="input-dark min-h-[36px]" />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Personal */}
      <SectionDivider label="Personal Information" />
      <div className="panel-inset p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="field-label">First Name <span className="text-red-400">*</span></label>
            <input type="text" required value={form.first_name} onChange={e => set('first_name', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Last Name <span className="text-red-400">*</span></label>
            <input type="text" required value={form.last_name} onChange={e => set('last_name', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Middle Name</label>
            <input type="text" value={form.middle_name} onChange={e => set('middle_name', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Date of Birth</label>
            <input type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
          {mode === 'edit' && (
            <div>
              <label className="field-label">Role</label>
              <select value={form.role} onChange={e => set('role', e.target.value)} className="select-dark">
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Professional */}
      <SectionDivider label="Professional" />
      <div className="panel-inset p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="field-label">Badge Number</label>
            <input type="text" value={form.badge_number} onChange={e => set('badge_number', e.target.value)} pattern="[A-Za-z0-9\-]{1,10}" placeholder="e.g. O-101" className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Rank</label>
            <select value={form.rank} onChange={e => set('rank', e.target.value)} className="select-dark">
              {RANKS.map(r => <option key={r} value={r}>{r || '— None —'}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Employee ID</label>
            <input type="text" value={form.employee_id} onChange={e => set('employee_id', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="field-label">Department</label>
            <input type="text" value={form.department} onChange={e => set('department', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Hire Date</label>
            <input type="date" value={form.hire_date} onChange={e => set('hire_date', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Shift Preference</label>
            <select value={form.shift_preference} onChange={e => set('shift_preference', e.target.value)} className="select-dark">
              {SHIFTS.map(s => <option key={s} value={s}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : '— None —'}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Contact */}
      <SectionDivider label="Contact" />
      <div className="panel-inset p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="field-label">Phone</label>
            <input type="tel" value={form.phone} onChange={e => set('phone', formatPhoneInput(e.target.value))} placeholder="(801) 555-0100" pattern="[0-9()\-\s+]{7,20}" className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Email</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="user@rmpgsecurity.com" pattern="[^\s@]+@[^\s@]+\.[^\s@]{2,}" className="input-dark min-h-[36px]" />
          </div>
        </div>
        <div>
          <label className="field-label">Address</label>
          <AddressAutocomplete
            className="input-dark min-h-[36px]"
            placeholder="Street address"
            value={form.address}
            onChange={(val) => set('address', val)}
            onSelect={(addr: ParsedAddress) => {
              setForm((prev) => ({
                ...prev,
                address: addr.street || addr.formatted,
                city: addr.city || prev.city,
                state: addr.state || prev.state,
                zip: addr.zip || prev.zip,
              }));
            }}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="field-label">City</label>
            <input type="text" value={form.city} onChange={e => set('city', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">State</label>
            <input type="text" value={form.state} onChange={e => set('state', e.target.value)} maxLength={2} placeholder="UT" className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">ZIP</label>
            <input type="text" value={form.zip} onChange={e => set('zip', e.target.value)} maxLength={10} placeholder="84101" pattern="\d{5}(-\d{4})?" className="input-dark min-h-[36px]" />
          </div>
        </div>
      </div>

      {/* Emergency Contact */}
      <SectionDivider label="Emergency Contact" />
      <div className="panel-inset p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="field-label">Name</label>
            <input type="text" value={form.emergency_contact_name} onChange={e => set('emergency_contact_name', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Phone</label>
            <input type="tel" value={form.emergency_contact_phone} onChange={e => set('emergency_contact_phone', formatPhoneInput(e.target.value))} placeholder="(801) 555-1234" pattern="[0-9()\-\s+]{7,20}" className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">Relationship</label>
            <input type="text" value={form.emergency_contact_relationship} onChange={e => set('emergency_contact_relationship', e.target.value)} placeholder="Spouse, Parent, etc." className="input-dark min-h-[36px]" />
          </div>
        </div>
      </div>

      {/* Medical/Safety */}
      <SectionDivider label="Medical / Safety" />
      <div className="panel-inset p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="field-label">Blood Type</label>
            <select value={form.blood_type} onChange={e => set('blood_type', e.target.value)} className="select-dark">
              {BLOOD_TYPES.map(b => <option key={b} value={b}>{b || '— Unknown —'}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Uniform Size</label>
            <select value={form.uniform_size} onChange={e => set('uniform_size', e.target.value)} className="select-dark">
              {UNIFORM_SIZES.map(s => <option key={s} value={s}>{s || '— None —'}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Allergies</label>
            <input type="text" value={form.allergies} onChange={e => set('allergies', e.target.value)} placeholder="None known" className="input-dark min-h-[36px]" />
          </div>
        </div>
      </div>

      {/* Driver's License */}
      <SectionDivider label="Driver's License" />
      <div className="panel-inset p-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="field-label">DL Number</label>
            <input type="text" value={form.dl_number} onChange={e => set('dl_number', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">DL State</label>
            <input type="text" value={form.dl_state} onChange={e => set('dl_state', e.target.value)} maxLength={2} placeholder="UT" className="input-dark min-h-[36px]" />
          </div>
          <div>
            <label className="field-label">DL Expiry</label>
            <input type="date" value={form.dl_expiry} onChange={e => set('dl_expiry', e.target.value)} className="input-dark min-h-[36px]" />
          </div>
        </div>
      </div>

      {/* Notes */}
      <SectionDivider label="Notes" />
      <div className="panel-inset p-3">
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Additional notes..." maxLength={5000} className="textarea-dark" />
        <div className="text-[9px] text-rmpg-500 text-right mt-0.5">{form.notes.length}/5000</div>
      </div>
    </FormModal>
  );
}

import React, { useState, useEffect } from 'react';
import { Users } from 'lucide-react';
import FormModal from './FormModal';
import { useFormDirty } from '../hooks/useFormDirty';
import type { UserRole } from '../types';
import AddressAutocomplete, { type ParsedAddress } from './AddressAutocomplete';

export interface UserFormData {
  // Account
  username: string;
  password: string;
  full_name: string;
  role: UserRole;
  status: string;
  // Personal
  first_name: string;
  last_name: string;
  middle_name: string;
  date_of_birth: string;
  // Contact
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  // Professional
  badge_number: string;
  department: string;
  rank: string;
  employee_id: string;
  hire_date: string;
  termination_date: string;
  shift_preference: string;
  // Emergency
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relationship: string;
  // Medical / Safety
  blood_type: string;
  allergies: string;
  uniform_size: string;
  // Driver's License
  dl_number: string;
  dl_state: string;
  dl_expiry: string;
  // Credentials & Notes
  certifications: string;
  notes: string;
  profile_image: string;
}

interface UserFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: UserFormData) => void;
  isSubmitting: boolean;
  editingUser?: {
    id: string;
    username: string;
    first_name: string;
    last_name: string;
    middle_name?: string;
    email: string;
    role: UserRole;
    status?: string;
    badge_number?: string;
    phone?: string;
    department?: string;
    rank?: string;
    employee_id?: string;
    hire_date?: string;
    termination_date?: string;
    shift_preference?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    date_of_birth?: string;
    dl_number?: string;
    dl_state?: string;
    dl_expiry?: string;
    blood_type?: string;
    allergies?: string;
    uniform_size?: string;
    emergency_contact_name?: string;
    emergency_contact_phone?: string;
    emergency_contact_relationship?: string;
    certifications?: string;
    notes?: string;
    profile_image?: string;
  } | null;
}

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'officer', label: 'Officer' },
  { value: 'dispatcher', label: 'Dispatcher' },
];

const STATUSES: { value: string; label: string; color: string }[] = [
  { value: 'active', label: 'Active', color: 'text-green-400' },
  { value: 'inactive', label: 'Suspended', color: 'text-yellow-400' },
  { value: 'terminated', label: 'Terminated', color: 'text-red-400' },
];

const RANKS = ['', 'Officer', 'Corporal', 'Sergeant', 'Lieutenant', 'Captain', 'Major', 'Chief'];
const SHIFTS = ['', 'day', 'swing', 'night', 'rotating'];
const BLOOD_TYPES = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const UNIFORM_SIZES = ['', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];

const EMPTY_FORM: UserFormData = {
  username: '', password: '', full_name: '', role: 'officer', status: 'active',
  first_name: '', last_name: '', middle_name: '', date_of_birth: '',
  email: '', phone: '', address: '', city: '', state: '', zip: '',
  badge_number: '', department: '', rank: '', employee_id: '',
  hire_date: '', termination_date: '', shift_preference: '',
  emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relationship: '',
  blood_type: '', allergies: '', uniform_size: '',
  dl_number: '', dl_state: '', dl_expiry: '',
  certifications: '', notes: '', profile_image: '',
};

type SectionId = 'account' | 'personal' | 'professional' | 'contact' | 'emergency' | 'medical' | 'license' | 'credentials';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'account', label: 'Account' },
  { id: 'personal', label: 'Personal' },
  { id: 'professional', label: 'Professional' },
  { id: 'contact', label: 'Contact' },
  { id: 'emergency', label: 'Emergency' },
  { id: 'medical', label: 'Medical' },
  { id: 'license', label: 'License' },
  { id: 'credentials', label: 'Credentials' },
];

export default function UserFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  editingUser,
}: UserFormModalProps) {
  const [form, setForm] = useState<UserFormData>(EMPTY_FORM);
  const { isDirty, snapshot } = useFormDirty(form, isOpen);
  const [activeSection, setActiveSection] = useState<SectionId>('account');

  useEffect(() => {
    if (isOpen) {
      setActiveSection(editingUser ? 'personal' : 'account');
      if (editingUser) {
        const initial: UserFormData = {
          username: editingUser.username,
          password: '',
          full_name: `${editingUser.first_name} ${editingUser.last_name}`.trim(),
          role: editingUser.role,
          status: editingUser.status || 'active',
          first_name: editingUser.first_name || '',
          last_name: editingUser.last_name || '',
          middle_name: editingUser.middle_name || '',
          date_of_birth: editingUser.date_of_birth || '',
          email: editingUser.email || '',
          phone: editingUser.phone || '',
          address: editingUser.address || '',
          city: editingUser.city || '',
          state: editingUser.state || '',
          zip: editingUser.zip || '',
          badge_number: editingUser.badge_number || '',
          department: editingUser.department || '',
          rank: editingUser.rank || '',
          employee_id: editingUser.employee_id || '',
          hire_date: editingUser.hire_date || '',
          termination_date: editingUser.termination_date || '',
          shift_preference: editingUser.shift_preference || '',
          emergency_contact_name: editingUser.emergency_contact_name || '',
          emergency_contact_phone: editingUser.emergency_contact_phone || '',
          emergency_contact_relationship: editingUser.emergency_contact_relationship || '',
          blood_type: editingUser.blood_type || '',
          allergies: editingUser.allergies || '',
          uniform_size: editingUser.uniform_size || '',
          dl_number: editingUser.dl_number || '',
          dl_state: editingUser.dl_state || '',
          dl_expiry: editingUser.dl_expiry || '',
          certifications: editingUser.certifications || '',
          notes: editingUser.notes || '',
          profile_image: editingUser.profile_image || '',
        };
        setForm(initial);
        snapshot(initial);
      } else {
        setForm(EMPTY_FORM);
        snapshot(EMPTY_FORM);
      }
    }
  // Depend on editingUser?.id (not object reference) to prevent LiveSync
  // refreshes from re-triggering this effect and resetting form + stealing focus
  }, [isOpen, editingUser?.id]);

  const set = (field: keyof UserFormData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  const isEdit = !!editingUser;
  const inputCls = 'w-full bg-surface-sunken border border-rmpg-600 text-sm text-white px-3 py-2 focus:outline-none focus:border-brand-500';
  const labelCls = 'block text-[10px] font-semibold text-rmpg-300 uppercase tracking-wider mb-1';

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title={isEdit ? 'Edit User' : 'Add User'}
      icon={Users}
      submitLabel={isEdit ? 'Update User' : 'Create User'}
      isSubmitting={isSubmitting}
      maxWidth="max-w-3xl"
      isDirty={isDirty}
    >
      {/* Section Tabs */}
      <div className="flex flex-wrap gap-1 -mt-2 mb-3 border-b border-rmpg-700 pb-2">
        {SECTIONS.filter(s => !(isEdit && s.id === 'account')).map((s) => (
          <button type="button"
            key={s.id}
            type="button"
            onClick={() => setActiveSection(s.id)}
            className={`px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors ${
              activeSection === s.id
                ? 'text-red-400 bg-red-900/20 border border-red-700/40'
                : 'text-rmpg-400 hover:text-white hover:bg-rmpg-700/40 border border-transparent'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Account Tab (create only) ── */}
      {activeSection === 'account' && !isEdit && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Username <span className="text-red-400">*</span></label>
              <input type="text" required value={form.username} onChange={e => set('username', e.target.value)} placeholder="e.g. jsmith" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Password <span className="text-red-400">*</span></label>
              <input type="password" required value={form.password} onChange={e => set('password', e.target.value)} placeholder="Initial password" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Full Name <span className="text-red-400">*</span></label>
              <input type="text" required value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="Display name" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Role <span className="text-red-400">*</span></label>
              <select required value={form.role} onChange={e => set('role', e.target.value)} className={inputCls}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ── Personal Tab ── */}
      {activeSection === 'personal' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>First Name <span className="text-red-400">*</span></label>
              <input type="text" required value={form.first_name} onChange={e => set('first_name', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Last Name <span className="text-red-400">*</span></label>
              <input type="text" required value={form.last_name} onChange={e => set('last_name', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Middle Name</label>
              <input type="text" value={form.middle_name} onChange={e => set('middle_name', e.target.value)} className={inputCls} />
            </div>
          </div>
          <div className={`grid ${isEdit ? 'grid-cols-3' : 'grid-cols-2'} gap-4`}>
            <div>
              <label className={labelCls}>Date of Birth</label>
              <input type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} className={inputCls} />
            </div>
            {isEdit && (
              <div>
                <label className={labelCls}>Role</label>
                <select value={form.role} onChange={e => set('role', e.target.value)} className={inputCls}>
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            )}
            {isEdit && (
              <div>
                <label className={labelCls}>Account Status</label>
                <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
                  {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-rmpg-700 border border-rmpg-600 flex items-center justify-center text-rmpg-400 flex-shrink-0">
              {form.profile_image ? (
                <img src={form.profile_image} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <Users className="w-6 h-6" />
              )}
            </div>
            <div className="flex-1">
              <label className={labelCls}>Profile Image URL</label>
              <input type="text" value={form.profile_image} onChange={e => set('profile_image', e.target.value)} placeholder="https://... or /uploads/..." className={inputCls} />
            </div>
          </div>
        </div>
      )}

      {/* ── Professional Tab ── */}
      {activeSection === 'professional' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Badge Number</label>
              <input type="text" value={form.badge_number} onChange={e => set('badge_number', e.target.value)} placeholder="O-101" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Rank</label>
              <select value={form.rank} onChange={e => set('rank', e.target.value)} className={inputCls}>
                {RANKS.map(r => <option key={r} value={r}>{r || '-- None --'}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Employee ID</label>
              <input type="text" value={form.employee_id} onChange={e => set('employee_id', e.target.value)} placeholder="EMP-001" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Department</label>
              <input type="text" value={form.department} onChange={e => set('department', e.target.value)} placeholder="Patrol, Dispatch, etc." className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Hire Date</label>
              <input type="date" value={form.hire_date} onChange={e => set('hire_date', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Shift Preference</label>
              <select value={form.shift_preference} onChange={e => set('shift_preference', e.target.value)} className={inputCls}>
                {SHIFTS.map(s => <option key={s} value={s}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : '-- None --'}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Termination Date</label>
              <input type="date" value={form.termination_date} onChange={e => set('termination_date', e.target.value)} className={inputCls} />
            </div>
          </div>
        </div>
      )}

      {/* ── Contact Tab ── */}
      {activeSection === 'contact' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="user@rmpgsecurity.com" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="(801) 555-1234" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Address</label>
            <AddressAutocomplete
              className={inputCls}
              placeholder="123 Main St"
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
              <label className={labelCls}>City</label>
              <input type="text" value={form.city} onChange={e => set('city', e.target.value)} placeholder="Salt Lake City" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>State</label>
              <input type="text" value={form.state} onChange={e => set('state', e.target.value)} maxLength={2} placeholder="UT" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Zip Code</label>
              <input type="text" value={form.zip} onChange={e => set('zip', e.target.value)} maxLength={10} placeholder="84101" className={inputCls} />
            </div>
          </div>
        </div>
      )}

      {/* ── Emergency Contact Tab ── */}
      {activeSection === 'emergency' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Contact Name</label>
              <input type="text" value={form.emergency_contact_name} onChange={e => set('emergency_contact_name', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Contact Phone</label>
              <input type="tel" value={form.emergency_contact_phone} onChange={e => set('emergency_contact_phone', e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Relationship</label>
            <input type="text" value={form.emergency_contact_relationship} onChange={e => set('emergency_contact_relationship', e.target.value)} placeholder="Spouse, Parent, etc." className={inputCls} />
          </div>
        </div>
      )}

      {/* ── Medical / Safety Tab ── */}
      {activeSection === 'medical' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Blood Type</label>
              <select value={form.blood_type} onChange={e => set('blood_type', e.target.value)} className={inputCls}>
                {BLOOD_TYPES.map(b => <option key={b} value={b}>{b || '-- Unknown --'}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Uniform Size</label>
              <select value={form.uniform_size} onChange={e => set('uniform_size', e.target.value)} className={inputCls}>
                {UNIFORM_SIZES.map(s => <option key={s} value={s}>{s || '-- None --'}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Allergies</label>
              <input type="text" value={form.allergies} onChange={e => set('allergies', e.target.value)} placeholder="None known" className={inputCls} />
            </div>
          </div>
        </div>
      )}

      {/* ── Driver's License Tab ── */}
      {activeSection === 'license' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>DL Number</label>
              <input type="text" value={form.dl_number} onChange={e => set('dl_number', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>DL State</label>
              <input type="text" value={form.dl_state} onChange={e => set('dl_state', e.target.value)} maxLength={2} placeholder="UT" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>DL Expiry</label>
              <input type="date" value={form.dl_expiry} onChange={e => set('dl_expiry', e.target.value)} className={inputCls} />
            </div>
          </div>
        </div>
      )}

      {/* ── Credentials & Notes Tab ── */}
      {activeSection === 'credentials' && (
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Password {!isEdit && <span className="text-red-400">*</span>}</label>
            <input type="password" value={form.password} onChange={e => set('password', e.target.value)} required={!isEdit} placeholder={isEdit ? '(leave blank to keep)' : 'Enter password'} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Certifications</label>
            <input type="text" value={form.certifications} onChange={e => set('certifications', e.target.value)} placeholder="CPR, First Aid, Guard Card (comma-separated)" className={inputCls} />
            <p className="text-[9px] text-rmpg-500 mt-1">Enter certifications separated by commas</p>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={4} placeholder="Additional notes..." className={`${inputCls} resize-none`} />
          </div>
        </div>
      )}
    </FormModal>
  );
}

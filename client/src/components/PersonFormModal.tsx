import React, { useState, useEffect, useRef } from 'react';
import { UserCircle, Eye, EyeOff, Upload, X, CreditCard } from 'lucide-react';
import FormModal from './FormModal';
import { useFormDirty } from '../hooks/useFormDirty';
import type { Person } from '../types';
import { apiUploadFiles } from '../hooks/useApi';
import AddressAutocomplete, { type ParsedAddress } from './AddressAutocomplete';

interface PersonFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: PersonFormData) => void;
  isSubmitting: boolean;
  editingPerson?: Person;
}

export interface PersonFormData {
  first_name: string;
  last_name: string;
  middle_name: string;
  alias_nickname: string;
  dob: string;
  gender: string;
  race: string;
  height: string;
  height_feet: string;
  height_inches: string;
  weight: string;
  build: string;
  complexion: string;
  hair_color: string;
  eye_color: string;
  scars_marks_tattoos: string;
  clothing_description: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  dl_number: string;
  dl_state: string;
  dl_expiry: string;
  dl_class: string;
  ssn_last4: string;
  ssn_full: string;
  id_image_url: string;
  id_type: string;
  id_number: string;
  id_state: string;
  id_expiry: string;
  employer: string;
  occupation: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  language: string;
  gang_affiliation: string;
  is_sex_offender: boolean;
  is_veteran: boolean;
  place_of_birth: string;
  citizenship: string;
  marital_status: string;
  hair_length: string;
  hair_style: string;
  facial_hair: string;
  glasses: string;
  shoe_size: string;
  blood_type: string;
  phone_secondary: string;
  social_media: string;
  probation_parole: string;
  probation_parole_officer: string;
  known_associates: string;
  emergency_contact_relationship: string;
  caution_flags: string;
  notes: string;
}

const EMPTY_FORM: PersonFormData = {
  first_name: '',
  last_name: '',
  middle_name: '',
  alias_nickname: '',
  dob: '',
  gender: '',
  race: '',
  height: '',
  height_feet: '',
  height_inches: '',
  weight: '',
  build: '',
  complexion: '',
  hair_color: '',
  eye_color: '',
  scars_marks_tattoos: '',
  clothing_description: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  email: '',
  dl_number: '',
  dl_state: '',
  dl_expiry: '',
  dl_class: '',
  ssn_last4: '',
  ssn_full: '',
  id_image_url: '',
  id_type: '',
  id_number: '',
  id_state: '',
  id_expiry: '',
  employer: '',
  occupation: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  language: '',
  gang_affiliation: '',
  is_sex_offender: false,
  is_veteran: false,
  place_of_birth: '',
  citizenship: '',
  marital_status: '',
  hair_length: '',
  hair_style: '',
  facial_hair: '',
  glasses: '',
  shoe_size: '',
  blood_type: '',
  phone_secondary: '',
  social_media: '',
  probation_parole: '',
  probation_parole_officer: '',
  known_associates: '',
  emergency_contact_relationship: '',
  caution_flags: '',
  notes: '',
};

const GENDER_OPTIONS = ['Male', 'Female', 'Non-Binary', 'Other'];
const BUILD_OPTIONS = ['Slim', 'Medium', 'Athletic', 'Heavy', 'Stocky', 'Large'];
const COMPLEXION_OPTIONS = ['Light', 'Medium', 'Dark', 'Fair', 'Olive', 'Ruddy', 'Sallow'];
const DL_CLASS_OPTIONS = ['A', 'B', 'C', 'D', 'M', 'CDL-A', 'CDL-B', 'CDL-C'];
const RACE_OPTIONS = ['White', 'Black', 'Hispanic', 'Asian', 'Native American', 'Pacific Islander', 'Middle Eastern', 'Mixed', 'Other'];
const HAIR_OPTIONS = ['Black', 'Brown', 'Blonde', 'Red', 'Auburn', 'Gray', 'White', 'Bald', 'Other'];
const EYE_OPTIONS = ['Brown', 'Blue', 'Green', 'Hazel', 'Gray', 'Amber', 'Black', 'Other'];
const MARITAL_OPTIONS = ['Single', 'Married', 'Divorced', 'Widowed', 'Separated', 'Domestic Partnership'];
const HAIR_LENGTH_OPTIONS = ['Short', 'Medium', 'Long', 'Shaved'];
const HAIR_STYLE_OPTIONS = ['Straight', 'Curly', 'Wavy', 'Braided', 'Dreadlocks', 'Afro', 'Bun', 'Ponytail', 'Bald'];
const FACIAL_HAIR_OPTIONS = ['None', 'Mustache', 'Goatee', 'Full Beard', 'Stubble', 'Sideburns'];
const GLASSES_OPTIONS = ['None', 'Glasses', 'Contacts', 'Sunglasses'];
const BLOOD_TYPE_OPTIONS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const PROBATION_OPTIONS = ['None', 'Probation', 'Parole', 'Both', 'Pre-Trial Supervision', 'Pre-Trial Supervision + Probation', 'Deferred Sentence', 'Diversion Program'];
const LANGUAGE_OPTIONS = ['English', 'Spanish', 'Portuguese', 'French', 'Mandarin', 'Cantonese', 'Vietnamese', 'Korean', 'Japanese', 'Arabic', 'Russian', 'German', 'Tagalog', 'Hindi', 'Urdu', 'Farsi', 'Somali', 'Swahili', 'Navajo', 'American Sign Language', 'Other'];
const CITIZENSHIP_OPTIONS = ['U.S. Citizen', 'Permanent Resident', 'Visa Holder', 'Refugee', 'Asylum Seeker', 'Undocumented', 'Foreign National', 'Dual Citizenship', 'Unknown', 'Other'];
const OCCUPATION_OPTIONS = ['Unemployed', 'Student', 'Retired', 'Self-Employed', 'Construction', 'Food Service', 'Healthcare', 'Retail', 'Transportation', 'Manufacturing', 'Agriculture', 'Education', 'Public Safety', 'Military', 'IT / Technology', 'Finance / Banking', 'Legal', 'Sales', 'Skilled Trades', 'Government', 'Hospitality', 'Warehouse / Logistics', 'Maintenance / Janitorial', 'Security', 'Social Services', 'Other'];
const GANG_OPTIONS = ['None', 'Sureños (13)', 'Norteños (14)', 'MS-13', 'Latin Kings', 'Bloods', 'Crips', '18th Street', 'Aryan Brotherhood', 'Hells Angels', 'Mongols MC', 'Bandidos MC', 'Vagos MC', 'Tongan Crip Gang', 'Other — See Notes'];

export default function PersonFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  editingPerson,
}: PersonFormModalProps) {
  const [form, setForm] = useState<PersonFormData>(EMPTY_FORM);
  const { isDirty, snapshot } = useFormDirty(form, isOpen);
  const [activeSection, setActiveSection] = useState<'basic' | 'physical' | 'id' | 'contact' | 'other'>('basic');
  const [showSSN, setShowSSN] = useState(false);
  const [idImageFile, setIdImageFile] = useState<File | null>(null);
  const [idImagePreview, setIdImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (editingPerson) {
        const initial: PersonFormData = {
          first_name: editingPerson.first_name || '',
          last_name: editingPerson.last_name || '',
          middle_name: editingPerson.middle_name || '',
          alias_nickname: editingPerson.alias_nickname || '',
          dob: editingPerson.date_of_birth || '',
          gender: editingPerson.gender || '',
          race: editingPerson.race || '',
          height: editingPerson.height || '',
          height_feet: editingPerson.height_feet != null ? String(editingPerson.height_feet) : '',
          height_inches: editingPerson.height_inches != null ? String(editingPerson.height_inches) : '',
          weight: editingPerson.weight || '',
          build: editingPerson.build || '',
          complexion: editingPerson.complexion || '',
          hair_color: editingPerson.hair_color || '',
          eye_color: editingPerson.eye_color || '',
          scars_marks_tattoos: editingPerson.scars_marks_tattoos || '',
          clothing_description: editingPerson.clothing_description || '',
          address: editingPerson.address || '',
          city: editingPerson.city || '',
          state: editingPerson.state || '',
          zip: editingPerson.zip || '',
          phone: editingPerson.phone || '',
          email: editingPerson.email || '',
          dl_number: editingPerson.dl_number || '',
          dl_state: editingPerson.dl_state || '',
          dl_expiry: editingPerson.dl_expiry || '',
          dl_class: editingPerson.dl_class || '',
          ssn_last4: editingPerson.ssn_last4 || '',
          ssn_full: editingPerson.ssn_full || '',
          id_image_url: editingPerson.id_image_url || '',
          id_type: editingPerson.id_type || '',
          id_number: editingPerson.id_number || '',
          id_state: editingPerson.id_state || '',
          id_expiry: editingPerson.id_expiry || '',
          employer: editingPerson.employer || '',
          occupation: editingPerson.occupation || '',
          emergency_contact_name: editingPerson.emergency_contact_name || '',
          emergency_contact_phone: editingPerson.emergency_contact_phone || '',
          language: editingPerson.language || '',
          gang_affiliation: editingPerson.gang_affiliation || '',
          is_sex_offender: editingPerson.is_sex_offender || false,
          is_veteran: editingPerson.is_veteran || false,
          place_of_birth: editingPerson.place_of_birth || '',
          citizenship: editingPerson.citizenship || '',
          marital_status: editingPerson.marital_status || '',
          hair_length: editingPerson.hair_length || '',
          hair_style: editingPerson.hair_style || '',
          facial_hair: editingPerson.facial_hair || '',
          glasses: editingPerson.glasses || '',
          shoe_size: editingPerson.shoe_size || '',
          blood_type: editingPerson.blood_type || '',
          phone_secondary: editingPerson.phone_secondary || '',
          social_media: editingPerson.social_media || '',
          probation_parole: editingPerson.probation_parole || '',
          probation_parole_officer: editingPerson.probation_parole_officer || '',
          known_associates: editingPerson.known_associates || '',
          emergency_contact_relationship: editingPerson.emergency_contact_relationship || '',
          caution_flags: editingPerson.caution_flags || '',
          notes: editingPerson.notes || '',
        };
        setForm(initial);
        snapshot(initial);
      } else {
        setForm(EMPTY_FORM);
        snapshot(EMPTY_FORM);
      }
      setActiveSection('basic');
      setShowSSN(false);
      setIdImageFile(null);
      setIdImagePreview(null);
    }
  }, [isOpen, editingPerson]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      setForm((prev) => ({ ...prev, [name]: (e.target as HTMLInputElement).checked }));
    } else {
      setForm((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleSSNChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Auto-format SSN as XXX-XX-XXXX
    let raw = e.target.value.replace(/\D/g, '').slice(0, 9);
    if (raw.length > 5) raw = `${raw.slice(0, 3)}-${raw.slice(3, 5)}-${raw.slice(5)}`;
    else if (raw.length > 3) raw = `${raw.slice(0, 3)}-${raw.slice(3)}`;
    setForm((prev) => ({ ...prev, ssn_full: raw }));
    // Auto-populate last 4 from full SSN
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 4) {
      setForm((prev) => ({ ...prev, ssn_full: raw, ssn_last4: digits.slice(-4) }));
    }
  };

  const handleIdImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    setIdImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setIdImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const removeIdImage = () => {
    setIdImageFile(null);
    setIdImagePreview(null);
    setForm((prev) => ({ ...prev, id_image_url: '' }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    let finalForm = { ...form };

    // Compose height string from feet/inches dropdowns
    if (finalForm.height_feet) {
      const ft = finalForm.height_feet;
      const inch = finalForm.height_inches || '0';
      finalForm.height = `${ft}'${inch.padStart(2, '0')}"`;
    }

    // If there's a new image file, upload it first
    if (idImageFile) {
      setUploadingImage(true);
      try {
        const results = await apiUploadFiles([idImageFile], 'person_id_image');
        if (results.length > 0) {
          const token = localStorage.getItem('rmpg_token');
          finalForm.id_image_url = `/api/uploads/${results[0].file_id}${token ? `?token=${token}` : ''}`;
        }
      } catch (err) {
        console.error('ID image upload failed:', err);
      } finally {
        setUploadingImage(false);
      }
    }

    onSubmit(finalForm);
  };

  const sections = [
    { id: 'basic' as const, label: 'Basic Info' },
    { id: 'physical' as const, label: 'Physical' },
    { id: 'id' as const, label: 'Identification' },
    { id: 'contact' as const, label: 'Contact' },
    { id: 'other' as const, label: 'Other' },
  ];

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title={editingPerson ? 'Edit Person' : 'New Person'}
      icon={UserCircle}
      submitLabel={editingPerson ? 'Update' : 'Create'}
      isSubmitting={isSubmitting}
      maxWidth="max-w-4xl"
      isDirty={isDirty}
    >
      {/* Section Tabs */}
      <div className="flex gap-1 -mt-2 mb-3 border-b border-rmpg-700 pb-2">
        {sections.map((s) => (
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

      {/* ── BASIC INFO ── */}
      {activeSection === 'basic' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">First Name *</label>
              <input name="first_name" type="text" required className="input-dark mt-1" value={form.first_name} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Middle Name</label>
              <input name="middle_name" type="text" className="input-dark mt-1" value={form.middle_name} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Last Name *</label>
              <input name="last_name" type="text" required className="input-dark mt-1" value={form.last_name} onChange={handleChange} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Alias / Nickname</label>
              <input name="alias_nickname" type="text" className="input-dark mt-1" placeholder="AKA, street name" value={form.alias_nickname} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Date of Birth</label>
              <input name="dob" type="date" className="input-dark mt-1" value={form.dob} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Gender</label>
              <select name="gender" className="select-dark mt-1" value={form.gender} onChange={handleChange}>
                <option value="">-- Select --</option>
                {GENDER_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Race / Ethnicity</label>
              <select name="race" className="select-dark mt-1" value={form.race} onChange={handleChange}>
                <option value="">-- Select --</option>
                {RACE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Language</label>
              <select name="language" className="select-dark mt-1" value={form.language} onChange={handleChange}>
                <option value="">-- Select --</option>
                {LANGUAGE_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">SSN (Last 4)</label>
              <input name="ssn_last4" type="text" maxLength={4} className="input-dark mt-1" placeholder="XXXX" value={form.ssn_last4} onChange={handleChange} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Place of Birth</label>
              <input name="place_of_birth" type="text" className="input-dark mt-1" placeholder="City, State or Country" value={form.place_of_birth} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Citizenship</label>
              <select name="citizenship" className="select-dark mt-1" value={form.citizenship} onChange={handleChange}>
                <option value="">-- Select --</option>
                {CITIZENSHIP_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Marital Status</label>
              <select name="marital_status" className="select-dark mt-1" value={form.marital_status} onChange={handleChange}>
                <option value="">-- Select --</option>
                {MARITAL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Blood Type</label>
              <select name="blood_type" className="select-dark mt-1" value={form.blood_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                {BLOOD_TYPE_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Social Media</label>
              <input name="social_media" type="text" className="input-dark mt-1" placeholder="@handle, profiles, etc." value={form.social_media} onChange={handleChange} />
            </div>
          </div>
        </>
      )}

      {/* ── PHYSICAL DESCRIPTION ── */}
      {activeSection === 'physical' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Height (ft)</label>
              <select name="height_feet" className="select-dark mt-1" value={form.height_feet} onChange={handleChange}>
                <option value="">--</option>
                {[3,4,5,6,7].map(f => <option key={f} value={String(f)}>{f}&apos;</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Height (in)</label>
              <select name="height_inches" className="select-dark mt-1" value={form.height_inches} onChange={handleChange}>
                <option value="">--</option>
                {[0,1,2,3,4,5,6,7,8,9,10,11].map(i => <option key={i} value={String(i)}>{i}&quot;</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Weight</label>
              <input name="weight" type="text" className="input-dark mt-1" placeholder="e.g. 185 lbs" value={form.weight} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Build</label>
              <select name="build" className="select-dark mt-1" value={form.build} onChange={handleChange}>
                <option value="">-- Select --</option>
                {BUILD_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Complexion</label>
              <select name="complexion" className="select-dark mt-1" value={form.complexion} onChange={handleChange}>
                <option value="">-- Select --</option>
                {COMPLEXION_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Hair Color</label>
              <select name="hair_color" className="select-dark mt-1" value={form.hair_color} onChange={handleChange}>
                <option value="">-- Select --</option>
                {HAIR_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Eye Color</label>
              <select name="eye_color" className="select-dark mt-1" value={form.eye_color} onChange={handleChange}>
                <option value="">-- Select --</option>
                {EYE_OPTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Hair Length</label>
              <select name="hair_length" className="select-dark mt-1" value={form.hair_length} onChange={handleChange}>
                <option value="">-- Select --</option>
                {HAIR_LENGTH_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Hair Style</label>
              <select name="hair_style" className="select-dark mt-1" value={form.hair_style} onChange={handleChange}>
                <option value="">-- Select --</option>
                {HAIR_STYLE_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Facial Hair</label>
              <select name="facial_hair" className="select-dark mt-1" value={form.facial_hair} onChange={handleChange}>
                <option value="">-- Select --</option>
                {FACIAL_HAIR_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Glasses</label>
              <select name="glasses" className="select-dark mt-1" value={form.glasses} onChange={handleChange}>
                <option value="">-- Select --</option>
                {GLASSES_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Shoe Size</label>
              <input name="shoe_size" type="text" className="input-dark mt-1" placeholder="e.g. 10.5" value={form.shoe_size} onChange={handleChange} />
            </div>
          </div>

          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Scars / Marks / Tattoos</label>
            <textarea name="scars_marks_tattoos" rows={2} className="input-dark mt-1" placeholder="Describe location, type, and detail of any distinguishing marks" value={form.scars_marks_tattoos} onChange={handleChange} />
          </div>

          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Clothing Description</label>
            <input name="clothing_description" type="text" className="input-dark mt-1" placeholder="Last known clothing description" value={form.clothing_description} onChange={handleChange} />
          </div>
        </>
      )}

      {/* ── IDENTIFICATION ── */}
      {activeSection === 'id' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="col-span-2">
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Driver License #</label>
              <input name="dl_number" type="text" className="input-dark mt-1" value={form.dl_number} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">DL State</label>
              <input name="dl_state" type="text" maxLength={2} className="input-dark mt-1" placeholder="UT" value={form.dl_state} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">DL Class</label>
              <select name="dl_class" className="select-dark mt-1" value={form.dl_class} onChange={handleChange}>
                <option value="">-- Select --</option>
                {DL_CLASS_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">DL Expiry</label>
              <input name="dl_expiry" type="date" className="input-dark mt-1" value={form.dl_expiry} onChange={handleChange} />
            </div>
          </div>

          {/* Confidential ID Section */}
          <div className="border-t border-rmpg-600 pt-3 mt-3">
            <label className="text-[10px] text-red-400 uppercase font-bold tracking-wider mb-2 block flex items-center gap-1.5">
              <CreditCard className="w-3 h-3" /> Confidential Information
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Full SSN</label>
                <div className="relative mt-1">
                  <input
                    name="ssn_full"
                    type={showSSN ? 'text' : 'password'}
                    className="input-dark pr-9 font-mono tracking-wider"
                    placeholder="XXX-XX-XXXX"
                    maxLength={11}
                    value={form.ssn_full}
                    onChange={handleSSNChange}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSSN(!showSSN)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-white transition-colors"
                    title={showSSN ? 'Hide SSN' : 'Show SSN'}
                  >
                    {showSSN ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-[9px] text-rmpg-500 mt-0.5">Auto-populates Last 4</p>
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">SSN (Last 4 — Display)</label>
                <input name="ssn_last4" type="text" maxLength={4} className="input-dark mt-1 font-mono" placeholder="XXXX" value={form.ssn_last4} onChange={handleChange} />
              </div>
            </div>
          </div>

          {/* Other ID */}
          <div className="border-t border-rmpg-600 pt-3 mt-3">
            <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 block">Other ID / Government ID</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">ID Type</label>
                <select name="id_type" className="select-dark mt-1" value={form.id_type} onChange={handleChange}>
                  <option value="">-- Select --</option>
                  <option value="state_id">State ID</option>
                  <option value="passport">Passport</option>
                  <option value="military_id">Military ID</option>
                  <option value="tribal_id">Tribal ID</option>
                  <option value="green_card">Green Card</option>
                  <option value="visa">Visa</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">ID Number</label>
                <input name="id_number" type="text" className="input-dark mt-1" value={form.id_number} onChange={handleChange} />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">ID State</label>
                <input name="id_state" type="text" maxLength={2} className="input-dark mt-1" placeholder="UT" value={form.id_state} onChange={handleChange} />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">ID Expiry</label>
                <input name="id_expiry" type="date" className="input-dark mt-1" value={form.id_expiry} onChange={handleChange} />
              </div>
            </div>
          </div>

          {/* ID Image Upload */}
          <div className="border-t border-rmpg-600 pt-3 mt-3">
            <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 block">ID Photo / Image</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleIdImageSelect}
            />
            <div className="flex gap-3 items-start">
              {/* Preview area */}
              <div className="flex-shrink-0 w-32 h-40 border border-rmpg-500 bg-rmpg-900 overflow-hidden relative group">
                {(idImagePreview || form.id_image_url) ? (
                  <>
                    <img
                      src={idImagePreview || form.id_image_url}
                      alt="ID"
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <button
                      type="button"
                      onClick={removeIdImage}
                      className="absolute top-1 right-1 w-5 h-5 bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove image"
                    >
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-rmpg-500">
                    <CreditCard className="w-8 h-8 mb-1" />
                    <span className="text-[9px]">No Image</span>
                  </div>
                )}
              </div>
              {/* Upload controls */}
              <div className="flex-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase text-rmpg-200 bg-rmpg-700/60 border border-rmpg-500 hover:bg-rmpg-600/60 transition-colors"
                >
                  <Upload className="w-3 h-3" />
                  {form.id_image_url || idImageFile ? 'Replace Image' : 'Upload ID Image'}
                </button>
                <p className="text-[9px] text-rmpg-500 mt-1.5">Accepted: JPEG, PNG, GIF, WebP. Max 50MB.</p>
                {idImageFile && (
                  <p className="text-[9px] text-green-400 mt-0.5">{idImageFile.name} ({(idImageFile.size / 1024).toFixed(0)} KB)</p>
                )}
                {uploadingImage && (
                  <p className="text-[9px] text-amber-400 mt-0.5 animate-pulse">Uploading image...</p>
                )}
                {/* Fallback: manual URL entry */}
                <div className="mt-2">
                  <label className="text-[9px] text-rmpg-500 uppercase font-semibold">Or enter image URL directly</label>
                  <input name="id_image_url" type="text" className="input-dark mt-0.5 text-xs" placeholder="https://..." value={form.id_image_url} onChange={handleChange} />
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Employer</label>
              <input name="employer" type="text" className="input-dark mt-1" value={form.employer} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Occupation</label>
              <select name="occupation" className="select-dark mt-1" value={form.occupation} onChange={handleChange}>
                <option value="">-- Select --</option>
                {OCCUPATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
          </div>
        </>
      )}

      {/* ── CONTACT INFO ── */}
      {activeSection === 'contact' && (
        <>
          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Street Address</label>
            <AddressAutocomplete
              name="address"
              className="input-dark mt-1"
              placeholder="Street address"
              value={form.address}
              onChange={(val) => setForm((prev) => ({ ...prev, address: val }))}
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
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">City</label>
              <input name="city" type="text" className="input-dark mt-1" value={form.city} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">State</label>
              <input name="state" type="text" maxLength={2} className="input-dark mt-1" placeholder="UT" value={form.state} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">ZIP</label>
              <input name="zip" type="text" className="input-dark mt-1" value={form.zip} onChange={handleChange} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Phone</label>
              <input name="phone" type="text" className="input-dark mt-1" value={form.phone} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Phone (Secondary)</label>
              <input name="phone_secondary" type="text" className="input-dark mt-1" value={form.phone_secondary} onChange={handleChange} />
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Email</label>
              <input name="email" type="email" className="input-dark mt-1" value={form.email} onChange={handleChange} />
            </div>
          </div>

          <div className="border-t border-rmpg-700 pt-3">
            <label className="text-[10px] text-red-400 uppercase font-semibold mb-2 block">Emergency Contact</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Contact Name</label>
                <input name="emergency_contact_name" type="text" className="input-dark mt-1" value={form.emergency_contact_name} onChange={handleChange} />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Contact Phone</label>
                <input name="emergency_contact_phone" type="text" className="input-dark mt-1" value={form.emergency_contact_phone} onChange={handleChange} />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Relationship</label>
                <input name="emergency_contact_relationship" type="text" className="input-dark mt-1" placeholder="e.g. Spouse, Parent" value={form.emergency_contact_relationship} onChange={handleChange} />
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── OTHER / ALERTS ── */}
      {activeSection === 'other' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Gang Affiliation</label>
              <select name="gang_affiliation" className="select-dark mt-1" value={form.gang_affiliation} onChange={handleChange}>
                <option value="">-- Select --</option>
                {GANG_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Probation / Parole</label>
              <select name="probation_parole" className="select-dark mt-1" value={form.probation_parole} onChange={handleChange}>
                <option value="">-- Select --</option>
                {PROBATION_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          {form.probation_parole && form.probation_parole !== 'None' && (
            <div>
              <label className="text-[10px] text-rmpg-400 uppercase font-semibold">P.O. / Parole Officer Name</label>
              <input name="probation_parole_officer" type="text" className="input-dark mt-1" placeholder="Officer name and contact" value={form.probation_parole_officer} onChange={handleChange} />
            </div>
          )}

          <div className="flex items-center gap-6 py-2">
            <label className="flex items-center gap-2 text-xs text-rmpg-200 cursor-pointer">
              <input type="checkbox" name="is_sex_offender" checked={form.is_sex_offender} onChange={handleChange}
                className="w-4 h-4 bg-rmpg-800 border-rmpg-600 text-red-600 focus:ring-red-500" />
              Registered Sex Offender
            </label>
            <label className="flex items-center gap-2 text-xs text-rmpg-200 cursor-pointer">
              <input type="checkbox" name="is_veteran" checked={form.is_veteran} onChange={handleChange}
                className="w-4 h-4 bg-rmpg-800 border-rmpg-600 text-brand-500 focus:ring-brand-500" />
              Military Veteran
            </label>
          </div>

          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Known Associates</label>
            <textarea name="known_associates" rows={2} className="input-dark mt-1" placeholder="Names of known associates" value={form.known_associates} onChange={handleChange} />
          </div>

          <div>
            <label className="text-[10px] text-red-400 uppercase font-semibold">Officer Safety / Caution Flags</label>
            <textarea name="caution_flags" rows={2} className="input-dark mt-1" placeholder="Any officer safety concerns, violent history, weapons, etc." value={form.caution_flags} onChange={handleChange} />
          </div>

          <div>
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold">Notes</label>
            <textarea name="notes" rows={4} className="input-dark mt-1" value={form.notes} onChange={handleChange} />
          </div>
        </>
      )}
    </FormModal>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { UserCircle, Eye, EyeOff, Upload, X, CreditCard, AlertTriangle } from 'lucide-react';
import FormModal from './FormModal';
import { useFormDraft } from '../hooks/useFormDraft';
import type { Person } from '../types';
import { apiUploadFiles, authedImageUrl } from '../hooks/useApi';
import AddressAutocomplete, { type ParsedAddress } from './AddressAutocomplete';
import { formatPhoneInput } from '../utils/formatters';

import RichTextArea from './RichTextArea';
import FormField from './records/FormField';
import {
  GENDER_OPTIONS, RACE_OPTIONS, MARITAL_OPTIONS, CITIZENSHIP_OPTIONS,
  IMMIGRATION_OPTIONS, LANGUAGE_OPTIONS, BLOOD_TYPE_OPTIONS,
  BUILD_OPTIONS, COMPLEXION_OPTIONS, HAIR_COLOR_OPTIONS,
  HAIR_LENGTH_OPTIONS, HAIR_STYLE_OPTIONS, FACIAL_HAIR_OPTIONS,
  EYE_COLOR_OPTIONS, GLASSES_OPTIONS,
  PROBATION_OPTIONS, ID_TYPE_OPTIONS, DL_CLASS_OPTIONS,
  EDUCATION_OPTIONS, OCCUPATION_OPTIONS,
  MILITARY_BRANCH_OPTIONS, MILITARY_STATUS_OPTIONS,
  DISABILITY_OPTIONS, GANG_OPTIONS,
  TRIBAL_AFFILIATION_OPTIONS,
  EMERGENCY_CONTACT_RELATIONSHIPS,
} from '../constants/lawEnforcementEnums';
interface PersonFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: PersonFormData) => void;
  isSubmitting: boolean;
  editingPerson?: Person;
  submitError?: string | null;
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
  address_2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  dl_number: string;
  dl_state: string;
  dl_expiry: string;
  dl_class: string;
  dl_issue_date: string;
  dl_restrictions: string;
  dl_endorsements: string;
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
  ncic_number: string;
  sor_number: string;
  fbi_number: string;
  state_id_number: string;
  passport_number: string;
  passport_country: string;
  immigration_status: string;
  disability_flags: string;
  mental_health_flags: string;
  substance_abuse: string;
  medication_notes: string;
  education_level: string;
  military_branch: string;
  military_status: string;
  tribal_affiliation: string;
  tattoo_description: string;
  scar_description: string;
  piercing_description: string;
  distinguishing_features: string;
  identifying_marks_location: string;
  voice_description: string;
  religion: string;
  dietary_restrictions: string;
  notes: string;
  email_secondary: string;
  date_last_seen: string;
  location_last_seen: string;
  alias_dob: string;
  home_phone: string;
  work_phone: string;
  // Newly surfaced — all accepted by PERSON_FIELD_MAP in the live Worker.
  suffix: string;
  nationality: string;
  aliases: string;
  photo_url: string;
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
  address_2: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  email: '',
  dl_number: '',
  dl_state: '',
  dl_expiry: '',
  dl_class: '',
  dl_issue_date: '',
  dl_restrictions: '',
  dl_endorsements: '',
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
  ncic_number: '',
  sor_number: '',
  fbi_number: '',
  state_id_number: '',
  passport_number: '',
  passport_country: '',
  immigration_status: '',
  disability_flags: '',
  mental_health_flags: '',
  substance_abuse: '',
  medication_notes: '',
  education_level: '',
  military_branch: '',
  military_status: '',
  tribal_affiliation: '',
  tattoo_description: '',
  scar_description: '',
  piercing_description: '',
  distinguishing_features: '',
  identifying_marks_location: '',
  voice_description: '',
  religion: '',
  dietary_restrictions: '',
  notes: '',
  email_secondary: '',
  date_last_seen: '',
  location_last_seen: '',
  alias_dob: '',
  home_phone: '',
  work_phone: '',
  suffix: '',
  nationality: '',
  aliases: '',
  photo_url: '',
};

// Inline _OPTIONS arrays migrated to client/src/constants/lawEnforcementEnums.ts
// (single source of truth across all Edit*Modal forms — see top-of-file imports).
// Two arrays were renamed during migration for clarity: HAIR_OPTIONS → HAIR_COLOR_OPTIONS
// and EYE_OPTIONS → EYE_COLOR_OPTIONS, since "HAIR_LENGTH_OPTIONS" / "HAIR_STYLE_OPTIONS"
// already existed and the bare `HAIR` was ambiguous about which dimension it meant.

export default function PersonFormModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  editingPerson,
  submitError,
}: PersonFormModalProps) {
  const {
    form,
    setForm,
    isDirty,
    wasRestored,
    clearDraft,
    signalSaved,
    snapshot,
  } = useFormDraft<PersonFormData>({
    storageKey: `rmpg_person_form_${editingPerson?.id ?? 'new'}`,
    defaultValue: EMPTY_FORM,
    isActive: isOpen,
  });
  const [activeSection, setActiveSection] = useState<'basic' | 'physical' | 'id' | 'contact' | 'law' | 'other'>('basic');
  const [showSSN, setShowSSN] = useState(false);
  const [idImageFile, setIdImageFile] = useState<File | null>(null);
  const [idImagePreview, setIdImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  // Warn-and-choose state for a failed ID-image upload (after auto-retry).
  // Non-null uploadError means: hold the save, show the recovery panel.
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadRetryInfo, setUploadRetryInfo] = useState<{ attempt: number; max: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drop any stale upload-failure prompt when the modal closes.
  useEffect(() => {
    if (!isOpen) { setUploadError(null); setUploadRetryInfo(null); }
  }, [isOpen]);

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
          address_2: editingPerson.address_2 || '',
          city: editingPerson.city || '',
          state: editingPerson.state || '',
          zip: editingPerson.zip || '',
          phone: editingPerson.phone || '',
          email: editingPerson.email || '',
          dl_number: editingPerson.dl_number || '',
          dl_state: editingPerson.dl_state || '',
          dl_expiry: editingPerson.dl_expiry || '',
          dl_class: editingPerson.dl_class || '',
          dl_issue_date: editingPerson.dl_issue_date || '',
          dl_restrictions: editingPerson.dl_restrictions || '',
          dl_endorsements: editingPerson.dl_endorsements || '',
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
          ncic_number: editingPerson.ncic_number || '',
          sor_number: editingPerson.sor_number || '',
          fbi_number: editingPerson.fbi_number || '',
          state_id_number: editingPerson.state_id_number || '',
          passport_number: editingPerson.passport_number || '',
          passport_country: editingPerson.passport_country || '',
          immigration_status: editingPerson.immigration_status || '',
          disability_flags: editingPerson.disability_flags || '',
          mental_health_flags: editingPerson.mental_health_flags || '',
          substance_abuse: editingPerson.substance_abuse || '',
          medication_notes: editingPerson.medication_notes || '',
          education_level: editingPerson.education_level || '',
          military_branch: editingPerson.military_branch || '',
          military_status: editingPerson.military_status || '',
          tribal_affiliation: editingPerson.tribal_affiliation || '',
          tattoo_description: editingPerson.tattoo_description || '',
          scar_description: editingPerson.scar_description || '',
          piercing_description: editingPerson.piercing_description || '',
          distinguishing_features: editingPerson.distinguishing_features || '',
          identifying_marks_location: editingPerson.identifying_marks_location || '',
          voice_description: editingPerson.voice_description || '',
          religion: editingPerson.religion || '',
          dietary_restrictions: editingPerson.dietary_restrictions || '',
          notes: editingPerson.notes || '',
          email_secondary: editingPerson.email_secondary || '',
          date_last_seen: editingPerson.date_last_seen || '',
          location_last_seen: editingPerson.location_last_seen || '',
          alias_dob: editingPerson.alias_dob || '',
          home_phone: editingPerson.home_phone || '',
          work_phone: editingPerson.work_phone || '',
          suffix: editingPerson.suffix || '',
          nationality: editingPerson.nationality || '',
          aliases: editingPerson.aliases || '',
          photo_url: editingPerson.photo_url || '',
        };
        setForm(initial);
        snapshot();
      } else {
        setForm(EMPTY_FORM);
        snapshot();
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
    setUploadError(null); // fresh file → clear any prior upload-failure prompt
    setIdImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setIdImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const removeIdImage = () => {
    setIdImageFile(null);
    setIdImagePreview(null);
    setForm((prev) => ({ ...prev, id_image_url: '' }));
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Pure: assemble the saveable record from current form state (height etc.).
  const composeFinalForm = (): PersonFormData => {
    const finalForm = { ...form };
    if (finalForm.height_feet != null && finalForm.height_feet !== '') {
      const ft = finalForm.height_feet;
      const inch = finalForm.height_inches || '0';
      finalForm.height = `${ft}'${inch.padStart(2, '0')}"`;
    }
    return finalForm;
  };

  // Upload the selected ID image (with auto-retry), THEN save. If the upload
  // still fails after retries we STOP and surface a recoverable choice — we
  // never silently save the record without the ID photo (the 2026-06-13 bug).
  const uploadThenSubmit = async (finalForm: PersonFormData) => {
    if (!idImageFile) {
      signalSaved();
      onSubmit(finalForm);
      return;
    }
    setUploadingImage(true);
    setUploadError(null);
    let uploaded = false;
    try {
      const results = await apiUploadFiles([idImageFile], 'person_id_image', undefined, {
        retries: 3,
        onRetry: (attempt, max) => setUploadRetryInfo({ attempt, max }),
      });
      if (results.length > 0) {
        finalForm.id_image_url = `/api/uploads/${results[0].file_id}`;
      }
      uploaded = true;
    } catch (err) {
      console.error('ID image upload failed:', err);
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingImage(false);
      setUploadRetryInfo(null);
    }
    // Only save once the photo is attached. On failure we hold here and let the
    // warn-and-choose panel drive the next step (retry / save-without / cancel).
    if (uploaded) {
      signalSaved();
      onSubmit(finalForm);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await uploadThenSubmit(composeFinalForm());
  };

  // Warn-and-choose recovery actions (shown when uploadError is set).
  // Each recomposes from the *current* form so edits made while the prompt was
  // up are preserved.
  const retryImageUpload = () => { void uploadThenSubmit(composeFinalForm()); };
  const saveWithoutImage = () => {
    // Keep whatever id_image_url already existed (the prior saved image when
    // editing, or empty for a new person) — just don't attach the file that
    // wouldn't upload. The officer can re-edit later to add it.
    setUploadError(null);
    signalSaved();
    onSubmit(composeFinalForm());
  };
  const dismissUploadError = () => setUploadError(null);

  const sections = [
    { id: 'basic' as const, label: 'Basic Info' },
    { id: 'physical' as const, label: 'Physical' },
    { id: 'id' as const, label: 'Identification' },
    { id: 'contact' as const, label: 'Contact' },
    { id: 'law' as const, label: 'Background' },
    { id: 'other' as const, label: 'Alerts & Notes' },
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
      draftRestored={wasRestored}
      onDiscardDraft={clearDraft}
    >
      {/* Submit Error */}
      {submitError && (
        <div className="px-3 py-2 -mt-2 mb-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">
          {submitError}
        </div>
      )}

      {/* ID image upload failed (after auto-retry) — warn and let the user choose */}
      {uploadError && (
        <div className="px-3 py-2 -mt-2 mb-2 bg-amber-900/30 border border-amber-700 text-amber-300 text-xs space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-bold uppercase tracking-wider text-amber-200">ID image didn’t upload</div>
              <div className="mt-0.5">
                {uploadError} — the rest of the record is ready. Retry the upload, save without the
                image for now, or cancel to stay on the form.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 pl-6">
            <button
              type="button"
              onClick={retryImageUpload}
              disabled={uploadingImage}
              className="toolbar-btn text-amber-200 border-amber-600 hover:bg-amber-900/40 disabled:opacity-50"
              style={{ padding: '3px 12px' }}
            >
              {uploadingImage ? 'Retrying…' : 'Retry upload'}
            </button>
            <button
              type="button"
              onClick={saveWithoutImage}
              disabled={uploadingImage}
              className="toolbar-btn disabled:opacity-50"
              style={{ padding: '3px 12px' }}
            >
              Save without image
            </button>
            <button
              type="button"
              onClick={dismissUploadError}
              disabled={uploadingImage}
              className="toolbar-btn text-rmpg-400 disabled:opacity-50"
              style={{ padding: '3px 12px' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
                : 'text-rmpg-400 hover:text-rmpg-100 hover:bg-rmpg-700/40 border border-transparent'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── BASIC INFO ── */}
      {activeSection === 'basic' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <FormField label="First Name" required>
              <input name="first_name" type="text" required className="input-dark mt-1" value={form.first_name} onChange={handleChange} />
            </FormField>
            <FormField label="Middle Name">
              <input name="middle_name" type="text" className="input-dark mt-1" value={form.middle_name} onChange={handleChange} />
            </FormField>
            <FormField label="Last Name" required>
              <input name="last_name" type="text" required className="input-dark mt-1" value={form.last_name} onChange={handleChange} />
            </FormField>
            <FormField label="Suffix">
              <input name="suffix" type="text" className="input-dark mt-1" placeholder="Jr / Sr / III" value={form.suffix} onChange={handleChange} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <FormField label="Alias / Nickname">
              <input name="alias_nickname" type="text" className="input-dark mt-1" placeholder="AKA, street name" value={form.alias_nickname} onChange={handleChange} />
            </FormField>
            <FormField label="Other Aliases" className="col-span-1 sm:col-span-1 md:col-span-2">
              <input name="aliases" type="text" className="input-dark mt-1" placeholder="Comma-separated: Doc Holiday, JT, Slim" value={form.aliases} onChange={handleChange} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="Date of Birth">
              <input name="dob" type="date" className="input-dark mt-1" value={form.dob} onChange={handleChange} />
            </FormField>
            <FormField label="Alias / Alt. DOB">
              <input name="alias_dob" type="date" className="input-dark mt-1" title="Alternate or reported date of birth" value={form.alias_dob} onChange={handleChange} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="Gender">
              <select name="gender" className="select-dark mt-1" value={form.gender} onChange={handleChange}>
                <option value="">-- Select --</option>
                {GENDER_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </FormField>
            <FormField label="Race / Ethnicity">
              <select name="race" className="select-dark mt-1" value={form.race} onChange={handleChange}>
                <option value="">-- Select --</option>
                {RACE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="Language">
              <select name="language" className="select-dark mt-1" value={form.language} onChange={handleChange}>
                <option value="">-- Select --</option>
                {LANGUAGE_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </FormField>
            <FormField label="Nationality">
              <input name="nationality" type="text" className="input-dark mt-1" placeholder="e.g. American, Mexican, Filipino" value={form.nationality} onChange={handleChange} />
            </FormField>
            <FormField label="SSN (Last 4)">
              <input name="ssn_last4" type="text" maxLength={4} className="input-dark mt-1" placeholder="XXXX" value={form.ssn_last4} onChange={handleChange} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="Place of Birth">
              <AddressAutocomplete
                name="place_of_birth"
                className="input-dark mt-1 w-full"
                placeholder="City, State or Country"
                value={form.place_of_birth}
                onChange={(val) => setForm((prev) => ({ ...prev, place_of_birth: val }))}
                types="place,region,country"
              />
            </FormField>
            <FormField label="Citizenship">
              <select name="citizenship" className="select-dark mt-1" value={form.citizenship} onChange={handleChange}>
                <option value="">-- Select --</option>
                {CITIZENSHIP_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </FormField>
            <FormField label="Marital Status">
              <select name="marital_status" className="select-dark mt-1" value={form.marital_status} onChange={handleChange}>
                <option value="">-- Select --</option>
                {MARITAL_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </FormField>
          </div>
        </>
      )}

      {/* ── PHYSICAL DESCRIPTION ── */}
      {activeSection === 'physical' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <FormField label="Height (ft)">
              <select name="height_feet" className="select-dark mt-1" value={form.height_feet} onChange={handleChange}>
                <option value="">--</option>
                {[3,4,5,6,7].map(f => <option key={f} value={String(f)}>{f}&apos;</option>)}
              </select>
            </FormField>
            <FormField label="Height (in)">
              <select name="height_inches" className="select-dark mt-1" value={form.height_inches} onChange={handleChange}>
                <option value="">--</option>
                {[0,1,2,3,4,5,6,7,8,9,10,11].map(i => <option key={i} value={String(i)}>{i}&quot;</option>)}
              </select>
            </FormField>
            <FormField label="Weight">
              <input name="weight" type="text" className="input-dark mt-1" placeholder="e.g. 185 lbs" value={form.weight} onChange={handleChange} />
            </FormField>
            <FormField label="Build">
              <select name="build" className="select-dark mt-1" value={form.build} onChange={handleChange}>
                <option value="">-- Select --</option>
                {BUILD_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </FormField>
            <FormField label="Complexion">
              <select name="complexion" className="select-dark mt-1" value={form.complexion} onChange={handleChange}>
                <option value="">-- Select --</option>
                {COMPLEXION_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Hair Color">
              <select name="hair_color" className="select-dark mt-1" value={form.hair_color} onChange={handleChange}>
                <option value="">-- Select --</option>
                {HAIR_COLOR_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </FormField>
            <FormField label="Eye Color">
              <select name="eye_color" className="select-dark mt-1" value={form.eye_color} onChange={handleChange}>
                <option value="">-- Select --</option>
                {EYE_COLOR_OPTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <FormField label="Hair Length">
              <select name="hair_length" className="select-dark mt-1" value={form.hair_length} onChange={handleChange}>
                <option value="">-- Select --</option>
                {HAIR_LENGTH_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </FormField>
            <FormField label="Hair Style">
              <select name="hair_style" className="select-dark mt-1" value={form.hair_style} onChange={handleChange}>
                <option value="">-- Select --</option>
                {HAIR_STYLE_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </FormField>
            <FormField label="Facial Hair">
              <select name="facial_hair" className="select-dark mt-1" value={form.facial_hair} onChange={handleChange}>
                <option value="">-- Select --</option>
                {FACIAL_HAIR_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </FormField>
            <FormField label="Glasses">
              <select name="glasses" className="select-dark mt-1" value={form.glasses} onChange={handleChange}>
                <option value="">-- Select --</option>
                {GLASSES_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <FormField label="Shoe Size">
              <input name="shoe_size" type="text" className="input-dark mt-1" placeholder="e.g. 10.5" value={form.shoe_size} onChange={handleChange} />
            </FormField>
            <FormField label="Blood Type">
              <select name="blood_type" className="select-dark mt-1" value={form.blood_type} onChange={handleChange}>
                <option value="">-- Select --</option>
                {BLOOD_TYPE_OPTIONS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </FormField>
            <FormField label="Voice Description">
              <input name="voice_description" type="text" className="input-dark mt-1" placeholder="e.g. Deep, raspy, accent" value={form.voice_description} onChange={handleChange} />
            </FormField>
          </div>

          <FormField label="Scars / Marks / Tattoos">
            <RichTextArea name="scars_marks_tattoos" rows={2} className="input-dark mt-1" placeholder="Describe location, type, and detail of any distinguishing marks" value={form.scars_marks_tattoos} onChange={handleChange} />
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Tattoo Description">
              <RichTextArea name="tattoo_description" rows={2} className="input-dark mt-1" placeholder="Specific descriptions of tattoos — location, design, text, color" value={form.tattoo_description} onChange={handleChange} />
            </FormField>
            <FormField label="Scar Description">
              <RichTextArea name="scar_description" rows={2} className="input-dark mt-1" placeholder="Specific descriptions of scars — location, size, type" value={form.scar_description} onChange={handleChange} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Piercing Description">
              <RichTextArea name="piercing_description" rows={2} className="input-dark mt-1" placeholder="Specific descriptions of piercings — location, type" value={form.piercing_description} onChange={handleChange} />
            </FormField>
            <FormField label="Distinguishing Features">
              <RichTextArea name="distinguishing_features" rows={2} className="input-dark mt-1" placeholder="Any other distinguishing features — birthmarks, prosthetics, etc." value={form.distinguishing_features} onChange={handleChange} />
            </FormField>
          </div>
          <FormField label="Identifying Marks Location">
            <input name="identifying_marks_location" type="text" className="input-dark mt-1" placeholder="Body location of marks (e.g. Left forearm, Right neck)" value={form.identifying_marks_location} onChange={handleChange} />
          </FormField>

          <FormField label="Clothing Description">
            <input name="clothing_description" type="text" className="input-dark mt-1" placeholder="Last known clothing description" value={form.clothing_description} onChange={handleChange} />
          </FormField>
        </>
      )}

      {/* ── IDENTIFICATION ── */}
      {activeSection === 'id' && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <FormField label="Driver License #" className="col-span-2">
              <input name="dl_number" type="text" className="input-dark mt-1" value={form.dl_number} onChange={handleChange} />
            </FormField>
            <FormField label="DL State">
              <input name="dl_state" type="text" maxLength={2} className="input-dark mt-1" placeholder="UT" value={form.dl_state} onChange={handleChange} />
            </FormField>
            <FormField label="DL Class">
              <select name="dl_class" className="select-dark mt-1" value={form.dl_class} onChange={handleChange}>
                <option value="">-- Select --</option>
                {DL_CLASS_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="DL Issue Date">
              <input name="dl_issue_date" type="date" className="input-dark mt-1" value={form.dl_issue_date} onChange={handleChange} />
            </FormField>
            <FormField label="DL Expiry">
              <input name="dl_expiry" type="date" className="input-dark mt-1" value={form.dl_expiry} onChange={handleChange} />
            </FormField>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="DL Restrictions">
              <input name="dl_restrictions" type="text" className="input-dark mt-1" placeholder="e.g. Corrective lenses" value={form.dl_restrictions} onChange={handleChange} />
            </FormField>
            <FormField label="DL Endorsements">
              <input name="dl_endorsements" type="text" className="input-dark mt-1" placeholder="e.g. Motorcycle, Hazmat" value={form.dl_endorsements} onChange={handleChange} />
            </FormField>
          </div>

          {/* Confidential ID Section */}
          <div className="border-t border-rmpg-600 pt-3 mt-3">
            <label className="text-[10px] text-red-400 uppercase font-bold tracking-wider mb-2 block flex items-center gap-1.5">
              <CreditCard className="w-3 h-3" /> Confidential Information
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Full SSN" hint="Auto-populates Last 4">
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
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-rmpg-100 transition-colors"
                    title={showSSN ? 'Hide SSN' : 'Show SSN'}
                  >
                    {showSSN ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </FormField>
              <FormField label="SSN (Last 4 — Display)">
                <input name="ssn_last4" type="text" maxLength={4} className="input-dark mt-1 font-mono" placeholder="XXXX" value={form.ssn_last4} onChange={handleChange} />
              </FormField>
            </div>
          </div>

          {/* Other ID */}
          <div className="border-t border-rmpg-600 pt-3 mt-3">
            <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 block">Other ID / Government ID</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <FormField label="ID Type">
                <select name="id_type" className="select-dark mt-1" value={form.id_type} onChange={handleChange}>
                  <option value="">-- Select --</option>
                  {ID_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </FormField>
              <FormField label="ID Number">
                <input name="id_number" type="text" className="input-dark mt-1" value={form.id_number} onChange={handleChange} />
              </FormField>
              <FormField label="ID State">
                <input name="id_state" type="text" maxLength={2} className="input-dark mt-1" placeholder="UT" value={form.id_state} onChange={handleChange} />
              </FormField>
              <FormField label="ID Expiry">
                <input name="id_expiry" type="date" className="input-dark mt-1" value={form.id_expiry} onChange={handleChange} />
              </FormField>
            </div>
          </div>

          {/* Law Enforcement IDs */}
          <div className="border-t border-rmpg-600 pt-3 mt-3">
            <label className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 block">Law Enforcement Identifiers</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <FormField label="NCIC Number">
                <input name="ncic_number" type="text" className="input-dark mt-1" value={form.ncic_number} onChange={handleChange} />
              </FormField>
              <FormField label="SOR Number">
                <input name="sor_number" type="text" className="input-dark mt-1" placeholder="Sex Offender Registry #" value={form.sor_number} onChange={handleChange} />
              </FormField>
              <FormField label="FBI Number">
                <input name="fbi_number" type="text" className="input-dark mt-1" value={form.fbi_number} onChange={handleChange} />
              </FormField>
              <FormField label="State ID Number">
                <input name="state_id_number" type="text" className="input-dark mt-1" value={form.state_id_number} onChange={handleChange} />
              </FormField>
              <FormField label="Passport Number">
                <input name="passport_number" type="text" className="input-dark mt-1" value={form.passport_number} onChange={handleChange} />
              </FormField>
              <FormField label="Passport Country">
                <input name="passport_country" type="text" className="input-dark mt-1" placeholder="Issuing country" value={form.passport_country} onChange={handleChange} />
              </FormField>
            </div>
          </div>

          {/* ID Image Upload */}
          <div className="border-t border-rmpg-600 pt-3 mt-3">
            <label htmlFor="ff-personformmodal-0" className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 block">ID Photo / Image</label>
            <input id="ff-personformmodal-0"
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
                      src={idImagePreview || authedImageUrl(form.id_image_url)}
                      alt="ID"
                      className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <button
                      type="button"
                      onClick={removeIdImage}
                      className="absolute top-1 right-1 w-5 h-5 bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity"
                      title="Remove image">
                      <X className="w-3 h-3 text-rmpg-100" />
                    </button>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-fg-muted">
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
                <p className="text-[9px] text-fg-muted mt-1.5">Accepted: JPEG, PNG, GIF, WebP. Max 50MB.</p>
                {idImageFile && (
                  <p className="text-[9px] text-green-400 mt-0.5">{idImageFile.name} ({(idImageFile.size / 1024).toFixed(0)} KB)</p>
                )}
                {uploadingImage && (
                  <p className="text-[9px] text-amber-400 mt-0.5 animate-pulse">
                    {uploadRetryInfo
                      ? `Retrying upload… (${uploadRetryInfo.attempt}/${uploadRetryInfo.max})`
                      : 'Uploading image…'}
                  </p>
                )}
                {/* Fallback: manual URL entry */}
                <div className="mt-2">
                  <label className="text-[9px] text-fg-muted uppercase font-semibold">Or enter image URL directly</label>
                  <input name="id_image_url" type="text" className="input-dark mt-0.5 text-xs" placeholder="https://..." value={form.id_image_url} onChange={handleChange} />
                </div>
                {/* Separate face/mugshot photo. id_image_url is the
                    scanned ID document; photo_url is the subject's face. */}
                <div className="mt-2">
                  <label className="text-[9px] text-fg-muted uppercase font-semibold">Face Photo / Mugshot URL</label>
                  <input name="photo_url" type="text" className="input-dark mt-0.5 text-xs" placeholder="https://..." value={form.photo_url} onChange={handleChange} />
                </div>
              </div>
            </div>
          </div>

        </>
      )}

      {/* ── CONTACT INFO ── */}
      {activeSection === 'contact' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
           <div className="sm:col-span-3">
            <FormField label="Street Address">
             <AddressAutocomplete
              name="address"
              className="input-dark mt-1"
              placeholder="Street address"
              value={form.address}
              onChange={(val) => setForm((prev) => ({ ...prev, address: val }))}
              fillWith="street"
              onSelect={(addr: ParsedAddress) => {
                // Street line only — city/state/zip live in their own fields.
                setForm((prev) => ({
                  ...prev,
                  address: addr.street || addr.formatted,
                  city: addr.city || prev.city,
                  state: addr.state || prev.state,
                  zip: addr.zip || prev.zip,
                }));
              }}
             />
            </FormField>
           </div>
           <FormField label="Apt / Unit">
             <input
               name="address_2"
               type="text"
               className="input-dark mt-1 w-full"
               placeholder="Apt 4B, Unit 12, #305..."
               value={form.address_2}
               onChange={(e) => setForm((prev) => ({ ...prev, address_2: e.target.value }))}
             />
           </FormField>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
           <FormField label="City">
             <AddressAutocomplete
               name="city"
               className="input-dark mt-1 w-full"
               placeholder="City"
               value={form.city}
               onChange={(val) => setForm((prev) => ({ ...prev, city: val }))}
               types="place"
               fillWith="text"
               onSelect={(addr: ParsedAddress) => setForm((prev) => ({
                 ...prev,
                 city: addr.text || prev.city,
                 state: addr.state || prev.state,
               }))}
             />
           </FormField>
           <FormField label="State">
             <AddressAutocomplete
               name="state"
               className="input-dark mt-1 w-full"
               placeholder="State (e.g., UT)"
               value={form.state}
               onChange={(val) => setForm((prev) => ({ ...prev, state: val }))}
               types="region"
               fillWith="text"
               onSelect={(addr: ParsedAddress) => setForm((prev) => ({
                 ...prev,
                 state: addr.state || addr.text || prev.state,
               }))}
             />
           </FormField>
           <FormField label="ZIP">
             <AddressAutocomplete
               name="zip"
               className="input-dark mt-1 w-full"
               placeholder="ZIP Code"
               value={form.zip}
               onChange={(val) => setForm((prev) => ({ ...prev, zip: val }))}
               types="postcode"
               fillWith="text"
               onSelect={(addr: ParsedAddress) => setForm((prev) => ({
                 ...prev,
                 zip: addr.text || addr.zip || prev.zip,
                 city: prev.city || addr.city,
                 state: prev.state || addr.state,
               }))}
             />
           </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="Phone">
              <input name="phone" type="text" inputMode="tel" className="input-dark mt-1" value={form.phone} onChange={(e) => setForm(prev => ({ ...prev, phone: formatPhoneInput(e.target.value) }))} />
            </FormField>
            <FormField label="Phone (Secondary)">
              <input name="phone_secondary" type="text" inputMode="tel" className="input-dark mt-1" value={form.phone_secondary} onChange={(e) => setForm(prev => ({ ...prev, phone_secondary: formatPhoneInput(e.target.value) }))} />
            </FormField>
            <FormField label="Email">
              <input name="email" type="email" inputMode="email" className="input-dark mt-1" value={form.email} onChange={handleChange} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="Home Phone">
              <input name="home_phone" type="text" inputMode="tel" className="input-dark mt-1" value={form.home_phone} onChange={(e) => setForm(prev => ({ ...prev, home_phone: formatPhoneInput(e.target.value) }))} placeholder="Home landline" />
            </FormField>
            <FormField label="Work Phone">
              <input name="work_phone" type="text" inputMode="tel" className="input-dark mt-1" value={form.work_phone} onChange={(e) => setForm(prev => ({ ...prev, work_phone: formatPhoneInput(e.target.value) }))} placeholder="Work number" />
            </FormField>
            <FormField label="Secondary Email">
              <input name="email_secondary" type="email" inputMode="email" className="input-dark mt-1" value={form.email_secondary} onChange={handleChange} placeholder="Secondary / alternate email" />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Social Media">
              <input name="social_media" type="text" className="input-dark mt-1" placeholder="@handle, profiles, etc." value={form.social_media} onChange={handleChange} />
            </FormField>
          </div>

          <div className="border-t border-rmpg-700 pt-3">
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold mb-2 block">Employment</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Employer">
                <input name="employer" type="text" className="input-dark mt-1" value={form.employer} onChange={handleChange} />
              </FormField>
              <FormField label="Occupation">
                <select name="occupation" className="select-dark mt-1" value={form.occupation} onChange={handleChange}>
                  <option value="">-- Select --</option>
                  {OCCUPATION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </FormField>
            </div>
          </div>

          <div className="border-t border-rmpg-700 pt-3">
            <label className="text-[10px] text-red-400 uppercase font-semibold mb-2 block">Emergency Contact</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <FormField label="Contact Name">
                <input name="emergency_contact_name" type="text" className="input-dark mt-1" value={form.emergency_contact_name} onChange={handleChange} />
              </FormField>
              <FormField label="Contact Phone">
                <input name="emergency_contact_phone" type="text" inputMode="tel" className="input-dark mt-1" value={form.emergency_contact_phone} onChange={(e) => setForm(prev => ({ ...prev, emergency_contact_phone: formatPhoneInput(e.target.value) }))} />
              </FormField>
              <FormField label="Relationship">
                <select name="emergency_contact_relationship" className="select-dark mt-1" value={form.emergency_contact_relationship} onChange={handleChange}>
                  <option value="">-- Select --</option>
                  {EMERGENCY_CONTACT_RELATIONSHIPS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </FormField>
            </div>
          </div>
        </>
      )}

      {/* ── LAW ENFORCEMENT ── */}
      {activeSection === 'law' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="Immigration Status">
              <select name="immigration_status" className="select-dark mt-1" value={form.immigration_status} onChange={handleChange}>
                <option value="">-- Select --</option>
                {IMMIGRATION_OPTIONS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </FormField>
            <FormField label="Disability Flags">
              <select name="disability_flags" className="select-dark mt-1" value={form.disability_flags} onChange={handleChange}>
                <option value="">-- Select --</option>
                {DISABILITY_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </FormField>
            <FormField label="Mental Health Flags">
              <input name="mental_health_flags" type="text" className="input-dark mt-1" placeholder="Known mental health conditions" value={form.mental_health_flags} onChange={handleChange} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="Substance Abuse">
              <input name="substance_abuse" type="text" className="input-dark mt-1" placeholder="Known substance abuse history" value={form.substance_abuse} onChange={handleChange} />
            </FormField>
            <FormField label="Education Level">
              <select name="education_level" className="select-dark mt-1" value={form.education_level} onChange={handleChange}>
                <option value="">-- Select --</option>
                {EDUCATION_OPTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </FormField>
            <FormField label="Tribal Affiliation">
              <select name="tribal_affiliation" className="select-dark mt-1" value={form.tribal_affiliation} onChange={handleChange}>
                <option value="">-- Select --</option>
                {TRIBAL_AFFILIATION_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            <FormField label="Military Branch">
              <select name="military_branch" className="select-dark mt-1" value={form.military_branch} onChange={handleChange}>
                <option value="">-- Select --</option>
                {MILITARY_BRANCH_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </FormField>
            <FormField label="Military Status">
              <select name="military_status" className="select-dark mt-1" value={form.military_status} onChange={handleChange}>
                <option value="">-- Select --</option>
                {MILITARY_STATUS_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </FormField>
          </div>

          <FormField label="Medication Notes">
            <RichTextArea name="medication_notes" rows={2} className="input-dark mt-1" placeholder="Known medications or medical needs" value={form.medication_notes} onChange={handleChange} />
          </FormField>

          <div className="border-t border-rmpg-700 pt-3">
            <label className="text-[10px] text-rmpg-400 uppercase font-semibold mb-2 block">Custody / Intake</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Religion">
                <input name="religion" type="text" className="input-dark mt-1" placeholder="Religious affiliation" value={form.religion} onChange={handleChange} />
              </FormField>
              <FormField label="Dietary Restrictions">
                <input name="dietary_restrictions" type="text" className="input-dark mt-1" placeholder="e.g. Halal, Kosher, Vegetarian, Allergies" value={form.dietary_restrictions} onChange={handleChange} />
              </FormField>
            </div>
          </div>
        </>
      )}

      {/* ── OTHER / ALERTS ── */}
      {activeSection === 'other' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Gang Affiliation">
              <select name="gang_affiliation" className="select-dark mt-1" value={form.gang_affiliation} onChange={handleChange}>
                <option value="">-- Select --</option>
                {GANG_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </FormField>
            <FormField label="Probation / Parole">
              <select name="probation_parole" className="select-dark mt-1" value={form.probation_parole} onChange={handleChange}>
                <option value="">-- Select --</option>
                {PROBATION_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </FormField>
          </div>

          {form.probation_parole && form.probation_parole !== 'None' && (
            <FormField label="P.O. / Parole Officer Name">
              <input name="probation_parole_officer" type="text" className="input-dark mt-1" placeholder="Officer name and contact" value={form.probation_parole_officer} onChange={handleChange} />
            </FormField>
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

          <FormField label="Known Associates">
            <RichTextArea name="known_associates" rows={2} className="input-dark mt-1" placeholder="Names of known associates" value={form.known_associates} onChange={handleChange} />
          </FormField>

          <div>
            <label className="text-[10px] text-red-400 uppercase font-semibold">Officer Safety / Caution Flags</label>
            <RichTextArea name="caution_flags" rows={2} className="input-dark mt-1" placeholder="Any officer safety concerns, violent history, weapons, etc." value={form.caution_flags} onChange={handleChange} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
             <FormField label="Date Last Seen">
               <input name="date_last_seen" type="date" className="input-dark mt-1" value={form.date_last_seen} onChange={handleChange} />
             </FormField>
             <FormField label="Location Last Seen">
               <AddressAutocomplete
                 name="location_last_seen"
                 className="input-dark mt-1 w-full"
                 placeholder="Address or description of last known location"
                 value={form.location_last_seen}
                 onChange={(val) => setForm((prev) => ({ ...prev, location_last_seen: val }))}
               />
             </FormField>
          </div>

          <FormField label="Notes">
            <RichTextArea name="notes" rows={4} className="input-dark mt-1" value={form.notes} onChange={handleChange} />
          </FormField>
        </>
      )}
    </FormModal>
  );
}

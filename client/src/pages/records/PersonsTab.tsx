import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  UserCircle,
  Shield,
  MapPin,
  Trash2,
  Pencil,
  FileText,
  ExternalLink,
  X,
  Phone,
  Mail,
  AlertTriangle,
  Eye,
  EyeOff,
  Briefcase,
  CreditCard,
  Archive,
  RotateCcw,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { openRecordWindow } from '../../utils/windowManager';
import PersonFormModal from '../../components/PersonFormModal';
import FileAttachments from '../../components/FileAttachments';
import AlertBanner from '../../components/AlertBanner';
import LinkedRecordsSection from '../../components/LinkedRecordsSection';
import CriminalHistorySection from '../../components/CriminalHistorySection';
import { PersonClientLinks } from '../../components/ClientPersonLinksSection';
import PersonHistoryPanel from '../../components/PersonHistoryPanel';
import CollapsibleSection from '../../components/CollapsibleSection';
import type { Person, RecordAlert, RecordEntityType } from '../../types';
import type { PersonFormData } from '../../components/PersonFormModal';

// ── DB Mapper ──────────────────────────────────────

function parseFlags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapDbPerson(row: Record<string, unknown>): Person {
  return {
    id: String(row.id ?? ''),
    first_name: String(row.first_name ?? ''),
    last_name: String(row.last_name ?? ''),
    middle_name: row.middle_name ? String(row.middle_name) : undefined,
    alias_nickname: row.alias_nickname ? String(row.alias_nickname) : undefined,
    date_of_birth: row.dob ? String(row.dob) : undefined,
    gender: row.gender ? String(row.gender) : undefined,
    race: row.race ? String(row.race) : undefined,
    height: row.height ? String(row.height) : undefined,
    height_feet: row.height_feet != null ? Number(row.height_feet) : undefined,
    height_inches: row.height_inches != null ? Number(row.height_inches) : undefined,
    weight: row.weight ? String(row.weight) : undefined,
    build: row.build ? String(row.build) : undefined,
    complexion: row.complexion ? String(row.complexion) : undefined,
    hair_color: row.hair_color ? String(row.hair_color) : undefined,
    eye_color: row.eye_color ? String(row.eye_color) : undefined,
    scars_marks_tattoos: row.scars_marks_tattoos ? String(row.scars_marks_tattoos) : undefined,
    clothing_description: row.clothing_description ? String(row.clothing_description) : undefined,
    address: row.address ? String(row.address) : undefined,
    city: row.city ? String(row.city) : undefined,
    state: row.state ? String(row.state) : undefined,
    zip: row.zip ? String(row.zip) : undefined,
    phone: row.phone ? String(row.phone) : undefined,
    email: row.email ? String(row.email) : undefined,
    dl_number: row.dl_number ? String(row.dl_number) : undefined,
    dl_state: row.dl_state ? String(row.dl_state) : undefined,
    dl_expiry: row.dl_expiry ? String(row.dl_expiry) : undefined,
    dl_class: row.dl_class ? String(row.dl_class) : undefined,
    ssn_last4: row.ssn_last4 ? String(row.ssn_last4) : undefined,
    ssn_full: row.ssn_full ? String(row.ssn_full) : undefined,
    id_image_url: row.id_image_url ? String(row.id_image_url) : undefined,
    id_type: row.id_type ? String(row.id_type) : undefined,
    id_number: row.id_number ? String(row.id_number) : undefined,
    id_state: row.id_state ? String(row.id_state) : undefined,
    id_expiry: row.id_expiry ? String(row.id_expiry) : undefined,
    employer: row.employer ? String(row.employer) : undefined,
    occupation: row.occupation ? String(row.occupation) : undefined,
    emergency_contact_name: row.emergency_contact_name ? String(row.emergency_contact_name) : undefined,
    emergency_contact_phone: row.emergency_contact_phone ? String(row.emergency_contact_phone) : undefined,
    gang_affiliation: row.gang_affiliation ? String(row.gang_affiliation) : undefined,
    is_sex_offender: row.is_sex_offender === 1 || row.is_sex_offender === true,
    is_veteran: row.is_veteran === 1 || row.is_veteran === true,
    language: row.language ? String(row.language) : undefined,
    place_of_birth: row.place_of_birth ? String(row.place_of_birth) : undefined,
    citizenship: row.citizenship ? String(row.citizenship) : undefined,
    marital_status: row.marital_status ? String(row.marital_status) : undefined,
    hair_length: row.hair_length ? String(row.hair_length) : undefined,
    hair_style: row.hair_style ? String(row.hair_style) : undefined,
    facial_hair: row.facial_hair ? String(row.facial_hair) : undefined,
    glasses: row.glasses ? String(row.glasses) : undefined,
    shoe_size: row.shoe_size ? String(row.shoe_size) : undefined,
    blood_type: row.blood_type ? String(row.blood_type) : undefined,
    phone_secondary: row.phone_secondary ? String(row.phone_secondary) : undefined,
    social_media: row.social_media ? String(row.social_media) : undefined,
    probation_parole: row.probation_parole ? String(row.probation_parole) : undefined,
    probation_parole_officer: row.probation_parole_officer ? String(row.probation_parole_officer) : undefined,
    known_associates: row.known_associates ? String(row.known_associates) : undefined,
    emergency_contact_relationship: row.emergency_contact_relationship ? String(row.emergency_contact_relationship) : undefined,
    caution_flags: row.caution_flags ? String(row.caution_flags) : undefined,
    flags: parseFlags(row.flags),
    notes: row.notes ? String(row.notes) : undefined,
    incident_ids: [],
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

// ── Constants ──────────────────────────────────────

const FLAG_COLORS: Record<string, string> = {
  'Trespass Warning': 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  'Known Offender': 'bg-red-900/50 text-red-400 border-red-700/50',
  'Warrant': 'bg-red-900/50 text-red-300 border-red-600/50',
  'Mental Health': 'bg-purple-900/50 text-purple-400 border-purple-700/50',
  'BOLO': 'bg-red-900/50 text-red-400 border-red-700/50',
  'Parking Violation': 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  'Pre-Trial Supervision': 'bg-orange-900/50 text-orange-400 border-orange-700/50',
};

// ── Helpers ──────────────────────────────────────

function renderInfoRow(label: string, value?: string | null, icon?: React.ElementType) {
  if (!value) return null;
  const Icon = icon;
  return (
    <div className="flex items-start gap-2 text-xs">
      {Icon && <Icon className="w-3 h-3 text-rmpg-400 mt-0.5 flex-shrink-0" />}
      <span className="text-rmpg-400 min-w-[80px]">{label}:</span>
      <span className="text-rmpg-200">{value}</span>
    </div>
  );
}

// ── Props ──────────────────────────────────────────

export interface PersonsTabProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  showArchived: boolean;
  setError: (err: string | null) => void;
  persons: Person[];
  setPersons: React.Dispatch<React.SetStateAction<Person[]>>;
  loadingPersons: boolean;
  setLoadingPersons: React.Dispatch<React.SetStateAction<boolean>>;
  deleteTarget: { type: 'person' | 'vehicle' | 'property' | 'evidence'; id: string; label: string } | null;
  setDeleteTarget: React.Dispatch<React.SetStateAction<{ type: 'person' | 'vehicle' | 'property' | 'evidence'; id: string; label: string } | null>>;
  linkRefreshKey: number;
  openLinkModal: (type: RecordEntityType, id: string) => void;
  handleArchiveRecord: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  handleUnarchiveRecord: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  fetchPersons: () => Promise<void>;
  /** Increment to open the "New Person" modal from parent */
  openNewTrigger?: number;
}

// ── Hook Return ────────────────────────────────────

export interface PersonsTabState {
  // Selection
  selectedPerson: Person | null;
  setSelectedPerson: React.Dispatch<React.SetStateAction<Person | null>>;
  // Modal
  personModalOpen: boolean;
  editingPerson: Person | undefined;
  personSubmitting: boolean;
  personSubmitError: string | null;
  openNewPerson: () => void;
  openEditPerson: (p: Person) => Promise<void>;
  handlePersonSubmit: (data: PersonFormData) => Promise<void>;
  closeModal: () => void;
  // Alerts
  personAlerts: RecordAlert[];
  // SSN
  ssnRevealed: boolean;
  setSSNRevealed: React.Dispatch<React.SetStateAction<boolean>>;
  // Filtering
  filteredPersons: Person[];
  // Archive wrappers
  handleArchive: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  handleUnarchive: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  // Pass-through from props
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  showArchived: boolean;
  setDeleteTarget: PersonsTabProps['setDeleteTarget'];
  linkRefreshKey: number;
  openLinkModal: (type: RecordEntityType, id: string) => void;
}

// ════════════════════════════════════════════════════
// HOOK — usePersonsTab
// ════════════════════════════════════════════════════

export function usePersonsTab(props: PersonsTabProps): PersonsTabState {
  const {
    searchQuery, setSearchQuery, showArchived, setError,
    persons, setDeleteTarget, linkRefreshKey,
    openLinkModal, handleArchiveRecord, handleUnarchiveRecord,
    fetchPersons, openNewTrigger,
  } = props;

  // Modal state
  const [personModalOpen, setPersonModalOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Person | undefined>(undefined);
  const [personSubmitting, setPersonSubmitting] = useState(false);
  const [personSubmitError, setPersonSubmitError] = useState<string | null>(null);

  // Selection
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const lastFetchedPersonId = useRef<string | null>(null);

  // Alerts for selected person
  const [personAlerts, setPersonAlerts] = useState<RecordAlert[]>([]);

  // SSN reveal state
  const [ssnRevealed, setSSNRevealed] = useState(false);

  // Open "New Person" modal when trigger changes from parent
  useEffect(() => {
    if (openNewTrigger && openNewTrigger > 0) {
      setEditingPerson(undefined);
      setPersonModalOpen(true);
    }
  }, [openNewTrigger]);

  // Fetch full person detail when selection changes (list only returns limited columns)
  useEffect(() => {
    const id = selectedPerson?.id;
    if (!id) { lastFetchedPersonId.current = null; return; }
    if (lastFetchedPersonId.current === id) return;
    lastFetchedPersonId.current = id;
    apiFetch<Record<string, unknown>>(`/records/persons/${id}`)
      .then(full => setSelectedPerson(mapDbPerson(full as Record<string, unknown>)))
      .catch(() => { /* keep list-level data as fallback */ });
  }, [selectedPerson?.id]);

  // Clear selection if the person was removed from the list
  useEffect(() => {
    if (selectedPerson && !persons.find(p => p.id === selectedPerson.id)) {
      setSelectedPerson(null);
    }
  }, [persons, selectedPerson]);

  // Build person alerts when selection changes
  useEffect(() => {
    if (!selectedPerson) { setPersonAlerts([]); return; }
    const alerts: RecordAlert[] = [];
    const flagsLower = selectedPerson.flags.map(f => f.toLowerCase());
    if (flagsLower.some(f => f.includes('known_offender') || f.includes('known offender') || f.includes('trespass'))) {
      alerts.push({ type: 'flag', priority: 'high', title: 'FLAG ALERT', description: 'Known offender / trespass warning on file' });
    }
    if (selectedPerson.is_sex_offender) {
      alerts.push({ type: 'flag', priority: 'critical', title: 'SEX OFFENDER', description: 'Registered sex offender — exercise caution' });
    }
    if (selectedPerson.gang_affiliation) {
      alerts.push({ type: 'flag', priority: 'high', title: 'GANG AFFILIATION', description: `Affiliated with: ${selectedPerson.gang_affiliation}` });
    }
    if (flagsLower.some(f => f.includes('pre-trial') || f.includes('pts') || f.includes('pretrial'))) {
      alerts.push({ type: 'flag', priority: 'high', title: 'PRE-TRIAL SUPERVISION', description: 'Subject is under pre-trial supervision — verify compliance conditions' });
    }
    if (selectedPerson.probation_parole && selectedPerson.probation_parole.toLowerCase().includes('pre-trial')) {
      alerts.push({ type: 'flag', priority: 'high', title: 'PRE-TRIAL SUPERVISION', description: `Pre-trial supervision: ${selectedPerson.probation_parole}` });
    }
    setPersonAlerts(alerts);
  }, [selectedPerson]);

  // ── Person CRUD ──────────────────────────────────

  const handlePersonSubmit = async (data: PersonFormData) => {
    setPersonSubmitting(true);
    setPersonSubmitError(null);
    try {
      const savedId = editingPerson?.id;
      if (editingPerson) {
        await apiFetch(`/records/persons/${editingPerson.id}`, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        await apiFetch('/records/persons', { method: 'POST', body: JSON.stringify(data) });
      }
      setPersonModalOpen(false);
      setEditingPerson(undefined);
      await fetchPersons();
      // Refresh the detail panel so it shows updated data after save
      if (savedId) {
        lastFetchedPersonId.current = null;
        try {
          const fresh = await apiFetch<Record<string, unknown>>(`/records/persons/${savedId}`);
          setSelectedPerson(mapDbPerson(fresh as Record<string, unknown>));
          lastFetchedPersonId.current = savedId;
        } catch { /* keep existing selection */ }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save person';
      setPersonSubmitError(msg);
      setError(msg);
    } finally {
      setPersonSubmitting(false);
    }
  };

  const openEditPerson = async (person: Person) => {
    setPersonSubmitError(null);
    setEditingPerson(person); // Set immediately with list data so modal has context
    setPersonModalOpen(true);
    // Upgrade with full detail (list only returns limited columns)
    try {
      const full = await apiFetch<Record<string, unknown>>(`/records/persons/${person.id}`);
      setEditingPerson(mapDbPerson(full as Record<string, unknown>));
    } catch {
      // Keep the list-level data already set
    }
  };
  const openNewPerson = () => { setEditingPerson(undefined); setPersonSubmitError(null); setPersonModalOpen(true); };
  const closeModal = () => { setPersonModalOpen(false); setEditingPerson(undefined); setPersonSubmitError(null); };

  // Wrap archive/unarchive to also clear selection
  const handleArchive = async (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => {
    setSelectedPerson(null);
    await handleArchiveRecord(type, id);
  };

  const handleUnarchive = async (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => {
    setSelectedPerson(null);
    await handleUnarchiveRecord(type, id);
  };

  // ── Filtering ────────────────────────────────────

  const filteredPersons = persons.filter((p) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
      p.address?.toLowerCase().includes(q) ||
      p.flags.some((f) => f.toLowerCase().includes(q))
    );
  });

  return {
    selectedPerson, setSelectedPerson,
    personModalOpen, editingPerson, personSubmitting, personSubmitError,
    openNewPerson, openEditPerson, handlePersonSubmit, closeModal,
    personAlerts, ssnRevealed, setSSNRevealed,
    filteredPersons, handleArchive, handleUnarchive,
    searchQuery, setSearchQuery, showArchived,
    setDeleteTarget, linkRefreshKey, openLinkModal,
  };
}

// ════════════════════════════════════════════════════
// LIST — PersonsTabList (left panel content)
// ════════════════════════════════════════════════════

export function PersonsTabList({ state }: { state: PersonsTabState }) {
  const {
    filteredPersons, selectedPerson, setSelectedPerson, setSSNRevealed,
    searchQuery, setSearchQuery, showArchived,
    openEditPerson, setDeleteTarget, handleArchive, handleUnarchive,
    personModalOpen, editingPerson, personSubmitting, personSubmitError, handlePersonSubmit, closeModal,
  } = state;

  return (
    <div className="h-full flex flex-col">
      {/* Search */}
      <div className="p-3 border-b border-rmpg-600">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400" />
          <input
            type="text"
            className="input-dark pl-9 w-full text-[11px]"
            placeholder="Search persons by name, address, flags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-white">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Person List */}
      <div className="flex-1 overflow-auto">
        {filteredPersons.length === 0 && (
          <div className="text-center py-12">
            <UserCircle className="w-8 h-8 text-rmpg-500 mx-auto mb-2" />
            <p className="text-sm text-rmpg-400">{searchQuery ? 'No persons match your search.' : 'No person records found.'}</p>
          </div>
        )}
        {filteredPersons.map((person) => (
          <div
            key={person.id}
            onClick={() => { setSelectedPerson(selectedPerson?.id === person.id ? null : person); setSSNRevealed(false); }}
            className={`
              px-4 py-3 border-b border-rmpg-700/50 cursor-pointer transition-colors
              ${selectedPerson?.id === person.id
                ? 'bg-brand-900/20 border-l-2 border-l-brand-500'
                : 'hover:bg-rmpg-700/30 border-l-2 border-l-transparent'
              }
            `}
          >
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-full bg-rmpg-700 border border-rmpg-600 flex items-center justify-center text-xs font-bold text-rmpg-300">
                {person.first_name[0]}{person.last_name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white truncate">
                    {person.last_name}, {person.first_name}
                    {person.middle_name ? ` ${person.middle_name[0]}.` : ''}
                  </span>
                  {person.alias_nickname && (
                    <span className="text-[10px] text-amber-400 italic">aka "{person.alias_nickname}"</span>
                  )}
                  {person.is_sex_offender && (
                    <span className="px-1 py-0.5 text-[8px] font-bold bg-red-900/60 text-red-400 border border-red-700/50">RSO</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[10px] text-rmpg-400">
                  {person.date_of_birth && <span>DOB: {person.date_of_birth}</span>}
                  {person.gender && <span>{person.gender}</span>}
                  {person.race && <span>{person.race}</span>}
                  {person.phone && (
                    <span className="flex items-center gap-0.5">
                      <Phone className="w-2.5 h-2.5" />{person.phone}
                    </span>
                  )}
                </div>
                {(person.address || person.city) && (
                  <div className="flex items-center gap-1 mt-0.5 text-[9px] text-rmpg-500 truncate">
                    <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                    {[person.address, person.city, person.state].filter(Boolean).join(', ')}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                {person.flags.length > 0 && (
                  <div className="flex gap-1">
                    {person.flags.slice(0, 2).map((flag) => (
                      <span key={flag} className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold border ${FLAG_COLORS[flag] || 'bg-rmpg-700 text-rmpg-300 border-rmpg-600'}`}>
                        {flag}
                      </span>
                    ))}
                    {person.flags.length > 2 && (
                      <span className="text-[9px] text-rmpg-400">+{person.flags.length - 2}</span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  {!showArchived && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openEditPerson(person); }}
                      className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-brand-400 transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); openRecordWindow('person', person.id); }}
                    className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-brand-400 transition-colors"
                    title="Open in Window"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                  {!showArchived && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'person', id: person.id, label: `${person.first_name} ${person.last_name}` }); }}
                      className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                  {!showArchived && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleArchive('persons', person.id); }}
                      className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-amber-400 transition-colors"
                      title="Archive"
                    >
                      <Archive className="w-3 h-3" />
                    </button>
                  )}
                  {showArchived && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleUnarchive('persons', person.id); }}
                      className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-green-400 transition-colors"
                      title="Unarchive"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Person Form Modal (portals to body) */}
      <PersonFormModal
        isOpen={personModalOpen}
        onClose={closeModal}
        onSubmit={handlePersonSubmit}
        isSubmitting={personSubmitting}
        editingPerson={editingPerson}
        submitError={personSubmitError}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════
// DETAIL — PersonsTabDetail (right panel content)
// ════════════════════════════════════════════════════

export function PersonsTabDetail({ state }: { state: PersonsTabState }) {
  const {
    selectedPerson, personAlerts, ssnRevealed, setSSNRevealed,
    linkRefreshKey, openLinkModal,
  } = state;

  if (!selectedPerson) return null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Alert Banner + Flags (below PanelTitleBar, which RecordsPage provides) */}
      <div className="px-4 pt-3 pb-2 border-b border-rmpg-600 bg-surface-sunken flex-shrink-0">
        <AlertBanner alerts={personAlerts} />
        {/* Special Flags */}
        {(selectedPerson.flags.length > 0 || selectedPerson.is_sex_offender || selectedPerson.is_veteran || selectedPerson.gang_affiliation || (selectedPerson.probation_parole && selectedPerson.probation_parole !== 'None')) && (
          <div className="flex flex-wrap gap-2 mt-1">
            {selectedPerson.flags.map((flag) => (
              <span key={flag} className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold border ${FLAG_COLORS[flag] || 'bg-rmpg-700 text-rmpg-300 border-rmpg-600'}`}>
                {flag}
              </span>
            ))}
            {selectedPerson.is_sex_offender && <span className="px-2 py-0.5 text-[10px] font-bold bg-red-900/50 text-red-400 border border-red-700/50">SEX OFFENDER</span>}
            {selectedPerson.is_veteran && <span className="px-2 py-0.5 text-[10px] font-bold bg-brand-900/50 text-brand-400 border border-brand-700/50">VETERAN</span>}
            {selectedPerson.gang_affiliation && <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-900/50 text-amber-400 border border-amber-700/50">GANG: {selectedPerson.gang_affiliation}</span>}
            {selectedPerson.probation_parole && selectedPerson.probation_parole !== 'None' && <span className="px-2 py-0.5 text-[10px] font-bold bg-orange-900/50 text-orange-400 border border-orange-700/50">{selectedPerson.probation_parole.toUpperCase()}</span>}
          </div>
        )}
        {/* Compact person ID line */}
        <div className="flex items-center gap-3 mt-1 text-[10px] text-rmpg-400">
          {selectedPerson.date_of_birth && <span>DOB: {selectedPerson.date_of_birth}</span>}
          {selectedPerson.gender && <span>{selectedPerson.gender}</span>}
          {selectedPerson.race && <span>{selectedPerson.race}</span>}
        </div>
      </div>

      {/* Scrollable Detail Sections */}
      <div className="flex-1 overflow-auto p-2 space-y-1">

        {/* ── Physical Description ─────────────────── */}
        <CollapsibleSection title="Physical Description" icon={Eye} defaultOpen>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-xs">
            {(selectedPerson.height_feet != null || selectedPerson.height) && <div><span className="text-rmpg-400">Height:</span> <span className="text-rmpg-200">{selectedPerson.height_feet != null ? `${selectedPerson.height_feet}'${String(selectedPerson.height_inches ?? 0).padStart(2, '0')}"` : selectedPerson.height}</span></div>}
            {selectedPerson.weight && <div><span className="text-rmpg-400">Weight:</span> <span className="text-rmpg-200">{selectedPerson.weight}</span></div>}
            {selectedPerson.build && <div><span className="text-rmpg-400">Build:</span> <span className="text-rmpg-200">{selectedPerson.build}</span></div>}
            {selectedPerson.complexion && <div><span className="text-rmpg-400">Complexion:</span> <span className="text-rmpg-200">{selectedPerson.complexion}</span></div>}
            {selectedPerson.hair_color && <div><span className="text-rmpg-400">Hair:</span> <span className="text-rmpg-200">{selectedPerson.hair_color}</span></div>}
            {selectedPerson.hair_length && <div><span className="text-rmpg-400">Length:</span> <span className="text-rmpg-200">{selectedPerson.hair_length}</span></div>}
            {selectedPerson.hair_style && <div><span className="text-rmpg-400">Style:</span> <span className="text-rmpg-200">{selectedPerson.hair_style}</span></div>}
            {selectedPerson.eye_color && <div><span className="text-rmpg-400">Eyes:</span> <span className="text-rmpg-200">{selectedPerson.eye_color}</span></div>}
            {selectedPerson.facial_hair && <div><span className="text-rmpg-400">Facial Hair:</span> <span className="text-rmpg-200">{selectedPerson.facial_hair}</span></div>}
            {selectedPerson.glasses && <div><span className="text-rmpg-400">Glasses:</span> <span className="text-rmpg-200">{selectedPerson.glasses}</span></div>}
            {selectedPerson.shoe_size && <div><span className="text-rmpg-400">Shoe:</span> <span className="text-rmpg-200">{selectedPerson.shoe_size}</span></div>}
            {selectedPerson.language && <div><span className="text-rmpg-400">Language:</span> <span className="text-rmpg-200">{selectedPerson.language}</span></div>}
          </div>
          {selectedPerson.scars_marks_tattoos && (
            <div className="mt-2"><span className="text-[10px] text-amber-400 uppercase font-semibold">Scars/Marks/Tattoos:</span> <span className="text-xs text-rmpg-200 ml-1">{selectedPerson.scars_marks_tattoos}</span></div>
          )}
          {selectedPerson.clothing_description && (
            <div className="mt-1"><span className="text-[10px] text-rmpg-400 uppercase font-semibold">Clothing:</span> <span className="text-xs text-rmpg-200 ml-1">{selectedPerson.clothing_description}</span></div>
          )}
          {selectedPerson.alias_nickname && (
            <div className="mt-1"><span className="text-[10px] text-rmpg-400 uppercase font-semibold">Alias:</span> <span className="text-xs text-amber-400 ml-1">{selectedPerson.alias_nickname}</span></div>
          )}
        </CollapsibleSection>

        {/* ── Contact & Address ────────────────────── */}
        <CollapsibleSection title="Contact & Address" icon={Phone} defaultOpen>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {renderInfoRow('Phone', selectedPerson.phone, Phone)}
            {renderInfoRow('Phone 2', selectedPerson.phone_secondary, Phone)}
            {renderInfoRow('Email', selectedPerson.email, Mail)}
            {renderInfoRow('Address', [selectedPerson.address, selectedPerson.city, selectedPerson.state, selectedPerson.zip].filter(Boolean).join(', '), MapPin)}
            {renderInfoRow('Employer', selectedPerson.employer, Briefcase)}
            {renderInfoRow('Occupation', selectedPerson.occupation)}
            {renderInfoRow('Social Media', selectedPerson.social_media)}
            {renderInfoRow('Place of Birth', selectedPerson.place_of_birth)}
            {renderInfoRow('Citizenship', selectedPerson.citizenship)}
            {renderInfoRow('Marital Status', selectedPerson.marital_status)}
            {renderInfoRow('Blood Type', selectedPerson.blood_type)}
          </div>
        </CollapsibleSection>

        {/* ── Identification ──────────────────────── */}
        <CollapsibleSection title="Identification" icon={CreditCard} defaultOpen>
          {(selectedPerson.dl_number || selectedPerson.id_number || selectedPerson.ssn_last4 || selectedPerson.ssn_full || selectedPerson.id_image_url) ? (
            <div className="flex gap-3">
              {/* ID Image */}
              {selectedPerson.id_image_url ? (
                <div className="flex-shrink-0">
                  <div className="w-24 h-32 border border-rmpg-500 bg-rmpg-900 overflow-hidden cursor-pointer group relative"
                    onClick={() => window.open(selectedPerson.id_image_url!, '_blank')}
                    title="Click to enlarge"
                  >
                    <img src={selectedPerson.id_image_url} alt="ID" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Eye className="w-4 h-4 text-white" />
                    </div>
                  </div>
                  {selectedPerson.id_type && (
                    <span className="inline-block mt-1 px-1.5 py-0.5 text-[8px] font-bold uppercase bg-blue-900/40 text-blue-400 border border-blue-700/40 text-center w-full">
                      {selectedPerson.id_type.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex-shrink-0 w-24 h-32 border border-dashed border-rmpg-600 bg-rmpg-900/50 flex flex-col items-center justify-center text-rmpg-600">
                  <CreditCard className="w-6 h-6 mb-1" />
                  <span className="text-[8px]">No Image</span>
                </div>
              )}
              <div className="flex-1 space-y-1.5">
                {selectedPerson.dl_number && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                    <div><span className="text-rmpg-400">DL:</span> <span className="text-rmpg-200 font-mono">{selectedPerson.dl_number}</span></div>
                    {selectedPerson.dl_state && <div><span className="text-rmpg-400">State:</span> <span className="text-rmpg-200">{selectedPerson.dl_state}</span></div>}
                    {selectedPerson.dl_class && <div><span className="text-rmpg-400">Class:</span> <span className="text-rmpg-200">{selectedPerson.dl_class}</span></div>}
                    {selectedPerson.dl_expiry && <div><span className="text-rmpg-400">Expiry:</span> <span className="text-rmpg-200">{selectedPerson.dl_expiry}</span></div>}
                  </div>
                )}
                {selectedPerson.id_number && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                    <div>
                      <span className="text-rmpg-400">{selectedPerson.id_type ? selectedPerson.id_type.replace(/_/g, ' ').toUpperCase() : 'ID'}:</span>{' '}
                      <span className="text-rmpg-200 font-mono">{selectedPerson.id_number}</span>
                    </div>
                    {selectedPerson.id_state && <div><span className="text-rmpg-400">State:</span> <span className="text-rmpg-200">{selectedPerson.id_state}</span></div>}
                    {selectedPerson.id_expiry && <div><span className="text-rmpg-400">Expiry:</span> <span className="text-rmpg-200">{selectedPerson.id_expiry}</span></div>}
                  </div>
                )}
                {/* SSN Section */}
                {(selectedPerson.ssn_last4 || selectedPerson.ssn_full) && (
                  <div className="border-t border-rmpg-700 pt-1.5 mt-1">
                    {selectedPerson.ssn_last4 && !selectedPerson.ssn_full && (
                      <div className="text-xs"><span className="text-rmpg-400">SSN:</span> <span className="text-rmpg-200 font-mono">XXX-XX-{selectedPerson.ssn_last4}</span></div>
                    )}
                    {selectedPerson.ssn_full && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-400 font-semibold">Full SSN:</span>
                        <span className="text-xs text-rmpg-200 font-mono tracking-wider">
                          {ssnRevealed ? selectedPerson.ssn_full : '***-**-' + (selectedPerson.ssn_last4 || selectedPerson.ssn_full.replace(/\D/g, '').slice(-4))}
                        </span>
                        <button
                          onClick={() => setSSNRevealed(!ssnRevealed)}
                          className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase border transition-colors"
                          style={ssnRevealed
                            ? { color: '#f87171', background: 'rgba(220,38,38,0.15)', borderColor: 'rgba(220,38,38,0.4)' }
                            : { color: '#9ca3af', background: 'rgba(107,114,128,0.15)', borderColor: 'rgba(107,114,128,0.3)' }
                          }
                          title={ssnRevealed ? 'Hide SSN' : 'Reveal SSN'}
                        >
                          {ssnRevealed ? <><EyeOff className="w-3 h-3" /> Hide</> : <><Eye className="w-3 h-3" /> Reveal</>}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-rmpg-500">No identification on file</p>
          )}
        </CollapsibleSection>

        {/* ── Legal & Associations (conditional) ──── */}
        {(selectedPerson.probation_parole || selectedPerson.known_associates) && (
          <CollapsibleSection title="Legal & Associations" icon={Shield}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {renderInfoRow('Probation/Parole', selectedPerson.probation_parole)}
              {renderInfoRow('P.O. / Officer', selectedPerson.probation_parole_officer)}
            </div>
            {selectedPerson.known_associates && (
              <div className="mt-1.5"><span className="text-[10px] text-rmpg-400 uppercase font-semibold">Known Associates:</span> <span className="text-xs text-rmpg-200 ml-1">{selectedPerson.known_associates}</span></div>
            )}
          </CollapsibleSection>
        )}

        {/* ── Emergency Contact (conditional) ─────── */}
        {selectedPerson.emergency_contact_name && (
          <CollapsibleSection title="Emergency Contact" icon={AlertTriangle}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
              {renderInfoRow('Name', selectedPerson.emergency_contact_name)}
              {renderInfoRow('Phone', selectedPerson.emergency_contact_phone, Phone)}
              {renderInfoRow('Relationship', selectedPerson.emergency_contact_relationship)}
            </div>
          </CollapsibleSection>
        )}

        {/* ── Officer Safety / Caution (conditional)  */}
        {selectedPerson.caution_flags && (
          <CollapsibleSection title="Officer Safety / Caution" icon={AlertTriangle}>
            <p className="text-xs text-amber-300/80 leading-relaxed">{selectedPerson.caution_flags}</p>
          </CollapsibleSection>
        )}

        {/* ── Notes (conditional) ──────────────────── */}
        {selectedPerson.notes && (
          <CollapsibleSection title="Notes" icon={FileText} defaultOpen={false}>
            <p className="text-xs text-rmpg-200 leading-relaxed">{selectedPerson.notes}</p>
          </CollapsibleSection>
        )}

        {/* ── Criminal History (standalone component) ─ */}
        <CriminalHistorySection
          personId={selectedPerson.id}
          personName={`${selectedPerson.first_name} ${selectedPerson.last_name}`}
        />

        {/* ── System History (standalone component) ─── */}
        <PersonHistoryPanel
          personId={selectedPerson.id}
          personName={`${selectedPerson.first_name} ${selectedPerson.last_name}`}
        />

        {/* ── Client Links (standalone component) ──── */}
        <PersonClientLinks
          personId={selectedPerson.id}
          personName={`${selectedPerson.first_name} ${selectedPerson.last_name}`}
        />

        {/* ── Linked Records (standalone component) ── */}
        <LinkedRecordsSection
          key={`person-links-${selectedPerson.id}-${linkRefreshKey}`}
          entityType="person"
          entityId={selectedPerson.id}
          onOpenLinkModal={() => openLinkModal('person', selectedPerson.id)}
        />

        {/* ── File Attachments ─────────────────────── */}
        <div className="panel-beveled p-3 bg-surface-base">
          <FileAttachments entityType="person" entityId={selectedPerson.id} />
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════
// Legacy default export (backward compat during transition)
// ════════════════════════════════════════════════════

export default function PersonsTab(props: PersonsTabProps) {
  const state = usePersonsTab(props);
  if (props.loadingPersons) return null;
  return (
    <>
      <div className={`${state.selectedPerson ? 'w-[40%]' : 'w-full'} border-r border-rmpg-600 flex flex-col overflow-hidden transition-all`}>
        <PersonsTabList state={state} />
      </div>
      {state.selectedPerson && (
        <div className="w-[60%] flex flex-col overflow-hidden">
          <PersonsTabDetail state={state} />
        </div>
      )}
    </>
  );
}

// Re-export mapper and helpers for orchestrator
export { mapDbPerson, parseFlags, FLAG_COLORS };

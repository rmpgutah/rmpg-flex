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
  ArrowUpDown,
  Filter,
  Users,
  User,
  Gavel,
  Navigation,
  Heart,
  Clock,
  BookOpen,
} from 'lucide-react';
import { apiFetch, authedImageUrl } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { openRecordWindow } from '../../utils/windowManager';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import { useMenuActions } from '../../utils/contextMenuActions';
import { parseTimestamp } from '../../utils/dateUtils';
import PersonFormModal from '../../components/PersonFormModal';
import FileAttachments from '../../components/FileAttachments';
import AlertBanner from '../../components/AlertBanner';
import LinkedRecordsSection from '../../components/LinkedRecordsSection';
import ConnectionsGraphPanel from '../../components/ConnectionsGraphPanel';
import CriminalHistorySection from '../../components/CriminalHistorySection';
import { PersonClientLinks } from '../../components/ClientPersonLinksSection';
import PersonHistoryPanel from '../../components/PersonHistoryPanel';
import CollapsibleSection from '../../components/CollapsibleSection';
import RecordField from '../../components/records/RecordField';
import FieldGrid from '../../components/records/FieldGrid';
import RecordBadge from '../../components/records/RecordBadge';
import RecordHero from '../../components/records/RecordHero';
import RecordAvatar from '../../components/records/RecordAvatar';
import { recordPosture, recordCornerBadge } from '../../components/records/recordVisuals';
import type { Person, RecordAlert, RecordEntityType } from '../../types';
import type { PersonFormData } from '../../components/PersonFormModal';
import WarrantBadge from '../../components/WarrantBadge';
import AISearchButton from '../../components/AISearchButton';
import { humanizeGender, humanizeRace, formatPhoneDisplay, formatAddressDisplay, humanizeFlag } from '../../utils/statusLabels';
import { coded } from '../../utils/searchText';
import { hasValue } from '../../utils/sentinel';
import { toDisplayLabel } from '../../utils/formatters';

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

/** Safely format a date string as MM/DD/YYYY, returning '—' for empty/invalid */
function safeDateDisplay(d?: string | null): string {
  if (!d) return '—';
  const parsed = parseTimestamp(d);
  if (isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('en-US', { timeZone: 'America/Denver', month: '2-digit', day: '2-digit', year: 'numeric' });
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
    address_2: row.address_2 ? String(row.address_2) : undefined,
    // suffix lives in persons_ext (merged by the detail GET); dropping it
    // here made every edit→save wipe it (modal loaded '', PUT nulled it).
    suffix: row.suffix ? String(row.suffix) : undefined,
    city: row.city ? String(row.city) : undefined,
    state: row.state ? String(row.state) : undefined,
    zip: row.zip ? String(row.zip) : undefined,
    phone: row.phone ? String(row.phone) : undefined,
    email: row.email ? String(row.email) : undefined,
    dl_number: row.dl_number ? String(row.dl_number) : undefined,
    dl_state: row.dl_state ? String(row.dl_state) : undefined,
    dl_expiry: row.dl_expiry ? String(row.dl_expiry) : undefined,
    dl_class: row.dl_class ? String(row.dl_class) : undefined,
    dl_issue_date: row.dl_issue_date ? String(row.dl_issue_date) : undefined,
    dl_restrictions: row.dl_restrictions ? String(row.dl_restrictions) : undefined,
    dl_endorsements: row.dl_endorsements ? String(row.dl_endorsements) : undefined,
    ssn_last4: row.ssn_last4 ? String(row.ssn_last4) : undefined,
    ssn_full: row.ssn_full ? String(row.ssn_full) : undefined,
    id_image_url: row.id_image_url ? String(row.id_image_url) : undefined,
    photo_url: row.photo_url ? String(row.photo_url) : undefined,
    photo: row.photo ? String(row.photo) : undefined,
    id_type: row.id_type ? String(row.id_type) : undefined,
    id_number: row.id_number ? String(row.id_number) : undefined,
    id_state: row.id_state ? String(row.id_state) : undefined,
    id_expiry: row.id_expiry ? String(row.id_expiry) : undefined,
    employer: row.employer ? String(row.employer) : undefined,
    occupation: row.occupation ? String(row.occupation) : undefined,
    emergency_contact_name: row.emergency_contact_name ? String(row.emergency_contact_name) : undefined,
    emergency_contact_phone: row.emergency_contact_phone ? String(row.emergency_contact_phone) : undefined,
    // gang_affiliation is preserved verbatim — including the literal
    // "None" option from the dropdown — because the user EXPLICITLY
    // chose that value. Previously this field was filtered against a
    // blacklist of `none`/`n/a`/`na`/`0`/empty so explicit "None"
    // selections were silently dropped on load (visible to the user
    // as "field reset itself" — see issue 2026-05-04). The PDF render
    // path had the same blacklist and is now also relaxed.
    sex: row.sex ? String(row.sex) : undefined,
    nationality: row.nationality ? String(row.nationality) : undefined,
    aliases: row.aliases ? String(row.aliases) : undefined,
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
    watchlist_match: row.watchlist_match ? String(row.watchlist_match) : null,
    watchlist_checked_at: row.watchlist_checked_at ? String(row.watchlist_checked_at) : null,
    flags: parseFlags(row.flags),
    notes: row.notes ? String(row.notes) : undefined,
    // Extended identification fields
    ncic_number: row.ncic_number ? String(row.ncic_number) : undefined,
    sor_number: row.sor_number ? String(row.sor_number) : undefined,
    fbi_number: row.fbi_number ? String(row.fbi_number) : undefined,
    state_id_number: row.state_id_number ? String(row.state_id_number) : undefined,
    passport_number: row.passport_number ? String(row.passport_number) : undefined,
    passport_country: row.passport_country ? String(row.passport_country) : undefined,
    // Law enforcement / medical fields
    immigration_status: row.immigration_status ? String(row.immigration_status) : undefined,
    disability_flags: row.disability_flags ? String(row.disability_flags) : undefined,
    mental_health_flags: row.mental_health_flags ? String(row.mental_health_flags) : undefined,
    substance_abuse: row.substance_abuse ? String(row.substance_abuse) : undefined,
    medication_notes: row.medication_notes ? String(row.medication_notes) : undefined,
    education_level: row.education_level ? String(row.education_level) : undefined,
    military_branch: row.military_branch ? String(row.military_branch) : undefined,
    military_status: row.military_status ? String(row.military_status) : undefined,
    tribal_affiliation: row.tribal_affiliation ? String(row.tribal_affiliation) : undefined,
    // Physical description extended
    identifying_marks_location: row.identifying_marks_location ? String(row.identifying_marks_location) : undefined,
    tattoo_description: row.tattoo_description ? String(row.tattoo_description) : undefined,
    scar_description: row.scar_description ? String(row.scar_description) : undefined,
    piercing_description: row.piercing_description ? String(row.piercing_description) : undefined,
    distinguishing_features: row.distinguishing_features ? String(row.distinguishing_features) : undefined,
    // Contact extended
    email_secondary: row.email_secondary ? String(row.email_secondary) : undefined,
    home_phone: row.home_phone ? String(row.home_phone) : undefined,
    work_phone: row.work_phone ? String(row.work_phone) : undefined,
    // Other tab
    date_last_seen: row.date_last_seen ? String(row.date_last_seen) : undefined,
    location_last_seen: row.location_last_seen ? String(row.location_last_seen) : undefined,
    alias_dob: row.alias_dob ? String(row.alias_dob) : undefined,
    incident_ids: [],
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    // F3 jail-intake additions (2026-05-04)
    voice_description:     row.voice_description ? String(row.voice_description) : undefined,
    religion:              row.religion ? String(row.religion) : undefined,
    dietary_restrictions:  row.dietary_restrictions ? String(row.dietary_restrictions) : undefined,
  } as Person;
}

// ── Constants ──────────────────────────────────────

// Detail-panel flags now render via RecordBadge + classifyFlag()
// (recordVisuals.ts), which substring-matches flag text into severity
// tones + pulse so unknown flags still carry weight. FLAG_COLORS is
// retained below for the LIST-view row chips and the re-export consumed
// elsewhere; migrate those to RecordBadge in a follow-up.
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

// Avatar rendering (name-hash colors + initials) now lives in the shared
// RecordAvatar component; the list + hero both use it.

// Sentinel "no value" guard (gang_affiliation is frequently the literal
// "None", which is truthy and once fired a false GANG alert + badge) now lives
// in the shared ../../utils/sentinel module — see hasValue import above.

// Import-provenance tags written into flags[] by DL-scan import flows.
// They are data-lineage metadata, not officer-caution flags, and must be
// excluded from badge rendering, warning counts, and posture computation.
function isProvenanceFlag(flag: string): boolean {
  return /_IMPORTED$/i.test(flag);
}

// Single source of truth for a person's posture-relevant flags. Shared by the
// list avatar ring, the detail hero, and the alert computation so all three
// agree on severity (and all get the gang-"None" guard for free).
function personPostureFlags(p: Person): Array<string | null | undefined> {
  return [
    ...p.flags.map((f) => (typeof f === 'object' ? f.type : f)).filter(f => !isProvenanceFlag(f)),
    p.watchlist_match ? 'watchlist' : null,
    p.is_sex_offender ? 'sex offender' : null,
    hasValue(p.gang_affiliation) ? 'gang' : null,
    hasValue(p.probation_parole) ? p.probation_parole : null,
  ];
}

// Thin wrapper over the shared RecordField primitive so every existing
// call site (Contact, Legal, Emergency …) picks up the polished row —
// hover highlight, consistent label hierarchy, empty-state handling.
function renderInfoRow(label: string, value?: string | null, icon?: React.ElementType) {
  if (!value) return null;
  return <RecordField label={label} value={value} icon={icon} />;
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
  deleteTarget: { type: 'person' | 'vehicle' | 'property' | 'business' | 'evidence'; id: string; label: string } | null;
  setDeleteTarget: React.Dispatch<React.SetStateAction<{ type: 'person' | 'vehicle' | 'property' | 'business' | 'evidence'; id: string; label: string } | null>>;
  linkRefreshKey: number;
  openLinkModal: (type: RecordEntityType, id: string) => void;
  handleArchiveRecord: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  handleUnarchiveRecord: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  fetchPersons: () => Promise<void>;
  /** Increment to open the "New Person" modal from parent */
  openNewTrigger?: number;
}

// ── Hook Return ────────────────────────────────────

export interface DuplicateMatch {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  dob?: string | null;
  address?: string | null;
  dl_number?: string | null;
}

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
  // Duplicate detection
  duplicateWarning: any[] | null;
  handleForceCreate: () => void;
  handleCancelDuplicate: () => void;
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
    const controller = new AbortController();
    apiFetch<Record<string, unknown>>(`/records/persons/${id}`)
      .then(full => { if (!controller.signal.aborted) setSelectedPerson(mapDbPerson(full as Record<string, unknown>)); })
      .catch(() => { /* keep list-level data as fallback */ });
    return () => { controller.abort(); };
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
    const flagsLower = selectedPerson.flags.map(f => (typeof f === 'object' ? f.type : f).toLowerCase());
    if (flagsLower.some(f => f.includes('known_offender') || f.includes('known offender') || f.includes('trespass'))) {
      alerts.push({ type: 'flag', priority: 'high', title: 'FLAG ALERT', description: 'Known offender / trespass warning on file' });
    }
    if (selectedPerson.is_sex_offender) {
      alerts.push({ type: 'flag', priority: 'critical', title: 'SEX OFFENDER', description: 'Registered sex offender — exercise caution' });
    }
    if (hasValue(selectedPerson.gang_affiliation)) {
      alerts.push({ type: 'flag', priority: 'high', title: 'GANG AFFILIATION', description: `Affiliated with: ${selectedPerson.gang_affiliation}` });
    }
    if (selectedPerson.watchlist_match) {
      let matchNames = '';
      try {
        const parsed = JSON.parse(selectedPerson.watchlist_match);
        matchNames = Array.isArray(parsed) ? parsed.map((m: { name?: string; program?: string }) => `${m.name || 'Unknown'} (${m.program || '?'})`).join(', ') : '';
      } catch { matchNames = 'See details'; }
      alerts.push({ type: 'flag', priority: 'critical', title: 'OFAC WATCHLIST MATCH', description: `U.S. Treasury sanctions match: ${matchNames}` });
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

  // Duplicate detection state for new person creation
  const [duplicateWarning, setDuplicateWarning] = useState<any[] | null>(null);
  const [pendingCreateData, setPendingCreateData] = useState<PersonFormData | null>(null);

  const handlePersonSubmit = async (data: PersonFormData) => {
    setPersonSubmitting(true);
    setPersonSubmitError(null);
    try {
      const savedId = editingPerson?.id;
      if (editingPerson) {
        // Edit — no duplicate check needed
        await apiFetch(`/records/persons/${editingPerson.id}`, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        // New person — check for duplicates first
        try {
          const res = await apiFetch<{ matches: any[] }>('/records/persons/check-duplicates', {
            method: 'POST',
            body: JSON.stringify({ first_name: data.first_name, last_name: data.last_name, dob: data.dob || undefined }),
          });
          if (res.matches && res.matches.length > 0) {
            // Show warning — pause creation
            setDuplicateWarning(res.matches);
            setPendingCreateData(data);
            setPersonSubmitting(false);
            return;
          }
        } catch { /* duplicate check failed — proceed with creation anyway */ }
        await apiFetch('/records/persons', { method: 'POST', body: JSON.stringify(data) });
      }
      setPersonModalOpen(false);
      setEditingPerson(undefined);
      await fetchPersons();
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

  // Force-create person after user dismissed duplicate warning
  const handleForceCreate = async () => {
    if (!pendingCreateData) return;
    setPersonSubmitting(true);
    setDuplicateWarning(null);
    try {
      await apiFetch('/records/persons', { method: 'POST', body: JSON.stringify(pendingCreateData) });
      setPendingCreateData(null);
      setPersonModalOpen(false);
      setEditingPerson(undefined);
      await fetchPersons();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save person';
      setPersonSubmitError(msg);
      setError(msg);
    } finally {
      setPersonSubmitting(false);
    }
  };

  const handleCancelDuplicate = () => {
    setDuplicateWarning(null);
    setPendingCreateData(null);
  };

  const openEditPerson = async (person: Person) => {
    setPersonSubmitError(null);
    // Fetch full detail before opening — prevents PersonFormModal's
    // useEffect([isOpen, editingPerson]) from firing twice and wiping edits.
    let fullPerson: Person = person;
    try {
      const full = await apiFetch<Record<string, unknown>>(`/records/persons/${person.id}`);
      fullPerson = mapDbPerson(full as Record<string, unknown>);
    } catch {
      // Fall back to list-level data
    }
    setEditingPerson(fullPerson);
    setPersonModalOpen(true);
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
      p.dl_number?.toLowerCase().includes(q) ||
      p.ssn_last4?.includes(q) ||
      p.phone?.includes(q) ||
      p.flags.some((f) => coded((typeof f === 'object' ? f.type : f), (v) => humanizeFlag(v ?? '')).includes(q))
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
    duplicateWarning, handleForceCreate, handleCancelDuplicate,
  };
}

// ════════════════════════════════════════════════════
// LIST — PersonsTabList (left panel content)
// ════════════════════════════════════════════════════

export function PersonsTabList({ state }: { state: PersonsTabState }) {
  const { user } = useAuth();
  const {
    filteredPersons, selectedPerson, setSelectedPerson, setSSNRevealed,
    searchQuery, setSearchQuery, showArchived,
    openEditPerson, setDeleteTarget, handleArchive, handleUnarchive,
    personModalOpen, editingPerson, personSubmitting, personSubmitError, handlePersonSubmit, closeModal,
    duplicateWarning, handleForceCreate, handleCancelDuplicate,
  } = state;

  // ── Right-click context menu ──
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const canModify = !showArchived || user?.role === 'admin';

  const buildPersonMenu = (person: Person): ContextMenuItem[] => {
    const fullName = `${person.first_name || ''} ${person.last_name || ''}`.trim();
    const addr = [person.address, person.city, person.state, person.zip].filter(Boolean).join(', ');
    return [
      m.action('Open record', () => { setSelectedPerson(person); setSSNRevealed(false); }, { icon: <Eye size={12} /> }),
      ...(canModify ? [m.action('Edit person', () => openEditPerson(person), { icon: <Pencil size={12} /> })] : []),
      m.action('Open in new window', () => openRecordWindow('person', person.id), { icon: <ExternalLink size={12} /> }),
      m.separator(),
      m.copy('Copy name', fullName),
      m.copyId(person.id),
      ...(person.phone ? [m.copy('Copy phone', person.phone, <Phone size={12} />)] : []),
      ...(addr ? [m.openExternal('Navigate to address', `https://maps.google.com/?q=${encodeURIComponent(addr)}`, <Navigation size={12} />)] : []),
      m.separator(),
      m.go('Run NCIC query', `/ncic?type=person&q=${encodeURIComponent(fullName)}`, <Search size={12} />),
      ...(addr ? [m.go('Dispatch to this address', `/dispatch?newCall=1&location=${encodeURIComponent(addr)}&description=${encodeURIComponent('Re: ' + fullName)}`, <MapPin size={12} />)] : []),
      m.go('Create BOLO', `/communications?newBolo=1&title=${encodeURIComponent('BOLO: ' + fullName)}&subject=${encodeURIComponent(fullName)}`, <AlertTriangle size={12} />),
      m.separator(),
      ...(showArchived
        ? (canModify ? [m.action('Unarchive', () => handleUnarchive('persons', person.id), { icon: <RotateCcw size={12} /> })] : [])
        : [m.action('Archive', () => handleArchive('persons', person.id), { icon: <Archive size={12} /> })]),
      ...(canModify ? [m.action('Delete', () => setDeleteTarget({ type: 'person', id: person.id, label: fullName }), { icon: <Trash2 size={12} />, danger: true })] : []),
    ];
  };

  // ── Local sort + filter state ──
  const [sortBy, setSortBy] = useState<'name' | 'dob' | 'newest'>('name');
  const [filterFlag, setFilterFlag] = useState<string | null>(null);

  // Sort + filter the already-filtered persons
  const displayPersons = React.useMemo(() => {
    let list = [...filteredPersons];
    // Apply flag filter
    if (filterFlag) {
      list = list.filter(p => {
        if (filterFlag === 'warrant') return p.flags.some(f => typeof f === 'string' ? f.toLowerCase().includes('warrant') : false);
        if (filterFlag === 'sex_offender') return p.is_sex_offender;
        if (filterFlag === 'veteran') return p.is_veteran;
        if (filterFlag === 'gang') return !!p.gang_affiliation && !['none', '0', 'n/a'].includes(String(p.gang_affiliation).toLowerCase());
        if (filterFlag === 'bolo') return p.flags.some(f => typeof f === 'string' ? f.toLowerCase().includes('bolo') : false);
        return true;
      });
    }
    // Sort
    if (sortBy === 'name') {
      list.sort((a, b) => (a.last_name || '').localeCompare(b.last_name || '') || (a.first_name || '').localeCompare(b.first_name || ''));
    } else if (sortBy === 'dob') {
      list.sort((a, b) => (a.date_of_birth || '').localeCompare(b.date_of_birth || ''));
    } else if (sortBy === 'newest') {
      list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    }
    return list;
  }, [filteredPersons, sortBy, filterFlag]);

  // Stats
  const stats = React.useMemo(() => ({
    total: filteredPersons.length,
    withWarrants: filteredPersons.filter(p => p.flags.some(f => typeof f === 'string' && f.toLowerCase().includes('warrant'))).length,
    sexOffenders: filteredPersons.filter(p => p.is_sex_offender).length,
    veterans: filteredPersons.filter(p => p.is_veteran).length,
  }), [filteredPersons]);

  return (
    <div className="h-full flex flex-col">
      {/* Search */}
      <div className="p-3 border-b border-rmpg-600" role="search">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400 pointer-events-none" />
            <input id="ff-personstab-0"
              type="text"
              className="input-dark pl-9 w-full text-[11px] min-h-[36px] focus:ring-1 focus:ring-brand-500/50 focus:border-brand-600 transition-shadow"
              placeholder="Search by name, address, DL#, phone, flags..." aria-label="Search by name, address, DL#, phone, flags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-rmpg-100 transition-colors" aria-label="Clear search">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <AISearchButton
            query={searchQuery}
            searchType="persons"
            onFiltersExtracted={(filters) => {
              // Build a combined search string from AI-extracted filters
              const parts: string[] = [];
              if (filters.name) parts.push(filters.name);
              if (filters.address) parts.push(filters.address);
              if (filters.race) parts.push(filters.race);
              if (filters.gender) parts.push(filters.gender);
              if (filters.hair) parts.push(filters.hair);
              if (filters.eyes) parts.push(filters.eyes);
              if (parts.length > 0) setSearchQuery(parts.join(' '));
            }}
          />
        </div>
      </div>

      {/* Stats Bar */}
      <div className="px-3 py-1.5 border-b border-rmpg-700/50 bg-surface-sunken flex items-center gap-4 text-[9px] flex-wrap">
        <span className="text-rmpg-400 flex items-center gap-1"><Users className="w-3 h-3" /> <strong className="text-rmpg-100">{stats.total}</strong> Records</span>
        {stats.withWarrants > 0 && <span className="text-red-400 flex items-center gap-1"><Gavel className="w-3 h-3" /> <strong>{stats.withWarrants}</strong> Warrants</span>}
        {stats.sexOffenders > 0 && <span className="text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> <strong>{stats.sexOffenders}</strong> RSO</span>}
        {stats.veterans > 0 && <span className="text-green-400 flex items-center gap-1"><Shield className="w-3 h-3" /> <strong>{stats.veterans}</strong> Veterans</span>}

        {/* Sort */}
        <div className="ml-auto flex items-center gap-1">
          <ArrowUpDown className="w-3 h-3 text-rmpg-500" />
          {(['name', 'dob', 'newest'] as const).map(s => (
            <button key={s} type="button" onClick={() => setSortBy(s)}
              className={`px-1.5 py-0.5 text-[9px] font-medium border transition-all ${sortBy === s ? 'bg-brand-900/30 border-brand-500/50 text-brand-400' : 'bg-transparent border-transparent text-rmpg-500 hover:text-rmpg-300'}`}>
              {s === 'name' ? 'A-Z' : s === 'dob' ? 'DOB' : 'Newest'}
            </button>
          ))}
        </div>
      </div>

      {/* Filter Chips */}
      <div className="px-3 py-1 border-b border-rmpg-700/30 flex items-center gap-1.5 text-[9px] flex-wrap">
        <Filter className="w-3 h-3 text-rmpg-500" />
        {[
          { key: null, label: 'All' },
          { key: 'warrant', label: 'Wanted' },
          { key: 'sex_offender', label: 'RSO' },
          { key: 'veteran', label: 'Veteran' },
          { key: 'gang', label: 'Gang' },
          { key: 'bolo', label: 'BOLO' },
        ].map(f => (
          <button key={f.key || 'all'} type="button" onClick={() => setFilterFlag(f.key)}
            className={`px-2 py-0.5 font-medium border transition-all ${filterFlag === f.key ? 'bg-brand-900/30 border-brand-500/50 text-brand-400' : 'bg-transparent border-rmpg-700/50 text-rmpg-500 hover:text-rmpg-300 hover:border-rmpg-500'}`}>
            {f.label}
          </button>
        ))}
        {filterFlag && <span className="text-rmpg-500 ml-1">({displayPersons.length} match{displayPersons.length !== 1 ? 'es' : ''})</span>}
      </div>

      {/* Person List */}
      <div className="flex-1 overflow-auto scrollbar-dark" role="list" aria-label="Person records">
        {displayPersons.length === 0 && (
          <div className="text-center py-16">
            <UserCircle className="w-10 h-10 text-rmpg-600 mx-auto mb-3" />
            <p className="text-sm text-rmpg-400 font-medium">
              {searchQuery
                ? 'No persons match your search.'
                : showArchived
                  ? 'No archived person records.'
                  : 'No person records found.'}
            </p>
            <p className="text-[10px] text-rmpg-600 mt-1">
              {searchQuery
                ? 'Try broadening your search terms.'
                : showArchived
                  ? 'Records you archive will appear here.'
                  : 'Click "New Person" to create a record.'}
            </p>
          </div>
        )}
        {displayPersons.map((person, idx) => (
          <div
            key={person.id}
            role="listitem"
            tabIndex={0}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/json', JSON.stringify({ type: 'person', id: person.id, name: `${person.first_name} ${person.last_name}` }));
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedPerson(selectedPerson?.id === person.id ? null : person); setSSNRevealed(false); } }}
            onClick={() => { setSelectedPerson(selectedPerson?.id === person.id ? null : person); setSSNRevealed(false); }}
            onContextMenu={(e) => openMenu(e, buildPersonMenu(person))}
            className={`
              px-4 py-3 border-b border-rmpg-700/50 cursor-pointer transition-all duration-150
              ${selectedPerson?.id === person.id
                ? 'bg-brand-900/20 border-l-2 border-l-brand-500'
                : `hover:bg-rmpg-700/30 border-l-2 border-l-transparent ${idx % 2 === 1 ? 'bg-rmpg-800/20' : ''}`
              }
            `}
            aria-selected={selectedPerson?.id === person.id}
          >
            <div className="flex items-center gap-3">
              {(() => {
                // No-photo persons get a uniform steel-blue person glyph; the
                // must-not-miss condition (WARRANT / SOR / GANG / …) shows as a
                // small corner tab instead of a full colored ring.
                const cornerBadge = recordCornerBadge(personPostureFlags(person));
                const photo = person.photo || person.photo_url || person.id_image_url;
                return (
                  <RecordAvatar
                    name={`${person.first_name || ''} ${person.last_name || ''}`}
                    photoUrl={photo ? authedImageUrl(photo) : undefined}
                    icon={User}
                    cornerBadge={cornerBadge}
                    size={36}
                  />
                );
              })()}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-rmpg-100 truncate">
                    {person.last_name}, {person.first_name}
                    {person.middle_name ? ` ${person.middle_name[0]}.` : ''}
                  </span>
                  {person.alias_nickname && (
                    <span className="text-[10px] text-amber-400 italic">aka "{person.alias_nickname}"</span>
                  )}
                  {person.is_sex_offender && (
                    <span className="px-1 py-0.5 text-[8px] font-bold bg-red-900/60 text-red-400 border border-red-700/50">RSO</span>
                  )}
                  {person.watchlist_match && (
                    <span className="px-1 py-0.5 text-[8px] font-bold bg-red-900/80 text-red-300 border border-red-500/70 animate-pulse">OFAC</span>
                  )}
                  <WarrantBadge flags={person.flags} size="sm" />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-[10px] text-rmpg-400">
                  {person.date_of_birth && <span>DOB: {safeDateDisplay(person.date_of_birth)}{(() => { const b = parseTimestamp(person.date_of_birth); if (isNaN(b.getTime())) return ''; const today = new Date(); let age = today.getFullYear() - b.getFullYear(); if (today.getMonth() < b.getMonth() || (today.getMonth() === b.getMonth() && today.getDate() < b.getDate())) age--; return age >= 0 ? ` (${age})` : ''; })()}</span>}
                  {person.gender && <span>{humanizeGender(person.gender)}</span>}
                  {person.race && <span>{humanizeRace(person.race)}</span>}
                  {person.phone && (
                    <span className="flex items-center gap-0.5">
                      <Phone className="w-2.5 h-2.5" />{formatPhoneDisplay(person.phone)}
                    </span>
                  )}
                </div>
                {(person.address || person.city) && (
                  <div className="flex items-center gap-1 mt-0.5 text-[9px] text-rmpg-500 truncate">
                    <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                    {[formatAddressDisplay(person.address), formatAddressDisplay(person.city), person.state?.toUpperCase(), person.zip].filter(Boolean).join(', ')}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                {(() => {
                  const securityFlags = person.flags.filter(f => {
                    const label = typeof f === 'object' ? (f.type || '') : f;
                    return !isProvenanceFlag(label);
                  });
                  if (securityFlags.length === 0) return null;
                  return (
                    <div className="flex gap-1">
                      {securityFlags.slice(0, 2).map((flag, i) => {
                        const label = typeof flag === 'object' ? (flag.type || 'FLAG') : flag;
                        return (
                          <RecordBadge key={`${label}-${i}`} flag={label} glow={false} title={humanizeFlag(label)}>{label}</RecordBadge>
                        );
                      })}
                      {securityFlags.length > 2 && (
                        <span className="text-[9px] text-rmpg-400">+{securityFlags.length - 2}</span>
                      )}
                    </div>
                  );
                })()}
                {/* Phone: only the call action — the rest of the cluster would
                    eat the whole row width at 44px touch size; row tap opens
                    the detail panel and long-press has the full menu. */}
                {person.phone && (
                  <a href={`tel:${person.phone}`} onClick={e => e.stopPropagation()}
                    className="md:hidden flex items-center justify-center w-9 h-9 border border-rmpg-700 text-green-400" title={`Call ${formatPhoneDisplay(person.phone)}`}>
                    <Phone className="w-4 h-4" />
                  </a>
                )}
                <div className="hidden md:flex items-center gap-1">
                  {/* Quick actions */}
                  {person.phone && (
                    <a href={`tel:${person.phone}`} onClick={e => e.stopPropagation()}
                      className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-green-400 transition-colors" title={`Call ${formatPhoneDisplay(person.phone)}`}>
                      <Phone className="w-3 h-3" />
                    </a>
                  )}
                  {person.email && (
                    <a href={`mailto:${person.email}`} onClick={e => e.stopPropagation()}
                      className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-rmpg-400 transition-colors" title={`Email ${person.email}`}>
                      <Mail className="w-3 h-3" />
                    </a>
                  )}
                  {person.address && (
                    <a href={`https://maps.google.com/?q=${encodeURIComponent(person.address + (person.city ? ', ' + person.city : '') + (person.state ? ', ' + person.state : ''))}`}
                      target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                      className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-amber-400 transition-colors" title="Navigate to address">
                      <Navigation className="w-3 h-3" />
                    </a>
                  )}
                  <span className="w-px h-3 bg-rmpg-700 mx-0.5" />
                  {(!showArchived || user?.role === 'admin') && (
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); openEditPerson(person); }}
                      className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-brand-400 transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); openRecordWindow('person', person.id); }}
                    className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-brand-400 transition-colors"
                    title="Open in Window"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                  {(!showArchived || user?.role === 'admin') && (
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'person', id: person.id, label: `${person.first_name} ${person.last_name}` }); }}
                      className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                  {(!showArchived || user?.role === 'admin') && (
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); handleArchive('persons', person.id); }}
                      className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-amber-400 transition-colors"
                      title="Archive"
                    >
                      <Archive className="w-3 h-3" />
                    </button>
                  )}
                  {showArchived && (
                    <button type="button"
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

      {/* Duplicate Warning Dialog */}
      {duplicateWarning && duplicateWarning.length > 0 && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={handleCancelDuplicate}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative w-full max-w-[95vw] md:max-w-md mx-4 max-h-[90vh] overflow-y-auto bg-surface-base border border-rmpg-600 shadow-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-2 border-b border-rmpg-600" style={{ background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)' }}>
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <h2 className="text-xs font-bold text-rmpg-100 uppercase tracking-wider">Possible Duplicates Found</h2>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-rmpg-300">The following existing records match the person you're creating:</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {duplicateWarning.map((m: any) => (
                  <div key={m.id} className="flex items-center gap-3 p-2 border border-rmpg-700 bg-surface-sunken text-xs">
                    <div className="w-2 h-2 bg-amber-400" style={{ borderRadius: '1px' }} />
                    <div className="flex-1">
                      <div className="font-bold text-rmpg-100">{m.first_name} {m.last_name}</div>
                      <div className="text-rmpg-400">
                        {m.dob && <span>DOB: {m.dob}</span>}
                        {m.address && <span className="ml-2">• {m.address}</span>}
                        {m.dl_number && <span className="ml-2">• DL: {m.dl_number}</span>}
                      </div>
                    </div>
                    <span className="text-rmpg-500 text-[9px]">#{m.id}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-rmpg-700">
                <button type="button" onClick={handleCancelDuplicate} className="toolbar-btn" style={{ padding: '4px 12px' }}>Cancel</button>
                <button type="button" onClick={handleForceCreate} className="toolbar-btn text-amber-400 border-amber-700 hover:bg-amber-900/30" style={{ padding: '4px 12px' }}>Create Anyway</button>
              </div>
            </div>
          </div>
        </div>
      )}
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
    duplicateWarning, handleForceCreate, handleCancelDuplicate,
  } = state;

  if (!selectedPerson) return null;

  // Hero identity line — "LAST, FIRST M."
  const heroName = [
    selectedPerson.last_name,
    [selectedPerson.first_name, selectedPerson.middle_name ? `${selectedPerson.middle_name[0]}.` : '']
      .filter(Boolean)
      .join(' '),
  ]
    .filter(Boolean)
    .join(', ') || 'UNKNOWN SUBJECT';

  // Posture inputs (shared with the list ring + alerts). Veteran is excluded —
  // it's informational, not a threat, and would classify as a generic caution.
  const posturalFlags = personPostureFlags(selectedPerson);

  const hasSpecialFlags =
    selectedPerson.flags.length > 0 ||
    selectedPerson.is_sex_offender ||
    selectedPerson.is_veteran ||
    hasValue(selectedPerson.gang_affiliation) ||
    !!selectedPerson.watchlist_match ||
    hasValue(selectedPerson.probation_parole);

  // Same photo-source fallback chain the list row uses, so an attached
  // mugshot / DL image populates the hero tile too (else the person glyph).
  const heroPhotoSrc =
    selectedPerson.photo || selectedPerson.photo_url || selectedPerson.id_image_url;
  const heroPhoto = heroPhotoSrc ? authedImageUrl(heroPhotoSrc) : undefined;

  const heroSubtitle = (
    <span className="flex items-center gap-3">
      {selectedPerson.date_of_birth && (
        <span>
          DOB: {safeDateDisplay(selectedPerson.date_of_birth)}
          {(() => {
            const b = parseTimestamp(selectedPerson.date_of_birth);
            if (isNaN(b.getTime())) return '';
            const today = new Date();
            let age = today.getFullYear() - b.getFullYear();
            if (today.getMonth() < b.getMonth() || (today.getMonth() === b.getMonth() && today.getDate() < b.getDate())) age--;
            return age >= 0 ? ` (${age})` : '';
          })()}
        </span>
      )}
      {selectedPerson.gender && <span>{humanizeGender(selectedPerson.gender)}</span>}
      {selectedPerson.race && <span>{humanizeRace(selectedPerson.race)}</span>}
    </span>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Hero identity band + Alert Banner (below PanelTitleBar, which RecordsPage provides) */}
      <div className="border-b border-rmpg-600 bg-surface-sunken flex-shrink-0">
        <RecordHero
          name={heroName}
          subtitle={heroSubtitle}
          photoUrl={heroPhoto}
          icon={User}
          flags={posturalFlags}
        >
          {hasSpecialFlags && (
            <>
              {selectedPerson.flags.map((flag, i) => {
                const label = typeof flag === 'object' ? (flag.type || 'FLAG') : flag;
                return (
                  <RecordBadge key={`${label}-${i}`} flag={label} title={humanizeFlag(label)}>
                    {label}
                  </RecordBadge>
                );
              })}
              {selectedPerson.watchlist_match && <RecordBadge tone="red" pulse icon={AlertTriangle}>OFAC WATCHLIST MATCH</RecordBadge>}
              {selectedPerson.is_sex_offender && <RecordBadge tone="red">SEX OFFENDER</RecordBadge>}
              {selectedPerson.is_veteran && <RecordBadge tone="blue" glow={false}>VETERAN</RecordBadge>}
              {hasValue(selectedPerson.gang_affiliation) && <RecordBadge tone="orange">GANG: {selectedPerson.gang_affiliation}</RecordBadge>}
              {hasValue(selectedPerson.probation_parole) && <RecordBadge tone="orange">{selectedPerson.probation_parole!.toUpperCase()}</RecordBadge>}
            </>
          )}
        </RecordHero>
        {personAlerts.length > 0 && (
          <div className="px-4 pb-2">
            <AlertBanner alerts={personAlerts} />
          </div>
        )}
      </div>

      {/* Scrollable Detail Sections */}
      <div className="flex-1 overflow-auto p-2 space-y-1">

        {/* ── Demographics ─────────────────────────── */}
        <CollapsibleSection title="Demographics" icon={User} defaultOpen>
          <FieldGrid cols={3}>
            {selectedPerson.alias_nickname && <RecordField label="Alias / AKA" value={selectedPerson.alias_nickname} />}
            {selectedPerson.aliases && <RecordField label="Other Aliases" value={selectedPerson.aliases} />}
            {selectedPerson.suffix && <RecordField label="Suffix" value={selectedPerson.suffix} />}
            {selectedPerson.sex && <RecordField label="Sex (Birth/Legal)" value={selectedPerson.sex} />}
            {selectedPerson.gender && <RecordField label="Gender Identity" value={humanizeGender(selectedPerson.gender)} />}
            <RecordField label="Language" value={selectedPerson.language} />
            {selectedPerson.nationality && <RecordField label="Nationality" value={selectedPerson.nationality} />}
            <RecordField label="Place of Birth" value={selectedPerson.place_of_birth} />
            <RecordField label="Citizenship" value={selectedPerson.citizenship} />
            <RecordField label="Marital Status" value={selectedPerson.marital_status} />
            <RecordField label="Blood Type" value={selectedPerson.blood_type} />
          </FieldGrid>
        </CollapsibleSection>

        {/* ── Physical Description ─────────────────── */}
        <CollapsibleSection title="Physical Description" icon={Eye} defaultOpen>
          <FieldGrid cols={3}>
            <RecordField label="Height" value={selectedPerson.height_feet != null ? `${selectedPerson.height_feet}'${String(selectedPerson.height_inches ?? 0).padStart(2, '0')}"` : selectedPerson.height} />
            <RecordField label="Weight" value={selectedPerson.weight} />
            <RecordField label="Build" value={selectedPerson.build} />
            <RecordField label="Complexion" value={selectedPerson.complexion} />
            <RecordField label="Hair" value={selectedPerson.hair_color} />
            <RecordField label="Hair Length" value={selectedPerson.hair_length} />
            <RecordField label="Hair Style" value={selectedPerson.hair_style} />
            <RecordField label="Eyes" value={selectedPerson.eye_color} />
            <RecordField label="Facial Hair" value={selectedPerson.facial_hair} />
            <RecordField label="Glasses" value={selectedPerson.glasses} />
            <RecordField label="Shoe Size" value={selectedPerson.shoe_size} />
          </FieldGrid>
          {selectedPerson.scars_marks_tattoos && (
            <div className="mt-2"><RecordField label="Scars/Marks/Tattoos" value={selectedPerson.scars_marks_tattoos} valueColor="var(--sev-warn-soft)" /></div>
          )}
          {selectedPerson.scar_description && (
            <div className="mt-1"><span className="text-[10px] text-amber-400 uppercase font-semibold">Scar Details:</span> <span className="text-xs text-rmpg-200 ml-1">{selectedPerson.scar_description}</span></div>
          )}
          {selectedPerson.tattoo_description && (
            <div className="mt-1"><span className="text-[10px] text-amber-400 uppercase font-semibold">Tattoo Details:</span> <span className="text-xs text-rmpg-200 ml-1">{selectedPerson.tattoo_description}</span></div>
          )}
          {selectedPerson.piercing_description && (
            <div className="mt-1"><span className="text-[10px] text-rmpg-400 uppercase font-semibold">Piercings:</span> <span className="text-xs text-rmpg-200 ml-1">{selectedPerson.piercing_description}</span></div>
          )}
          {selectedPerson.identifying_marks_location && (
            <div className="mt-1"><span className="text-[10px] text-amber-400 uppercase font-semibold">Marks Location:</span> <span className="text-xs text-rmpg-200 ml-1">{selectedPerson.identifying_marks_location}</span></div>
          )}
          {selectedPerson.distinguishing_features && (
            <div className="mt-1"><span className="text-[10px] text-amber-400 uppercase font-semibold">Distinguishing Features:</span> <span className="text-xs text-rmpg-200 ml-1">{selectedPerson.distinguishing_features}</span></div>
          )}
          {selectedPerson.clothing_description && (
            <div className="mt-1"><RecordField label="Clothing" value={selectedPerson.clothing_description} /></div>
          )}
        </CollapsibleSection>

        {/* ── Contact & Address ────────────────────── */}
        <CollapsibleSection title="Contact & Address" icon={Phone} defaultOpen>
          <FieldGrid cols={2}>
            <RecordField label="Phone" value={selectedPerson.phone ? formatPhoneDisplay(selectedPerson.phone) : undefined} icon={Phone} copyable />
            <RecordField label="Phone 2" value={selectedPerson.phone_secondary ? formatPhoneDisplay(selectedPerson.phone_secondary) : undefined} icon={Phone} copyable />
            {selectedPerson.home_phone && <RecordField label="Home Phone" value={formatPhoneDisplay(selectedPerson.home_phone)} icon={Phone} copyable />}
            {selectedPerson.work_phone && <RecordField label="Work Phone" value={formatPhoneDisplay(selectedPerson.work_phone)} icon={Phone} copyable />}
            <RecordField label="Email" value={selectedPerson.email} icon={Mail} copyable />
            {selectedPerson.email_secondary && <RecordField label="Email 2" value={selectedPerson.email_secondary} icon={Mail} copyable />}
            <RecordField label="Address" value={[formatAddressDisplay(selectedPerson.address), selectedPerson.address_2, formatAddressDisplay(selectedPerson.city), selectedPerson.state?.toUpperCase(), selectedPerson.zip].filter(Boolean).join(', ')} icon={MapPin} copyable />
            <RecordField label="Social Media" value={selectedPerson.social_media} />
          </FieldGrid>
        </CollapsibleSection>

        {/* ── Employment ───────────────────────────── */}
        {(selectedPerson.employer || selectedPerson.occupation) && (
          <CollapsibleSection title="Employment" icon={Briefcase}>
            <FieldGrid cols={2}>
              <RecordField label="Employer" value={selectedPerson.employer} icon={Briefcase} />
              <RecordField label="Occupation" value={selectedPerson.occupation} />
            </FieldGrid>
          </CollapsibleSection>
        )}

        {/* ── Identification ──────────────────────── */}
        <CollapsibleSection title="Identification" icon={CreditCard} defaultOpen>
          {(selectedPerson.dl_number || selectedPerson.id_number || selectedPerson.ssn_last4 || selectedPerson.ssn_full || selectedPerson.id_image_url || selectedPerson.dl_restrictions || selectedPerson.dl_endorsements || selectedPerson.dl_issue_date) ? (
            <div className="flex gap-3">
              {/* ID Image */}
              {selectedPerson.id_image_url ? (
                <div className="flex-shrink-0">
                  <div className="w-24 h-32 border border-rmpg-500 bg-rmpg-900 overflow-hidden cursor-pointer group relative"
                    onClick={() => window.open(authedImageUrl(selectedPerson.id_image_url!), '_blank', 'noopener,noreferrer')}
                    title="Click to enlarge"
                  >
                    <img src={authedImageUrl(selectedPerson.id_image_url)} alt="ID" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity flex items-center justify-center">
                      <Eye className="w-4 h-4 text-rmpg-100" />
                    </div>
                  </div>
                  {selectedPerson.id_type && (
                    <span className="inline-block mt-1 px-1.5 py-0.5 text-[8px] font-bold uppercase bg-surface-sunken/40 text-rmpg-400 border border-border-default/40 text-center w-full">
                      {toDisplayLabel(selectedPerson.id_type)}
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
                  <>
                    <FieldGrid cols={2}>
                      <RecordField label="DL" value={selectedPerson.dl_number} mono copyable />
                      <RecordField label="State" value={selectedPerson.dl_state} />
                      <RecordField label="Class" value={selectedPerson.dl_class} />
                      <RecordField label="Expiry" value={selectedPerson.dl_expiry ? safeDateDisplay(selectedPerson.dl_expiry) : undefined} />
                      <RecordField label="Issue Date" value={selectedPerson.dl_issue_date ? safeDateDisplay(selectedPerson.dl_issue_date) : undefined} />
                    </FieldGrid>
                    {(selectedPerson.dl_restrictions || selectedPerson.dl_endorsements) && (
                      <div className="mt-1.5 space-y-1">
                        {selectedPerson.dl_restrictions && (
                          <div>
                            <span className="text-[9px] font-bold uppercase text-rmpg-400 tracking-wider">Restrictions</span>
                            <p className="text-[11px] text-rmpg-200 mt-0.5">{selectedPerson.dl_restrictions}</p>
                          </div>
                        )}
                        {selectedPerson.dl_endorsements && (
                          <div>
                            <span className="text-[9px] font-bold uppercase text-rmpg-400 tracking-wider">Endorsements</span>
                            <p className="text-[11px] text-rmpg-200 mt-0.5">{selectedPerson.dl_endorsements}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
                {selectedPerson.id_number && (
                  <FieldGrid cols={2}>
                    <RecordField label={selectedPerson.id_type ? toDisplayLabel(selectedPerson.id_type).toUpperCase() : 'ID'} value={selectedPerson.id_number} mono copyable />
                    <RecordField label="State" value={selectedPerson.id_state} />
                    <RecordField label="Expiry" value={selectedPerson.id_expiry ? safeDateDisplay(selectedPerson.id_expiry) : undefined} />
                  </FieldGrid>
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
                        <button type="button"
                          onClick={() => setSSNRevealed(!ssnRevealed)}
                          className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase border transition-colors"
                          style={ssnRevealed
                            ? { color: 'var(--sev-critical-soft)', background: 'rgb(var(--sev-critical-rgb) / 0.15)', borderColor: 'rgb(var(--sev-critical-rgb) / 0.4)' }
                            : { color: 'rgb(var(--rmpg-400-rgb))', background: 'rgb(var(--rmpg-500-rgb) / 0.15)', borderColor: 'rgb(var(--rmpg-500-rgb) / 0.3)' }
                          }
                          title={ssnRevealed ? 'Hide SSN' : 'Reveal SSN'}
                        >
                          {ssnRevealed ? <><EyeOff className="w-3 h-3" /> Hide</> : <><Eye className="w-3 h-3" /> Reveal</>}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              {/* ── Law Enforcement IDs ── */}
              {(selectedPerson.ncic_number || selectedPerson.sor_number || selectedPerson.fbi_number || selectedPerson.state_id_number) && (
                <div className="border-t border-rmpg-700 pt-1.5 mt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                    {selectedPerson.ncic_number && <div><span className="text-rmpg-400">NCIC #:</span> <span className="text-rmpg-200 font-mono">{selectedPerson.ncic_number}</span></div>}
                    {selectedPerson.fbi_number && <div><span className="text-rmpg-400">FBI #:</span> <span className="text-rmpg-200 font-mono">{selectedPerson.fbi_number}</span></div>}
                    {selectedPerson.state_id_number && <div><span className="text-rmpg-400">State ID #:</span> <span className="text-rmpg-200 font-mono">{selectedPerson.state_id_number}</span></div>}
                    {selectedPerson.sor_number && <div><span className="text-rmpg-400">SOR #:</span> <span className="text-rmpg-200 font-mono">{selectedPerson.sor_number}</span></div>}
                  </div>
                </div>
              )}
              {/* ── Passport ── */}
              {(selectedPerson.passport_number || selectedPerson.passport_country) && (
                <div className="border-t border-rmpg-700 pt-1.5 mt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                    {selectedPerson.passport_number && <div><span className="text-rmpg-400">Passport #:</span> <span className="text-rmpg-200 font-mono">{selectedPerson.passport_number}</span></div>}
                    {selectedPerson.passport_country && <div><span className="text-rmpg-400">Country:</span> <span className="text-rmpg-200">{selectedPerson.passport_country}</span></div>}
                  </div>
                </div>
              )}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-rmpg-500">No identification on file</p>
          )}
        </CollapsibleSection>

        {/* ── Legal & Associations (conditional) ──── */}
        {(selectedPerson.probation_parole || selectedPerson.known_associates || hasValue(selectedPerson.gang_affiliation) || selectedPerson.alias_dob) && (
          <CollapsibleSection title="Legal & Associations" icon={Shield} accent="amber">
            <FieldGrid cols={2}>
              {renderInfoRow('Probation/Parole', selectedPerson.probation_parole)}
              {renderInfoRow('P.O. / Officer', selectedPerson.probation_parole_officer)}
              {hasValue(selectedPerson.gang_affiliation) && <RecordField label="Gang Affiliation" value={selectedPerson.gang_affiliation} />}
              {selectedPerson.alias_dob && <RecordField label="Alias DOB" value={safeDateDisplay(selectedPerson.alias_dob)} />}
            </FieldGrid>
            {selectedPerson.known_associates && (
              <div className="mt-1.5"><span className="text-[10px] text-rmpg-400 uppercase font-semibold">Known Associates:</span> <span className="text-xs text-rmpg-200 ml-1">{selectedPerson.known_associates}</span></div>
            )}
          </CollapsibleSection>
        )}

        {/* ── Emergency Contact (conditional) ─────── */}
        {selectedPerson.emergency_contact_name && (
          <CollapsibleSection title="Emergency Contact" icon={AlertTriangle}>
            <FieldGrid cols={3}>
              {renderInfoRow('Name', selectedPerson.emergency_contact_name)}
              {renderInfoRow('Phone', selectedPerson.emergency_contact_phone, Phone)}
              {renderInfoRow('Relationship', selectedPerson.emergency_contact_relationship)}
            </FieldGrid>
          </CollapsibleSection>
        )}

        {/* ── Immigration ──────────────────────────── */}
        {selectedPerson.immigration_status && (
          <CollapsibleSection title="Immigration" icon={Shield}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {renderInfoRow('Immigration Status', selectedPerson.immigration_status)}
            </div>
          </CollapsibleSection>
        )}

        {/* ── Health & Medical (conditional) ────────── */}
        {(selectedPerson.disability_flags || selectedPerson.mental_health_flags || selectedPerson.substance_abuse || selectedPerson.medication_notes) && (
          <CollapsibleSection title="Health & Medical" icon={AlertTriangle}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {renderInfoRow('Disabilities', selectedPerson.disability_flags)}
              {renderInfoRow('Mental Health', selectedPerson.mental_health_flags)}
              {renderInfoRow('Substance Abuse', selectedPerson.substance_abuse)}
            </div>
            {selectedPerson.medication_notes && (
              <div className="mt-1.5"><span className="text-[10px] text-rmpg-400 uppercase font-semibold">Medication Notes:</span> <span className="text-xs text-rmpg-200 ml-1">{selectedPerson.medication_notes}</span></div>
            )}
          </CollapsibleSection>
        )}

        {/* ── Custody / Intake (conditional) ─────────── */}
        {(selectedPerson.voice_description || selectedPerson.religion || selectedPerson.dietary_restrictions) && (
          <CollapsibleSection title="Custody / Intake" icon={BookOpen}>
            <FieldGrid cols={3}>
              {selectedPerson.voice_description && <RecordField label="Voice Description" value={selectedPerson.voice_description} />}
              {selectedPerson.religion && <RecordField label="Religion" value={selectedPerson.religion} />}
              {selectedPerson.dietary_restrictions && <RecordField label="Dietary Restrictions" value={selectedPerson.dietary_restrictions} />}
            </FieldGrid>
          </CollapsibleSection>
        )}

        {/* ── Education & Military (conditional) ───── */}
        {(selectedPerson.education_level || selectedPerson.military_branch || selectedPerson.military_status || selectedPerson.tribal_affiliation) && (
          <CollapsibleSection title="Education & Military" icon={Shield}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {renderInfoRow('Education', selectedPerson.education_level)}
              {renderInfoRow('Military Branch', selectedPerson.military_branch)}
              {renderInfoRow('Military Status', selectedPerson.military_status)}
              {renderInfoRow('Tribal Affiliation', selectedPerson.tribal_affiliation)}
            </div>
          </CollapsibleSection>
        )}

        {/* ── Officer Safety / Caution (conditional)  */}
        {selectedPerson.caution_flags && (
          <CollapsibleSection title="Officer Safety / Caution" icon={AlertTriangle} accent="red">
            <p className="text-xs text-red-200/90 leading-relaxed break-words">{selectedPerson.caution_flags}</p>
          </CollapsibleSection>
        )}

        {/* ── Last Known Location (conditional) ────── */}
        {(selectedPerson.date_last_seen || selectedPerson.location_last_seen) && (
          <CollapsibleSection title="Last Known Location" icon={MapPin}>
            <FieldGrid cols={2}>
              {selectedPerson.date_last_seen && <RecordField label="Date Last Seen" value={safeDateDisplay(selectedPerson.date_last_seen)} />}
              {selectedPerson.location_last_seen && <RecordField label="Location Last Seen" value={selectedPerson.location_last_seen} icon={MapPin} />}
            </FieldGrid>
          </CollapsibleSection>
        )}

        {/* ── Notes (conditional) ──────────────────── */}
        {selectedPerson.notes && (
          <CollapsibleSection title="Notes" icon={FileText} defaultOpen={false}>
            <p className="text-xs text-rmpg-200 leading-relaxed break-words whitespace-pre-wrap">{selectedPerson.notes}</p>
          </CollapsibleSection>
        )}

        {/* ── Record Metadata ─────────────────────── */}
        <CollapsibleSection title="Record Info" icon={Clock} defaultOpen={false}>
          <FieldGrid cols={2}>
            <RecordField label="Created" value={safeDateDisplay(selectedPerson.created_at)} />
            <RecordField label="Last Updated" value={safeDateDisplay(selectedPerson.updated_at)} />
            <RecordField label="Record ID" value={selectedPerson.id} mono />
          </FieldGrid>
        </CollapsibleSection>

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

        {/* ── Connections Graph (visual node map) ──── */}
        <ConnectionsGraphPanel
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

  // Set document title
  useEffect(() => { document.title = 'Records - Persons \u2014 RMPG Flex'; }, []);

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

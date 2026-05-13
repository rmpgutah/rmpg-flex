import React, { useState, useEffect, useCallback, useRef, useId, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Send, Navigation, MapPin, Clock, Phone, User, MessageSquare, Radio, Eye,
  CheckCircle, XCircle, AlertTriangle, Loader2, FileText, ChevronDown, Link,
  Archive, RotateCcw, Edit3, Trash2, Save, X, PlusCircle, Shield, Thermometer,
  Undo2, Pencil, Search, Building2, Terminal, Briefcase, Copy, Printer, Route,
} from 'lucide-react';
import type { CallForService, Unit, CallStatus, CallNote, UnitStatus } from '../../types';
import CallCard from '../../components/CallCard';
import UnitStatusBoard from '../../components/UnitStatusBoard';
import DispositionPrompt from '../../components/DispositionPrompt';
import DispatchMiniMap from '../../components/DispatchMiniMap';
import MapboxMiniMap from '../../components/MapboxMiniMap';
import { getResolvedEngine, detectMapEngine, type MapEngine } from '../../utils/mapProvider';
import BoloAlertBanner from '../../components/BoloAlertBanner';
import StatusBadge from '../../components/StatusBadge';
import NewCallModal from '../../components/NewCallModal';
import AddressAutocomplete, { type ParsedAddress } from '../../components/AddressAutocomplete';
import PanelTitleBar from '../../components/PanelTitleBar';
import ExportButton from '../../components/ExportButton';
import TabBar from '../../components/TabBar';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';
import { usePersistedTab } from '../../hooks/usePersistedState';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import { formatIncidentType, INCIDENT_TYPE_CATEGORIES } from '../../utils/caseNumbers';
import { formatPhoneInput } from '../../utils/formatters';
import ConfirmDialog from '../../components/ConfirmDialog';
import RmpgLogo from '../../components/RmpgLogo';
import PrintButton from '../../components/PrintButton';
import PrintRecordButton from '../../components/PrintRecordButton';
import { useToast } from '../../components/ToastProvider';
import { useWebSocket } from '../../context/WebSocketContext';
import WarningTags from '../../components/WarningTags';
import WarrantBadge from '../../components/WarrantBadge';
import type { WarningTag } from '../../components/WarningTags';
import FloatingSaveBar from '../../components/FloatingSaveBar';
import CadCommandLine from '../../components/CadCommandLine';
import NcicQueryPanel from '../../components/NcicQueryPanel';
import UnitRecommendationPanel from '../../components/UnitRecommendationPanel';
import type { CommandAction } from '../../utils/cadCommandParser';
import { getTimerState, isActiveStatus } from '../../utils/dispatchTimers';
import { playTone } from '../../utils/dispatchTones';
import { announceTarget } from '../../utils/voiceChannel';
import { useIsMobile } from '../../hooks/useIsMobile';
import MobileCardList from '../../components/mobile/MobileCardList';
import MobileDetailView from '../../components/mobile/MobileDetailView';
import { mapDbCall, mapDbUnit } from './utils/dispatchMappers';
import { applyCallPdfAutofill } from './utils/callPdfAutofill';
import {
  formatTime, formatElapsed, formatActivityDetails, type FilterTab,
} from './utils/dispatchFormatters';
import { useDispatchUnitActions } from './hooks/useDispatchUnitActions';
import { useDispatchCallActions } from './hooks/useDispatchCallActions';
import { useDispatchNotesActions } from './hooks/useDispatchNotesActions';
import { useDispatchMultiUnitActions } from './hooks/useDispatchMultiUnitActions';
import {
  announceCallAlerts, announcePanicAlert, announceNewCall, announceDispatchEvent,
  announceEscalation, announceCallUpdate, announceUnitAssignment,
  announceCallArchived, announceTime, announceAllClear, announceAcknowledgment,
  announceStatusChange, announceReturnVisit, announceServeComplete,
  announceCallStack, announceShiftSummary, announceCourtDeadline,
  announceDirectedNote, announceLocalAction, announceSpeedAdvisory,
} from '../../utils/voiceAlerts';
import { useAuth } from '../../context/AuthContext';
import { useDistrictOptions } from '../../hooks/useDistrictLookup';
import { useUserPreferences } from '../../context/UserPreferencesContext';
import QuickPsoModal from '../../components/QuickPsoModal';
import {
  WEATHER_OPTIONS, LIGHTING_OPTIONS, WEAPONS_OPTIONS, LE_AGENCY_OPTIONS,
  SCENE_SAFETY_OPTIONS, DIRECTION_OPTIONS,
} from '../../utils/callOptions';
import PersonFormModal, { type PersonFormData } from '../../components/PersonFormModal';
import VehicleFormModal, { type VehicleFormData } from '../../components/VehicleFormModal';
import AIDispatchSidebar from '../../components/dispatch/AIDispatchSidebar';
import NarrativeAssist from '../../components/dispatch/NarrativeAssist';
import FileAttachments from '../../components/FileAttachments';
import {
  humanizePriority, humanizeDisposition, getStatusTooltip, formatPhoneDisplay,
  formatAddressDisplay, timeAgo,
} from '../../utils/statusLabels';

// Label maps for human-readable display of stored values
const SERVICE_TYPE_LABELS: Record<string, string> = {
  // Process Service
  process_service: 'Process Service (General)',
  subpoena_service: 'Subpoena Service',
  summons_service: 'Summons & Complaint',
  eviction_service: 'Eviction / Unlawful Detainer',
  restraining_order_service: 'Protective Order Service',
  writ_service: 'Writ Service',
  court_filing: 'Court Filing / Delivery',
  court_order_service: 'Court Order Service',
  notice_service: 'Notice / Demand Service',
  posting_service: 'Posting Service (Nail & Mail)',
  // Investigative
  skip_trace: 'Skip Trace & Locate',
  stake_out: 'Stake Out / Surveillance',
  rush_service: 'Rush / Same-Day Service',
  asset_search: 'Asset Search',
  background_check: 'Background Check / Due Diligence',
  witness_interview: 'Witness Interview / Statement',
  witness_locate: 'Witness Locate',
  record_retrieval: 'Record Retrieval',
  document_retrieval: 'Document Retrieval',
  field_investigation: 'Field Investigation',
  insurance_investigation: 'Insurance Investigation',
  // Security Services
  patrol: 'Patrol',
  static_guard: 'Static Guard',
  escort: 'Escort',
  event_security: 'Event Security',
  surveillance: 'Surveillance',
  access_control: 'Access Control',
  alarm_response: 'Alarm Response',
  fire_watch: 'Fire Watch',
  construction_security: 'Construction Site Security',
  executive_protection: 'Executive Protection',
  loss_prevention: 'Loss Prevention',
  // Administrative
  notary_service: 'Notary Service',
  certified_copy: 'Certified Copy Service',
  courier: 'Courier / Messenger',
  document_preparation: 'Document Preparation',
  affidavit_preparation: 'Affidavit Preparation',
  other: 'Other',
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  // Civil Process — General
  subpoena: 'Subpoena',
  subpoena_duces_tecum: 'Subpoena Duces Tecum',
  subpoena_deposition: 'Subpoena (Deposition)',
  federal_subpoena: 'Federal Subpoena',
  summons: 'Summons & Complaint',
  complaint: 'Complaint',
  civil_summons: 'Civil Summons',
  third_party_complaint: 'Third-Party Complaint',
  cross_complaint: 'Cross-Complaint',
  counterclaim: 'Counterclaim',
  amended_complaint: 'Amended Complaint',
  small_claims: 'Small Claims',
  // Writs & Garnishments
  garnishment: 'Garnishment',
  writ_of_execution: 'Writ of Execution',
  writ_of_restitution: 'Writ of Restitution',
  writ_of_garnishment: 'Writ of Garnishment',
  writ_of_attachment: 'Writ of Attachment',
  writ_of_possession: 'Writ of Possession',
  writ_of_assistance: 'Writ of Assistance',
  writ_of_mandate: 'Writ of Mandate / Mandamus',
  wage_garnishment: 'Wage Garnishment',
  bank_levy: 'Bank Levy / Account Garnishment',
  // Family / Domestic
  restraining_order: 'Protective / Restraining Order',
  temporary_protective_order: 'Temporary Protective Order',
  cohabitant_abuse_order: 'Cohabitant Abuse Protective Order',
  divorce_papers: 'Divorce Papers',
  divorce_petition: 'Divorce Petition',
  divorce_summons: 'Divorce Summons',
  custody_order: 'Custody Order',
  custody_modification: 'Custody Modification',
  child_support: 'Child Support Order',
  child_support_modification: 'Child Support Modification',
  paternity_action: 'Paternity Action',
  adoption_papers: 'Adoption Papers',
  guardianship: 'Guardianship Petition',
  termination_of_parental_rights: 'Termination of Parental Rights',
  stalking_injunction: 'Stalking Injunction',
  // Real Property
  eviction: 'Eviction Notice',
  unlawful_detainer: 'Unlawful Detainer',
  notice_to_quit: 'Notice to Quit',
  three_day_notice: '3-Day Notice to Pay or Quit',
  five_day_notice: '5-Day Notice (Commercial)',
  fifteen_day_notice: '15-Day Notice (Month-to-Month)',
  foreclosure: 'Foreclosure Notice',
  notice_of_default: 'Notice of Default',
  lis_pendens: 'Lis Pendens',
  quiet_title: 'Quiet Title Action',
  // Court Orders & Motions
  court_order: 'Court Order',
  temporary_order: 'Temporary Order',
  temporary_restraining_order: 'Temporary Restraining Order',
  preliminary_injunction: 'Preliminary Injunction',
  permanent_injunction: 'Permanent Injunction',
  motion: 'Motion / Petition',
  motion_for_contempt: 'Motion for Contempt',
  motion_to_compel: 'Motion to Compel',
  motion_for_summary_judgment: 'Motion for Summary Judgment',
  notice_of_hearing: 'Notice of Hearing',
  order_to_show_cause: 'Order to Show Cause',
  judgment: 'Judgment',
  default_judgment: 'Default Judgment',
  // Probate & Estate
  probate_petition: 'Probate Petition',
  letters_testamentary: 'Letters Testamentary',
  creditor_claim: 'Creditor Claim (Probate)',
  // Bankruptcy
  bankruptcy_notice: 'Bankruptcy Notice',
  adversary_proceeding: 'Adversary Proceeding',
  // Administrative
  demand_letter: 'Demand Letter',
  cease_and_desist: 'Cease & Desist',
  notice_of_deposition: 'Notice of Deposition',
  interrogatories: 'Interrogatories',
  request_for_production: 'Request for Production',
  request_for_admission: 'Request for Admission',
  // General
  civil: 'Civil Papers',
  writ: 'Writ',
  order: 'Court Order',
  notice: 'Notice',
  petition: 'Petition',
  levy: 'Levy',
  affidavit: 'Affidavit',
  declaration: 'Declaration',
  stipulation: 'Stipulation',
  other: 'Other',
};

function formatServiceType(val: string | undefined | null): string {
  if (!val) return '';
  return SERVICE_TYPE_LABELS[val] || val.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
}

function formatCallDuration(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return '00:00 (0.00h)';
  const totalSec = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  const clock = hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
  const decimalHours = (ms / 3600000).toFixed(2);
  return `${clock} (${decimalHours}h)`;
}

function formatDocumentType(val: string | undefined | null): string {
  if (!val) return '';
  return DOCUMENT_TYPE_LABELS[val] || val.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
}

export default function DispatchPage() {
  const { user } = useAuth();
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';
  const isGodMode = user?.role === 'admin'; // Admin God Mode — unrestricted access
  const unitModalTitleId = useId();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { subscribe } = useWebSocket();
  const isMobile = useIsMobile();
  const { prefs: userPrefs, reload: reloadPrefs } = useUserPreferences();
  const { districts, sections, sectionLabels, zoneLabels, zonesForSection, beatsForZone, getBeatLabel } = useDistrictOptions();
  const [calls, setCalls] = useState<CallForService[]>([]);
  const recentlyCreatedIdsRef = useRef<Set<string | number>>(new Set()); // synchronous dedup for POST + WS race
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedCall, setSelectedCall] = useState<CallForService | null>(null);
  const [filterTab, setFilterTab] = usePersistedTab('rmpg_dispatch_tab', 'all' as FilterTab, ['all', 'pending', 'active', 'cleared', 'archived', 'serve', 'mine'] as const);
  const [showNewCallModal, setShowNewCallModal] = useState(false);
  const [showQuickPsoModal, setShowQuickPsoModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [onSceneElapsed, setOnSceneElapsed] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  // Quick Dispatch templates
  const [templates, setTemplates] = useState<any[]>([]);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [templateInitialData, setTemplateInitialData] = useState<Record<string, any> | undefined>(undefined);
  // Quick Template Dialog — minimal address-only dispatch
  const [quickTemplateData, setQuickTemplateData] = useState<{ name: string; incident_type: string; priority: string; description: string; source: string } | null>(null);
  const [quickTemplateAddress, setQuickTemplateAddress] = useState('');
  const [quickTemplateCoords, setQuickTemplateCoords] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [quickTemplateSubmitting, setQuickTemplateSubmitting] = useState(false);
  const quickTemplateInputRef = useRef<HTMLInputElement>(null);
  // Linked incidents for the selected call
  const [linkedIncidents, setLinkedIncidents] = useState<any[]>([]);
  // Warning tags / caution alerts for selected call
  const [callWarnings, setCallWarnings] = useState<WarningTag[]>([]);
  // NCIC Query Panel
  const [showNcicPanel, setShowNcicPanel] = useState(false);
  const [detailTab, setDetailTab] = useState<'info' | 'persons' | 'timeline' | 'notes' | 'flags' | 'attachments' | 'audit'>('info');
  const [auditTrail, setAuditTrail] = useState<any[]>([]);
  const [auditTrailLoading, setAuditTrailLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; call: CallForService } | null>(null);
  const [ncicInitialQuery, setNcicInitialQuery] = useState<{ type: 'person' | 'vehicle' | 'warrant'; query: string } | null>(null);
  // Timeline / activity log entries for selected call
  const [activityEntries, setActivityEntries] = useState<any[]>([]);
  // Timeline editing (admin/manager only)
  const [editingTimestamp, setEditingTimestamp] = useState<string | null>(null);
  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);
  // Records connection search (person/vehicle lookup in edit mode)
  const [personSearchResults, setPersonSearchResults] = useState<any[]>([]);
  const [vehicleSearchResults, setVehicleSearchResults] = useState<any[]>([]);
  const [showPersonDropdown, setShowPersonDropdown] = useState(false);
  const [showVehicleDropdown, setShowVehicleDropdown] = useState(false);
  const personSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vehicleSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const personAbortRef = useRef<AbortController | null>(null);
  const vehicleAbortRef = useRef<AbortController | null>(null);
  const personDropdownRef = useRef<HTMLDivElement>(null);
  const vehicleDropdownRef = useRef<HTMLDivElement>(null);
  const [showCreatePersonModal, setShowCreatePersonModal] = useState(false);
  const [showCreateVehicleModal, setShowCreateVehicleModal] = useState(false);
  const [isCreatingRecord, setIsCreatingRecord] = useState(false);
  const [serveLink, setServeLink] = useState<any>(null);
  const [sendingToServe, setSendingToServe] = useState(false);
  const [serveRouteJobs, setServeRouteJobs] = useState<any[]>([]);
  const [serveRouteOrder, setServeRouteOrder] = useState<number[] | null>(null);
  // Map of call_id → serve_queue sort_order for route-based sorting
  const [serveRouteSortMap, setServeRouteSortMap] = useState<Record<string, number>>({});
  // AI Dispatch analysis state
  const [aiAnalyses, setAiAnalyses] = useState<Record<string, any>>({});
  const [showAiSidebar, setShowAiSidebar] = useState(false);

  // ── Feature 1: Call priority sound alerts ──
  const [soundAlertsMuted, setSoundAlertsMuted] = useState(() => localStorage.getItem('rmpg_sound_alerts_muted') === 'true');
  const soundAlertsMutedRef = useRef(soundAlertsMuted);
  useEffect(() => { soundAlertsMutedRef.current = soundAlertsMuted; }, [soundAlertsMuted]);
  const toggleSoundAlerts = useCallback(() => {
    setSoundAlertsMuted(prev => {
      const next = !prev;
      localStorage.setItem('rmpg_sound_alerts_muted', String(next));
      return next;
    });
  }, []);

  // ── Feature 5: Shift handoff notes ──
  const [showHandoffNotes, setShowHandoffNotes] = useState(false);
  const [handoffNotes, setHandoffNotes] = useState('');
  const [handoffMeta, setHandoffMeta] = useState<{ updated_by?: string; updated_at?: string }>({});
  const [savingHandoff, setSavingHandoff] = useState(false);

  const fetchHandoffNotes = useCallback(async () => {
    try {
      const data = await apiFetch<any>('/dispatch/shift-handoff');
      setHandoffNotes(data?.text || '');
      setHandoffMeta({ updated_by: data?.updated_by, updated_at: data?.updated_at });
    } catch { /* ignore */ }
  }, []);

  const saveHandoffNotes = useCallback(async () => {
    setSavingHandoff(true);
    try {
      await apiFetch('/dispatch/shift-handoff', { method: 'PUT', body: JSON.stringify({ text: handoffNotes }) });
      addToast('Handoff notes saved', 'success');
    } catch { addToast('Failed to save handoff notes', 'error'); }
    finally { setSavingHandoff(false); }
  }, [handoffNotes, addToast]);

  // Clean up search timers and abort controllers on unmount
  useEffect(() => {
    return () => {
      if (personSearchTimerRef.current) clearTimeout(personSearchTimerRef.current);
      if (vehicleSearchTimerRef.current) clearTimeout(vehicleSearchTimerRef.current);
      if (personAbortRef.current) personAbortRef.current.abort();
      if (vehicleAbortRef.current) vehicleAbortRef.current.abort();
    };
  }, []);

  // Close person/vehicle dropdowns on outside click
  useEffect(() => {
    if (!showPersonDropdown && !showVehicleDropdown) return;
    const handler = (e: MouseEvent) => {
      if (showPersonDropdown && personDropdownRef.current && !personDropdownRef.current.contains(e.target as Node)) setShowPersonDropdown(false);
      if (showVehicleDropdown && vehicleDropdownRef.current && !vehicleDropdownRef.current.contains(e.target as Node)) setShowVehicleDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPersonDropdown, showVehicleDropdown]);

  const searchPersons = useCallback((query: string) => {
    if (personSearchTimerRef.current) clearTimeout(personSearchTimerRef.current);
    if (personAbortRef.current) personAbortRef.current.abort();
    if (query.length < 2) { setPersonSearchResults([]); setShowPersonDropdown(false); return; }
    personSearchTimerRef.current = setTimeout(async () => {
      try {
        const controller = new AbortController();
        personAbortRef.current = controller;
        const results = await apiFetch<any[]>(`/records/persons/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        setPersonSearchResults(Array.isArray(results) ? results.slice(0, 10) : []);
        setShowPersonDropdown(true);
      } catch (e: any) {
        if (e?.name !== 'AbortError') setPersonSearchResults([]);
      }
    }, 300);
  }, []);

  const searchVehicles = useCallback((query: string) => {
    if (vehicleSearchTimerRef.current) clearTimeout(vehicleSearchTimerRef.current);
    if (vehicleAbortRef.current) vehicleAbortRef.current.abort();
    if (query.length < 2) { setVehicleSearchResults([]); setShowVehicleDropdown(false); return; }
    vehicleSearchTimerRef.current = setTimeout(async () => {
      try {
        const controller = new AbortController();
        vehicleAbortRef.current = controller;
        const results = await apiFetch<any[]>(`/records/vehicles/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        setVehicleSearchResults(Array.isArray(results) ? results.slice(0, 10) : []);
        setShowVehicleDropdown(true);
      } catch (e: any) {
        if (e?.name !== 'AbortError') setVehicleSearchResults([]);
      }
    }, 300);
  }, []);
  // ── Linked Persons / Vehicles on call ──
  const [callPersons, setCallPersons] = useState<any[]>([]);
  const [callVehicles, setCallVehicles] = useState<any[]>([]);
  const [linkPersonRole, setLinkPersonRole] = useState('involved');
  const [linkVehicleRole, setLinkVehicleRole] = useState('involved');

  const fetchCallPersons = useCallback(async (callId: string | number) => {
    try {
      const data = await apiFetch<any[]>(`/dispatch/calls/${callId}/persons`);
      setCallPersons(Array.isArray(data) ? data : []);
    } catch { setCallPersons([]); }
  }, []);

  const fetchCallVehicles = useCallback(async (callId: string | number) => {
    try {
      const data = await apiFetch<any[]>(`/dispatch/calls/${callId}/vehicles`);
      setCallVehicles(Array.isArray(data) ? data : []);
    } catch { setCallVehicles([]); }
  }, []);

  const linkPersonToCall = useCallback(async (callId: string | number, personId: string | number, role: string) => {
    try {
      await apiFetch(`/dispatch/calls/${callId}/persons`, {
        method: 'POST', body: JSON.stringify({ person_id: personId, role }),
      });
      fetchCallPersons(callId);
    } catch (err: any) {
      console.error('Link person error:', err);
    }
  }, [fetchCallPersons]);

  const unlinkPersonFromCall = useCallback(async (callId: string | number, linkId: string | number) => {
    try {
      await apiFetch(`/dispatch/calls/${callId}/persons/${linkId}`, { method: 'DELETE' });
      setCallPersons(prev => prev.filter(p => p.id !== linkId));
    } catch (err: any) {
      console.error('Unlink person error:', err);
    }
  }, []);

  const linkVehicleToCall = useCallback(async (callId: string | number, vehicleId: string | number, role: string) => {
    try {
      await apiFetch(`/dispatch/calls/${callId}/vehicles`, {
        method: 'POST', body: JSON.stringify({ vehicle_id: vehicleId, role }),
      });
      fetchCallVehicles(callId);
    } catch (err: any) {
      console.error('Link vehicle error:', err);
    }
  }, [fetchCallVehicles]);

  const unlinkVehicleFromCall = useCallback(async (callId: string | number, linkId: string | number) => {
    try {
      await apiFetch(`/dispatch/calls/${callId}/vehicles/${linkId}`, { method: 'DELETE' });
      setCallVehicles(prev => prev.filter(v => v.id !== linkId));
    } catch (err: any) {
      console.error('Unlink vehicle error:', err);
    }
  }, []);

  // Create new person from dispatch, auto-link to current call
  const handleCreatePersonFromDispatch = useCallback(async (data: PersonFormData) => {
    if (!selectedCall) return;
    setIsCreatingRecord(true);
    try {
      const result = await apiFetch<{ id: number }>('/records/persons', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      // Auto-link to current call
      await linkPersonToCall(selectedCall.id, result.id, linkPersonRole);
      // Update subject_description field
      const desc = `${data.last_name || ''}, ${data.first_name || ''}`.trim().replace(/^,\s*/, '').replace(/,\s*$/, '') + (data.dob ? ` DOB:${data.dob}` : '');
      setEditData(prev => ({ ...prev, subject_description: desc }));
      setShowCreatePersonModal(false);
      addToast('Person created and linked', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to create person', 'error');
    } finally {
      setIsCreatingRecord(false);
    }
  }, [selectedCall, linkPersonToCall, linkPersonRole, addToast]);

  // Create new vehicle from dispatch, auto-link to current call
  const handleCreateVehicleFromDispatch = useCallback(async (data: VehicleFormData) => {
    if (!selectedCall) return;
    setIsCreatingRecord(true);
    try {
      const result = await apiFetch<{ id: number }>('/records/vehicles', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      // Auto-link to current call
      await linkVehicleToCall(selectedCall.id, result.id, linkVehicleRole);
      // Update vehicle_description field
      const desc = [data.color, data.year, data.make, data.model].filter(Boolean).join(' ') + (data.plate_number ? ` PLT:${data.plate_number}` : '') + (data.state ? `/${data.state}` : '');
      setEditData(prev => ({ ...prev, vehicle_description: desc }));
      setShowCreateVehicleModal(false);
      addToast('Vehicle created and linked', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to create vehicle', 'error');
    } finally {
      setIsCreatingRecord(false);
    }
  }, [selectedCall, linkVehicleToCall, linkVehicleRole, addToast]);

  // Navigation guard — warn when editing unsaved changes
  useUnsavedChanges(isEditing);

  // ── Refs for unmount auto-save (avoids stale closures in cleanup) ──
  const callDetailRef = useRef<HTMLDivElement>(null);
  const isEditingRef = useRef(isEditing);
  const editDataRef = useRef(editData);
  const selectedCallRef = useRef(selectedCall);
  useEffect(() => { isEditingRef.current = isEditing; }, [isEditing]);
  useEffect(() => { editDataRef.current = editData; }, [editData]);
  useEffect(() => { selectedCallRef.current = selectedCall; }, [selectedCall]);

  // Close context menu on any click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // Fetch linked persons/vehicles when a call is selected
  useEffect(() => {
    if (selectedCall?.id) {
      fetchCallPersons(selectedCall.id);
      fetchCallVehicles(selectedCall.id);
    } else {
      setCallPersons([]);
      setCallVehicles([]);
    }
  }, [selectedCall?.id, fetchCallPersons, fetchCallVehicles]);

  // Auto-save unsaved call edits on component unmount (SPA navigation)
  useEffect(() => {
    return () => {
      if (!isEditingRef.current || !selectedCallRef.current) return;
      const token = localStorage.getItem('rmpg_token');
      const ed = editDataRef.current;
      const body: Record<string, any> = {
        incident_type: ed.incident_type,
        priority: ed.priority,
        client_id: ed.client_id || null,
        property_id: ed.property_id || null,
        caller_name: ed.caller_name,
        caller_phone: ed.caller_phone,
        caller_relationship: ed.caller_relationship,
        caller_address: ed.caller_address,
        location_address: ed.location,
        latitude: (ed.location !== selectedCallRef.current?.location && ed.latitude === selectedCallRef.current?.latitude) ? null : (ed.latitude ?? null),
        longitude: (ed.location !== selectedCallRef.current?.location && ed.longitude === selectedCallRef.current?.longitude) ? null : (ed.longitude ?? null),
        description: ed.description,
        source: ed.source,
        disposition: ed.disposition,
        cross_street: ed.cross_street,
        location_building: ed.location_building,
        location_floor: ed.location_floor,
        location_room: ed.location_room,
        zone_beat: ed.zone_beat,
        sector_id: ed.sector_id,
        zone_id: ed.zone_id,
        beat_id: ed.beat_id,
        weapons_involved: ed.weapons_involved,
        injuries_reported: ed.injuries_reported,
        num_subjects: ed.num_subjects ? Number(ed.num_subjects) : null,
        num_victims: ed.num_victims ? Number(ed.num_victims) : null,
        subject_description: ed.subject_description,
        vehicle_description: ed.vehicle_description,
        direction_of_travel: ed.direction_of_travel,
        scene_safety: ed.scene_safety,
        weather_conditions: ed.weather_conditions,
        lighting_conditions: ed.lighting_conditions,
        alcohol_involved: ed.alcohol_involved,
        drugs_involved: ed.drugs_involved,
        domestic_violence: ed.domestic_violence,
        supervisor_notified: ed.supervisor_notified,
        le_notified: ed.le_notified,
        le_agency: ed.le_agency,
        le_case_number: ed.le_case_number,
        damage_estimate: ed.damage_estimate ? Number(ed.damage_estimate) : null,
        damage_description: ed.damage_description,
        action_taken: ed.action_taken,
        responding_officer: ed.responding_officer,
        starting_mileage: ed.starting_mileage ? Number(ed.starting_mileage) : null,
        ending_mileage: ed.ending_mileage ? Number(ed.ending_mileage) : null,
      };
      try {
        fetch(`/api/dispatch/calls/${selectedCallRef.current.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
          keepalive: true,
        });
      } catch { /* best-effort */ }
    };
  }, []);

  const templateDropdownRef = useRef<HTMLDivElement>(null);
  // Unit attach dropdown
  const [showAttachUnitDropdown, setShowAttachUnitDropdown] = useState(false);
  const attachUnitDropdownRef = useRef<HTMLDivElement>(null);
  // Unit-management state + handlers (extracted to keep this component below the
  // 6,000-line ceiling). The hook owns: create/edit/delete-unit modal state and
  // the 5 unit API handlers (save, delete, assign, drag-assign, unassign).
  const {
    showCreateUnitModal, setShowCreateUnitModal,
    editingUnit, setEditingUnit,
    newUnitCallSign, setNewUnitCallSign,
    newUnitOfficerId, setNewUnitOfficerId,
    newUnitStatus, setNewUnitStatus,
    unitCreating,
    deletingUnit, setDeletingUnit,
    unitDeleting,
    openEditUnit,
    handleSaveUnit, handleDeleteUnit,
    handleAssignUnit, handleDragAssignUnit, handleUnassignUnit,
  } = useDispatchUnitActions({
    selectedCall, setSelectedCall,
    units, setCalls, setUnits,
    onAssignSuccess: () => setShowAttachUnitDropdown(false),
  });
  const [officers, setOfficers] = useState<{ id: string; full_name: string; badge_number?: string }[]>([]);
  // Disposition codes from admin config
  const [dispositionCodes, setDispositionCodes] = useState<{code: string; description: string; color?: string}[]>([]);
  // Map engine detection (ensure minimap knows whether to use Mapbox or MapLibre)
  const [mapEngine, setMapEngine] = useState<MapEngine | null>(getResolvedEngine);
  useEffect(() => { detectMapEngine().then(setMapEngine); }, []);
  // Mini-map visibility toggle
  const [showMiniMap, setShowMiniMap] = useState(true);
  // Route info from mini-map (for inline ETA display)
  const [routeInfo, setRouteInfo] = useState<{ unitCallSign: string; callNumber: string; eta: string; distance: string } | null>(null);
  // Clients list for client selector
  const [clientsList, setClientsList] = useState<{ id: string; name: string; contact_name: string; contact_phone: string; address: string }[]>([]);
  // Properties list for property selector (non-archived)
  const [propertiesList, setPropertiesList] = useState<{ id: string; name: string }[]>([]);

  // Close template dropdown on outside click
  useEffect(() => {
    if (!showTemplateDropdown) return;
    const handler = (e: MouseEvent) => {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target as Node)) {
        setShowTemplateDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTemplateDropdown]);

  // Close attach-unit dropdown on outside click
  useEffect(() => {
    if (!showAttachUnitDropdown) return;
    const handler = (e: MouseEvent) => {
      if (attachUnitDropdownRef.current && !attachUnitDropdownRef.current.contains(e.target as Node)) {
        setShowAttachUnitDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAttachUnitDropdown]);

  // Fetch calls and units on mount
  const fetchData = useCallback(async (options?: { silent?: boolean; signal?: AbortSignal }) => {
    const controller = options?.signal ? undefined : new AbortController();
    const signal = options?.signal || controller!.signal;
    const timeout = controller ? setTimeout(() => controller.abort(), 15000) : undefined;
    try {
      const [callsRes, unitsRes] = await Promise.all([
        apiFetch<any>('/dispatch/calls?limit=200', { signal }),
        apiFetch<any[]>('/dispatch/units', { signal }),
      ]);
      const callsRaw = Array.isArray(callsRes?.data) ? callsRes.data : Array.isArray(callsRes) ? callsRes : [];
      const mappedCalls = callsRaw.map(mapDbCall);
      const mappedUnits = (Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit);
      setCalls(mappedCalls);
      setUnits(mappedUnits);
      // If we had a selected call, update its reference
      setSelectedCall((prev) => {
        if (!prev) return mappedCalls[0] || null;
        const found = mappedCalls.find((c: CallForService) => c.id === prev.id);
        if (found) return found;
        // Call disappeared from the active list (transient: e.g. WS race,
        // backend filter hiccup, brief archive-and-unarchive). Don't auto-
        // substitute a different call when the user is mid-edit — that
        // change would flip selectedCall.id, fire the cleanup useEffect,
        // and kill their edit form mid-keystroke. Keep current call until
        // they explicitly navigate away.
        if (isEditingRef.current) return prev;
        return mappedCalls[0] || null;
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        if (!options?.silent) addToast('Dispatch data request timed out — retrying may help', 'error');
        return;
      }
      if (!options?.silent) {
        console.error('Failed to load dispatch data:', err);
        addToast('Failed to load dispatch data — check connection', 'error');
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      if (!options?.silent) setIsLoading(false);
    }
  }, [addToast]);

  // Load archived calls when the Archive tab is activated
  const [archivedCalls, setArchivedCalls] = useState<CallForService[]>([]);
  const [archivedLoaded, setArchivedLoaded] = useState(false);

  const fetchArchivedCalls = useCallback(async () => {
    try {
      const res = await apiFetch<any>('/dispatch/calls?archived=true&limit=500');
      const archivedRaw = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      const mapped = archivedRaw.map(mapDbCall);
      setArchivedCalls(mapped);
      setArchivedLoaded(true);
    } catch (err) {
      console.error('Failed to load archived calls:', err);
      addToast('Failed to load archived calls', 'error');
    }
  }, [addToast]);

  useEffect(() => {
    fetchData();
    // Fetch quick dispatch templates
    apiFetch<any[]>('/admin/call-templates')
      .then((data) => setTemplates((data || []).filter((t: any) => t.is_active !== 0)))
      .catch(() => { /* silent — template dropdown just stays empty */ });
    // Fetch disposition codes from admin config
    apiFetch('/admin/config').then((cfg: any) => {
      const disps = (cfg.dispositions || [])
        .filter((d: any) => d.is_active)
        .map((d: any) => {
          try { return JSON.parse(d.config_value); } catch { return null; }
        })
        .filter(Boolean);
      setDispositionCodes(disps);
    }).catch((err) => { console.warn('[DispatchPage] fetch disposition codes failed:', err); });
    // Fetch clients list for client selector
    apiFetch<any[]>('/admin/clients')
      .then((data) => setClientsList((Array.isArray(data) ? data : []).filter((c: any) => c.status === 'active').map((c: any) => ({ id: String(c.id), name: c.name, contact_name: c.contact_name || '', contact_phone: c.contact_phone || '', address: c.address || '' }))))
      .catch((err) => { console.warn('[DispatchPage] fetch clients list failed:', err); });
    // Fetch properties list (non-archived) for property selector
    apiFetch<any[]>('/records/properties')
      .then((data) => setPropertiesList((Array.isArray(data) ? data : []).map((p: any) => ({ id: String(p.id), name: p.name }))))
      .catch((err) => { console.warn('[DispatchPage] fetch properties list failed:', err); });
  }, [fetchData]);

  // Live sync — auto-refresh when any device modifies dispatch data (silent to avoid unmounting UI)
  const silentRefresh = useCallback(() => fetchData({ silent: true }), [fetchData]);
  useLiveSync('dispatch', silentRefresh);

  // Call-lifecycle state + handlers (extracted to keep this component below the
  // 6,500-line ceiling). The hook owns: 6 transient state items (delete/disposition/
  // mileage prompts, isGenerating, isBulkArchiving) and the 14 call-mutation
  // handlers (status transitions, hold/resume/revert, clear-with-disposition,
  // archive/unarchive/bulk-archive, delete, priority, LE-notify, gen-incident).
  const {
    deleteCallTarget, setDeleteCallTarget,
    isDeletingCall,
    dispositionPromptCallId, setDispositionPromptCallId,
    isGenerating,
    isBulkArchiving,
    handleStatusChange,
    handleHoldCall, handleResumeCall, handleRevertStatus,
    handleClearWithDisposition, handleConfirmClear,
    handleArchive, handleUnarchive, handleBulkArchive,
    handleDeleteAnyCall,
    handlePriorityChange, handleLeNotify, handleGenerateIncident,
  } = useDispatchCallActions({
    selectedCall, setSelectedCall, setCalls, setArchivedCalls,
    setUnits, setArchivedLoaded, refetchAll: silentRefresh,
  });

  // Notes + timeline state + handlers (extracted alongside the unit/call
  // hooks). Owns 9 state items (note input + inline-edit, timeline input
  // + inline-edit, broadcast composer) and 8 handlers.
  const {
    newNote, setNewNote,
    editingNoteId, setEditingNoteId,
    editingNoteText, setEditingNoteText,
    newTimelineText, setNewTimelineText,
    showAddTimeline, setShowAddTimeline,
    editingTimelineId, setEditingTimelineId,
    editTimelineText, setEditTimelineText,
    broadcastNoteText, setBroadcastNoteText,
    isBroadcasting,
    handleAddNote, handleEditNote, handleDeleteNote,
    handleQuickNote, handleBroadcastNote,
    handleAddTimeline, handleEditTimeline, handleDeleteTimeline,
  } = useDispatchNotesActions({
    selectedCall, setSelectedCall, calls, setCalls, setActivityEntries,
  });

  // Multi-unit dispatch state + handlers (closest-unit lookup, auto-assign,
  // multi-unit dispatch, call transfer). Cleanest cluster yet — every handler
  // takes callId as an explicit param so the hook signature stays narrow.
  const {
    multiSelectUnits, setMultiSelectUnits,
    handleSuggestClosestUnit,
    handleAutoAssign,
    handleMultiUnitDispatch,
    handleTransferCall,
  } = useDispatchMultiUnitActions({ setCalls, setSelectedCall, setUnits });

  // ── WebSocket: real-time dispatch updates & panic auto-dispatch ──
  useEffect(() => {
    // Listen for new calls (including panic-auto-created calls)
    const unsubDispatch = subscribe('dispatch_update', (msg: any) => {
      try {
      const data = msg.data || msg;
      if (data.action === 'call_created' && data.call) {
        const mapped = mapDbCall(data.call);
        // Synchronous dedup: if this call was just added from POST response, skip
        if (recentlyCreatedIdsRef.current.has(mapped.id)) {
          recentlyCreatedIdsRef.current.delete(mapped.id);
          // Still handle panic auto-select below, but don't add duplicate
        } else {
          setCalls((prev) => {
            if (prev.some((c) => c.id === mapped.id)) return prev;
            return [mapped, ...prev];
          });
        }
        // Feature 1: Priority-based sound alerts (unless muted)
        if (!soundAlertsMutedRef.current) {
          if (mapped.priority === 'P1') playTone('alarm');
          else if (mapped.priority === 'P2') playTone('warning');
          else playTone('info');
        }
        // Voice alerts: announce new call with details + safety flags
        announceNewCall(mapped);
        announceCallAlerts(mapped);

        // If it's a panic call, auto-select it so the dispatch card opens immediately
        if (data.call.source === 'panic') {
          setSelectedCall(mapped);
          addToast('PANIC — Officer Assist call auto-created', 'error', 10000);
          announcePanicAlert();
        }
      } else if (data.action === 'call_updated' && data.call) {
        const mapped = mapDbCall(data.call);
        // Detect priority escalation before updating state
        const prevCall = calls.find((c: any) => c.id === mapped.id);
        if (prevCall && prevCall.priority !== mapped.priority) {
          const priorities = ['P1', 'P2', 'P3', 'P4'];
          if (priorities.indexOf(mapped.priority) < priorities.indexOf(prevCall.priority)) {
            announceEscalation(mapped.call_number, prevCall.priority, mapped.priority);
          }
        }
        setCalls((prev) => prev.map((c) => (c.id === mapped.id ? mapped : c)));
        // Update selected call if it's the one being viewed
        setSelectedCall((prev) => (prev?.id === mapped.id ? mapped : prev));
        // Voice alert: announce update if notes were added
        if (data.update_type === 'note_added') {
          // Check for @mentions in the note text
          const noteText = data.note_text || '';
          const mentionMatch = noteText.match(/@(\w+)/);
          if (mentionMatch) {
            announceDirectedNote(mentionMatch[0], mapped.call_number, noteText, data.author);
          } else {
            announceCallUpdate(mapped.call_number, 'New note added', data.author);
          }
        }
      } else if (data.action === 'call_status_changed' && data.call) {
        const mapped = mapDbCall(data.call);
        setCalls((prev) => prev.map((c) => (c.id === mapped.id ? mapped : c)));
        setSelectedCall((prev) => (prev?.id === mapped.id ? mapped : prev));
        // Voice alert: announce dispatch event when call dispatched
        if (mapped.status === 'dispatched') {
          announceDispatchEvent(mapped);
        }
        // Voice alert: announce archival with summary
        if (mapped.status === 'archived') {
          const responseMin = mapped.created_at && mapped.onscene_at
            ? Math.floor((new Date(mapped.onscene_at).getTime() - new Date(mapped.created_at).getTime()) / 60000)
            : undefined;
          announceCallArchived(mapped.call_number, mapped.disposition, responseMin);
        }
        // Voice alert: announce status changes (on scene, cleared, etc.)
        if (['onscene', 'enroute', 'cleared'].includes(mapped.status) && mapped.assigned_units?.length > 0) {
          announceStatusChange({
            call_sign: mapped.assigned_units[0],
            call_number: mapped.call_number,
            location: mapped.location,
            disposition: mapped.disposition,
            assigned_units: mapped.assigned_units,
          }, mapped.status);
        }
      } else if (data.action === 'units_dispatched' || data.action === 'unit_assigned' || data.action === 'unit_unassigned') {
        // Voice alert: announce unit assignment
        if (data.action === 'unit_assigned' && data.unit_call_sign && data.call_number) {
          announceUnitAssignment(data.unit_call_sign, data.call_number);
        }
        // Voice alert: announce multi-unit dispatch (2+ units assigned at once)
        if (data.action === 'units_dispatched' && data.unit_call_signs?.length >= 2 && data.call_number) {
          const unitList = data.unit_call_signs.join(' and ');
          announceCallUpdate(data.call_number, `Multiple units dispatched: ${unitList}`);
        }
        // Refresh the full list to keep unit assignments in sync
        fetchData({ silent: true });
      } else if (data.action === 'ai_analysis' && data.call_id && data.analysis) {
        setAiAnalyses(prev => ({ ...prev, [data.call_id]: data.analysis }));
        setShowAiSidebar(true);
      }
      } catch (err) {
        console.error('[Dispatch] Error processing WS dispatch_update:', err);
        // Fallback: full refresh to recover from malformed data
        fetchData({ silent: true });
      }
    });

    // Listen for unit updates (status changes, new units, deletions)
    const unsubUnit = subscribe('unit_update', (msg: any) => {
      const data = msg.data || msg;
      if (data.action === 'unit_status_changed' && data.unit) {
        setUnits((prev) => prev.map((u) => (String(u.id) === String(data.unit.id) ? { ...u, ...data.unit, id: String(data.unit.id) } : u)));
      } else if (data.action === 'unit_position_update' && data.unit) {
        // Update unit position + speed_mph from GPS broadcast
        setUnits((prev) => prev.map((u) => (String(u.id) === String(data.unit.id)
          ? { ...u, latitude: data.unit.latitude, longitude: data.unit.longitude, speed_mph: data.unit.speed_mph }
          : u)));
      } else if (data.action === 'unit_updated' && data.unit) {
        setUnits((prev) => prev.map((u) => (String(u.id) === String(data.unit.id) ? { ...u, ...data.unit, id: String(data.unit.id) } : u)));
      } else if (data.action === 'unit_created' && data.unit) {
        setUnits((prev) => {
          if (prev.some((u) => String(u.id) === String(data.unit.id))) return prev;
          return [...prev, mapDbUnit(data.unit)];
        });
      } else if (data.action === 'unit_deleted' && data.unit_id) {
        setUnits((prev) => prev.filter((u) => String(u.id) !== String(data.unit_id)));
      }
    });

    // Listen for panic alerts — play alarm tone + voice alert, switch to active tab
    const unsubPanic = subscribe('panic_alert', (msg: any) => {
      const data = msg.data || msg;
      setFilterTab('active');
      announcePanicAlert(data.user_name || data.userName);
    });

    // Listen for serve queue events — update gold serve status panel in real time
    const unsubServeCreated = subscribe('serve:created', (msg: any) => {
      const data = msg.data || msg;
      if (data?.call_id && selectedCallRef.current?.id === data.call_id) {
        setServeLink(data);
      }
      // Voice alert: announce return visit scheduled
      if (data?.call_number && data?.attempt_number && data.attempt_number > 1) {
        announceReturnVisit(data.call_number, data.attempt_number, data.next_window);
      }
    });
    const unsubServeAttempt = subscribe('serve:attempt', (msg: any) => {
      const data = msg.data || msg;
      if (data?.call_id && selectedCallRef.current?.id === data.call_id) {
        // Refresh serve link to get updated attempt count + status
        const callId = selectedCallRef.current!.id;
        apiFetch(`/dispatch/calls/${callId}/serve-link`).then((res: any) => {
          if (res) setServeLink(res);
        }).catch(() => {});
      }
      // Voice alert: announce serve completion
      if (data?.result && data?.served_to && data?.call_number) {
        announceServeComplete(
          data.served_to,
          data.address || '',
          data.document_type || '',
          data.attempt_number || 1,
          data.result,
        );
      }
    });

    // Listen for warrant alerts on linked persons
    const unsubWarrant = subscribe('call:warrant_alert', (msg: any) => {
      const data = msg.data || msg;
      addToast(`⚠️ WARRANT ALERT: ${data.personName} — ${data.warrantCount} active warrant(s) on call`, 'error');
      // Refresh data so warrant badges appear immediately
      fetchData({ silent: true });
    });

    const unsubSpeed = subscribe('speed:alert', (msg: any) => {
      const data = msg.data || msg;
      if (data?.unit && data?.speed_mph) {
        const severity = data.severity === 'critical' ? 'error' : 'warning';
        addToast(`🚨 ${data.label || 'SPEED ALERT'}: Unit ${data.unit} at ${data.speed_mph} mph${data.current_call_number ? ` on ${data.current_call_number}` : ''}`, severity);
        announceSpeedAdvisory(data.unit, data.speed_mph);
      }
    });

    return () => { unsubDispatch(); unsubUnit(); unsubPanic(); unsubServeCreated(); unsubServeAttempt(); unsubWarrant(); unsubSpeed(); };
  }, [subscribe, fetchData, addToast, setFilterTab]);

  // On-scene live timer — updates every second when the selected call has onscene_at and is not cleared
  useEffect(() => {
    if (!selectedCall?.onscene_at || ['cleared', 'closed', 'cancelled', 'archived'].includes(selectedCall.status)) {
      setOnSceneElapsed('');
      return;
    }
    const update = () => {
      const diff = Date.now() - new Date(selectedCall.onscene_at!).getTime();
      if (diff < 0) { setOnSceneElapsed(''); return; }
      const totalSec = Math.floor(diff / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      setOnSceneElapsed(h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`);
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [selectedCall?.id, selectedCall?.onscene_at, selectedCall?.status]);

  // When switching to the archived tab, fetch archived calls if not loaded
  useEffect(() => {
    if (filterTab === 'archived' && !archivedLoaded) {
      fetchArchivedCalls();
    }
  }, [filterTab, archivedLoaded, fetchArchivedCalls]);

  // (Template fetch consolidated into the main init useEffect above — line 296)

  // Fetch all active personnel for unit assignment dropdown (any role)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<any>('/personnel?status=active');
        if (cancelled) return;
        const list = Array.isArray(res) ? res : res?.data ?? [];
        setOfficers(list.map((u: any) => ({
          id: String(u.id),
          full_name: u.full_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username,
          badge_number: u.badge_number,
        })));
      } catch {
        // Silently ignore — personnel list is optional
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Lazy-fetch audit trail only when the Audit tab opens for this call
  useEffect(() => {
    if (!selectedCall || detailTab !== 'audit') return;
    let cancelled = false;
    setAuditTrailLoading(true);
    apiFetch<any>(`/dispatch/calls/${selectedCall.id}/audit-trail`)
      .then(res => { if (!cancelled) setAuditTrail(Array.isArray(res?.events) ? res.events : []); })
      .catch(() => { if (!cancelled) setAuditTrail([]); })
      .finally(() => { if (!cancelled) setAuditTrailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedCall?.id, detailTab]);

  // Fetch linked incidents and activity when a call is selected
  useEffect(() => {
    if (!selectedCall) { setLinkedIncidents([]); setActivityEntries([]); setCallWarnings([]); setServeLink(null); setAuditTrail([]); return; }
    let cancelled = false;
    setIsEditing(false);
    setShowAttachUnitDropdown(false);
    setNewNote('');
    setNewTimelineText('');
    setShowAddTimeline(false);
    (async () => {
      try {
        const res = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`);
        if (cancelled) return;
        const incidents = res?.related_incidents ?? res?.incidents ?? [];
        setLinkedIncidents(Array.isArray(incidents) ? incidents : []);
        const activity = res?.activity ?? [];
        setActivityEntries(Array.isArray(activity) ? activity : []);
      } catch {
        if (!cancelled) { setLinkedIncidents([]); setActivityEntries([]); }
      }
      try {
        const warnings = await apiFetch<WarningTag[]>(`/dispatch/calls/${selectedCall.id}/warnings`);
        if (!cancelled) setCallWarnings(Array.isArray(warnings) ? warnings.filter((w: any) => typeof w?.label === 'string') : []);
      } catch { if (!cancelled) setCallWarnings([]); }
      // Fetch serve queue link for PSO calls
      if (selectedCall.incident_type === 'pso_client_request') {
        try {
          const serveData = await apiFetch(`/dispatch/calls/${selectedCall.id}/serve-link`);
          if (!cancelled) setServeLink(serveData);
        } catch { if (!cancelled) setServeLink(null); }
        // Fetch serve route data for mini map overlay
        try {
          const routeData = await apiFetch<{ jobs: any[]; routes: any[] }>('/process-server/active-routes');
          if (!cancelled && routeData?.jobs) {
            // Filter to jobs assigned to the same officer as this call
            const callOfficerId = selectedCall.assigned_units?.length ? parseInt(String(selectedCall.assigned_units[0]), 10) : null;
            const officerJobs = callOfficerId ? routeData.jobs.filter((j: any) => j.officer_id === callOfficerId) : routeData.jobs;
            setServeRouteJobs(officerJobs);
            // Get route order
            const route = callOfficerId ? routeData.routes.find((r: any) => r.officer_id === callOfficerId) : routeData.routes[0];
            if (route?.optimized_order_json) {
              try { setServeRouteOrder(JSON.parse(route.optimized_order_json)); } catch { setServeRouteOrder(null); }
            } else {
              setServeRouteOrder(null);
            }
          }
        } catch { if (!cancelled) { setServeRouteJobs([]); setServeRouteOrder(null); } }
      } else {
        if (!cancelled) { setServeLink(null); setServeRouteJobs([]); setServeRouteOrder(null); }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedCall?.id]);

  // PSO incident types — must be declared before filteredCalls which references it
  const PSO_INCIDENT_TYPES = ['pso_client_request'];

  // Fetch serve route sort order on mount and when serve tab is active
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<{ jobs: any[]; routes: any[] }>('/process-server/active-routes');
        if (cancelled || !data?.jobs) return;
        const sortMap: Record<string, number> = {};
        // Build a map: call_id → sort_order based on route order
        for (const route of (data.routes || [])) {
          if (!route.optimized_order_json) continue;
          try {
            const orderIds: number[] = JSON.parse(route.optimized_order_json);
            const officerJobs = data.jobs.filter((j: any) => j.officer_id === route.officer_id);
            const jobMap = new Map(officerJobs.map((j: any) => [j.id, j]));
            orderIds.forEach((id, idx) => {
              const job = jobMap.get(id);
              if (job?.call_id) sortMap[String(job.call_id)] = idx;
            });
          } catch { /* skip malformed JSON */ }
        }
        // Fallback: jobs without explicit route order use sort_order
        for (const job of data.jobs) {
          if (job.call_id && !(String(job.call_id) in sortMap)) {
            sortMap[String(job.call_id)] = job.sort_order ?? 9999;
          }
        }
        if (!cancelled) setServeRouteSortMap(sortMap);
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [filterTab]);

  // Filter calls (defined before keyboard shortcuts so it's available)
  // Active calls (non-archived) are in `calls`, archived calls are in `archivedCalls`
  const filteredCalls = useMemo(() => (filterTab === 'archived' ? archivedCalls : calls).filter((call) => {
    switch (filterTab) {
      case 'pending': return call.status === 'pending';
      case 'active': return ['dispatched', 'enroute', 'onscene', 'on_hold'].includes(call.status);
      case 'cleared': return ['cleared', 'closed', 'cancelled'].includes(call.status);
      case 'archived': return true; // archivedCalls already filtered
      case 'serve': return PSO_INCIDENT_TYPES.includes(call.incident_type); // Show ALL PSO calls (active + cleared/on_hold for return visits)
      case 'mine': {
        const myId = user?.id != null ? String(user.id) : null;
        if (!myId) return false;
        return String((call as any).dispatcher_id ?? (call as any).created_by ?? '') === myId;
      }
      default: return true; // `calls` already excludes archived from backend
    }
  }).filter((call) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (call.call_number || '').toLowerCase().includes(q) ||
      (call.location || '').toLowerCase().includes(q) ||
      (call.incident_type || '').toLowerCase().includes(q) ||
      (call.description || '').toLowerCase().includes(q) ||
      (call.caller_name || '').toLowerCase().includes(q)
    );
  }).filter((call) => {
    // Show cleared calls in 'all' tab if user preference is enabled
    if (filterTab === 'all' && userPrefs?.dispatch_show_cleared) return true;
    if (filterTab === 'all' && ['cleared', 'closed', 'cancelled'].includes(call.status)) return false;
    return true;
  }).sort((a, b) => {
    // Archive tab: sort by call number ascending (001, 002, 003...)
    if (filterTab === 'archived') {
      return (a.call_number || '').localeCompare(b.call_number || '', undefined, { numeric: true });
    }
    // Serve tab: sort by route order (sort_order from serve_queue)
    if (filterTab === 'serve') {
      const aOrder = serveRouteSortMap[a.id] ?? 9999;
      const bOrder = serveRouteSortMap[b.id] ?? 9999;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Fallback: priority then time for unordered serve calls
      const pOrder: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };
      const pDiff = (pOrder[a.priority] ?? 3) - (pOrder[b.priority] ?? 3);
      if (pDiff !== 0) return pDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    // Pinned calls float to the top regardless of sort mode
    const aPin = a.pinned ? 1 : 0;
    const bPin = b.pinned ? 1 : 0;
    if (aPin !== bPin) return bPin - aPin;
    // User-selectable sort for active tabs
    const sortMode = userPrefs?.dispatch_sort || 'priority';
    if (sortMode === 'time') {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    if (sortMode === 'status') {
      const sOrder: Record<string, number> = { dispatched: 0, enroute: 1, onscene: 2, pending: 3, on_hold: 4, cleared: 5, closed: 6, cancelled: 7 };
      const sDiff = (sOrder[a.status] ?? 5) - (sOrder[b.status] ?? 5);
      if (sDiff !== 0) return sDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    // Default: priority then newest first
    const pOrder: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };
    const pDiff = (pOrder[a.priority] ?? 3) - (pOrder[b.priority] ?? 3);
    if (pDiff !== 0) return pDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  }), [calls, archivedCalls, filterTab, searchQuery, userPrefs?.dispatch_sort, userPrefs?.dispatch_show_cleared, user?.id, serveRouteSortMap]);

  // Keyboard shortcuts for dispatch power users — Spillman Flex F-key style
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

      // ── F-KEY HOTKEYS (always active, even in inputs) ─────
      // These mirror Spillman Flex keyboard shortcuts
      if (e.key === 'F2') {
        e.preventDefault();
        setShowNewCallModal(true);
        return;
      }
      if (e.key === 'F3' && selectedCall && selectedCall.status === 'pending') {
        e.preventDefault();
        handleStatusChange(selectedCall.id, 'dispatched');
        return;
      }
      if (e.key === 'F4' && selectedCall) {
        e.preventDefault();
        // Toggle edit mode on selected call
        setIsEditing(prev => !prev);
        return;
      }
      if (e.key === 'F5') {
        e.preventDefault();
        if (selectedCall && selectedCall.status === 'dispatched') {
          handleStatusChange(selectedCall.id, 'enroute');
        } else {
          fetchData(); // Refresh if no enroute action available
        }
        return;
      }
      if (e.key === 'F6' && selectedCall && selectedCall.status === 'enroute') {
        e.preventDefault();
        handleStatusChange(selectedCall.id, 'onscene');
        return;
      }
      if (e.key === 'F7' && selectedCall && ['dispatched', 'enroute', 'onscene'].includes(selectedCall.status)) {
        e.preventDefault();
        handleClearWithDisposition(selectedCall.id);
        return;
      }
      // Shift+C — quick clear on selected call (mirrors F7, faster muscle memory)
      if (e.shiftKey && (e.key === 'C' || e.key === 'c') && selectedCall && ['dispatched', 'enroute', 'onscene'].includes(selectedCall.status)) {
        e.preventDefault();
        handleClearWithDisposition(selectedCall.id);
        return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        // Focus CAD command line
        const cadInput = document.querySelector('[data-cad-input]') as HTMLInputElement;
        if (cadInput) cadInput.focus();
        return;
      }
      if (e.key === 'F9' && selectedCall && ['pending', 'dispatched', 'enroute', 'onscene'].includes(selectedCall.status)) {
        e.preventDefault();
        handleHoldCall(selectedCall.id);
        return;
      }
      if (e.key === 'F10') {
        e.preventDefault();
        setShowQuickPsoModal(true);
        return;
      }
      if (e.key === 'F12') {
        e.preventDefault();
        // Toggle NCIC panel
        setShowNcicPanel(prev => !prev);
        return;
      }

      // Don't process letter keys when typing in inputs
      if (isInput) return;

      // N - New call
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setShowNewCallModal(true);
        return;
      }

      // P - Quick PSO Client Request
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        setShowQuickPsoModal(true);
        return;
      }

      // R - Refresh
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        fetchData();
        return;
      }

      // 1-6: Filter tabs
      if (e.key === '1') { setFilterTab('all'); return; }
      if (e.key === '2') { setFilterTab('pending'); return; }
      if (e.key === '3') { setFilterTab('active'); return; }
      if (e.key === '4') { setFilterTab('cleared'); return; }
      if (e.key === '5') { setFilterTab('archived'); return; }
      if (e.key === '6') { setFilterTab('serve'); return; }

      // Arrow keys: navigate call list
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const currentIndex = filteredCalls.findIndex(c => c.id === selectedCall?.id);
        const nextIndex = Math.min(currentIndex + 1, filteredCalls.length - 1);
        if (filteredCalls[nextIndex]) setSelectedCall(filteredCalls[nextIndex]);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const currentIndex = filteredCalls.findIndex(c => c.id === selectedCall?.id);
        const prevIndex = Math.max(currentIndex - 1, 0);
        if (filteredCalls[prevIndex]) setSelectedCall(filteredCalls[prevIndex]);
        return;
      }

      // D - Dispatch selected call
      if ((e.key === 'd' || e.key === 'D') && selectedCall && selectedCall.status === 'pending') {
        e.preventDefault();
        handleStatusChange(selectedCall.id, 'dispatched');
        return;
      }

      // E - Enroute
      if ((e.key === 'e' || e.key === 'E') && selectedCall && selectedCall.status === 'dispatched') {
        e.preventDefault();
        handleStatusChange(selectedCall.id, 'enroute');
        return;
      }

      // O - On scene
      if ((e.key === 'o' || e.key === 'O') && selectedCall && selectedCall.status === 'enroute') {
        e.preventDefault();
        handleStatusChange(selectedCall.id, 'onscene');
        return;
      }

      // C - Clear call (opens disposition prompt)
      if ((e.key === 'c' || e.key === 'C') && selectedCall && ['dispatched', 'enroute', 'onscene'].includes(selectedCall.status)) {
        e.preventDefault();
        handleClearWithDisposition(selectedCall.id);
        return;
      }

      // H - Hold call
      if ((e.key === 'h' || e.key === 'H') && selectedCall && ['pending', 'dispatched', 'enroute', 'onscene'].includes(selectedCall.status)) {
        e.preventDefault();
        handleHoldCall(selectedCall.id);
        return;
      }

      // Escape - close modal
      if (e.key === 'Escape') {
        setShowNewCallModal(false);
        setShowQuickPsoModal(false);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCall, filteredCalls, fetchData, setFilterTab]);

  const handlePsoExpandToFullForm = (data: Record<string, any>) => {
    setShowQuickPsoModal(false);
    setTemplateInitialData({
      ...data,
      incident_type: data.incident_type || 'pso_client_request',
    });
    setShowNewCallModal(true);
  };

  const handleNewCall = async (callData: Partial<CallForService> & Record<string, any>) => {
    setIsSaving(true);
    try {
      const body = {
        incident_type: callData.incident_type || 'other',
        priority: callData.priority || 'P3',
        caller_name: callData.caller_name || null,
        caller_phone: callData.caller_phone || null,
        caller_relationship: callData.caller_relationship || null,
        caller_address: callData.caller_address || null,
        location_address: callData.location || '',
        latitude: callData.latitude ?? null,
        longitude: callData.longitude ?? null,
        property_id: callData.property_id ?? null,
        client_id: callData.client_id ?? null,
        description: callData.description || '',
        source: callData.source || 'phone',
        cross_street: callData.cross_street || null,
        location_building: callData.location_building || null,
        location_floor: callData.location_floor || null,
        location_room: callData.location_room || null,
        zone_beat: callData.zone_beat || null,
        sector_id: callData.sector_id ?? null,
        zone_id: callData.zone_id ?? null,
        beat_id: callData.beat_id ?? null,
        weapons_involved: callData.weapons_involved || null,
        injuries_reported: callData.injuries_reported ?? false,
        num_subjects: callData.num_subjects ?? null,
        num_victims: callData.num_victims ?? null,
        subject_description: callData.subject_description || null,
        vehicle_description: callData.vehicle_description || null,
        direction_of_travel: callData.direction_of_travel || null,
        scene_safety: callData.scene_safety || null,
        weather_conditions: callData.weather_conditions || null,
        lighting_conditions: callData.lighting_conditions || null,
        alcohol_involved: callData.alcohol_involved ?? false,
        drugs_involved: callData.drugs_involved ?? false,
        domestic_violence: callData.domestic_violence ?? false,
        supervisor_notified: callData.supervisor_notified ?? false,
        le_notified: callData.le_notified ?? false,
        le_agency: callData.le_agency || null,
        le_case_number: callData.le_case_number || null,
        damage_estimate: callData.damage_estimate ?? null,
        damage_description: callData.damage_description || null,
        responding_officer: callData.responding_officer || null,
        action_taken: callData.action_taken || null,
        // Extended operational flags — previously silent-dropped from new-call POST (audit 2026-04-10)
        mental_health_crisis: callData.mental_health_crisis ?? false,
        juvenile_involved: callData.juvenile_involved ?? false,
        felony_in_progress: callData.felony_in_progress ?? false,
        officer_safety_caution: callData.officer_safety_caution ?? false,
        k9_requested: callData.k9_requested ?? false,
        ems_requested: callData.ems_requested ?? false,
        fire_requested: callData.fire_requested ?? false,
        hazmat: callData.hazmat ?? false,
        gang_related: callData.gang_related ?? false,
        evidence_collected: callData.evidence_collected ?? false,
        body_camera_active: callData.body_camera_active ?? false,
        photos_taken: callData.photos_taken ?? false,
        trespass_issued: callData.trespass_issued ?? false,
        vehicle_pursuit: callData.vehicle_pursuit ?? false,
        foot_pursuit: callData.foot_pursuit ?? false,
        // PSO Client Request fields
        contract_id: callData.contract_id || null,
        pso_service_type: callData.pso_service_type || null,
        pso_authorization: callData.pso_authorization || null,
        pso_requestor_name: callData.pso_requestor_name || null,
        pso_requestor_phone: callData.pso_requestor_phone || null,
        pso_requestor_email: callData.pso_requestor_email || null,
        pso_billing_code: callData.pso_billing_code || null,
        // Process Service sub-fields
        process_service_type: callData.process_service_type || null,
        process_served_to: callData.process_served_to || null,
        process_served_address: callData.process_served_address || null,
        // Historical entry fields (passed through from NewCallModal)
        ...(callData.created_at ? { created_at: callData.created_at } : {}),
        ...(callData.status && callData.status !== 'pending' ? { status: callData.status } : {}),
        ...(callData.disposition ? { disposition: callData.disposition } : {}),
        ...(callData.dispatched_at ? { dispatched_at: callData.dispatched_at } : {}),
        ...(callData.enroute_at ? { enroute_at: callData.enroute_at } : {}),
        ...(callData.onscene_at ? { onscene_at: callData.onscene_at } : {}),
        ...(callData.cleared_at ? { cleared_at: callData.cleared_at } : {}),
        ...(callData.closed_at ? { closed_at: callData.closed_at } : {}),
      };
      const result = await apiFetch<any>('/dispatch/calls', { method: 'POST', body: JSON.stringify(body) });
      const newCall = mapDbCall(result);
      // Mark as recently-created so WebSocket handler skips the duplicate
      recentlyCreatedIdsRef.current.add(newCall.id);
      setTimeout(() => recentlyCreatedIdsRef.current.delete(newCall.id), 5000); // cleanup after 5s
      setCalls((prev) => [newCall, ...prev]);
      setSelectedCall(newCall);
      setShowNewCallModal(false);
      setTemplateInitialData(undefined);
      addToast(`Call ${newCall.call_number} created`, 'success');
      // Audible feedback for local action
      announceLocalAction('call_created', `Call ${newCall.call_number} created.`);
    } catch (err: any) {
      console.error('Failed to create call:', err);
      addToast(err?.message || 'Failed to create call', 'error');
      throw err; // Re-throw so NewCallModal knows submission failed
    } finally {
      setIsSaving(false);
    }
  };

  // ── Admin timeline edit handler ──
  const handleTimelineEdit = useCallback(async (field: string, value: string | null) => {
    if (!selectedCall || !isAdminOrManager) return;
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`, {
        method: 'PUT',
        body: JSON.stringify({ [field]: value || null }),
      });
      const updated = mapDbCall(result);
      setCalls(prev => prev.map(c => c.id === selectedCall.id ? updated : c));
      setSelectedCall(updated);
      addToast(`Timeline updated: ${field.replace(/_at$/, '').replace(/_/g, ' ').toUpperCase()}`, 'success');
    } catch (err) {
      console.error('Failed to update timeline:', err);
      const msg = err instanceof Error ? err.message : 'Failed to update timeline';
      addToast(`Timeline update failed: ${msg}`, 'error');
    }
    setEditingTimestamp(null);
  }, [selectedCall, isAdminOrManager, addToast]);

  // Parse simple markdown markers into React elements for display
  const renderFormattedText = useCallback((text: string) => {
    if (!text) return text;
    // Pattern: **bold**, *italic*, __underline__ (greedy shortest match)
    const parts: React.ReactNode[] = [];
    let keyIdx = 0;
    const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }
      if (match[2]) {
        parts.push(<span key={keyIdx++} className="font-bold">{match[2]}</span>);
      } else if (match[3]) {
        parts.push(<span key={keyIdx++} className="italic">{match[3]}</span>);
      } else if (match[4]) {
        parts.push(<span key={keyIdx++} className="underline">{match[4]}</span>);
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }
    return parts.length > 0 ? parts : text;
  }, []);

  // Wrap selected text in the note textarea with formatting markers
  const wrapNoteSelection = useCallback((marker: string) => {
    const el = noteTextareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const text = newNote;
    const selected = text.slice(start, end);
    if (selected) {
      const wrapped = `${marker}${selected}${marker}`;
      const updated = text.slice(0, start) + wrapped + text.slice(end);
      setNewNote(updated);
      // Restore cursor after marker
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + marker.length, end + marker.length);
      });
    } else {
      // No selection — insert markers at cursor and place cursor between them
      const updated = text.slice(0, start) + `${marker}${marker}` + text.slice(start);
      setNewNote(updated);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + marker.length, start + marker.length);
      });
    }
  }, [newNote]);

  // ── Inline Editing ────────────────────────────────────────
  // Refetch the full call fresh from /dispatch/calls/:id before populating
  // the edit form. Guards against stale in-memory data from list-endpoint
  // caching / older client bundles that silently dropped fields. The fetched
  // row also replaces selectedCall so the non-edit view re-renders correctly.
  const startEditing = async () => {
    if (!selectedCall) return;
    let source: any = selectedCall;
    try {
      const fresh = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`);
      if (fresh && (fresh.id != null || fresh.call_number)) {
        const mapped = mapDbCall(fresh);
        setSelectedCall(mapped);
        setCalls((prev) => prev.map((c) => (c.id === mapped.id ? mapped : c)));
        source = mapped;
      }
    } catch (err) {
      console.warn('[DispatchPage] Failed to refetch call before edit; using cached copy', err);
    }
    const selectedCallForEdit: any = source;
    setEditData({
      incident_type: selectedCallForEdit.incident_type,
      priority: selectedCallForEdit.priority,
      client_id: selectedCallForEdit.client_id || '',
      caller_name: selectedCallForEdit.caller_name || '',
      caller_phone: selectedCallForEdit.caller_phone || '',
      caller_relationship: selectedCallForEdit.caller_relationship || '',
      caller_address: selectedCallForEdit.caller_address || '',
      location: selectedCallForEdit.location || '',
      latitude: selectedCallForEdit.latitude ?? null,
      longitude: selectedCallForEdit.longitude ?? null,
      property_id: selectedCallForEdit.property_id ?? null,
      description: selectedCallForEdit.description || '',
      source: selectedCallForEdit.source || 'phone',
      disposition: selectedCallForEdit.disposition || '',
      cross_street: selectedCallForEdit.cross_street || '',
      location_building: selectedCallForEdit.location_building || '',
      location_floor: selectedCallForEdit.location_floor || '',
      location_room: selectedCallForEdit.location_room || '',
      zone_beat: selectedCallForEdit.zone_beat || '',
      sector_id: selectedCallForEdit.sector_id || '',
      zone_id: selectedCallForEdit.zone_id || '',
      beat_id: selectedCallForEdit.beat_id || '',
      weapons_involved: selectedCallForEdit.weapons_involved || '',
      injuries_reported: !!selectedCallForEdit.injuries_reported,
      num_subjects: selectedCallForEdit.num_subjects || '',
      num_victims: selectedCallForEdit.num_victims || '',
      subject_description: selectedCallForEdit.subject_description || '',
      vehicle_description: selectedCallForEdit.vehicle_description || '',
      direction_of_travel: selectedCallForEdit.direction_of_travel || '',
      scene_safety: selectedCallForEdit.scene_safety || '',
      weather_conditions: selectedCallForEdit.weather_conditions || '',
      lighting_conditions: selectedCallForEdit.lighting_conditions || '',
      alcohol_involved: !!selectedCallForEdit.alcohol_involved,
      drugs_involved: !!selectedCallForEdit.drugs_involved,
      domestic_violence: !!selectedCallForEdit.domestic_violence,
      supervisor_notified: !!selectedCallForEdit.supervisor_notified,
      le_notified: !!selectedCallForEdit.le_notified,
      le_agency: selectedCallForEdit.le_agency || '',
      le_case_number: selectedCallForEdit.le_case_number || '',
      damage_estimate: selectedCallForEdit.damage_estimate ?? '',
      damage_description: selectedCallForEdit.damage_description || '',
      action_taken: selectedCallForEdit.action_taken || '',
      responding_officer: selectedCallForEdit.responding_officer || '',
      starting_mileage: selectedCallForEdit.starting_mileage || '',
      ending_mileage: selectedCallForEdit.ending_mileage || '',
      dispatch_code: selectedCallForEdit.dispatch_code || '',
      pso_requestor_name: selectedCallForEdit.pso_requestor_name || '',
      pso_requestor_phone: selectedCallForEdit.pso_requestor_phone || '',
      pso_requestor_email: selectedCallForEdit.pso_requestor_email || '',
      pso_service_type: selectedCallForEdit.pso_service_type || '',
      pso_billing_code: selectedCallForEdit.pso_billing_code || '',
      pso_authorization: selectedCallForEdit.pso_authorization || '',
      contract_id: selectedCallForEdit.contract_id || '',
      // Process Service fields
      process_service_type: selectedCallForEdit.process_service_type || '',
      process_served_to: selectedCallForEdit.process_served_to || '',
      process_served_address: selectedCallForEdit.process_served_address || '',
      process_attempts: selectedCallForEdit.process_attempts ?? 0,
      process_served_at: selectedCallForEdit.process_served_at || '',
      process_service_result: selectedCallForEdit.process_service_result || '',
    });
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditData({});
  };

  const saveEditing = async () => {
    if (!selectedCall) return;
    setIsSaving(true);
    try {
      const body: Record<string, any> = {
        incident_type: editData.incident_type,
        priority: editData.priority,
        client_id: editData.client_id || null,
        property_id: editData.property_id || null,
        caller_name: editData.caller_name,
        caller_phone: editData.caller_phone,
        caller_relationship: editData.caller_relationship,
        caller_address: editData.caller_address,
        location_address: editData.location,
        // If location changed from original and user didn't pick a new autocomplete
        // result (lat/lng still hold old values), clear them to trigger server re-geocode
        latitude: (editData.location !== selectedCall.location && editData.latitude === selectedCall.latitude) ? null : (editData.latitude ?? null),
        longitude: (editData.location !== selectedCall.location && editData.longitude === selectedCall.longitude) ? null : (editData.longitude ?? null),
        description: editData.description,
        source: editData.source,
        disposition: editData.disposition,
        cross_street: editData.cross_street,
        location_building: editData.location_building,
        location_floor: editData.location_floor,
        location_room: editData.location_room,
        zone_beat: editData.zone_beat,
        sector_id: editData.sector_id,
        zone_id: editData.zone_id,
        beat_id: editData.beat_id,
        dispatch_code: editData.dispatch_code,
        weapons_involved: editData.weapons_involved,
        injuries_reported: editData.injuries_reported,
        num_subjects: editData.num_subjects ? Number(editData.num_subjects) : null,
        num_victims: editData.num_victims ? Number(editData.num_victims) : null,
        subject_description: editData.subject_description,
        vehicle_description: editData.vehicle_description,
        direction_of_travel: editData.direction_of_travel,
        scene_safety: editData.scene_safety,
        weather_conditions: editData.weather_conditions,
        lighting_conditions: editData.lighting_conditions,
        alcohol_involved: editData.alcohol_involved,
        drugs_involved: editData.drugs_involved,
        domestic_violence: editData.domestic_violence,
        supervisor_notified: editData.supervisor_notified,
        le_notified: editData.le_notified,
        le_agency: editData.le_agency,
        le_case_number: editData.le_case_number,
        damage_estimate: editData.damage_estimate !== '' && editData.damage_estimate != null ? Number(editData.damage_estimate) : null,
        damage_description: editData.damage_description,
        action_taken: editData.action_taken,
        responding_officer: editData.responding_officer,
        starting_mileage: editData.starting_mileage ? Number(editData.starting_mileage) : null,
        ending_mileage: editData.ending_mileage ? Number(editData.ending_mileage) : null,
        pso_requestor_name: editData.pso_requestor_name || null,
        pso_requestor_phone: editData.pso_requestor_phone || null,
        pso_requestor_email: editData.pso_requestor_email || null,
        pso_service_type: editData.pso_service_type || null,
        pso_billing_code: editData.pso_billing_code || null,
        pso_authorization: editData.pso_authorization || null,
        contract_id: editData.contract_id || null,
        // Process Service fields
        process_service_type: editData.process_service_type || null,
        process_served_to: editData.process_served_to || null,
        process_served_address: editData.process_served_address || null,
        process_attempts: editData.process_attempts ? Number(editData.process_attempts) : 0,
        process_served_at: editData.process_served_at || null,
        process_service_result: editData.process_service_result || null,
      };
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === selectedCall.id ? updatedCall : c));
      setSelectedCall(updatedCall);
      setIsEditing(false);
      addToast(`Call ${updatedCall.call_number} saved`, 'success');
    } catch (err: any) {
      console.error('Failed to save edits:', err);
      addToast(err?.message || 'Failed to save changes', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const updateEditField = useCallback((field: string, value: any) => {
    setEditData((prev) => ({ ...prev, [field]: value }));
  }, []);

  // ═══════════════════════════════════════════════════════════════
  // NEW DISPATCH FEATURES
  // ═══════════════════════════════════════════════════════════════

  // Feature 1: Auto-escalation timer — auto-push CFS priority for pending unassigned calls
  const escalatedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const checkEscalation = () => {
      const now = Date.now();
      for (const c of calls) {
        if (c.status !== 'pending' || escalatedRef.current.has(c.id)) continue;
        const age = now - new Date(c.created_at).getTime();
        const ageMins = age / 60000;
        let shouldEscalate = false;
        if (c.priority === 'P3' && ageMins >= 15) shouldEscalate = true;
        if (c.priority === 'P2' && ageMins >= 30) shouldEscalate = true;
        if (c.priority === 'P4' && ageMins >= 20) shouldEscalate = true;
        if (shouldEscalate && c.assigned_units.length === 0) {
          escalatedRef.current.add(c.id);
          apiFetch(`/dispatch/calls/${c.id}/escalate`, { method: 'POST' })
            .then((result: any) => {
              if (result) {
                const updated = mapDbCall(result);
                setCalls(prev => prev.map(pc => pc.id === c.id ? updated : pc));
                addToast(`Call ${c.call_number} auto-escalated from ${c.priority} to ${updated.priority}`, 'warning');
              }
            })
            .catch(() => { escalatedRef.current.delete(c.id); });
        }
      }
    };
    const interval = setInterval(checkEscalation, 30000);
    return () => clearInterval(interval);
  }, [calls, addToast]);

  // Feature 4: Unit availability counter
  const unitAvailability = useMemo(() => {
    const available = units.filter(u => u.status === 'available').length;
    const total = units.filter(u => u.status !== 'off_duty').length;
    const enroute = units.filter(u => u.status === 'enroute' || u.status === 'dispatched').length;
    const onscene = units.filter(u => u.status === 'onscene').length;
    const oos = units.filter(u => u.status === 'out_of_service' || u.status === 'busy').length;
    return { available, total, enroute, onscene, oos };
  }, [units]);

  // Feature 5: Stacked calls count by address
  const stackedCallCounts = useMemo(() => {
    const counts = new Map<string, number>();
    calls.filter(c => ['pending', 'dispatched', 'enroute', 'onscene', 'on_hold'].includes(c.status)).forEach(c => {
      if (c.location) {
        const loc = c.location.toLowerCase().trim();
        counts.set(loc, (counts.get(loc) || 0) + 1);
      }
    });
    return counts;
  }, [calls]);

  // Toggle pinned-to-top flag on a call
  const handleTogglePin = useCallback(async (callId: string, currentlyPinned: boolean) => {
    const next = !currentlyPinned;
    // Optimistic local update
    setCalls(prev => prev.map(c => c.id === callId ? ({ ...c, pinned: next ? 1 : 0 }) : c));
    try {
      await apiFetch(`/dispatch/calls/${callId}/pin`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned: next }),
      });
      addToast(next ? 'Call pinned to top' : 'Call unpinned', 'success');
    } catch {
      // Revert on failure
      setCalls(prev => prev.map(c => c.id === callId ? ({ ...c, pinned: currentlyPinned ? 1 : 0 }) : c));
      addToast('Failed to toggle pin', 'error');
    }
  }, [addToast]);

  // Feature 9: Call type statistics
  const callTypeStats = useMemo(() => {
    const active = calls.filter(c => ['pending', 'dispatched', 'enroute', 'onscene', 'on_hold'].includes(c.status));
    const typeCounts = new Map<string, number>();
    active.forEach(c => {
      const type = c.incident_type || 'other';
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    });
    return [...typeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([type, count]) => ({ type, count }));
  }, [calls]);

  // Feature 13: Unit workload — count active calls per unit
  const unitWorkload = useMemo(() => {
    const workload = new Map<string, number>();
    calls.filter(c => ['dispatched', 'enroute', 'onscene'].includes(c.status)).forEach(c => {
      (c.assigned_units || []).forEach(uid => {
        workload.set(String(uid), (workload.get(String(uid)) || 0) + 1);
      });
    });
    return workload;
  }, [calls]);

  // Feature 14: Disposition statistics for current shift
  const [dispositionStats, setDispositionStats] = useState<{disposition: string; count: number}[]>([]);
  useEffect(() => {
    apiFetch<any[]>('/dispatch/disposition-stats')
      .then(data => setDispositionStats(Array.isArray(data) ? data : []))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls.filter(c => c.disposition).length]); // Re-fetch when dispositions change

  // Feature 17: Auto-archive cleared calls after 5 minutes
  const handleArchiveRef = useRef(handleArchive);
  useEffect(() => { handleArchiveRef.current = handleArchive; }, [handleArchive]);
  useEffect(() => {
    const checkAutoArchive = () => {
      const now = Date.now();
      const fiveMinMs = 5 * 60 * 1000;
      calls.filter(c => ['cleared'].includes(c.status) && c.cleared_at).forEach(c => {
        const clearedTime = new Date(c.cleared_at!).getTime();
        if (now - clearedTime > fiveMinMs) {
          handleArchiveRef.current(c.id).catch(() => {});
        }
      });
    };
    const interval = setInterval(checkAutoArchive, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [calls]);

  // ── Dispatch alarm interval — check overdue calls every 5s ──
  const alarmPlayedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const check = () => {
      const activeCalls = calls.filter(c => isActiveStatus(c.status));
      for (const c of activeCalls) {
        const state = getTimerState(c);
        if (state.isOverdue && !alarmPlayedRef.current.has(c.id)) {
          alarmPlayedRef.current.add(c.id);
          playTone('alarm');
          break; // One alarm at a time
        }
      }
      // Clean up resolved overdue flags
      const activeIds = new Set(activeCalls.map(c => c.id));
      for (const id of alarmPlayedRef.current) {
        if (!activeIds.has(id)) alarmPlayedRef.current.delete(id);
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [calls]);


  const tabCounts = useMemo(() => {
    const pending = calls.filter((c) => c.status === 'pending').length;
    const active = calls.filter((c) => ['dispatched', 'enroute', 'onscene', 'on_hold'].includes(c.status)).length;
    const cleared = calls.filter((c) => ['cleared', 'closed', 'cancelled'].includes(c.status)).length;
    // ALL count: if user hides cleared calls, exclude them from the count to match the visible list
    const allCount = userPrefs?.dispatch_show_cleared ? calls.length : calls.length - cleared;
    const myId = user?.id != null ? String(user.id) : null;
    const mine = myId ? calls.filter((c) => String((c as any).dispatcher_id ?? (c as any).created_by ?? '') === myId).length : 0;
    return {
      all: allCount,
      pending,
      active,
      cleared,
      archived: archivedCalls.length,
      serve: calls.filter((c) => PSO_INCIDENT_TYPES.includes(c.incident_type)).length,
      mine,
    };
  }, [calls, archivedCalls, userPrefs?.dispatch_show_cleared, user?.id]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: 'var(--surface-base)' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-10 h-10 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-[#888888] animate-spin" />
            <div className="absolute inset-0 rounded-sm" style={{ boxShadow: '0 0 16px 3px rgba(212,160,23,0.25)' }} />
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-[#6b7280] animate-pulse">Loading Dispatch Console</span>
            <span className="text-[8px] font-mono text-[#545454]">Connecting to dispatch services...</span>
          </div>
        </div>
      </div>
    );
  }

  // ================================================================
  // MOBILE LAYOUT — Card list + slide-in detail view
  // ================================================================
  if (isMobile) {
    return (
      <div className="flex flex-col h-full relative">
        {/* Filter pill tabs — min 44px touch targets */}
        <div className="mobile-pill-tabs" style={{ gap: 6, padding: '8px 12px' }}>
          {([
            { id: 'all', label: 'All', count: tabCounts.all },
            { id: 'pending', label: 'Pending', count: tabCounts.pending },
            { id: 'active', label: 'Active', count: tabCounts.active },
            { id: 'serve', label: 'Serve', count: tabCounts.serve },
            { id: 'cleared', label: 'Cleared', count: tabCounts.cleared },
          ] as const).map((tab) => (
            <button type="button"
              key={tab.id}
              onClick={() => setFilterTab(tab.id as FilterTab)}
              className={`mobile-pill-tab ${filterTab === tab.id ? 'active' : ''}`}
              style={{ minHeight: 44, padding: '8px 14px', fontSize: 13 }}
            >
              {tab.label}
              {tab.count > 0 && (
                <span style={{ opacity: 0.7, marginLeft: 4 }}>({tab.count})</span>
              )}
            </button>
          ))}
        </div>

        {/* Card list */}
        <MobileCardList<CallForService>
          items={filteredCalls}
          keyExtractor={(call) => call.id}
          searchable
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search calls…"
          emptyMessage="No calls in this category"
          loading={isLoading}
          onItemTap={(call) => setSelectedCall(call)}
          renderCard={(call) => (
            <div
              className={`mobile-card priority-${call.priority} ${selectedCall?.id === call.id ? 'selected' : ''}`}
              style={{ minHeight: 56 }}
            >
              {/* Header row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {call.priority === 'P1' && (
                    <AlertTriangle className="w-4 h-4 text-red-500 animate-emergency-blink" />
                  )}
                  <span className="text-base font-bold text-green-400 font-mono tabular-nums">{call.call_number}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={call.priority} type="priority" size="sm" />
                  <StatusBadge status={call.status} type="call_status" size="sm" />
                </div>
              </div>
              {/* Type */}
              <div className="text-sm font-medium text-brand-400 mb-1.5">
                {formatIncidentType(call.incident_type)}
              </div>
              {/* Location */}
              <div className="flex items-center gap-2 text-sm text-rmpg-300 mb-2">
                <MapPin className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{call.location || 'Unknown'}</span>
              </div>
              {/* Footer */}
              <div className="flex items-center justify-between text-sm text-rmpg-400">
                <div className="flex items-center gap-1.5 font-mono tabular-nums">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{formatElapsed(call.created_at)}</span>
                </div>
                {call.assigned_units.length > 0 && (
                  <span className="font-mono tabular-nums">{call.assigned_units.length} unit{call.assigned_units.length !== 1 ? 's' : ''}</span>
                )}
              </div>
            </div>
          )}
        />

        {/* Mobile Detail View — slides in from right when call selected */}
        <MobileDetailView
          open={!!selectedCall}
          onClose={() => setSelectedCall(null)}
          title={selectedCall?.call_number || 'Call Detail'}
          subtitle={selectedCall ? formatIncidentType(selectedCall.incident_type) : undefined}
          actions={selectedCall ? [
            { label: 'View on Map', icon: MapPin, onClick: () => { if (selectedCall.latitude) navigate(`/map?lat=${selectedCall.latitude}&lng=${selectedCall.longitude}`); } },
          ] : undefined}
        >
          {selectedCall && (
            <div className="p-3 space-y-4">
              {/* Status & Priority */}
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={selectedCall.priority} type="priority" title={humanizePriority(selectedCall.priority)} />
                <StatusBadge status={selectedCall.status} type="call_status" title={getStatusTooltip(selectedCall.status, 'call')} />
                {callWarnings.length > 0 && (
                  <span className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold font-mono text-red-400 bg-red-900/30 border border-red-700/50 animate-pulse">
                    <AlertTriangle style={{ width: 10, height: 10 }} /> {callWarnings.length} ALERT{callWarnings.length !== 1 ? 'S' : ''}
                  </span>
                )}
              </div>

              {/* Call Duration + Response Time — mobile */}
              <div className="flex items-center gap-3 text-[10px] font-mono tabular-nums">
                <div className="flex items-center gap-1">
                  <Clock style={{ width: 10, height: 10 }} className="text-rmpg-500" />
                  <span className="text-rmpg-400">Duration:</span>
                  <span className="text-rmpg-200 font-bold">
                    {(() => {
                      const endTime = ['cleared', 'closed', 'cancelled', 'archived'].includes(selectedCall.status) ? (selectedCall.cleared_at || (selectedCall as any).closed_at || selectedCall.created_at) : null;
                      const elapsed = (endTime ? new Date(endTime).getTime() : Date.now()) - new Date(selectedCall.created_at).getTime();
                      return formatCallDuration(elapsed);
                    })()}
                  </span>
                </div>
                {selectedCall.dispatched_at && selectedCall.onscene_at && (() => {
                  const diff = new Date(selectedCall.onscene_at).getTime() - new Date(selectedCall.dispatched_at).getTime();
                  if (diff <= 0 || !isFinite(diff)) return null;
                  return (
                    <div className="flex items-center gap-1">
                      <span className="text-rmpg-400">Response:</span>
                      <span className="text-gray-400 font-bold">{formatCallDuration(diff)}</span>
                    </div>
                  );
                })()}
                {selectedCall.onscene_at && (() => {
                  const endTime = selectedCall.cleared_at || (selectedCall as any).closed_at || (selectedCall.status === 'archived' ? selectedCall.archived_at : null);
                  const diff = (endTime ? new Date(endTime).getTime() : Date.now()) - new Date(selectedCall.onscene_at).getTime();
                  if (diff <= 0 || !isFinite(diff)) return null;
                  return (
                    <div className="flex items-center gap-1">
                      <span className="text-rmpg-400">On-Scene:</span>
                      <span className="text-gray-400 font-bold">{formatCallDuration(diff)}</span>
                    </div>
                  );
                })()}
              </div>

              {/* Safety Flag Badges — mobile */}
              {(() => {
                const flags: Array<{ label: string; color: string }> = [];
                if (selectedCall.weapons_involved && selectedCall.weapons_involved !== 'None') flags.push({ label: 'ARMED', color: '#fca5a5' });
                if ((selectedCall as any).domestic_violence) flags.push({ label: 'DV', color: '#fde047' });
                if ((selectedCall as any).mental_health_crisis) flags.push({ label: 'MH', color: '#c4b5fd' });
                if ((selectedCall as any).officer_safety_caution) flags.push({ label: 'SAFETY', color: '#ef4444' });
                if ((selectedCall as any).vehicle_pursuit || (selectedCall as any).foot_pursuit) flags.push({ label: 'PURSUIT', color: '#fb923c' });
                if (flags.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-1">
                    {flags.map(f => (
                      <span key={f.label} className="text-[9px] font-bold font-mono px-1.5 py-0.5" style={{ color: f.color, background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.25)' }}>
                        {f.label}
                      </span>
                    ))}
                  </div>
                );
              })()}

              {/* Mobile Status Action Buttons — large touch targets for gloved use */}
              <div className="flex flex-wrap gap-2" style={{ willChange: 'transform' }}>
                {selectedCall.status === 'pending' && (
                  <button type="button"
                    onClick={() => handleStatusChange(selectedCall.id, 'dispatched')}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-white rounded-sm"
                    style={{ minHeight: 48, minWidth: 80, background: '#888888', border: '1px solid #5a5a5a', touchAction: 'manipulation' }}
                  >
                    <Send style={{ width: 16, height: 16 }} /> Dispatch
                  </button>
                )}
                {selectedCall.status === 'dispatched' && (
                  <button type="button"
                    onClick={() => handleStatusChange(selectedCall.id, 'enroute')}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-white rounded-sm"
                    style={{ minHeight: 48, minWidth: 80, background: '#888888', border: '1px solid #5a5a5a', touchAction: 'manipulation' }}
                  >
                    <Navigation style={{ width: 16, height: 16 }} /> En Route
                  </button>
                )}
                {selectedCall.status === 'enroute' && (
                  <button type="button"
                    onClick={() => handleStatusChange(selectedCall.id, 'onscene')}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-white rounded-sm"
                    style={{ minHeight: 48, minWidth: 80, background: '#888888', border: '1px solid #5a5a5a', touchAction: 'manipulation' }}
                  >
                    <Eye style={{ width: 16, height: 16 }} /> On Scene
                  </button>
                )}
                {['dispatched', 'enroute', 'onscene'].includes(selectedCall.status) && (
                  <>
                    <button type="button"
                      onClick={() => handleClearWithDisposition(selectedCall.id)}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                      style={{ minHeight: 48, minWidth: 80, background: '#16a34a20', border: '1px solid #16a34a50', color: '#4ade80', touchAction: 'manipulation' }}
                    >
                      <CheckCircle style={{ width: 16, height: 16 }} /> Clear
                    </button>
                    <button type="button"
                      onClick={() => handleHoldCall(selectedCall.id)}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                      style={{ minHeight: 48, minWidth: 80, background: '#f59e0b20', border: '1px solid #f59e0b50', color: '#f59e0b', touchAction: 'manipulation' }}
                    >
                      ⏸ Hold
                    </button>
                    <button type="button"
                      onClick={() => handleStatusChange(selectedCall.id, 'cancelled')}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                      style={{ minHeight: 48, minWidth: 80, background: '#dc262620', border: '1px solid #dc262650', color: '#ef7a7a', touchAction: 'manipulation' }}
                    >
                      <XCircle style={{ width: 16, height: 16 }} /> Cancel
                    </button>
                  </>
                )}
                {selectedCall.status === 'on_hold' && (
                  <button type="button"
                    onClick={() => handleResumeCall(selectedCall.id)}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                    style={{ minHeight: 48, minWidth: 80, background: '#f59e0b', color: '#000', touchAction: 'manipulation' }}
                  >
                    ▶ Resume
                  </button>
                )}
                {selectedCall.status === 'cleared' && (
                  <>
                    <button type="button"
                      onClick={() => handleStatusChange(selectedCall.id, 'closed')}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                      style={{ minHeight: 48, minWidth: 80, background: '#444444', border: '1px solid #545454', color: '#cccccc', touchAction: 'manipulation' }}
                    >
                      Close
                    </button>
                    <button type="button"
                      onClick={handleGenerateIncident}
                      disabled={isGenerating}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-white rounded-sm"
                      style={{ minHeight: 48, minWidth: 80, background: '#888888', border: '1px solid #5a5a5a', touchAction: 'manipulation' }}
                    >
                      {isGenerating ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : <FileText style={{ width: 16, height: 16 }} />}
                      Report
                    </button>
                  </>
                )}
                {selectedCall.status === 'closed' && (
                  <button type="button"
                    onClick={handleGenerateIncident}
                    disabled={isGenerating}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-white rounded-sm"
                    style={{ minHeight: 48, minWidth: 80, background: '#888888', border: '1px solid #5a5a5a', touchAction: 'manipulation' }}
                  >
                    {isGenerating ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : <FileText style={{ width: 16, height: 16 }} />}
                    Report
                  </button>
                )}
                {['dispatched', 'enroute', 'onscene', 'cleared', 'closed'].includes(selectedCall.status) && (
                  <button type="button"
                    onClick={() => handleRevertStatus(selectedCall.id)}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                    style={{ minHeight: 48, minWidth: 80, background: '#f59e0b20', border: '1px solid #f59e0b50', color: '#f59e0b', touchAction: 'manipulation' }}
                  >
                    <Undo2 style={{ width: 16, height: 16 }} /> Back
                  </button>
                )}
                {selectedCall.status !== 'archived' && (
                  <button type="button"
                    onClick={() => handleArchive(selectedCall.id)}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                    style={{ minHeight: 48, minWidth: 80, background: '#40404020', border: '1px solid #54545450', color: '#999999', touchAction: 'manipulation' }}
                  >
                    <Archive style={{ width: 16, height: 16 }} /> Archive
                  </button>
                )}
                {selectedCall.status === 'archived' && (
                  <button type="button"
                    onClick={() => handleUnarchive(selectedCall.id)}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                    style={{ minHeight: 48, minWidth: 80, background: '#40404020', border: '1px solid #54545450', color: '#999999', touchAction: 'manipulation' }}
                  >
                    <RotateCcw style={{ width: 16, height: 16 }} /> Restore
                  </button>
                )}
              </div>

              {/* Disposition prompt — appears when Clear is tapped */}
              {dispositionPromptCallId === selectedCall.id && (
                <div className="px-2">
                  <DispositionPrompt
                    callNumber={selectedCall.call_number}
                    dispositionCodes={dispositionCodes}
                    onConfirm={handleConfirmClear}
                    onCancel={() => setDispositionPromptCallId(null)}
                  />
                </div>
              )}

              {/* Key info fields */}
              <div className="space-y-2">
                <div className="panel-inset p-3">
                  <div className="field-label mb-1">Location</div>
                  <div className="text-sm text-rmpg-200">{selectedCall.location || 'Not specified'}</div>
                  {selectedCall.cross_street && (
                    <div className="text-xs text-rmpg-400 mt-0.5">Near: {selectedCall.cross_street}</div>
                  )}
                </div>

                {selectedCall.caller_name && (
                  <div className="panel-inset p-3">
                    <div className="field-label mb-1">Caller</div>
                    <div className="text-sm text-rmpg-200">{selectedCall.caller_name}</div>
                    {selectedCall.caller_phone && (
                      <div className="text-xs text-rmpg-400 mt-0.5">{formatPhoneDisplay(selectedCall.caller_phone)}</div>
                    )}
                  </div>
                )}

                {selectedCall.description && (
                  <div className="panel-inset p-3">
                    <div className="field-label mb-1">Description</div>
                    <div className="text-sm text-rmpg-200 whitespace-pre-wrap">{selectedCall.description}</div>
                  </div>
                )}

                {/* Timestamps — editable by admin/manager */}
                <div className="panel-inset p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="field-label">Timeline</div>
                    {isAdminOrManager && <span className="text-[8px] text-rmpg-500 font-mono">CLICK TO EDIT</span>}
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {([
                      { label: 'Created', field: 'created_at', value: selectedCall.created_at, color: '#999999' },
                      { label: 'Dispatched', field: 'dispatched_at', value: selectedCall.dispatched_at, color: '#f59e0b' },
                      { label: 'Enroute', field: 'enroute_at', value: selectedCall.enroute_at, color: '#888888' },
                      { label: 'On Scene', field: 'onscene_at', value: selectedCall.onscene_at, color: '#a855f7' },
                      { label: 'Cleared', field: 'cleared_at', value: selectedCall.cleared_at, color: '#22c55e' },
                      { label: 'Closed', field: 'closed_at', value: (selectedCall as any).closed_at, color: '#666666' },
                    ] as const).filter(ts => ts.field === 'created_at' || ts.value || isAdminOrManager).map(ts => (
                      <div key={ts.field} className="flex justify-between items-center group">
                        <span className="text-rmpg-400 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ts.color, boxShadow: ts.value ? `0 0 4px ${ts.color}80` : 'none' }} />
                          {ts.label}
                        </span>
                        {editingTimestamp === ts.field ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="datetime-local"
                              step="1"
                              className="input-dark text-[10px] font-mono px-1 py-0.5 w-[175px]"
                              defaultValue={ts.value ? new Date(new Date(ts.value).getTime() - new Date(ts.value).getTimezoneOffset() * 60000).toISOString().slice(0, 19) : ''}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleTimelineEdit(ts.field, new Date((e.target as HTMLInputElement).value).toISOString());
                                if (e.key === 'Escape') setEditingTimestamp(null);
                              }}
                              onBlur={(e) => {
                                if (e.target.value) handleTimelineEdit(ts.field, new Date(e.target.value).toISOString());
                                else setEditingTimestamp(null);
                              }}
                            />
                            {ts.value && ts.field !== 'created_at' && (
                              <button type="button" onClick={() => handleTimelineEdit(ts.field, null)} className="text-red-400 hover:text-red-300 p-0.5 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center" title="Clear timestamp">
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <span
                            className={`font-mono text-rmpg-200 tabular-nums ${isAdminOrManager ? 'cursor-pointer hover:text-[#d4a017] group-hover:underline transition-colors' : ''}`}
                            onClick={() => isAdminOrManager && setEditingTimestamp(ts.field)}
                            title={isAdminOrManager ? 'Click to edit timestamp' : undefined}
                          >
                            {ts.value ? formatTime(ts.value) : <span className="text-rmpg-600 italic">—</span>}
                          </span>
                        )}
                      </div>
                    ))}
                    {/* Enhancement 26: Response time (dispatched → onscene) */}
                    {selectedCall.dispatched_at && selectedCall.onscene_at && (() => {
                      const diff = new Date(selectedCall.onscene_at).getTime() - new Date(selectedCall.dispatched_at).getTime();
                      if (diff <= 0 || !isFinite(diff)) return null;
                      const mins = Math.floor(diff / 60000);
                      const secs = Math.floor((diff % 60000) / 1000);
                      return (
                        <div className="flex justify-between items-center mt-1 pt-1 border-t border-rmpg-700/30">
                          <span className="text-rmpg-400 text-[10px]">Response Time</span>
                          <span className="text-gray-400 font-mono font-bold text-[10px]">{mins}m {secs}s</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Assigned Units */}
                {(selectedCall.assigned_units || []).length > 0 && (
                  <div className="panel-inset p-3">
                    <div className="field-label mb-2">Assigned Units</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(selectedCall.assigned_units || []).map((unitIdStr) => {
                        const unitObj = units.find((u) => String(u.id) === String(unitIdStr));
                        return (
                          <span
                            key={unitIdStr}
                            className="px-2 py-1 text-xs font-mono font-bold text-green-400 bg-green-900/20 border border-green-700/40"
                          >
                            {unitObj?.call_sign || unitIdStr}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Notes + Add Note */}
                <div className="panel-inset p-3">
                  <div className="field-label mb-2">Notes</div>
                  {Array.isArray(selectedCall.notes) && selectedCall.notes.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {selectedCall.notes.map((note) => (
                        <div key={note.id} className="text-xs">
                          <div className="flex items-center gap-2 text-rmpg-400">
                            <span className="font-bold">{note.author || 'System'}</span>
                            <span className="font-mono">{formatTime(note.timestamp)}</span>
                          </div>
                          <div className="text-rmpg-200 mt-0.5">{typeof note.text === 'string' ? note.text : String(note.text ?? '')}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Add note input — mobile */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 bg-surface-sunken border border-rmpg-600 text-sm text-rmpg-200 px-3 rounded-sm"
                      style={{ minHeight: 44 }}
                      placeholder="Add note…"
                      maxLength={2000}
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddNote(); } }}
                    />
                    <button type="button"
                      onClick={handleAddNote}
                      disabled={!newNote.trim()}
                      className="flex items-center justify-center px-4 py-3 text-xs font-bold text-white rounded-sm"
                      style={{ minHeight: 44, minWidth: 56, background: !newNote.trim() ? '#444444' : '#888888', border: '1px solid #5a5a5a' }}
                    >
                      <Send style={{ width: 16, height: 16 }} />
                    </button>
                  </div>
                </div>

                {/* PSO Details + Schedule Return Visit (mobile) */}
                {selectedCall.incident_type === 'pso_client_request' && (
                  <div className="panel-inset p-3">
                    <div className="field-label mb-2 flex items-center gap-2">
                      PSO Details
                      {(selectedCall.pso_attempt_number || 1) >= 1 && (
                        isAdminOrManager ? (
                          <select
                            className="px-1 py-0 text-[9px] font-bold rounded-sm cursor-pointer"
                            style={{ background: '#f59e0b30', border: '1px solid #f59e0b50', color: '#fbbf24', appearance: 'auto' }}
                            value={selectedCall.pso_attempt_number || 1}
                            onChange={async (e) => {
                              const val = parseInt(e.target.value, 10);
                              try {
                                const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`, { method: 'PUT', body: JSON.stringify({ pso_attempt_number: val }) });
                                const updated = mapDbCall(result);
                                setCalls(prev => prev.map(c => String(c.id) === String(updated.id) ? { ...c, ...updated } : c));
                                setSelectedCall(prev => prev ? { ...prev, ...updated } : updated);
                              } catch { addToast('Failed to update visit number', 'error'); }
                            }}
                          >
                            {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>VISIT #{n}</option>)}
                          </select>
                        ) : (selectedCall.pso_attempt_number || 1) > 1 ? (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-sm" style={{ background: '#f59e0b30', border: '1px solid #f59e0b50', color: '#fbbf24' }}>
                            VISIT #{selectedCall.pso_attempt_number}
                          </span>
                        ) : null
                      )}
                    </div>
                    <div className="space-y-1 text-xs text-rmpg-200">
                      {selectedCall.pso_service_type && <div><span className="text-rmpg-400">Service:</span> {formatServiceType(selectedCall.pso_service_type)}</div>}
                      {selectedCall.pso_requestor_name && <div><span className="text-rmpg-400">Requestor:</span> {selectedCall.pso_requestor_name}</div>}
                      {selectedCall.pso_requestor_phone && <div><span className="text-rmpg-400">Phone:</span> {formatPhoneDisplay(selectedCall.pso_requestor_phone)}</div>}
                      {selectedCall.pso_billing_code && <div><span className="text-rmpg-400">Billing:</span> {selectedCall.pso_billing_code}</div>}
                      {selectedCall.pso_authorization && <div><span className="text-rmpg-400">Auth:</span> {selectedCall.pso_authorization}</div>}
                      {selectedCall.disposition && <div><span className="text-rmpg-400">Disposition:</span> {humanizeDisposition(selectedCall.disposition)}</div>}
                    </div>

                    {/* Serve Queue Integration — Gold Status Panel */}
                    {(
                      <div className="mt-2 pt-2 border-t border-rmpg-600">
                        {serveLink ? (
                          <div
                            className="rounded-[2px] p-2 space-y-1.5"
                            style={{
                              border: '1px solid #d4a017',
                              background: '#d4a01708',
                            }}
                            role="status"
                            aria-label={`Serve status: ${serveLink.status}`}
                          >
                            <div className="flex items-center gap-2">
                              {/* LED indicator */}
                              <span
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{
                                  background: serveLink.status === 'served' ? '#22c55e'
                                    : serveLink.status === 'failed' ? '#ef4444'
                                    : serveLink.status === 'in_progress' ? '#eab308'
                                    : '#f59e0b',
                                  boxShadow: `0 0 4px ${
                                    serveLink.status === 'served' ? '#22c55e'
                                    : serveLink.status === 'failed' ? '#ef4444'
                                    : serveLink.status === 'in_progress' ? '#eab308'
                                    : '#f59e0b'
                                  }`,
                                }}
                              />
                              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#d4a017' }}>
                                Serve Queue
                              </span>
                              {serveLink.auto_sent && (
                                <span className="text-[9px] font-bold px-1 py-0.5 rounded-sm" style={{ background: '#d4a01720', border: '1px solid #d4a01740', color: '#d4a017' }}>
                                  AUTO-SENT
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {/* Status badge */}
                              <span
                                className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-[2px] uppercase"
                                style={{
                                  background: serveLink.status === 'served' ? '#22c55e20'
                                    : serveLink.status === 'failed' ? '#dc262620'
                                    : serveLink.status === 'in_progress' ? '#eab30820'
                                    : '#f59e0b20',
                                  color: serveLink.status === 'served' ? '#4ade80'
                                    : serveLink.status === 'failed' ? '#f87171'
                                    : serveLink.status === 'in_progress' ? '#facc15'
                                    : '#fbbf24',
                                  border: `1px solid ${
                                    serveLink.status === 'served' ? '#22c55e40'
                                    : serveLink.status === 'failed' ? '#dc262640'
                                    : serveLink.status === 'in_progress' ? '#eab30840'
                                    : '#f59e0b40'
                                  }`,
                                }}
                              >
                                {serveLink.status === 'in_progress' ? 'IN PROGRESS' : serveLink.status?.toUpperCase()}
                              </span>
                              {/* Attempt counter */}
                              <span className="text-[10px] font-mono tabular-nums" style={{ color: '#d4a017' }}>
                                Attempts: {serveLink.attempt_count}/{serveLink.max_attempts}
                              </span>
                            </div>
                            {/* View in Process Server link */}
                            <button type="button"
                              className="flex items-center gap-1 text-[10px] font-medium rounded-[2px] px-2 py-1 transition-all duration-150 hover:shadow-[0_0_6px_rgba(212,160,23,0.2)]"
                              style={{
                                background: '#d4a01715',
                                border: '1px solid #d4a01740',
                                color: '#d4a017',
                              }}
                              onClick={() => navigate('/serve')}
                              aria-label="View in Process Server"
                            >
                              <Briefcase style={{ width: 10, height: 10 }} />
                              View in Process Server
                            </button>
                          </div>
                        ) : (
                          <button type="button"
                            className="w-full py-2 px-3 text-xs font-semibold rounded-[2px] flex items-center justify-center gap-2 transition-colors"
                            style={{
                              background: sendingToServe ? '#444444' : '#7c3aed20',
                              border: '1px solid #7c3aed50',
                              color: sendingToServe ? '#999999' : '#a78bfa',
                            }}
                            disabled={sendingToServe}
                            onClick={async () => {
                              setSendingToServe(true);
                              try {
                                const result = await apiFetch(`/dispatch/calls/${selectedCall.id}/send-to-serve`, {
                                  method: 'POST',
                                  body: JSON.stringify({}),
                                });
                                if (result) {
                                  setServeLink(result);
                                  addToast('Sent to Serve Queue', 'success');
                                }
                              } catch (err: any) {
                                addToast(`Failed: ${err?.message || 'Unknown error'}`, 'error');
                              } finally {
                                setSendingToServe(false);
                              }
                            }}
                            aria-label="Send to Serve Queue"
                          >
                            <Briefcase style={{ width: 14, height: 14 }} />
                            {sendingToServe ? 'Sending...' : 'Send to Serve Queue'}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Visit History (mobile) */}
                    {Array.isArray(selectedCall.visit_history) && selectedCall.visit_history.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-rmpg-600">
                        <div className="field-label mb-1.5">Visit History</div>
                        <div className="space-y-1.5">
                          {selectedCall.visit_history.map((visit) => (
                            <div key={visit.id} className="bg-rmpg-800/60 border border-rmpg-600/50 rounded-sm px-2 py-1.5 text-[10px]">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="font-bold text-amber-300">VISIT #{visit.visit_number}</span>
                                <span className="text-rmpg-300">{(visit.status || '').toUpperCase()}</span>
                                {visit.time_window && (
                                  <span className="px-1 rounded-sm text-[8px] font-mono" style={{ background: '#88888820', border: '1px solid #88888840', color: '#888888' }}>
                                    {visit.time_window === 'early_morning' ? '6-9AM' : visit.time_window === 'daytime' ? '9AM-6PM' : '6-9PM'}
                                    {visit.is_weekend ? ' (wknd)' : ''}
                                  </span>
                                )}
                              </div>
                              <div className="text-rmpg-400 space-y-0.5">
                                {visit.dispatched_at && <div>Dispatched: {formatTime(visit.dispatched_at)}</div>}
                                {visit.onscene_at && <div>On Scene: {formatTime(visit.onscene_at)}</div>}
                                {visit.cleared_at && <div>Cleared: {formatTime(visit.cleared_at)}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* PSO Service Window Compliance Checklist (mobile) */}
                    {(() => {
                      const w = typeof selectedCall.pso_service_windows === 'string'
                        ? (() => { try { return JSON.parse(selectedCall.pso_service_windows); } catch { return null; } })()
                        : selectedCall.pso_service_windows;
                      const windows = { early_morning: !!w?.early_morning, daytime: !!w?.daytime, evening: !!w?.evening, weekend: !!w?.weekend };
                      const allMet = windows.early_morning && windows.daytime && windows.evening && windows.weekend;
                      const metCount = [windows.early_morning, windows.daytime, windows.evening, windows.weekend].filter(Boolean).length;
                      return (
                        <div className="mt-3 pt-2 border-t border-rmpg-600">
                          <div className="field-label mb-1.5 flex items-center gap-2">
                            Service Windows
                            <span className="text-[9px] font-mono px-1 rounded-sm" style={{
                              background: allMet ? '#22c55e20' : '#f59e0b20',
                              border: `1px solid ${allMet ? '#22c55e40' : '#f59e0b40'}`,
                              color: allMet ? '#4ade80' : '#fbbf24',
                            }}>
                              {metCount}/4
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            {([
                              { key: 'early_morning', label: '6AM – 9AM', met: windows.early_morning },
                              { key: 'daytime', label: '9AM – 6PM', met: windows.daytime },
                              { key: 'evening', label: '6PM – 9PM', met: windows.evening },
                              { key: 'weekend', label: 'Weekend', met: windows.weekend },
                            ] as const).map(({ key, label, met }) => (
                              <div key={key} className="flex items-center gap-1.5 text-[10px] py-0.5 px-1.5 rounded-sm" style={{
                                background: met ? '#22c55e10' : '#dc262610',
                                border: `1px solid ${met ? '#22c55e30' : '#dc262630'}`,
                              }}>
                                <span style={{ color: met ? '#4ade80' : '#ef4444' }}>{met ? '✓' : '✗'}</span>
                                <span style={{ color: met ? '#86efac' : '#fca5a5' }}>{label}</span>
                              </div>
                            ))}
                          </div>
                          {allMet && (
                            <div className="mt-1.5 text-[9px] text-center font-bold uppercase tracking-wider" style={{ color: '#4ade80' }}>
                              Due Diligence Complete
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* 72-hour countdown (mobile) */}
                    {['cleared', 'closed'].includes(selectedCall.status) && (() => {
                      const terminalTime = selectedCall.closed_at || selectedCall.cleared_at;
                      if (!terminalTime) return null;
                      const elapsed = Date.now() - new Date(terminalTime).getTime();
                      const hoursLeft = Math.max(0, 72 - elapsed / 3600000);
                      if (elapsed >= 72 * 3600000) {
                        return (
                          <div className="mt-2 p-2 rounded-sm text-center text-xs font-bold animate-pulse" style={{ background: '#dc262630', border: '1px solid #dc262650', color: '#f87171' }}>
                            72-HOUR DEADLINE PASSED — RE-DISPATCH REQUIRED
                          </div>
                        );
                      }
                      if (elapsed >= 48 * 3600000) {
                        return (
                          <div className="mt-2 p-2 rounded-sm text-center text-xs font-bold" style={{ background: '#f59e0b20', border: '1px solid #f59e0b40', color: '#fbbf24' }}>
                            {Math.floor(hoursLeft)} HOURS UNTIL 72-HR DEADLINE
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* Schedule Return Visit button (mobile) */}
                    {['cleared', 'closed', 'cancelled', 'on_hold', 'archived'].includes(selectedCall.status) && (
                      <button type="button"
                        className="w-full mt-3 py-2.5 px-4 text-sm font-semibold rounded-sm"
                        style={{ background: '#d4a01730', border: '1px solid #d4a01760', color: '#d4a017' }}
                        onClick={async () => {
                          const attempt = (selectedCall.pso_attempt_number || 1) + 1;
                          const ordinal = attempt === 2 ? '2nd' : attempt === 3 ? '3rd' : `${attempt}th`;
                          if (!window.confirm(`Schedule ${ordinal} return visit for ${selectedCall.call_number}?`)) return;
                          try {
                            const result = await apiFetch(`/dispatch/calls/${selectedCall.id}/redispatch`, {
                              method: 'POST',
                              body: JSON.stringify({}),
                            });
                            if (result) {
                              const mapped = mapDbCall(result);
                              setCalls(prev => [mapped, ...prev]);
                              setSelectedCall(mapped);
                              addToast(`Re-dispatched → ${mapped.call_number}`, 'success');
                            }
                          } catch (err: any) { addToast(`Failed to re-dispatch: ${err?.message || 'Unknown error'}`, 'error'); }
                        }}
                      >
                        <RotateCcw style={{ width: 14, height: 14, display: 'inline', marginRight: 6 }} />
                        Schedule Return Visit
                      </button>
                    )}

                    {/* Undo Return Visit button (mobile) — only on pending child calls */}
                    {(selectedCall as any).parent_call_id && selectedCall.status === 'pending' && (
                      <button type="button"
                        className="w-full mt-2 py-2 px-4 text-xs font-semibold rounded-sm"
                        style={{ background: '#ef444420', border: '1px solid #ef444450', color: '#ef4444' }}
                        onClick={async () => {
                          if (!window.confirm(`Undo this return visit? This will delete ${selectedCall.call_number} and restore the parent call.`)) return;
                          try {
                            const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/undo-redispatch`, { method: 'POST' });
                            if (result?.parent) {
                              const mapped = mapDbCall(result.parent);
                              setCalls(prev => prev.filter(c => c.id !== selectedCall.id).map(c => c.id === mapped.id ? mapped : c));
                              setSelectedCall(mapped);
                              addToast(`Return visit undone — restored ${mapped.call_number}`, 'success');
                            }
                          } catch (err: any) { addToast(`Failed to undo: ${err?.message || 'Unknown error'}`, 'error'); }
                        }}
                      >
                        <Undo2 style={{ width: 12, height: 12, display: 'inline', marginRight: 6 }} />
                        Undo Return Visit
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </MobileDetailView>

        {/* FABs — New Call + PSO */}
        <button type="button"
          className="mobile-fab"
          onClick={() => { setTemplateInitialData(undefined); setShowNewCallModal(true); }}
          aria-label="New Call"
        >
          <Plus style={{ width: 24, height: 24 }} />
        </button>
        <button type="button"
          className="mobile-fab"
          onClick={() => setShowQuickPsoModal(true)}
          aria-label="Quick PSO"
          style={{
            right: '80px',
            background: 'linear-gradient(180deg, #7c3aed 0%, #6b21a8 100%)',
            borderColor: '#7c3aed',
          }}
        >
          <Shield style={{ width: 20, height: 20 }} />
        </button>

        {/* New Call Modal (shared with desktop) */}
        <NewCallModal
          isOpen={showNewCallModal}
          onClose={() => { setShowNewCallModal(false); setTemplateInitialData(undefined); }}
          onSubmit={handleNewCall}
          properties={propertiesList}
          initialData={templateInitialData}
          defaultMode="quick"
        />

        {/* Quick PSO Modal */}
        <QuickPsoModal
          isOpen={showQuickPsoModal}
          onClose={() => setShowQuickPsoModal(false)}
          onSubmit={handleNewCall}
          onExpandToFullForm={handlePsoExpandToFullForm}
        />
      </div>
    );
  }

  // ================================================================
  // DESKTOP LAYOUT — Existing 40%/60% split with panels
  // ================================================================
  return (
    <div className="flex h-full relative">
      {/* ============================================================ */}
      {/* LEFT PANEL - Call Queue (40%) */}
      {/* ============================================================ */}
      <div className="w-[35%] min-w-[320px] border-r border-[#2b2b2b] flex flex-col" style={{ background: 'var(--surface-base)' }}>
        {/* Header — PanelTitleBar + TabBar */}
        <PanelTitleBar title="DISPATCH QUEUE" icon={Radio}>
          {/* Enhancement 27: Live sync indicator */}
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-green-400 bg-green-900/30 border border-green-700/40" title="Real-time updates active">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" style={{ boxShadow: '0 0 4px #22c55e' }} />
            LIVE
          </span>
          <RmpgLogo height={16} iconOnly />
          {/* Feature 1: Sound alert mute toggle */}
          <button type="button"
            onClick={toggleSoundAlerts}
            className={`toolbar-btn ${soundAlertsMuted ? 'text-red-400' : 'text-green-400'}`}
            title={soundAlertsMuted ? 'Sound alerts: MUTED' : 'Sound alerts: ON'}
          >
            {soundAlertsMuted ? <XCircle style={{ width: 10, height: 10 }} /> : <Radio style={{ width: 10, height: 10 }} />}
            {soundAlertsMuted ? 'Muted' : 'Sound'}
          </button>
          {/* Feature 5: Shift handoff notes */}
          <button type="button"
            onClick={() => { setShowHandoffNotes(true); fetchHandoffNotes(); }}
            className="toolbar-btn"
            title="Shift Handoff Notes"
          >
            <Briefcase style={{ width: 10, height: 10 }} />
            Handoff
          </button>
          <ExportButton exportUrl="/dispatch/calls/export?format=csv" exportFilename="dispatch_calls_export.csv" />
          <PrintButton />
          {tabCounts.cleared > 0 && (
            <button type="button"
              onClick={handleBulkArchive}
              disabled={isBulkArchiving}
              className="toolbar-btn"
              title="Archive all cleared, closed, and cancelled calls"
            >
              {isBulkArchiving ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <Archive style={{ width: 10, height: 10 }} />}
              Archive Cleared
            </button>
          )}
          <div className="relative flex items-center" style={{ minWidth: '100px', maxWidth: '170px' }}>
            <Search className="absolute left-2 w-3 h-3 text-[#545454] pointer-events-none" />
            <input
              type="text"
              placeholder="Search calls..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-dark text-xs w-full pl-6 pr-6"
            />
            {searchQuery && (
              <button type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 w-4 h-4 flex items-center justify-center text-[#6b7280] hover:text-white transition-colors"
                title="Clear search"
              >
                <X style={{ width: 10, height: 10 }} />
              </button>
            )}
          </div>
          <button type="button" onClick={() => { setTemplateInitialData(undefined); setShowNewCallModal(true); }} className="toolbar-btn toolbar-btn-primary">
            <Plus style={{ width: 10, height: 10 }} />
            New Call
          </button>
          {/* Quick Dispatch dropdown */}
          <div className="relative" ref={templateDropdownRef} style={{ display: 'inline-block' }}>
            <button type="button"
              onClick={() => setShowTemplateDropdown((prev) => !prev)}
              className="toolbar-btn"
              title="Quick Dispatch — create call from template"
            >
              <FileText style={{ width: 10, height: 10 }} />
              Quick
              <ChevronDown
                className="w-3 h-3 ml-0.5 transition-transform"
                style={{ transform: showTemplateDropdown ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            </button>
            {showTemplateDropdown && (
              <div
                className="absolute z-50 mt-1"
                style={{
                  top: '100%',
                  left: 0,
                  minWidth: '220px',
                  maxHeight: '280px',
                  overflowY: 'auto',
                  background: '#141414',
                  border: '1px solid #2a2a2a',
                  borderRadius: '2px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                }}
              >
                {templates.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-rmpg-400 text-center italic">No templates available</div>
                ) : (
                  templates.map((tpl: any) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => {
                        setQuickTemplateData({
                          name: tpl.name || tpl.incident_type,
                          incident_type: tpl.incident_type,
                          priority: tpl.priority || 'P3',
                          description: tpl.description || '',
                          source: tpl.source || 'phone',
                        });
                        setQuickTemplateAddress(tpl.location || tpl.location_address || '');
                        setQuickTemplateCoords({ lat: null, lng: null });
                        setQuickTemplateSubmitting(false);
                        setShowTemplateDropdown(false);
                      }}
                      className="w-full flex flex-col items-start px-3 py-2 text-left transition-colors"
                      style={{ fontSize: '11px', color: '#aaaaaa', background: 'transparent', border: 'none', borderRadius: 0 }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2e2e2e'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <span className="font-bold text-white" style={{ fontSize: '11px' }}>{tpl.name || formatIncidentType(tpl.incident_type)}</span>
                      {tpl.description && <span className="text-rmpg-400 truncate w-full" style={{ fontSize: '10px' }}>{tpl.description}</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button type="button"
            onClick={() => setShowQuickPsoModal(true)}
            className="toolbar-btn"
            title="Quick PSO Client Request (P)"
            style={{
              background: 'linear-gradient(180deg, #7c3aed 0%, #6b21a8 100%)',
              borderColor: '#7c3aed',
              borderBottomColor: '#212121',
              borderRightColor: '#212121',
              color: '#ffffff',
            }}
          >
            <Shield style={{ width: 10, height: 10 }} />
            PSO
          </button>
        </PanelTitleBar>
        <TabBar
          tabs={[
            { id: 'all', label: 'All', count: tabCounts.all },
            { id: 'mine', label: 'Mine', count: tabCounts.mine },
            { id: 'pending', label: 'Pending', count: tabCounts.pending },
            { id: 'active', label: 'Active', count: tabCounts.active },
            { id: 'serve', label: 'Serve', count: tabCounts.serve },
            { id: 'cleared', label: 'Cleared', count: tabCounts.cleared },
            { id: 'archived', label: 'Archive', count: tabCounts.archived },
          ]}
          activeTab={filterTab}
          onTabChange={(id) => setFilterTab(id as FilterTab)}
        />

        {/* Dispatch Stats Strip */}
        <div className="px-3 py-1.5 border-b border-[#2b2b2b] flex items-center gap-3 flex-wrap text-[9px] font-mono flex-shrink-0 tabular-nums" style={{ background: '#050505' }}>
          {(() => {
            const activeCalls = calls.filter(c => ['dispatched', 'enroute', 'onscene', 'pending', 'on_hold'].includes(c.status));
            const p1Count = activeCalls.filter(c => c.priority === 'P1').length;
            const p2Count = activeCalls.filter(c => c.priority === 'P2').length;
            const pendingCount = calls.filter(c => c.status === 'pending').length;
            return (
              <>
                {p1Count > 0 && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 font-bold animate-pulse" style={{ background: 'rgba(220,38,38,0.2)', border: '1px solid rgba(220,38,38,0.4)', color: '#f87171', boxShadow: '0 0 6px rgba(220,38,38,0.3)' }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" style={{ boxShadow: '0 0 4px #ef4444' }} />
                    P1: {p1Count}
                  </span>
                )}
                <span className="text-rmpg-400">P2: <strong className="text-amber-400">{p2Count}</strong></span>
                <span className="text-rmpg-400">Pending: <strong className="text-gray-400">{pendingCount}</strong></span>
                <span className="text-rmpg-400">Active: <strong className="text-green-400">{tabCounts.active}</strong></span>
                {/* Stacked calls indicator */}
                {(() => {
                  const stackedLocations = new Map<string, number>();
                  calls.filter(c => ['pending', 'dispatched', 'enroute', 'onscene', 'on_hold'].includes(c.status)).forEach(c => {
                    if (c.location) {
                      const loc = c.location.toLowerCase().trim();
                      stackedLocations.set(loc, (stackedLocations.get(loc) || 0) + 1);
                    }
                  });
                  const stacked = [...stackedLocations.entries()].filter(([, count]) => count > 1);
                  if (stacked.length > 0) {
                    return (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 font-bold text-[9px] rounded-sm" style={{ background: 'rgba(168,85,247,0.15)', color: '#c084fc', border: '1px solid rgba(168,85,247,0.3)' }} title={`${stacked.length} location(s) with multiple active calls`}>
                        <Link className="w-2.5 h-2.5" /> STACKED: {stacked.length}
                      </span>
                    );
                  }
                  return null;
                })()}
                {/* Feature 4: Unit availability counter — extended breakdown */}
                <span className="flex items-center gap-2 text-[#6b7280]" title={`${unitAvailability.available} available · ${unitAvailability.enroute} enroute/dispatched · ${unitAvailability.onscene} on-scene · ${unitAvailability.oos} out-of-service`}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: unitAvailability.available > 0 ? '#22c55e' : '#ef4444', boxShadow: `0 0 4px ${unitAvailability.available > 0 ? '#22c55e80' : '#ef444480'}` }} />
                  <span style={{ color: unitAvailability.available > 0 ? '#4ade80' : '#f87171' }}><strong>{unitAvailability.available}</strong> AVAIL</span>
                  {unitAvailability.enroute > 0 && <span className="text-amber-400"><strong>{unitAvailability.enroute}</strong> ENR</span>}
                  {unitAvailability.onscene > 0 && <span className="text-blue-300"><strong>{unitAvailability.onscene}</strong> OS</span>}
                  {unitAvailability.oos > 0 && <span className="text-rmpg-500"><strong>{unitAvailability.oos}</strong> OOS</span>}
                </span>
                {/* Sort mode toggle — cycle priority → time → status */}
                {(() => {
                  const current = (userPrefs?.dispatch_sort || 'priority') as 'priority' | 'time' | 'status';
                  const next: Record<string, 'priority' | 'time' | 'status'> = { priority: 'time', time: 'status', status: 'priority' };
                  const labels: Record<string, string> = { priority: 'PRI', time: 'NEW', status: 'STA' };
                  return (
                    <button
                      type="button"
                      title={`Sort: ${current.toUpperCase()} (click to cycle)`}
                      onClick={async () => {
                        try {
                          await apiFetch('/user/preferences', {
                            method: 'PUT',
                            body: JSON.stringify({ dispatch_sort: next[current] }),
                          });
                          reloadPrefs();
                        } catch { addToast('Failed to update sort', 'error'); }
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold border border-rmpg-700/50 hover:brightness-125 transition-all"
                      style={{ background: '#0d0d0d', color: '#d4a017' }}
                    >
                      SORT: {labels[current]}
                    </button>
                  );
                })()}
                {/* Activity sparkline — calls created per 5-min over last hour */}
                {(() => {
                  const buckets = new Array(12).fill(0);
                  const now = Date.now();
                  calls.forEach(c => {
                    if (!c.created_at) return;
                    const t = new Date(c.created_at).getTime();
                    const ageMin = (now - t) / 60000;
                    if (ageMin < 0 || ageMin > 60) return;
                    const idx = Math.min(11, Math.floor(ageMin / 5));
                    buckets[11 - idx]++;
                  });
                  const max = Math.max(1, ...buckets);
                  const total = buckets.reduce((a, b) => a + b, 0);
                  return (
                    <span className="flex items-center gap-1 text-rmpg-500" title={`Calls created per 5-min bucket over last hour (total: ${total})`}>
                      <span className="text-[8px] text-rmpg-600">1HR</span>
                      <svg width="60" height="14" viewBox="0 0 60 14" style={{ display: 'block' }}>
                        {buckets.map((v, i) => {
                          const h = Math.max(1, Math.round((v / max) * 12));
                          return <rect key={i} x={i * 5} y={14 - h} width={4} height={h} fill={v > 0 ? '#d4a017' : '#2b2b2b'} />;
                        })}
                      </svg>
                      <strong className="text-rmpg-300">{total}</strong>
                    </span>
                  );
                })()}
                <span className="text-rmpg-500 ml-auto">
                  {filteredCalls.length} calls
                </span>
              </>
            );
          })()}
        </div>

        {/* Operational Intelligence Strip — response times + shift throughput + priority filter */}
        {(() => {
          const todayCalls = calls.filter(c => {
            if (!c.created_at) return false;
            const d = new Date(c.created_at);
            const now = new Date();
            return d.toDateString() === now.toDateString();
          });
          const clearedToday = todayCalls.filter(c => ['cleared', 'closed', 'archived'].includes(c.status)).length;
          // Avg response time (created → onscene) for calls with onscene_at today
          const responseTimes = todayCalls
            .filter(c => c.onscene_at && c.created_at)
            .map(c => (new Date(c.onscene_at!).getTime() - new Date(c.created_at!).getTime()) / 60000)
            .filter(m => m > 0 && m < 480);
          const avgResponse = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null;
          // Oldest pending call age
          const pendingCalls = calls.filter(c => c.status === 'pending');
          const oldestPending = pendingCalls.length > 0
            ? Math.round((Date.now() - Math.min(...pendingCalls.map(c => new Date(c.created_at || 0).getTime()))) / 60000)
            : null;

          return (
            <div className="px-3 py-1 border-b border-[#2b2b2b] flex items-center gap-3 flex-wrap text-[9px] font-mono flex-shrink-0" style={{ background: '#080808' }}>
              {/* Shift throughput */}
              <span className="text-rmpg-400 flex items-center gap-1">
                <span className="text-[8px] text-rmpg-600">TODAY</span>
                <strong className="text-white">{todayCalls.length}</strong> calls
                <span className="text-rmpg-600">·</span>
                <strong className="text-green-400">{clearedToday}</strong> cleared
              </span>
              {/* Avg response */}
              {avgResponse !== null && (
                <span className={`flex items-center gap-1 px-1.5 py-0.5 border ${avgResponse <= 8 ? 'text-green-400 border-green-700/40 bg-green-900/20' : avgResponse <= 15 ? 'text-amber-400 border-amber-700/40 bg-amber-900/20' : 'text-red-400 border-red-700/40 bg-red-900/20'}`}>
                  AVG RESPONSE: <strong>{avgResponse}m</strong>
                </span>
              )}
              {/* Oldest pending */}
              {oldestPending !== null && oldestPending > 0 && (
                <span className={`flex items-center gap-1 px-1.5 py-0.5 border ${oldestPending <= 5 ? 'text-rmpg-400 border-rmpg-700/40' : oldestPending <= 15 ? 'text-amber-400 border-amber-700/40 bg-amber-900/10 animate-pulse' : 'text-red-400 border-red-700/40 bg-red-900/20 animate-pulse'}`}>
                  OLDEST WAIT: <strong>{oldestPending}m</strong>
                </span>
              )}
              {/* Priority quick filters */}
              <div className="ml-auto flex items-center gap-0.5">
                <span className="text-[8px] text-rmpg-600 mr-1">PRIORITY</span>
                {(['P1', 'P2', 'P3', 'P4'] as const).map(p => {
                  const count = calls.filter(c => c.priority === p && !['cleared', 'closed', 'archived', 'cancelled'].includes(c.status)).length;
                  const colors: Record<string, string> = {
                    P1: 'bg-red-900/40 text-red-400 border-red-700/50',
                    P2: 'bg-amber-900/40 text-amber-400 border-amber-700/50',
                    P3: 'bg-gray-900/40 text-gray-400 border-gray-700/50',
                    P4: 'bg-green-900/40 text-green-400 border-green-700/50',
                  };
                  return (
                    <span key={p} className={`px-1.5 py-0.5 text-[8px] font-bold border ${colors[p]} ${count > 0 ? '' : 'opacity-30'}`}>
                      {p}:{count}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Feature 9: Call Type Statistics Bar */}
        {callTypeStats.length > 0 && (
          <div className="px-3 py-1 border-b border-[#2b2b2b] flex items-center gap-2 flex-shrink-0" style={{ background: '#0c0c0c80' }}>
            {callTypeStats.map(({ type, count }) => {
              const total = callTypeStats.reduce((sum, s) => sum + s.count, 0);
              const pct = total > 0 ? (count / total * 100) : 0;
              return (
                <div key={type} className="flex items-center gap-0.5" title={`${formatIncidentType(type)}: ${count}`}>
                  <div
                    className="h-2 rounded-sm bg-brand-500"
                    style={{ width: `${Math.max(pct * 0.8, 4)}px`, minWidth: 4, opacity: 0.7 + pct * 0.003 }}
                  />
                  <span className="text-[7px] font-mono text-rmpg-400 truncate max-w-[80px] tabular-nums" title={formatIncidentType(type)}>
                    {formatIncidentType(type).slice(0, 12)} {count}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Feature 14: Disposition Statistics (collapsed by default) */}
        {dispositionStats.length > 0 && filterTab === 'cleared' && (
          <div className="px-3 py-1 border-b border-[#2b2b2b] flex items-center gap-2 flex-wrap text-[8px] font-mono flex-shrink-0" style={{ background: '#0c0c0c80' }}>
            <span className="text-rmpg-500 font-bold">DISPS:</span>
            {dispositionStats.slice(0, 5).map(d => (
              <span key={d.disposition} className="text-rmpg-400">
                {d.disposition}: <strong className="text-rmpg-200">{d.count}</strong>
              </span>
            ))}
          </div>
        )}

        {/* Call List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1" style={{ scrollbarGutter: 'stable', scrollSnapType: 'y proximity', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' } as React.CSSProperties}>
          {filteredCalls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[#6b7280]">
              <div className="p-3.5 rounded-sm mb-3" style={{ background: '#0c0c0c50', border: '1px solid #2b2b2b30' }}>
                <Phone className="w-7 h-7" style={{ opacity: 0.35 }} />
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5">No calls in this category</p>
              <p className="text-[10px] text-[#545454] max-w-[200px] text-center leading-relaxed">
                {filterTab === 'pending' ? 'All pending calls have been dispatched' :
                 filterTab === 'active' ? 'No units are currently on active calls' :
                 filterTab === 'cleared' ? 'No cleared calls to review' :
                 filterTab === 'archived' ? 'No archived calls found' :
                 filterTab === 'serve' ? 'No PSO client requests in queue' :
                 'Press N to create a new call'}
              </p>
              {filterTab === 'all' && (
                <button type="button"
                  onClick={() => { setTemplateInitialData(undefined); setShowNewCallModal(true); }}
                  className="mt-4 toolbar-btn toolbar-btn-primary text-[10px]"
                >
                  <Plus style={{ width: 10, height: 10 }} /> New Call
                </button>
              )}
            </div>
          ) : (
            filteredCalls.map((call) => (
              <CallCard
                key={call.id}
                call={call}
                isSelected={selectedCall?.id === call.id}
                onClick={setSelectedCall}
                onUnitDrop={handleDragAssignUnit}
                onStatusChange={(callId, newStatus) => handleStatusChange(callId, newStatus as CallStatus)}
                onContextMenu={(e, c) => setContextMenu({ x: e.clientX, y: e.clientY, call: c })}
                stackCount={call.location ? stackedCallCounts.get(call.location.toLowerCase().trim()) : undefined}
                onQuickNote={handleQuickNote}
                hasActiveWarrant={!!(call as any).has_active_warrant}
                onTogglePin={handleTogglePin}
              />
            ))
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* RIGHT PANEL - Call Detail + Map (top), USB (bottom shorter) */}
      {/* ============================================================ */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ------------------------------------------------------------ */}
        {/* TOP - Call Detail (left) + Map (right) — ~65% height */}
        {/* ------------------------------------------------------------ */}
        <div className="flex-1 flex border-b border-[#2b2b2b] min-h-0">
          {/* Call Detail Panel */}
          <div ref={callDetailRef} className={`flex-1 flex flex-col overflow-hidden min-w-0${isEditing ? ' edit-mode-active' : ''}`}>
          {selectedCall ? (
            <>
              {/* Detail Header — PanelTitleBar style */}
              <div className="flex-shrink-0" style={selectedCall.priority === 'P1' ? { borderLeft: '3px solid #ef4444', background: 'linear-gradient(90deg, rgba(239,68,68,0.08) 0%, transparent 30%)' } : selectedCall.priority === 'P2' ? { borderLeft: '3px solid #f59e0b' } : { borderLeft: '3px solid #888888' }}>
                {/* Row 1: Call identification */}
                <div className="panel-title-bar flex items-center gap-2" style={{ borderBottom: 'none' }}>
                  {selectedCall.priority === 'P1' && (
                    <AlertTriangle className="w-4 h-4 text-red-500 animate-emergency-blink shrink-0" style={{ filter: 'drop-shadow(0 0 4px rgba(239,68,68,0.5))' }} />
                  )}
                  <span
                    className="text-sm font-bold text-green-400 font-mono tracking-wide tabular-nums whitespace-nowrap cursor-pointer hover:text-green-300 transition-colors"
                    style={{ textShadow: '0 0 8px rgba(74,222,128,0.2)' }}
                    title="Click to copy"
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(selectedCall.call_number || ''); addToast(`Copied ${selectedCall.call_number}`, 'success'); }}
                  >{selectedCall.call_number}</span>
                  {/* Case Number — editable by admin/manager */}
                  {(selectedCall.case_number || isAdminOrManager) && (
                    editingTimestamp === 'case_number' ? (
                      <input
                        type="text"
                        className="input-dark text-[10px] font-mono font-bold px-1.5 py-0.5 w-[160px]"
                        defaultValue={selectedCall.case_number || ''}
                        placeholder="Enter case number..."
                        autoFocus
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = (e.target as HTMLInputElement).value.trim();
                            try {
                              const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`, { method: 'PUT', body: JSON.stringify({ case_number: val || null }) });
                              const updated = mapDbCall(result);
                              setCalls(prev => prev.map(c => c.id === updated.id ? updated : c));
                              setSelectedCall(updated);
                              addToast(val ? `Case number set to ${val}` : 'Case number cleared', 'success');
                            } catch { addToast('Failed to update case number', 'error'); }
                            setEditingTimestamp(null);
                          }
                          if (e.key === 'Escape') setEditingTimestamp(null);
                        }}
                        onBlur={async (e) => {
                          // Save on blur (don't discard changes)
                          const val = e.target.value.trim();
                          if (val !== (selectedCall.case_number || '')) {
                            try {
                              const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`, { method: 'PUT', body: JSON.stringify({ case_number: val || null }) });
                              const updated = mapDbCall(result);
                              setCalls(prev => prev.map(c => c.id === updated.id ? updated : c));
                              setSelectedCall(updated);
                            } catch { /* silent on blur */ }
                          }
                          setEditingTimestamp(null);
                        }}
                      />
                    ) : (
                      <span
                        className={`text-[10px] font-bold font-mono px-1.5 py-0.5 whitespace-nowrap ${selectedCall.case_number ? 'text-amber-300 bg-amber-900/30 border border-amber-700/40' : 'text-rmpg-600 border border-dashed border-rmpg-600/40'} ${isAdminOrManager ? 'cursor-pointer hover:brightness-125' : ''}`}
                        onClick={() => isAdminOrManager && setEditingTimestamp('case_number')}
                        title={isAdminOrManager ? 'Click to edit case number' : undefined}
                      >
                        {selectedCall.case_number ? `CASE ${selectedCall.case_number}` : isAdminOrManager ? '+ CASE #' : ''}
                      </span>
                    )
                  )}
                  {/* Incident Number — editable by admin/manager */}
                  {(selectedCall.incident_number || isAdminOrManager) && (
                    editingTimestamp === 'incident_number' ? (
                      <input
                        type="text"
                        className="input-dark text-[10px] font-mono font-bold px-1.5 py-0.5 w-[160px]"
                        defaultValue={(selectedCall as any).incident_number || ''}
                        placeholder="Incident #"
                        autoFocus
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value.trim();
                            try {
                              const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`, { method: 'PUT', body: JSON.stringify({ case_number: val || null }) });
                              const updated = mapDbCall(result);
                              setCalls(prev => prev.map(c => c.id === updated.id ? updated : c));
                              setSelectedCall(updated);
                              addToast(val ? `Linked to incident ${val}` : 'Incident link cleared', 'success');
                            } catch { addToast('Failed to update incident link', 'error'); }
                            setEditingTimestamp(null);
                          }
                          if (e.key === 'Escape') setEditingTimestamp(null);
                        }}
                        onBlur={() => setEditingTimestamp(null)}
                      />
                    ) : selectedCall.incident_number ? (
                      <span
                        className={`text-[10px] font-bold font-mono text-gray-300 bg-gray-900/30 border border-gray-700/40 px-1.5 py-0.5 whitespace-nowrap cursor-pointer hover:brightness-125 hover:text-gray-200 transition-colors`}
                        onClick={(e) => {
                          if (isAdminOrManager && e.shiftKey) {
                            setEditingTimestamp('incident_number');
                          } else {
                            // Navigate to incident
                            window.open(`/incidents?search=${encodeURIComponent(selectedCall.incident_number!)}`, '_blank');
                          }
                        }}
                        title={isAdminOrManager ? 'Click to view incident (Shift+click to edit)' : 'Click to view incident'}
                      >
                        <Link style={{ width: 8, height: 8, display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />
                        INC {selectedCall.incident_number}
                      </span>
                    ) : null
                  )}
                  <StatusBadge status={selectedCall.priority} type="priority" size="sm" title={humanizePriority(selectedCall.priority)} />
                  <StatusBadge status={selectedCall.status} type="call_status" size="sm" title={getStatusTooltip(selectedCall.status, 'call')} />
                  {callWarnings.length > 0 && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold font-mono text-red-400 bg-red-900/30 border border-red-700/50 animate-pulse whitespace-nowrap">
                      <AlertTriangle style={{ width: 9, height: 9 }} /> {callWarnings.length} ALERT{callWarnings.length !== 1 ? 'S' : ''}
                    </span>
                  )}
                  {/* On-scene live timer */}
                  {onSceneElapsed && (
                    <span className="ml-auto flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold font-mono text-purple-300 bg-purple-900/20 border border-purple-700/30 whitespace-nowrap tabular-nums" title="Time on scene">
                      <Clock style={{ width: 9, height: 9 }} /> On scene: {onSceneElapsed}
                    </span>
                  )}
                  {/* Total elapsed timer (since call creation) */}
                  {selectedCall.created_at && !['cleared', 'closed', 'archived', 'cancelled'].includes(selectedCall.status) && (
                    <span className={`${onSceneElapsed ? '' : 'ml-auto'} flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold font-mono whitespace-nowrap tabular-nums ${
                      (() => {
                        const mins = Math.round((Date.now() - new Date(selectedCall.created_at).getTime()) / 60000);
                        if (mins > 60) return 'text-red-400 bg-red-900/20 border border-red-700/30';
                        if (mins > 30) return 'text-amber-400 bg-amber-900/20 border border-amber-700/30';
                        return 'text-rmpg-400 bg-rmpg-900/20 border border-rmpg-700/30';
                      })()
                    }`} title="Total call duration">
                      <Clock style={{ width: 9, height: 9 }} />
                      {(() => {
                        const mins = Math.round((Date.now() - new Date(selectedCall.created_at).getTime()) / 60000);
                        return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
                      })()}
                    </span>
                  )}
                </div>
                {/* Row 2: Action buttons — separate row to prevent cramping */}
                <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[#2b2b2b] overflow-x-auto whitespace-nowrap scrollbar-dark" style={{ background: '#050505' }}>
                  {isEditing ? (
                    // While editing, the in-form values aren't yet on selectedCall,
                    // so a print right now would generate a PDF missing whatever
                    // the dispatcher just typed. Block printing until SAVE so
                    // operators get a clear cue rather than a silently-incomplete PDF.
                    <button
                      type="button"
                      disabled
                      className="toolbar-btn opacity-50 cursor-not-allowed"
                      title="Save your edits before printing — the PDF reads from the saved record, not the in-progress form"
                    >
                      <Printer style={{ width: 10, height: 10 }} /> Print (save first)
                    </button>
                  ) : (
                    <PrintRecordButton
                      recordType="call"
                      recordData={{
                        ...applyCallPdfAutofill(selectedCall),
                        // Enrich with unit detail table for PDF
                        assigned_units_detail: (selectedCall?.assigned_units || []).map((uid: string) => {
                          const u = units.find(unit => String(unit.id) === String(uid));
                          return {
                            call_sign: u?.call_sign || uid,
                            officer_name: u?.officer_name || '',
                            badge_number: (u as any)?.badge_number || (officers.find(o => o.full_name === u?.officer_name)?.badge_number) || '',
                            status: u?.status || '',
                          };
                        }),
                        // Linked persons for PDF table
                        linked_persons: callPersons.map((cp: any) => ({
                          role: cp.role || '',
                          first_name: cp.first_name || '',
                          last_name: cp.last_name || '',
                          dob: cp.dob || '',
                          race: cp.race || '',
                          gender: cp.gender || cp.sex || '',
                          phone: cp.phone || '',
                        })),
                        // Linked vehicles for PDF table
                        linked_vehicles: callVehicles.map((cv: any) => ({
                          role: cv.role || '',
                          plate_number: cv.plate_number || '',
                          plate_state: cv.plate_state || '',
                          year: cv.year,
                          color: cv.color || '',
                          make: cv.make || '',
                          model: cv.model || '',
                          vin: cv.vin || '',
                          owner_first_name: cv.owner_first_name || '',
                          owner_last_name: cv.owner_last_name || '',
                          stolen_status: cv.stolen_status || '',
                        })),
                        // Map CallNote -> PDF notes format (text→content, timestamp→created_at)
                        notes: selectedCall?.notes?.map((n: any) => ({
                          id: n.id,
                          author: n.author || 'System',
                          content: n.text || '',
                          created_at: n.timestamp || '',
                        })),
                        // Build narrative from notes for PDF
                        narrative: selectedCall?.notes?.map((n: any) =>
                          `[${n.timestamp ? formatTime(n.timestamp) : ''}] ${n.author || 'System'}: ${n.text || ''}`
                        ).join('\n') || '',
                      }}
                      identifier={selectedCall?.call_number}
                      entityType="call"
                      entityId={selectedCall?.id}
                      label="Print"
                    />
                  )}
                    {/* Edit toggle */}
                    {!isEditing && (
                      <button type="button" onClick={startEditing} className="toolbar-btn" title="Edit call details">
                        <Edit3 style={{ width: 10, height: 10 }} /> Edit
                      </button>
                    )}
                    {isEditing && (
                      <>
                        <button type="button" onClick={saveEditing} disabled={isSaving} className="toolbar-btn toolbar-btn-primary">
                          {isSaving ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <Save style={{ width: 10, height: 10 }} />} Save
                        </button>
                        <button type="button" onClick={cancelEditing} disabled={isSaving} className="toolbar-btn">
                          <X style={{ width: 10, height: 10 }} /> Cancel
                        </button>
                      </>
                    )}
                    {/* NCIC Terminal button */}
                    {!isEditing && (
                      <button type="button"
                        onClick={() => setShowNcicPanel(true)}
                        className="toolbar-btn"
                        title="NCIC / NLETS Query Terminal"
                        style={{ color: '#4ade80' }}
                      >
                        <Terminal style={{ width: 10, height: 10 }} /> NCIC
                      </button>
                    )}
                    {/* Route Builder — navigate to multi-stop CFS route planner for assigned units */}
                    {!isEditing && (selectedCall.assigned_units || []).length > 0 && (
                      <button type="button"
                        className="toolbar-btn"
                        title="Open Route Builder for assigned unit"
                        style={{ color: '#d4a017' }}
                        onClick={() => {
                          const firstUnitId = selectedCall.assigned_units?.[0];
                          if (!firstUnitId) return;
                          navigate(`/route-builder?unit=${encodeURIComponent(String(firstUnitId))}`);
                        }}
                      >
                        <Route style={{ width: 10, height: 10 }} /> Route
                      </button>
                    )}
                    {/* Schedule Return Visit — PSO/Process Service calls in completed states */}
                    {!isEditing && ['pso_client_request', 'process_service'].includes(selectedCall.incident_type) && ['cleared', 'closed', 'cancelled', 'on_hold', 'archived'].includes(selectedCall.status) && (
                      <button type="button"
                        className="toolbar-btn"
                        style={{ background: '#d4a01725', borderColor: '#d4a01750', color: '#d4a017' }}
                        onClick={async () => {
                          const attempt = (selectedCall.pso_attempt_number || 1) + 1;
                          const ordinal = attempt === 2 ? '2nd' : attempt === 3 ? '3rd' : `${attempt}th`;
                          if (!window.confirm(`Schedule ${ordinal} return visit for ${selectedCall.call_number}?`)) return;
                          try {
                            const result = await apiFetch(`/dispatch/calls/${selectedCall.id}/redispatch`, {
                              method: 'POST',
                              body: JSON.stringify({}),
                            });
                            if (result) {
                              const mapped = mapDbCall(result);
                              setCalls(prev => [mapped, ...prev]);
                              setSelectedCall(mapped);
                              addToast(`Re-dispatched → ${mapped.call_number}`, 'success');
                            }
                          } catch (err: any) { addToast(`Re-dispatch failed: ${err?.message || 'Unknown error'}`, 'error'); }
                        }}
                        title="Schedule a return visit — creates a new linked call"
                      >
                        <RotateCcw style={{ width: 10, height: 10 }} /> Return Visit
                      </button>
                    )}
                    {/* Undo Return Visit — only on pending child calls */}
                    {!isEditing && (selectedCall as any).parent_call_id && selectedCall.status === 'pending' && (
                      <button type="button"
                        className="toolbar-btn"
                        style={{ background: '#ef444420', borderColor: '#ef444450', color: '#ef4444' }}
                        onClick={async () => {
                          if (!window.confirm(`Undo this return visit? This will delete ${selectedCall.call_number} and restore the parent call.`)) return;
                          try {
                            const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/undo-redispatch`, { method: 'POST' });
                            if (result?.parent) {
                              const mapped = mapDbCall(result.parent);
                              setCalls(prev => prev.filter(c => c.id !== selectedCall.id).map(c => c.id === mapped.id ? mapped : c));
                              setSelectedCall(mapped);
                              addToast(`Return visit undone — restored ${mapped.call_number}`, 'success');
                            }
                          } catch (err: any) { addToast(`Failed to undo: ${err?.message || 'Unknown error'}`, 'error'); }
                        }}
                        title="Undo this return visit and delete this call"
                      >
                        <Undo2 style={{ width: 10, height: 10 }} /> Undo Visit
                      </button>
                    )}
                    {/* Send to Serve Queue — PSO calls */}
                    {selectedCall.incident_type === 'pso_client_request' && !serveLink && (
                      <button type="button"
                        className="toolbar-btn"
                        style={{ background: '#7c3aed20', borderColor: '#7c3aed50', color: '#a78bfa' }}
                        disabled={sendingToServe}
                        onClick={async () => {
                          setSendingToServe(true);
                          try {
                            const result = await apiFetch(`/dispatch/calls/${selectedCall.id}/send-to-serve`, {
                              method: 'POST',
                              body: JSON.stringify({}),
                            });
                            if (result) {
                              setServeLink(result);
                              addToast('Sent to Serve Queue', 'success');
                            }
                          } catch (err: any) {
                            addToast(`Failed: ${err?.message || 'Unknown error'}`, 'error');
                          } finally {
                            setSendingToServe(false);
                          }
                        }}
                        title="Send this process service to the serve queue"
                      >
                        <Briefcase style={{ width: 10, height: 10 }} /> {sendingToServe ? 'Sending...' : 'Serve Queue'}
                      </button>
                    )}
                    {/* Revert status button — go back one step */}
                    {!isEditing && ['dispatched', 'enroute', 'onscene', 'cleared', 'closed'].includes(selectedCall.status) && (
                      <button type="button"
                        onClick={() => handleRevertStatus(selectedCall.id)}
                        className="toolbar-btn"
                        title={`Revert to previous status`}
                        style={{ color: '#f59e0b' }}
                      >
                        <Undo2 style={{ width: 10, height: 10 }} /> Back
                      </button>
                    )}
                    {/* Status action toolbar buttons */}
                    {!isEditing && selectedCall.status === 'pending' && (
                      <button type="button" onClick={() => handleStatusChange(selectedCall.id, 'dispatched')} className="toolbar-btn toolbar-btn-primary">
                        <Send style={{ width: 10, height: 10 }} /> Dispatch
                      </button>
                    )}
                    {!isEditing && selectedCall.status === 'dispatched' && (
                      <button type="button" onClick={() => handleStatusChange(selectedCall.id, 'enroute')} className="toolbar-btn toolbar-btn-primary">
                        <Navigation style={{ width: 10, height: 10 }} /> En Route
                      </button>
                    )}
                    {!isEditing && selectedCall.status === 'enroute' && (
                      <button type="button" onClick={() => handleStatusChange(selectedCall.id, 'onscene')} className="toolbar-btn toolbar-btn-primary">
                        <Eye style={{ width: 10, height: 10 }} /> On Scene
                      </button>
                    )}
                    {!isEditing && ['dispatched', 'enroute', 'onscene'].includes(selectedCall.status) && (
                      <>
                        <button type="button" onClick={() => handleClearWithDisposition(selectedCall.id)} className="toolbar-btn">
                          <CheckCircle style={{ width: 10, height: 10 }} /> Clear
                        </button>
                        <button type="button" onClick={() => handleHoldCall(selectedCall.id)} className="toolbar-btn" style={{ color: '#f59e0b' }}>
                          ⏸ Hold
                        </button>
                        <button type="button" onClick={() => handleStatusChange(selectedCall.id, 'cancelled')} className="toolbar-btn" style={{ color: '#ef7a7a' }}>
                          <XCircle style={{ width: 10, height: 10 }} /> Cancel
                        </button>
                      </>
                    )}
                    {!isEditing && selectedCall.status === 'on_hold' && (
                      <button type="button" onClick={() => handleResumeCall(selectedCall.id)} className="toolbar-btn toolbar-btn-primary" style={{ background: '#f59e0b', color: '#000' }}>
                        ▶ Resume
                      </button>
                    )}
                    {!isEditing && selectedCall.status === 'cleared' && (
                      <>
                        <button type="button" onClick={() => handleStatusChange(selectedCall.id, 'closed')} className="toolbar-btn">
                          Close
                        </button>
                        <button type="button" onClick={handleGenerateIncident} disabled={isGenerating} className="toolbar-btn toolbar-btn-primary">
                          {isGenerating ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <FileText style={{ width: 10, height: 10 }} />}
                          Report
                        </button>
                      </>
                    )}
                    {!isEditing && selectedCall.status === 'closed' && (
                      <button type="button" onClick={handleGenerateIncident} disabled={isGenerating} className="toolbar-btn toolbar-btn-primary">
                        {isGenerating ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <FileText style={{ width: 10, height: 10 }} />}
                        Report
                      </button>
                    )}
                    {/* LE Notification */}
                    {!isEditing && !selectedCall.le_notified && selectedCall.status !== 'archived' && (
                      <button type="button" onClick={() => handleLeNotify(selectedCall.id)} className="toolbar-btn" style={{ color: '#f59e0b' }}>
                        <Radio style={{ width: 10, height: 10 }} /> Notify LE
                      </button>
                    )}
                    {selectedCall.le_notified && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-sm" style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.3)', boxShadow: '0 0 4px rgba(34,197,94,0.1)' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e', boxShadow: '0 0 3px #22c55e80' }} />
                        LE NOTIFIED {selectedCall.le_agency ? `(${selectedCall.le_agency})` : ''}
                      </span>
                    )}
                    {/* Archive — available on any non-archived status */}
                    {!isEditing && selectedCall.status !== 'archived' && (
                      <button type="button" onClick={() => handleArchive(selectedCall.id)} className="toolbar-btn" title="Archive this call">
                        <Archive style={{ width: 10, height: 10 }} /> Archive
                      </button>
                    )}
                    {!isEditing && selectedCall.status === 'archived' && (
                      <button type="button" onClick={() => handleUnarchive(selectedCall.id)} className="toolbar-btn">
                        <RotateCcw style={{ width: 10, height: 10 }} /> Restore
                      </button>
                    )}
                    {/* Delete — available on any call */}
                    {!isEditing && (
                      <button type="button" onClick={() => setDeleteCallTarget(selectedCall)} className="toolbar-btn text-red-400 hover:text-red-300" title="Delete this call permanently">
                        <Trash2 style={{ width: 10, height: 10 }} /> Delete
                      </button>
                    )}
                  </div>
                </div>

              {/* Warning Tags / Caution Alerts — always visible above tabs */}
              {callWarnings.length > 0 && (
                <div className="px-4 pt-2 pb-1.5 flex-shrink-0" style={{ background: 'rgba(220,38,38,0.05)', borderBottom: '1px solid rgba(220,38,38,0.15)' }}>
                  <label className="text-[9px] font-bold text-red-400 uppercase tracking-[0.1em] flex items-center gap-1.5 mb-1.5">
                    <AlertTriangle style={{ width: 10, height: 10, filter: 'drop-shadow(0 0 3px rgba(239,68,68,0.4))' }} /> CAUTION / WARNINGS
                  </label>
                  <WarningTags warnings={callWarnings} />
                </div>
              )}

              {/* Call Duration + Response Time + Safety Summary — always visible above tabs */}
              {!isEditing && (
                <div className="px-4 py-1.5 flex items-center gap-3 flex-shrink-0 flex-wrap" style={{ background: '#050505', borderBottom: '1px solid #2b2b2b' }}>
                  {/* Call duration — running timer */}
                  <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums">
                    <Clock style={{ width: 10, height: 10 }} className="text-rmpg-500" />
                    <span className="text-rmpg-400">Duration:</span>
                    <span className="text-rmpg-200 font-bold">
                      {(() => {
                        const endTime = selectedCall.status === 'archived' ? (selectedCall.archived_at || selectedCall.cleared_at || (selectedCall as any).closed_at) : ['cleared', 'closed', 'cancelled'].includes(selectedCall.status) ? (selectedCall.cleared_at || (selectedCall as any).closed_at || selectedCall.created_at) : null;
                        const elapsed = (endTime ? new Date(endTime).getTime() : Date.now()) - new Date(selectedCall.created_at).getTime();
                        return formatCallDuration(elapsed);
                      })()}
                    </span>
                  </div>
                  {/* Response time — dispatched to on scene */}
                  {selectedCall.dispatched_at && selectedCall.onscene_at && (() => {
                    const diff = new Date(selectedCall.onscene_at).getTime() - new Date(selectedCall.dispatched_at).getTime();
                    if (diff <= 0 || !isFinite(diff)) return null;
                    return (
                      <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums">
                        <Navigation style={{ width: 10, height: 10 }} className="text-gray-500" />
                        <span className="text-rmpg-400">Response:</span>
                        <span className="text-gray-400 font-bold">{formatCallDuration(diff)}</span>
                      </div>
                    );
                  })()}
                  {/* On-scene time — onscene to cleared (or live if still on scene) */}
                  {selectedCall.onscene_at && (() => {
                    const endTime = selectedCall.cleared_at || (selectedCall as any).closed_at || (selectedCall.status === 'archived' ? selectedCall.archived_at : null);
                    const diff = (endTime ? new Date(endTime).getTime() : Date.now()) - new Date(selectedCall.onscene_at).getTime();
                    if (diff <= 0 || !isFinite(diff)) return null;
                    return (
                      <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums">
                        <Clock style={{ width: 10, height: 10 }} className="text-gray-500" />
                        <span className="text-rmpg-400">On-Scene:</span>
                        <span className="text-gray-400 font-bold">{formatCallDuration(diff)}</span>
                      </div>
                    );
                  })()}
                  {/* Safety flag summary — compact inline */}
                  {(() => {
                    const flags: string[] = [];
                    if (selectedCall.weapons_involved && selectedCall.weapons_involved !== 'None') flags.push('ARMED');
                    if ((selectedCall as any).domestic_violence) flags.push('DV');
                    if ((selectedCall as any).mental_health_crisis) flags.push('MH');
                    if ((selectedCall as any).officer_safety_caution) flags.push('SAFETY');
                    if ((selectedCall as any).felony_in_progress) flags.push('FELONY');
                    if ((selectedCall as any).vehicle_pursuit || (selectedCall as any).foot_pursuit) flags.push('PURSUIT');
                    if ((selectedCall as any).ems_requested) flags.push('EMS');
                    if ((selectedCall as any).injuries_reported) flags.push('INJ');
                    if (flags.length === 0) return null;
                    return (
                      <div className="flex items-center gap-1 ml-auto">
                        <AlertTriangle style={{ width: 10, height: 10 }} className="text-red-400" />
                        {flags.map(f => (
                          <span key={f} className="text-[8px] font-bold font-mono px-1 py-0" style={{ color: f === 'ARMED' || f === 'FELONY' ? '#fca5a5' : f === 'DV' ? '#fde047' : f === 'MH' ? '#c4b5fd' : f === 'PURSUIT' ? '#fb923c' : f === 'SAFETY' ? '#ef4444' : '#aaaaaa', background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.25)' }}>
                            {f}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Detail Tabs */}
              <div className="flex border-b border-[#2b2b2b] flex-shrink-0" style={{ background: '#050505' }}>
                {(['info', 'persons', 'timeline', 'notes', 'attachments', 'flags', 'audit'] as const).map(tab => {
                  const labels: Record<string, string> = { info: 'Info', persons: 'Individuals / Vehicles', timeline: 'Timeline', notes: 'Notes', attachments: 'Files', flags: 'Flags', audit: 'Audit' };
                  const icons: Record<string, React.ReactNode> = {
                    info: <FileText style={{ width: 9, height: 9 }} />,
                    persons: <User style={{ width: 9, height: 9 }} />,
                    timeline: <Clock style={{ width: 9, height: 9 }} />,
                    notes: <MessageSquare style={{ width: 9, height: 9 }} />,
                    attachments: <FileText style={{ width: 9, height: 9 }} />,
                    flags: <Shield style={{ width: 9, height: 9 }} />,
                    audit: <Shield style={{ width: 9, height: 9 }} />,
                  };
                  const counts: Record<string, number> = {
                    persons: callPersons.length + callVehicles.length,
                    timeline: activityEntries.length,
                    notes: (selectedCall?.notes || []).length,
                    audit: auditTrail.length,
                  };
                  const count = counts[tab];
                  const isActive = detailTab === tab;
                  return (
                    <button type="button"
                      key={tab}
                      onClick={() => setDetailTab(tab)}
                      className="relative px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-all duration-150"
                      style={{
                        color: isActive ? '#999999' : '#666666',
                        background: isActive ? 'rgba(42,42,42,0.6)' : 'transparent',
                        borderBottom: isActive ? '2px solid #d4a017' : '2px solid transparent',
                      }}
                      onMouseEnter={(e) => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = '#999999'; (e.currentTarget as HTMLElement).style.background = 'rgba(42,42,42,0.4)'; } }}
                      onMouseLeave={(e) => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = '#666666'; (e.currentTarget as HTMLElement).style.background = 'transparent'; } }}
                    >
                      <span className="flex items-center gap-1.5">
                        {icons[tab]}
                        {labels[tab]}
                        {count ? <span className="ml-0.5 min-w-[16px] text-center px-1 py-px text-[8px] rounded-sm font-mono tabular-nums" style={{ background: isActive ? '#88888825' : '#2b2b2b30', color: isActive ? '#999999' : '#666666' }}>{count}</span> : ''}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Detail Body — Scrollable, tab-controlled */}
              <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
                {/* ── CALL INFO SECTION (Info + Persons tab) ─── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 flex-shrink-0" style={{ display: detailTab === 'info' || detailTab === 'persons' ? undefined : 'none' }}>
                  {/* Left Column: Core Info */}
                  <div className="space-y-2">
                    <div>
                      <label className="field-label">Type:</label>
                      {isEditing ? (
                        <select className="select-dark text-xs mt-0.5" value={editData.incident_type} onChange={(e) => updateEditField('incident_type', e.target.value)}>
                          {Object.entries(INCIDENT_TYPE_CATEGORIES).map(([cat, types]) => (
                            <optgroup key={cat} label={cat}>{types.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}</optgroup>
                          ))}
                        </select>
                      ) : (
                        <p className="text-sm text-brand-400 font-medium">{formatIncidentType(selectedCall.incident_type)}</p>
                      )}
                    </div>
                    <div>
                      <label className="field-label">Location:</label>
                      {isEditing ? (
                        <input type="text" className="input-dark text-xs mt-0.5" value={editData.location} onChange={(e) => updateEditField('location', e.target.value)} />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-rmpg-300" />
                          <p className="text-sm text-white">{formatAddressDisplay(selectedCall.location)}</p>
                        </div>
                      )}
                      {!isEditing && selectedCall.property_name && (
                        <p className="text-xs text-rmpg-300 ml-5">{selectedCall.property_name}</p>
                      )}
                      {!isEditing && selectedCall.client_name && (
                        <p className="text-[10px] text-brand-400 ml-5 flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          {selectedCall.client_name}
                        </p>
                      )}
                      {/* Weather at call location — officer safety indicator */}
                      {!isEditing && selectedCall.weather_conditions && (
                        <p className="text-[10px] text-rmpg-400 ml-5 flex items-center gap-1">
                          <Thermometer style={{ width: 10, height: 10 }} />
                          <span className="text-rmpg-300">{selectedCall.weather_conditions}</span>
                          {selectedCall.lighting_conditions && <span className="text-rmpg-500 ml-1">/ {selectedCall.lighting_conditions}</span>}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="field-label">Description:</label>
                      {isEditing ? (
                        <>
                          <textarea className="textarea-dark text-xs mt-0.5" rows={3} value={editData.description} onChange={(e) => updateEditField('description', e.target.value)} />
                          <NarrativeAssist
                            notes={editData.description || ''}
                            incidentType={editData.incident_type || selectedCall.incident_type}
                            locationAddress={editData.location_address || selectedCall.location || ''}
                            onAccept={(narrative) => updateEditField('description', narrative)}
                          />
                        </>
                      ) : (
                        <p className="text-sm text-rmpg-200 leading-relaxed">{selectedCall.description}</p>
                      )}
                    </div>
                    {isEditing && (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="field-label">Source:</label>
                            <select className="select-dark text-xs mt-0.5" value={editData.source} onChange={(e) => updateEditField('source', e.target.value)}>
                              <option value="phone">Phone</option><option value="radio">Radio</option><option value="walk_in">Walk-In</option>
                              <option value="alarm">Alarm</option><option value="patrol">Patrol</option><option value="online">Online</option>
                              <option value="dispatch">Dispatch</option><option value="other">Other</option>
                            </select>
                          </div>
                          <div>
                            <label className="field-label">Priority:</label>
                            <select className="select-dark text-xs mt-0.5" value={editData.priority} onChange={(e) => updateEditField('priority', e.target.value)}>
                              <option value="P1">P1 - Emergency</option><option value="P2">P2 - Urgent</option>
                              <option value="P3">P3 - Routine</option><option value="P4">P4 - Scheduled</option>
                            </select>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="field-label">Client:</label>
                            <select className="select-dark text-xs mt-0.5" value={editData.client_id || ''} onChange={(e) => updateEditField('client_id', e.target.value)}>
                              <option value="">— No Client —</option>
                              {clientsList.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="field-label">Property:</label>
                            <select className="select-dark text-xs mt-0.5" value={editData.property_id || ''} onChange={(e) => updateEditField('property_id', e.target.value)}>
                              <option value="">— No Property —</option>
                              {propertiesList.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="field-label">Disposition:</label>
                          <select
                            className="select-dark text-xs mt-0.5"
                            value={editData.disposition || ''}
                            onChange={(e) => updateEditField('disposition', e.target.value)}
                          >
                            <option value="">— Select Disposition —</option>
                            {/* Feature 2: Common disposition quick-picks (always available) */}
                            <optgroup label="Common Dispositions">
                              <option value="Report Taken">Report Taken</option>
                              <option value="Unfounded">Unfounded</option>
                              <option value="GOA">Gone on Arrival</option>
                              <option value="Referred">Referred</option>
                              <option value="No Action">No Action Required</option>
                              <option value="Arrest">Arrest</option>
                              <option value="Warning">Warning Issued</option>
                              <option value="Citation">Citation Issued</option>
                              <option value="Trespass Warning">Trespass Warning</option>
                              <option value="Civil Matter">Civil Matter</option>
                            </optgroup>
                            {dispositionCodes.length > 0 && (
                              <optgroup label="Custom Codes">
                                {dispositionCodes.map((d) => (
                                  <option key={d.code} value={d.code}>
                                    {d.code} — {d.description}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </div>
                      </>
                    )}
                    {!isEditing && selectedCall.disposition && (
                      <div>
                        <label className="field-label">Disposition:</label>
                        <p className="text-sm text-rmpg-200">
                          <span className="inline-block px-2 py-0.5 bg-brand-900/40 text-brand-300 text-[11px] uppercase font-bold border border-brand-600/40 mr-1.5 rounded-sm tracking-wide">
                            {selectedCall.disposition}
                          </span>
                          {(() => {
                            const match = dispositionCodes.find((d) => d.code === selectedCall.disposition);
                            return match ? <span className="text-rmpg-300">{match.description}</span> : null;
                          })()}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Caller, Timeline, Units */}
                  <div className="space-y-2">
                    {/* Caller Info */}
                    <div>
                      <label className="field-label">Caller:</label>
                      {isEditing ? (
                        <div className="space-y-1 mt-0.5">
                          <input type="text" className="input-dark text-xs" placeholder="Caller name" value={editData.caller_name} onChange={(e) => updateEditField('caller_name', e.target.value)} />
                          <input type="text" inputMode="tel" className="input-dark text-xs" placeholder="Caller phone" value={editData.caller_phone} onChange={(e) => updateEditField('caller_phone', formatPhoneInput(e.target.value))} />
                          <input type="text" className="input-dark text-xs" placeholder="Caller address" value={editData.caller_address} onChange={(e) => updateEditField('caller_address', e.target.value)} />
                          <select className="select-dark text-xs" value={editData.caller_relationship} onChange={(e) => updateEditField('caller_relationship', e.target.value)}>
                            <option value="">-- Relationship --</option>
                            <option value="employee">Employee</option><option value="victim">Victim</option>
                            <option value="witness">Witness</option><option value="complainant">Complainant</option>
                            <option value="management">Management</option><option value="alarm_company">Alarm Company</option>
                            <option value="officer">Officer</option><option value="anonymous">Anonymous</option><option value="other">Other</option>
                          </select>
                        </div>
                      ) : (
                        <>
                          {(selectedCall.caller_name || selectedCall.caller_phone) && (
                            <>
                              <div className="flex items-center gap-1.5">
                                <User className="w-3.5 h-3.5 text-rmpg-300" />
                                <p className="text-sm text-white">{selectedCall.caller_name || 'Unknown'}</p>
                                {selectedCall.caller_relationship && <span className="text-[9px] text-rmpg-400">({selectedCall.caller_relationship})</span>}
                              </div>
                              {selectedCall.caller_phone && (
                                <div className="flex items-center gap-1.5 ml-5">
                                  <Phone className="w-3 h-3 text-rmpg-400" />
                                  <p className="text-xs text-rmpg-300">{formatPhoneDisplay(selectedCall.caller_phone)}</p>
                                </div>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </div>

                    {/* Timeline — editable by admin/manager */}
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="field-label">Timeline:</label>
                        {isAdminOrManager && <span className="text-[7px] text-rmpg-500 font-mono tracking-wider">ADMIN EDIT</span>}
                      </div>
                      <div className="space-y-0.5 mt-1.5 relative" style={{ paddingLeft: '12px', borderLeft: '2px solid #2b2b2b' }}>
                        {([
                          { label: 'Created', field: 'created_at', value: selectedCall.created_at, color: '#666666', showElapsed: true },
                          { label: 'Dispatched', field: 'dispatched_at', value: selectedCall.dispatched_at, color: '#f59e0b' },
                          { label: 'En Route', field: 'enroute_at', value: selectedCall.enroute_at, color: '#888888' },
                          { label: 'On Scene', field: 'onscene_at', value: selectedCall.onscene_at, color: '#a855f7' },
                          { label: 'Cleared', field: 'cleared_at', value: selectedCall.cleared_at, color: '#22c55e' },
                          { label: 'Closed', field: 'closed_at', value: (selectedCall as any).closed_at, color: '#666666' },
                          { label: 'Archived', field: 'archived_at', value: selectedCall.archived_at, color: '#666666' },
                        ] as { label: string; field: string; value: string | undefined; color: string; showElapsed?: boolean }[]).filter(ts => ts.value || isAdminOrManager).map(ts => (
                          <div key={ts.field} className="flex items-center gap-2 text-xs py-0.5 relative group">
                            <div className="absolute -left-[11px] top-1/2 -translate-y-1/2 w-2 h-2 rounded-full" style={{ background: ts.value ? ts.color : '#222222', border: '2px solid #0c0c0c', boxShadow: ts.value ? `0 0 4px ${ts.color}60` : 'none' }} />
                            <span className="text-[#9ca3af] text-[10px]" style={{ minWidth: '66px' }}>{ts.label}</span>
                            {editingTimestamp === ts.field ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="datetime-local"
                                  step="1"
                                  className="input-dark text-[10px] font-mono px-1 py-0.5 w-[175px]"
                                  defaultValue={ts.value ? new Date(new Date(ts.value).getTime() - new Date(ts.value).getTimezoneOffset() * 60000).toISOString().slice(0, 19) : ''}
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleTimelineEdit(ts.field, new Date((e.target as HTMLInputElement).value).toISOString());
                                    if (e.key === 'Escape') setEditingTimestamp(null);
                                  }}
                                  onBlur={(e) => {
                                    if (e.target.value) handleTimelineEdit(ts.field, new Date(e.target.value).toISOString());
                                    else setEditingTimestamp(null);
                                  }}
                                />
                                {ts.value && ts.field !== 'created_at' && (
                                  <button type="button" onClick={() => handleTimelineEdit(ts.field, null)} className="text-red-400 hover:text-red-300 p-0.5 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center" title="Clear timestamp">
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span
                                className={`text-white font-mono text-[10px] tabular-nums ${isAdminOrManager ? 'cursor-pointer hover:text-[#d4a017] group-hover:underline transition-colors' : ''}`}
                                onClick={() => isAdminOrManager && setEditingTimestamp(ts.field)}
                                title={isAdminOrManager ? 'Click to edit' : undefined}
                              >
                                {ts.value ? formatTime(ts.value) : <span className="text-rmpg-600 italic text-[9px]">— not set —</span>}
                              </span>
                            )}
                            {ts.showElapsed && ts.value && !editingTimestamp && (() => {
                              const ageMin = Math.floor((Date.now() - new Date(ts.value).getTime()) / 60000);
                              const ageColor = ageMin > 120 ? '#ef4444' : ageMin > 60 ? '#f97316' : ageMin > 30 ? '#eab308' : '#22c55e';
                              return <span className="text-[9px] font-mono tabular-nums font-bold" style={{ color: ageColor }}>({formatElapsed(ts.value)})</span>;
                            })()}
                          </div>
                        ))}
                        {/* Enhancement 26: Response time (dispatched → onscene) */}
                        {selectedCall.dispatched_at && selectedCall.onscene_at && (() => {
                          const diff = new Date(selectedCall.onscene_at).getTime() - new Date(selectedCall.dispatched_at).getTime();
                          if (diff <= 0 || !isFinite(diff)) return null;
                          const mins = Math.floor(diff / 60000);
                          const secs = Math.floor((diff % 60000) / 1000);
                          return (
                            <div className="flex justify-between items-center mt-1 pt-1 border-t border-rmpg-700/30">
                              <span className="text-rmpg-400 text-[10px]">Response Time</span>
                              <span className="text-gray-400 font-mono font-bold text-[10px]">{mins}m {secs}s</span>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Assigned Units */}
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="field-label">Assigned Units:</label>
                        {!isEditing && (isGodMode || !['cleared', 'closed', 'cancelled', 'archived'].includes(selectedCall.status)) && (
                          <div className="relative" ref={attachUnitDropdownRef} style={{ display: 'inline-block' }}>
                            <button type="button"
                              onClick={() => setShowAttachUnitDropdown((prev) => !prev)}
                              className="toolbar-btn"
                              style={{ padding: '1px 6px', fontSize: '9px' }}
                              title="Attach a unit to this call"
                            >
                              <PlusCircle style={{ width: 9, height: 9 }} /> Attach Unit
                            </button>
                            {showAttachUnitDropdown && (
                              <div
                                className="absolute z-50 mt-1"
                                style={{
                                  top: '100%',
                                  right: 0,
                                  minWidth: '240px',
                                }}
                              >
                                <UnitRecommendationPanel
                                  units={units.filter(u => u.status !== 'off_duty')}
                                  callLat={selectedCall.latitude}
                                  callLng={selectedCall.longitude}
                                  assignedUnitIds={(selectedCall.assigned_units || []).map(String)}
                                  onAssign={handleAssignUnit}
                                  onCreateUnit={() => { setShowAttachUnitDropdown(false); setShowCreateUnitModal(true); }}
                                  onClose={() => setShowAttachUnitDropdown(false)}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      {/* Feature 11: Auto-assign + Feature 18: Multi-unit buttons */}
                      {!isEditing && (isGodMode || !['cleared', 'closed', 'cancelled', 'archived'].includes(selectedCall.status)) && (
                        <div className="flex gap-1 mt-1 mb-1">
                          <button type="button"
                            onClick={() => handleAutoAssign(selectedCall.id)}
                            className="toolbar-btn text-[8px]"
                            style={{ padding: '1px 4px' }}
                            title="Auto-assign nearest available unit"
                          >
                            <Navigation style={{ width: 8, height: 8 }} /> Auto-assign
                          </button>
                          <button type="button"
                            onClick={() => handleSuggestClosestUnit(selectedCall.id)}
                            className="toolbar-btn text-[8px]"
                            style={{ padding: '1px 4px' }}
                            title="Show nearest available unit (without assigning)"
                          >
                            <Navigation style={{ width: 8, height: 8 }} /> Suggest
                          </button>
                          {/* Feature 19: Transfer button (only if a unit is assigned) */}
                          {(selectedCall.assigned_units || []).length > 0 && (
                            <div className="relative">
                              <select
                                className="input-dark text-[8px] py-0 px-1"
                                style={{ maxWidth: 120 }}
                                defaultValue=""
                                onChange={(e) => {
                                  if (e.target.value && selectedCall.assigned_units.length > 0) {
                                    handleTransferCall(selectedCall.id, String(selectedCall.assigned_units[0]), e.target.value);
                                    e.target.value = '';
                                  }
                                }}
                              >
                                <option value="" disabled>Transfer to...</option>
                                {units.filter(u => u.status === 'available' && !selectedCall.assigned_units.includes(u.id)).map(u => (
                                  <option key={u.id} value={u.id}>{u.call_sign}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      )}
                      {(selectedCall.assigned_units || []).length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {(selectedCall.assigned_units || []).map((unitIdStr) => {
                            const unitObj = units.find((u) => String(u.id) === String(unitIdStr));
                            const displayName = unitObj ? unitObj.call_sign : unitIdStr;
                            const statusColor = unitObj ? (
                              unitObj.status === 'onscene' ? '#a855f7' :
                              unitObj.status === 'enroute' ? '#888888' :
                              unitObj.status === 'dispatched' ? '#f59e0b' :
                              '#22c55e'
                            ) : '#666666';
                            const statusLabel = unitObj ? (
                              unitObj.status === 'onscene' ? 'OS' :
                              unitObj.status === 'enroute' ? 'ER' :
                              unitObj.status === 'dispatched' ? 'DP' :
                              ''
                            ) : '';
                            return (
                              <span
                                key={unitIdStr}
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-bold font-mono rounded-sm transition-all duration-150 hover:brightness-110"
                                style={{ background: `${statusColor}12`, color: statusColor, border: `1px solid ${statusColor}40`, boxShadow: `0 0 4px ${statusColor}10` }}
                                title={unitObj ? `${displayName} — ${unitObj.officer_name || 'Unassigned'}${unitObj.badge_number ? ` #${unitObj.badge_number}` : ''} (${(unitObj.status || '').replace(/_/g, ' ').toUpperCase()})` : displayName}
                              >
                                <span className="rounded-full flex-shrink-0" style={{ width: 5, height: 5, background: statusColor, boxShadow: `0 0 3px ${statusColor}80` }} />
                                {displayName}
                                {unitObj?.badge_number && <span style={{ fontSize: '8px', opacity: 0.7 }}>#{unitObj.badge_number}</span>}
                                {statusLabel && <span style={{ fontSize: '8px', opacity: 0.8 }}>{statusLabel}</span>}
                                {!isEditing && unitObj && !['cleared', 'closed', 'cancelled', 'archived'].includes(selectedCall.status) && (
                                  <button type="button"
                                    onClick={() => handleUnassignUnit(unitObj.id)}
                                    className="ml-0.5 hover:text-red-400 transition-colors"
                                    title={`Detach ${displayName}`}
                                    style={{ lineHeight: 1 }}
                                  >
                                    <X style={{ width: 10, height: 10 }} />
                                  </button>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-rmpg-400 mt-1 italic">No units assigned</p>
                      )}
                      {/* Inline ETA from route */}
                      {routeInfo && (
                        <div className="mt-2 flex items-center gap-2.5 px-2.5 py-1.5 rounded-sm" style={{ background: 'rgba(136, 136, 136,0.08)', border: '1px solid rgba(136, 136, 136,0.2)', boxShadow: '0 0 8px rgba(136, 136, 136,0.06)' }}>
                          <span className="flex items-center gap-1 text-[9px] font-mono font-bold text-gray-400">
                            <Navigation style={{ width: 9, height: 9 }} /> ETA
                          </span>
                          <span className="text-[11px] font-mono font-bold text-white tabular-nums">{routeInfo.eta}</span>
                          <span className="text-[9px] font-mono text-[#6b7280] tabular-nums">{routeInfo.distance}</span>
                          <span className="text-[8px] font-mono text-[#545454] ml-auto">{routeInfo.unitCallSign}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── MILEAGE (primary unit) — Info tab ─── */}
                {detailTab === 'info' && (isEditing || selectedCall.starting_mileage || selectedCall.ending_mileage) && (
                  <div className="border-t border-[#2b2b2b] pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2" style={{ color: '#d4a017', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <MapPin className="w-3 h-3" /> Primary Unit Mileage
                    </label>
                    {isEditing ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                        <div>
                          <label className="text-[9px] text-brand-gold-500">Starting Mileage <span className="text-red-400">*</span></label>
                          <input type="number" step="0.1" min="0" className="input-dark text-xs" placeholder="e.g. 45230" value={editData.starting_mileage} onChange={(e) => updateEditField('starting_mileage', e.target.value)} />
                        </div>
                        <div>
                          <label className="text-[9px] text-brand-gold-500">Ending Mileage</label>
                          <input type="number" step="0.1" min="0" className="input-dark text-xs" placeholder="e.g. 45256" value={editData.ending_mileage} onChange={(e) => updateEditField('ending_mileage', e.target.value)} />
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-xs">
                        {selectedCall.starting_mileage && <span className="text-rmpg-200 tabular-nums"><span className="text-rmpg-400">Start:</span> {Number(selectedCall.starting_mileage).toLocaleString()} mi</span>}
                        {selectedCall.ending_mileage && <span className="text-rmpg-200 tabular-nums"><span className="text-rmpg-400">End:</span> {Number(selectedCall.ending_mileage).toLocaleString()} mi</span>}
                        {selectedCall.starting_mileage && selectedCall.ending_mileage && (
                          <span className="text-[10px] font-mono text-green-400 font-semibold tabular-nums">
                            Total: {((Number(selectedCall.ending_mileage) || 0) - (Number(selectedCall.starting_mileage) || 0)).toFixed(1)} mi
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── EXTENDED DETAILS — Info tab ─── */}
                {detailTab === 'info' && (isEditing || selectedCall.cross_street || selectedCall.location_building || selectedCall.location_floor || selectedCall.location_room || selectedCall.sector_id || selectedCall.zone_id || selectedCall.beat_id || selectedCall.latitude || selectedCall.dispatch_code) && (
                  <div className="border-t border-[#2b2b2b] pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2" style={{ color: '#d4a017', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <MapPin className="w-3 h-3" /> Location Details
                    </label>
                    {isEditing ? (() => {
                      const filteredZones = zonesForSection(editData.sector_id);
                      const filteredBeats = beatsForZone(editData.zone_id);
                      return (
                        <div className="space-y-2 mt-1">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div><label className="text-[9px] text-brand-gold-500">Cross Street</label><input type="text" className="input-dark text-xs" value={editData.cross_street} onChange={(e) => updateEditField('cross_street', e.target.value)} /></div>
                            <div><label className="text-[9px] text-brand-gold-500">Building</label><input type="text" className="input-dark text-xs" value={editData.location_building} onChange={(e) => updateEditField('location_building', e.target.value)} /></div>
                            <div><label className="text-[9px] text-brand-gold-500">Floor</label><input type="text" className="input-dark text-xs" value={editData.location_floor} onChange={(e) => updateEditField('location_floor', e.target.value)} /></div>
                            <div><label className="text-[9px] text-brand-gold-500">Room/Suite</label><input type="text" className="input-dark text-xs" value={editData.location_room} onChange={(e) => updateEditField('location_room', e.target.value)} /></div>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div>
                              <label className="text-[9px] text-brand-gold-500">Section</label>
                              <select className="input-dark text-xs" value={editData.sector_id} onChange={(e) => {
                                const val = e.target.value;
                                setEditData(prev => ({ ...prev, sector_id: val, zone_id: '', beat_id: '', dispatch_code: '' }));
                              }}>
                                <option value="">— Select —</option>
                                {sections.map(s => <option key={s} value={s}>{sectionLabels.get(s) || s}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-[9px] text-brand-gold-500">Zone</label>
                              <select className="input-dark text-xs" value={editData.zone_id} onChange={(e) => {
                                const val = e.target.value;
                                setEditData(prev => ({ ...prev, zone_id: val, beat_id: '', dispatch_code: '' }));
                              }}>
                                <option value="">— Select —</option>
                                {filteredZones.map(z => <option key={z} value={z}>{zoneLabels.get(z) || z}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-[9px] text-brand-gold-500">Beat</label>
                              <select className="input-dark text-xs" value={editData.beat_id} onChange={(e) => {
                                const beatVal = e.target.value;
                                // Auto-resolve dispatch code when beat is selected
                                const match = beatVal && editData.sector_id && editData.zone_id
                                  ? districts.find(d => d.sector_id === editData.sector_id && d.zone_id === editData.zone_id && d.beat_id === beatVal)
                                  : null;
                                setEditData(prev => ({ ...prev, beat_id: beatVal, dispatch_code: match?.dispatch_code || '' }));
                              }}>
                                <option value="">— Select —</option>
                                {filteredBeats.map(b => <option key={b} value={b}>{getBeatLabel(editData.zone_id, b)}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-[9px] text-brand-gold-500">Dispatch Code</label>
                              <input type="text" className="input-dark text-xs bg-rmpg-800 opacity-80" readOnly value={editData.dispatch_code || ''} />
                            </div>
                          </div>
                        </div>
                      );
                    })() : (
                      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-xs">
                        {selectedCall.cross_street && <span className="text-rmpg-200"><span className="text-rmpg-400">X-St:</span> {selectedCall.cross_street}</span>}
                        {selectedCall.location_building && <span className="text-rmpg-200"><span className="text-rmpg-400">Bldg:</span> {selectedCall.location_building}</span>}
                        {selectedCall.location_floor && <span className="text-rmpg-200"><span className="text-rmpg-400">Floor:</span> {selectedCall.location_floor}</span>}
                        {selectedCall.location_room && <span className="text-rmpg-200"><span className="text-rmpg-400">Rm:</span> {selectedCall.location_room}</span>}
                        {selectedCall.dispatch_code && (
                          <span className="text-[10px] font-bold font-mono text-amber-300 bg-amber-900/30 border border-amber-700/40 px-2 py-0.5 rounded-sm tracking-wider tabular-nums" style={{ textShadow: '0 0 6px rgba(251,191,36,0.15)' }}>
                            {selectedCall.dispatch_code}
                          </span>
                        )}
                        {selectedCall.sector_id && <span className="text-rmpg-200"><span className="text-rmpg-400">Sec:</span> {selectedCall.sector_id} — {sectionLabels.get(selectedCall.sector_id) || ''}</span>}
                        {selectedCall.zone_id && <span className="text-rmpg-200"><span className="text-rmpg-400">Zone:</span> {selectedCall.zone_id} — {zoneLabels.get(selectedCall.zone_id) || ''}</span>}
                        {selectedCall.beat_id && <span className="text-rmpg-200"><span className="text-rmpg-400">Beat:</span> {getBeatLabel(selectedCall.zone_id || '', selectedCall.beat_id)}</span>}
                        {selectedCall.latitude != null && selectedCall.longitude != null && (
                          <span className="text-rmpg-400 font-mono text-[9px] tabular-nums select-all">
                            GPS: {Number(selectedCall.latitude).toFixed(5)}, {Number(selectedCall.longitude).toFixed(5)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── SUBJECT/THREAT INFO — Persons tab ─── */}
                {(detailTab === 'info' || detailTab === 'persons') && (isEditing || (selectedCall.weapons_involved && selectedCall.weapons_involved !== 'None') || selectedCall.injuries_reported || selectedCall.num_subjects || selectedCall.subject_description || selectedCall.vehicle_description || selectedCall.direction_of_travel || callPersons.length > 0 || callVehicles.length > 0) && (
                  <div className="border-t border-[#2b2b2b] pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2" style={{ color: '#d4a017', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <Shield className="w-3 h-3" /> Subject / Threat Info
                    </label>
                    {isEditing ? (() => {
                      const weaponsIsOther = editData.weapons_involved && !(WEAPONS_OPTIONS as readonly string[]).includes(editData.weapons_involved);
                      return (
                      <div className="space-y-2 mt-1">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div><label className="text-[9px] text-brand-gold-500"># Subjects</label><input type="number" min="0" className="input-dark text-xs" value={editData.num_subjects} onChange={(e) => updateEditField('num_subjects', e.target.value)} /></div>
                          <div><label className="text-[9px] text-brand-gold-500"># Victims</label><input type="number" min="0" className="input-dark text-xs" value={editData.num_victims} onChange={(e) => updateEditField('num_victims', e.target.value)} /></div>
                          <div>
                            <label className="text-[9px] text-brand-gold-500">Weapons</label>
                            <select className="input-dark text-xs" value={weaponsIsOther ? 'Other' : editData.weapons_involved} onChange={(e) => updateEditField('weapons_involved', e.target.value)}>
                              {WEAPONS_OPTIONS.map(w => <option key={w} value={w}>{w || '— Select —'}</option>)}
                            </select>
                            {(editData.weapons_involved === 'Other' || weaponsIsOther) && (
                              <input type="text" className="input-dark text-xs mt-1" placeholder="Specify weapon..." value={weaponsIsOther ? editData.weapons_involved : ''} onChange={(e) => updateEditField('weapons_involved', e.target.value || 'Other')} />
                            )}
                          </div>
                        </div>
                        {/* ── Linked Persons ── */}
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <label className="text-[9px] text-brand-gold-500">Linked Individuals</label>
                            <select className="input-dark text-[9px] py-0 px-1 w-auto" value={linkPersonRole} onChange={(e) => setLinkPersonRole(e.target.value)}>
                              <option value="suspect">Suspect</option>
                              <option value="victim">Victim</option>
                              <option value="witness">Witness</option>
                              <option value="reporting_party">Reporting Party</option>
                              <option value="involved">Involved</option>
                              <option value="other">Other</option>
                            </select>
                          </div>
                          {callPersons.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1">
                              {callPersons.map((cp: any) => (
                                <span key={cp.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono bg-rmpg-700 border border-rmpg-500 rounded-sm text-rmpg-200">
                                  <span className="text-brand-gold-500 uppercase text-[7px] font-black">{(cp.role || '').replace('_', ' ')}</span>
                                  {cp.last_name}, {cp.first_name}
                                  <WarrantBadge flags={cp.flags} size="sm" />
                                  {cp.dob && <span className="text-rmpg-500">DOB:{cp.dob}</span>}
                                  <button type="button" onClick={() => unlinkPersonFromCall(selectedCall.id, cp.id)} className="text-red-500 hover:text-red-300 ml-0.5" title="Remove">&times;</button>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="relative" ref={personDropdownRef}>
                            <input type="text" className="input-dark text-xs" placeholder="Search person records to link..." value={editData.subject_description} onChange={(e) => { updateEditField('subject_description', e.target.value); searchPersons(e.target.value); }} onFocus={() => { if (personSearchResults.length > 0) setShowPersonDropdown(true); }} />
                            {showPersonDropdown && personSearchResults.length > 0 && (
                              <div className="absolute z-50 left-0 right-0 mt-0.5 max-h-40 overflow-y-auto border border-rmpg-500 bg-rmpg-800 rounded-sm shadow-lg">
                                {personSearchResults.map((p: any) => (
                                  <button type="button" key={p.id} className="w-full text-left px-2 py-1 text-[10px] text-rmpg-200 hover:bg-brand-500/20 border-b border-rmpg-700 last:border-0" onClick={() => {
                                    linkPersonToCall(selectedCall.id, p.id, linkPersonRole);
                                    const desc = `${p.last_name || ''}, ${p.first_name || ''}`.trim().replace(/^,\s*/, '').replace(/,\s*$/, '') + (p.dob ? ` DOB:${p.dob}` : '');
                                    updateEditField('subject_description', desc);
                                    setShowPersonDropdown(false);
                                  }}>
                                    <span className="font-semibold text-white">{p.last_name}, {p.first_name}</span>
                                    {p.dob && <span className="text-rmpg-400 ml-1">DOB: {p.dob}</span>}
                                    {p.address && <span className="text-rmpg-500 ml-1 text-[9px]">— {p.address}</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                            {editData.subject_description?.length >= 2 && personSearchResults.length === 0 && !showPersonDropdown && (
                              <button type="button" onClick={() => setShowCreatePersonModal(true)} className="mt-0.5 inline-flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase text-brand-400 bg-brand-900/30 border border-brand-700/40 hover:bg-brand-900/50 transition-colors">
                                <PlusCircle className="w-3 h-3" /> Create New Person
                              </button>
                            )}
                          </div>
                        </div>
                        {/* ── Linked Vehicles ── */}
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <label className="text-[9px] text-brand-gold-500">Linked Vehicles</label>
                            <select className="input-dark text-[9px] py-0 px-1 w-auto" value={linkVehicleRole} onChange={(e) => setLinkVehicleRole(e.target.value)}>
                              <option value="suspect_vehicle">Suspect Vehicle</option>
                              <option value="victim_vehicle">Victim Vehicle</option>
                              <option value="witness_vehicle">Witness Vehicle</option>
                              <option value="involved">Involved</option>
                              <option value="evidence">Evidence</option>
                              <option value="other">Other</option>
                            </select>
                          </div>
                          {callVehicles.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1">
                              {callVehicles.map((cv: any) => (
                                <span key={cv.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono bg-rmpg-700 border border-rmpg-500 rounded-sm text-rmpg-200">
                                  <span className="text-brand-gold-500 uppercase text-[7px] font-black">{(cv.role || '').replace(/_/g, ' ')}</span>
                                  {[cv.color, cv.year, cv.make, cv.model].filter(Boolean).join(' ')}
                                  {cv.plate_number && <span className="text-brand-400 ml-0.5">PLT:{cv.plate_number}</span>}
                                  <button type="button" onClick={() => unlinkVehicleFromCall(selectedCall.id, cv.id)} className="text-red-500 hover:text-red-300 ml-0.5" title="Remove">&times;</button>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="relative" ref={vehicleDropdownRef}>
                            <input type="text" className="input-dark text-xs" placeholder="Search vehicle records to link..." value={editData.vehicle_description} onChange={(e) => { updateEditField('vehicle_description', e.target.value); searchVehicles(e.target.value); }} onFocus={() => { if (vehicleSearchResults.length > 0) setShowVehicleDropdown(true); }} />
                            {showVehicleDropdown && vehicleSearchResults.length > 0 && (
                              <div className="absolute z-50 left-0 right-0 mt-0.5 max-h-40 overflow-y-auto border border-rmpg-500 bg-rmpg-800 rounded-sm shadow-lg">
                                {vehicleSearchResults.map((v: any) => (
                                  <button type="button" key={v.id} className="w-full text-left px-2 py-1 text-[10px] text-rmpg-200 hover:bg-brand-500/20 border-b border-rmpg-700 last:border-0" onClick={() => {
                                    linkVehicleToCall(selectedCall.id, v.id, linkVehicleRole);
                                    const desc = [v.color, v.year, v.make, v.model].filter(Boolean).join(' ') + (v.plate_number ? ` PLT:${v.plate_number}` : '') + (v.plate_state ? `/${v.plate_state}` : '');
                                    updateEditField('vehicle_description', desc);
                                    setShowVehicleDropdown(false);
                                  }}>
                                    <span className="font-semibold text-white">{[v.color, v.year, v.make, v.model].filter(Boolean).join(' ')}</span>
                                    {v.plate_number && <span className="text-brand-400 ml-1">PLT: {v.plate_number}{v.plate_state ? `/${v.plate_state}` : ''}</span>}
                                    {v.owner_first_name && <span className="text-rmpg-400 ml-1 text-[9px]">Owner: {v.owner_last_name}, {v.owner_first_name}</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                            {editData.vehicle_description?.length >= 2 && vehicleSearchResults.length === 0 && !showVehicleDropdown && (
                              <button type="button" onClick={() => setShowCreateVehicleModal(true)} className="mt-0.5 inline-flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase text-brand-400 bg-brand-900/30 border border-brand-700/40 hover:bg-brand-900/50 transition-colors">
                                <PlusCircle className="w-3 h-3" /> Create New Vehicle
                              </button>
                            )}
                          </div>
                        </div>
                        <div>
                          <label className="text-[9px] text-brand-gold-500">Direction of Travel</label>
                          <select className="input-dark text-xs" value={(DIRECTION_OPTIONS as readonly string[]).includes(editData.direction_of_travel) ? editData.direction_of_travel : ''} onChange={(e) => updateEditField('direction_of_travel', e.target.value)}>
                            {DIRECTION_OPTIONS.map(d => <option key={d} value={d}>{d || '— Select —'}</option>)}
                          </select>
                        </div>
                        <div className="flex items-center gap-4 mt-1">
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer">
                            <input type="checkbox" checked={editData.injuries_reported} onChange={(e) => updateEditField('injuries_reported', e.target.checked)} className="accent-red-500" />
                            Injuries
                          </label>
                        </div>
                      </div>
                      );
                    })() : (
                      <>
                        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-xs">
                          {selectedCall.num_subjects && <span className="text-rmpg-200"><span className="text-rmpg-400">Subjects:</span> {selectedCall.num_subjects}</span>}
                          {selectedCall.num_victims && <span className="text-rmpg-200"><span className="text-rmpg-400">Victims:</span> {selectedCall.num_victims}</span>}
                          {selectedCall.weapons_involved && selectedCall.weapons_involved !== 'None' && <span className="text-rmpg-200"><span className="text-rmpg-400">Weapons:</span> {selectedCall.weapons_involved}</span>}
                          {selectedCall.injuries_reported && <span className="text-red-400 font-semibold">INJURIES REPORTED</span>}
                          {selectedCall.subject_description && <span className="text-rmpg-200 basis-full"><span className="text-rmpg-400">Subject:</span> {selectedCall.subject_description}</span>}
                          {selectedCall.vehicle_description && <span className="text-rmpg-200 basis-full"><span className="text-rmpg-400">Vehicle:</span> {selectedCall.vehicle_description}</span>}
                          {selectedCall.direction_of_travel && <span className="text-rmpg-200"><span className="text-rmpg-400">DOT:</span> {selectedCall.direction_of_travel}</span>}
                        </div>
                        {/* Linked persons */}
                        {callPersons.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <span className="text-[9px] text-brand-gold-500 font-semibold uppercase">Linked Persons ({callPersons.length})</span>
                            {callPersons.map((cp: any) => (
                              <div key={cp.id} className="flex items-center gap-2 px-2 py-1 bg-rmpg-800/60 border border-rmpg-700 rounded-sm text-[10px]">
                                <span className="text-brand-gold-500 uppercase text-[7px] font-black px-1 py-px bg-rmpg-700 rounded-sm">{(cp.role || '').replace(/_/g, ' ')}</span>
                                <span className="text-white font-semibold">{cp.last_name}, {cp.first_name}</span>
                                <WarrantBadge flags={cp.flags} size="sm" />
                                {cp.dob && <span className="text-rmpg-400">DOB: {cp.dob}</span>}
                                {cp.race && <span className="text-rmpg-500">{cp.race}</span>}
                                {cp.sex && <span className="text-rmpg-500">{cp.sex}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Linked vehicles */}
                        {callVehicles.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <span className="text-[9px] text-brand-gold-500 font-semibold uppercase">Linked Vehicles ({callVehicles.length})</span>
                            {callVehicles.map((cv: any) => (
                              <div key={cv.id} className="flex items-center gap-2 px-2 py-1 bg-rmpg-800/60 border border-rmpg-700 rounded-sm text-[10px]">
                                <span className="text-brand-gold-500 uppercase text-[7px] font-black px-1 py-px bg-rmpg-700 rounded-sm">{(cv.role || '').replace(/_/g, ' ')}</span>
                                <span className="text-white font-semibold">{[cv.color, cv.year, cv.make, cv.model].filter(Boolean).join(' ')}</span>
                                {cv.plate_number && <span className="text-brand-400">PLT: {cv.plate_number}{cv.plate_state ? `/${cv.plate_state}` : ''}</span>}
                                {cv.stolen_status && !['none', 'not_stolen', 'recovered', ''].includes(cv.stolen_status.toLowerCase()) && <span className="text-red-400 font-bold uppercase">{cv.stolen_status.replace(/_/g, ' ')}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* ── SCENE DETAILS — Info tab ─── */}
                {detailTab === 'info' && (isEditing || selectedCall.scene_safety || selectedCall.weather_conditions || selectedCall.lighting_conditions || selectedCall.alcohol_involved || selectedCall.drugs_involved || selectedCall.domestic_violence || selectedCall.le_notified || selectedCall.damage_estimate || selectedCall.action_taken) && (
                  <div className="border-t border-[#2b2b2b] pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2" style={{ color: '#d4a017', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <Thermometer className="w-3 h-3" /> Scene / Additional
                    </label>
                    {isEditing ? (() => {
                      const leIsOther = editData.le_agency && !(LE_AGENCY_OPTIONS as readonly string[]).includes(editData.le_agency);
                      return (
                      <div className="space-y-2 mt-1">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="text-[9px] text-brand-gold-500">Scene Safety</label>
                            <select className="input-dark text-xs" value={(SCENE_SAFETY_OPTIONS as readonly string[]).includes(editData.scene_safety) ? editData.scene_safety : ''} onChange={(e) => updateEditField('scene_safety', e.target.value)}>
                              {SCENE_SAFETY_OPTIONS.map(s => <option key={s} value={s}>{s || '— Select —'}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] text-brand-gold-500">Weather</label>
                            <select className="input-dark text-xs" value={(WEATHER_OPTIONS as readonly string[]).includes(editData.weather_conditions) ? editData.weather_conditions : ''} onChange={(e) => updateEditField('weather_conditions', e.target.value)}>
                              {WEATHER_OPTIONS.map(w => <option key={w} value={w}>{w || '— Select —'}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] text-brand-gold-500">Lighting</label>
                            <select className="input-dark text-xs" value={(LIGHTING_OPTIONS as readonly string[]).includes(editData.lighting_conditions) ? editData.lighting_conditions : ''} onChange={(e) => updateEditField('lighting_conditions', e.target.value)}>
                              {LIGHTING_OPTIONS.map(l => <option key={l} value={l}>{l || '— Select —'}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-4">
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer"><input type="checkbox" checked={editData.alcohol_involved} onChange={(e) => updateEditField('alcohol_involved', e.target.checked)} className="accent-amber-500" /> Alcohol</label>
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer"><input type="checkbox" checked={editData.drugs_involved} onChange={(e) => updateEditField('drugs_involved', e.target.checked)} className="accent-red-500" /> Drugs</label>
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer"><input type="checkbox" checked={editData.domestic_violence} onChange={(e) => updateEditField('domestic_violence', e.target.checked)} className="accent-red-500" /> DV</label>
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer"><input type="checkbox" checked={editData.supervisor_notified} onChange={(e) => updateEditField('supervisor_notified', e.target.checked)} className="accent-brand-500" /> Supervisor Notified</label>
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer"><input type="checkbox" checked={editData.le_notified} onChange={(e) => updateEditField('le_notified', e.target.checked)} className="accent-brand-500" /> LE Notified</label>
                        </div>
                        {editData.le_notified && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <label className="text-[9px] text-brand-gold-500">LE Agency</label>
                              <select className="input-dark text-xs" value={leIsOther ? 'Other — See Notes' : editData.le_agency} onChange={(e) => updateEditField('le_agency', e.target.value)}>
                                {LE_AGENCY_OPTIONS.map(a => <option key={a} value={a}>{a || '— Select —'}</option>)}
                              </select>
                              {(editData.le_agency === 'Other — See Notes' || leIsOther) && (
                                <input type="text" className="input-dark text-xs mt-1" placeholder="Specify agency..." value={leIsOther ? editData.le_agency : ''} onChange={(e) => updateEditField('le_agency', e.target.value || 'Other — See Notes')} />
                              )}
                            </div>
                            <div><label className="text-[9px] text-brand-gold-500">LE Case #</label><input type="text" className="input-dark text-xs" value={editData.le_case_number} onChange={(e) => updateEditField('le_case_number', e.target.value)} /></div>
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div><label className="text-[9px] text-brand-gold-500">Damage Estimate ($)</label><input type="number" min="0" step="0.01" className="input-dark text-xs" value={editData.damage_estimate} onChange={(e) => updateEditField('damage_estimate', e.target.value)} /></div>
                          <div><label className="text-[9px] text-brand-gold-500">Damage Description</label><input type="text" className="input-dark text-xs" value={editData.damage_description} onChange={(e) => updateEditField('damage_description', e.target.value)} /></div>
                        </div>
                        <div><label className="text-[9px] text-brand-gold-500">Action Taken</label><textarea className="textarea-dark text-xs" rows={2} value={editData.action_taken} onChange={(e) => updateEditField('action_taken', e.target.value)} /></div>
                        <div>
                          <label className="text-[9px] text-brand-gold-500">Responding Officer</label>
                          <select className="input-dark text-xs" value={editData.responding_officer} onChange={(e) => updateEditField('responding_officer', e.target.value)}>
                            <option value="">— Select Officer —</option>
                            {officers.map(o => (
                              <option key={o.id} value={`${o.full_name}${o.badge_number ? ` (#${o.badge_number})` : ''}`}>
                                {o.full_name}{o.badge_number ? ` (#${o.badge_number})` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      );
                    })() : (
                      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-xs">
                        {selectedCall.scene_safety && <span className="text-rmpg-200"><span className="text-rmpg-400">Scene:</span> {selectedCall.scene_safety}</span>}
                        {selectedCall.weather_conditions && <span className="text-rmpg-200"><span className="text-rmpg-400">Weather:</span> {selectedCall.weather_conditions}</span>}
                        {selectedCall.lighting_conditions && <span className="text-rmpg-200"><span className="text-rmpg-400">Lighting:</span> {selectedCall.lighting_conditions}</span>}
                        {selectedCall.alcohol_involved && <span className="text-amber-400 font-semibold">ALCOHOL</span>}
                        {selectedCall.drugs_involved && <span className="text-red-400 font-semibold">DRUGS</span>}
                        {selectedCall.domestic_violence && <span className="text-red-400 font-semibold">DV</span>}
                        {selectedCall.supervisor_notified && <span className="text-brand-400">Supervisor Notified</span>}
                        {selectedCall.le_notified && <span className="text-brand-400">LE Notified{selectedCall.le_agency ? ` (${selectedCall.le_agency})` : ''}{selectedCall.le_case_number ? ` #${selectedCall.le_case_number}` : ''}</span>}
                        {selectedCall.damage_estimate && <span className="text-rmpg-200"><span className="text-rmpg-400">Damage:</span> ${selectedCall.damage_estimate}</span>}
                        {selectedCall.damage_description && <span className="text-rmpg-200 basis-full">{selectedCall.damage_description}</span>}
                        {selectedCall.action_taken && <span className="text-rmpg-200 basis-full"><span className="text-rmpg-400">Action:</span> {selectedCall.action_taken}</span>}
                        {selectedCall.responding_officer && <span className="text-rmpg-200"><span className="text-rmpg-400">Resp. Officer:</span> {selectedCall.responding_officer}</span>}
                      </div>
                    )}
                  </div>
                )}

                {/* ── PSO CLIENT REQUEST DETAILS — Info tab ─── */}
                {detailTab === 'info' && (isEditing || selectedCall.pso_requestor_name || selectedCall.pso_service_type || selectedCall.pso_billing_code || selectedCall.pso_authorization || selectedCall.incident_type === 'pso_client_request') && (
                  <div className="border-t border-[#2b2b2b] pt-3 mb-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="field-label !flex items-center gap-1.5">
                        <Building2 className="w-3 h-3" /> PSO Client Request Details
                        {(selectedCall.pso_attempt_number || 1) >= 1 && (
                          isAdminOrManager && !isEditing ? (
                            <select
                              className="ml-1.5 px-1 py-0 text-[8px] font-bold rounded-sm cursor-pointer"
                              style={{ background: '#f59e0b30', border: '1px solid #f59e0b50', color: '#fbbf24', appearance: 'auto', minWidth: '90px' }}
                              value={selectedCall.pso_attempt_number || 1}
                              onChange={async (e) => {
                                const newAttempt = parseInt(e.target.value, 10);
                                try {
                                  const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`, {
                                    method: 'PUT',
                                    body: JSON.stringify({ pso_attempt_number: newAttempt }),
                                  });
                                  const updated = mapDbCall(result);
                                  setCalls(prev => prev.map(c => String(c.id) === String(updated.id) ? { ...c, ...updated } : c));
                                  setSelectedCall(prev => prev ? { ...prev, ...updated } : updated);
                                  addToast(`Attempt number set to ${newAttempt}`, 'success');
                                } catch (err) { addToast('Failed to update attempt number', 'error'); }
                              }}
                              title="Admin: change attempt number"
                            >
                              {[1,2,3,4,5,6,7,8,9,10].map(n => (
                                <option key={n} value={n}>{n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`} ATTEMPT</option>
                              ))}
                            </select>
                          ) : (selectedCall.pso_attempt_number || 1) > 1 ? (
                            <span className="ml-1.5 px-1.5 py-0.5 text-[8px] font-bold rounded-sm" style={{ background: '#f59e0b30', border: '1px solid #f59e0b50', color: '#fbbf24' }}>
                              {selectedCall.pso_attempt_number === 2 ? '2nd' : selectedCall.pso_attempt_number === 3 ? '3rd' : `${selectedCall.pso_attempt_number}th`} ATTEMPT
                            </span>
                          ) : null
                        )}
                      </label>
                      {/* 72-hour countdown indicator */}
                      {!isEditing && selectedCall.incident_type === 'pso_client_request' && ['cleared', 'closed'].includes(selectedCall.status) && (() => {
                        const terminalTime = selectedCall.closed_at || selectedCall.cleared_at;
                        if (!terminalTime) return null;
                        const elapsed = Date.now() - new Date(terminalTime).getTime();
                        const hoursLeft = Math.max(0, 72 - elapsed / (3600000));
                        if (elapsed >= 72 * 3600000) {
                          return (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm animate-pulse" style={{ background: '#dc262640', border: '1px solid #dc262660', color: '#f87171' }}>
                              72HR OVERDUE — RE-DISPATCH REQUIRED
                            </span>
                          );
                        }
                        if (elapsed >= 48 * 3600000) {
                          return (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm" style={{ background: '#f59e0b20', border: '1px solid #f59e0b40', color: '#fbbf24' }}>
                              {Math.floor(hoursLeft)}HR UNTIL DEADLINE
                            </span>
                          );
                        }
                        return null;
                      })()}
                      {!isEditing && selectedCall.incident_type === 'pso_client_request' && ['cleared', 'closed', 'cancelled', 'on_hold', 'archived'].includes(selectedCall.status) && (
                        <button type="button"
                          className="toolbar-btn px-2 py-0.5 text-[9px] font-semibold"
                          style={{ background: '#d4a01720', borderColor: '#d4a01740', color: '#d4a017' }}
                          onClick={async () => {
                            const attempt = (selectedCall.pso_attempt_number || 1) + 1;
                            const ordinal = attempt === 2 ? '2nd' : attempt === 3 ? '3rd' : `${attempt}th`;
                            if (!window.confirm(`Schedule ${ordinal} return visit for ${selectedCall.call_number}?`)) return;
                            try {
                              const result = await apiFetch(`/dispatch/calls/${selectedCall.id}/redispatch`, {
                                method: 'POST',
                                body: JSON.stringify({}),
                              });
                              if (result) {
                                const mapped = mapDbCall(result);
                                setSelectedCall(mapped);
                                setCalls(prev => prev.map(c => c.id === mapped.id ? mapped : c));
                                addToast(`Re-dispatched — ${ordinal} visit`, 'success');
                              }
                            } catch (err: any) { addToast(`Failed to re-dispatch: ${err?.message || 'Unknown error'}`, 'error'); }
                          }}
                          title="Re-dispatch this PSO call with a new visit number"
                        >
                          <RotateCcw style={{ width: 9, height: 9, display: 'inline', marginRight: 3 }} />
                          Schedule Return Visit
                        </button>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="space-y-2 mt-1">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div><label className="text-[9px] text-brand-gold-500">Requestor Name</label><input type="text" className="input-dark text-xs" placeholder="Requestor name" value={editData.pso_requestor_name} onChange={(e) => updateEditField('pso_requestor_name', e.target.value)} /></div>
                          <div><label className="text-[9px] text-brand-gold-500">Requestor Phone</label><input type="text" inputMode="tel" className="input-dark text-xs" placeholder="Phone number" value={editData.pso_requestor_phone} onChange={(e) => updateEditField('pso_requestor_phone', formatPhoneInput(e.target.value))} /></div>
                          <div><label className="text-[9px] text-brand-gold-500">Requestor Email</label><input type="text" className="input-dark text-xs" placeholder="Email address" value={editData.pso_requestor_email} onChange={(e) => updateEditField('pso_requestor_email', e.target.value)} /></div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="text-[9px] text-brand-gold-500">Service Type</label>
                            <select className="input-dark text-xs" value={editData.pso_service_type} onChange={(e) => updateEditField('pso_service_type', e.target.value)}>
                              <option value="">— Select Service Type —</option>
                              <optgroup label="Process Service">
                                <option value="process_service">Process Service (General)</option>
                                <option value="subpoena_service">Subpoena Service</option>
                                <option value="summons_service">Summons &amp; Complaint</option>
                                <option value="eviction_service">Eviction / Unlawful Detainer</option>
                                <option value="restraining_order_service">Protective Order Service</option>
                                <option value="writ_service">Writ Service</option>
                                <option value="court_filing">Court Filing / Delivery</option>
                                <option value="court_order_service">Court Order Service</option>
                                <option value="notice_service">Notice / Demand Service</option>
                                <option value="posting_service">Posting Service (Nail &amp; Mail)</option>
                                <option value="rush_service">Rush / Same-Day Service</option>
                              </optgroup>
                              <optgroup label="Investigative">
                                <option value="skip_trace">Skip Trace &amp; Locate</option>
                                <option value="stake_out">Stake Out / Surveillance</option>
                                <option value="asset_search">Asset Search</option>
                                <option value="background_check">Background Check / Due Diligence</option>
                                <option value="witness_interview">Witness Interview / Statement</option>
                                <option value="witness_locate">Witness Locate</option>
                                <option value="record_retrieval">Record Retrieval</option>
                                <option value="document_retrieval">Document Retrieval</option>
                                <option value="field_investigation">Field Investigation</option>
                                <option value="insurance_investigation">Insurance Investigation</option>
                              </optgroup>
                              <optgroup label="Security Services">
                                <option value="patrol">Patrol</option>
                                <option value="static_guard">Static Guard</option>
                                <option value="escort">Escort</option>
                                <option value="event_security">Event Security</option>
                                <option value="surveillance">Surveillance</option>
                                <option value="access_control">Access Control</option>
                                <option value="alarm_response">Alarm Response</option>
                                <option value="fire_watch">Fire Watch</option>
                                <option value="construction_security">Construction Site Security</option>
                                <option value="executive_protection">Executive Protection</option>
                                <option value="loss_prevention">Loss Prevention</option>
                              </optgroup>
                              <optgroup label="Administrative">
                                <option value="notary_service">Notary Service</option>
                                <option value="certified_copy">Certified Copy Service</option>
                                <option value="courier">Courier / Messenger</option>
                                <option value="document_preparation">Document Preparation</option>
                                <option value="affidavit_preparation">Affidavit Preparation</option>
                                <option value="other">Other</option>
                              </optgroup>
                            </select>
                          </div>
                          <div><label className="text-[9px] text-brand-gold-500">Billing Code</label><input type="text" className="input-dark text-xs" placeholder="Billing code" value={editData.pso_billing_code} onChange={(e) => updateEditField('pso_billing_code', e.target.value)} /></div>
                          <div><label className="text-[9px] text-brand-gold-500">Authorization</label><input type="text" className="input-dark text-xs" placeholder="Authorization #" value={editData.pso_authorization} onChange={(e) => updateEditField('pso_authorization', e.target.value)} /></div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div><label className="text-[9px] text-brand-gold-500">Contract ID</label><input type="text" className="input-dark text-xs" placeholder="Contract ID" value={editData.contract_id} onChange={(e) => updateEditField('contract_id', e.target.value)} /></div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 mt-1">
                        {/* Prominent client/requestor badges */}
                        <div className="flex flex-wrap gap-1.5">
                          {selectedCall.pso_requestor_name && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-sm" style={{ background: '#d4a01718', border: '1px solid #d4a01740', color: '#fbbf24' }}>
                              <Building2 style={{ width: 10, height: 10 }} /> {selectedCall.pso_requestor_name}
                            </span>
                          )}
                          {selectedCall.pso_billing_code && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold font-mono px-2 py-0.5 rounded-sm" style={{ background: '#22c55e15', border: '1px solid #22c55e35', color: '#86efac' }}>
                              {selectedCall.pso_billing_code}
                            </span>
                          )}
                          {selectedCall.pso_authorization && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold font-mono px-2 py-0.5 rounded-sm" style={{ background: '#88888815', border: '1px solid #88888835', color: '#cccccc' }}>
                              AUTH: {selectedCall.pso_authorization}
                            </span>
                          )}
                          {selectedCall.contract_id && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm" style={{ background: '#8b5cf615', border: '1px solid #8b5cf635', color: '#c4b5fd' }}>
                              Contract: {selectedCall.contract_id}
                            </span>
                          )}
                        </div>
                        {/* Additional details */}
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                          {selectedCall.pso_requestor_phone && <span className="text-rmpg-200"><span className="text-rmpg-400">Phone:</span> {selectedCall.pso_requestor_phone}</span>}
                          {selectedCall.pso_requestor_email && <span className="text-rmpg-200"><span className="text-rmpg-400">Email:</span> {selectedCall.pso_requestor_email}</span>}
                          {selectedCall.pso_service_type && <span className="text-rmpg-200"><span className="text-rmpg-400">Service:</span> {formatServiceType(selectedCall.pso_service_type)}</span>}
                        </div>
                        {/* 72-hour deadline countdown for active PSO calls */}
                        {selectedCall.incident_type === 'pso_client_request' && selectedCall.created_at && !['archived'].includes(selectedCall.status) && (() => {
                          const deadline = new Date(new Date(selectedCall.created_at).getTime() + 72 * 3600000);
                          const remaining = deadline.getTime() - Date.now();
                          if (remaining <= 0) return (
                            <div className="text-[10px] font-mono font-bold animate-pulse" style={{ color: '#f87171' }}>
                              72HR DEADLINE PASSED
                            </div>
                          );
                          const hrs = Math.floor(remaining / 3600000);
                          const mins = Math.floor((remaining % 3600000) / 60000);
                          return (
                            <div className="text-[10px] font-mono" style={{ color: hrs < 12 ? '#f87171' : hrs < 24 ? '#fbbf24' : '#4ade80' }}>
                              {hrs}h {mins}m until 72hr deadline
                            </div>
                          );
                        })()}
                        {!selectedCall.pso_requestor_name && !selectedCall.pso_service_type && selectedCall.incident_type === 'pso_client_request' && (
                          <span className="text-rmpg-500 italic text-xs">No PSO details entered yet</span>
                        )}
                      </div>
                    )}

                    {/* PSO Service Window Compliance Checklist (desktop) */}
                    {!isEditing && selectedCall.incident_type === 'pso_client_request' && (() => {
                      const w = typeof selectedCall.pso_service_windows === 'string'
                        ? (() => { try { return JSON.parse(selectedCall.pso_service_windows as string); } catch { return null; } })()
                        : selectedCall.pso_service_windows;
                      const windows = { early_morning: !!w?.early_morning, daytime: !!w?.daytime, evening: !!w?.evening, weekend: !!w?.weekend };
                      const allMet = windows.early_morning && windows.daytime && windows.evening && windows.weekend;
                      const metCount = [windows.early_morning, windows.daytime, windows.evening, windows.weekend].filter(Boolean).length;
                      return (
                        <div className="mt-2 pt-2 border-t border-rmpg-700">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-rmpg-400">Service Windows</span>
                            <span className="text-[8px] font-mono px-1 rounded-sm" style={{
                              background: allMet ? '#22c55e20' : '#f59e0b20',
                              border: `1px solid ${allMet ? '#22c55e40' : '#f59e0b40'}`,
                              color: allMet ? '#4ade80' : '#fbbf24',
                            }}>
                              {metCount}/4
                            </span>
                            {allMet && <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: '#4ade80' }}>✓ Due Diligence Complete</span>}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {([
                              { key: 'early_morning', label: '6AM – 9AM', met: windows.early_morning },
                              { key: 'daytime', label: '9AM – 6PM', met: windows.daytime },
                              { key: 'evening', label: '6PM – 9PM', met: windows.evening },
                              { key: 'weekend', label: 'Weekend', met: windows.weekend },
                            ] as const).map(({ key, label, met }) => (
                              <span key={key} className="inline-flex items-center gap-1 text-[9px] py-0.5 px-2 rounded-sm font-mono" style={{
                                background: met ? '#22c55e10' : '#dc262610',
                                border: `1px solid ${met ? '#22c55e30' : '#dc262630'}`,
                                color: met ? '#86efac' : '#fca5a5',
                              }}>
                                <span style={{ color: met ? '#4ade80' : '#ef4444', fontSize: '8px' }}>{met ? '●' : '○'}</span>
                                {label}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* ── PROCESS SERVICE DETAILS — Info tab (always visible for PSO/process calls) ─── */}
                {detailTab === 'info' && (isEditing
                  ? ['pso_client_request', 'process_service'].includes(editData.incident_type || selectedCall.incident_type)
                  : (['pso_client_request', 'process_service'].includes(selectedCall.incident_type) || selectedCall.process_service_type || selectedCall.process_served_to || selectedCall.process_attempts)
                ) && (
                  <div className="border-t border-[#2b2b2b] pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2" style={{ color: '#d4a017', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <FileText className="w-3 h-3" /> Process Service Details
                      {!isEditing && selectedCall.process_service_result && (
                        <span className={`ml-1.5 px-1.5 py-0.5 text-[8px] font-bold rounded-sm ${
                          selectedCall.process_service_result === 'served'
                            ? 'bg-green-900/40 border border-green-700/50 text-green-400'
                            : selectedCall.process_service_result === 'unable_to_serve'
                            ? 'bg-red-900/40 border border-red-700/50 text-red-400'
                            : 'bg-amber-900/40 border border-amber-700/50 text-amber-400'
                        }`}>
                          {selectedCall.process_service_result.replace(/_/g, ' ').toUpperCase()}
                        </span>
                      )}
                      {!isEditing && (selectedCall.process_attempts || 0) > 0 && (
                        <span className="ml-1 px-1.5 py-0.5 text-[8px] font-bold rounded-sm bg-brand-900/40 border border-brand-600/40 text-brand-300">
                          {selectedCall.process_attempts} {selectedCall.process_attempts === 1 ? 'ATTEMPT' : 'ATTEMPTS'}
                        </span>
                      )}
                    </label>
                    {isEditing ? (
                      <div className="space-y-2 mt-1">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="text-[9px] text-amber-400">Document Type</label>
                            <select className="input-dark text-xs" value={editData.process_service_type || ''} onChange={(e) => updateEditField('process_service_type', e.target.value)}>
                              <option value="">— Select Document Type —</option>
                              <optgroup label="Civil Process — General">
                                <option value="subpoena">Subpoena</option>
                                <option value="subpoena_duces_tecum">Subpoena Duces Tecum</option>
                                <option value="subpoena_deposition">Subpoena (Deposition)</option>
                                <option value="federal_subpoena">Federal Subpoena</option>
                                <option value="summons">Summons &amp; Complaint</option>
                                <option value="complaint">Complaint</option>
                                <option value="third_party_complaint">Third-Party Complaint</option>
                                <option value="cross_complaint">Cross-Complaint</option>
                                <option value="counterclaim">Counterclaim</option>
                                <option value="amended_complaint">Amended Complaint</option>
                                <option value="civil_summons">Civil Summons</option>
                                <option value="small_claims">Small Claims</option>
                              </optgroup>
                              <optgroup label="Writs &amp; Garnishments">
                                <option value="garnishment">Garnishment</option>
                                <option value="wage_garnishment">Wage Garnishment</option>
                                <option value="bank_levy">Bank Levy / Account Garnishment</option>
                                <option value="writ_of_execution">Writ of Execution</option>
                                <option value="writ_of_restitution">Writ of Restitution</option>
                                <option value="writ_of_garnishment">Writ of Garnishment</option>
                                <option value="writ_of_attachment">Writ of Attachment</option>
                                <option value="writ_of_possession">Writ of Possession</option>
                                <option value="writ_of_assistance">Writ of Assistance</option>
                                <option value="writ_of_mandate">Writ of Mandate / Mandamus</option>
                                <option value="levy">Levy</option>
                              </optgroup>
                              <optgroup label="Family / Domestic">
                                <option value="restraining_order">Protective / Restraining Order</option>
                                <option value="temporary_protective_order">Temporary Protective Order</option>
                                <option value="cohabitant_abuse_order">Cohabitant Abuse Protective Order</option>
                                <option value="divorce_papers">Divorce Papers</option>
                                <option value="divorce_petition">Divorce Petition</option>
                                <option value="divorce_summons">Divorce Summons</option>
                                <option value="custody_order">Custody Order</option>
                                <option value="custody_modification">Custody Modification</option>
                                <option value="child_support">Child Support Order</option>
                                <option value="child_support_modification">Child Support Modification</option>
                                <option value="paternity_action">Paternity Action</option>
                                <option value="adoption_papers">Adoption Papers</option>
                                <option value="guardianship">Guardianship Petition</option>
                                <option value="termination_of_parental_rights">Termination of Parental Rights</option>
                                <option value="stalking_injunction">Stalking Injunction</option>
                              </optgroup>
                              <optgroup label="Real Property">
                                <option value="eviction">Eviction Notice</option>
                                <option value="unlawful_detainer">Unlawful Detainer</option>
                                <option value="notice_to_quit">Notice to Quit</option>
                                <option value="three_day_notice">3-Day Notice to Pay or Quit</option>
                                <option value="five_day_notice">5-Day Notice (Commercial)</option>
                                <option value="fifteen_day_notice">15-Day Notice (Month-to-Month)</option>
                                <option value="foreclosure">Foreclosure Notice</option>
                                <option value="notice_of_default">Notice of Default</option>
                                <option value="lis_pendens">Lis Pendens</option>
                                <option value="quiet_title">Quiet Title Action</option>
                              </optgroup>
                              <optgroup label="Court Orders &amp; Motions">
                                <option value="court_order">Court Order</option>
                                <option value="temporary_order">Temporary Order</option>
                                <option value="temporary_restraining_order">Temporary Restraining Order</option>
                                <option value="preliminary_injunction">Preliminary Injunction</option>
                                <option value="permanent_injunction">Permanent Injunction</option>
                                <option value="motion">Motion / Petition</option>
                                <option value="motion_for_contempt">Motion for Contempt</option>
                                <option value="motion_to_compel">Motion to Compel</option>
                                <option value="notice_of_hearing">Notice of Hearing</option>
                                <option value="order_to_show_cause">Order to Show Cause</option>
                                <option value="judgment">Judgment</option>
                                <option value="default_judgment">Default Judgment</option>
                              </optgroup>
                              <optgroup label="Probate &amp; Estate">
                                <option value="probate_petition">Probate Petition</option>
                                <option value="letters_testamentary">Letters Testamentary</option>
                                <option value="creditor_claim">Creditor Claim (Probate)</option>
                              </optgroup>
                              <optgroup label="Bankruptcy">
                                <option value="bankruptcy_notice">Bankruptcy Notice</option>
                                <option value="adversary_proceeding">Adversary Proceeding</option>
                              </optgroup>
                              <optgroup label="Discovery">
                                <option value="notice_of_deposition">Notice of Deposition</option>
                                <option value="interrogatories">Interrogatories</option>
                                <option value="request_for_production">Request for Production</option>
                                <option value="request_for_admission">Request for Admission</option>
                              </optgroup>
                              <optgroup label="Other">
                                <option value="demand_letter">Demand Letter</option>
                                <option value="cease_and_desist">Cease &amp; Desist</option>
                                <option value="affidavit">Affidavit</option>
                                <option value="declaration">Declaration</option>
                                <option value="stipulation">Stipulation</option>
                                <option value="other">Other</option>
                              </optgroup>
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] text-amber-400">Serve To (Name)</label>
                            <input type="text" className="input-dark text-xs" placeholder="Person to be served" value={editData.process_served_to || ''} onChange={(e) => updateEditField('process_served_to', e.target.value)} />
                          </div>
                          <div>
                            <label className="text-[9px] text-amber-400">Attempts</label>
                            <input type="number" className="input-dark text-xs" min="0" placeholder="0" value={editData.process_attempts ?? 0} onChange={(e) => updateEditField('process_attempts', e.target.value ? parseInt(e.target.value, 10) : 0)} />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div className="sm:col-span-1">
                            <label className="text-[9px] text-amber-400">Service Address</label>
                            <input type="text" className="input-dark text-xs w-full" placeholder="Address for service" value={editData.process_served_address || ''} onChange={(e) => updateEditField('process_served_address', e.target.value)} />
                          </div>
                          <div>
                            <label className="text-[9px] text-amber-400">Served At</label>
                            <input type="datetime-local" step="1" className="input-dark text-xs" value={editData.process_served_at || ''} onChange={(e) => updateEditField('process_served_at', e.target.value)} />
                          </div>
                          <div>
                            <label className="text-[9px] text-amber-400">Service Result</label>
                            <select className="input-dark text-xs" value={editData.process_service_result || ''} onChange={(e) => updateEditField('process_service_result', e.target.value)}>
                              <option value="">— Pending —</option>
                              <optgroup label="Successful Service">
                                <option value="served">Personal Service</option>
                                <option value="substitute_service">Substitute Service</option>
                                <option value="abode_service">Abode / Dwelling Service</option>
                                <option value="posted">Posted (Nail &amp; Mail)</option>
                                <option value="left_with">Left With (Co-Resident / Co-Worker)</option>
                                <option value="left_at_door">Left at Door (Conspicuous Place)</option>
                                <option value="served_agent">Served on Agent / Registered Agent</option>
                                <option value="served_attorney">Served on Attorney of Record</option>
                                <option value="served_corporate">Served on Corporate Officer</option>
                                <option value="served_manager">Served on Manager / Supervisor</option>
                                <option value="served_secretary_of_state">Served via Secretary of State</option>
                                <option value="acknowledged">Acknowledged / Accepted Service</option>
                                <option value="certified_mail">Certified Mail (Return Receipt)</option>
                              </optgroup>
                              <optgroup label="Unsuccessful — Attempt Made">
                                <option value="no_answer">No Answer / Not Home</option>
                                <option value="no_contact">No Contact Made</option>
                                <option value="refused">Refused Service</option>
                                <option value="evasion">Evasion / Avoiding Service</option>
                                <option value="gate_locked">Gated / Locked — No Access</option>
                                <option value="aggressive_animal">Aggressive Animal / Dog</option>
                                <option value="unsafe_conditions">Unsafe Conditions</option>
                                <option value="wrong_person">Wrong Person at Address</option>
                                <option value="not_recognized">Subject Not Recognized at Location</option>
                              </optgroup>
                              <optgroup label="Unsuccessful — Cannot Serve">
                                <option value="unable_to_locate">Unable to Locate</option>
                                <option value="bad_address">Bad / Invalid Address</option>
                                <option value="address_vacant">Address Vacant / Abandoned</option>
                                <option value="address_commercial">Address is Commercial (Need Residential)</option>
                                <option value="moved">Subject Moved</option>
                                <option value="moved_out_of_state">Subject Moved Out of State</option>
                                <option value="deceased">Subject Deceased</option>
                                <option value="incarcerated">Subject Incarcerated</option>
                                <option value="military">Subject on Active Military Duty</option>
                                <option value="non_est">Non Est Inventus (Not Found)</option>
                                <option value="due_diligence_exhausted">Due Diligence Exhausted</option>
                              </optgroup>
                              <optgroup label="Administrative">
                                <option value="unable_to_serve">Unable to Serve (General)</option>
                                <option value="returned_to_attorney">Returned to Attorney</option>
                                <option value="returned_to_court">Returned to Court</option>
                                <option value="returned_to_client">Returned to Client</option>
                                <option value="expired">Documents Expired</option>
                                <option value="recalled">Service Recalled / Cancelled</option>
                                <option value="duplicate">Duplicate / Already Served</option>
                                <option value="insufficient_info">Insufficient Information</option>
                                <option value="jurisdiction_issue">Jurisdiction Issue</option>
                                <option value="referred_out">Referred to Another Server</option>
                                <option value="other">Other</option>
                              </optgroup>
                            </select>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-xs">
                        {selectedCall.process_service_type && <span className="text-rmpg-200"><span className="text-rmpg-400">Document:</span> {formatDocumentType(selectedCall.process_service_type)}</span>}
                        {selectedCall.process_served_to && <span className="text-rmpg-200"><span className="text-rmpg-400">Serve To:</span> {selectedCall.process_served_to}</span>}
                        {selectedCall.process_served_address && <span className="text-rmpg-200"><span className="text-rmpg-400">Address:</span> {selectedCall.process_served_address}</span>}
                        {selectedCall.process_served_at && <span className="text-rmpg-200"><span className="text-rmpg-400">Served At:</span> {selectedCall.process_served_at}</span>}
                        {!selectedCall.process_service_type && !selectedCall.process_served_to && (
                          <span className="text-rmpg-500 italic">No process service details entered yet</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── VISIT HISTORY TIMELINE — PSO calls, Info tab ─── */}
                {detailTab === 'info' && !isEditing && selectedCall.incident_type === 'pso_client_request' && selectedCall.visit_history && selectedCall.visit_history.length > 0 && (
                  <div className="border-t border-[#2b2b2b] pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2" style={{ color: '#d4a017', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <Clock className="w-3 h-3" /> Visit History
                      <span className="ml-1 px-1.5 py-0.5 text-[8px] font-bold rounded-sm" style={{ background: '#88888820', border: '1px solid #88888840', color: '#aaaaaa' }}>
                        {selectedCall.visit_history.length} PRIOR {selectedCall.visit_history.length === 1 ? 'VISIT' : 'VISITS'}
                      </span>
                    </label>
                    <div className="space-y-1.5">
                      {selectedCall.visit_history.map((visit) => {
                        let unitsList: string[] = [];
                        try { unitsList = JSON.parse(visit.assigned_units || '[]'); } catch { /* ignore */ }
                        const totalMiles = (visit.starting_mileage != null && visit.ending_mileage != null)
                          ? (visit.ending_mileage - visit.starting_mileage).toFixed(1)
                          : null;
                        return (
                          <div key={visit.id} className="bg-rmpg-800/60 border border-rmpg-600/50 rounded-sm px-2.5 py-2">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] font-bold font-mono text-amber-300 bg-amber-900/30 border border-amber-700/40 px-1.5 py-0 tabular-nums">
                                  VISIT #{visit.visit_number}
                                </span>
                                <span className={`text-[8px] font-bold px-1 py-0 rounded-sm ${
                                  visit.status === 'cleared' ? 'bg-green-900/40 border border-green-700/50 text-green-400'
                                  : visit.status === 'closed' ? 'bg-gray-900/40 border border-gray-700/50 text-gray-400'
                                  : visit.status === 'cancelled' ? 'bg-red-900/40 border border-red-700/50 text-red-400'
                                  : 'bg-rmpg-700 border border-rmpg-500 text-rmpg-300'
                                }`}>
                                  {(visit.status || '').toUpperCase()}
                                </span>
                                {visit.disposition && (
                                  <span className="text-[9px] text-rmpg-300">{(visit.disposition || '').replace(/_/g, ' ').toUpperCase()}</span>
                                )}
                              </div>
                              {unitsList.length > 0 && (
                                <span className="text-[9px] font-mono text-brand-300">{unitsList.join(', ')}</span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[9px]">
                              {visit.dispatched_at && <span className="text-rmpg-300"><span className="text-rmpg-500">Dispatched:</span> {formatTime(visit.dispatched_at)}</span>}
                              {visit.enroute_at && <span className="text-rmpg-300"><span className="text-rmpg-500">En Route:</span> {formatTime(visit.enroute_at)}</span>}
                              {visit.onscene_at && <span className="text-rmpg-300"><span className="text-rmpg-500">On Scene:</span> {formatTime(visit.onscene_at)}</span>}
                              {visit.cleared_at && <span className="text-rmpg-300"><span className="text-rmpg-500">Cleared:</span> {formatTime(visit.cleared_at)}</span>}
                              {visit.closed_at && <span className="text-rmpg-300"><span className="text-rmpg-500">Closed:</span> {formatTime(visit.closed_at)}</span>}
                            </div>
                            {(visit.responding_vehicle_id || totalMiles) && (
                              <div className="flex gap-x-4 text-[9px] mt-0.5">
                                {visit.responding_vehicle_id && <span className="text-rmpg-300"><span className="text-rmpg-500">Vehicle:</span> {visit.responding_vehicle_id}</span>}
                                {visit.starting_mileage != null && <span className="text-rmpg-300"><span className="text-rmpg-500">Start Mi:</span> {visit.starting_mileage.toLocaleString()}</span>}
                                {visit.ending_mileage != null && <span className="text-rmpg-300"><span className="text-rmpg-500">End Mi:</span> {visit.ending_mileage.toLocaleString()}</span>}
                                {totalMiles && <span className="text-green-400 font-bold"><span className="text-rmpg-500">Total:</span> {totalMiles} mi</span>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── QUICK-TOGGLE FLAGS — Flags tab ─── */}
                {detailTab === 'flags' && !isEditing && (
                  <div className="border-t border-[#2b2b2b] pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2" style={{ color: '#d4a017', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <Shield className="w-3 h-3" /> Quick Flags
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {([
                        { field: 'alcohol_involved', label: 'Alcohol', onBg: '#f59e0b30', onBorder: '#f59e0b50', onText: '#fbbf24' },
                        { field: 'drugs_involved', label: 'Drugs', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                        { field: 'domestic_violence', label: 'DV', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                        { field: 'injuries_reported', label: 'Injuries', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                        { field: 'supervisor_notified', label: 'Supervisor', onBg: '#88888830', onBorder: '#88888850', onText: '#aaaaaa' },
                        { field: 'le_notified', label: 'LE Notified', onBg: '#88888830', onBorder: '#88888850', onText: '#aaaaaa' },
                        { field: 'mental_health_crisis', label: 'Mental Health', onBg: '#a855f730', onBorder: '#a855f750', onText: '#c084fc' },
                        { field: 'juvenile_involved', label: 'Juvenile', onBg: '#f9731630', onBorder: '#f9731650', onText: '#fb923c' },
                        { field: 'felony_in_progress', label: 'Felony', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                        { field: 'officer_safety_caution', label: 'Officer Safety', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                        { field: 'gang_related', label: 'Gang', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                        { field: 'body_camera_active', label: 'Body Cam', onBg: '#22c55e30', onBorder: '#22c55e50', onText: '#4ade80' },
                        { field: 'k9_requested', label: 'K9', onBg: '#88888830', onBorder: '#88888850', onText: '#22c55e' },
                        { field: 'ems_requested', label: 'EMS', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                        { field: 'fire_requested', label: 'Fire', onBg: '#f9731630', onBorder: '#f9731650', onText: '#fb923c' },
                        { field: 'hazmat', label: 'HazMat', onBg: '#eab30830', onBorder: '#eab30850', onText: '#fbbf24' },
                        { field: 'evidence_collected', label: 'Evidence', onBg: '#10b98130', onBorder: '#10b98150', onText: '#34d399' },
                        { field: 'photos_taken', label: 'Photos', onBg: '#88888830', onBorder: '#88888850', onText: '#aaaaaa' },
                        { field: 'trespass_issued', label: 'Trespass', onBg: '#f59e0b30', onBorder: '#f59e0b50', onText: '#fbbf24' },
                        { field: 'vehicle_pursuit', label: 'Vehicle Pursuit', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                        { field: 'foot_pursuit', label: 'Foot Pursuit', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                      ] as const).map(({ field, label, onBg, onBorder, onText }) => {
                        const isOn = !!(selectedCall as any)[field];
                        return (
                          <button type="button"
                            key={field}
                            className="px-2 py-0.5 text-[9px] font-semibold rounded-sm transition-colors border"
                            style={isOn
                              ? { background: onBg, borderColor: onBorder, color: onText }
                              : { background: 'var(--color-rmpg-700, #1c1c1c)', borderColor: 'var(--color-rmpg-600, #2c2c2c)', color: 'var(--color-rmpg-400, #888)' }
                            }
                            onClick={async () => {
                              const newVal = !isOn;
                              try {
                                await apiFetch(`/dispatch/calls/${selectedCall.id}`, {
                                  method: 'PUT',
                                  body: JSON.stringify({ [field]: newVal }),
                                });
                                const updated = { ...selectedCall, [field]: newVal ? 1 : 0 };
                                setSelectedCall(updated);
                                setCalls(prev => prev.map(c => c.id === selectedCall.id ? updated : c));
                              } catch { addToast(`Failed to update ${label}`, 'error'); }
                            }}
                            title={`Toggle ${label}`}
                          >
                            {isOn ? '✓ ' : ''}{label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── ACTIVITY LOG / TIMELINE — Timeline tab ─── */}
                <div className="border-t border-[#2b2b2b] pt-3 mb-3" style={{ display: detailTab === 'timeline' ? undefined : 'none' }}>
                  <div className="flex items-center justify-between mb-2">
                    <label className="field-label !flex items-center gap-1.5" style={{ color: '#d4a017', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <Clock className="w-3 h-3" /> Activity Log
                    </label>
                    <button type="button" onClick={() => setShowAddTimeline(!showAddTimeline)} className="toolbar-btn" style={{ padding: '1px 6px', fontSize: '9px' }}>
                      <PlusCircle style={{ width: 9, height: 9 }} /> Add Entry
                    </button>
                  </div>
                  {showAddTimeline && (
                    <div className="flex gap-2 mb-2">
                      <input type="text" className="input-dark flex-1 text-xs" placeholder="New timeline entry..." spellCheck={true} value={newTimelineText}
                        onChange={(e) => setNewTimelineText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddTimeline(); }}
                      />
                      <button type="button" onClick={handleAddTimeline} className="toolbar-btn toolbar-btn-primary" style={{ fontSize: '9px' }} disabled={!newTimelineText.trim()}>Add</button>
                    </div>
                  )}
                  {activityEntries.length > 0 ? (
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {activityEntries.map((entry: any, idx: number) => {
                        const actionColor = (entry.action || '').includes('dispatch') ? '#f59e0b' :
                          (entry.action || '').includes('enroute') ? '#888888' :
                          (entry.action || '').includes('onscene') || (entry.action || '').includes('on_scene') ? '#a855f7' :
                          (entry.action || '').includes('clear') ? '#22c55e' :
                          (entry.action || '').includes('note') ? '#666666' :
                          '#888888';
                        return (
                        <div key={entry.id} className="group flex items-start gap-2 text-xs hover:bg-[#18181820] px-1.5 py-1 transition-colors relative" style={{ borderLeft: '2px solid #2b2b2b' }}>
                          {/* Step connector dot */}
                          <div className="absolute -left-[5px] top-[7px] w-2 h-2 rounded-full flex-shrink-0" style={{ background: actionColor, border: '2px solid #0c0c0c' }} />
                          <span className="text-[#6b7280] font-mono whitespace-nowrap pl-1.5 tabular-nums" style={{ fontSize: '9px', minWidth: '60px' }} title={entry.created_at ? timeAgo(entry.created_at) : ''}>
                            {entry.created_at ? `${formatTime(entry.created_at)} (${timeAgo(entry.created_at)})` : '--'}
                          </span>
                          {editingTimelineId === String(entry.id) ? (
                            <div className="flex-1 flex gap-1">
                              <input type="text" className="input-dark text-xs flex-1" value={editTimelineText}
                                onChange={(e) => setEditTimelineText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleEditTimeline(String(entry.id)); if (e.key === 'Escape') setEditingTimelineId(null); }}
                                autoFocus
                              />
                              <button type="button" onClick={() => handleEditTimeline(String(entry.id))} className="toolbar-btn" style={{ padding: '1px 4px', fontSize: '9px' }}>
                                <Save style={{ width: 8, height: 8 }} />
                              </button>
                              <button type="button" onClick={() => setEditingTimelineId(null)} className="toolbar-btn" style={{ padding: '1px 4px', fontSize: '9px' }}>
                                <X style={{ width: 8, height: 8 }} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="text-[#e5e7eb] flex-1">{formatActivityDetails(entry.details || entry.description || '')}</span>
                              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                                <button type="button" onClick={() => { setEditingTimelineId(String(entry.id)); setEditTimelineText(entry.details || entry.description || ''); }} className="p-2 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center hover:text-[#4a9ede] text-[#6b7280] transition-colors" title="Edit">
                                  <Edit3 style={{ width: 9, height: 9 }} />
                                </button>
                                <button type="button" onClick={() => handleDeleteTimeline(String(entry.id))} className="p-2 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center hover:text-red-400 text-[#6b7280] transition-colors" title="Delete">
                                  <Trash2 style={{ width: 9, height: 9 }} />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center py-8 text-[#545454]">
                      <div className="p-2.5 rounded-sm mb-2.5" style={{ background: '#0c0c0c40', border: '1px solid #2b2b2b30' }}>
                        <Clock className="w-5 h-5" style={{ opacity: 0.3 }} />
                      </div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5">No Activity Recorded</p>
                      <p className="text-[9px] text-[#404040]">Click "Add Entry" to start the activity log</p>
                    </div>
                  )}
                </div>

                {/* Notes — fills remaining vertical space — Notes tab */}
                <div className="border-t border-[#2b2b2b] pt-3 flex-1 flex flex-col min-h-0" style={{ display: detailTab === 'notes' ? undefined : 'none' }}>
                  <label className="field-label !flex items-center gap-1.5 mb-2 flex-shrink-0" style={{ color: '#d4a017', fontSize: '9px', letterSpacing: '0.05em' }}>
                    <MessageSquare className="w-3 h-3" /> Notes
                  </label>
                  <div className="space-y-1 mb-3 flex-1 overflow-y-auto">
                    {(Array.isArray(selectedCall.notes) ? selectedCall.notes : []).length === 0 ? (
                      <div className="flex flex-col items-center py-8 text-[#545454]">
                        <div className="p-2.5 rounded-sm mb-2.5" style={{ background: '#0c0c0c40', border: '1px solid #2b2b2b30' }}>
                          <MessageSquare className="w-5 h-5" style={{ opacity: 0.3 }} />
                        </div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5">No Notes Yet</p>
                        <p className="text-[9px] text-[#404040]">Add a note below to get started</p>
                      </div>
                    ) : (
                      (Array.isArray(selectedCall.notes) ? selectedCall.notes : []).map((note) => (
                      <div key={note.id} className="group flex items-start gap-2 text-xs px-2 py-1.5 rounded-sm transition-colors hover:bg-[#18181820]" style={{ borderLeft: '2px solid #88888840' }}>
                        <span className="text-[#6b7280] font-mono whitespace-nowrap tabular-nums" style={{ fontSize: '9px', minWidth: '54px' }}>{formatTime(note.timestamp)}</span>
                        <span className="text-[#d4a017] font-bold whitespace-nowrap text-[10px]">{note.author || 'System'}</span>
                        {editingNoteId === note.id ? (
                          <div className="flex-1 min-w-0 flex flex-col gap-1">
                            <textarea className="input-dark text-xs w-full" rows={2} value={editingNoteText} onChange={(e) => setEditingNoteText(e.target.value)} autoFocus />
                            <div className="flex gap-1">
                              <button type="button" className="toolbar-btn toolbar-btn-primary text-[9px] px-2 py-0.5" onClick={() => handleEditNote(note.id, editingNoteText)}>Save</button>
                              <button type="button" className="toolbar-btn text-[9px] px-2 py-0.5" onClick={() => { setEditingNoteId(null); setEditingNoteText(''); }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <span className="text-[#e5e7eb] leading-relaxed flex-1 min-w-0">{renderFormattedText(typeof note.text === 'string' ? note.text : String(note.text ?? ''))}{note.edited_at && <span className="text-[#545454] text-[8px] ml-1">(edited)</span>}</span>
                            {isAdminOrManager && (
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 shrink-0">
                                <button type="button" className="p-2 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-[#6b7280] hover:text-[#a0a0a0] transition-colors" title="Edit note" onClick={() => { setEditingNoteId(note.id); setEditingNoteText(note.text || ''); }}><Pencil className="w-3 h-3" /></button>
                                <button type="button" className="p-2 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-[#6b7280] hover:text-[#ef4444] transition-colors" title="Delete note" onClick={() => handleDeleteNote(note.id)}><Trash2 className="w-3 h-3" /></button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      ))
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    {/* Formatting toolbar */}
                    <div className="flex items-center gap-1 mb-1.5">
                      <button type="button" title="Bold (Ctrl+B)" className="w-6 h-5 flex items-center justify-center text-[10px] font-black text-[#9ca3af] hover:text-white hover:bg-[#88888830] border border-[#2b2b2b] rounded-sm transition-all duration-100 active:bg-[#88888850]" onClick={() => wrapNoteSelection('**')}>B</button>
                      <button type="button" title="Italic (Ctrl+I)" className="w-6 h-5 flex items-center justify-center text-[10px] italic font-semibold text-[#9ca3af] hover:text-white hover:bg-[#88888830] border border-[#2b2b2b] rounded-sm transition-all duration-100 active:bg-[#88888850]" onClick={() => wrapNoteSelection('*')}>I</button>
                      <button type="button" title="Underline (Ctrl+U)" className="w-6 h-5 flex items-center justify-center text-[10px] underline text-[#9ca3af] hover:text-white hover:bg-[#88888830] border border-[#2b2b2b] rounded-sm transition-all duration-100 active:bg-[#88888850]" onClick={() => wrapNoteSelection('__')}>U</button>
                      <span className="text-[8px] text-[#545454] ml-2 font-mono select-none">Shift+Enter to submit</span>
                    </div>
                    <div className="flex gap-2">
                      <textarea
                        ref={noteTextareaRef}
                        className="input-dark flex-1 text-xs resize-none"
                        rows={2}
                        placeholder="Add note..."
                        maxLength={2000}
                        spellCheck={true}
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); handleAddNote(); }
                          if (e.key === 'b' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); wrapNoteSelection('**'); }
                          if (e.key === 'i' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); wrapNoteSelection('*'); }
                          if (e.key === 'u' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); wrapNoteSelection('__'); }
                        }}
                      />
                      <button type="button" onClick={handleAddNote} className="toolbar-btn toolbar-btn-primary self-end" disabled={!newNote.trim()}>
                        Add
                      </button>
                    </div>
                    {/* Feature 20: Broadcast Note to all assigned units */}
                    {(selectedCall.assigned_units || []).length > 0 && (
                      <div className="flex gap-2 mt-2 pt-2 border-t border-rmpg-700/50">
                        <input
                          type="text"
                          className="input-dark flex-1 text-xs"
                          placeholder="Broadcast to all units on call..."
                          maxLength={500}
                          value={broadcastNoteText}
                          onChange={(e) => setBroadcastNoteText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleBroadcastNote(); } }}
                        />
                        <button type="button"
                          onClick={handleBroadcastNote}
                          className="toolbar-btn self-end"
                          disabled={!broadcastNoteText.trim()}
                          style={{ background: '#7c3aed20', borderColor: '#7c3aed50', color: '#a78bfa', padding: '2px 8px', fontSize: '9px' }}
                          title="Send note to all assigned unit officers"
                        >
                          <Radio style={{ width: 9, height: 9 }} /> Broadcast
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Linked Incidents — Notes tab */}
                {detailTab === 'notes' && linkedIncidents.length > 0 && (
                  <div className="border-t border-[#2b2b2b] pt-3 flex-shrink-0">
                    <label className="field-label !flex items-center gap-1.5 mb-2" style={{ color: '#d4a017', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <Link className="w-3 h-3" /> Linked Incidents
                    </label>
                    <div className="space-y-1 mt-1">
                      {linkedIncidents.map((inc: any) => (
                        <div
                          key={inc.id || inc.incident_number}
                          className="flex items-center gap-3 px-2.5 py-1.5 cursor-pointer transition-all duration-100 rounded-sm"
                          style={{ border: '1px solid transparent' }}
                          onClick={() => navigate(`/incidents/${inc.id}`)}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#18181830'; (e.currentTarget as HTMLElement).style.borderColor = '#2b2b2b40'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.borderColor = 'transparent'; }}
                        >
                          <span className="font-mono text-green-400 text-xs font-bold tabular-nums" style={{ textShadow: '0 0 6px rgba(74,222,128,0.15)' }}>{inc.incident_number}</span>
                          <span className="text-xs text-rmpg-200 truncate">{formatIncidentType(inc.type || inc.incident_type || '--')}</span>
                          <span className="text-xs text-rmpg-400 uppercase font-semibold">{(inc.status || '--').replace(/_/g, ' ')}</span>
                          {inc.officer_name && (
                            <span className="text-xs text-rmpg-300 ml-auto flex items-center gap-1">
                              <User className="w-3 h-3" /> {inc.officer_name}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── ATTACHMENTS TAB ─── */}
                {detailTab === 'attachments' && selectedCall.id && (
                  <div className="px-3 py-2">
                    <FileAttachments
                      entityType="call"
                      entityId={selectedCall.id}
                    />
                  </div>
                )}

                {/* ── AUDIT TAB ─── chronological status changes from activity_log */}
                {detailTab === 'audit' && selectedCall.id && (
                  <div className="px-3 py-2">
                    {auditTrailLoading ? (
                      <div className="text-[11px] text-rmpg-500 font-mono">Loading audit trail…</div>
                    ) : auditTrail.length === 0 ? (
                      <div className="text-[11px] text-rmpg-500 font-mono">No audit entries for this call</div>
                    ) : (
                      <div className="space-y-1">
                        {auditTrail.map((ev: any) => (
                          <div key={ev.id} className="flex items-start gap-2 text-[10px] font-mono py-1 border-b border-[#1a1a1a]">
                            <span className="text-rmpg-500 tabular-nums whitespace-nowrap">{(ev.created_at || '').slice(5, 16).replace('T', ' ')}</span>
                            <span className="text-amber-300 font-bold uppercase whitespace-nowrap">{ev.action}</span>
                            <span className="text-rmpg-300 truncate flex-1" title={ev.details || ''}>{ev.details || ''}</span>
                            <span className="text-rmpg-400 whitespace-nowrap">{ev.user_name || ev.username || `#${ev.user_id ?? '?'}`}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Disposition Prompt — shown when Clear is clicked */}
              {dispositionPromptCallId === selectedCall.id && (
                <div className="px-3">
                  <DispositionPrompt
                    callNumber={selectedCall.call_number}
                    dispositionCodes={dispositionCodes}
                    onConfirm={handleConfirmClear}
                    onCancel={() => setDispositionPromptCallId(null)}
                  />
                </div>
              )}

              {/* BOLO Alert Banner — matches active BOLOs */}
              {selectedCall.subject_description || selectedCall.vehicle_description ? (
                <div className="px-3">
                  <BoloAlertBanner
                    address={selectedCall.location}
                    subject={selectedCall.subject_description}
                    vehicle={selectedCall.vehicle_description}
                  />
                </div>
              ) : null}

            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[#6b7280]">
              <div className="text-center">
                <div className="mx-auto mb-4 w-14 h-14 flex items-center justify-center rounded-sm" style={{ background: '#0c0c0c60', border: '1px solid #2b2b2b40' }}>
                  <Radio className="w-7 h-7" style={{ opacity: 0.3 }} />
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5">Select a call to view details</p>
                <p className="text-[10px] text-[#545454] max-w-[220px] mx-auto leading-relaxed">Click a call card or use arrow keys to navigate</p>
                <div className="flex items-center justify-center gap-4 mt-4 text-[9px] font-mono text-[#545454]">
                  <div className="flex items-center gap-1.5">
                    <kbd className="px-1.5 py-0.5 border border-[#2b2b2b] rounded-sm bg-[#0c0c0c40] text-[#6b7280]">N</kbd>
                    <span>New Call</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <kbd className="px-1.5 py-0.5 border border-[#2b2b2b] rounded-sm bg-[#0c0c0c40] text-[#6b7280]">P</kbd>
                    <span>Quick PSO</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <kbd className="px-1.5 py-0.5 border border-[#2b2b2b] rounded-sm bg-[#0c0c0c40] text-[#6b7280]">R</kbd>
                    <span>Refresh</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          </div>

          {/* AI Dispatch Sidebar (conditionally shown between detail and map) */}
          {showAiSidebar && selectedCall && (
            <AIDispatchSidebar
              selectedCall={selectedCall}
              aiAnalyses={aiAnalyses}
              onAcceptFlag={async (callId, flag) => {
                try {
                  await apiFetch(`/dispatch/calls/${callId}`, {
                    method: 'PUT',
                    body: JSON.stringify({ [flag]: true }),
                  });
                  const updated = { ...selectedCall, [flag]: 1 };
                  setSelectedCall(updated);
                  setCalls(prev => prev.map(c => c.id === callId ? updated : c));
                  addToast(`Flag "${flag.replace(/_/g, ' ').toUpperCase()}" accepted`, 'success');
                } catch { addToast(`Failed to set flag`, 'error'); }
              }}
              onDismiss={() => setShowAiSidebar(false)}
            />
          )}

          {/* Dispatch Map Panel (right side, always visible) */}
          <div className="w-[35%] border-l border-[#2b2b2b] flex flex-col overflow-hidden flex-shrink-0" style={{ background: 'var(--surface-deep)' }}>
            {selectedCall?.latitude != null && selectedCall?.longitude != null ? (
              mapEngine === 'mapbox' ? (
                <MapboxMiniMap
                  call={selectedCall}
                  units={units}
                  fullHeight
                  onRouteUpdate={setRouteInfo}
                />
              ) : (
                <DispatchMiniMap
                  call={selectedCall}
                  units={units}
                  fullHeight
                  onRouteUpdate={setRouteInfo}
                  serveRouteJobs={PSO_INCIDENT_TYPES.includes(selectedCall?.incident_type || '') ? serveRouteJobs : undefined}
                  serveRouteOrder={PSO_INCIDENT_TYPES.includes(selectedCall?.incident_type || '') ? serveRouteOrder : undefined}
                />
              )
            ) : (
              <div className="flex-1 flex items-center justify-center text-[#545454]">
                <div className="text-center">
                  <div className="mx-auto mb-3 w-14 h-14 flex items-center justify-center rounded-sm" style={{ background: '#0c0c0c50', border: '1px dashed #2b2b2b40' }}>
                    <MapPin className="w-6 h-6" style={{ opacity: 0.25 }} />
                  </div>
                  <p className="text-[10px] font-mono font-bold uppercase tracking-widest mb-1">No Location Data</p>
                  <p className="text-[8px] text-[#404040] leading-relaxed max-w-[160px] mx-auto">Select a geolocated call to display the dispatch map</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------ */}
        {/* BOTTOM - Unit Status Board (shorter, ~35% height) */}
        {/* ------------------------------------------------------------ */}
        <div className="h-[35%] flex flex-col overflow-hidden flex-shrink-0">
          <PanelTitleBar title="UNIT STATUS BOARD" icon={Radio}>
            <span className="flex items-center gap-1 text-[9px] font-mono font-bold tabular-nums" style={{ color: '#4ade80' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e', boxShadow: '0 0 4px #22c55e80' }} />
              {units.filter((u) => u.status === 'available').length} AVAIL
            </span>
            <span className="toolbar-separator" />
            <span className="text-[9px] font-mono tabular-nums" style={{ color: '#666666' }}>
              {units.filter((u) => u.status !== 'off_duty').length} ON DUTY
            </span>
            <span className="toolbar-separator" />
            <button type="button" onClick={() => setShowCreateUnitModal(true)} className="toolbar-btn toolbar-btn-primary">
              <Plus style={{ width: 10, height: 10 }} /> New Unit
            </button>
          </PanelTitleBar>
          <div className="flex-1 overflow-auto">
            <UnitStatusBoard
              units={units}
              onUnitClick={(unit) => {
                if (unit.current_call_id) {
                  const call = calls.find((c) => c.id === unit.current_call_id);
                  if (call) setSelectedCall(call);
                }
              }}
              onCreateUnit={() => setShowCreateUnitModal(true)}
              onEditUnit={openEditUnit}
              onDeleteUnit={(unit) => setDeletingUnit(unit)}
              selectedCallId={selectedCall?.id ?? null}
              assignedUnitIds={selectedCall?.assigned_units ?? []}
              onAssignUnit={selectedCall && !['cleared', 'closed', 'cancelled', 'archived'].includes(selectedCall.status) ? handleAssignUnit : undefined}
            />
          </div>
        </div>
      </div>

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-[100]"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 200),
            top: Math.min(contextMenu.y, window.innerHeight - 300),
          }}
        >
          <div
            className="py-1 min-w-[190px] rounded-sm"
            style={{ background: '#141414', border: '1px solid #2a2a2a', boxShadow: '0 8px 24px rgba(0,0,0,0.6), 0 0 1px rgba(255,255,255,0.05) inset', WebkitBackdropFilter: 'blur(8px)', backdropFilter: 'blur(8px)' }}
            onMouseLeave={() => setContextMenu(null)}
          >
            {contextMenu.call.status === 'pending' && (
              <button type="button" className="context-menu-item" onClick={() => { handleStatusChange(contextMenu.call.id, 'dispatched'); setContextMenu(null); }}>
                <Send style={{ width: 12, height: 12 }} /> Dispatch
              </button>
            )}
            {contextMenu.call.status === 'dispatched' && (
              <button type="button" className="context-menu-item" onClick={() => { handleStatusChange(contextMenu.call.id, 'enroute'); setContextMenu(null); }}>
                <Navigation style={{ width: 12, height: 12 }} /> En Route
              </button>
            )}
            {contextMenu.call.status === 'enroute' && (
              <button type="button" className="context-menu-item" onClick={() => { handleStatusChange(contextMenu.call.id, 'onscene'); setContextMenu(null); }}>
                <Eye style={{ width: 12, height: 12 }} /> On Scene
              </button>
            )}
            {['dispatched', 'enroute', 'onscene'].includes(contextMenu.call.status) && (
              <>
                <button type="button" className="context-menu-item" onClick={() => { handleClearWithDisposition(contextMenu.call.id); setContextMenu(null); }}>
                  <CheckCircle style={{ width: 12, height: 12 }} /> Clear
                </button>
                <button type="button" className="context-menu-item" onClick={() => { handleHoldCall(contextMenu.call.id); setContextMenu(null); }}>
                  ⏸ Hold
                </button>
              </>
            )}
            {contextMenu.call.status === 'on_hold' && (
              <button type="button" className="context-menu-item" onClick={() => { handleResumeCall(contextMenu.call.id); setContextMenu(null); }}>
                ▶ Resume
              </button>
            )}
            {contextMenu.call.status !== 'archived' && (
              <>
                <div className="border-t border-rmpg-600 my-1" />
                <button type="button" className="context-menu-item" onClick={() => { handleArchive(contextMenu.call.id); setContextMenu(null); }}>
                  <Archive style={{ width: 12, height: 12 }} /> Archive
                </button>
              </>
            )}
            <div className="border-t border-rmpg-600 my-1" />
            {/* Priority change shortcuts */}
            <div className="flex items-center gap-0.5 px-2 py-1">
              <span className="text-[9px] text-rmpg-500 mr-1.5">PRI:</span>
              {(['P1', 'P2', 'P3', 'P4'] as const).map(pri => (
                <button key={pri} type="button" onClick={() => { handlePriorityChange(contextMenu.call.id, pri); setContextMenu(null); }}
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm ${contextMenu.call.priority === pri ? 'ring-1 ring-white' : 'opacity-60 hover:opacity-100'}`}
                  style={{ background: pri === 'P1' ? '#dc2626' : pri === 'P2' ? '#d97706' : pri === 'P3' ? '#888888' : '#555555', color: '#fff' }}>
                  {pri}
                </button>
              ))}
            </div>
            <div className="border-t border-rmpg-600 my-1" />
            <button type="button" className="context-menu-item" onClick={() => { setSelectedCall(contextMenu.call); setIsEditing(true); setContextMenu(null); }}>
              <Pencil style={{ width: 12, height: 12 }} /> Edit Call
            </button>
            <button type="button" className="context-menu-item" onClick={() => { navigator.clipboard.writeText(contextMenu.call.call_number); setContextMenu(null); addToast('Call number copied', 'success'); }}>
              Copy Call Number
            </button>
            <button type="button" className="context-menu-item" onClick={() => { navigator.clipboard.writeText(`${contextMenu.call.call_number} | ${contextMenu.call.incident_type} | ${contextMenu.call.location} | ${contextMenu.call.priority} | ${contextMenu.call.status}`); setContextMenu(null); addToast('Call summary copied', 'success'); }}>
              Copy Summary
            </button>
            {contextMenu.call.status !== 'archived' && contextMenu.call.status !== 'cancelled' && (
              <button type="button" className="context-menu-item" onClick={() => {
                // Duplicate call as new — safe access for optional fields
                const c = contextMenu.call;
                setTemplateInitialData({
                  incident_type: c.incident_type || 'other',
                  priority: c.priority || 'P3',
                  location: c.location || '',
                  description: c.description || '',
                  source: c.source || 'dispatch',
                });
                setShowNewCallModal(true);
                setContextMenu(null);
              }}>
                <Copy style={{ width: 12, height: 12 }} /> Duplicate as New
              </button>
            )}
            <div className="border-t border-rmpg-600 my-1" />
            <button type="button" className="context-menu-item text-red-400" onClick={() => { setDeleteCallTarget(contextMenu.call); setContextMenu(null); }}>
              <Trash2 style={{ width: 12, height: 12 }} /> Delete
            </button>
          </div>
        </div>
      )}

      {/* Quick Template Dialog — minimal address-only dispatch */}
      {quickTemplateData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" style={{ background: 'rgba(0,0,0,0.65)', WebkitBackdropFilter: 'blur(4px)', backdropFilter: 'blur(4px)' }} onKeyDown={(e) => { if (e.key === 'Escape') setQuickTemplateData(null); }}>
          <form
            className="panel-beveled bg-surface-raised animate-in rounded-sm"
            style={{ width: '440px', border: '1px solid #2a2a2a', boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 1px rgba(255,255,255,0.05) inset' }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!quickTemplateAddress.trim() || quickTemplateSubmitting) return;
              setQuickTemplateSubmitting(true);
              try {
                await handleNewCall({
                  incident_type: quickTemplateData.incident_type,
                  priority: quickTemplateData.priority as any,
                  description: quickTemplateData.description,
                  source: quickTemplateData.source as any,
                  location: quickTemplateAddress.trim(),
                  latitude: quickTemplateCoords.lat,
                  longitude: quickTemplateCoords.lng,
                } as any);
                setQuickTemplateData(null);
              } catch {
                setQuickTemplateSubmitting(false);
              }
            }}
          >
            {/* Header */}
            <div className="panel-title-bar flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="w-3.5 h-3.5 text-brand-400" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">Quick Dispatch</span>
              </div>
              <button type="button" onClick={() => setQuickTemplateData(null)} className="text-rmpg-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Template banner */}
              <div className="flex items-center gap-3 p-2 border border-rmpg-600" style={{ background: '#050505' }}>
                <span className={`text-xs font-bold px-2 py-0.5 border ${
                  quickTemplateData.priority === 'P1' ? 'border-red-500 text-red-400 bg-red-900/30' :
                  quickTemplateData.priority === 'P2' ? 'border-amber-500 text-amber-400 bg-amber-900/30' :
                  quickTemplateData.priority === 'P4' ? 'border-rmpg-500 text-rmpg-300 bg-rmpg-700/30' :
                  'border-brand-500 text-brand-400 bg-brand-900/30'
                }`}>{quickTemplateData.priority}</span>
                <span className="text-xs font-bold text-white">{quickTemplateData.name}</span>
                <span className="text-[10px] text-rmpg-400 ml-auto">{formatIncidentType(quickTemplateData.incident_type)}</span>
              </div>

              {/* Address input — auto-focused */}
              <div>
                <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">
                  <MapPin className="w-3 h-3 inline mr-1" />
                  Location / Address *
                </label>
                <AddressAutocomplete
                  className="input-dark"
                  placeholder="123 Main St, Salt Lake City, UT"
                  value={quickTemplateAddress}
                  onChange={setQuickTemplateAddress}
                  onSelect={(addr: ParsedAddress) => {
                    setQuickTemplateAddress(addr.formatted);
                    if (addr.latitude != null) {
                      setQuickTemplateCoords({ lat: addr.latitude, lng: addr.longitude! });
                    }
                  }}
                  autoFocus
                  required
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-rmpg-700">
                <button
                  type="button"
                  className="toolbar-btn text-xs"
                  onClick={() => {
                    // Transfer data to full NewCallModal
                    setTemplateInitialData({
                      incident_type: quickTemplateData.incident_type,
                      priority: quickTemplateData.priority,
                      description: quickTemplateData.description,
                      source: quickTemplateData.source,
                      location: quickTemplateAddress,
                    });
                    setQuickTemplateData(null);
                    setShowNewCallModal(true);
                  }}
                >
                  Full Form →
                </button>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setQuickTemplateData(null)} className="toolbar-btn text-xs">Cancel</button>
                  <button
                    type="submit"
                    disabled={!quickTemplateAddress.trim() || quickTemplateSubmitting}
                    className="toolbar-btn toolbar-btn-primary text-xs"
                  >
                    {quickTemplateSubmitting ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Dispatching...</>
                    ) : (
                      <><Send className="w-3 h-3" /> Dispatch</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* New Call Modal */}
      <NewCallModal
        isOpen={showNewCallModal}
        onClose={() => { setShowNewCallModal(false); setTemplateInitialData(undefined); }}
        onSubmit={handleNewCall}
        properties={propertiesList}
        clients={clientsList}
        initialData={templateInitialData}
        defaultMode="quick"
      />

      {/* Quick PSO Modal */}
      <QuickPsoModal
        isOpen={showQuickPsoModal}
        onClose={() => setShowQuickPsoModal(false)}
        onSubmit={handleNewCall}
        onExpandToFullForm={handlePsoExpandToFullForm}
      />

      {/* Create / Edit Unit Modal */}
      {showCreateUnitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={unitModalTitleId} style={{ background: 'rgba(0,0,0,0.65)', WebkitBackdropFilter: 'blur(4px)', backdropFilter: 'blur(4px)' }}>
          <div className="panel-beveled bg-surface-raised" style={{ width: '420px', border: '1px solid #2a2a2a', boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 1px rgba(255,255,255,0.05) inset' }}>
            <div className="panel-title-bar">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-brand-400" />
                <span id={unitModalTitleId} className="text-sm font-bold text-white tracking-wide">{editingUnit ? 'Edit Dispatch Unit' : 'Create Dispatch Unit'}</span>
              </div>
              <button type="button" onClick={() => { setShowCreateUnitModal(false); setEditingUnit(null); setNewUnitCallSign(''); setNewUnitOfficerId(''); setNewUnitStatus('available'); }} className="toolbar-btn ml-auto">
                <X style={{ width: 12, height: 12 }} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="field-label">Call Sign *</label>
                <input
                  type="text"
                  className="input-dark text-sm w-full mt-1"
                  placeholder="e.g. PATROL-01, K9-01, SUPER-01"
                  value={newUnitCallSign}
                  onChange={(e) => setNewUnitCallSign(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveUnit()}
                  autoFocus
                />
              </div>
              <div>
                <label className="field-label">Assigned Officer</label>
                <select
                  className="select-dark text-sm w-full mt-1"
                  value={newUnitOfficerId}
                  onChange={(e) => setNewUnitOfficerId(e.target.value)}
                >
                  <option value="">-- Unassigned --</option>
                  {officers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.full_name}{o.badge_number ? ` (${o.badge_number})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Status</label>
                <select
                  className="select-dark text-sm w-full mt-1"
                  value={newUnitStatus}
                  onChange={(e) => setNewUnitStatus(e.target.value)}
                >
                  <option value="available">Available</option>
                  <option value="off_duty">Off Duty</option>
                  <option value="busy">Busy</option>
                  {editingUnit && <option value="dispatched">Dispatched</option>}
                  {editingUnit && <option value="enroute">En Route</option>}
                  {editingUnit && <option value="onscene">On Scene</option>}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-600">
                <button type="button" onClick={() => { setShowCreateUnitModal(false); setEditingUnit(null); setNewUnitCallSign(''); setNewUnitOfficerId(''); setNewUnitStatus('available'); }} className="toolbar-btn">
                  Cancel
                </button>
                <button type="button"
                  onClick={handleSaveUnit}
                  disabled={!newUnitCallSign.trim() || unitCreating}
                  className="toolbar-btn toolbar-btn-primary"
                >
                  {unitCreating ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : editingUnit ? <Save style={{ width: 12, height: 12 }} /> : <Plus style={{ width: 12, height: 12 }} />}
                  {editingUnit ? 'Save Changes' : 'Create Unit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Unit Confirmation */}
      <ConfirmDialog
        isOpen={deletingUnit !== null}
        onClose={() => setDeletingUnit(null)}
        onConfirm={handleDeleteUnit}
        title="Delete Dispatch Unit"
        message={`Are you sure you want to permanently delete unit "${deletingUnit?.call_sign || ''}"? This action cannot be undone.`}
        confirmLabel="Delete Unit"
        confirmVariant="danger"
        isLoading={unitDeleting}
      />

      {/* Delete Call Confirmation */}
      <ConfirmDialog
        isOpen={deleteCallTarget !== null}
        onClose={() => setDeleteCallTarget(null)}
        onConfirm={handleDeleteAnyCall}
        title="Delete Call"
        message={`Are you sure you want to permanently delete call "${deleteCallTarget?.call_number || ''}"? This will also free any assigned units. This action cannot be undone.`}
        confirmLabel="Delete Call"
        confirmVariant="danger"
        isLoading={isDeletingCall}
      />

      {/* Floating Save Bar (visible when editing) */}
      <FloatingSaveBar
        visible={isEditing}
        onSave={saveEditing}
        onCancel={cancelEditing}
        isSaving={isSaving}
      />

      {/* CAD Command Line (replaces keyboard shortcuts bar) */}
      <div className="absolute bottom-0 left-0 right-0 z-30">
        <CadCommandLine
          context={{
            units: units.map(u => ({
              id: String(u.id),
              call_sign: u.call_sign,
              status: u.status,
              current_call_id: u.current_call_id ? String(u.current_call_id) : undefined,
            })),
            calls: calls.map(c => ({
              id: String(c.id),
              call_number: c.call_number,
              status: c.status,
            })),
            currentUser: user?.full_name || user?.username || 'Dispatch',
          }}
          onAction={(action: CommandAction) => {
            switch (action.type) {
              case 'new_call':
                if (action.incidentType && action.location) {
                  // Both type + address → Quick Template Dialog (fastest path)
                  setQuickTemplateData({
                    name: formatIncidentType(action.incidentType),
                    incident_type: action.incidentType,
                    priority: 'P3',
                    description: '',
                    source: 'dispatch',
                  });
                  setQuickTemplateAddress(action.location);
                  setQuickTemplateCoords({ lat: null, lng: null });
                  setQuickTemplateSubmitting(false);
                } else {
                  // Type only → open NewCallModal in quick mode with type pre-selected
                  setTemplateInitialData({
                    incident_type: action.incidentType,
                    location: action.location || '',
                  });
                  setShowNewCallModal(true);
                }
                break;
              case 'query_person':
                setNcicInitialQuery({ type: 'person', query: action.query });
                setShowNcicPanel(true);
                announceTarget(`run name ${action.query}`).catch(() => { /* announcer is best-effort */ });
                break;
              case 'query_vehicle':
                setNcicInitialQuery({ type: 'vehicle', query: action.query });
                setShowNcicPanel(true);
                announceTarget(`run plate ${action.query}`).catch(() => { /* announcer is best-effort */ });
                break;
              case 'query_warrant':
                setNcicInitialQuery({ type: 'warrant', query: action.query });
                setShowNcicPanel(true);
                announceTarget(`run name ${action.query}`).catch(() => { /* announcer is best-effort */ });
                break;
              case 'assign_unit':
              case 'set_status':
              case 'clear_call':
              case 'dispatch_units':
              case 'add_note':
              case 'change_priority':
              case 'create_bolo':
                // These are already executed via API in cadCommandParser.
                // Refresh data to reflect changes.
                fetchData();
                break;
              case 'unit_status_check':
                // Info-only — also speak it via the announcer
                if (action.callSign) {
                  announceTarget(`status of ${action.callSign}`).catch(() => { /* announcer best-effort */ });
                } else {
                  announceTarget('sitrep').catch(() => { /* announcer best-effort */ });
                }
                break;
              case 'query_bolo':
                navigate('/communications');
                announceTarget(`BOLO ${action.query}`).catch(() => { /* announcer best-effort */ });
                break;
              case 'new_fi':
                // Navigate to field interviews page
                navigate('/field-interviews');
                break;
              case 'query_trespass':
                navigate('/trespass-orders');
                announceTarget(`trespass ${action.query}`).catch(() => { /* announcer best-effort */ });
                break;
              case 'premise_history':
                announceTarget(`area check ${action.address}`).catch(() => { /* announcer best-effort */ });
                break;
              case 'premise_alert':
                announceTarget(`premise alert ${action.address}`).catch(() => { /* announcer best-effort */ });
                break;
              case 'hold_call':
                // Already executed via API in cadCommandParser. Refresh data.
                fetchData();
                break;
              case 'select_call': {
                // CI command — find and select the call
                const targetCall = calls.find(c => c.id === action.callId);
                if (targetCall) {
                  setSelectedCall(targetCall);
                  setDetailTab('info');
                }
                break;
              }
              case 'set_mileage':
                // ML command — mileage logged via API, refresh data
                fetchData();
                break;
              case 'promote_incident':
              case 'le_notify':
                fetchData();
                break;
              case 'voice_status': {
                // Voice announce unit status — find unit data and speak it
                if (action.callSign) {
                  const unit = units.find(u => u.call_sign === action.callSign);
                  if (unit) {
                    announceStatusChange(unit.call_sign, unit.status);
                  }
                } else {
                  const active = units.filter(u => u.status !== 'off_duty');
                  const msg = `${active.length} units active. ${active.filter(u => u.status === 'available').length} available.`;
                  announceCallUpdate('', msg);
                }
                break;
              }
              case 'voice_check': {
                // Voice read-back call details
                const call = calls.find(c => c.call_number === action.callNumber);
                if (call) {
                  announceDispatchEvent(call);
                }
                break;
              }
              case 'voice_eta': {
                // Voice announce ETA — announce unit status as proxy (GPS ETA would need server)
                const unit = units.find(u => u.call_sign === action.callSign);
                if (unit) {
                  const statusLabel = unit.status === 'enroute' ? 'en route' : unit.status.replace(/_/g, ' ').toUpperCase();
                  announceCallUpdate('', `Unit ${unit.call_sign} is currently ${statusLabel}`);
                }
                break;
              }
              case 'voice_weather':
                // Voice weather — use selected call location weather if available
                if (selectedCall?.weather_conditions) {
                  announceCallUpdate('', `Weather conditions: ${selectedCall.weather_conditions}`);
                } else {
                  announceCallUpdate('', 'No weather data available for current location');
                }
                break;
              case 'voice_time':
                announceTime();
                break;
              case 'voice_ack':
                announceAcknowledgment();
                break;
              case 'voice_allclear': {
                const callNum = action.callNumber || selectedCall?.call_number;
                if (callNum) {
                  announceAllClear(callNum);
                } else {
                  announceAllClear('current call');
                }
                break;
              }
              case 'voice_summary': {
                // Shift summary — compute stats from current calls and units
                const activeCalls = calls.filter(c => !['archived', 'cancelled'].includes(c.status));
                const completed = calls.filter(c => ['cleared', 'closed'].includes(c.status));
                const pending = calls.filter(c => c.status === 'pending');
                const psoServes = completed.filter(c => c.incident_type === 'pso_client_request');
                const totalMi = activeCalls.reduce((sum, c) => {
                  if (c.starting_mileage && c.ending_mileage) return sum + (Number(c.ending_mileage) - Number(c.starting_mileage));
                  return sum;
                }, 0);
                announceShiftSummary({
                  calls: activeCalls.length + completed.length,
                  serves: psoServes.length,
                  pending: pending.length,
                  avgResponse: 0,
                  totalMiles: totalMi,
                });
                break;
              }
              case 'voice_locate': {
                // Announce unit last known location (from current call or status)
                const unit = units.find(u => u.call_sign === action.callSign);
                if (unit && unit.current_call_id) {
                  const call = calls.find(c => c.id === String(unit.current_call_id));
                  const loc = call?.location || 'unknown location';
                  announceCallUpdate('', `Unit ${unit.call_sign} last reported at ${loc}. Status: ${unit.status.replace(/_/g, ' ').toUpperCase()}.`);
                } else if (unit) {
                  announceCallUpdate('', `Unit ${unit.call_sign} is ${unit.status.replace(/_/g, ' ').toUpperCase()}. No active call assigned.`);
                }
                break;
              }
              case 'voice_serve': {
                // Announce serve details for a call
                const call = calls.find(c => c.call_number === action.callNumber);
                if (call) {
                  const docType = (call as any).process_service_type || (call as any).pso_service_type || 'unknown';
                  const servedTo = (call as any).process_served_to || (call as any).caller_name || 'unknown';
                  const attempt = (call as any).pso_attempt_number || (call as any).process_attempts || 1;
                  const result = (call as any).process_service_result || 'pending';
                  announceServeComplete(servedTo, call.location || '', docType, attempt, result);
                }
                break;
              }
              case 'voice_deadline': {
                // Announce 72hr deadline status for a PSO call
                const call = calls.find(c => c.call_number === action.callNumber);
                if (call) {
                  const terminalTime = (call as any).closed_at || (call as any).cleared_at;
                  if (terminalTime) {
                    const elapsed = Date.now() - new Date(terminalTime).getTime();
                    const hoursLeft = Math.max(0, 72 - elapsed / 3600000);
                    const caseNum = call.case_number || call.call_number;
                    announceCourtDeadline(caseNum, hoursLeft, (call as any).process_served_to || (call as any).caller_name);
                  } else {
                    announceCallUpdate('', `Call ${call.call_number} has not been cleared or closed yet. No deadline active.`);
                  }
                }
                break;
              }
              case 'voice_stack': {
                // Announce stacked calls at the selected call's location
                if (selectedCall?.location) {
                  const locKey = selectedCall.location.toLowerCase().trim();
                  const stacked = calls.filter(c => c.location && c.location.toLowerCase().trim() === locKey && !['archived', 'cancelled'].includes(c.status));
                  if (stacked.length > 1) {
                    const unitSet = new Set<string>();
                    stacked.forEach(c => (c.assigned_units || []).forEach(u => unitSet.add(u)));
                    const unitNames = units.filter(u => unitSet.has(String(u.id))).map(u => u.call_sign);
                    announceCallStack(stacked.length, selectedCall.location, unitNames);
                  } else {
                    announceCallUpdate('', `No stacked calls at ${selectedCall.location}.`);
                  }
                } else {
                  announceCallUpdate('', 'No call selected. Select a call to check for stacked calls.');
                }
                break;
              }
              case 'voice_units': {
                // Announce all unit statuses
                const active = units.filter(u => u.status !== 'off_duty');
                const avail = active.filter(u => u.status === 'available').length;
                const enr = active.filter(u => u.status === 'enroute').length;
                const ons = active.filter(u => u.status === 'onscene').length;
                const busy = active.filter(u => u.status === 'busy').length;
                announceCallUpdate('', `${active.length} units active. ${avail} available, ${enr} en route, ${ons} on scene, ${busy} busy.`);
                break;
              }
              case 'voice_pending': {
                // Announce pending calls
                const pending = calls.filter(c => c.status === 'pending');
                if (pending.length === 0) {
                  announceCallUpdate('', 'No pending calls.');
                } else {
                  const details = pending.slice(0, 5).map(c => `${c.call_number}, ${c.incident_type?.replace(/_/g, ' ').toUpperCase() || 'unknown'}`).join('. ');
                  announceCallUpdate('', `${pending.length} pending calls. ${details}.`);
                }
                break;
              }
              case 'voice_priority': {
                // Announce priority breakdown
                const active = calls.filter(c => !['archived', 'cancelled'].includes(c.status));
                const p1 = active.filter(c => c.priority === 'P1').length;
                const p2 = active.filter(c => c.priority === 'P2').length;
                const p3 = active.filter(c => c.priority === 'P3').length;
                const p4 = active.filter(c => c.priority === 'P4').length;
                announceCallUpdate('', `Priority breakdown. ${p1} priority 1. ${p2} priority 2. ${p3} priority 3. ${p4} priority 4.`);
                break;
              }
            }
          }}
        />
      </div>

      {/* NCIC Query Terminal Panel */}
      <NcicQueryPanel
        isOpen={showNcicPanel}
        onClose={() => { setShowNcicPanel(false); setNcicInitialQuery(null); }}
        initialQuery={ncicInitialQuery}
      />

      {/* Create Person from Dispatch */}
      <PersonFormModal
        isOpen={showCreatePersonModal}
        onClose={() => setShowCreatePersonModal(false)}
        onSubmit={handleCreatePersonFromDispatch}
        isSubmitting={isCreatingRecord}
      />

      {/* Create Vehicle from Dispatch */}
      <VehicleFormModal
        isOpen={showCreateVehicleModal}
        onClose={() => setShowCreateVehicleModal(false)}
        onSubmit={handleCreateVehicleFromDispatch}
        isSubmitting={isCreatingRecord}
      />

      {/* Feature 5: Shift Handoff Notes Modal */}
      {showHandoffNotes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.65)', WebkitBackdropFilter: 'blur(4px)', backdropFilter: 'blur(4px)' }} onClick={() => setShowHandoffNotes(false)}>
          <div className="bg-surface-raised w-[500px] max-h-[80vh] flex flex-col rounded-sm" style={{ border: '1px solid #2a2a2a', boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 1px rgba(255,255,255,0.05) inset' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-600" style={{ background: '#050505' }}>
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-brand-400" />
                <h3 className="text-sm font-bold text-white">Shift Handoff Notes</h3>
              </div>
              <button type="button" onClick={() => setShowHandoffNotes(false)} className="text-rmpg-400 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-3 flex-1 overflow-auto" style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
              {handoffMeta.updated_by && (
                <p className="text-[10px] text-rmpg-400 mb-2">
                  Last updated by <span className="text-amber-400">{handoffMeta.updated_by}</span>
                  {handoffMeta.updated_at && ` at ${new Date(handoffMeta.updated_at).toLocaleString()}`}
                </p>
              )}
              <textarea
                value={handoffNotes}
                onChange={e => setHandoffNotes(e.target.value)}
                className="input-dark w-full h-48 text-sm resize-none"
                placeholder="Leave notes for the incoming shift dispatcher..."
              />
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-rmpg-600">
              <button type="button" onClick={() => setShowHandoffNotes(false)} className="toolbar-btn">Cancel</button>
              <button type="button" onClick={saveHandoffNotes} disabled={savingHandoff} className="toolbar-btn toolbar-btn-primary">
                {savingHandoff ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save Notes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* DISPATCH STATUS BAR — Fixed bottom footer                   */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="hidden md:flex items-center justify-between px-3 h-[22px] flex-shrink-0 border-t select-none fixed bottom-0 left-0 right-0 z-[90]"
        style={{ background: '#050505', borderColor: '#141414', fontFamily: "JetBrains Mono, Courier New, monospace" }}>
        {/* Left: Call metrics */}
        <div className="flex items-center gap-3 text-[9px] tabular-nums">
          <span className="text-rmpg-500 uppercase tracking-wider font-bold">CAD</span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#ef4444', boxShadow: calls.filter(c => c.priority === 'P1' && !['cleared','closed','archived','cancelled'].includes(c.status)).length > 0 ? '0 0 6px #ef4444' : 'none' }} />
            <span style={{ color: '#fca5a5' }}>P1: {calls.filter(c => c.priority === 'P1' && !['cleared','closed','archived','cancelled'].includes(c.status)).length}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span style={{ color: '#fcd34d' }}>P2: {calls.filter(c => c.priority === 'P2' && !['cleared','closed','archived','cancelled'].includes(c.status)).length}</span>
          </span>
          <span style={{ color: '#666666' }}>|</span>
          <span style={{ color: '#999999' }}>
            PENDING: <span style={{ color: calls.filter(c => c.status === 'pending').length > 0 ? '#fbbf24' : '#4ade80' }}>{calls.filter(c => c.status === 'pending').length}</span>
          </span>
          <span style={{ color: '#999999' }}>
            ACTIVE: <span style={{ color: '#aaaaaa' }}>{calls.filter(c => ['dispatched','enroute','onscene'].includes(c.status)).length}</span>
          </span>
          <span style={{ color: '#999999' }}>
            HOLD: <span style={{ color: calls.filter(c => c.status === 'on_hold').length > 0 ? '#f97316' : '#555555' }}>{calls.filter(c => c.status === 'on_hold').length}</span>
          </span>
          {(() => {
            const stacked = new Map<string, number>();
            calls.filter(c => !['cleared','closed','archived','cancelled'].includes(c.status) && c.location).forEach(c => {
              const key = c.location.toLowerCase().trim();
              stacked.set(key, (stacked.get(key) || 0) + 1);
            });
            const stackedCount = Array.from(stacked.values()).filter(v => v > 1).length;
            return stackedCount > 0 ? (
              <span style={{ color: '#f97316' }}>STACKED: {stackedCount}</span>
            ) : null;
          })()}
        </div>

        {/* Center: Unit metrics */}
        <div className="flex items-center gap-3 text-[9px] tabular-nums">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e', boxShadow: '0 0 4px #22c55e80' }} />
            <span style={{ color: '#86efac' }}>AVAIL: {units.filter(u => u.status === 'available').length}</span>
          </span>
          <span style={{ color: '#aaaaaa' }}>DISP: {units.filter(u => u.status === 'dispatched').length}</span>
          <span style={{ color: '#a78bfa' }}>ENR: {units.filter(u => u.status === 'enroute').length}</span>
          <span style={{ color: '#c084fc' }}>ONS: {units.filter(u => u.status === 'onscene').length}</span>
          <span style={{ color: '#666666' }}>OFF: {units.filter(u => u.status === 'off_duty').length}</span>
          <span style={{ color: '#666666' }}>|</span>
          <span style={{ color: '#999999' }}>
            TOTAL: <span style={{ color: '#cccccc' }}>{units.length}</span>
          </span>
        </div>

        {/* Right: F-key hints + clock */}
        <div className="flex items-center gap-2 text-[8px] tabular-nums">
          <span style={{ color: '#555555' }}>F2:New</span>
          <span style={{ color: '#555555' }}>F3:Disp</span>
          <span style={{ color: '#555555' }}>F5:EnR</span>
          <span style={{ color: '#555555' }}>F6:OnS</span>
          <span style={{ color: '#555555' }}>F7:Clr</span>
          <span style={{ color: '#555555' }}>F8:CMD</span>
          <span style={{ color: '#555555' }}>F12:NCIC</span>
          <span style={{ color: '#444444' }}>|</span>
          <span style={{ color: '#999999' }}>{new Date().toLocaleTimeString('en-US', { hour12: false })}</span>
        </div>
      </div>
    </div>
  );
}

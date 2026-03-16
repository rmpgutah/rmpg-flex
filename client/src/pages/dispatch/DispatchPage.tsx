import React, { useState, useEffect, useCallback, useRef, useId, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Filter,
  Send,
  Navigation,
  MapPin,
  Clock,
  Phone,
  User,
  MessageSquare,
  Radio,
  ArrowRight,
  Eye,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Loader2,
  FileText,
  ChevronDown,
  Link,
  Archive,
  RotateCcw,
  Edit3,
  Trash2,
  Save,
  X,
  PlusCircle,
  Shield,
  Thermometer,
  Undo2,
  Edit,
  Search,
  Building2,
  Terminal,
} from 'lucide-react';
import type { CallForService, Unit, CallStatus, CallNote, UnitStatus } from '../../types';
import CallCard from '../../components/CallCard';
import UnitStatusBoard from '../../components/UnitStatusBoard';
import DispositionPrompt from '../../components/DispositionPrompt';
import MileagePromptModal from '../../components/MileagePromptModal';
import DispatchMiniMap from '../../components/DispatchMiniMap';
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
import { toDisplayLabel } from '../../utils/formatters';
import ConfirmDialog from '../../components/ConfirmDialog';
import RmpgLogo from '../../components/RmpgLogo';
import PrintButton from '../../components/PrintButton';
import PrintRecordButton from '../../components/PrintRecordButton';
import { useToast } from '../../components/ToastProvider';
import { useWebSocket } from '../../context/WebSocketContext';
import WarningTags from '../../components/WarningTags';
import type { WarningTag } from '../../components/WarningTags';
import FloatingSaveBar from '../../components/FloatingSaveBar';
import CadCommandLine from '../../components/CadCommandLine';
import NcicQueryPanel from '../../components/NcicQueryPanel';
import UnitRecommendationPanel from '../../components/UnitRecommendationPanel';
import type { CommandAction } from '../../utils/cadCommandParser';
import { getTimerState, isActiveStatus } from '../../utils/dispatchTimers';
import { playTone } from '../../utils/dispatchTones';
import { useIsMobile } from '../../hooks/useIsMobile';
import MobileCardList from '../../components/mobile/MobileCardList';
import MobileDetailView from '../../components/mobile/MobileDetailView';
import { mapDbCall, mapDbUnit } from './utils/dispatchMappers';
import { formatTime, formatElapsed, formatActivityDetails, type FilterTab } from './utils/dispatchFormatters';
import { announceCallAlerts, announcePanicAlert, announceNewCall, announceDispatchEvent } from '../../utils/voiceAlerts';
import { useDistrictOptions } from '../../hooks/useDistrictLookup';
import { useUserPreferences } from '../../context/UserPreferencesContext';
import QuickPsoModal from '../../components/QuickPsoModal';
import {
  WEATHER_OPTIONS,
  LIGHTING_OPTIONS,
  WEAPONS_OPTIONS,
  LE_AGENCY_OPTIONS,
  SCENE_SAFETY_OPTIONS,
  DIRECTION_OPTIONS,
} from '../../utils/callOptions';
import PersonFormModal, { type PersonFormData } from '../../components/PersonFormModal';
import VehicleFormModal, { type VehicleFormData } from '../../components/VehicleFormModal';

export default function DispatchPage() {
  const unitModalTitleId = useId();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { subscribe } = useWebSocket();
  const isMobile = useIsMobile();
  const { prefs: userPrefs } = useUserPreferences();
  const { districts, sections, zones, beats, sectionLabels, zoneLabels, beatLabels } = useDistrictOptions();
  const [calls, setCalls] = useState<CallForService[]>([]);
  const recentlyCreatedIdsRef = useRef<Set<string | number>>(new Set()); // synchronous dedup for POST + WS race
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedCall, setSelectedCall] = useState<CallForService | null>(null);
  const [filterTab, setFilterTab] = usePersistedTab('rmpg_dispatch_tab', 'all' as FilterTab, ['all', 'pending', 'active', 'cleared', 'archived', 'serve'] as const);
  const [showNewCallModal, setShowNewCallModal] = useState(false);
  const [showQuickPsoModal, setShowQuickPsoModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newNote, setNewNote] = useState('');
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
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
  const [detailTab, setDetailTab] = useState<'info' | 'persons' | 'timeline' | 'notes' | 'flags'>('info');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; call: CallForService } | null>(null);
  const [ncicInitialQuery, setNcicInitialQuery] = useState<{ type: 'person' | 'vehicle' | 'warrant'; query: string } | null>(null);
  // Timeline / activity log entries for selected call
  const [activityEntries, setActivityEntries] = useState<any[]>([]);
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

  // Timeline editing
  const [editingTimelineId, setEditingTimelineId] = useState<string | null>(null);
  const [editTimelineText, setEditTimelineText] = useState('');

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
        section_id: ed.section_id,
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
      fetch(`/api/dispatch/calls/${selectedCallRef.current.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => { /* best-effort cleanup save */ });
    };
  }, []);

  const [newTimelineText, setNewTimelineText] = useState('');
  const [showAddTimeline, setShowAddTimeline] = useState(false);
  const templateDropdownRef = useRef<HTMLDivElement>(null);
  // Unit attach dropdown
  const [showAttachUnitDropdown, setShowAttachUnitDropdown] = useState(false);
  const attachUnitDropdownRef = useRef<HTMLDivElement>(null);
  // Create Unit modal
  const [showCreateUnitModal, setShowCreateUnitModal] = useState(false);
  const [newUnitCallSign, setNewUnitCallSign] = useState('');
  const [newUnitOfficerId, setNewUnitOfficerId] = useState('');
  const [newUnitStatus, setNewUnitStatus] = useState<string>('available');
  const [unitCreating, setUnitCreating] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [officers, setOfficers] = useState<{ id: string; full_name: string; badge_number?: string }[]>([]);
  // Delete call confirmation (non-archived)
  const [deleteCallTarget, setDeleteCallTarget] = useState<CallForService | null>(null);
  const [isDeletingCall, setIsDeletingCall] = useState(false);
  // Disposition codes from admin config
  const [dispositionCodes, setDispositionCodes] = useState<{code: string; description: string; color?: string}[]>([]);
  // Disposition prompt — ID of call awaiting disposition before clear
  const [dispositionPromptCallId, setDispositionPromptCallId] = useState<string | null>(null);
  // Mileage prompt — shown on En Route / On Scene status transitions
  const [mileagePrompt, setMileagePrompt] = useState<{
    callId: string; callNumber: string; status: 'enroute' | 'onscene';
    vehicleId: string; startingMileage?: number;
  } | null>(null);
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
  const fetchData = useCallback(async (options?: { silent?: boolean }) => {
    try {
      const [callsRes, unitsRes] = await Promise.all([
        apiFetch<any>('/dispatch/calls?limit=200'),
        apiFetch<any[]>('/dispatch/units'),
      ]);
      const callsRaw = Array.isArray(callsRes?.data) ? callsRes.data : Array.isArray(callsRes) ? callsRes : [];
      const mappedCalls = callsRaw.map(mapDbCall);
      const mappedUnits = (Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit);
      setCalls(mappedCalls);
      setUnits(mappedUnits);
      // If we had a selected call, update its reference
      setSelectedCall((prev) => {
        if (!prev) return mappedCalls[0] || null;
        return mappedCalls.find((c: CallForService) => c.id === prev.id) || mappedCalls[0] || null;
      });
    } catch (err) {
      if (!options?.silent) {
        console.error('Failed to load dispatch data:', err);
        addToast('Failed to load dispatch data — check connection', 'error');
      }
    } finally {
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
        setCalls((prev) => prev.map((c) => (c.id === mapped.id ? mapped : c)));
        // Update selected call if it's the one being viewed
        setSelectedCall((prev) => (prev?.id === mapped.id ? mapped : prev));
      } else if (data.action === 'call_status_changed' && data.call) {
        const mapped = mapDbCall(data.call);
        setCalls((prev) => prev.map((c) => (c.id === mapped.id ? mapped : c)));
        setSelectedCall((prev) => (prev?.id === mapped.id ? mapped : prev));
        // Voice alert: announce dispatch event when call dispatched
        if (mapped.status === 'dispatched') {
          announceDispatchEvent(mapped);
        }
      } else if (data.action === 'units_dispatched' || data.action === 'unit_assigned' || data.action === 'unit_unassigned') {
        // Refresh the full list to keep unit assignments in sync
        fetchData({ silent: true });
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

    return () => { unsubDispatch(); unsubUnit(); unsubPanic(); };
  }, [subscribe, fetchData, addToast, setFilterTab]);

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

  // Create Unit handler
  // Create or Update Unit handler
  const handleSaveUnit = async () => {
    const cs = newUnitCallSign.trim();
    if (!cs) return;
    setUnitCreating(true);
    try {
      if (editingUnit) {
        // Update existing unit
        await apiFetch(`/dispatch/units/${editingUnit.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            call_sign: cs,
            officer_id: newUnitOfficerId || null,
            status: newUnitStatus,
          }),
        });
      } else {
        // Create new unit
        await apiFetch('/dispatch/units', {
          method: 'POST',
          body: JSON.stringify({
            call_sign: cs,
            officer_id: newUnitOfficerId || null,
            status: newUnitStatus || 'available',
          }),
        });
      }
      // Refresh units
      const unitsRes = await apiFetch<any[]>('/dispatch/units');
      setUnits((Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit));
      // Reset form
      setNewUnitCallSign('');
      setNewUnitOfficerId('');
      setNewUnitStatus('available');
      setEditingUnit(null);
      setShowCreateUnitModal(false);
    } catch (err: any) {
      addToast(err?.error || err?.message || `Failed to ${editingUnit ? 'update' : 'create'} unit`, 'error');
    } finally {
      setUnitCreating(false);
    }
  };

  // Open unit modal for editing
  const openEditUnit = (unit: Unit) => {
    setEditingUnit(unit);
    setNewUnitCallSign(unit.call_sign);
    setNewUnitOfficerId(unit.officer_id || '');
    setNewUnitStatus(unit.status);
    setShowCreateUnitModal(true);
  };

  // Delete unit handler
  const [deletingUnit, setDeletingUnit] = useState<Unit | null>(null);
  const [unitDeleting, setUnitDeleting] = useState(false);

  const handleDeleteUnit = async () => {
    if (!deletingUnit) return;
    setUnitDeleting(true);
    try {
      await apiFetch(`/dispatch/units/${deletingUnit.id}`, { method: 'DELETE' });
      const unitsRes = await apiFetch<any[]>('/dispatch/units');
      setUnits((Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit));
      setDeletingUnit(null);
    } catch (err: any) {
      addToast(err?.error || err?.message || 'Failed to delete unit', 'error');
    } finally {
      setUnitDeleting(false);
    }
  };

  // Revert call status to previous step
  const handleRevertStatus = async (callId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/revert-status`, {
        method: 'POST',
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
      // Refresh units since reverting from cleared re-dispatches them
      const unitsRes = await apiFetch<any[]>('/dispatch/units');
      setUnits((Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit));
    } catch (err: any) {
      console.error('Failed to revert status:', err);
      addToast('Failed to revert call status', 'error');
    }
  };

  // Delete any call (not just archived)
  const handleDeleteAnyCall = async () => {
    if (!deleteCallTarget) return;
    const callNum = deleteCallTarget.call_number;
    setIsDeletingCall(true);
    try {
      await apiFetch(`/dispatch/calls/${deleteCallTarget.id}`, { method: 'DELETE' });
      setCalls((prev) => prev.filter((c) => c.id !== deleteCallTarget.id));
      setArchivedCalls((prev) => prev.filter((c) => c.id !== deleteCallTarget.id));
      setSelectedCall((prev) => prev?.id === deleteCallTarget.id ? null : prev);
      setDeleteCallTarget(null);
      addToast(`Call ${callNum} deleted`, 'success');
    } catch (err: any) {
      addToast(err?.message || err?.error || 'Failed to delete call', 'error');
    } finally {
      setIsDeletingCall(false);
    }
  };

  // Fetch linked incidents and activity when a call is selected
  useEffect(() => {
    if (!selectedCall) { setLinkedIncidents([]); setActivityEntries([]); setCallWarnings([]); return; }
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
        if (!cancelled) setCallWarnings(Array.isArray(warnings) ? warnings : []);
      } catch { if (!cancelled) setCallWarnings([]); }
    })();
    return () => { cancelled = true; };
  }, [selectedCall?.id]);

  // PSO incident types — must be declared before filteredCalls which references it
  const PSO_INCIDENT_TYPES = ['pso_client_request'];

  // Filter calls (defined before keyboard shortcuts so it's available)
  // Active calls (non-archived) are in `calls`, archived calls are in `archivedCalls`
  const filteredCalls = useMemo(() => (filterTab === 'archived' ? archivedCalls : calls).filter((call) => {
    switch (filterTab) {
      case 'pending': return call.status === 'pending';
      case 'active': return ['dispatched', 'enroute', 'onscene', 'on_hold'].includes(call.status);
      case 'cleared': return ['cleared', 'closed', 'cancelled'].includes(call.status);
      case 'archived': return true; // archivedCalls already filtered
      case 'serve': return PSO_INCIDENT_TYPES.includes(call.incident_type); // Show ALL PSO calls (active + cleared/on_hold for return visits)
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
  }), [calls, archivedCalls, filterTab, searchQuery, userPrefs?.dispatch_sort, userPrefs?.dispatch_show_cleared]);

  // Keyboard shortcuts for dispatch power users
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

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

      // 1-4: Filter tabs
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

      // Escape - close modal
      if (e.key === 'Escape') {
        setShowNewCallModal(false);
        setShowQuickPsoModal(false);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCall, filteredCalls, fetchData]);

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
        section_id: callData.section_id ?? null,
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
    } catch (err: any) {
      console.error('Failed to create call:', err);
      addToast(err?.message || 'Failed to create call', 'error');
      throw err; // Re-throw so NewCallModal knows submission failed
    } finally {
      setIsSaving(false);
    }
  };

  const handleStatusChange = async (callId: string, newStatus: CallStatus, extraBody?: Record<string, any>) => {
    // Intercept enroute/onscene to prompt for mileage (officer role only)
    if ((newStatus === 'enroute' || newStatus === 'onscene') && !extraBody) {
      const call = calls.find(c => c.id === callId);
      if (call) {
        // Find vehicle ID from assigned units on this call
        const assignedUnit = call.assigned_units.length > 0
          ? units.find(u => call.assigned_units.includes(u.id))
          : undefined;
        setMileagePrompt({
          callId,
          callNumber: call.call_number,
          status: newStatus,
          vehicleId: assignedUnit?.vehicle || call.responding_vehicle_id || '',
          startingMileage: newStatus === 'onscene' ? (call.starting_mileage ?? undefined) : undefined,
        });
        return;
      }
    }

    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus, ...extraBody }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
      // Refresh units since clearing/closing/cancelling a call frees assigned units
      if (newStatus === 'cleared' || newStatus === 'closed' || newStatus === 'cancelled') {
        const unitsRes = await apiFetch<any[]>('/dispatch/units');
        setUnits((Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit));
      }
      // Auto-archive when closed or cancelled to clear the "All" view
      if (newStatus === 'closed' || newStatus === 'cancelled') {
        await handleArchive(callId);
      }
    } catch (err) {
      console.error('Failed to update status:', err);
      addToast('Failed to update call status', 'error');
    }
  };

  const handleMileageSubmit = (mileage: number, vehicleId: string) => {
    if (!mileagePrompt) return;
    const body: Record<string, any> = { responding_vehicle_id: vehicleId || undefined };
    if (mileagePrompt.status === 'enroute') {
      body.starting_mileage = mileage;
    } else {
      body.ending_mileage = mileage;
    }
    setMileagePrompt(null);
    handleStatusChange(mileagePrompt.callId, mileagePrompt.status, body);
  };

  // Clear with disposition — shows prompt first, then clears
  const handleClearWithDisposition = (callId: string) => {
    setDispositionPromptCallId(callId);
  };

  const handleConfirmClear = async (disposition: string, createIncident?: boolean) => {
    if (!dispositionPromptCallId) return;
    const callId = dispositionPromptCallId;
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'cleared', disposition }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
      const unitsRes = await apiFetch<any[]>('/dispatch/units');
      setUnits((Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit));

      // Auto-create incident report if checkbox was checked
      if (createIncident) {
        try {
          const token = localStorage.getItem('rmpg_token');
          const incRes = await fetch(`/api/dispatch/calls/${callId}/generate-incident`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          });
          if (incRes.ok) {
            navigate('/incidents');
          } else {
            const errData = await incRes.json().catch(() => ({}));
            addToast(errData.error || 'Failed to create incident report', 'error');
          }
        } catch (err) {
          console.error('Failed to promote call to incident:', err);
          addToast('Failed to create incident report from call', 'error');
        }
      }
    } catch (err: any) {
      console.error('Failed to clear call:', err);
      addToast('Failed to clear call', 'error');
    }
    setDispositionPromptCallId(null);
  };

  // Hold / Resume call
  const handleHoldCall = async (callId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/hold`, { method: 'POST' });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
    } catch (err) {
      console.error('Failed to hold call:', err);
      addToast('Failed to hold call', 'error');
    }
  };

  const handleResumeCall = async (callId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/resume`, { method: 'POST' });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
    } catch (err) {
      console.error('Failed to resume call:', err);
      addToast('Failed to resume call', 'error');
    }
  };

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

  const handleAddNote = async () => {
    if (!selectedCall || !newNote.trim()) return;
    const trimmedNote = newNote.trim();
    if (trimmedNote.length > 2000) {
      addToast('Note is too long (max 2000 characters)', 'error');
      return;
    }
    if (trimmedNote.length < 2) {
      addToast('Note must be at least 2 characters', 'error');
      return;
    }
    try {
      // Build notes array with the new note appended
      const existingNotes = selectedCall.notes || [];
      const note: CallNote = {
        id: `n-${Date.now()}`,
        author: 'Dispatch',
        text: trimmedNote,
        timestamp: new Date().toISOString(),
      };
      const allNotes = [...existingNotes, note];
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`, {
        method: 'PUT',
        body: JSON.stringify({ notes: JSON.stringify(allNotes) }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === selectedCall.id ? updatedCall : c));
      setSelectedCall(updatedCall);
      setNewNote('');
    } catch (err) {
      console.error('Failed to add note:', err);
      addToast('Failed to save note', 'error');
    }
  };

  const handleGenerateIncident = async () => {
    if (!selectedCall) return;
    setIsGenerating(true);
    try {
      // Direct fetch to preserve full error response (apiFetch wraps errors in plain Error)
      const token = localStorage.getItem('rmpg_token');
      const res = await fetch(`/api/dispatch/calls/${selectedCall.id}/generate-incident`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (res.status === 409) {
        // Incident already exists — navigate to it
        addToast('An incident report already exists for this call', 'info');
        navigate('/incidents');
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || errData.message || `Request failed with status ${res.status}`);
      }

      const incident = await res.json();
      addToast(`Incident ${incident.incident_number || ''} created`, 'success');
      navigate('/incidents');
    } catch (err: any) {
      console.error('Failed to generate incident:', err);
      addToast(err?.message || 'Failed to generate incident report', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  // ── LE Notification ─────────────────────────────────────────
  const handleLeNotify = async (callId: string, agency?: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/le-notification`, {
        method: 'POST',
        body: JSON.stringify({ agency: agency || 'Local PD' }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
      addToast('Law enforcement notified', 'success');
    } catch (err) {
      console.error('Failed to notify LE:', err);
      addToast('Failed to notify LE', 'error');
    }
  };

  // ── Archive / Unarchive ────────────────────────────────────
  const handleArchive = async (callId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/archive`, { method: 'POST' });
      const updatedCall = mapDbCall(result);
      // Remove from active calls, add to archived calls
      setCalls((prev) => prev.filter((c) => c.id !== callId));
      setArchivedCalls((prev) => [updatedCall, ...prev]);
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
    } catch (err) {
      console.error('Failed to archive call:', err);
      addToast('Failed to archive call', 'error');
    }
  };

  const handleUnarchive = async (callId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/unarchive`, { method: 'POST' });
      const updatedCall = mapDbCall(result);
      // Remove from archived calls, add back to active calls
      setArchivedCalls((prev) => prev.filter((c) => c.id !== callId));
      setCalls((prev) => [updatedCall, ...prev]);
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
    } catch (err) {
      console.error('Failed to unarchive call:', err);
      addToast('Failed to unarchive call', 'error');
    }
  };

  // (old archived-only delete removed — superseded by handleDeleteAnyCall)

  const [isBulkArchiving, setIsBulkArchiving] = useState(false);

  const handleBulkArchive = async () => {
    setIsBulkArchiving(true);
    try {
      const result = await apiFetch<any>('/dispatch/calls/archive-bulk', {
        method: 'POST',
        body: JSON.stringify({ statuses: ['cleared', 'closed', 'cancelled'] }),
      });
      if (result.archived_count > 0) {
        // Refresh both active and archived calls
        await fetchData({ silent: true });
        // Reset archived loaded flag so they get re-fetched when Archive tab is visited
        setArchivedLoaded(false);
        setArchivedCalls([]);
      }
    } catch (err) {
      console.error('Failed to bulk archive calls:', err);
      addToast('Failed to bulk archive calls', 'error');
    } finally {
      setIsBulkArchiving(false);
    }
  };

  // ── Assign / Unassign Unit ─────────────────────────────────
  const handleAssignUnit = async (unitId: string) => {
    if (!selectedCall) return;
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/assign-unit`, {
        method: 'POST',
        body: JSON.stringify({ unit_id: unitId }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === selectedCall.id ? updatedCall : c));
      setSelectedCall(updatedCall);
      setShowAttachUnitDropdown(false);
      // Refresh units to reflect the status change
      const unitsRes = await apiFetch<any[]>('/dispatch/units');
      setUnits((Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit));
    } catch (err: any) {
      console.error('Failed to assign unit:', err);
      addToast(err?.message || 'Failed to assign unit', 'error');
    }
  };

  // ── Drag-and-Drop Assign Unit (from UnitStatusBoard to CallCard) ──
  const handleDragAssignUnit = async (callId: string, unitId: string) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/assign-unit`, {
        method: 'POST',
        body: JSON.stringify({ unit_id: unitId }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
      // Refresh units to reflect the status change
      const unitsRes = await apiFetch<any[]>('/dispatch/units');
      setUnits((Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit));
      addToast(`Unit assigned to call`, 'success');
    } catch (err: any) {
      addToast(err?.error || err?.message || 'Failed to assign unit via drag', 'error');
    }
  };

  const handleUnassignUnit = async (unitId: string) => {
    if (!selectedCall) return;
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/unassign-unit`, {
        method: 'POST',
        body: JSON.stringify({ unit_id: unitId }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === selectedCall.id ? updatedCall : c));
      setSelectedCall(updatedCall);
      // Refresh units to reflect the status change
      const unitsRes = await apiFetch<any[]>('/dispatch/units');
      setUnits((Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit));
    } catch (err: any) {
      console.error('Failed to unassign unit:', err);
      addToast(err?.message || 'Failed to unassign unit', 'error');
    }
  };

  // ── Inline Editing ────────────────────────────────────────
  const startEditing = () => {
    if (!selectedCall) return;
    setEditData({
      incident_type: selectedCall.incident_type,
      priority: selectedCall.priority,
      client_id: selectedCall.client_id || '',
      caller_name: selectedCall.caller_name || '',
      caller_phone: selectedCall.caller_phone || '',
      caller_relationship: selectedCall.caller_relationship || '',
      caller_address: selectedCall.caller_address || '',
      location: selectedCall.location || '',
      latitude: selectedCall.latitude ?? null,
      longitude: selectedCall.longitude ?? null,
      property_id: selectedCall.property_id || null,
      description: selectedCall.description || '',
      source: selectedCall.source || 'phone',
      disposition: selectedCall.disposition || '',
      cross_street: selectedCall.cross_street || '',
      location_building: selectedCall.location_building || '',
      location_floor: selectedCall.location_floor || '',
      location_room: selectedCall.location_room || '',
      zone_beat: selectedCall.zone_beat || '',
      section_id: selectedCall.section_id || '',
      zone_id: selectedCall.zone_id || '',
      beat_id: selectedCall.beat_id || '',
      weapons_involved: selectedCall.weapons_involved || '',
      injuries_reported: !!selectedCall.injuries_reported,
      num_subjects: selectedCall.num_subjects || '',
      num_victims: selectedCall.num_victims || '',
      subject_description: selectedCall.subject_description || '',
      vehicle_description: selectedCall.vehicle_description || '',
      direction_of_travel: selectedCall.direction_of_travel || '',
      scene_safety: selectedCall.scene_safety || '',
      weather_conditions: selectedCall.weather_conditions || '',
      lighting_conditions: selectedCall.lighting_conditions || '',
      alcohol_involved: !!selectedCall.alcohol_involved,
      drugs_involved: !!selectedCall.drugs_involved,
      domestic_violence: !!selectedCall.domestic_violence,
      supervisor_notified: !!selectedCall.supervisor_notified,
      le_notified: !!selectedCall.le_notified,
      le_agency: selectedCall.le_agency || '',
      le_case_number: selectedCall.le_case_number || '',
      damage_estimate: selectedCall.damage_estimate || '',
      damage_description: selectedCall.damage_description || '',
      action_taken: selectedCall.action_taken || '',
      responding_officer: selectedCall.responding_officer || '',
      starting_mileage: selectedCall.starting_mileage || '',
      ending_mileage: selectedCall.ending_mileage || '',
      dispatch_code: selectedCall.dispatch_code || '',
      pso_requestor_name: selectedCall.pso_requestor_name || '',
      pso_requestor_phone: selectedCall.pso_requestor_phone || '',
      pso_requestor_email: selectedCall.pso_requestor_email || '',
      pso_service_type: selectedCall.pso_service_type || '',
      pso_billing_code: selectedCall.pso_billing_code || '',
      pso_authorization: selectedCall.pso_authorization || '',
      // Process Service fields
      process_service_type: selectedCall.process_service_type || '',
      process_served_to: selectedCall.process_served_to || '',
      process_served_address: selectedCall.process_served_address || '',
      process_attempts: selectedCall.process_attempts ?? 0,
      process_served_at: selectedCall.process_served_at || '',
      process_service_result: selectedCall.process_service_result || '',
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
        section_id: editData.section_id,
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
        damage_estimate: editData.damage_estimate ? Number(editData.damage_estimate) : null,
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

  // ── Timeline CRUD ─────────────────────────────────────────
  const handleEditTimeline = async (entryId: string) => {
    if (!selectedCall || !editTimelineText.trim()) return;
    try {
      await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/timeline/${entryId}`, {
        method: 'PUT',
        body: JSON.stringify({ details: editTimelineText.trim() }),
      });
      setActivityEntries((prev) => prev.map((e) => e.id === entryId ? { ...e, details: editTimelineText.trim() } : e));
      setEditingTimelineId(null);
      setEditTimelineText('');
    } catch (err) {
      console.error('Failed to edit timeline entry:', err);
      addToast('Failed to edit timeline entry', 'error');
    }
  };

  const handleDeleteTimeline = async (entryId: string) => {
    if (!selectedCall) return;
    try {
      await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/timeline/${entryId}`, { method: 'DELETE' });
      setActivityEntries((prev) => prev.filter((e) => String(e.id) !== String(entryId)));
    } catch (err) {
      console.error('Failed to delete timeline entry:', err);
      addToast('Failed to delete timeline entry', 'error');
    }
  };

  const handleAddTimeline = async () => {
    if (!selectedCall || !newTimelineText.trim()) return;
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/timeline`, {
        method: 'POST',
        body: JSON.stringify({ action: 'note_added', details: newTimelineText.trim() }),
      });
      setActivityEntries((prev) => [result, ...prev]);
      setNewTimelineText('');
      setShowAddTimeline(false);
    } catch (err) {
      console.error('Failed to add timeline entry:', err);
      addToast('Failed to add timeline entry', 'error');
    }
  };

  const tabCounts = useMemo(() => ({
    all: calls.length,
    pending: calls.filter((c) => c.status === 'pending').length,
    active: calls.filter((c) => ['dispatched', 'enroute', 'onscene', 'on_hold'].includes(c.status)).length,
    cleared: calls.filter((c) => ['cleared', 'closed', 'cancelled'].includes(c.status)).length,
    archived: archivedCalls.length,
    serve: calls.filter((c) => PSO_INCIDENT_TYPES.includes(c.incident_type)).length,
  }), [calls, archivedCalls]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
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
            <button
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
                  <span className="text-base font-bold text-green-400 font-mono">{call.call_number}</span>
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
                <div className="flex items-center gap-1.5 font-mono">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{formatElapsed(call.created_at)}</span>
                </div>
                {call.assigned_units.length > 0 && (
                  <span className="font-mono">{call.assigned_units.length} unit{call.assigned_units.length !== 1 ? 's' : ''}</span>
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
                <StatusBadge status={selectedCall.priority} type="priority" />
                <StatusBadge status={selectedCall.status} type="call_status" />
                {callWarnings.length > 0 && (
                  <span className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold font-mono text-red-400 bg-red-900/30 border border-red-700/50 animate-pulse">
                    <AlertTriangle style={{ width: 10, height: 10 }} /> {callWarnings.length} ALERT{callWarnings.length !== 1 ? 'S' : ''}
                  </span>
                )}
              </div>

              {/* Mobile Status Action Buttons — large touch targets for gloved use */}
              <div className="flex flex-wrap gap-2">
                {selectedCall.status === 'pending' && (
                  <button
                    onClick={() => handleStatusChange(selectedCall.id, 'dispatched')}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-white rounded"
                    style={{ minHeight: 48, minWidth: 80, background: '#1a5a9e', border: '1px solid #2a6ab0' }}
                  >
                    <Send style={{ width: 16, height: 16 }} /> Dispatch
                  </button>
                )}
                {selectedCall.status === 'dispatched' && (
                  <button
                    onClick={() => handleStatusChange(selectedCall.id, 'enroute')}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-white rounded"
                    style={{ minHeight: 48, minWidth: 80, background: '#1a5a9e', border: '1px solid #2a6ab0' }}
                  >
                    <Navigation style={{ width: 16, height: 16 }} /> En Route
                  </button>
                )}
                {selectedCall.status === 'enroute' && (
                  <button
                    onClick={() => handleStatusChange(selectedCall.id, 'onscene')}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-white rounded"
                    style={{ minHeight: 48, minWidth: 80, background: '#1a5a9e', border: '1px solid #2a6ab0' }}
                  >
                    <Eye style={{ width: 16, height: 16 }} /> On Scene
                  </button>
                )}
                {['dispatched', 'enroute', 'onscene'].includes(selectedCall.status) && (
                  <>
                    <button
                      onClick={() => handleClearWithDisposition(selectedCall.id)}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded"
                      style={{ minHeight: 48, minWidth: 80, background: '#16a34a20', border: '1px solid #16a34a50', color: '#4ade80' }}
                    >
                      <CheckCircle style={{ width: 16, height: 16 }} /> Clear
                    </button>
                    <button
                      onClick={() => handleHoldCall(selectedCall.id)}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded"
                      style={{ minHeight: 48, minWidth: 80, background: '#f59e0b20', border: '1px solid #f59e0b50', color: '#f59e0b' }}
                    >
                      ⏸ Hold
                    </button>
                    <button
                      onClick={() => handleStatusChange(selectedCall.id, 'cancelled')}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded"
                      style={{ minHeight: 48, minWidth: 80, background: '#dc262620', border: '1px solid #dc262650', color: '#ef7a7a' }}
                    >
                      <XCircle style={{ width: 16, height: 16 }} /> Cancel
                    </button>
                  </>
                )}
                {selectedCall.status === 'on_hold' && (
                  <button
                    onClick={() => handleResumeCall(selectedCall.id)}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded"
                    style={{ minHeight: 48, minWidth: 80, background: '#f59e0b', color: '#000' }}
                  >
                    ▶ Resume
                  </button>
                )}
                {selectedCall.status === 'cleared' && (
                  <>
                    <button
                      onClick={() => handleStatusChange(selectedCall.id, 'closed')}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded"
                      style={{ minHeight: 48, minWidth: 80, background: '#374151', border: '1px solid #4b5563', color: '#d1d5db' }}
                    >
                      Close
                    </button>
                    <button
                      onClick={handleGenerateIncident}
                      disabled={isGenerating}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-white rounded"
                      style={{ minHeight: 48, minWidth: 80, background: '#1a5a9e', border: '1px solid #2a6ab0' }}
                    >
                      {isGenerating ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : <FileText style={{ width: 16, height: 16 }} />}
                      Report
                    </button>
                  </>
                )}
                {selectedCall.status === 'closed' && (
                  <button
                    onClick={handleGenerateIncident}
                    disabled={isGenerating}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-white rounded"
                    style={{ minHeight: 48, minWidth: 80, background: '#1a5a9e', border: '1px solid #2a6ab0' }}
                  >
                    {isGenerating ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : <FileText style={{ width: 16, height: 16 }} />}
                    Report
                  </button>
                )}
                {['dispatched', 'enroute', 'onscene', 'cleared', 'closed'].includes(selectedCall.status) && (
                  <button
                    onClick={() => handleRevertStatus(selectedCall.id)}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded"
                    style={{ minHeight: 48, minWidth: 80, background: '#f59e0b20', border: '1px solid #f59e0b50', color: '#f59e0b' }}
                  >
                    <Undo2 style={{ width: 16, height: 16 }} /> Back
                  </button>
                )}
                {selectedCall.status !== 'archived' && (
                  <button
                    onClick={() => handleArchive(selectedCall.id)}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded"
                    style={{ minHeight: 48, minWidth: 80, background: '#37415120', border: '1px solid #4b556350', color: '#9ca3af' }}
                  >
                    <Archive style={{ width: 16, height: 16 }} /> Archive
                  </button>
                )}
                {selectedCall.status === 'archived' && (
                  <button
                    onClick={() => handleUnarchive(selectedCall.id)}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded"
                    style={{ minHeight: 48, minWidth: 80, background: '#37415120', border: '1px solid #4b556350', color: '#9ca3af' }}
                  >
                    <RotateCcw style={{ width: 16, height: 16 }} /> Restore
                  </button>
                )}
              </div>

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
                      <div className="text-xs text-rmpg-400 mt-0.5">{selectedCall.caller_phone}</div>
                    )}
                  </div>
                )}

                {selectedCall.description && (
                  <div className="panel-inset p-3">
                    <div className="field-label mb-1">Description</div>
                    <div className="text-sm text-rmpg-200 whitespace-pre-wrap">{selectedCall.description}</div>
                  </div>
                )}

                {/* Timestamps */}
                <div className="panel-inset p-3">
                  <div className="field-label mb-2">Timeline</div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-rmpg-400">Created</span>
                      <span className="font-mono text-rmpg-200">{formatTime(selectedCall.created_at)}</span>
                    </div>
                    {selectedCall.dispatched_at && (
                      <div className="flex justify-between">
                        <span className="text-rmpg-400">Dispatched</span>
                        <span className="font-mono text-rmpg-200">{formatTime(selectedCall.dispatched_at)}</span>
                      </div>
                    )}
                    {selectedCall.enroute_at && (
                      <div className="flex justify-between">
                        <span className="text-rmpg-400">Enroute</span>
                        <span className="font-mono text-rmpg-200">{formatTime(selectedCall.enroute_at)}</span>
                      </div>
                    )}
                    {selectedCall.onscene_at && (
                      <div className="flex justify-between">
                        <span className="text-rmpg-400">On Scene</span>
                        <span className="font-mono text-rmpg-200">{formatTime(selectedCall.onscene_at)}</span>
                      </div>
                    )}
                    {selectedCall.cleared_at && (
                      <div className="flex justify-between">
                        <span className="text-rmpg-400">Cleared</span>
                        <span className="font-mono text-rmpg-200">{formatTime(selectedCall.cleared_at)}</span>
                      </div>
                    )}
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
                  {selectedCall.notes && selectedCall.notes.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {selectedCall.notes.map((note) => (
                        <div key={note.id} className="text-xs">
                          <div className="flex items-center gap-2 text-rmpg-400">
                            <span className="font-bold">{note.author}</span>
                            <span className="font-mono">{formatTime(note.timestamp)}</span>
                          </div>
                          <div className="text-rmpg-200 mt-0.5">{note.text}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Add note input — mobile */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 bg-surface-sunken border border-rmpg-600 text-sm text-rmpg-200 px-3 rounded"
                      style={{ minHeight: 44 }}
                      placeholder="Add note…"
                      maxLength={2000}
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddNote(); } }}
                    />
                    <button
                      onClick={handleAddNote}
                      disabled={!newNote.trim()}
                      className="flex items-center justify-center px-4 py-3 text-xs font-bold text-white rounded"
                      style={{ minHeight: 44, minWidth: 56, background: !newNote.trim() ? '#374151' : '#1a5a9e', border: '1px solid #2a6ab0' }}
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
                      {selectedCall.pso_attempt_number && selectedCall.pso_attempt_number > 1 && (
                        <span className="px-1.5 py-0.5 text-[9px] font-bold rounded" style={{ background: '#f59e0b30', border: '1px solid #f59e0b50', color: '#fbbf24' }}>
                          VISIT #{selectedCall.pso_attempt_number}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 text-xs text-rmpg-200">
                      {selectedCall.pso_service_type && <div><span className="text-rmpg-400">Service:</span> {selectedCall.pso_service_type.replace(/_/g, ' ')}</div>}
                      {selectedCall.pso_requestor_name && <div><span className="text-rmpg-400">Requestor:</span> {selectedCall.pso_requestor_name}</div>}
                      {selectedCall.pso_requestor_phone && <div><span className="text-rmpg-400">Phone:</span> {selectedCall.pso_requestor_phone}</div>}
                      {selectedCall.pso_billing_code && <div><span className="text-rmpg-400">Billing:</span> {selectedCall.pso_billing_code}</div>}
                      {selectedCall.pso_authorization && <div><span className="text-rmpg-400">Auth:</span> {selectedCall.pso_authorization}</div>}
                      {selectedCall.disposition && <div><span className="text-rmpg-400">Disposition:</span> {selectedCall.disposition}</div>}
                    </div>

                    {/* Visit History (mobile) */}
                    {selectedCall.visit_history && selectedCall.visit_history.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-rmpg-600">
                        <div className="field-label mb-1.5">Visit History</div>
                        <div className="space-y-1.5">
                          {selectedCall.visit_history.map((visit) => (
                            <div key={visit.id} className="bg-rmpg-800/60 border border-rmpg-600/50 rounded px-2 py-1.5 text-[10px]">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="font-bold text-amber-300">VISIT #{visit.visit_number}</span>
                                <span className="text-rmpg-300">{(visit.status || '').toUpperCase()}</span>
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

                    {/* 72-hour countdown (mobile) */}
                    {['cleared', 'closed'].includes(selectedCall.status) && (() => {
                      const terminalTime = selectedCall.closed_at || selectedCall.cleared_at;
                      if (!terminalTime) return null;
                      const elapsed = Date.now() - new Date(terminalTime).getTime();
                      const hoursLeft = Math.max(0, 72 - elapsed / 3600000);
                      if (elapsed >= 72 * 3600000) {
                        return (
                          <div className="mt-2 p-2 rounded text-center text-xs font-bold animate-pulse" style={{ background: '#dc262630', border: '1px solid #dc262650', color: '#f87171' }}>
                            72-HOUR DEADLINE PASSED — RE-DISPATCH REQUIRED
                          </div>
                        );
                      }
                      if (elapsed >= 48 * 3600000) {
                        return (
                          <div className="mt-2 p-2 rounded text-center text-xs font-bold" style={{ background: '#f59e0b20', border: '1px solid #f59e0b40', color: '#fbbf24' }}>
                            {Math.floor(hoursLeft)} HOURS UNTIL 72-HR DEADLINE
                          </div>
                        );
                      }
                      return null;
                    })()}

                    {/* Schedule Return Visit button (mobile) */}
                    {['cleared', 'closed', 'cancelled', 'on_hold', 'archived'].includes(selectedCall.status) && (
                      <button
                        className="w-full mt-3 py-2.5 px-4 text-sm font-semibold rounded"
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
                              setSelectedCall(mapped);
                              setCalls(prev => prev.map(c => c.id === mapped.id ? mapped : c));
                              addToast(`Re-dispatched — ${ordinal} visit`, 'success');
                            }
                          } catch (err: any) { addToast(`Failed to re-dispatch: ${err?.message || 'Unknown error'}`, 'error'); }
                        }}
                      >
                        <RotateCcw style={{ width: 14, height: 14, display: 'inline', marginRight: 6 }} />
                        Schedule Return Visit
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </MobileDetailView>

        {/* FABs — New Call + PSO */}
        <button
          className="mobile-fab"
          onClick={() => { setTemplateInitialData(undefined); setShowNewCallModal(true); }}
          aria-label="New Call"
        >
          <Plus style={{ width: 24, height: 24 }} />
        </button>
        <button
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
      <div className="w-[35%] border-r border-rmpg-600 flex flex-col bg-surface-base">
        {/* Header — PanelTitleBar + TabBar */}
        <PanelTitleBar title="DISPATCH QUEUE" icon={Radio}>
          <RmpgLogo height={16} iconOnly />
          <ExportButton exportUrl="/dispatch/calls/export?format=csv" exportFilename="dispatch_calls_export.csv" />
          <PrintButton />
          {tabCounts.cleared > 0 && (
            <button
              onClick={handleBulkArchive}
              disabled={isBulkArchiving}
              className="toolbar-btn"
              title="Archive all cleared, closed, and cancelled calls"
            >
              {isBulkArchiving ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <Archive style={{ width: 10, height: 10 }} />}
              Archive Cleared
            </button>
          )}
          <input
            type="text"
            placeholder="Search calls..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input-dark text-xs flex-1"
            style={{ minWidth: '100px', maxWidth: '160px' }}
          />
          <button onClick={() => { setTemplateInitialData(undefined); setShowNewCallModal(true); }} className="toolbar-btn toolbar-btn-primary">
            <Plus style={{ width: 10, height: 10 }} />
            New Call
          </button>
          {/* Quick Dispatch dropdown */}
          <div className="relative" ref={templateDropdownRef} style={{ display: 'inline-block' }}>
            <button
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
                  minWidth: '200px',
                  maxHeight: '280px',
                  overflowY: 'auto',
                  background: '#1a2636',
                  border: '1px solid #3a5070',
                  borderRadius: 0,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                }}
              >
                {templates.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-rmpg-400">No templates available</div>
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
                      style={{ fontSize: '11px', color: '#b0bcc8', background: 'transparent', border: 'none', borderRadius: 0 }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2a3e58'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <span className="font-bold text-white" style={{ fontSize: '11px' }}>{tpl.name || tpl.incident_type}</span>
                      {tpl.description && <span className="text-rmpg-400 truncate w-full" style={{ fontSize: '10px' }}>{tpl.description}</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => setShowQuickPsoModal(true)}
            className="toolbar-btn"
            title="Quick PSO Client Request (P)"
            style={{
              background: 'linear-gradient(180deg, #7c3aed 0%, #6b21a8 100%)',
              borderColor: '#7c3aed',
              borderBottomColor: '#3b0764',
              borderRightColor: '#3b0764',
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
        <div className="px-3 py-1 border-b border-rmpg-700/50 flex items-center gap-2 flex-wrap text-[9px] font-mono flex-shrink-0 bg-surface-sunken">
          {(() => {
            const activeCalls = calls.filter(c => ['dispatched', 'enroute', 'onscene', 'pending', 'on_hold'].includes(c.status));
            const p1Count = activeCalls.filter(c => c.priority === 'P1').length;
            const p2Count = activeCalls.filter(c => c.priority === 'P2').length;
            const pendingCount = calls.filter(c => c.status === 'pending').length;
            return (
              <>
                {p1Count > 0 && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 bg-red-900/30 text-red-400 border border-red-700/40 font-bold animate-pulse">
                    <AlertTriangle className="w-2.5 h-2.5" /> P1: {p1Count}
                  </span>
                )}
                <span className="text-rmpg-400">P2: <strong className="text-amber-400">{p2Count}</strong></span>
                <span className="text-rmpg-400">Pending: <strong className="text-blue-400">{pendingCount}</strong></span>
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
                      <span className="flex items-center gap-1 px-1.5 py-0.5 bg-purple-900/30 text-purple-400 border border-purple-700/40 font-bold text-[9px]" title={`${stacked.length} location(s) with multiple active calls`}>
                        <Link className="w-2.5 h-2.5" /> STACKED: {stacked.length}
                      </span>
                    );
                  }
                  return null;
                })()}
                <span className="text-rmpg-500 ml-auto">
                  {filteredCalls.length} calls
                </span>
              </>
            );
          })()}
        </div>

        {/* Call List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filteredCalls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-rmpg-400">
              <Phone className="w-8 h-8 mb-2" />
              <p className="text-sm">No calls in this category</p>
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
        <div className="flex-1 flex border-b border-rmpg-600 min-h-0">
          {/* Call Detail Panel */}
          <div ref={callDetailRef} className={`flex-1 flex flex-col overflow-hidden min-w-0${isEditing ? ' edit-mode-active' : ''}`}>
          {selectedCall ? (
            <>
              {/* Detail Header — PanelTitleBar style */}
              <div className="panel-title-bar flex-shrink-0">
                <div className="flex items-center gap-3">
                  {selectedCall.priority === 'P1' && (
                    <AlertTriangle className="w-4 h-4 text-red-500 animate-emergency-blink" />
                  )}
                  <span className="text-sm font-bold text-green-400 font-mono">{selectedCall.call_number}</span>
                  <StatusBadge status={selectedCall.priority} type="priority" size="sm" />
                  <StatusBadge status={selectedCall.status} type="call_status" size="sm" />
                  {callWarnings.length > 0 && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold font-mono text-red-400 bg-red-900/30 border border-red-700/50 animate-pulse">
                      <AlertTriangle style={{ width: 9, height: 9 }} /> {callWarnings.length} ALERT{callWarnings.length !== 1 ? 'S' : ''}
                    </span>
                  )}
                </div>
                  <div className="ml-auto flex items-center gap-1 flex-wrap">
                    <PrintRecordButton
                      recordType="call"
                      recordData={{
                        ...selectedCall,
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
                          `[${n.timestamp ? new Date(n.timestamp).toLocaleString() : ''}] ${n.author || 'System'}: ${n.text || ''}`
                        ).join('\n') || '',
                      }}
                      identifier={selectedCall?.call_number}
                      entityType="call"
                      entityId={selectedCall?.id}
                      label="Print"
                    />
                    {/* Edit toggle */}
                    {!isEditing && (
                      <button onClick={startEditing} className="toolbar-btn" title="Edit call details">
                        <Edit3 style={{ width: 10, height: 10 }} /> Edit
                      </button>
                    )}
                    {isEditing && (
                      <>
                        <button onClick={saveEditing} className="toolbar-btn toolbar-btn-primary">
                          <Save style={{ width: 10, height: 10 }} /> Save
                        </button>
                        <button onClick={cancelEditing} className="toolbar-btn">
                          <X style={{ width: 10, height: 10 }} /> Cancel
                        </button>
                      </>
                    )}
                    {/* NCIC Terminal button */}
                    {!isEditing && (
                      <button
                        onClick={() => setShowNcicPanel(true)}
                        className="toolbar-btn"
                        title="NCIC / NLETS Query Terminal"
                        style={{ color: '#4ade80' }}
                      >
                        <Terminal style={{ width: 10, height: 10 }} /> NCIC
                      </button>
                    )}
                    {/* Schedule Return Visit — PSO calls in completed states */}
                    {!isEditing && selectedCall.incident_type === 'pso_client_request' && ['cleared', 'closed', 'cancelled', 'on_hold', 'archived'].includes(selectedCall.status) && (
                      <button
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
                              setSelectedCall(mapped);
                              setCalls(prev => prev.map(c => c.id === mapped.id ? mapped : c));
                              addToast(`Re-dispatched as ${ordinal} visit`, 'success');
                            }
                          } catch (err: any) { addToast(`Re-dispatch failed: ${err?.message || 'Unknown error'}`, 'error'); }
                        }}
                        title="Schedule a return visit for this PSO call"
                      >
                        <RotateCcw style={{ width: 10, height: 10 }} /> Return Visit
                      </button>
                    )}
                    {/* Revert status button — go back one step */}
                    {!isEditing && ['dispatched', 'enroute', 'onscene', 'cleared', 'closed'].includes(selectedCall.status) && (
                      <button
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
                      <button onClick={() => handleStatusChange(selectedCall.id, 'dispatched')} className="toolbar-btn toolbar-btn-primary">
                        <Send style={{ width: 10, height: 10 }} /> Dispatch
                      </button>
                    )}
                    {!isEditing && selectedCall.status === 'dispatched' && (
                      <button onClick={() => handleStatusChange(selectedCall.id, 'enroute')} className="toolbar-btn toolbar-btn-primary">
                        <Navigation style={{ width: 10, height: 10 }} /> En Route
                      </button>
                    )}
                    {!isEditing && selectedCall.status === 'enroute' && (
                      <button onClick={() => handleStatusChange(selectedCall.id, 'onscene')} className="toolbar-btn toolbar-btn-primary">
                        <Eye style={{ width: 10, height: 10 }} /> On Scene
                      </button>
                    )}
                    {!isEditing && ['dispatched', 'enroute', 'onscene'].includes(selectedCall.status) && (
                      <>
                        <button onClick={() => handleClearWithDisposition(selectedCall.id)} className="toolbar-btn">
                          <CheckCircle style={{ width: 10, height: 10 }} /> Clear
                        </button>
                        <button onClick={() => handleHoldCall(selectedCall.id)} className="toolbar-btn" style={{ color: '#f59e0b' }}>
                          ⏸ Hold
                        </button>
                        <button onClick={() => handleStatusChange(selectedCall.id, 'cancelled')} className="toolbar-btn" style={{ color: '#ef7a7a' }}>
                          <XCircle style={{ width: 10, height: 10 }} /> Cancel
                        </button>
                      </>
                    )}
                    {!isEditing && selectedCall.status === 'on_hold' && (
                      <button onClick={() => handleResumeCall(selectedCall.id)} className="toolbar-btn toolbar-btn-primary" style={{ background: '#f59e0b', color: '#000' }}>
                        ▶ Resume
                      </button>
                    )}
                    {!isEditing && selectedCall.status === 'cleared' && (
                      <>
                        <button onClick={() => handleStatusChange(selectedCall.id, 'closed')} className="toolbar-btn">
                          Close
                        </button>
                        <button onClick={handleGenerateIncident} disabled={isGenerating} className="toolbar-btn toolbar-btn-primary">
                          {isGenerating ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <FileText style={{ width: 10, height: 10 }} />}
                          Report
                        </button>
                      </>
                    )}
                    {!isEditing && selectedCall.status === 'closed' && (
                      <button onClick={handleGenerateIncident} disabled={isGenerating} className="toolbar-btn toolbar-btn-primary">
                        {isGenerating ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <FileText style={{ width: 10, height: 10 }} />}
                        Report
                      </button>
                    )}
                    {/* LE Notification */}
                    {!isEditing && !selectedCall.le_notified && selectedCall.status !== 'archived' && (
                      <button onClick={() => handleLeNotify(selectedCall.id)} className="toolbar-btn" style={{ color: '#f59e0b' }}>
                        <Radio style={{ width: 10, height: 10 }} /> Notify LE
                      </button>
                    )}
                    {selectedCall.le_notified && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-green-900/50 text-green-400 border border-green-700/50">
                        <CheckCircle style={{ width: 9, height: 9 }} /> LE NOTIFIED {selectedCall.le_agency ? `(${selectedCall.le_agency})` : ''}
                      </span>
                    )}
                    {/* Archive — available on any non-archived status */}
                    {!isEditing && selectedCall.status !== 'archived' && (
                      <button onClick={() => handleArchive(selectedCall.id)} className="toolbar-btn" title="Archive this call">
                        <Archive style={{ width: 10, height: 10 }} /> Archive
                      </button>
                    )}
                    {!isEditing && selectedCall.status === 'archived' && (
                      <button onClick={() => handleUnarchive(selectedCall.id)} className="toolbar-btn">
                        <RotateCcw style={{ width: 10, height: 10 }} /> Restore
                      </button>
                    )}
                    {/* Delete — available on any call */}
                    {!isEditing && (
                      <button onClick={() => setDeleteCallTarget(selectedCall)} className="toolbar-btn text-red-400 hover:text-red-300" title="Delete this call permanently">
                        <Trash2 style={{ width: 10, height: 10 }} /> Delete
                      </button>
                    )}
                  </div>
                </div>

              {/* Warning Tags / Caution Alerts — always visible above tabs */}
              {callWarnings.length > 0 && (
                <div className="px-4 pt-2 pb-1 flex-shrink-0">
                  <label className="text-[10px] font-bold text-red-400 uppercase tracking-wider flex items-center gap-1 mb-1">
                    <AlertTriangle style={{ width: 10, height: 10 }} /> CAUTION / WARNINGS
                  </label>
                  <WarningTags warnings={callWarnings} />
                </div>
              )}

              {/* Detail Tabs */}
              <div className="flex border-b border-rmpg-600 flex-shrink-0 bg-surface-sunken">
                {(['info', 'persons', 'timeline', 'notes', 'flags'] as const).map(tab => {
                  const labels: Record<string, string> = { info: 'Info', persons: 'Persons / Vehicles', timeline: 'Timeline', notes: 'Notes', flags: 'Flags' };
                  const counts: Record<string, number> = {
                    persons: callPersons.length + callVehicles.length,
                    timeline: activityEntries.length,
                    notes: (selectedCall.notes || []).length,
                  };
                  const count = counts[tab];
                  return (
                    <button
                      key={tab}
                      onClick={() => setDetailTab(tab)}
                      className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors border-b-2 ${
                        detailTab === tab
                          ? 'border-brand-500 text-brand-400 bg-brand-900/10'
                          : 'border-transparent text-rmpg-400 hover:text-rmpg-200 hover:bg-rmpg-700/30'
                      }`}
                    >
                      {labels[tab]}{count ? ` (${count})` : ''}
                    </button>
                  );
                })}
              </div>

              {/* Detail Body — Scrollable, tab-controlled */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col">
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
                          <p className="text-sm text-white">{selectedCall.location}</p>
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
                    </div>
                    <div>
                      <label className="field-label">Description:</label>
                      {isEditing ? (
                        <textarea className="textarea-dark text-xs mt-0.5" rows={3} value={editData.description} onChange={(e) => updateEditField('description', e.target.value)} />
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
                            {dispositionCodes.map((d) => (
                              <option key={d.code} value={d.code}>
                                {d.code} — {d.description}
                              </option>
                            ))}
                          </select>
                        </div>
                      </>
                    )}
                    {!isEditing && selectedCall.disposition && (
                      <div>
                        <label className="field-label">Disposition:</label>
                        <p className="text-sm text-rmpg-200">
                          <span className="inline-block px-1.5 py-0.5 bg-brand-900/40 text-brand-300 text-[11px] uppercase font-bold border border-brand-600/40 mr-1">
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
                          <input type="text" className="input-dark text-xs" placeholder="Caller phone" value={editData.caller_phone} onChange={(e) => updateEditField('caller_phone', e.target.value)} />
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
                                  <p className="text-xs text-rmpg-300">{selectedCall.caller_phone}</p>
                                </div>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </div>

                    {/* Timeline */}
                    <div>
                      <label className="field-label">Timeline:</label>
                      <div className="space-y-1 mt-1">
                        <div className="flex items-center gap-2 text-xs">
                          <Clock className="w-3 h-3 text-rmpg-400" />
                          <span className="text-rmpg-300">Created:</span>
                          <span className="text-white font-mono">{formatTime(selectedCall.created_at)}</span>
                          <span className="text-rmpg-400">({formatElapsed(selectedCall.created_at)} ago)</span>
                        </div>
                        {selectedCall.dispatched_at && (
                          <div className="flex items-center gap-2 text-xs">
                            <ArrowRight className="w-3 h-3 text-amber-400" />
                            <span className="text-rmpg-300">Dispatched:</span>
                            <span className="text-white font-mono">{formatTime(selectedCall.dispatched_at)}</span>
                          </div>
                        )}
                        {selectedCall.enroute_at && (
                          <div className="flex items-center gap-2 text-xs">
                            <ArrowRight className="w-3 h-3 text-brand-400" />
                            <span className="text-rmpg-300">En Route:</span>
                            <span className="text-white font-mono">{formatTime(selectedCall.enroute_at)}</span>
                          </div>
                        )}
                        {selectedCall.onscene_at && (
                          <div className="flex items-center gap-2 text-xs">
                            <ArrowRight className="w-3 h-3 text-purple-400" />
                            <span className="text-rmpg-300">On Scene:</span>
                            <span className="text-white font-mono">{formatTime(selectedCall.onscene_at)}</span>
                          </div>
                        )}
                        {selectedCall.cleared_at && (
                          <div className="flex items-center gap-2 text-xs">
                            <ArrowRight className="w-3 h-3 text-rmpg-300" />
                            <span className="text-rmpg-300">Cleared:</span>
                            <span className="text-white font-mono">{formatTime(selectedCall.cleared_at)}</span>
                          </div>
                        )}
                        {selectedCall.archived_at && (
                          <div className="flex items-center gap-2 text-xs">
                            <Archive className="w-3 h-3 text-slate-400" />
                            <span className="text-rmpg-300">Archived:</span>
                            <span className="text-white font-mono">{formatTime(selectedCall.archived_at)}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Assigned Units */}
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="field-label">Assigned Units:</label>
                        {!isEditing && !['cleared', 'closed', 'cancelled', 'archived'].includes(selectedCall.status) && (
                          <div className="relative" ref={attachUnitDropdownRef} style={{ display: 'inline-block' }}>
                            <button
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
                                  onAssign={(unitId) => { handleAssignUnit(unitId); setShowAttachUnitDropdown(false); }}
                                  onCreateUnit={() => { setShowAttachUnitDropdown(false); setShowCreateUnitModal(true); }}
                                  onClose={() => setShowAttachUnitDropdown(false)}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      {(selectedCall.assigned_units || []).length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {(selectedCall.assigned_units || []).map((unitIdStr) => {
                            const unitObj = units.find((u) => String(u.id) === String(unitIdStr));
                            const displayName = unitObj ? unitObj.call_sign : unitIdStr;
                            const statusColor = unitObj ? (
                              unitObj.status === 'onscene' ? '#a855f7' :
                              unitObj.status === 'enroute' ? '#3b82f6' :
                              unitObj.status === 'dispatched' ? '#f59e0b' :
                              '#22c55e'
                            ) : '#5a6e80';
                            const statusLabel = unitObj ? (
                              unitObj.status === 'onscene' ? 'OS' :
                              unitObj.status === 'enroute' ? 'ER' :
                              unitObj.status === 'dispatched' ? 'DP' :
                              ''
                            ) : '';
                            return (
                              <span
                                key={unitIdStr}
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-bold font-mono"
                                style={{ background: `${statusColor}15`, color: statusColor, border: `1px solid ${statusColor}50` }}
                                title={unitObj ? `${displayName} — ${unitObj.officer_name || 'Unassigned'}${unitObj.badge_number ? ` #${unitObj.badge_number}` : ''} (${(unitObj.status || '').replace(/_/g, ' ')})` : displayName}
                              >
                                <span className="rounded-full flex-shrink-0" style={{ width: 5, height: 5, background: statusColor }} />
                                {displayName}
                                {unitObj?.badge_number && <span style={{ fontSize: '8px', opacity: 0.7 }}>#{unitObj.badge_number}</span>}
                                {statusLabel && <span style={{ fontSize: '8px', opacity: 0.8 }}>{statusLabel}</span>}
                                {!isEditing && unitObj && !['cleared', 'closed', 'cancelled', 'archived'].includes(selectedCall.status) && (
                                  <button
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
                        <p className="text-xs text-rmpg-400 mt-1">No units assigned</p>
                      )}
                      {/* Inline ETA from route */}
                      {routeInfo && (
                        <div className="mt-1.5 flex items-center gap-2 px-2 py-1" style={{ background: '#3b82f610', border: '1px solid #3b82f630' }}>
                          <span className="text-[9px] font-mono font-bold text-blue-400">▶ ETA</span>
                          <span className="text-[10px] font-mono font-bold text-white">{routeInfo.eta}</span>
                          <span className="text-[9px] font-mono text-rmpg-400">{routeInfo.distance}</span>
                          <span className="text-[8px] font-mono text-rmpg-500 ml-auto">{routeInfo.unitCallSign}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── MILEAGE (primary unit) — Info tab ─── */}
                {detailTab === 'info' && (isEditing || selectedCall.starting_mileage || selectedCall.ending_mileage) && (
                  <div className="border-t border-rmpg-600 pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2">
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
                        {selectedCall.starting_mileage && <span className="text-rmpg-200"><span className="text-rmpg-400">Start:</span> {Number(selectedCall.starting_mileage).toLocaleString()} mi</span>}
                        {selectedCall.ending_mileage && <span className="text-rmpg-200"><span className="text-rmpg-400">End:</span> {Number(selectedCall.ending_mileage).toLocaleString()} mi</span>}
                        {selectedCall.starting_mileage && selectedCall.ending_mileage && (
                          <span className="text-blue-400 font-semibold">
                            Total: {(Number(selectedCall.ending_mileage) - Number(selectedCall.starting_mileage)).toFixed(1)} mi
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── EXTENDED DETAILS — Info tab ─── */}
                {detailTab === 'info' && (isEditing || selectedCall.cross_street || selectedCall.location_building || selectedCall.location_floor || selectedCall.location_room || selectedCall.section_id || selectedCall.zone_id || selectedCall.beat_id || selectedCall.latitude || selectedCall.dispatch_code) && (
                  <div className="border-t border-rmpg-600 pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2">
                      <MapPin className="w-3 h-3" /> Location Details
                    </label>
                    {isEditing ? (() => {
                      const filteredZones = editData.section_id
                        ? Array.from(new Set(districts.filter(d => d.section_id === editData.section_id).map(d => d.zone_id))).sort()
                        : zones;
                      const filteredBeats = editData.zone_id
                        ? Array.from(new Set(districts.filter(d => d.zone_id === editData.zone_id).map(d => d.beat_id))).sort()
                        : beats;
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
                              <select className="input-dark text-xs" value={editData.section_id} onChange={(e) => {
                                const val = e.target.value;
                                setEditData(prev => ({ ...prev, section_id: val, zone_id: '', beat_id: '', dispatch_code: '' }));
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
                                const match = beatVal && editData.section_id && editData.zone_id
                                  ? districts.find(d => d.section_id === editData.section_id && d.zone_id === editData.zone_id && d.beat_id === beatVal)
                                  : null;
                                setEditData(prev => ({ ...prev, beat_id: beatVal, dispatch_code: match?.dispatch_code || '' }));
                              }}>
                                <option value="">— Select —</option>
                                {filteredBeats.map(b => <option key={b} value={b}>{beatLabels.get(b) || b}</option>)}
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
                          <span className="text-[10px] font-bold font-mono text-amber-300 bg-amber-900/30 border border-amber-700/40 px-1.5 py-0.5 rounded-sm tracking-wide">
                            {selectedCall.dispatch_code}
                          </span>
                        )}
                        {selectedCall.section_id && <span className="text-rmpg-200"><span className="text-rmpg-400">Sec:</span> {selectedCall.section_id} — {sectionLabels.get(selectedCall.section_id) || ''}</span>}
                        {selectedCall.zone_id && <span className="text-rmpg-200"><span className="text-rmpg-400">Zone:</span> {selectedCall.zone_id} — {zoneLabels.get(selectedCall.zone_id) || ''}</span>}
                        {selectedCall.beat_id && <span className="text-rmpg-200"><span className="text-rmpg-400">Beat:</span> {beatLabels.get(selectedCall.beat_id) || selectedCall.beat_id}</span>}
                        {selectedCall.latitude && selectedCall.longitude && (
                          <span className="text-rmpg-400 font-mono text-[9px]">
                            GPS: {Number(selectedCall.latitude).toFixed(5)}, {Number(selectedCall.longitude).toFixed(5)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── SUBJECT/THREAT INFO — Persons tab ─── */}
                {(detailTab === 'info' || detailTab === 'persons') && (isEditing || (selectedCall.weapons_involved && selectedCall.weapons_involved !== 'None') || selectedCall.injuries_reported || selectedCall.num_subjects || selectedCall.subject_description || selectedCall.vehicle_description || selectedCall.direction_of_travel || callPersons.length > 0 || callVehicles.length > 0) && (
                  <div className="border-t border-rmpg-600 pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2">
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
                            <label className="text-[9px] text-brand-gold-500">Linked Persons</label>
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
                                <span key={cp.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono bg-rmpg-700 border border-rmpg-500 rounded text-rmpg-200">
                                  <span className="text-brand-gold-500 uppercase text-[7px] font-black">{(cp.role || '').replace('_', ' ')}</span>
                                  {cp.last_name}, {cp.first_name}
                                  {cp.dob && <span className="text-rmpg-500">DOB:{cp.dob}</span>}
                                  <button onClick={() => unlinkPersonFromCall(selectedCall.id, cp.id)} className="text-red-500 hover:text-red-300 ml-0.5" title="Remove">&times;</button>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="relative" ref={personDropdownRef}>
                            <input type="text" className="input-dark text-xs" placeholder="Search person records to link..." value={editData.subject_description} onChange={(e) => { updateEditField('subject_description', e.target.value); searchPersons(e.target.value); }} onFocus={() => { if (personSearchResults.length > 0) setShowPersonDropdown(true); }} />
                            {showPersonDropdown && personSearchResults.length > 0 && (
                              <div className="absolute z-50 left-0 right-0 mt-0.5 max-h-40 overflow-y-auto border border-rmpg-500 bg-rmpg-800 rounded shadow-lg">
                                {personSearchResults.map((p: any) => (
                                  <button key={p.id} className="w-full text-left px-2 py-1 text-[10px] text-rmpg-200 hover:bg-brand-500/20 border-b border-rmpg-700 last:border-0" onClick={() => {
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
                                <span key={cv.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono bg-rmpg-700 border border-rmpg-500 rounded text-rmpg-200">
                                  <span className="text-brand-gold-500 uppercase text-[7px] font-black">{(cv.role || '').replace(/_/g, ' ')}</span>
                                  {[cv.color, cv.year, cv.make, cv.model].filter(Boolean).join(' ')}
                                  {cv.plate_number && <span className="text-brand-400 ml-0.5">PLT:{cv.plate_number}</span>}
                                  <button onClick={() => unlinkVehicleFromCall(selectedCall.id, cv.id)} className="text-red-500 hover:text-red-300 ml-0.5" title="Remove">&times;</button>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="relative" ref={vehicleDropdownRef}>
                            <input type="text" className="input-dark text-xs" placeholder="Search vehicle records to link..." value={editData.vehicle_description} onChange={(e) => { updateEditField('vehicle_description', e.target.value); searchVehicles(e.target.value); }} onFocus={() => { if (vehicleSearchResults.length > 0) setShowVehicleDropdown(true); }} />
                            {showVehicleDropdown && vehicleSearchResults.length > 0 && (
                              <div className="absolute z-50 left-0 right-0 mt-0.5 max-h-40 overflow-y-auto border border-rmpg-500 bg-rmpg-800 rounded shadow-lg">
                                {vehicleSearchResults.map((v: any) => (
                                  <button key={v.id} className="w-full text-left px-2 py-1 text-[10px] text-rmpg-200 hover:bg-brand-500/20 border-b border-rmpg-700 last:border-0" onClick={() => {
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
                              <div key={cp.id} className="flex items-center gap-2 px-2 py-1 bg-rmpg-800/60 border border-rmpg-700 rounded text-[10px]">
                                <span className="text-brand-gold-500 uppercase text-[7px] font-black px-1 py-px bg-rmpg-700 rounded">{(cp.role || '').replace(/_/g, ' ')}</span>
                                <span className="text-white font-semibold">{cp.last_name}, {cp.first_name}</span>
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
                              <div key={cv.id} className="flex items-center gap-2 px-2 py-1 bg-rmpg-800/60 border border-rmpg-700 rounded text-[10px]">
                                <span className="text-brand-gold-500 uppercase text-[7px] font-black px-1 py-px bg-rmpg-700 rounded">{(cv.role || '').replace(/_/g, ' ')}</span>
                                <span className="text-white font-semibold">{[cv.color, cv.year, cv.make, cv.model].filter(Boolean).join(' ')}</span>
                                {cv.plate_number && <span className="text-brand-400">PLT: {cv.plate_number}{cv.plate_state ? `/${cv.plate_state}` : ''}</span>}
                                {cv.stolen_status && cv.stolen_status !== 'none' && <span className="text-red-400 font-bold uppercase">STOLEN</span>}
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
                  <div className="border-t border-rmpg-600 pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2">
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
                  <div className="border-t border-rmpg-600 pt-3 mb-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="field-label !flex items-center gap-1.5">
                        <Building2 className="w-3 h-3" /> PSO Client Request Details
                        {selectedCall.pso_attempt_number && selectedCall.pso_attempt_number > 1 && (
                          <span className="ml-1.5 px-1.5 py-0.5 text-[8px] font-bold rounded" style={{ background: '#f59e0b30', border: '1px solid #f59e0b50', color: '#fbbf24' }}>
                            {selectedCall.pso_attempt_number === 2 ? '2nd' : selectedCall.pso_attempt_number === 3 ? '3rd' : `${selectedCall.pso_attempt_number}th`} ATTEMPT
                          </span>
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
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded animate-pulse" style={{ background: '#dc262640', border: '1px solid #dc262660', color: '#f87171' }}>
                              72HR OVERDUE — RE-DISPATCH REQUIRED
                            </span>
                          );
                        }
                        if (elapsed >= 48 * 3600000) {
                          return (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#f59e0b20', border: '1px solid #f59e0b40', color: '#fbbf24' }}>
                              {Math.floor(hoursLeft)}HR UNTIL DEADLINE
                            </span>
                          );
                        }
                        return null;
                      })()}
                      {!isEditing && selectedCall.incident_type === 'pso_client_request' && ['cleared', 'closed', 'cancelled', 'on_hold', 'archived'].includes(selectedCall.status) && (
                        <button
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
                          <div><label className="text-[9px] text-brand-gold-500">Requestor Phone</label><input type="text" className="input-dark text-xs" placeholder="Phone number" value={editData.pso_requestor_phone} onChange={(e) => updateEditField('pso_requestor_phone', e.target.value)} /></div>
                          <div><label className="text-[9px] text-brand-gold-500">Requestor Email</label><input type="text" className="input-dark text-xs" placeholder="Email address" value={editData.pso_requestor_email} onChange={(e) => updateEditField('pso_requestor_email', e.target.value)} /></div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="text-[9px] text-brand-gold-500">Service Type</label>
                            <select className="input-dark text-xs" value={editData.pso_service_type} onChange={(e) => updateEditField('pso_service_type', e.target.value)}>
                              <option value="">— Select —</option>
                              <option value="patrol">Patrol</option>
                              <option value="static_guard">Static Guard</option>
                              <option value="escort">Escort</option>
                              <option value="event_security">Event Security</option>
                              <option value="surveillance">Surveillance</option>
                              <option value="access_control">Access Control</option>
                              <option value="other">Other</option>
                            </select>
                          </div>
                          <div><label className="text-[9px] text-brand-gold-500">Billing Code</label><input type="text" className="input-dark text-xs" placeholder="Billing code" value={editData.pso_billing_code} onChange={(e) => updateEditField('pso_billing_code', e.target.value)} /></div>
                          <div><label className="text-[9px] text-brand-gold-500">Authorization</label><input type="text" className="input-dark text-xs" placeholder="Authorization #" value={editData.pso_authorization} onChange={(e) => updateEditField('pso_authorization', e.target.value)} /></div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-xs">
                        {selectedCall.pso_requestor_name && <span className="text-rmpg-200"><span className="text-rmpg-400">Requestor:</span> {selectedCall.pso_requestor_name}</span>}
                        {selectedCall.pso_requestor_phone && <span className="text-rmpg-200"><span className="text-rmpg-400">Phone:</span> {selectedCall.pso_requestor_phone}</span>}
                        {selectedCall.pso_requestor_email && <span className="text-rmpg-200"><span className="text-rmpg-400">Email:</span> {selectedCall.pso_requestor_email}</span>}
                        {selectedCall.pso_service_type && <span className="text-rmpg-200"><span className="text-rmpg-400">Service:</span> {selectedCall.pso_service_type}</span>}
                        {selectedCall.pso_billing_code && <span className="text-rmpg-200"><span className="text-rmpg-400">Billing:</span> {selectedCall.pso_billing_code}</span>}
                        {selectedCall.pso_authorization && <span className="text-rmpg-200"><span className="text-rmpg-400">Auth:</span> {selectedCall.pso_authorization}</span>}
                        {!selectedCall.pso_requestor_name && !selectedCall.pso_service_type && selectedCall.incident_type === 'pso_client_request' && (
                          <span className="text-rmpg-500 italic">No PSO details entered yet</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── PROCESS SERVICE DETAILS — Info tab ─── */}
                {detailTab === 'info' && (isEditing
                  ? editData.pso_service_type === 'process_service'
                  : (selectedCall.pso_service_type === 'process_service' || selectedCall.process_service_type || selectedCall.process_served_to || selectedCall.process_attempts)
                ) && (
                  <div className="border-t border-rmpg-600 pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2">
                      <FileText className="w-3 h-3" /> Process Service Details
                      {!isEditing && selectedCall.process_service_result && (
                        <span className={`ml-1.5 px-1.5 py-0.5 text-[8px] font-bold rounded ${
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
                        <span className="ml-1 px-1.5 py-0.5 text-[8px] font-bold rounded bg-brand-900/40 border border-brand-600/40 text-brand-300">
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
                              <option value="">— Select —</option>
                              <option value="subpoena">Subpoena</option>
                              <option value="summons">Summons</option>
                              <option value="complaint">Complaint</option>
                              <option value="eviction">Eviction</option>
                              <option value="restraining_order">Restraining Order</option>
                              <option value="other">Other</option>
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
                            <input type="datetime-local" className="input-dark text-xs" value={editData.process_served_at || ''} onChange={(e) => updateEditField('process_served_at', e.target.value)} />
                          </div>
                          <div>
                            <label className="text-[9px] text-amber-400">Service Result</label>
                            <select className="input-dark text-xs" value={editData.process_service_result || ''} onChange={(e) => updateEditField('process_service_result', e.target.value)}>
                              <option value="">— Pending —</option>
                              <option value="served">Served</option>
                              <option value="unable_to_serve">Unable to Serve</option>
                              <option value="refused">Refused</option>
                              <option value="substitute_service">Substitute Service</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-xs">
                        {selectedCall.process_service_type && <span className="text-rmpg-200"><span className="text-rmpg-400">Document:</span> {selectedCall.process_service_type.replace(/_/g, ' ')}</span>}
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
                  <div className="border-t border-rmpg-600 pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2">
                      <Clock className="w-3 h-3" /> Visit History
                      <span className="ml-1 px-1.5 py-0.5 text-[8px] font-bold rounded" style={{ background: '#3b82f620', border: '1px solid #3b82f640', color: '#60a5fa' }}>
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
                          <div key={visit.id} className="bg-rmpg-800/60 border border-rmpg-600/50 rounded px-2.5 py-1.5">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] font-bold font-mono text-amber-300 bg-amber-900/30 border border-amber-700/40 px-1 py-0">
                                  VISIT #{visit.visit_number}
                                </span>
                                <span className={`text-[8px] font-bold px-1 py-0 rounded ${
                                  visit.status === 'cleared' ? 'bg-green-900/40 border border-green-700/50 text-green-400'
                                  : visit.status === 'closed' ? 'bg-blue-900/40 border border-blue-700/50 text-blue-400'
                                  : visit.status === 'cancelled' ? 'bg-red-900/40 border border-red-700/50 text-red-400'
                                  : 'bg-rmpg-700 border border-rmpg-500 text-rmpg-300'
                                }`}>
                                  {(visit.status || '').toUpperCase()}
                                </span>
                                {visit.disposition && (
                                  <span className="text-[9px] text-rmpg-300">{visit.disposition}</span>
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
                  <div className="border-t border-rmpg-600 pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2">
                      <Shield className="w-3 h-3" /> Quick Flags
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {([
                        { field: 'alcohol_involved', label: 'Alcohol', onBg: '#f59e0b30', onBorder: '#f59e0b50', onText: '#fbbf24' },
                        { field: 'drugs_involved', label: 'Drugs', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                        { field: 'domestic_violence', label: 'DV', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                        { field: 'injuries_reported', label: 'Injuries', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                        { field: 'supervisor_notified', label: 'Supervisor', onBg: '#3b82f630', onBorder: '#3b82f650', onText: '#60a5fa' },
                        { field: 'le_notified', label: 'LE Notified', onBg: '#3b82f630', onBorder: '#3b82f650', onText: '#60a5fa' },
                        { field: 'mental_health_crisis', label: 'Mental Health', onBg: '#a855f730', onBorder: '#a855f750', onText: '#c084fc' },
                        { field: 'juvenile_involved', label: 'Juvenile', onBg: '#f9731630', onBorder: '#f9731650', onText: '#fb923c' },
                        { field: 'felony_in_progress', label: 'Felony', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                        { field: 'officer_safety_caution', label: 'Officer Safety', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                        { field: 'gang_related', label: 'Gang', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                        { field: 'body_camera_active', label: 'Body Cam', onBg: '#22c55e30', onBorder: '#22c55e50', onText: '#4ade80' },
                        { field: 'k9_requested', label: 'K9', onBg: '#06b6d430', onBorder: '#06b6d450', onText: '#22d3ee' },
                        { field: 'ems_requested', label: 'EMS', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                        { field: 'fire_requested', label: 'Fire', onBg: '#f9731630', onBorder: '#f9731650', onText: '#fb923c' },
                        { field: 'hazmat', label: 'HazMat', onBg: '#eab30830', onBorder: '#eab30850', onText: '#fbbf24' },
                        { field: 'evidence_collected', label: 'Evidence', onBg: '#10b98130', onBorder: '#10b98150', onText: '#34d399' },
                        { field: 'photos_taken', label: 'Photos', onBg: '#6366f130', onBorder: '#6366f150', onText: '#818cf8' },
                        { field: 'trespass_issued', label: 'Trespass', onBg: '#f59e0b30', onBorder: '#f59e0b50', onText: '#fbbf24' },
                        { field: 'vehicle_pursuit', label: 'Vehicle Pursuit', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                        { field: 'foot_pursuit', label: 'Foot Pursuit', onBg: '#ef444430', onBorder: '#ef444450', onText: '#f87171' },
                      ] as const).map(({ field, label, onBg, onBorder, onText }) => {
                        const isOn = !!(selectedCall as any)[field];
                        return (
                          <button
                            key={field}
                            className="px-2 py-0.5 text-[9px] font-semibold rounded transition-colors border"
                            style={isOn
                              ? { background: onBg, borderColor: onBorder, color: onText }
                              : { background: 'var(--color-rmpg-700, #1a1a2e)', borderColor: 'var(--color-rmpg-600, #2a2a3e)', color: 'var(--color-rmpg-400, #888)' }
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
                <div className="border-t border-rmpg-600 pt-3 mb-3" style={{ display: detailTab === 'timeline' ? undefined : 'none' }}>
                  <div className="flex items-center justify-between mb-2">
                    <label className="field-label !flex items-center gap-1.5">
                      <Clock className="w-3 h-3" /> Activity Log
                    </label>
                    <button onClick={() => setShowAddTimeline(!showAddTimeline)} className="toolbar-btn" style={{ padding: '1px 6px', fontSize: '9px' }}>
                      <PlusCircle style={{ width: 9, height: 9 }} /> Add Entry
                    </button>
                  </div>
                  {showAddTimeline && (
                    <div className="flex gap-2 mb-2">
                      <input type="text" className="input-dark flex-1 text-xs" placeholder="New timeline entry..." spellCheck={true} value={newTimelineText}
                        onChange={(e) => setNewTimelineText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddTimeline(); }}
                      />
                      <button onClick={handleAddTimeline} className="toolbar-btn toolbar-btn-primary" style={{ fontSize: '9px' }} disabled={!newTimelineText.trim()}>Add</button>
                    </div>
                  )}
                  {activityEntries.length > 0 ? (
                    <div className="space-y-1 max-h-36 overflow-y-auto">
                      {activityEntries.map((entry: any) => (
                        <div key={entry.id} className="group flex items-start gap-2 text-xs hover:bg-rmpg-700/30 px-1 py-0.5 transition-colors">
                          <span className="text-rmpg-400 font-mono whitespace-nowrap" style={{ fontSize: '9px' }}>
                            {entry.created_at ? formatTime(entry.created_at) : '--'}
                          </span>
                          {editingTimelineId === String(entry.id) ? (
                            <div className="flex-1 flex gap-1">
                              <input type="text" className="input-dark text-xs flex-1" value={editTimelineText}
                                onChange={(e) => setEditTimelineText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleEditTimeline(String(entry.id)); if (e.key === 'Escape') setEditingTimelineId(null); }}
                                autoFocus
                              />
                              <button onClick={() => handleEditTimeline(String(entry.id))} className="toolbar-btn" style={{ padding: '1px 4px', fontSize: '9px' }}>
                                <Save style={{ width: 8, height: 8 }} />
                              </button>
                              <button onClick={() => setEditingTimelineId(null)} className="toolbar-btn" style={{ padding: '1px 4px', fontSize: '9px' }}>
                                <X style={{ width: 8, height: 8 }} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="text-rmpg-200 flex-1">{formatActivityDetails(entry.details || entry.description || '')}</span>
                              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                                <button onClick={() => { setEditingTimelineId(String(entry.id)); setEditTimelineText(entry.details || entry.description || ''); }} className="p-0.5 hover:text-brand-400 text-rmpg-500" title="Edit">
                                  <Edit3 style={{ width: 9, height: 9 }} />
                                </button>
                                <button onClick={() => handleDeleteTimeline(String(entry.id))} className="p-0.5 hover:text-red-400 text-rmpg-500" title="Delete">
                                  <Trash2 style={{ width: 9, height: 9 }} />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-rmpg-500 italic">No activity recorded — use Add Entry to start the log.</p>
                  )}
                </div>

                {/* Notes — fills remaining vertical space — Notes tab */}
                <div className="border-t border-rmpg-600 pt-3 flex-1 flex flex-col min-h-0" style={{ display: detailTab === 'notes' ? undefined : 'none' }}>
                  <label className="field-label !flex items-center gap-1.5 mb-2 flex-shrink-0">
                    <MessageSquare className="w-3 h-3" /> Notes
                  </label>
                  <div className="space-y-1.5 mb-3 flex-1 overflow-y-auto">
                    {(selectedCall.notes || []).map((note) => (
                      <div key={note.id} className="flex items-start gap-2 text-xs">
                        <span className="text-rmpg-400 font-mono whitespace-nowrap">{formatTime(note.timestamp)}</span>
                        <span className="text-brand-400 font-semibold whitespace-nowrap">{note.author}:</span>
                        <span className="text-rmpg-200">{renderFormattedText(note.text)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex-shrink-0">
                    {/* Formatting toolbar */}
                    <div className="flex items-center gap-0.5 mb-1">
                      <button type="button" title="Bold (Ctrl+B)" className="px-1.5 py-0.5 text-[9px] font-black text-rmpg-300 hover:text-white hover:bg-rmpg-600 border border-rmpg-600 transition-colors" onClick={() => wrapNoteSelection('**')}>B</button>
                      <button type="button" title="Italic (Ctrl+I)" className="px-1.5 py-0.5 text-[9px] italic font-semibold text-rmpg-300 hover:text-white hover:bg-rmpg-600 border border-rmpg-600 transition-colors" onClick={() => wrapNoteSelection('*')}>I</button>
                      <button type="button" title="Underline (Ctrl+U)" className="px-1.5 py-0.5 text-[9px] underline text-rmpg-300 hover:text-white hover:bg-rmpg-600 border border-rmpg-600 transition-colors" onClick={() => wrapNoteSelection('__')}>U</button>
                      <span className="text-[8px] text-rmpg-500 ml-1">Shift+Enter to add</span>
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
                      <button onClick={handleAddNote} className="toolbar-btn toolbar-btn-primary self-end" disabled={!newNote.trim()}>
                        Add
                      </button>
                    </div>
                  </div>
                </div>

                {/* Linked Incidents — Notes tab */}
                {detailTab === 'notes' && linkedIncidents.length > 0 && (
                  <div className="border-t border-rmpg-600 pt-3 flex-shrink-0">
                    <label className="field-label !flex items-center gap-1.5 mb-2">
                      <Link className="w-3 h-3" /> Linked Incidents
                    </label>
                    <div className="space-y-1 mt-1">
                      {linkedIncidents.map((inc: any) => (
                        <div
                          key={inc.id || inc.incident_number}
                          className="flex items-center gap-3 px-2 py-1.5 hover:bg-rmpg-700/50 cursor-pointer transition-colors"
                          onClick={() => navigate(`/incidents/${inc.id}`)}
                        >
                          <span className="font-mono text-green-400 text-xs font-bold">{inc.incident_number}</span>
                          <span className="text-xs text-rmpg-200 truncate">{formatIncidentType(inc.type || inc.incident_type || '--')}</span>
                          <span className="text-xs text-rmpg-400 uppercase font-semibold">{inc.status || '--'}</span>
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

              {/* Mileage Prompt Modal — En Route / On Scene */}
              {mileagePrompt && (
                <MileagePromptModal
                  mode={mileagePrompt.status === 'enroute' ? 'starting' : 'ending'}
                  callNumber={mileagePrompt.callNumber}
                  vehicleId={mileagePrompt.vehicleId}
                  startingMileage={mileagePrompt.startingMileage}
                  onSubmit={handleMileageSubmit}
                  onCancel={() => setMileagePrompt(null)}
                />
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
            <div className="flex-1 flex items-center justify-center text-rmpg-400">
              <div className="text-center">
                <Radio className="w-10 h-10 mx-auto mb-3 text-rmpg-500" />
                <p className="text-sm">Select a call to view details</p>
                <p className="text-xs text-rmpg-500 mt-1">or create a new call for service</p>
              </div>
            </div>
          )}
          </div>

          {/* Dispatch Map Panel (right side, always visible) */}
          <div className="w-[35%] border-l border-rmpg-600 flex flex-col bg-surface-deep overflow-hidden flex-shrink-0">
            {selectedCall?.latitude && selectedCall?.longitude ? (
              <DispatchMiniMap
                call={selectedCall}
                units={units}
                fullHeight
                onRouteUpdate={setRouteInfo}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-rmpg-500">
                <div className="text-center">
                  <MapPin className="w-8 h-8 mx-auto mb-2 text-rmpg-600" />
                  <p className="text-[10px] font-mono">NO LOCATION DATA</p>
                  <p className="text-[9px] text-rmpg-600 mt-0.5">Select a geolocated call</p>
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
            <span className="text-[9px] font-mono" style={{ color: '#22c55e' }}>
              {units.filter((u) => u.status === 'available').length} AVAIL
            </span>
            <span className="toolbar-separator" />
            <span className="text-[9px] font-mono" style={{ color: '#8a9aaa' }}>
              {units.filter((u) => u.status !== 'off_duty').length} ON DUTY
            </span>
            <span className="toolbar-separator" />
            <button onClick={() => setShowCreateUnitModal(true)} className="toolbar-btn toolbar-btn-primary">
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
            className="py-1 min-w-[180px] shadow-xl"
            style={{ background: '#1a2636', border: '1px solid #3a5070' }}
            onMouseLeave={() => setContextMenu(null)}
          >
            {contextMenu.call.status === 'pending' && (
              <button className="context-menu-item" onClick={() => { handleStatusChange(contextMenu.call.id, 'dispatched'); setContextMenu(null); }}>
                <Send style={{ width: 12, height: 12 }} /> Dispatch
              </button>
            )}
            {contextMenu.call.status === 'dispatched' && (
              <button className="context-menu-item" onClick={() => { handleStatusChange(contextMenu.call.id, 'enroute'); setContextMenu(null); }}>
                <Navigation style={{ width: 12, height: 12 }} /> En Route
              </button>
            )}
            {contextMenu.call.status === 'enroute' && (
              <button className="context-menu-item" onClick={() => { handleStatusChange(contextMenu.call.id, 'onscene'); setContextMenu(null); }}>
                <Eye style={{ width: 12, height: 12 }} /> On Scene
              </button>
            )}
            {['dispatched', 'enroute', 'onscene'].includes(contextMenu.call.status) && (
              <>
                <button className="context-menu-item" onClick={() => { handleClearWithDisposition(contextMenu.call.id); setContextMenu(null); }}>
                  <CheckCircle style={{ width: 12, height: 12 }} /> Clear
                </button>
                <button className="context-menu-item" onClick={() => { handleHoldCall(contextMenu.call.id); setContextMenu(null); }}>
                  ⏸ Hold
                </button>
              </>
            )}
            {contextMenu.call.status === 'on_hold' && (
              <button className="context-menu-item" onClick={() => { handleResumeCall(contextMenu.call.id); setContextMenu(null); }}>
                ▶ Resume
              </button>
            )}
            {contextMenu.call.status !== 'archived' && (
              <>
                <div className="border-t border-rmpg-600 my-1" />
                <button className="context-menu-item" onClick={() => { handleArchive(contextMenu.call.id); setContextMenu(null); }}>
                  <Archive style={{ width: 12, height: 12 }} /> Archive
                </button>
              </>
            )}
            <div className="border-t border-rmpg-600 my-1" />
            <button className="context-menu-item" onClick={() => { navigator.clipboard.writeText(contextMenu.call.call_number); setContextMenu(null); addToast('Call number copied', 'success'); }}>
              Copy Call Number
            </button>
            <button className="context-menu-item text-red-400" onClick={() => { setDeleteCallTarget(contextMenu.call); setContextMenu(null); }}>
              <Trash2 style={{ width: 12, height: 12 }} /> Delete
            </button>
          </div>
        </div>
      )}

      {/* Quick Template Dialog — minimal address-only dispatch */}
      {quickTemplateData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" style={{ background: 'rgba(0,0,0,0.6)' }} onKeyDown={(e) => { if (e.key === 'Escape') setQuickTemplateData(null); }}>
          <form
            className="panel-beveled bg-surface-raised"
            style={{ width: '440px', border: '1px solid #3a5070' }}
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
              <div className="flex items-center gap-3 p-2 border border-rmpg-600" style={{ background: '#0d1520' }}>
                <span className={`text-xs font-bold px-2 py-0.5 border ${
                  quickTemplateData.priority === 'P1' ? 'border-red-500 text-red-400 bg-red-900/30' :
                  quickTemplateData.priority === 'P2' ? 'border-amber-500 text-amber-400 bg-amber-900/30' :
                  quickTemplateData.priority === 'P4' ? 'border-gray-500 text-rmpg-300 bg-rmpg-700/30' :
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
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={unitModalTitleId} style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="panel-beveled bg-surface-raised" style={{ width: '420px', border: '1px solid #3a5070' }}>
            <div className="panel-title-bar">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-brand-400" />
                <span id={unitModalTitleId} className="text-sm font-bold text-white">{editingUnit ? 'Edit Dispatch Unit' : 'Create Dispatch Unit'}</span>
              </div>
              <button onClick={() => { setShowCreateUnitModal(false); setEditingUnit(null); setNewUnitCallSign(''); setNewUnitOfficerId(''); setNewUnitStatus('available'); }} className="toolbar-btn ml-auto">
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
                <button onClick={() => { setShowCreateUnitModal(false); setEditingUnit(null); setNewUnitCallSign(''); setNewUnitOfficerId(''); setNewUnitStatus('available'); }} className="toolbar-btn">
                  Cancel
                </button>
                <button
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
                break;
              case 'query_vehicle':
                setNcicInitialQuery({ type: 'vehicle', query: action.query });
                setShowNcicPanel(true);
                break;
              case 'query_warrant':
                setNcicInitialQuery({ type: 'warrant', query: action.query });
                setShowNcicPanel(true);
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
                // Info-only — output is shown in the command line
                break;
              case 'query_bolo':
                // Navigate to communications page (BOLO section)
                navigate('/communications');
                break;
              case 'new_fi':
                // Navigate to field interviews page
                navigate('/field-interviews');
                break;
              case 'query_trespass':
                // Navigate to trespass orders page
                navigate('/trespass-orders');
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
    </div>
  );
}

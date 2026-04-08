import React, { useState, useEffect, useCallback, useRef, useId } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
import type { CallForService, Unit, CallStatus, CallNote, UnitStatus } from '../types';
import CallCard from '../components/CallCard';
import UnitStatusBoard from '../components/UnitStatusBoard';
import DispositionPrompt from '../components/DispositionPrompt';
import DispatchMiniMap from '../components/DispatchMiniMap';
import BoloAlertBanner from '../components/BoloAlertBanner';
import StatusBadge from '../components/StatusBadge';
import NewCallModal from '../components/NewCallModal';
import PanelTitleBar from '../components/PanelTitleBar';
import ExportButton from '../components/ExportButton';
import TabBar from '../components/TabBar';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { usePersistedTab } from '../hooks/usePersistedState';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { formatIncidentType, INCIDENT_TYPE_CATEGORIES } from '../utils/caseNumbers';
import ConfirmDialog from '../components/ConfirmDialog';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import PrintRecordButton from '../components/PrintRecordButton';
import { useToast } from '../components/ToastProvider';
import { useWebSocket } from '../context/WebSocketContext';
import WarningTags from '../components/WarningTags';
import type { WarningTag } from '../components/WarningTags';
import FloatingSaveBar from '../components/FloatingSaveBar';
import CadCommandLine from '../components/CadCommandLine';
import NcicQueryPanel from '../components/NcicQueryPanel';
import UnitRecommendationPanel from '../components/UnitRecommendationPanel';
import AnomalyAlertBanner from '../components/AnomalyAlertBanner';
import type { CommandAction } from '../utils/cadCommandParser';
import { getTimerState, isActiveStatus } from '../utils/dispatchTimers';
import { playTone } from '../utils/dispatchTones';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileCardList from '../components/mobile/MobileCardList';
import MobileDetailView from '../components/mobile/MobileDetailView';

// ============================================================
// Helpers to map backend DB rows -> frontend types
// ============================================================

function mapDbCall(row: any): CallForService {
  // Notes: backend stores as single string; we parse or wrap
  let notes: CallNote[] = [];
  if (row.notes) {
    try {
      const parsed = JSON.parse(row.notes);
      if (Array.isArray(parsed)) notes = parsed;
      else notes = [{ id: '1', author: 'System', text: row.notes, timestamp: row.created_at }];
    } catch {
      notes = [{ id: '1', author: 'System', text: row.notes, timestamp: row.created_at }];
    }
  }

  // assigned_unit_ids -> assigned_units (call signs)
  let assignedUnits: string[] = [];
  if (row.assigned_unit_ids) {
    try {
      assignedUnits = JSON.parse(row.assigned_unit_ids).map(String);
    } catch { /* ignore */ }
  }

  return {
    id: String(row.id),
    call_number: row.call_number || '',
    incident_type: row.incident_type || 'other',
    priority: row.priority || 'P3',
    status: row.status || 'pending',
    caller_name: row.caller_name || undefined,
    caller_phone: row.caller_phone || undefined,
    caller_relationship: row.caller_relationship || undefined,
    caller_address: row.caller_address || undefined,
    location: row.location_address || row.location || '',
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    property_id: row.property_id ? String(row.property_id) : undefined,
    property_name: row.property_name || undefined,
    client_id: row.client_id ? String(row.client_id) : undefined,
    client_name: row.client_name || undefined,
    description: row.description || '',
    source: row.source || 'phone',
    assigned_units: assignedUnits,
    notes,
    disposition: row.disposition || undefined,
    // Location details
    cross_street: row.cross_street || undefined,
    location_building: row.location_building || undefined,
    location_floor: row.location_floor || undefined,
    location_room: row.location_room || undefined,
    zone_beat: row.zone_beat || undefined,
    section_id: row.section_id || undefined,
    zone_id: row.zone_id || undefined,
    beat_id: row.beat_id || undefined,
    // Subject/threat info
    weapons_involved: row.weapons_involved || undefined,
    injuries_reported: !!row.injuries_reported,
    num_subjects: row.num_subjects || undefined,
    num_victims: row.num_victims || undefined,
    subject_description: row.subject_description || undefined,
    vehicle_description: row.vehicle_description || undefined,
    direction_of_travel: row.direction_of_travel || undefined,
    // Scene details
    scene_safety: row.scene_safety || undefined,
    weather_conditions: row.weather_conditions || undefined,
    lighting_conditions: row.lighting_conditions || undefined,
    // Flags
    alcohol_involved: !!row.alcohol_involved,
    drugs_involved: !!row.drugs_involved,
    domestic_violence: !!row.domestic_violence,
    supervisor_notified: !!row.supervisor_notified,
    le_notified: !!row.le_notified,
    le_agency: row.le_agency || undefined,
    le_case_number: row.le_case_number || undefined,
    // Damage
    damage_estimate: row.damage_estimate || undefined,
    damage_description: row.damage_description || undefined,
    // Resolution
    action_taken: row.action_taken || undefined,
    responding_officer: row.responding_officer || undefined,
    secondary_type: row.secondary_type || undefined,
    contact_method: row.contact_method || undefined,
    // Timestamps
    created_at: row.created_at || '',
    dispatched_at: row.dispatched_at || undefined,
    enroute_at: row.enroute_at || undefined,
    onscene_at: row.onscene_at || undefined,
    cleared_at: row.cleared_at || undefined,
    closed_at: row.closed_at || undefined,
    archived_at: row.archived_at || undefined,
    created_by: row.dispatcher_id ? String(row.dispatcher_id) : '',
    updated_at: row.updated_at || '',
  };
}

function mapDbUnit(row: any): Unit {
  return {
    id: String(row.id),
    call_sign: row.call_sign || '',
    officer_id: row.officer_id ? String(row.officer_id) : '',
    officer_name: row.officer_name || '',
    status: row.status || 'available',
    current_call_id: row.current_call_id ? String(row.current_call_id) : undefined,
    current_call_number: row.call_number || undefined,
    location: row.current_call_location || row.location || undefined,
    latitude: row.latitude,
    longitude: row.longitude,
    vehicle: row.vehicle || undefined,
    last_status_change: row.last_status_change || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

// ============================================================
// Component
// ============================================================

type FilterTab = 'all' | 'pending' | 'active' | 'cleared' | 'archived';

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatElapsed(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

export default function DispatchPage() {
  const unitModalTitleId = useId();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { addToast } = useToast();
  const { subscribe } = useWebSocket();
  const isMobile = useIsMobile();
  const [calls, setCalls] = useState<CallForService[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedCall, setSelectedCall] = useState<CallForService | null>(null);
  const [filterTab, setFilterTab] = usePersistedTab('rmpg_dispatch_tab', 'all' as FilterTab, ['all', 'pending', 'active', 'cleared', 'archived'] as const);
  const [showNewCallModal, setShowNewCallModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newNote, setNewNote] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  // Quick Dispatch templates
  const [templates, setTemplates] = useState<any[]>([]);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [templateInitialData, setTemplateInitialData] = useState<Record<string, any> | undefined>(undefined);
  // Linked incidents for the selected call
  const [linkedIncidents, setLinkedIncidents] = useState<any[]>([]);
  // Warning tags / caution alerts for selected call
  const [callWarnings, setCallWarnings] = useState<WarningTag[]>([]);
  // NCIC Query Panel
  const [showNcicPanel, setShowNcicPanel] = useState(false);
  const [ncicInitialQuery, setNcicInitialQuery] = useState<{ type: 'person' | 'vehicle' | 'warrant'; query: string } | null>(null);
  // Timeline / activity log entries for selected call
  const [activityEntries, setActivityEntries] = useState<any[]>([]);
  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);
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
      };
      try {
        fetch(`/api/dispatch/calls/${selectedCallRef.current.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
          keepalive: true,
        });
      } catch { /* best-effort */ }
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
  // Mini-map visibility toggle
  const [showMiniMap, setShowMiniMap] = useState(true);
  // Clients list for client selector
  const [clientsList, setClientsList] = useState<{ id: string; name: string }[]>([]);
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
      if (!options?.silent) console.error('Failed to load dispatch data:', err);
    } finally {
      if (!options?.silent) setIsLoading(false);
    }
  }, []);

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
    }
  }, []);

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
    }).catch(() => {});
    // Fetch clients list for client selector
    apiFetch<any[]>('/admin/clients')
      .then((data) => setClientsList((Array.isArray(data) ? data : []).filter((c: any) => c.status === 'active').map((c: any) => ({ id: String(c.id), name: c.name }))))
      .catch(() => {});
    // Fetch properties list (non-archived) for property selector
    apiFetch<any[]>('/records/properties')
      .then((data) => setPropertiesList((Array.isArray(data) ? data : []).map((p: any) => ({ id: String(p.id), name: p.name }))))
      .catch(() => {});
  }, [fetchData]);

  // Live sync — auto-refresh when any device modifies dispatch data (silent to avoid unmounting UI)
  const silentRefresh = useCallback(() => fetchData({ silent: true }), [fetchData]);
  useLiveSync('dispatch', silentRefresh);

  // Deep-link: auto-select call for a unit from query params (?unitId=)
  useEffect(() => {
    if (units.length === 0 || calls.length === 0) return;
    const unitId = searchParams.get('unitId');
    if (unitId) {
      const unit = units.find(u => String(u.id) === unitId);
      if (unit?.current_call_id) {
        const call = calls.find(c => String(c.id) === String(unit.current_call_id));
        if (call) setSelectedCall(call);
      }
      setSearchParams({}, { replace: true });
    }
  }, [units, calls, searchParams, setSearchParams]);

  // ── WebSocket: real-time dispatch updates & panic auto-dispatch ──
  useEffect(() => {
    // Listen for new calls (including panic-auto-created calls)
    const unsubDispatch = subscribe('dispatch_update', (msg: any) => {
      const data = msg.data || msg;
      if (data.action === 'call_created' && data.call) {
        const mapped = mapDbCall(data.call);
        setCalls((prev) => {
          // Avoid duplicate if we just created this call locally
          if (prev.some((c) => c.id === mapped.id)) return prev;
          return [mapped, ...prev];
        });
        // If it's a panic call, auto-select it so the dispatch card opens immediately
        if (data.call.source === 'panic') {
          setSelectedCall(mapped);
          addToast('PANIC — Officer Assist call auto-created', 'error', 10000);
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
      } else if (data.action === 'units_dispatched' || data.action === 'unit_assigned' || data.action === 'unit_unassigned') {
        // Refresh the full list to keep unit assignments in sync
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
          return [...prev, { ...data.unit, id: String(data.unit.id) }];
        });
      } else if (data.action === 'unit_deleted' && data.unit_id) {
        setUnits((prev) => prev.filter((u) => String(u.id) !== String(data.unit_id)));
      }
    });

    // Listen for panic alerts — switch to active tab so the card is visible
    const unsubPanic = subscribe('panic_alert', (_msg: any) => {
      setFilterTab('active');
    });

    return () => { unsubDispatch(); unsubUnit(); unsubPanic(); };
  }, [subscribe, fetchData, addToast, setFilterTab]);

  // When switching to the archived tab, fetch archived calls if not loaded
  useEffect(() => {
    if (filterTab === 'archived' && !archivedLoaded) {
      fetchArchivedCalls();
    }
  }, [filterTab, archivedLoaded, fetchArchivedCalls]);

  // Fetch Quick Dispatch templates
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<any>('/dispatch/templates');
        setTemplates(Array.isArray(res) ? res : res?.data ?? []);
      } catch {
        // Templates are optional — silently ignore if endpoint is unavailable
      }
    })();
  }, []);

  // Fetch all active personnel for unit assignment dropdown (any role)
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch<any>('/personnel?status=active');
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
    setIsEditing(false);
    setShowAttachUnitDropdown(false);
    (async () => {
      try {
        const res = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`);
        const incidents = res?.related_incidents ?? res?.incidents ?? [];
        setLinkedIncidents(Array.isArray(incidents) ? incidents : []);
        const activity = res?.activity ?? [];
        setActivityEntries(Array.isArray(activity) ? activity : []);
      } catch {
        setLinkedIncidents([]);
        setActivityEntries([]);
      }
      try {
        const warnings = await apiFetch<WarningTag[]>(`/dispatch/calls/${selectedCall.id}/warnings`);
        setCallWarnings(Array.isArray(warnings) ? warnings : []);
      } catch { setCallWarnings([]); }
    })();
  }, [selectedCall?.id]);

  // Filter calls (defined before keyboard shortcuts so it's available)
  // Active calls (non-archived) are in `calls`, archived calls are in `archivedCalls`
  const filteredCalls = (filterTab === 'archived' ? archivedCalls : calls).filter((call) => {
    switch (filterTab) {
      case 'pending': return call.status === 'pending';
      case 'active': return ['dispatched', 'enroute', 'onscene'].includes(call.status);
      case 'cleared': return ['cleared', 'closed', 'cancelled'].includes(call.status);
      case 'archived': return true; // archivedCalls already filtered
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
  }).sort((a, b) => {
    // Archive tab: sort by call number ascending (001, 002, 003...)
    if (filterTab === 'archived') {
      return (a.call_number || '').localeCompare(b.call_number || '', undefined, { numeric: true });
    }
    // Active tabs: sort by priority then newest first
    const pOrder: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };
    const pDiff = (pOrder[a.priority] ?? 3) - (pOrder[b.priority] ?? 3);
    if (pDiff !== 0) return pDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

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
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedCall, filteredCalls, fetchData]);

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

  const handleStatusChange = async (callId: string, newStatus: CallStatus) => {
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === callId ? updatedCall : c));
      setSelectedCall((prev) => prev?.id === callId ? updatedCall : prev);
      // Refresh units too since clearing a call frees units
      if (newStatus === 'cleared' || newStatus === 'closed') {
        const unitsRes = await apiFetch<any[]>('/dispatch/units');
        setUnits((Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit));
      }
      // Auto-archive when closed or cancelled to clear the "All" view
      if (newStatus === 'closed' || newStatus === 'cancelled') {
        await handleArchive(callId);
      }
    } catch (err) {
      console.error('Failed to update status:', err);
    }
  };

  // Clear with disposition — shows prompt first, then clears
  const handleClearWithDisposition = (callId: string) => {
    setDispositionPromptCallId(callId);
  };

  const handleConfirmClear = async (disposition: string, createIncident?: boolean) => {
    if (!dispositionPromptCallId) return;
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${dispositionPromptCallId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'cleared', disposition }),
      });
      const updatedCall = mapDbCall(result);
      setCalls((prev) => prev.map((c) => c.id === dispositionPromptCallId ? updatedCall : c));
      setSelectedCall((prev) => prev?.id === dispositionPromptCallId ? updatedCall : prev);
      const unitsRes = await apiFetch<any[]>('/dispatch/units');
      setUnits((Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit));

      // Auto-promote to incident report if checkbox was checked
      if (createIncident) {
        try {
          await apiFetch<any>(`/dispatch/calls/${dispositionPromptCallId}/promote-to-incident`, {
            method: 'POST',
          });
          navigate('/incidents');
        } catch (err) {
          console.error('Failed to promote call to incident:', err);
        }
      }
    } catch (err) {
      console.error('Failed to clear call:', err);
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
    }
  };

  const handleAddNote = async () => {
    if (!selectedCall || !newNote.trim()) return;
    try {
      // Build notes array with the new note appended
      const existingNotes = selectedCall.notes || [];
      const note: CallNote = {
        id: `n-${Date.now()}`,
        author: 'Dispatch',
        text: newNote.trim(),
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
    }
  };

  const handleGenerateIncident = async () => {
    if (!selectedCall) return;
    setIsGenerating(true);
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/generate-incident`, {
        method: 'POST',
      });
      // Navigate to incidents page after successful generation
      navigate('/incidents');
    } catch (err: any) {
      // If incident already exists, show it
      if (err?.incident_id) {
        navigate('/incidents');
      } else {
        console.error('Failed to generate incident:', err);
        addToast(err?.message || err?.error || 'Failed to generate incident report', 'error');
      }
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
    } catch (err) {
      console.error('Failed to assign unit:', err);
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
    } catch (err) {
      console.error('Failed to unassign unit:', err);
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
      setActivityEntries((prev) => prev.map((e) => e.id == entryId ? { ...e, details: editTimelineText.trim() } : e));
      setEditingTimelineId(null);
      setEditTimelineText('');
    } catch (err) {
      console.error('Failed to edit timeline entry:', err);
    }
  };

  const handleDeleteTimeline = async (entryId: string) => {
    if (!selectedCall) return;
    try {
      await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/timeline/${entryId}`, { method: 'DELETE' });
      setActivityEntries((prev) => prev.filter((e) => String(e.id) !== String(entryId)));
    } catch (err) {
      console.error('Failed to delete timeline entry:', err);
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
    }
  };

  const tabCounts = {
    all: calls.length,
    pending: calls.filter((c) => c.status === 'pending').length,
    active: calls.filter((c) => ['dispatched', 'enroute', 'onscene', 'on_hold'].includes(c.status)).length,
    cleared: calls.filter((c) => ['cleared', 'closed', 'cancelled'].includes(c.status)).length,
    archived: archivedCalls.length,
  };

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
        {/* Filter pill tabs */}
        <div className="mobile-pill-tabs">
          {([
            { id: 'all', label: 'All', count: tabCounts.all },
            { id: 'pending', label: 'Pending', count: tabCounts.pending },
            { id: 'active', label: 'Active', count: tabCounts.active },
            { id: 'cleared', label: 'Cleared', count: tabCounts.cleared },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterTab(tab.id as FilterTab)}
              className={`mobile-pill-tab ${filterTab === tab.id ? 'active' : ''}`}
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
            >
              {/* Header row */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  {call.priority === 'P1' && (
                    <AlertTriangle className="w-3.5 h-3.5 text-red-500 animate-emergency-blink" />
                  )}
                  <span className="text-sm font-bold text-green-400 font-mono">{call.call_number}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusBadge status={call.priority} type="priority" size="sm" />
                  <StatusBadge status={call.status} type="call_status" size="sm" />
                </div>
              </div>
              {/* Type */}
              <div className="text-sm font-medium text-brand-400 mb-1">
                {formatIncidentType(call.incident_type)}
              </div>
              {/* Location */}
              <div className="flex items-center gap-1.5 text-xs text-rmpg-300 mb-1.5">
                <MapPin className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{call.location || 'Unknown'}</span>
              </div>
              {/* Footer */}
              <div className="flex items-center justify-between text-xs text-rmpg-400">
                <div className="flex items-center gap-1 font-mono">
                  <Clock className="w-3 h-3" />
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

              {/* Key info fields */}
              <div className="space-y-2">
                <div className="panel-inset p-3">
                  <div className="text-[10px] font-bold uppercase text-rmpg-500 mb-1">Location</div>
                  <div className="text-sm text-rmpg-200">{selectedCall.location || 'Not specified'}</div>
                  {selectedCall.cross_street && (
                    <div className="text-xs text-rmpg-400 mt-0.5">Near: {selectedCall.cross_street}</div>
                  )}
                </div>

                {selectedCall.caller_name && (
                  <div className="panel-inset p-3">
                    <div className="text-[10px] font-bold uppercase text-rmpg-500 mb-1">Caller</div>
                    <div className="text-sm text-rmpg-200">{selectedCall.caller_name}</div>
                    {selectedCall.caller_phone && (
                      <div className="text-xs text-rmpg-400 mt-0.5">{selectedCall.caller_phone}</div>
                    )}
                  </div>
                )}

                {selectedCall.description && (
                  <div className="panel-inset p-3">
                    <div className="text-[10px] font-bold uppercase text-rmpg-500 mb-1">Description</div>
                    <div className="text-sm text-rmpg-200 whitespace-pre-wrap">{selectedCall.description}</div>
                  </div>
                )}

                {/* Timestamps */}
                <div className="panel-inset p-3">
                  <div className="text-[10px] font-bold uppercase text-rmpg-500 mb-2">Timeline</div>
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
                {selectedCall.assigned_units.length > 0 && (
                  <div className="panel-inset p-3">
                    <div className="text-[10px] font-bold uppercase text-rmpg-500 mb-2">Assigned Units</div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedCall.assigned_units.map((unit) => (
                        <span
                          key={unit}
                          className="px-2 py-1 text-xs font-mono font-bold text-green-400 bg-green-900/20 border border-green-700/40"
                        >
                          {unit}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Notes */}
                {selectedCall.notes && selectedCall.notes.length > 0 && (
                  <div className="panel-inset p-3">
                    <div className="text-[10px] font-bold uppercase text-rmpg-500 mb-2">Notes</div>
                    <div className="space-y-2">
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
                  </div>
                )}
              </div>
            </div>
          )}
        </MobileDetailView>

        {/* FAB — New Call */}
        <button
          className="mobile-fab"
          onClick={() => { setTemplateInitialData(undefined); setShowNewCallModal(true); }}
          aria-label="New Call"
        >
          <Plus style={{ width: 24, height: 24 }} />
        </button>

        {/* New Call Modal (shared with desktop) */}
        <NewCallModal
          isOpen={showNewCallModal}
          onClose={() => { setShowNewCallModal(false); setTemplateInitialData(undefined); }}
          onSubmit={handleNewCall}
          properties={propertiesList}
          initialData={templateInitialData}
        />
      </div>
    );
  }

  // ================================================================
  // DESKTOP LAYOUT — Existing 40%/60% split with panels
  // ================================================================
  return (
    <div className="flex flex-col h-full relative">
      {/* Anomaly Alert Banner — real-time intelligence alerts */}
      <AnomalyAlertBanner />

      <div className="flex flex-1 min-h-0">
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
                  background: '#182840',
                  border: '1px solid #484848',
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
                        setTemplateInitialData({
                          incident_type: tpl.incident_type,
                          priority: tpl.priority,
                          description: tpl.description || '',
                          location: tpl.location || tpl.location_address || '',
                          source: tpl.source || 'phone',
                        });
                        setShowTemplateDropdown(false);
                        setShowNewCallModal(true);
                      }}
                      className="w-full flex flex-col items-start px-3 py-2 text-left transition-colors"
                      style={{ fontSize: '11px', color: '#d4d4d4', background: 'transparent', border: 'none', borderRadius: 0 }}
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
        </PanelTitleBar>
        <TabBar
          tabs={[
            { id: 'all', label: 'All', count: tabCounts.all },
            { id: 'pending', label: 'Pending', count: tabCounts.pending },
            { id: 'active', label: 'Active', count: tabCounts.active },
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
                  {selectedCall.risk_score != null && selectedCall.risk_score > 0 && (
                    <span
                      className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold font-mono"
                      style={{
                        color: selectedCall.risk_score >= 80 ? '#ef4444' : selectedCall.risk_score >= 60 ? '#f97316' : selectedCall.risk_score >= 30 ? '#eab308' : '#22c55e',
                        background: selectedCall.risk_score >= 80 ? 'rgba(239,68,68,0.15)' : selectedCall.risk_score >= 60 ? 'rgba(249,115,22,0.15)' : 'rgba(34,197,94,0.1)',
                        border: `1px solid ${selectedCall.risk_score >= 80 ? 'rgba(239,68,68,0.4)' : selectedCall.risk_score >= 60 ? 'rgba(249,115,22,0.4)' : 'rgba(34,197,94,0.3)'}`,
                      }}
                      title={`Automated Risk Assessment: ${selectedCall.risk_score}/100`}
                    >
                      RISK: {selectedCall.risk_score}
                    </span>
                  )}
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
                          const u = units.find(unit => unit.id === uid);
                          return {
                            call_sign: u?.call_sign || uid,
                            officer_name: u?.officer_name || '',
                            badge_number: '',
                            status: u?.status || '',
                          };
                        }),
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

              {/* Detail Body — Scrollable */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col">
                {/* Warning Tags / Caution Alerts */}
                {callWarnings.length > 0 && (
                  <div className="mb-3 flex-shrink-0">
                    <label className="text-[10px] font-bold text-red-400 uppercase tracking-wider flex items-center gap-1 mb-1">
                      <AlertTriangle style={{ width: 10, height: 10 }} /> CAUTION / WARNINGS
                    </label>
                    <WarningTags warnings={callWarnings} />
                  </div>
                )}
                {/* ── CALL INFO SECTION ─── */}
                <div className="grid grid-cols-2 gap-4 mb-4 flex-shrink-0">
                  {/* Left Column: Core Info */}
                  <div className="space-y-2">
                    <div>
                      <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Type:</label>
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
                      <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Location:</label>
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
                      <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Description:</label>
                      {isEditing ? (
                        <textarea className="textarea-dark text-xs mt-0.5" rows={3} value={editData.description} onChange={(e) => updateEditField('description', e.target.value)} />
                      ) : (
                        <p className="text-sm text-rmpg-200 leading-relaxed">{selectedCall.description}</p>
                      )}
                    </div>
                    {isEditing && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Source:</label>
                            <select className="select-dark text-xs mt-0.5" value={editData.source} onChange={(e) => updateEditField('source', e.target.value)}>
                              <option value="phone">Phone</option><option value="radio">Radio</option><option value="walk_in">Walk-In</option>
                              <option value="alarm">Alarm</option><option value="patrol">Patrol</option><option value="online">Online</option>
                              <option value="dispatch">Dispatch</option><option value="other">Other</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Priority:</label>
                            <select className="select-dark text-xs mt-0.5" value={editData.priority} onChange={(e) => updateEditField('priority', e.target.value)}>
                              <option value="P1">P1 - Emergency</option><option value="P2">P2 - Urgent</option>
                              <option value="P3">P3 - Routine</option><option value="P4">P4 - Scheduled</option>
                            </select>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Client:</label>
                            <select className="select-dark text-xs mt-0.5" value={editData.client_id || ''} onChange={(e) => updateEditField('client_id', e.target.value)}>
                              <option value="">— No Client —</option>
                              {clientsList.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Property:</label>
                            <select className="select-dark text-xs mt-0.5" value={editData.property_id || ''} onChange={(e) => updateEditField('property_id', e.target.value)}>
                              <option value="">— No Property —</option>
                              {propertiesList.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Disposition:</label>
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
                        <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Disposition:</label>
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
                      <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Caller:</label>
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
                      <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Timeline:</label>
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
                        <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Assigned Units:</label>
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
                                  assignedUnitIds={selectedCall.assigned_units.map(String)}
                                  onAssign={(unitId) => { handleAssignUnit(unitId); setShowAttachUnitDropdown(false); }}
                                  onCreateUnit={() => { setShowAttachUnitDropdown(false); setShowCreateUnitModal(true); }}
                                  onClose={() => setShowAttachUnitDropdown(false)}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      {selectedCall.assigned_units.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {selectedCall.assigned_units.map((unitIdStr) => {
                            const unitObj = units.find((u) => u.id === unitIdStr);
                            const displayName = unitObj ? unitObj.call_sign : unitIdStr;
                            const statusColor = unitObj ? (
                              unitObj.status === 'onscene' ? '#a855f7' :
                              unitObj.status === 'enroute' ? '#3b82f6' :
                              unitObj.status === 'dispatched' ? '#f59e0b' :
                              '#22c55e'
                            ) : '#888';
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
                                title={unitObj ? `${displayName} — ${unitObj.officer_name || 'Unassigned'} (${(unitObj.status || '').replace(/_/g, ' ')})` : displayName}
                              >
                                <span className="rounded-full flex-shrink-0" style={{ width: 5, height: 5, background: statusColor }} />
                                {displayName}
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
                    </div>
                  </div>
                </div>

                {/* ── MILEAGE (primary unit) ─── */}
                {(isEditing || selectedCall.starting_mileage || selectedCall.ending_mileage) && selectedCall.assigned_units.length > 0 && (
                  <div className="border-t border-rmpg-600 pt-3 mb-3">
                    <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <MapPin className="w-3 h-3" /> Primary Unit Mileage
                    </label>
                    {isEditing ? (
                      <div className="grid grid-cols-2 gap-2 mt-1">
                        <div>
                          <label className="text-[9px] text-rmpg-400">Starting Mileage <span className="text-red-400">*</span></label>
                          <input type="number" step="0.1" min="0" className="input-dark text-xs" placeholder="e.g. 45230" value={editData.starting_mileage} onChange={(e) => updateEditField('starting_mileage', e.target.value)} />
                        </div>
                        <div>
                          <label className="text-[9px] text-rmpg-400">Ending Mileage</label>
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

                {/* ── EXTENDED DETAILS (edit mode shows all, view mode shows populated) ─── */}
                {(isEditing || selectedCall.cross_street || selectedCall.location_building || selectedCall.location_floor || selectedCall.location_room || selectedCall.section_id || selectedCall.zone_id || selectedCall.beat_id) && (
                  <div className="border-t border-rmpg-600 pt-3 mb-3">
                    <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <MapPin className="w-3 h-3" /> Location Details
                    </label>
                    {isEditing ? (
                      <div className="grid grid-cols-7 gap-2 mt-1">
                        <div><label className="text-[9px] text-rmpg-400">Cross Street</label><input type="text" className="input-dark text-xs" value={editData.cross_street} onChange={(e) => updateEditField('cross_street', e.target.value)} /></div>
                        <div><label className="text-[9px] text-rmpg-400">Building</label><input type="text" className="input-dark text-xs" value={editData.location_building} onChange={(e) => updateEditField('location_building', e.target.value)} /></div>
                        <div><label className="text-[9px] text-rmpg-400">Floor</label><input type="text" className="input-dark text-xs" value={editData.location_floor} onChange={(e) => updateEditField('location_floor', e.target.value)} /></div>
                        <div><label className="text-[9px] text-rmpg-400">Room/Suite</label><input type="text" className="input-dark text-xs" value={editData.location_room} onChange={(e) => updateEditField('location_room', e.target.value)} /></div>
                        <div><label className="text-[9px] text-rmpg-400">Section ID</label><input type="text" className="input-dark text-xs" value={editData.section_id} onChange={(e) => updateEditField('section_id', e.target.value)} /></div>
                        <div><label className="text-[9px] text-rmpg-400">Zone ID</label><input type="text" className="input-dark text-xs" value={editData.zone_id} onChange={(e) => updateEditField('zone_id', e.target.value)} /></div>
                        <div><label className="text-[9px] text-rmpg-400">Beat ID</label><input type="text" className="input-dark text-xs" value={editData.beat_id} onChange={(e) => updateEditField('beat_id', e.target.value)} /></div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-xs">
                        {selectedCall.cross_street && <span className="text-rmpg-200"><span className="text-rmpg-400">X-St:</span> {selectedCall.cross_street}</span>}
                        {selectedCall.location_building && <span className="text-rmpg-200"><span className="text-rmpg-400">Bldg:</span> {selectedCall.location_building}</span>}
                        {selectedCall.location_floor && <span className="text-rmpg-200"><span className="text-rmpg-400">Floor:</span> {selectedCall.location_floor}</span>}
                        {selectedCall.location_room && <span className="text-rmpg-200"><span className="text-rmpg-400">Rm:</span> {selectedCall.location_room}</span>}
                        {selectedCall.section_id && <span className="text-rmpg-200"><span className="text-rmpg-400">Sec:</span> {selectedCall.section_id}</span>}
                        {selectedCall.zone_id && <span className="text-rmpg-200"><span className="text-rmpg-400">Zone:</span> {selectedCall.zone_id}</span>}
                        {selectedCall.beat_id && <span className="text-rmpg-200"><span className="text-rmpg-400">Beat:</span> {selectedCall.beat_id}</span>}
                      </div>
                    )}
                  </div>
                )}

                {/* ── SUBJECT/THREAT INFO ─── */}
                {(isEditing || selectedCall.weapons_involved || selectedCall.injuries_reported || selectedCall.num_subjects || selectedCall.subject_description || selectedCall.vehicle_description || selectedCall.direction_of_travel) && (
                  <div className="border-t border-rmpg-600 pt-3 mb-3">
                    <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Shield className="w-3 h-3" /> Subject / Threat Info
                    </label>
                    {isEditing ? (
                      <div className="space-y-2 mt-1">
                        <div className="grid grid-cols-3 gap-2">
                          <div><label className="text-[9px] text-rmpg-400"># Subjects</label><input type="number" min="0" className="input-dark text-xs" value={editData.num_subjects} onChange={(e) => updateEditField('num_subjects', e.target.value)} /></div>
                          <div><label className="text-[9px] text-rmpg-400"># Victims</label><input type="number" min="0" className="input-dark text-xs" value={editData.num_victims} onChange={(e) => updateEditField('num_victims', e.target.value)} /></div>
                          <div><label className="text-[9px] text-rmpg-400">Weapons</label><input type="text" className="input-dark text-xs" value={editData.weapons_involved} onChange={(e) => updateEditField('weapons_involved', e.target.value)} /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div><label className="text-[9px] text-rmpg-400">Subject Description</label><input type="text" className="input-dark text-xs" value={editData.subject_description} onChange={(e) => updateEditField('subject_description', e.target.value)} /></div>
                          <div><label className="text-[9px] text-rmpg-400">Vehicle Description</label><input type="text" className="input-dark text-xs" value={editData.vehicle_description} onChange={(e) => updateEditField('vehicle_description', e.target.value)} /></div>
                        </div>
                        <div><label className="text-[9px] text-rmpg-400">Direction of Travel</label><input type="text" className="input-dark text-xs" value={editData.direction_of_travel} onChange={(e) => updateEditField('direction_of_travel', e.target.value)} /></div>
                        <div className="flex items-center gap-4 mt-1">
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer">
                            <input type="checkbox" checked={editData.injuries_reported} onChange={(e) => updateEditField('injuries_reported', e.target.checked)} className="accent-red-500" />
                            Injuries
                          </label>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-xs">
                        {selectedCall.num_subjects && <span className="text-rmpg-200"><span className="text-rmpg-400">Subjects:</span> {selectedCall.num_subjects}</span>}
                        {selectedCall.num_victims && <span className="text-rmpg-200"><span className="text-rmpg-400">Victims:</span> {selectedCall.num_victims}</span>}
                        {selectedCall.weapons_involved && <span className="text-rmpg-200"><span className="text-rmpg-400">Weapons:</span> {selectedCall.weapons_involved}</span>}
                        {selectedCall.injuries_reported && <span className="text-red-400 font-semibold">INJURIES REPORTED</span>}
                        {selectedCall.subject_description && <span className="text-rmpg-200 basis-full"><span className="text-rmpg-400">Subject:</span> {selectedCall.subject_description}</span>}
                        {selectedCall.vehicle_description && <span className="text-rmpg-200 basis-full"><span className="text-rmpg-400">Vehicle:</span> {selectedCall.vehicle_description}</span>}
                        {selectedCall.direction_of_travel && <span className="text-rmpg-200"><span className="text-rmpg-400">DOT:</span> {selectedCall.direction_of_travel}</span>}
                      </div>
                    )}
                  </div>
                )}

                {/* ── SCENE DETAILS & FLAGS ─── */}
                {(isEditing || selectedCall.scene_safety || selectedCall.weather_conditions || selectedCall.lighting_conditions || selectedCall.alcohol_involved || selectedCall.drugs_involved || selectedCall.domestic_violence || selectedCall.le_notified || selectedCall.damage_estimate || selectedCall.action_taken) && (
                  <div className="border-t border-rmpg-600 pt-3 mb-3">
                    <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Thermometer className="w-3 h-3" /> Scene / Additional
                    </label>
                    {isEditing ? (
                      <div className="space-y-2 mt-1">
                        <div className="grid grid-cols-3 gap-2">
                          <div><label className="text-[9px] text-rmpg-400">Scene Safety</label><input type="text" className="input-dark text-xs" placeholder="Secure, hazardous..." value={editData.scene_safety} onChange={(e) => updateEditField('scene_safety', e.target.value)} /></div>
                          <div><label className="text-[9px] text-rmpg-400">Weather</label><input type="text" className="input-dark text-xs" placeholder="Clear, rain, snow..." value={editData.weather_conditions} onChange={(e) => updateEditField('weather_conditions', e.target.value)} /></div>
                          <div><label className="text-[9px] text-rmpg-400">Lighting</label><input type="text" className="input-dark text-xs" placeholder="Daylight, dark, lit..." value={editData.lighting_conditions} onChange={(e) => updateEditField('lighting_conditions', e.target.value)} /></div>
                        </div>
                        <div className="flex flex-wrap items-center gap-4">
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer"><input type="checkbox" checked={editData.alcohol_involved} onChange={(e) => updateEditField('alcohol_involved', e.target.checked)} className="accent-amber-500" /> Alcohol</label>
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer"><input type="checkbox" checked={editData.drugs_involved} onChange={(e) => updateEditField('drugs_involved', e.target.checked)} className="accent-red-500" /> Drugs</label>
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer"><input type="checkbox" checked={editData.domestic_violence} onChange={(e) => updateEditField('domestic_violence', e.target.checked)} className="accent-red-500" /> DV</label>
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer"><input type="checkbox" checked={editData.supervisor_notified} onChange={(e) => updateEditField('supervisor_notified', e.target.checked)} className="accent-brand-500" /> Supervisor Notified</label>
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer"><input type="checkbox" checked={editData.le_notified} onChange={(e) => updateEditField('le_notified', e.target.checked)} className="accent-brand-500" /> LE Notified</label>
                        </div>
                        {editData.le_notified && (
                          <div className="grid grid-cols-2 gap-2">
                            <div><label className="text-[9px] text-rmpg-400">LE Agency</label><input type="text" className="input-dark text-xs" value={editData.le_agency} onChange={(e) => updateEditField('le_agency', e.target.value)} /></div>
                            <div><label className="text-[9px] text-rmpg-400">LE Case #</label><input type="text" className="input-dark text-xs" value={editData.le_case_number} onChange={(e) => updateEditField('le_case_number', e.target.value)} /></div>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <div><label className="text-[9px] text-rmpg-400">Damage Estimate ($)</label><input type="number" min="0" step="0.01" className="input-dark text-xs" value={editData.damage_estimate} onChange={(e) => updateEditField('damage_estimate', e.target.value)} /></div>
                          <div><label className="text-[9px] text-rmpg-400">Damage Description</label><input type="text" className="input-dark text-xs" value={editData.damage_description} onChange={(e) => updateEditField('damage_description', e.target.value)} /></div>
                        </div>
                        <div><label className="text-[9px] text-rmpg-400">Action Taken</label><textarea className="textarea-dark text-xs" rows={2} value={editData.action_taken} onChange={(e) => updateEditField('action_taken', e.target.value)} /></div>
                        <div><label className="text-[9px] text-rmpg-400">Responding Officer</label><input type="text" className="input-dark text-xs" value={editData.responding_officer} onChange={(e) => updateEditField('responding_officer', e.target.value)} /></div>
                      </div>
                    ) : (
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

                {/* ── ACTIVITY LOG / TIMELINE ─── */}
                <div className="border-t border-rmpg-600 pt-3 mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider flex items-center gap-1.5">
                      <Clock className="w-3 h-3" /> Activity Log
                    </label>
                    <button onClick={() => setShowAddTimeline(!showAddTimeline)} className="toolbar-btn" style={{ padding: '1px 6px', fontSize: '9px' }}>
                      <PlusCircle style={{ width: 9, height: 9 }} /> Add Entry
                    </button>
                  </div>
                  {showAddTimeline && (
                    <div className="flex gap-2 mb-2">
                      <input type="text" className="input-dark flex-1 text-xs" placeholder="New timeline entry..." value={newTimelineText}
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
                              <span className="text-rmpg-200 flex-1">{entry.details || entry.description || '--'}</span>
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

                {/* Notes — fills remaining vertical space */}
                <div className="border-t border-rmpg-600 pt-3 flex-1 flex flex-col min-h-0">
                  <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-2 flex items-center gap-1.5 flex-shrink-0">
                    <MessageSquare className="w-3 h-3" /> Notes
                  </label>
                  <div className="space-y-1.5 mb-3 flex-1 overflow-y-auto">
                    {selectedCall.notes.map((note) => (
                      <div key={note.id} className="flex items-start gap-2 text-xs">
                        <span className="text-rmpg-400 font-mono whitespace-nowrap">{formatTime(note.timestamp)}</span>
                        <span className="text-brand-400 font-semibold whitespace-nowrap">{note.author}:</span>
                        <span className="text-rmpg-200">{note.text}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <input
                      type="text"
                      className="input-dark flex-1 text-xs"
                      placeholder="Add note..."
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddNote(); }}
                    />
                    <button onClick={handleAddNote} className="toolbar-btn toolbar-btn-primary" disabled={!newNote.trim()}>
                      Add
                    </button>
                  </div>
                </div>

                {/* Linked Incidents */}
                {linkedIncidents.length > 0 && (
                  <div className="border-t border-rmpg-600 pt-3 flex-shrink-0">
                    <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
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
                          <span className="text-xs text-rmpg-200 truncate">{inc.type || inc.incident_type || '--'}</span>
                          <span className="text-xs text-rmpg-400">{inc.status || '--'}</span>
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
            <span className="text-[9px] font-mono" style={{ color: '#a0a0a0' }}>
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
      </div>{/* end flex flex-1 min-h-0 wrapper */}

      {/* New Call Modal */}
      <NewCallModal
        isOpen={showNewCallModal}
        onClose={() => { setShowNewCallModal(false); setTemplateInitialData(undefined); }}
        onSubmit={handleNewCall}
        properties={propertiesList}
        clients={clientsList}
        initialData={templateInitialData}
      />


      {/* Create / Edit Unit Modal */}
      {showCreateUnitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={unitModalTitleId} style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="panel-beveled bg-surface-raised" style={{ width: '420px', border: '1px solid #484848' }}>
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
                <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Call Sign *</label>
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
                <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Assigned Officer</label>
                <select
                  className="input-dark text-sm w-full mt-1"
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
                <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Status</label>
                <select
                  className="input-dark text-sm w-full mt-1"
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
                setTemplateInitialData({
                  incident_type: action.incidentType,
                  location: action.location || '',
                });
                setShowNewCallModal(true);
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
    </div>
  );
}

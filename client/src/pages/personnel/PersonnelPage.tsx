import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { Users, Search, X, Clock, AlertTriangle, Loader2, Plus, Archive, Eye, Pencil, Trash2, RotateCcw } from 'lucide-react';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import { useMenuActions } from '../../utils/contextMenuActions';
import { useAuth } from '../../context/AuthContext';
import type {
  Schedule, TimeEntry, Credential, TrainingRecord, TrainingRequirement,
  Deployment, CoverageGap, OfficerEquipment, BodyCamera,
  BodyCamVideo, DashcamEvent, CpgDeviceMapping,
} from '../../types';
import PanelTitleBar from '../../components/PanelTitleBar';
import RmpgLogo from '../../components/RmpgLogo';
import PrintButton from '../../components/PrintButton';
import SplitPanel from '../../components/SplitPanel';
import ScheduleFormModal from '../../components/ScheduleFormModal';
import CredentialFormModal from '../../components/CredentialFormModal';
import type { CredentialFormData } from '../../components/CredentialFormModal';
import ConfirmDialog from '../../components/ConfirmDialog';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';
import { usePersistedTab } from '../../hooks/usePersistedState';
import { useToast } from '../../components/ToastProvider';
import { toastClockLinkWarnings, type ClockLinkFlags } from '../../utils/corporateOpsClient';
import { useIsMobile } from '../../hooks/useIsMobile';
import {
  mapUser, mapSchedule, mapTimeEntry, mapCredential, mapTraining, mapDeployment,
  mapBodyCamera, mapBodyCamVideo,
} from './utils/personnelMappers';
import type { OfficerWithStatus } from './utils/personnelMappers';
import {
  type MainTab, type DetailTab, type ModalMode,
} from './utils/personnelConstants';
import SpillmanModuleGroup from '../../components/spillman/SpillmanModuleGroup';
import type { ModuleGroupSpec } from '../../components/spillman/SpillmanModuleGroup';
import { getWeekMonday } from './utils/personnelFormatters';
import OfficerAvatar from './components/OfficerAvatar';
import CredentialProgressBar from './components/CredentialProgressBar';
import { ROLE_COLORS } from './utils/personnelConstants';
import { toDisplayLabel } from '../../utils/formatters';
import { parseTimestamp, toDatetimeLocalValue, mtDatetimeLocalToUtc } from '../../utils/dateUtils';
import PersonnelDetailPanel from './PersonnelDetailPanel';
import PersonnelDashboard from './PersonnelDashboard';
import DutyBoardTab from './tabs/DutyBoardTab';
import ScheduleTab from './tabs/ScheduleTab';
import TimeAttendanceTab from './tabs/TimeAttendanceTab';
import CredentialsTab from './tabs/CredentialsTab';
import TrainingTab from './tabs/TrainingTab';
import EquipmentTab from './tabs/EquipmentTab';
import DeploymentTab from './tabs/DeploymentTab';
import TrainingFormModal from './modals/TrainingFormModal';
import type { TrainingFormData } from './modals/TrainingFormModal';
import EquipmentFormModal from './modals/EquipmentFormModal';
import type { EquipmentFormData } from './modals/EquipmentFormModal';
import BodyCameraFormModal from './modals/BodyCameraFormModal';
import type { BodyCameraFormData } from './modals/BodyCameraFormModal';
import VideoUploadModal from '../../components/VideoUploadModal';
import VideoPlayer from '../../components/VideoPlayer';
import VideoEditModal from '../../components/VideoEditModal';
import type { BodyCamVideoEditData } from '../../components/VideoEditModal';
import DeploymentFormModal from './modals/DeploymentFormModal';
import type { DeploymentFormData } from './modals/DeploymentFormModal';
import OfficerFormModal from './modals/OfficerFormModal';
import type { OfficerFormData } from './modals/OfficerFormModal';
import TimeEntryEditModal from './modals/TimeEntryEditModal';
import type { TimeEntryEditData } from './modals/TimeEntryEditModal';
import ExportButton from '../../components/ExportButton';
import ClockInOutMileageModal from '../../components/time/ClockInOutMileageModal';

// ============================================================
// Activity entry type (matches backend activity_log)
// ============================================================
interface ActivityEntry {
  id: string;
  action: string;
  details: string;
  entity_type?: string;
  created_at: string;
  user_name?: string;
}

// ============================================================
// RMPG Flex — Personnel Management Page (Redesigned)
// ============================================================

// Several personnel reads (schedules/time/deployments/coverage-gaps) can be
// shadowed by an edge stub that returns a WRAPPER object ({entries:[]},
// {schedules:[]}, {data:[]}, ...) instead of a bare array. Unwrap a single
// array-valued property so a wrapped-but-populated payload still surfaces.
// NOTE: this does NOT recover a stub that returns empty arrays — that requires
// removing the stub's zone route (see PR notes / infra handoff).
function asArray(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    for (const k of ['data', 'results', 'schedules', 'entries', 'deployments', 'gaps', 'items']) {
      if (Array.isArray(raw[k])) return raw[k];
    }
  }
  return [];
}

export default function PersonnelPage() {
  const { addToast } = useToast();
  const isMobile = useIsMobile();
  const { user } = useAuth();

  // Right-click context menu
  const { openMenu } = useContextMenu();
  const cm = useMenuActions();

  // ── URL deep-link contract ──
  // /personnel?officer_id=<id> | ?personnel_id=<id> | ?employee_id=<id>
  // The same id surfaces under three names because operators link in from
  // different surfaces (warrants/incidents use officer_id, HR exports use
  // personnel_id, payroll uses employee_id) — accept all three so external
  // bookmarks survive without forcing the linker to know which we prefer.
  // The list endpoint returns the full row, so deep-link selection only
  // needs to wait for hydration; if the target isn't in the active/archived
  // view we surface a toast and clear the param. Strip the query after
  // resolving so a hard refresh doesn't re-trigger the lookup.
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingOfficerIdRef = useRef<string | null>(
    searchParams.get('officer_id')
      || searchParams.get('personnel_id')
      || searchParams.get('employee_id'),
  );
  // ── Equipment-tab deep-link (?item_id= / ?serial= / ?assigned_to=) ──
  // Lets dispatch paste a court-prep link to a specific equipment row.
  // ?item_id targets a row by its DB id; ?serial and ?assigned_to seed
  // the type-and-search filters (and, when ?serial uniquely resolves,
  // also pin the highlight). The URL is stripped after resolution so a
  // refresh doesn't keep re-triggering the lookup. ?tab= bypasses
  // command-on-fresh-load when the operator wants a specific tab.
  const pendingEquipmentItemIdRef = useRef<string | null>(searchParams.get('item_id'));
  const pendingEquipmentSerialRef = useRef<string | null>(searchParams.get('serial'));
  const pendingEquipmentAssignedToRef = useRef<string | null>(searchParams.get('assigned_to'));
  const [resolvedEquipmentItemId, setResolvedEquipmentItemId] = useState<string | null>(null);
  const [equipmentInitialSearch, setEquipmentInitialSearch] = useState<string | undefined>(undefined);
  // Snapshot URL params on mount only — once we land on a tab the URL
  // stays clean, so re-reading on every render would re-seed an empty
  // search every time the operator clicks elsewhere on the page.
  const initialUrlTabRef = useRef<string | null>(searchParams.get('tab'));

  // Tab state — user-scoped so the tab a supervisor lands on doesn't leak
  // to a shared workstation's next officer (was the only per-page key with
  // no user suffix; the modal form-draft keys are auto-discarded on
  // submit so they don't carry the same privacy footprint).
  const tabKey = user?.id ? `rmpg_personnel_tab_${user.id}` : 'rmpg_personnel_tab';
  const [activeTab, setActiveTab] = usePersistedTab(
    tabKey,
    'command' as MainTab,
    ['command', 'roster', 'duty_board', 'schedule', 'time', 'credentials', 'training', 'equipment', 'deployment'] as const,
  );
  // First-paint URL override: ?tab=equipment / ?item_id=… implicitly
  // routes to the Equipment tab. Apply once on mount so a hard-coded
  // deep-link beats the persisted tab without fighting it on every
  // subsequent re-render. Equipment-only signals (item_id/serial/
  // assigned_to) imply tab=equipment for the linker's convenience.
  useEffect(() => {
    const raw = initialUrlTabRef.current;
    const implicitEquipment = pendingEquipmentItemIdRef.current
      || pendingEquipmentSerialRef.current
      || pendingEquipmentAssignedToRef.current;
    const target = (raw === 'equipment' || implicitEquipment) ? 'equipment' : raw;
    if (!target) return;
    const allowed: MainTab[] = ['command', 'roster', 'duty_board', 'schedule', 'time', 'credentials', 'training', 'equipment', 'deployment'];
    if ((allowed as string[]).includes(target)) {
      setActiveTab(target as MainTab);
      initialUrlTabRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [detailTab, setDetailTab] = useState<DetailTab>('profile');
  const [searchQuery, setSearchQuery] = useState('');

  // Core data
  const [officers, setOfficers] = useState<OfficerWithStatus[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [officerActivity, setOfficerActivity] = useState<ActivityEntry[]>([]);

  // New feature data
  const [training, setTraining] = useState<TrainingRecord[]>([]);
  const [trainingReqs, setTrainingReqs] = useState<TrainingRequirement[]>([]);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [deploymentsLoading, setDeploymentsLoading] = useState(false);
  const [coverageGaps, setCoverageGaps] = useState<CoverageGap[]>([]);

  // Equipment data
  const [equipment, setEquipment] = useState<OfficerEquipment[]>([]);
  const [equipmentLoading, setEquipmentLoading] = useState(false);

  // Body camera data
  const [bodyCameras, setBodyCameras] = useState<BodyCamera[]>([]);
  const [bodyCamVideos, setBodyCamVideos] = useState<BodyCamVideo[]>([]);
  const [bodyCamerasLoading, setBodyCamerasLoading] = useState(false);
  const [bodyCameraEditData, setBodyCameraEditData] = useState<(Partial<BodyCameraFormData> & { id?: number }) | undefined>(undefined);
  const [bodyCameraModalMode, setBodyCameraModalMode] = useState<'create' | 'edit'>('create');
  const [playingVideo, setPlayingVideo] = useState<BodyCamVideo | null>(null);
  const [editingVideo, setEditingVideo] = useState<BodyCamVideo | null>(null);

  // Per-officer dashcam data (fetched on detail-tab switch)
  const [officerDashcamEvents, setOfficerDashcamEvents] = useState<DashcamEvent[]>([]);
  const [officerDeviceMapping, setOfficerDeviceMapping] = useState<CpgDeviceMapping | null>(null);
  const [officerDashcamLoading, setOfficerDashcamLoading] = useState(false);

  // All properties from the database (for deployment/schedule dropdowns)
  const [allProperties, setAllProperties] = useState<{ id: string; name: string }[]>([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOfficer, setSelectedOfficer] = useState<OfficerWithStatus | null>(null);
  const [weekMonday, setWeekMonday] = useState<Date>(() => getWeekMonday(new Date()));

  // Modal state
  const [modal, setModal] = useState<ModalMode>('none');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [credentialEditData, setCredentialEditData] = useState<(Partial<CredentialFormData> & { id?: string }) | undefined>(undefined);
  const [credentialModalMode, setCredentialModalMode] = useState<'create' | 'edit'>('create');
  const [trainingEditData, setTrainingEditData] = useState<(Partial<TrainingFormData> & { id?: string }) | undefined>(undefined);
  const [trainingModalMode, setTrainingModalMode] = useState<'create' | 'edit'>('create');
  const [equipmentEditData, setEquipmentEditData] = useState<(Partial<EquipmentFormData> & { id?: string }) | undefined>(undefined);
  const [equipmentModalMode, setEquipmentModalMode] = useState<'create' | 'edit'>('create');
  const [deploymentEditData, setDeploymentEditData] = useState<(Partial<DeploymentFormData> & { id?: string }) | undefined>(undefined);
  const [deploymentModalMode, setDeploymentModalMode] = useState<'create' | 'edit'>('create');

  // Officer CRUD state
  const [officerEditData, setOfficerEditData] = useState<(Partial<OfficerFormData> & { id?: string }) | undefined>(undefined);
  const [officerModalMode, setOfficerModalMode] = useState<'create' | 'edit'>('create');
  const [deleteTarget, setDeleteTarget] = useState<OfficerWithStatus | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Time entry edit state
  const [editingTimeEntry, setEditingTimeEntry] = useState<TimeEntry | null>(null);

  // Archive state
  const [showArchived, setShowArchived] = useState(false);

  // Clock In / Clock Out Mileage Modal prompt state
  const [clockMileagePrompt, setClockMileagePrompt] = useState<{ mode: 'in' | 'out'; officerId: string } | null>(null);

  // Centralized destructive-action ConfirmDialog state — replaces the six
  // window.confirm() prompts that scattered through the delete handlers.
  // Each row that the user picks "delete" on stores its onConfirm here;
  // the dialog renders once at the bottom of the page. Single state →
  // single Esc target, single overlay, single audit point.
  interface DeleteConfirm {
    title: string;
    message: string;
    onConfirm: () => Promise<void> | void;
  }
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirm | null>(null);
  const [deleteConfirmLoading, setDeleteConfirmLoading] = useState(false);
  const runDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    setDeleteConfirmLoading(true);
    try {
      await deleteConfirm.onConfirm();
    } finally {
      setDeleteConfirmLoading(false);
      setDeleteConfirm(null);
    }
  };

  // ----------------------------------------------------------
  // Data Fetching
  // ----------------------------------------------------------

  const fetchCoreData = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [usersRes, schedulesRes, timeRes, credentialsRes, propsRes] = await Promise.allSettled([
        apiFetch<any[]>(`/personnel?status=${showArchived ? 'inactive' : 'active'}`),
        apiFetch<any[]>('/personnel/schedules'),
        apiFetch<any[]>('/personnel/time'),
        apiFetch<any[]>('/personnel/credentials'),
        apiFetch<any[]>('/records/properties'),
      ]);

      const usersRaw = usersRes.status === 'fulfilled' ? usersRes.value : [];
      const schedulesRaw = schedulesRes.status === 'fulfilled' ? schedulesRes.value : [];
      const timeRaw = timeRes.status === 'fulfilled' ? timeRes.value : [];
      const credentialsRaw = credentialsRes.status === 'fulfilled' ? credentialsRes.value : [];
      const propsRaw = propsRes.status === 'fulfilled' ? propsRes.value : [];

      // Guard: ensure all values are arrays (asArray also unwraps stub wrapper
      // objects like {schedules:[]} / {entries:[]} for the shadow-prone reads).
      setOfficers((Array.isArray(usersRaw) ? usersRaw : []).map(mapUser));
      setSchedules(asArray(schedulesRaw).map(mapSchedule));
      setTimeEntries(asArray(timeRaw).map(mapTimeEntry));
      setCredentials(asArray(credentialsRaw).map(mapCredential));
      setAllProperties((Array.isArray(propsRaw) ? propsRaw : []).map((p: any) => ({ id: String(p.id), name: p.name })));

      // If the primary users call failed, show an error (only on non-silent loads)
      if (!silent && usersRes.status === 'rejected') {
        const err = usersRes.reason;
        setError(err instanceof Error ? err.message : 'Failed to load personnel data');
      }
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Failed to load personnel data');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => { fetchCoreData(); }, [fetchCoreData]);

  // Live sync — silent refresh to avoid unmounting content and stealing input focus
  const silentRefresh = useCallback(() => fetchCoreData({ silent: true }), [fetchCoreData]);
  useLiveSync('personnel', silentRefresh);

  // ── /personnel?officer_id=<id> deep-link auto-select ──
  // Once the officer roster hydrates, find the target by id and select it.
  // If the row isn't in the active view (e.g. archived) flip to the
  // archives view and let the next hydration pass resolve. Strip the
  // param either way so a refresh doesn't re-trigger the lookup.
  useEffect(() => {
    const target = pendingOfficerIdRef.current;
    if (!target || loading) return;
    const hit = officers.find(o => String(o.id) === String(target));
    if (hit) {
      pendingOfficerIdRef.current = null;
      setActiveTab('roster');
      setSelectedOfficer(hit);
      setDetailTab('profile');
      const next = new URLSearchParams(searchParams);
      next.delete('officer_id');
      next.delete('personnel_id');
      next.delete('employee_id');
      setSearchParams(next, { replace: true });
      return;
    }
    // Wait for hydration before deciding it's missing.
    if (officers.length === 0) return;
    // Not in the current (active or archived) view — flip the toggle
    // and let the next fetch carry the archived rows. If it's already
    // showing archives, the target genuinely doesn't exist.
    if (!showArchived) {
      setShowArchived(true);
      // Keep the ref so the next render with archived officers can match.
      return;
    }
    pendingOfficerIdRef.current = null;
    addToast(`Officer ${target} not found`, 'warning');
    const next = new URLSearchParams(searchParams);
    next.delete('officer_id');
    next.delete('personnel_id');
    next.delete('employee_id');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officers, loading, showArchived]);

  // ── Equipment deep-link resolver ──
  // Runs once the equipment list hydrates. Validates the target id /
  // serial / officer name actually resolves to a row; if so, sets the
  // tab + the resolved highlight id + seeds the search filter. Strips
  // the URL params after either success (so a refresh keeps the row
  // selected via persistence) or a clear "not found" toast.
  useEffect(() => {
    const itemId = pendingEquipmentItemIdRef.current;
    const serial = pendingEquipmentSerialRef.current;
    const assignedTo = pendingEquipmentAssignedToRef.current;
    if (!itemId && !serial && !assignedTo) return;
    // Wait for equipment to hydrate. The lazy-loader above triggers the
    // fetch on tab switch — when the deep-link forces tab=equipment on
    // mount that fetch fires immediately.
    if (activeTab !== 'equipment') return;
    if (equipmentLoading) return;
    if (equipment.length === 0) return; // still hydrating or genuinely empty

    let resolvedId: string | null = null;
    let seedSearch: string | undefined;
    if (itemId) {
      const hit = equipment.find(e => String(e.id) === String(itemId));
      if (hit) { resolvedId = hit.id; }
    }
    if (!resolvedId && serial) {
      const needle = serial.trim().toLowerCase();
      const hit = equipment.find(e => (e.serial_number || '').toLowerCase() === needle
        || (e.asset_tag || '').toLowerCase() === needle);
      if (hit) { resolvedId = hit.id; }
      seedSearch = serial;
    }
    if (!resolvedId && assignedTo) {
      // Match by officer id or by officer_name substring — both surface in
      // the equipment row JOIN. We don't pick a "highlight" row here on
      // purpose: an officer may have multiple items.
      seedSearch = assignedTo;
    }

    if (seedSearch !== undefined) setEquipmentInitialSearch(seedSearch);
    setResolvedEquipmentItemId(resolvedId);

    // Surface "not found" only when the operator gave us a precise
    // identifier (id or serial) — assigned_to is a filter seed, not a
    // single-row pin, so "no match" there just means "filter empty".
    if (!resolvedId && (itemId || serial)) {
      addToast(`Equipment ${itemId || serial} not found`, 'warning');
    }

    // Strip the URL params either way so a refresh doesn't re-trigger.
    pendingEquipmentItemIdRef.current = null;
    pendingEquipmentSerialRef.current = null;
    pendingEquipmentAssignedToRef.current = null;
    const next = new URLSearchParams(searchParams);
    next.delete('item_id');
    next.delete('serial');
    next.delete('assigned_to');
    next.delete('tab');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipment, equipmentLoading, activeTab]);

  // Lazy-load tab data
  useEffect(() => {
    let cancelled = false;
    // Command dashboard needs training + deployments + coverage gaps to populate
    // its alert/chart widgets. Each guard is independent so a tab visited earlier
    // doesn't force a refetch here.
    if (activeTab === 'command') {
      if (training.length === 0 && !trainingLoading) {
        setTrainingLoading(true);
        apiFetch<any[]>('/personnel/training')
          .then(raw => { if (!cancelled) setTraining((Array.isArray(raw) ? raw : []).map(mapTraining)); })
          .catch(() => { /* dashboard degrades gracefully */ })
          .finally(() => { if (!cancelled) setTrainingLoading(false); });
      }
      if (deployments.length === 0 && !deploymentsLoading) {
        setDeploymentsLoading(true);
        Promise.all([
          apiFetch<any[]>('/personnel/deployments'),
          apiFetch<any[]>('/personnel/coverage-gaps'),
        ])
          .then(([dRaw, gaps]) => {
            if (!cancelled) {
              setDeployments(asArray(dRaw).map(mapDeployment));
              setCoverageGaps(asArray(gaps));
            }
          })
          .catch(() => { /* dashboard degrades gracefully */ })
          .finally(() => { if (!cancelled) setDeploymentsLoading(false); });
      }
    }
    if (activeTab === 'training' && training.length === 0 && !trainingLoading) {
      setTrainingLoading(true);
      Promise.all([
        apiFetch<any[]>('/personnel/training'),
        apiFetch<any[]>('/personnel/training-requirements'),
      ])
        .then(([tRaw, rRaw]) => {
          if (!cancelled) {
            setTraining((Array.isArray(tRaw) ? tRaw : []).map(mapTraining));
            setTrainingReqs(Array.isArray(rRaw) ? rRaw : []);
          }
        })
        .catch(() => { if (!cancelled) addToast('Failed to load training data', 'error'); })
        .finally(() => { if (!cancelled) setTrainingLoading(false); });
    }
    if (activeTab === 'deployment' && deployments.length === 0 && !deploymentsLoading) {
      setDeploymentsLoading(true);
      Promise.all([
        apiFetch<any[]>('/personnel/deployments'),
        apiFetch<any[]>('/personnel/coverage-gaps'),
        apiFetch<any[]>('/records/properties'),
      ])
        .then(([dRaw, gaps, propsRaw]) => {
          if (!cancelled) {
            setDeployments((Array.isArray(dRaw) ? dRaw : []).map(mapDeployment));
            setCoverageGaps(Array.isArray(gaps) ? gaps : []);
            setAllProperties((Array.isArray(propsRaw) ? propsRaw : []).map((p: any) => ({ id: String(p.id), name: p.name })));
          }
        })
        .catch(() => { if (!cancelled) addToast('Failed to load deployment data', 'error'); })
        .finally(() => { if (!cancelled) setDeploymentsLoading(false); });
    }
    if (activeTab === 'equipment' && equipment.length === 0 && !equipmentLoading) {
      setEquipmentLoading(true);
      apiFetch<any[]>('/personnel/equipment')
        .then(raw => { if (!cancelled) setEquipment(Array.isArray(raw) ? raw : []); })
        .catch(() => { if (!cancelled) addToast('Failed to load equipment data', 'error'); })
        .finally(() => { if (!cancelled) setEquipmentLoading(false); });
    }
    return () => { cancelled = true; };
  }, [activeTab]);

  // Reset per-officer caches when switching officers. The detail-tab
  // fetches below gate on `xxx.length === 0`; without this reset,
  // switching from Officer A to Officer B would show Officer A's
  // training/equipment/body_cameras/deployments data because the cached
  // arrays are non-empty. The dashcam-events / device-mapping refs are
  // also cleared so a brief flash of A's mapping doesn't show on B.
  useEffect(() => {
    if (!selectedOfficer) return;
    setTraining([]);
    setEquipment([]);
    setBodyCameras([]);
    setBodyCamVideos([]);
    setDeployments([]);
    setOfficerActivity([]);
    setOfficerDashcamEvents([]);
    setOfficerDeviceMapping(null);
  }, [selectedOfficer?.id]);

  // Lazy-load detail tab data
  useEffect(() => {
    if (!selectedOfficer) return;
    let cancelled = false;
    if (detailTab === 'activity') {
      apiFetch<ActivityEntry[]>(`/personnel/activity/${selectedOfficer.id}?limit=50`)
        .then(raw => { if (!cancelled) setOfficerActivity(Array.isArray(raw) ? raw : []); })
        .catch(() => { if (!cancelled) setOfficerActivity([]); });
    }
    if (detailTab === 'training' && training.length === 0 && !trainingLoading) {
      setTrainingLoading(true);
      apiFetch<any[]>('/personnel/training')
        .then(raw => { if (!cancelled) setTraining((Array.isArray(raw) ? raw : []).map(mapTraining)); })
        .catch(() => { if (!cancelled) addToast('Failed to load training', 'error'); })
        .finally(() => { if (!cancelled) setTrainingLoading(false); });
    }
    if (detailTab === 'equipment' && equipment.length === 0 && !equipmentLoading) {
      setEquipmentLoading(true);
      apiFetch<any[]>('/personnel/equipment')
        .then(raw => { if (!cancelled) setEquipment(Array.isArray(raw) ? raw : []); })
        .catch(() => { if (!cancelled) addToast('Failed to load equipment', 'error'); })
        .finally(() => { if (!cancelled) setEquipmentLoading(false); });
    }
    if (detailTab === 'body_cameras' && bodyCameras.length === 0 && !bodyCamerasLoading) {
      setBodyCamerasLoading(true);
      Promise.all([
        apiFetch<any[]>('/personnel/body-cameras'),
        apiFetch<any[]>('/personnel/bodycam-videos'),
      ])
        .then(([cams, vids]) => {
          if (!cancelled) {
            setBodyCameras((Array.isArray(cams) ? cams : []).map(mapBodyCamera));
            setBodyCamVideos((Array.isArray(vids) ? vids : []).map(mapBodyCamVideo));
          }
        })
        .catch(() => { if (!cancelled) addToast('Failed to load body cameras', 'error'); })
        .finally(() => { if (!cancelled) setBodyCamerasLoading(false); });
    }
    if (detailTab === 'dash_cameras') {
      setOfficerDashcamLoading(true);
      // Fetch per-officer dashcam events and find their device mapping
      Promise.all([
        apiFetch<any[]>(`/clearpathgps/dashcam-events/by-officer/${selectedOfficer.id}`),
        apiFetch<any[]>('/clearpathgps/mappings'),
      ])
        .then(([events, mappings]) => {
          if (!cancelled) {
            setOfficerDashcamEvents(Array.isArray(events) ? events : []);
            // Find the mapping for this officer's unit. Match by officer_id
            // (stable) — the previous name-based match silently failed for
            // officers with middle names, suffixes, or whitespace differences.
            // Falls back to a trimmed-name match for older mappings that
            // haven't had officer_id backfilled yet.
            const allMappings: CpgDeviceMapping[] = Array.isArray(mappings) ? mappings : [];
            const fullName = `${selectedOfficer.first_name} ${selectedOfficer.last_name}`.trim();
            const match = allMappings.find(m => {
              if (m.officer_id && String(m.officer_id) === String(selectedOfficer.id)) return true;
              if (m.officer_name && m.officer_name.trim() === fullName) return true;
              return false;
            });
            setOfficerDeviceMapping(match || null);
          }
        })
        .catch(() => { if (!cancelled) addToast('Failed to load dash camera data', 'error'); })
        .finally(() => { if (!cancelled) setOfficerDashcamLoading(false); });
    }
    if (detailTab === 'deployment' && deployments.length === 0 && !deploymentsLoading) {
      setDeploymentsLoading(true);
      apiFetch<any[]>('/personnel/deployments')
        .then(raw => { if (!cancelled) setDeployments((Array.isArray(raw) ? raw : []).map(mapDeployment)); })
        .catch(() => { if (!cancelled) addToast('Failed to load deployments', 'error'); })
        .finally(() => { if (!cancelled) setDeploymentsLoading(false); });
    }
    return () => { cancelled = true; };
  }, [selectedOfficer?.id, detailTab]);

  // ----------------------------------------------------------
  // Derived Data
  // ----------------------------------------------------------

  const filteredOfficers = officers.filter(o => {
    // Active view hides archived (inactive/terminated) officers; the Archives
    // view shows only them. Enforced client-side off is_active because the
    // list endpoint stays on legacy and may not honor the status query param.
    if (showArchived ? o.is_active : !o.is_active) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      `${o.first_name} ${o.last_name}`.toLowerCase().includes(q) ||
      (o.badge_number || '').toLowerCase().includes(q) ||
      (o.rank || '').toLowerCase().includes(q) ||
      (o.department || '').toLowerCase().includes(q) ||
      o.role.toLowerCase().includes(q)
    );
  });

  const onDutyCount = officers.filter(o => o.status === 'on_duty').length;
  const offDutyCount = officers.filter(o => o.status === 'off_duty').length;
  const clockedInCount = timeEntries.filter(t => t.status === 'clocked_in').length;
  const expiringCreds = credentials.filter(c => c.status === 'expiring_soon' || c.status === 'expired').length;
  const totalHoursThisPeriod = timeEntries.reduce((s, t) => s + (t.total_hours || 0), 0);

  // Officer / property dropdown options
  const officerOptions = officers.map(o => ({
    id: o.id,
    name: `${o.first_name} ${o.last_name}${o.badge_number ? ` (${o.badge_number})` : ''}`,
  }));

  // Use full properties list from DB when available; fallback to schedule/deployment extraction
  const propertyOptions: { id: string; name: string }[] = allProperties.length > 0
    ? allProperties
    : (() => {
        const opts: { id: string; name: string }[] = [];
        const seen = new Set<string>();
        [...schedules, ...deployments].forEach((s: any) => {
          if (s.property_id && s.property_name && !seen.has(s.property_id)) {
            seen.add(s.property_id);
            opts.push({ id: s.property_id, name: s.property_name });
          }
        });
        return opts;
      })();

  // ----------------------------------------------------------
  // Handlers
  // ----------------------------------------------------------

  const handleScheduleSubmit = async (data: any) => {
    setIsSubmitting(true);
    try {
      await apiFetch('/personnel/schedules', { method: 'POST', body: JSON.stringify(data) });
      setModal('none');
      const raw = await apiFetch<any[]>('/personnel/schedules');
      setSchedules((Array.isArray(raw) ? raw : []).map(mapSchedule));
      addToast('Schedule created', 'success');
    } catch (err) {
      addToast('Failed to create schedule', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleScheduleDelete = (scheduleId: string) => {
    setDeleteConfirm({
      title: 'Delete Schedule',
      message: 'Delete this schedule? This cannot be undone.',
      onConfirm: async () => {
        try {
          await apiFetch(`/personnel/schedules/${scheduleId}`, { method: 'DELETE' });
          const raw = await apiFetch<any[]>('/personnel/schedules');
          setSchedules((Array.isArray(raw) ? raw : []).map(mapSchedule));
          addToast('Schedule deleted', 'success');
        } catch {
          addToast('Failed to delete schedule', 'error');
        }
      },
    });
  };

  const handleCredentialSubmit = async (data: CredentialFormData) => {
    setIsSubmitting(true);
    try {
      if (credentialModalMode === 'edit' && credentialEditData?.id) {
        await apiFetch(`/personnel/credentials/${credentialEditData.id}`, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        await apiFetch('/personnel/credentials', { method: 'POST', body: JSON.stringify(data) });
      }
      setModal('none');
      setCredentialEditData(undefined);
      const raw = await apiFetch<any[]>('/personnel/credentials');
      setCredentials((Array.isArray(raw) ? raw : []).map(mapCredential));
      addToast('Credential saved', 'success');
    } catch {
      addToast('Failed to save credential', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCredentialDelete = (credId: string) => {
    setDeleteConfirm({
      title: 'Delete Credential',
      message: 'Delete this credential? This cannot be undone.',
      onConfirm: async () => {
        try {
          await apiFetch(`/personnel/credentials/${credId}`, { method: 'DELETE' });
          const raw = await apiFetch<any[]>('/personnel/credentials');
          setCredentials((Array.isArray(raw) ? raw : []).map(mapCredential));
          addToast('Credential deleted', 'success');
        } catch {
          addToast('Failed to delete credential', 'error');
        }
      },
    });
  };

  const openEditCredential = (cred: Credential) => {
    setCredentialEditData({
      id: cred.id, officer_id: cred.officer_id, credential_type: cred.type,
      credential_number: cred.credential_number, issuing_authority: cred.issuing_authority,
      issued_date: cred.issued_date, expiry_date: cred.expiry_date, notes: cred.notes || '',
    });
    setCredentialModalMode('edit');
    setModal('edit_credential');
  };

  const openAddCredential = (officerId?: string) => {
    setCredentialEditData(officerId ? { officer_id: officerId } : undefined);
    setCredentialModalMode('create');
    setModal('new_credential');
  };

  const handleTrainingSubmit = async (data: TrainingFormData) => {
    setIsSubmitting(true);
    try {
      const payload = { ...data, hours: parseFloat(data.hours) || 0, score: data.score ? parseFloat(data.score) : undefined };
      if (trainingModalMode === 'edit' && trainingEditData?.id) {
        await apiFetch(`/personnel/training/${trainingEditData.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/personnel/training', { method: 'POST', body: JSON.stringify(payload) });
      }
      setModal('none');
      setTrainingEditData(undefined);
      const raw = await apiFetch<any[]>('/personnel/training');
      setTraining((Array.isArray(raw) ? raw : []).map(mapTraining));
      addToast('Training record saved', 'success');
    } catch (err) {
      addToast('Failed to save training record', 'error');
      throw err; // let the modal know the save failed so it preserves the draft
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAddTraining = (officerId?: string) => {
    setTrainingEditData(officerId ? { officer_id: officerId } : undefined);
    setTrainingModalMode('create');
    setModal('new_training');
  };

  // ----------------------------------------------------------
  // Equipment Handlers
  // ----------------------------------------------------------

  const handleEquipmentSubmit = async (data: EquipmentFormData) => {
    setIsSubmitting(true);
    try {
      if (equipmentModalMode === 'edit' && equipmentEditData?.id) {
        await apiFetch(`/personnel/equipment/${equipmentEditData.id}`, { method: 'PUT', body: JSON.stringify(data) });
      } else {
        await apiFetch(`/personnel/${data.officer_id}/equipment`, { method: 'POST', body: JSON.stringify(data) });
      }
      setModal('none');
      setEquipmentEditData(undefined);
      const raw = await apiFetch<any[]>('/personnel/equipment');
      setEquipment(Array.isArray(raw) ? raw : []);
      addToast('Equipment record saved', 'success');
    } catch (err) {
      addToast('Failed to save equipment record', 'error');
      throw err; // let the modal know the save failed so it preserves the draft
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEquipmentDelete = (equipId: string) => {
    setDeleteConfirm({
      title: 'Delete Equipment',
      message: 'Delete this equipment record? This cannot be undone.',
      onConfirm: async () => {
        try {
          await apiFetch(`/personnel/equipment/${equipId}`, { method: 'DELETE' });
          const raw = await apiFetch<any[]>('/personnel/equipment');
          setEquipment(Array.isArray(raw) ? raw : []);
          addToast('Equipment deleted', 'success');
        } catch {
          addToast('Failed to delete equipment', 'error');
        }
      },
    });
  };

  const openEditEquipment = (eq: OfficerEquipment) => {
    setEquipmentEditData({
      id: eq.id, officer_id: eq.officer_id, equipment_type: eq.equipment_type,
      make: eq.make || '', model: eq.model || '', serial_number: eq.serial_number || '',
      asset_tag: eq.asset_tag || '', condition: eq.condition, status: eq.status,
      issued_date: eq.issued_date || '', returned_date: eq.returned_date || '', notes: eq.notes || '',
    });
    setEquipmentModalMode('edit');
    setModal('edit_equipment');
  };

  const openAddEquipment = (officerId?: string) => {
    setEquipmentEditData(officerId ? { officer_id: officerId } : undefined);
    setEquipmentModalMode('create');
    setModal('new_equipment');
  };

  // ----------------------------------------------------------
  // Body Camera Handlers
  // ----------------------------------------------------------

  const refreshBodyCameras = async () => {
    const [cams, vids] = await Promise.all([
      apiFetch<any[]>('/personnel/body-cameras'),
      apiFetch<any[]>('/personnel/bodycam-videos'),
    ]);
    setBodyCameras((Array.isArray(cams) ? cams : []).map(mapBodyCamera));
    setBodyCamVideos((Array.isArray(vids) ? vids : []).map(mapBodyCamVideo));
  };

  const handleBodyCameraSubmit = async (data: BodyCameraFormData) => {
    setIsSubmitting(true);
    try {
      const payload = { ...data, storage_capacity_gb: parseInt(data.storage_capacity_gb, 10) || 32 };
      if (bodyCameraModalMode === 'edit' && bodyCameraEditData?.id) {
        await apiFetch(`/personnel/body-cameras/${bodyCameraEditData.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/personnel/body-cameras', { method: 'POST', body: JSON.stringify(payload) });
      }
      setModal('none');
      setBodyCameraEditData(undefined);
      await refreshBodyCameras();
      addToast('Body camera saved', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to save body camera', 'error');
      throw err; // let the modal know the save failed so it preserves the draft
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBodyCameraDelete = (camId: number) => {
    setDeleteConfirm({
      title: 'Delete Body Camera',
      message: 'Delete this body camera record? This cannot be undone.',
      onConfirm: async () => {
        try {
          await apiFetch(`/personnel/body-cameras/${camId}`, { method: 'DELETE' });
          await refreshBodyCameras();
          addToast('Body camera deleted', 'success');
        } catch {
          addToast('Failed to delete body camera', 'error');
        }
      },
    });
  };

  const openEditBodyCamera = (cam: BodyCamera) => {
    setBodyCameraEditData({
      id: cam.id, officer_id: String(cam.officer_id), camera_id: cam.camera_id,
      make: cam.make || '', model: cam.model || '', firmware_version: cam.firmware_version || '',
      storage_capacity_gb: String(cam.storage_capacity_gb || 32),
      status: cam.status, condition: cam.condition || 'good',
      assigned_at: cam.assigned_at || '', returned_at: cam.returned_at || '', notes: cam.notes || '',
    });
    setBodyCameraModalMode('edit');
    setModal('edit_body_camera');
  };

  const openAddBodyCamera = (officerId?: string) => {
    setBodyCameraEditData(officerId ? { officer_id: officerId } : undefined);
    setBodyCameraModalMode('create');
    setModal('new_body_camera');
  };

  const handleVideoDelete = (videoId: number) => {
    setDeleteConfirm({
      title: 'Delete Video',
      message: 'Delete this body-cam video? This cannot be undone — chain-of-custody record will note the deletion.',
      onConfirm: async () => {
        try {
          await apiFetch(`/personnel/bodycam-videos/${videoId}`, { method: 'DELETE' });
          await refreshBodyCameras();
          addToast('Video deleted', 'success');
        } catch {
          addToast('Failed to delete video', 'error');
        }
      },
    });
  };

  const handleVideoEdit = async (videoId: number, data: BodyCamVideoEditData) => {
    setIsSubmitting(true);
    try {
      // Capture original values to detect overlay-relevant changes
      const original = editingVideo;
      await apiFetch(`/personnel/bodycam-videos/${videoId}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...data,
          recorded_at: data.recorded_at ? mtDatetimeLocalToUtc(data.recorded_at) : data.recorded_at,
        }),
      });
      await refreshBodyCameras();
      setEditingVideo(null);
      addToast('Video updated', 'success');
      // Auto-reprocess overlay if overlay-affecting fields changed
      if (original && original.overlay_status === 'complete') {
        const overlayChanged =
          original.classification !== data.classification ||
          (original.case_number || '') !== data.case_number ||
          toDatetimeLocalValue(original.recorded_at) !== data.recorded_at;
        if (overlayChanged) {
          try {
            await apiFetch(`/personnel/bodycam-videos/${videoId}/reprocess`, { method: 'POST' });
            await refreshBodyCameras();
            addToast('Overlay reprocessing started', 'info');
          } catch {
            addToast('Video saved but overlay reprocess failed', 'warning');
          }
        }
      }
    } catch {
      addToast('Failed to update video', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeploymentSubmit = async (data: DeploymentFormData) => {
    setIsSubmitting(true);
    try {
      const payload = { ...data, hours_per_week: data.hours_per_week ? parseFloat(data.hours_per_week) : undefined };
      if (deploymentModalMode === 'edit' && deploymentEditData?.id) {
        await apiFetch(`/personnel/deployments/${deploymentEditData.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/personnel/deployments', { method: 'POST', body: JSON.stringify(payload) });
      }
      setModal('none');
      setDeploymentEditData(undefined);
      const [dRaw, gaps] = await Promise.all([
        apiFetch<any[]>('/personnel/deployments'),
        apiFetch<any[]>('/personnel/coverage-gaps'),
      ]);
      setDeployments((Array.isArray(dRaw) ? dRaw : []).map(mapDeployment));
      setCoverageGaps(Array.isArray(gaps) ? gaps : []);
      addToast('Deployment saved', 'success');
    } catch (err) {
      addToast('Failed to save deployment', 'error');
      throw err; // let the modal know the save failed so it preserves the draft
    } finally {
      setIsSubmitting(false);
    }
  };

  const openAddDeployment = (officerId?: string) => {
    setDeploymentEditData(officerId ? { officer_id: officerId } : undefined);
    setDeploymentModalMode('create');
    setModal('new_deployment');
  };

  // ----------------------------------------------------------
  // Officer CRUD Handlers
  // ----------------------------------------------------------

  const handleOfficerSubmit = async (data: OfficerFormData) => {
    setIsSubmitting(true);
    try {
      const payload: Record<string, any> = { ...data };
      // Auto-generate full_name if not provided
      if (!payload.full_name && payload.first_name && payload.last_name) {
        payload.full_name = `${payload.first_name} ${payload.last_name}`;
      }

      if (officerModalMode === 'edit' && officerEditData?.id) {
        // Don't send password/username on edit
        delete payload.username;
        delete payload.password;
        await apiFetch(`/personnel/${officerEditData.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/personnel', { method: 'POST', body: JSON.stringify(payload) });
      }
      setModal('none');
      setOfficerEditData(undefined);
      await fetchCoreData({ silent: true });
      addToast(officerModalMode === 'edit' ? 'Officer updated' : 'Officer created', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to save officer', 'error');
      throw err; // let the modal know the save failed so it preserves the draft
    } finally {
      setIsSubmitting(false);
    }
  };

  // Accepts an optional officer so the right-click menu can edit the
  // right-clicked row; the header button passes nothing → edits the selection.
  const openEditOfficer = (target?: OfficerWithStatus) => {
    const o = target ?? selectedOfficer;
    if (!o) return;
    setOfficerEditData({
      id: o.id,
      role: o.role,
      full_name: o.full_name || '',
      first_name: o.first_name,
      last_name: o.last_name,
      middle_name: o.middle_name || '',
      date_of_birth: o.date_of_birth || '',
      badge_number: o.badge_number || '',
      rank: o.rank || '',
      department: o.department || '',
      hire_date: o.hire_date || '',
      shift_preference: o.shift_preference || '',
      employee_id: o.employee_id || '',
      phone: o.phone || '',
      email: o.email || '',
      address: o.address || '',
      address_2: (o as any).address_2 || '',
      city: o.city || '',
      state: o.state || '',
      zip: o.zip || '',
      emergency_contact_name: o.emergency_contact_name || '',
      emergency_contact_phone: o.emergency_contact_phone || '',
      emergency_contact_relationship: o.emergency_contact_relationship || '',
      blood_type: o.blood_type || '',
      allergies: o.allergies || '',
      uniform_size: o.uniform_size || '',
      dl_number: o.dl_number || '',
      dl_state: o.dl_state || '',
      dl_expiry: o.dl_expiry || '',
      notes: o.notes || '',
      username: '', password: '',
    });
    setOfficerModalMode('edit');
    setModal('edit_officer');
  };

  const handleOfficerDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/personnel/${deleteTarget.id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      if (selectedOfficer?.id === deleteTarget.id) setSelectedOfficer(null);
      await fetchCoreData({ silent: true });
      addToast('Officer terminated', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to terminate officer', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // ----------------------------------------------------------
  // Archive / Unarchive Officer
  // ----------------------------------------------------------

  // Archive == set employment status 'inactive' (there is no /archive handler;
  // POST /:id/status is the real, audited, proxy-routed write). Unarchive
  // restores 'active'. The active/archived split is enforced client-side via
  // is_active (see filteredOfficers) because the list endpoint stays on legacy.
  const handleArchiveOfficer = async (officerId: string) => {
    try {
      await apiFetch(`/personnel/${officerId}/status`, { method: 'POST', body: JSON.stringify({ status: 'inactive' }) });
      addToast('Officer archived', 'success');
      if (selectedOfficer?.id === officerId) setSelectedOfficer(null);
      await fetchCoreData({ silent: true });
    } catch (err: any) {
      addToast(err?.message || 'Failed to archive officer', 'error');
    }
  };

  const handleUnarchiveOfficer = async (officerId: string) => {
    try {
      await apiFetch(`/personnel/${officerId}/status`, { method: 'POST', body: JSON.stringify({ status: 'active' }) });
      addToast('Officer unarchived', 'success');
      if (selectedOfficer?.id === officerId) setSelectedOfficer(null);
      await fetchCoreData({ silent: true });
    } catch (err: any) {
      addToast(err?.message || 'Failed to unarchive officer', 'error');
    }
  };

  // ----------------------------------------------------------
  // Clock In / Out Handlers
  // ----------------------------------------------------------

  const handleDutyToggle = async () => {
    try {
      const [usersRaw, timeRaw] = await Promise.all([
        apiFetch<any[]>('/personnel'),
        apiFetch<any[]>('/personnel/time'),
      ]);
      setOfficers((Array.isArray(usersRaw) ? usersRaw : []).map(mapUser));
      setTimeEntries(asArray(timeRaw).map(mapTimeEntry));
    } catch { /* best-effort refresh */ }
  };

  const handleClockIn = async (officerId: string) => {
    setClockMileagePrompt({ mode: 'in', officerId });
  };

  const handleClockOut = async (officerId: string) => {
    setClockMileagePrompt({ mode: 'out', officerId });
  };

  const handleStartBreak = async (officerId: string) => {
    try {
      await apiFetch('/personnel/time/start-break', { method: 'POST', body: JSON.stringify({ officer_id: officerId }) });
      const raw = await apiFetch<any[]>('/personnel/time');
      setTimeEntries((Array.isArray(raw) ? raw : []).map(mapTimeEntry));
      addToast('Break started', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to start break', 'error');
    }
  };

  const handleEndBreak = async (officerId: string) => {
    try {
      await apiFetch('/personnel/time/end-break', { method: 'POST', body: JSON.stringify({ officer_id: officerId }) });
      const raw = await apiFetch<any[]>('/personnel/time');
      setTimeEntries((Array.isArray(raw) ? raw : []).map(mapTimeEntry));
      addToast('Break ended', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to end break', 'error');
    }
  };

  const handleDeleteTimeEntry = (entryId: string) => {
    setDeleteConfirm({
      title: 'Delete Time Entry',
      message: 'Delete this time entry? This cannot be undone. Payroll exports will recalculate.',
      onConfirm: async () => {
        try {
          await apiFetch(`/personnel/time/${entryId}`, { method: 'DELETE' });
          const raw = await apiFetch<any[]>('/personnel/time');
          setTimeEntries((Array.isArray(raw) ? raw : []).map(mapTimeEntry));
          addToast('Time entry deleted', 'success');
        } catch (err: any) {
          addToast(err?.message || 'Failed to delete time entry', 'error');
        }
      },
    });
  };

  // ----------------------------------------------------------
  // Time Entry Edit Handlers
  // ----------------------------------------------------------

  const handleTimeEntryEdit = async (data: TimeEntryEditData) => {
    setIsSubmitting(true);
    try {
      await apiFetch(`/personnel/time/${data.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          clock_in: data.clock_in,
          clock_out: data.clock_out || null,
          starting_mileage: data.starting_mileage,
          ending_mileage: data.ending_mileage,
          reason: data.reason,
        }),
      });
      setModal('none');
      setEditingTimeEntry(null);
      const raw = await apiFetch<any[]>('/personnel/time');
      setTimeEntries((Array.isArray(raw) ? raw : []).map(mapTimeEntry));
      addToast('Time entry updated', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to update time entry', 'error');
      throw err; // let the modal know the save failed so it preserves the draft
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditTimeEntry = (entry: TimeEntry) => {
    setEditingTimeEntry(entry);
    setModal('edit_time_entry');
  };

  // ----------------------------------------------------------
  // Roster List (Left Panel)
  // ----------------------------------------------------------

  // Right-click menu for a roster row. Acts on the right-clicked officer.
  const buildOfficerMenu = (officer: OfficerWithStatus): ContextMenuItem[] => {
    const fullName = `${officer.first_name || ''} ${officer.last_name || ''}`.trim();
    return [
      cm.action('Open officer', () => { setSelectedOfficer(officer); setDetailTab('profile'); }, { icon: <Eye size={12} /> }),
      cm.action('Edit officer', () => openEditOfficer(officer), { icon: <Pencil size={12} /> }),
      cm.separator(),
      cm.copy('Copy name', fullName),
      ...(officer.badge_number ? [cm.copy('Copy badge', officer.badge_number)] : []),
      cm.copyId(officer.id),
      cm.separator(),
      ...(showArchived
        ? [cm.action('Unarchive', () => handleUnarchiveOfficer(officer.id), { icon: <RotateCcw size={12} /> })]
        : [cm.action('Archive', () => handleArchiveOfficer(officer.id), { icon: <Archive size={12} /> })]),
      cm.action('Terminate', () => setDeleteTarget(officer), { danger: true, icon: <Trash2 size={12} /> }),
    ];
  };

  const rosterList = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search + New Officer */}
      <div className="p-3 border-b border-rmpg-600">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400 pointer-events-none" aria-hidden="true" />
            <input id="ff-personnelpage-0"
              type="text"
              className="input-dark pl-9 w-full text-[11px] min-h-[36px] focus:ring-1 focus:ring-brand-500/50 focus:border-brand-600 transition-shadow duration-150"
              placeholder="Search by name, badge, rank, department..." aria-label="Search personnel by name, badge, rank, or department"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-rmpg-100 transition-colors duration-150" aria-label="Clear search">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <ExportButton exportUrl="/api/personnel/export/csv" exportFilename="personnel.csv" />
          <button type="button"
            onClick={() => { setOfficerEditData(undefined); setOfficerModalMode('create'); setModal('new_officer'); }}
            className="toolbar-btn toolbar-btn-primary flex items-center gap-1 whitespace-nowrap"
          >
            <Plus className="w-3 h-3" /> New Officer
          </button>
        </div>
      </div>

      {/* Officer List */}
      <div className="flex-1 overflow-auto scrollbar-dark py-1" role="listbox" aria-label="Personnel roster">
        {filteredOfficers.map(officer => {
          const officerCreds = credentials.filter(c => c.officer_id === officer.id);
          const hasExpired = officerCreds.some(c => c.status === 'expired');
          const hasExpiring = officerCreds.some(c => c.status === 'expiring_soon');
          const validCreds = officerCreds.filter(c => c.status === 'valid').length;
          const compliancePct = officerCreds.length > 0 ? Math.round((validCreds / officerCreds.length) * 100) : 100;
          const isSelected = selectedOfficer?.id === officer.id;
          const yrsOfService = officer.hire_date
            ? Math.max(0, Math.floor((Date.now() - parseTimestamp(officer.hire_date).getTime()) / (365.25 * 86400000)))
            : null;

          return (
            <div
              key={officer.id}
              onClick={() => { setSelectedOfficer(officer); setDetailTab('profile'); }}
              onContextMenu={(e) => openMenu(e, buildOfficerMenu(officer))}
              className={`panel-beveled mb-1 mx-2 p-3 cursor-pointer transition-all duration-200 border-l-3 focus-visible:ring-1 focus-visible:ring-brand-500/50 focus-visible:outline-none ${
                isSelected
                  ? 'bg-brand-900/20 border-l-brand-500 shadow-md shadow-brand-900/20'
                  : 'bg-surface-base hover:bg-surface-raised hover:shadow-sm border-l-transparent'
              }`}
              role="option"
              tabIndex={0}
              aria-selected={isSelected}
              aria-label={`${officer.first_name} ${officer.last_name}, ${officer.role}, ${officer.status === 'on_duty' ? 'on duty' : 'off duty'}`}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedOfficer(officer); setDetailTab('profile'); } }}
            >
              <div className="flex items-start gap-3">
                <OfficerAvatar officer={officer} size="md" />
                <div className="flex-1 min-w-0">
                  {/* Line 1: Name + role badge */}
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-bold text-rmpg-100 truncate">
                      {officer.last_name}, {officer.first_name}
                      {officer.middle_name ? ` ${officer.middle_name[0]}.` : ''}
                    </span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 text-[8px] font-bold uppercase flex-shrink-0 ${ROLE_COLORS[officer.role] || ROLE_COLORS.officer}`}>
                      {toDisplayLabel(officer.role)}
                    </span>
                  </div>
                  {/* Line 2: Rank + Badge */}
                  <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-rmpg-300">
                    {officer.rank && <span>{officer.rank}</span>}
                    {officer.rank && officer.badge_number && <span className="text-rmpg-600">&middot;</span>}
                    {officer.badge_number && <span className="font-mono">Badge #{officer.badge_number}</span>}
                  </div>
                  {/* Line 3: Division */}
                  {officer.department && (
                    <div className="text-[10px] text-rmpg-400 mt-0.5 truncate">{officer.department}</div>
                  )}
                  {/* Line 4: Compliance row */}
                  <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-400">
                    {yrsOfService !== null && <span className="font-mono text-rmpg-400">{yrsOfService} yr{yrsOfService !== 1 ? 's' : ''}</span>}
                    {officerCreds.length > 0 && (
                      <>
                        <span className="text-rmpg-600">&middot;</span>
                        <span className={`font-mono ${hasExpired ? 'text-red-400' : hasExpiring ? 'text-amber-400' : 'text-green-400'}`}>
                          {validCreds}/{officerCreds.length} creds
                        </span>
                        {hasExpired && <span className="led-dot led-red" />}
                        {!hasExpired && hasExpiring && <span className="led-dot led-amber" />}
                      </>
                    )}
                  </div>
                  {/* Credential compliance bar */}
                  <CredentialProgressBar credentials={officerCreds} />
                </div>
                {/* Status indicator — right side */}
                <div className="flex-shrink-0 flex flex-col items-end gap-0.5 pt-0.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${
                    officer.status === 'on_duty' ? 'bg-green-400 shadow-[0_0_6px_rgba(34,197,94,0.5)]'
                    : officer.status === 'on_leave' ? 'bg-amber-400 shadow-[0_0_6px_rgba(245,158,11,0.4)]'
                    : 'bg-rmpg-600'
                  }`} />
                  <span className={`text-[9px] font-bold uppercase ${
                    officer.status === 'on_duty' ? 'text-green-400' : officer.status === 'on_leave' ? 'text-amber-400' : 'text-rmpg-500'
                  }`}>
                    {officer.status === 'on_duty' ? 'ON' : officer.status === 'on_leave' ? 'LEAVE' : 'OFF'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {filteredOfficers.length === 0 && (
          <div className="panel-inset p-10 text-center mx-2 mt-2" role="status">
            <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
              <Users className="w-7 h-7 text-rmpg-600" />
            </div>
            <p className="text-sm text-rmpg-400 font-medium">{searchQuery ? 'No matching personnel' : 'No personnel records'}</p>
            <p className="text-[10px] text-rmpg-600 mt-1">{searchQuery ? 'Try a different search term' : 'Add officers to get started'}</p>
          </div>
        )}
      </div>
    </div>
  );

  // Detail panel or analytics dashboard for right panel
  const detailPanel = selectedOfficer ? (
    <PersonnelDetailPanel
      officer={selectedOfficer}
      credentials={credentials}
      schedules={schedules}
      timeEntries={timeEntries}
      activity={officerActivity}
      training={training}
      trainingLoading={trainingLoading}
      deployments={deployments}
      deploymentsLoading={deploymentsLoading}
      activeTab={detailTab}
      onTabChange={setDetailTab}
      onAddCredential={id => openAddCredential(id)}
      onEditCredential={openEditCredential}
      onDeleteCredential={handleCredentialDelete}
      onAddSchedule={() => setModal('new_schedule')}
      onDeleteSchedule={handleScheduleDelete}
      onAddTraining={id => openAddTraining(id)}
      equipment={equipment}
      equipmentLoading={equipmentLoading}
      onAddEquipment={id => openAddEquipment(id)}
      onEditEquipment={openEditEquipment}
      onDeleteEquipment={handleEquipmentDelete}
      preparedBy={user?.full_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username}
      bodyCameras={bodyCameras}
      bodyCamVideos={bodyCamVideos}
      bodyCamerasLoading={bodyCamerasLoading}
      onAddBodyCamera={id => openAddBodyCamera(id)}
      onEditBodyCamera={openEditBodyCamera}
      onDeleteBodyCamera={handleBodyCameraDelete}
      onUploadVideo={() => setModal('upload_video')}
      onDeleteVideo={handleVideoDelete}
      onEditVideo={setEditingVideo}
      onPlayVideo={setPlayingVideo}
      dashcamEvents={officerDashcamEvents}
      dashcamDeviceMapping={officerDeviceMapping}
      dashcamLoading={officerDashcamLoading}
      onAddDeployment={id => openAddDeployment(id)}
      onEditOfficer={openEditOfficer}
      onDeleteOfficer={() => setDeleteTarget(selectedOfficer)}
      onArchiveOfficer={handleArchiveOfficer}
      onUnarchiveOfficer={handleUnarchiveOfficer}
      isArchived={showArchived}
      onClockIn={handleClockIn}
      onClockOut={handleClockOut}
      onStartBreak={handleStartBreak}
      onEndBreak={handleEndBreak}
      onDutyToggle={handleDutyToggle}
      onEditTimeEntry={openEditTimeEntry}
      onDeleteTimeEntry={handleDeleteTimeEntry}
      onClose={() => setSelectedOfficer(null)}
    />
  ) : (
    // Light prompt — at-a-glance analytics now live on the Command tab
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken mb-4">
        <Users className="w-8 h-8 text-rmpg-600" />
      </div>
      <p className="text-sm text-rmpg-300 font-medium">Select an officer</p>
      <p className="text-[11px] text-rmpg-500 mt-1 max-w-[260px]">
        Choose someone from the roster to view their profile, credentials, schedule, and records.
      </p>
      <button type="button" onClick={() => setActiveTab('command')} className="toolbar-btn mt-4">
        View Command Dashboard
      </button>
    </div>
  );

  // Dashboard widget → drill-down navigation. When an officer is supplied,
  // open them in the roster master-detail; otherwise just switch tabs.
  const navigateTo = (tab: MainTab, officer?: OfficerWithStatus) => {
    if (officer) {
      setActiveTab('roster');
      setSelectedOfficer(officer);
      setDetailTab('profile');
    } else {
      setActiveTab(tab);
      if (tab !== 'roster') setSelectedOfficer(null);
    }
  };

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  // ── Keyboard: Esc smart-cascade + N → New Officer ──
  // Esc closes the smallest-open thing first (so a video preview opened
  // ON TOP of a credential modal doesn't dismiss both at once and reset
  // the form draft). Order: playing video → editing video → delete-
  // confirm → terminate-confirm → primary modal → selection. The old
  // hard-coded "Esc closes editingVideo only" left every other modal
  // captive to its own close button.
  // N opens the New Officer modal from the roster tab; typing-suppressed
  // so a search input doesn't swallow the letter as a shortcut. Mirrors
  // FI / Court / Citations / Dispatch.
  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const handler = (e: KeyboardEvent) => {
      // Esc smart-cascade
      if (e.key === 'Escape') {
        if (playingVideo) { setPlayingVideo(null); return; }
        if (editingVideo) { setEditingVideo(null); return; }
        if (deleteConfirm) { setDeleteConfirm(null); return; }
        if (deleteTarget) { setDeleteTarget(null); return; }
        if (modal !== 'none') {
          setModal('none');
          setCredentialEditData(undefined);
          setTrainingEditData(undefined);
          setEquipmentEditData(undefined);
          setDeploymentEditData(undefined);
          setBodyCameraEditData(undefined);
          setOfficerEditData(undefined);
          setEditingTimeEntry(null);
          return;
        }
        if (selectedOfficer) { setSelectedOfficer(null); return; }
        return;
      }
      // N → New {Officer | Equipment | Credential | Training | …}
      // Typing-suppressed; the tab decides which modal to open. Mirrors
      // FI / Court / Citations / Dispatch where N opens "the canonical
      // new-thing for this view." Equipment was the explicit ask in the
      // page-38 audit but credentials/training had the same gap; rolling
      // them into the same dispatch table keeps the contract uniform.
      if ((e.key === 'n' || e.key === 'N')
          && !e.ctrlKey && !e.metaKey && !e.altKey
          && !isTypingTarget(e.target)) {
        if (activeTab === 'roster') {
          e.preventDefault();
          setOfficerEditData(undefined);
          setOfficerModalMode('create');
          setModal('new_officer');
        } else if (activeTab === 'equipment') {
          e.preventDefault();
          openAddEquipment();
        } else if (activeTab === 'credentials') {
          e.preventDefault();
          openAddCredential();
        } else if (activeTab === 'training') {
          e.preventDefault();
          openAddTraining();
        } else if (activeTab === 'deployment') {
          e.preventDefault();
          openAddDeployment();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [playingVideo, editingVideo, deleteConfirm, deleteTarget, modal, selectedOfficer, activeTab]);

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <PanelTitleBar title={showArchived ? 'PERSONNEL MANAGEMENT — ARCHIVES' : 'PERSONNEL MANAGEMENT'} icon={showArchived ? Archive : Users}>
        <RmpgLogo height={16} iconOnly />
        <span className="toolbar-separator" />
        <button type="button"
          className={`toolbar-btn ${showArchived ? 'text-amber-400 border-amber-600/50' : ''}`}
          onClick={() => { setShowArchived(!showArchived); setSelectedOfficer(null); }}
        >
          <Archive className="w-3 h-3" /> {showArchived ? 'Viewing Archives' : 'Show Archives'}
        </button>
        <PrintButton />
      </PanelTitleBar>

      {/* Command Status Strip — hidden on the Command tab, whose dashboard owns the KPIs */}
      {activeTab !== 'command' && (
      <div className="border-b border-rmpg-700" role="group" aria-label="Personnel statistics">
        {/* Row 1: Operational stats */}
        <div className={`panel-inset ${isMobile ? 'grid grid-cols-2 gap-px' : 'flex items-stretch'}`}>
          <div className="flex items-center gap-2 px-4 py-1.5 border-r border-rmpg-700">
            <span className="led-dot led-green" aria-hidden="true" />
            <span className="text-green-400 font-bold text-base font-mono">{onDutyCount}</span>
            <span className="text-[9px] text-rmpg-400 uppercase tracking-wider">Active</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-1.5 border-r border-rmpg-700">
            <span className="led-dot led-off" aria-hidden="true" />
            <span className="text-rmpg-200 font-bold text-base font-mono">{offDutyCount}</span>
            <span className="text-[9px] text-rmpg-400 uppercase tracking-wider">Off Duty</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-1.5 border-r border-rmpg-700">
            <Clock className="w-3 h-3 text-brand-400" aria-hidden="true" />
            <span className="text-brand-400 font-bold text-base font-mono">{clockedInCount}</span>
            <span className="text-[9px] text-rmpg-400 uppercase tracking-wider">Clocked In</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-1.5 border-r border-rmpg-700">
            <span className="text-rmpg-100 font-bold text-base font-mono">{totalHoursThisPeriod.toFixed(1)}</span>
            <span className="text-[9px] text-rmpg-400 uppercase tracking-wider">Period Hours</span>
          </div>
          <div className="flex items-center gap-2 px-4 py-1.5">
            <span className="text-rmpg-100 font-bold text-base font-mono">{officers.length}</span>
            <span className="text-[9px] text-rmpg-400 uppercase tracking-wider">Total Staff</span>
          </div>
        </div>
        {/* Row 2: Alert bar (conditional) */}
        {expiringCreds > 0 && (
          <div className="flex items-center gap-2 px-4 py-1 border-t border-rmpg-700 border-l-2 border-l-amber-500 bg-amber-900/10" role="alert">
            <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />
            <span className="text-[10px] text-amber-400 font-bold font-mono">{expiringCreds} CREDENTIAL ALERT{expiringCreds !== 1 ? 'S' : ''}</span>
          </div>
        )}
      </div>
      )}

      {/* Tab Navigation (grouped Spillman module strip) */}
      <SpillmanModuleGroup
        groups={[
          {
            label: 'Operations',
            tone: 'steel',
            tabs: [
              { id: 'command',    label: 'Command' },
              { id: 'roster',     label: 'Roster',     count: officers.length || undefined },
              { id: 'duty_board', label: 'Duty Board', count: onDutyCount || undefined },
            ],
          },
          {
            label: 'Planning',
            tone: 'gold',
            tabs: [
              { id: 'schedule',   label: 'Schedule' },
              { id: 'time',       label: 'Time',        count: clockedInCount || undefined },
              { id: 'deployment', label: 'Deployment' },
            ],
          },
          {
            label: 'Administration',
            tone: 'neutral',
            tabs: [
              { id: 'credentials', label: 'Credentials', count: expiringCreds > 0 ? expiringCreds : undefined },
              { id: 'training',    label: 'Training' },
              { id: 'equipment',   label: 'Equipment' },
            ],
          },
        ] as ModuleGroupSpec[]}
        activeTab={activeTab}
        onTabChange={(id) => {
          setActiveTab(id as MainTab);
          if (id !== 'roster') setSelectedOfficer(null);
        }}
      />

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden flex">
        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center flex-1">
            <Loader2 className="w-6 h-6 text-brand-400 animate-spin" role="status" aria-label="Loading" />
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="flex items-center justify-center flex-1">
            <div className="text-center">
              <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <p className="text-sm text-rmpg-300">{error}</p>
              <button type="button" onClick={() => fetchCoreData()} className="toolbar-btn mt-3">Retry</button>
            </div>
          </div>
        )}

        {/* Command Dashboard — landing view */}
        {!loading && !error && activeTab === 'command' && (
          <PersonnelDashboard
            officers={officers}
            credentials={credentials}
            timeEntries={timeEntries}
            training={training}
            schedules={schedules}
            coverageGaps={coverageGaps}
            onNavigate={navigateTo}
            onSelectOfficer={officer => navigateTo('roster', officer)}
          />
        )}

        {/* Roster Tab with Split Panel */}
        {!loading && !error && activeTab === 'roster' && (
          <SplitPanel
            persistKey="personnel"
            initialRatio={0.4}
            minLeftPx={300}
            minRightPx={400}
            rightVisible={true}
            leftLabel="Roster"
            rightLabel="Officer"
            left={rosterList}
            right={detailPanel}
          />
        )}

        {/* Other tabs render full-width */}
        {!loading && !error && activeTab === 'duty_board' && (
          <DutyBoardTab
            officers={officers}
            timeEntries={timeEntries}
            credentials={credentials}
            onOfficerClick={officer => { setActiveTab('roster'); setSelectedOfficer(officer); setDetailTab('profile'); }}
            onClockIn={handleClockIn}
            onClockOut={handleClockOut}
            onStartBreak={handleStartBreak}
            onEndBreak={handleEndBreak}
          />
        )}

        {!loading && !error && activeTab === 'schedule' && (
          <ScheduleTab
            officers={officers}
            schedules={schedules}
            weekMonday={weekMonday}
            onWeekChange={setWeekMonday}
            onAddSchedule={() => setModal('new_schedule')}
          />
        )}

        {!loading && !error && activeTab === 'time' && (
          <TimeAttendanceTab timeEntries={timeEntries} officers={officers} onEditTimeEntry={openEditTimeEntry} onDeleteTimeEntry={handleDeleteTimeEntry} />
        )}

        {!loading && !error && activeTab === 'credentials' && (
          <CredentialsTab
            credentials={credentials}
            onAddCredential={() => openAddCredential()}
            onEditCredential={openEditCredential}
            onDeleteCredential={handleCredentialDelete}
          />
        )}

        {!loading && !error && activeTab === 'training' && (
          <TrainingTab
            training={training}
            requirements={trainingReqs}
            officers={officers}
            loading={trainingLoading}
            onAddTraining={() => openAddTraining()}
          />
        )}

        {!loading && !error && activeTab === 'equipment' && (
          <EquipmentTab
            equipment={equipment}
            onAddEquipment={() => openAddEquipment()}
            onEditEquipment={openEditEquipment}
            onDeleteEquipment={handleEquipmentDelete}
            initialSearchQuery={equipmentInitialSearch}
            highlightItemId={resolvedEquipmentItemId}
            preparedBy={user?.full_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username}
          />
        )}

        {!loading && !error && activeTab === 'deployment' && (
          <DeploymentTab
            deployments={deployments}
            coverageGaps={coverageGaps}
            officers={officers}
            loading={deploymentsLoading}
            onAddDeployment={() => openAddDeployment()}
          />
        )}

        {/* Analytics removed as standalone tab — shows in roster right panel when no officer selected */}
      </div>

      {/* Modals */}
      <ScheduleFormModal
        isOpen={modal === 'new_schedule'}
        onClose={() => setModal('none')}
        onSubmit={handleScheduleSubmit}
        isSubmitting={isSubmitting}
        officers={officerOptions}
        properties={propertyOptions}
      />

      <CredentialFormModal
        isOpen={modal === 'new_credential' || modal === 'edit_credential'}
        onClose={() => { setModal('none'); setCredentialEditData(undefined); }}
        onSubmit={handleCredentialSubmit}
        isSubmitting={isSubmitting}
        officers={officerOptions}
        initialData={credentialEditData}
        mode={credentialModalMode}
      />

      <TrainingFormModal
        isOpen={modal === 'new_training' || modal === 'edit_training'}
        onClose={() => { setModal('none'); setTrainingEditData(undefined); }}
        onSubmit={handleTrainingSubmit}
        isSubmitting={isSubmitting}
        officers={officerOptions}
        initialData={trainingEditData}
        mode={trainingModalMode}
      />

      <EquipmentFormModal
        isOpen={modal === 'new_equipment' || modal === 'edit_equipment'}
        onClose={() => { setModal('none'); setEquipmentEditData(undefined); }}
        onSubmit={handleEquipmentSubmit}
        isSubmitting={isSubmitting}
        officers={officerOptions}
        initialData={equipmentEditData}
        mode={equipmentModalMode}
      />

      <BodyCameraFormModal
        isOpen={modal === 'new_body_camera' || modal === 'edit_body_camera'}
        onClose={() => { setModal('none'); setBodyCameraEditData(undefined); }}
        onSubmit={handleBodyCameraSubmit}
        isSubmitting={isSubmitting}
        officers={officerOptions}
        initialData={bodyCameraEditData}
        mode={bodyCameraModalMode}
      />

      {selectedOfficer && (
        <VideoUploadModal
          isOpen={modal === 'upload_video'}
          onClose={() => setModal('none')}
          onUploaded={refreshBodyCameras}
          cameras={bodyCameras.filter(c => c.officer_id === Number(selectedOfficer.id))}
          officerId={Number(selectedOfficer.id)}
          apiBase={window.location.origin + '/api'}
          getAuthHeaders={() => {
            const token = localStorage.getItem('rmpg_token');
            const headers: Record<string, string> = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;
            return headers;
          }}
        />
      )}

      <VideoPlayer
        isOpen={!!playingVideo}
        onClose={() => setPlayingVideo(null)}
        video={playingVideo}
        apiBase={window.location.origin + '/api'}
        getAuthHeaders={() => {
          const token = localStorage.getItem('rmpg_token');
          const headers: Record<string, string> = {};
          if (token) headers['Authorization'] = `Bearer ${token}`;
          return headers;
        }}
        onEditVideo={(vid) => { setPlayingVideo(null); setEditingVideo(vid); }}
      />

      <VideoEditModal
        isOpen={!!editingVideo}
        onClose={() => setEditingVideo(null)}
        onSave={handleVideoEdit}
        video={editingVideo}
        isSubmitting={isSubmitting}
      />

      <DeploymentFormModal
        isOpen={modal === 'new_deployment' || modal === 'edit_deployment'}
        onClose={() => { setModal('none'); setDeploymentEditData(undefined); }}
        onSubmit={handleDeploymentSubmit}
        isSubmitting={isSubmitting}
        officers={officerOptions}
        properties={propertyOptions}
        initialData={deploymentEditData}
        mode={deploymentModalMode}
      />

      <OfficerFormModal
        isOpen={modal === 'new_officer' || modal === 'edit_officer'}
        onClose={() => { setModal('none'); setOfficerEditData(undefined); }}
        onSubmit={handleOfficerSubmit}
        isSubmitting={isSubmitting}
        initialData={officerEditData}
        mode={officerModalMode}
      />

      <TimeEntryEditModal
        isOpen={modal === 'edit_time_entry'}
        onClose={() => { setModal('none'); setEditingTimeEntry(null); }}
        onSubmit={handleTimeEntryEdit}
        isSubmitting={isSubmitting}
        entry={editingTimeEntry}
      />

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleOfficerDelete}
        title="Terminate Officer"
        message={`Are you sure you want to terminate ${deleteTarget?.first_name} ${deleteTarget?.last_name}? This will mark them as terminated and unassign them from any units.`}
        confirmLabel="Terminate"
        confirmVariant="danger"
        isLoading={deleting}
      />

      {/* Centralized destructive-action confirm — replaces 6 native window.confirm() */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={runDeleteConfirm}
        title={deleteConfirm?.title || 'Confirm'}
        message={deleteConfirm?.message || ''}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleteConfirmLoading}
      />

      {/* Clock In / Clock Out Mileage Modal */}
      {clockMileagePrompt && (
        <ClockInOutMileageModal
          isOpen={!!clockMileagePrompt}
          isClockingOut={clockMileagePrompt.mode === 'out'}
          officerId={clockMileagePrompt.officerId}
          onClose={() => setClockMileagePrompt(null)}
          onSuccess={async (punch) => {
            setClockMileagePrompt(null);
            const raw = await apiFetch<any[]>('/personnel/time');
            setTimeEntries((Array.isArray(raw) ? raw : []).map(mapTimeEntry));
            if (clockMileagePrompt.mode === 'in') {
              addToast('Clocked in — starting mileage recorded & vehicle assigned', 'success');
              toastClockLinkWarnings(addToast, punch as ClockLinkFlags);
            } else {
              addToast('Clocked out — ending mileage recorded & DAR generated', 'success');
            }
          }}
        />
      )}
    </div>
  );
}

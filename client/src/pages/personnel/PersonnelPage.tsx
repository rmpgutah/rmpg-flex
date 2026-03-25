import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, Search, X, Clock, AlertTriangle, BarChart3, Loader2, Plus, Archive, RotateCcw,
} from 'lucide-react';
import type { Schedule, TimeEntry, Credential, TrainingRecord, TrainingRequirement, Deployment, CoverageGap, PersonnelAnalytics, OfficerEquipment, BodyCamera, BodyCamVideo, DashcamEvent, CpgDeviceMapping } from '../../types';
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
import { useIsMobile } from '../../hooks/useIsMobile';
import { mapUser, mapSchedule, mapTimeEntry, mapCredential, mapTraining, mapDeployment, mapBodyCamera, mapBodyCamVideo } from './utils/personnelMappers';
import type { OfficerWithStatus } from './utils/personnelMappers';
import { MAIN_TABS, type MainTab, type DetailTab, type ModalMode } from './utils/personnelConstants';
import { getWeekMonday } from './utils/personnelFormatters';
import OfficerAvatar from './components/OfficerAvatar';
import CredentialProgressBar from './components/CredentialProgressBar';
import { ROLE_COLORS } from './utils/personnelConstants';
import { toDisplayLabel } from '../../utils/formatters';
import PersonnelDetailPanel from './PersonnelDetailPanel';
import PersonnelAnalyticsDashboard from './PersonnelAnalyticsDashboard';
import DutyBoardTab from './tabs/DutyBoardTab';
import ScheduleTab from './tabs/ScheduleTab';
import TimeAttendanceTab from './tabs/TimeAttendanceTab';
import CredentialsTab from './tabs/CredentialsTab';
import TrainingTab from './tabs/TrainingTab';
import EquipmentTab from './tabs/EquipmentTab';
import DeploymentTab from './tabs/DeploymentTab';
import AnalyticsTab from './tabs/AnalyticsTab';
import DashCameraTab from './tabs/DashCameraTab';
import CalendarTab from './tabs/CalendarTab';
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

export default function PersonnelPage() {
  const { addToast } = useToast();
  const isMobile = useIsMobile();

  // Tab state
  const [activeTab, setActiveTab] = usePersistedTab(
    'rmpg_personnel_tab',
    'roster' as MainTab,
    ['roster', 'duty_board', 'schedule', 'calendar', 'time', 'credentials', 'training', 'equipment', 'dash_cameras', 'deployment', 'analytics'] as const,
  );
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
  const [analytics, setAnalytics] = useState<PersonnelAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

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

  // Dash camera data (ClearPathGPS)
  const [dashcamEvents, setDashcamEvents] = useState<DashcamEvent[]>([]);
  const [deviceMappings, setDeviceMappings] = useState<CpgDeviceMapping[]>([]);
  const [dashcamLoading, setDashcamLoading] = useState(false);
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
        apiFetch<any[]>(`/personnel?archived=${showArchived}`),
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

      // Guard: ensure all values are arrays
      setOfficers((Array.isArray(usersRaw) ? usersRaw : []).map(mapUser));
      setSchedules((Array.isArray(schedulesRaw) ? schedulesRaw : []).map(mapSchedule));
      setTimeEntries((Array.isArray(timeRaw) ? timeRaw : []).map(mapTimeEntry));
      setCredentials((Array.isArray(credentialsRaw) ? credentialsRaw : []).map(mapCredential));
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

  // Lazy-load tab data
  useEffect(() => {
    if (activeTab === 'training' && training.length === 0 && !trainingLoading) {
      setTrainingLoading(true);
      Promise.all([
        apiFetch<any[]>('/personnel/training'),
        apiFetch<any[]>('/personnel/training-requirements'),
      ])
        .then(([tRaw, rRaw]) => { setTraining((Array.isArray(tRaw) ? tRaw : []).map(mapTraining)); setTrainingReqs(Array.isArray(rRaw) ? rRaw : []); })
        .catch(() => addToast('Failed to load training data', 'error'))
        .finally(() => setTrainingLoading(false));
    }
    if (activeTab === 'deployment' && deployments.length === 0 && !deploymentsLoading) {
      setDeploymentsLoading(true);
      Promise.all([
        apiFetch<any[]>('/personnel/deployments'),
        apiFetch<any[]>('/personnel/coverage-gaps'),
        apiFetch<any[]>('/records/properties'),
      ])
        .then(([dRaw, gaps, propsRaw]) => {
          setDeployments((Array.isArray(dRaw) ? dRaw : []).map(mapDeployment));
          setCoverageGaps(Array.isArray(gaps) ? gaps : []);
          setAllProperties((Array.isArray(propsRaw) ? propsRaw : []).map((p: any) => ({ id: String(p.id), name: p.name })));
        })
        .catch(() => addToast('Failed to load deployment data', 'error'))
        .finally(() => setDeploymentsLoading(false));
    }
    if (activeTab === 'equipment' && equipment.length === 0 && !equipmentLoading) {
      setEquipmentLoading(true);
      apiFetch<any[]>('/personnel/equipment')
        .then(raw => setEquipment(Array.isArray(raw) ? raw : []))
        .catch(() => addToast('Failed to load equipment data', 'error'))
        .finally(() => setEquipmentLoading(false));
    }
    if (activeTab === 'dash_cameras' && dashcamEvents.length === 0 && !dashcamLoading) {
      setDashcamLoading(true);
      Promise.all([
        apiFetch<any[]>('/clearpathgps/dashcam-events'),
        apiFetch<any[]>('/clearpathgps/mappings'),
      ])
        .then(([events, mappings]) => {
          setDashcamEvents(Array.isArray(events) ? events : []);
          setDeviceMappings(Array.isArray(mappings) ? mappings : []);
        })
        .catch(() => addToast('Failed to load dash camera data', 'error'))
        .finally(() => setDashcamLoading(false));
    }
    if (activeTab === 'analytics' && !analytics && !analyticsLoading) {
      setAnalyticsLoading(true);
      apiFetch<PersonnelAnalytics>('/personnel/analytics')
        .then(setAnalytics)
        .catch(() => addToast('Failed to load analytics', 'error'))
        .finally(() => setAnalyticsLoading(false));
    }
  }, [activeTab]);

  // Lazy-load detail tab data
  useEffect(() => {
    if (!selectedOfficer) return;
    if (detailTab === 'activity') {
      apiFetch<ActivityEntry[]>(`/personnel/activity/${selectedOfficer.id}?limit=50`)
        .then(raw => setOfficerActivity(Array.isArray(raw) ? raw : []))
        .catch(() => setOfficerActivity([]));
    }
    if (detailTab === 'training' && training.length === 0 && !trainingLoading) {
      setTrainingLoading(true);
      apiFetch<any[]>('/personnel/training')
        .then(raw => setTraining((Array.isArray(raw) ? raw : []).map(mapTraining)))
        .catch(() => addToast('Failed to load training', 'error'))
        .finally(() => setTrainingLoading(false));
    }
    if (detailTab === 'equipment' && equipment.length === 0 && !equipmentLoading) {
      setEquipmentLoading(true);
      apiFetch<any[]>('/personnel/equipment')
        .then(raw => setEquipment(Array.isArray(raw) ? raw : []))
        .catch(() => addToast('Failed to load equipment', 'error'))
        .finally(() => setEquipmentLoading(false));
    }
    if (detailTab === 'body_cameras' && bodyCameras.length === 0 && !bodyCamerasLoading) {
      setBodyCamerasLoading(true);
      Promise.all([
        apiFetch<any[]>('/personnel/body-cameras'),
        apiFetch<any[]>('/personnel/bodycam-videos'),
      ])
        .then(([cams, vids]) => {
          setBodyCameras((Array.isArray(cams) ? cams : []).map(mapBodyCamera));
          setBodyCamVideos((Array.isArray(vids) ? vids : []).map(mapBodyCamVideo));
        })
        .catch(() => addToast('Failed to load body cameras', 'error'))
        .finally(() => setBodyCamerasLoading(false));
    }
    if (detailTab === 'dash_cameras') {
      setOfficerDashcamLoading(true);
      // Fetch per-officer dashcam events and find their device mapping
      Promise.all([
        apiFetch<any[]>(`/clearpathgps/dashcam-events/by-officer/${selectedOfficer.id}`),
        apiFetch<any[]>('/clearpathgps/mappings'),
      ])
        .then(([events, mappings]) => {
          setOfficerDashcamEvents(Array.isArray(events) ? events : []);
          // Find the mapping for this officer's unit
          const allMappings: CpgDeviceMapping[] = Array.isArray(mappings) ? mappings : [];
          const match = allMappings.find(m => m.officer_name && selectedOfficer &&
            m.officer_name === `${selectedOfficer.first_name} ${selectedOfficer.last_name}`);
          setOfficerDeviceMapping(match || null);
        })
        .catch(() => addToast('Failed to load dash camera data', 'error'))
        .finally(() => setOfficerDashcamLoading(false));
    }
    if (detailTab === 'deployment' && deployments.length === 0 && !deploymentsLoading) {
      setDeploymentsLoading(true);
      apiFetch<any[]>('/personnel/deployments')
        .then(raw => setDeployments((Array.isArray(raw) ? raw : []).map(mapDeployment)))
        .catch(() => addToast('Failed to load deployments', 'error'))
        .finally(() => setDeploymentsLoading(false));
    }
  }, [selectedOfficer?.id, detailTab]);

  // ----------------------------------------------------------
  // Derived Data
  // ----------------------------------------------------------

  const filteredOfficers = officers.filter(o => {
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

  const handleScheduleDelete = async (scheduleId: string) => {
    if (!window.confirm('Delete this schedule? This cannot be undone.')) return;
    try {
      await apiFetch(`/personnel/schedules/${scheduleId}`, { method: 'DELETE' });
      const raw = await apiFetch<any[]>('/personnel/schedules');
      setSchedules((Array.isArray(raw) ? raw : []).map(mapSchedule));
      addToast('Schedule deleted', 'success');
    } catch {
      addToast('Failed to delete schedule', 'error');
    }
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

  const handleCredentialDelete = async (credId: string) => {
    if (!window.confirm('Delete this credential? This cannot be undone.')) return;
    try {
      await apiFetch(`/personnel/credentials/${credId}`, { method: 'DELETE' });
      const raw = await apiFetch<any[]>('/personnel/credentials');
      setCredentials((Array.isArray(raw) ? raw : []).map(mapCredential));
      addToast('Credential deleted', 'success');
    } catch {
      addToast('Failed to delete credential', 'error');
    }
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
    } catch {
      addToast('Failed to save training record', 'error');
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
    } catch {
      addToast('Failed to save equipment record', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEquipmentDelete = async (equipId: string) => {
    if (!window.confirm('Delete this equipment record? This cannot be undone.')) return;
    try {
      await apiFetch(`/personnel/equipment/${equipId}`, { method: 'DELETE' });
      const raw = await apiFetch<any[]>('/personnel/equipment');
      setEquipment(Array.isArray(raw) ? raw : []);
      addToast('Equipment deleted', 'success');
    } catch {
      addToast('Failed to delete equipment', 'error');
    }
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

  const refreshDashcamData = async () => {
    setDashcamLoading(true);
    try {
      const [events, mappings] = await Promise.all([
        apiFetch<any[]>('/clearpathgps/dashcam-events'),
        apiFetch<any[]>('/clearpathgps/mappings'),
      ]);
      setDashcamEvents(Array.isArray(events) ? events : []);
      setDeviceMappings(Array.isArray(mappings) ? mappings : []);
    } catch {
      addToast('Failed to refresh dash camera data', 'error');
    } finally {
      setDashcamLoading(false);
    }
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
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBodyCameraDelete = async (camId: number) => {
    if (!window.confirm('Delete this body camera record? This cannot be undone.')) return;
    try {
      await apiFetch(`/personnel/body-cameras/${camId}`, { method: 'DELETE' });
      await refreshBodyCameras();
      addToast('Body camera deleted', 'success');
    } catch {
      addToast('Failed to delete body camera', 'error');
    }
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

  const handleVideoDelete = async (videoId: number) => {
    if (!window.confirm('Delete this video? This cannot be undone.')) return;
    try {
      await apiFetch(`/personnel/bodycam-videos/${videoId}`, { method: 'DELETE' });
      await refreshBodyCameras();
      addToast('Video deleted', 'success');
    } catch {
      addToast('Failed to delete video', 'error');
    }
  };

  const handleVideoEdit = async (videoId: number, data: BodyCamVideoEditData) => {
    setIsSubmitting(true);
    try {
      // Capture original values to detect overlay-relevant changes
      const original = editingVideo;
      await apiFetch(`/personnel/bodycam-videos/${videoId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      await refreshBodyCameras();
      setEditingVideo(null);
      addToast('Video updated', 'success');
      // Auto-reprocess overlay if overlay-affecting fields changed
      if (original && original.overlay_status === 'complete') {
        const overlayChanged =
          original.classification !== data.classification ||
          (original.case_number || '') !== data.case_number ||
          (original.recorded_at ? original.recorded_at.slice(0, 16) : '') !== data.recorded_at;
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
    } catch {
      addToast('Failed to save deployment', 'error');
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
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditOfficer = () => {
    if (!selectedOfficer) return;
    setOfficerEditData({
      id: selectedOfficer.id,
      role: selectedOfficer.role,
      full_name: selectedOfficer.full_name || '',
      first_name: selectedOfficer.first_name,
      last_name: selectedOfficer.last_name,
      middle_name: selectedOfficer.middle_name || '',
      date_of_birth: selectedOfficer.date_of_birth || '',
      badge_number: selectedOfficer.badge_number || '',
      rank: selectedOfficer.rank || '',
      department: selectedOfficer.department || '',
      hire_date: selectedOfficer.hire_date || '',
      shift_preference: selectedOfficer.shift_preference || '',
      employee_id: selectedOfficer.employee_id || '',
      phone: selectedOfficer.phone || '',
      email: selectedOfficer.email || '',
      address: selectedOfficer.address || '',
      city: selectedOfficer.city || '',
      state: selectedOfficer.state || '',
      zip: selectedOfficer.zip || '',
      emergency_contact_name: selectedOfficer.emergency_contact_name || '',
      emergency_contact_phone: selectedOfficer.emergency_contact_phone || '',
      emergency_contact_relationship: selectedOfficer.emergency_contact_relationship || '',
      blood_type: selectedOfficer.blood_type || '',
      allergies: selectedOfficer.allergies || '',
      uniform_size: selectedOfficer.uniform_size || '',
      dl_number: selectedOfficer.dl_number || '',
      dl_state: selectedOfficer.dl_state || '',
      dl_expiry: selectedOfficer.dl_expiry || '',
      notes: selectedOfficer.notes || '',
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

  const handleArchiveOfficer = async (officerId: string) => {
    try {
      await apiFetch(`/personnel/${officerId}/archive`, { method: 'POST' });
      addToast('Officer archived', 'success');
      if (selectedOfficer?.id === officerId) setSelectedOfficer(null);
      await fetchCoreData({ silent: true });
    } catch (err: any) {
      addToast(err?.message || 'Failed to archive officer', 'error');
    }
  };

  const handleUnarchiveOfficer = async (officerId: string) => {
    try {
      await apiFetch(`/personnel/${officerId}/unarchive`, { method: 'POST' });
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

  const handleClockIn = async (officerId: string) => {
    try {
      await apiFetch('/personnel/time/clock-in', { method: 'POST', body: JSON.stringify({ officer_id: officerId }) });
      const raw = await apiFetch<any[]>('/personnel/time');
      setTimeEntries((Array.isArray(raw) ? raw : []).map(mapTimeEntry));
      addToast('Clocked in', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to clock in', 'error');
    }
  };

  const handleClockOut = async (officerId: string) => {
    try {
      await apiFetch('/personnel/time/clock-out', { method: 'POST', body: JSON.stringify({ officer_id: officerId }) });
      const raw = await apiFetch<any[]>('/personnel/time');
      setTimeEntries((Array.isArray(raw) ? raw : []).map(mapTimeEntry));
      addToast('Clocked out', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to clock out', 'error');
    }
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

  const handleDeleteTimeEntry = async (entryId: string) => {
    if (!window.confirm('Delete this time entry? This cannot be undone.')) return;
    try {
      await apiFetch(`/personnel/time/${entryId}`, { method: 'DELETE' });
      const raw = await apiFetch<any[]>('/personnel/time');
      setTimeEntries((Array.isArray(raw) ? raw : []).map(mapTimeEntry));
      addToast('Time entry deleted', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to delete time entry', 'error');
    }
  };

  // ----------------------------------------------------------
  // Time Entry Edit Handlers
  // ----------------------------------------------------------

  const handleTimeEntryEdit = async (data: TimeEntryEditData) => {
    setIsSubmitting(true);
    try {
      await apiFetch(`/personnel/time/${data.id}`, {
        method: 'PUT',
        body: JSON.stringify({ clock_in: data.clock_in, clock_out: data.clock_out || null }),
      });
      setModal('none');
      setEditingTimeEntry(null);
      const raw = await apiFetch<any[]>('/personnel/time');
      setTimeEntries((Array.isArray(raw) ? raw : []).map(mapTimeEntry));
      addToast('Time entry updated', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to update time entry', 'error');
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

  const rosterList = (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search + New Officer */}
      <div className="p-3 border-b border-rmpg-600">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400 pointer-events-none" aria-hidden="true" />
            <input
              type="text"
              className="input-dark pl-9 w-full text-[11px] min-h-[36px] focus:ring-1 focus:ring-brand-500/50 focus:border-brand-600 transition-shadow duration-150"
              placeholder="Search by name, badge, rank, department..." aria-label="Search personnel by name, badge, rank, or department"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-white transition-colors duration-150" aria-label="Clear search">
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
          const isSelected = selectedOfficer?.id === officer.id;
          return (
            <div
              key={officer.id}
              onClick={() => { setSelectedOfficer(officer); setDetailTab('profile'); }}
              className={`panel-beveled mb-1 mx-2 p-3 cursor-pointer transition-all duration-200 border-l-2 focus-visible:ring-1 focus-visible:ring-brand-500/50 focus-visible:outline-none ${
                isSelected
                  ? 'bg-brand-900/15 border-l-brand-500 shadow-sm'
                  : 'bg-surface-base hover:brightness-110 hover:shadow-sm hover:border-rmpg-500 border-l-transparent'
              }`}
              role="option"
              tabIndex={0}
              aria-selected={isSelected}
              aria-label={`${officer.first_name} ${officer.last_name}, ${officer.role}, ${officer.status === 'on_duty' ? 'on duty' : 'off duty'}`}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedOfficer(officer); setDetailTab('profile'); } }}
            >
              <div className="flex items-center gap-3">
                <OfficerAvatar officer={officer} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-rmpg-100 truncate">
                      {officer.last_name}, {officer.first_name}
                    </span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold uppercase ${ROLE_COLORS[officer.role] || ROLE_COLORS.officer}`}>
                      {toDisplayLabel(officer.role)}
                    </span>
                    {hasExpired && <span className="led-dot led-red" />}
                    {!hasExpired && hasExpiring && <span className="led-dot led-amber" />}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-[10px] text-rmpg-400">
                    {officer.rank && <span>{officer.rank}</span>}
                    {officer.department && <span>{officer.department}</span>}
                    {officer.badge_number && <span className="font-mono text-[10px]">#{officer.badge_number}</span>}
                  </div>
                  <CredentialProgressBar credentials={officerCreds} />
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="flex items-center gap-1.5 justify-end">
                    <span className={officer.status === 'on_duty' ? 'led-dot led-green' : 'led-dot led-off'} />
                    <span className={`text-[10px] font-bold uppercase ${
                      officer.status === 'on_duty' ? 'text-green-400' : 'text-rmpg-500'
                    }`}>
                      {officer.status === 'on_duty' ? 'ON DUTY' : 'OFF DUTY'}
                    </span>
                  </div>
                  {officer.shift_preference && (
                    <div className="text-[9px] text-rmpg-500 mt-0.5">{officer.shift_preference}</div>
                  )}
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
      onEditTimeEntry={openEditTimeEntry}
      onDeleteTimeEntry={handleDeleteTimeEntry}
      onClose={() => setSelectedOfficer(null)}
    />
  ) : (
    <PersonnelAnalyticsDashboard
      officers={officers}
      credentials={credentials}
      timeEntries={timeEntries}
      training={training}
    />
  );

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setEditingVideo(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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

      {/* Stats Bar — compact stat cards */}
      <div className={`panel-inset ${isMobile ? 'px-3 overflow-x-auto' : 'px-4'} py-1.5 border-b border-rmpg-600 flex items-center gap-3`} role="group" aria-label="Personnel statistics">
        <div className="flex items-center gap-1.5 px-2.5 py-1 panel-beveled bg-surface-base text-[10px] font-mono transition-colors duration-150 hover:border-green-700/40">
          <span className="led-dot led-green" aria-hidden="true" />
          <span className="text-rmpg-400 uppercase tracking-wider">Active</span>
          <span className="text-green-400 font-bold text-base ml-0.5">{onDutyCount}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 panel-beveled bg-surface-base text-[10px] font-mono transition-colors duration-150 hover:border-rmpg-500">
          <span className="led-dot led-off" aria-hidden="true" />
          <span className="text-rmpg-400 uppercase tracking-wider">Off Duty</span>
          <span className="text-rmpg-200 font-bold text-base ml-0.5">{offDutyCount}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 panel-beveled bg-surface-base text-[10px] font-mono transition-colors duration-150 hover:border-brand-600/40">
          <Clock className="w-3 h-3 text-brand-400" aria-hidden="true" />
          <span className="text-rmpg-400 uppercase tracking-wider">Clocked In</span>
          <span className="text-brand-400 font-bold text-base ml-0.5">{clockedInCount}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 panel-beveled bg-surface-base text-[10px] font-mono transition-colors duration-150 hover:border-rmpg-500">
          <BarChart3 className="w-3 h-3 text-rmpg-300" aria-hidden="true" />
          <span className="text-rmpg-400 uppercase tracking-wider">Hours</span>
          <span className="text-white font-bold text-base ml-0.5">{totalHoursThisPeriod.toFixed(1)}</span>
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-1 panel-beveled bg-surface-base text-[10px] font-mono transition-colors duration-150 hover:border-rmpg-500">
          <Users className="w-3 h-3 text-rmpg-300" aria-hidden="true" />
          <span className="text-rmpg-400 uppercase tracking-wider">Total</span>
          <span className="text-white font-bold text-base ml-0.5">{officers.length}</span>
        </div>
        {expiringCreds > 0 && (
          <div className="flex items-center gap-1.5 ml-auto px-2.5 py-1 panel-beveled border-l-2 border-l-amber-500 text-[10px]" role="alert">
            <span className="led-dot led-amber" aria-hidden="true" />
            <span className="text-amber-400 font-bold font-mono">{expiringCreds} credential alert{expiringCreds !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="tab-bar overflow-x-auto scrollbar-dark" role="tablist" aria-label="Personnel management tabs" style={{ scrollbarWidth: 'none' }}>
        {MAIN_TABS.map(tab => {
          const Icon = tab.icon;
          const count = tab.id === 'roster' ? officers.length
            : tab.id === 'duty_board' ? onDutyCount
            : tab.id === 'time' ? clockedInCount
            : tab.id === 'credentials' && expiringCreds > 0 ? expiringCreds
            : undefined;
          const alert = tab.id === 'credentials' && expiringCreds > 0;
          const isActive = activeTab === tab.id;
          return (
            <button type="button"
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => { setActiveTab(tab.id); if (tab.id !== 'roster') setSelectedOfficer(null); }}
              className={`tab-bar-item ${isActive ? 'active' : ''}`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-brand-400' : ''}`} />
              {tab.label}
              {count !== undefined && (
                <span className={`text-[8px] px-1 py-0.5 ml-0.5 font-mono ${
                  alert ? 'bg-amber-900/30 text-amber-400 border border-amber-700/30' : 'text-rmpg-500'
                }`}>
                  {count}
                </span>
              )}
              {alert && <span className="led-dot led-amber" />}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scrollbar-dark flex">
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

        {/* Roster Tab with Split Panel */}
        {!loading && !error && activeTab === 'roster' && (
          <SplitPanel
            persistKey="personnel"
            initialRatio={0.4}
            minLeftPx={300}
            minRightPx={400}
            rightVisible={true}
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

        {!loading && !error && activeTab === 'calendar' && (
          <CalendarTab />
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
          />
        )}

        {!loading && !error && activeTab === 'dash_cameras' && (
          <DashCameraTab
            dashcamEvents={dashcamEvents}
            deviceMappings={deviceMappings}
            loading={dashcamLoading}
            onSelectOfficer={officerId => {
              const officer = officers.find(o => o.id === officerId);
              if (officer) { setActiveTab('roster'); setSelectedOfficer(officer); setDetailTab('dash_cameras'); }
            }}
            onRefresh={refreshDashcamData}
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

        {!loading && !error && activeTab === 'analytics' && (
          <AnalyticsTab analytics={analytics} loading={analyticsLoading} />
        )}
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
    </div>
  );
}

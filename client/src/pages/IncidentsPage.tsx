import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Plus,
  Search,
  FileText,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  X,
  Save,
  CheckCircle,
  RotateCcw,
  Trash2,
  Loader2,
  UserPlus,
  Car,
  Package,
  ExternalLink,
  MapPin,
  Shield,
  Archive,
  ChevronRight,
  Building2,
  AlertTriangle,
  Heart,
  Flame,
  Eye,
  Link,
} from 'lucide-react';
import type { Incident, IncidentType, CallPriority, IncidentStatus, IncidentPerson, IncidentVehicle } from '../types';
import StatusBadge from '../components/StatusBadge';
import IncidentFormModal, { type IncidentFormData } from '../components/IncidentFormModal';
import ConfirmDialog from '../components/ConfirmDialog';
import FileAttachments from '../components/FileAttachments';
import LinkPersonModal from '../components/LinkPersonModal';
import LinkVehicleModal from '../components/LinkVehicleModal';
import EvidenceFormModal from '../components/EvidenceFormModal';
import CollapsibleSection from '../components/CollapsibleSection';
import SupplementFormModal from '../components/SupplementFormModal';
import type { SupplementFormData } from '../components/SupplementFormModal';
import PanelTitleBar from '../components/PanelTitleBar';
import SplitPanel from '../components/SplitPanel';
import { TableRowSkeleton } from '../components/Skeleton';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { usePersistedState } from '../hooks/usePersistedState';
import { formatIncidentType, type PdfReportType } from '../utils/caseNumbers';
import { openIncidentWindow } from '../utils/windowManager';
import ReportTypeSelector from '../components/ReportTypeSelector';
import { downloadPdfReport, generatePdfReportBlobUrl } from '../utils/pdfGenerator';
import { fetchEntityImages } from '../utils/pdfImageHelpers';
import DocumentViewer from '../components/DocumentViewer';
import ExportButton from '../components/ExportButton';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import { useToast } from '../components/ToastProvider';
import FloatingSaveBar from '../components/FloatingSaveBar';
import { formatDate, formatDateTime } from '../utils/dateUtils';
import { useIsMobile } from '../hooks/useIsMobile';
import WarrantBadge from '../components/WarrantBadge';
import NarrativeAssist from '../components/dispatch/NarrativeAssist';
import { humanizeStatus, humanizePriority, getStatusTooltip, formatAddressDisplay } from '../utils/statusLabels';

// ============================================================
// Backend -> Frontend mapping
// ============================================================

function mapDbIncident(row: any): Incident & Record<string, any> {
  return {
    // Spread all DB columns first so flags, PSO fields, contract_id,
    // section/zone/beat, etc. flow through without explicit listing
    ...row,
    // Override fields that need type coercion or renaming
    id: String(row.id),
    incident_number: row.incident_number ?? '',
    call_id: row.call_id ?? undefined,
    call_number: row.call_number ?? undefined,
    type: (row.incident_type ?? 'other') as IncidentType,
    priority: (row.priority ?? 'P3') as CallPriority,
    status: (row.status ?? 'draft') as IncidentStatus,
    title: `${formatIncidentType(row.incident_type ?? 'other')} - ${row.location_address ?? 'Unknown'}`,
    location: row.location_address ?? '',
    narrative: row.narrative ?? '',
    officer_id: row.officer_id ?? '',
    officer_name: row.officer_name ?? '',
    reviewer_id: row.supervisor_id ?? undefined,
    reviewer_name: row.supervisor_name ?? undefined,
    review_notes: row.review_notes ?? undefined,
    persons_involved: [],
    vehicles_involved: [],
    evidence_ids: [],
    media_urls: [],
    occurred_at: row.occurred_date || row.created_at || new Date().toISOString(),
    submitted_at: row.submitted_at ?? undefined,
    approved_at: row.approved_at ?? undefined,
    created_at: row.created_at ?? new Date().toISOString(),
    updated_at: row.updated_at ?? new Date().toISOString(),
    // Extended fields with defaults
    occurred_date: row.occurred_date ?? '',
    occurred_time: row.occurred_time ?? '',
    end_date: row.end_date ?? '',
    end_time: row.end_time ?? '',
    weather_conditions: row.weather_conditions ?? '',
    lighting_conditions: row.lighting_conditions ?? '',
    injuries: row.injuries ?? '',
    injury_description: row.injury_description ?? '',
    damage_estimate: row.damage_estimate ?? '',
    damage_description: row.damage_description ?? '',
    weapons_involved: row.weapons_involved ?? '',
    // Boolean coercion for flag fields (SQLite stores as 0/1)
    alcohol_involved: row.alcohol_involved === 1 || row.alcohol_involved === true,
    drugs_involved: row.drugs_involved === 1 || row.drugs_involved === true,
    domestic_violence: row.domestic_violence === 1 || row.domestic_violence === true,
    injuries_reported: row.injuries_reported === 1 || row.injuries_reported === true,
    mental_health_crisis: row.mental_health_crisis === 1 || row.mental_health_crisis === true,
    juvenile_involved: row.juvenile_involved === 1 || row.juvenile_involved === true,
    felony_in_progress: row.felony_in_progress === 1 || row.felony_in_progress === true,
    officer_safety_caution: row.officer_safety_caution === 1 || row.officer_safety_caution === true,
    k9_requested: row.k9_requested === 1 || row.k9_requested === true,
    ems_requested: row.ems_requested === 1 || row.ems_requested === true,
    fire_requested: row.fire_requested === 1 || row.fire_requested === true,
    hazmat: row.hazmat === 1 || row.hazmat === true,
    gang_related: row.gang_related === 1 || row.gang_related === true,
    evidence_collected: row.evidence_collected === 1 || row.evidence_collected === true,
    body_camera_active: row.body_camera_active === 1 || row.body_camera_active === true,
    photos_taken: row.photos_taken === 1 || row.photos_taken === true,
    trespass_issued: row.trespass_issued === 1 || row.trespass_issued === true,
    vehicle_pursuit: row.vehicle_pursuit === 1 || row.vehicle_pursuit === true,
    foot_pursuit: row.foot_pursuit === 1 || row.foot_pursuit === true,
    le_notified: row.le_notified === 1 || row.le_notified === true,
    supervisor_notified: row.supervisor_notified === 1 || row.supervisor_notified === true,
    disposition: row.disposition ?? '',
    zone_beat: row.zone_beat ?? '',
    responding_le_agency: row.responding_le_agency ?? '',
    le_case_number: row.le_case_number ?? '',
    property_name: row.property_name ?? '',
    client_id: row.client_id ? String(row.client_id) : undefined,
    client_name: row.client_name ?? undefined,
    call_type: row.call_type ?? undefined,
    call_created_at: row.call_created_at ?? undefined,
  };
}

// ============================================================
// Helpers
// ============================================================

// formatDate and formatDateTime imported from ../utils/dateUtils

// Enhancement 31: Incident type icons
const INCIDENT_TYPE_ICONS: Record<string, React.ElementType> = {
  accident: Car, traffic_accident: Car, vehicle_accident: Car,
  medical: Heart, medical_emergency: Heart, injury: Heart,
  use_of_force: Shield, force: Shield,
  fire: Flame, arson: Flame,
  surveillance: Eye, observation: Eye,
  theft: AlertTriangle, assault: AlertTriangle, burglary: AlertTriangle,
};

type SortKey = 'incident_number' | 'type' | 'priority' | 'status' | 'location' | 'officer_name' | 'occurred_at';

// Extracted outside component to avoid recreation on every render
function SortIcon({ colKey, sortKey, sortAsc }: { colKey: SortKey; sortKey: SortKey; sortAsc: boolean }) {
  if (sortKey !== colKey) return <ArrowUpDown className="w-3 h-3 text-rmpg-500" />;
  return sortAsc ? (
    <ChevronUp className="w-3 h-3 text-brand-400" />
  ) : (
    <ChevronDown className="w-3 h-3 text-brand-400" />
  );
}

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function IncidentsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isGodMode = user?.role === 'admin'; // Admin God Mode — unrestricted access
  const isMobile = useIsMobile();

  // ---------- data state ----------
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---------- UI state ----------
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [uofFilter, setUofFilter] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [sortKey, setSortKey] = usePersistedState<SortKey>('rmpg_incidents_sort', 'occurred_at');
  const [sortAsc, setSortAsc] = usePersistedState('rmpg_incidents_sort_asc', false);

  // Navigation guard — warn when editing unsaved narrative
  useUnsavedChanges(isEditing);

  // ---------- detail data state ----------
  const [detailPersons, setDetailPersons] = useState<IncidentPerson[]>([]);
  const [detailVehicles, setDetailVehicles] = useState<IncidentVehicle[]>([]);
  const [detailEvidence, setDetailEvidence] = useState<any[]>([]);
  const [showLinkPersonModal, setShowLinkPersonModal] = useState(false);
  const [showLinkVehicleModal, setShowLinkVehicleModal] = useState(false);
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);

  // ---------- supplements state ----------
  const [detailSupplements, setDetailSupplements] = useState<any[]>([]);
  const [supplementsLoading, setSupplementsLoading] = useState(false);
  const [supplementsError, setSupplementsError] = useState<string | null>(null);
  const [showSupplementModal, setShowSupplementModal] = useState(false);
  const [supplementSubmitting, setSupplementSubmitting] = useState(false);

  // ---------- Spillman Flex: offenses, officers, cross-references ----------
  const [detailOffenses, setDetailOffenses] = useState<any[]>([]);
  const [detailOfficers, setDetailOfficers] = useState<any[]>([]);
  const [detailLinks, setDetailLinks] = useState<any[]>([]);
  const [showAddOffenseModal, setShowAddOffenseModal] = useState(false);
  const [showAddOfficerModal, setShowAddOfficerModal] = useState(false);
  const [showAddLinkModal, setShowAddLinkModal] = useState(false);

  // ---------- chain of custody expansion ----------
  const [expandedCustody, setExpandedCustody] = useState<Set<string>>(new Set());

  // ---------- custody transfer modal ----------
  const [custodyTransfer, setCustodyTransfer] = useState<{ evidenceId: string; evidenceNumber: string; currentLocation: string } | null>(null);
  const [custodyAction, setCustodyAction] = useState<string>('transfer');
  const [custodyToLocation, setCustodyToLocation] = useState('');
  const [custodyNotes, setCustodyNotes] = useState('');
  const [custodySubmitting, setCustodySubmitting] = useState(false);

  const handleCustodyTransfer = async () => {
    if (!custodyTransfer) return;
    setCustodySubmitting(true);
    try {
      await apiFetch(`/records/evidence/${custodyTransfer.evidenceId}/chain-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: custodyAction,
          from_location: custodyTransfer.currentLocation || null,
          to_location: custodyToLocation || null,
          notes: custodyNotes || null,
        }),
      });
      addToast('Custody action recorded', 'success');
      setCustodyTransfer(null);
      setCustodyAction('transfer');
      setCustodyToLocation('');
      setCustodyNotes('');
      // Refresh evidence for the selected incident
      if (selectedIncident) {
        const evData = await apiFetch<any>(`/records/evidence?incident_id=${selectedIncident.id}`);
        setDetailEvidence(evData?.data || evData || []);
      }
    } catch {
      addToast('Network error', 'error');
    }
    setCustodySubmitting(false);
  };

  // ---------- toast ----------
  const { addToast } = useToast();

  // ---------- disposition codes from admin config ----------
  const [dispositionCodes, setDispositionCodes] = useState<{code: string; description: string; color?: string}[]>([]);
  // Clients list for client selector
  const [clientsList, setClientsList] = useState<{ id: string; name: string }[]>([]);

  // ---------- modal / dialog state ----------
  const [showFormModal, setShowFormModal] = useState(false);
  const [formDefaultType, setFormDefaultType] = useState<string>('');
  const [editingIncident, setEditingIncident] = useState<Incident | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Incident | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState('');
  const [pdfViewerTitle, setPdfViewerTitle] = useState('');

  // ref for the inline narrative textarea
  const narrativeRef = useRef<HTMLTextAreaElement>(null);

  const incidentDetailRef = useRef<HTMLDivElement>(null);

  // ── Refs for unmount auto-save (avoids stale closures in cleanup) ──
  const isEditingRef = useRef(isEditing);
  const selectedIncidentRef = useRef(selectedIncident);
  useEffect(() => { isEditingRef.current = isEditing; }, [isEditing]);
  useEffect(() => { selectedIncidentRef.current = selectedIncident; }, [selectedIncident]);

  // Auto-save unsaved narrative on component unmount (SPA navigation)
  useEffect(() => {
    return () => {
      if (!isEditingRef.current || !selectedIncidentRef.current) return;
      const narrative = narrativeRef.current?.value;
      if (narrative == null) return;
      // Use apiFetch for proper token refresh handling; keepalive ensures
      // the request completes even during page navigation
      apiFetch(`/incidents/${selectedIncidentRef.current.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ narrative }),
        keepalive: true,
      }).catch(() => { /* best-effort save */ });
    };
  }, []);

  // ============================================================
  // Fetch incidents
  // ============================================================

  const fetchIncidents = useCallback(async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) setError(null);
      const res = await apiFetch<{ data: any[]; pagination: any }>(`/incidents?limit=200&archived=${showArchived}`);
      setIncidents((Array.isArray(res?.data) ? res.data : []).map(mapDbIncident));
    } catch (err: any) {
      if (!options?.silent) setError(err.message ?? 'Failed to load incidents');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    fetchIncidents();
    // Fetch disposition codes from admin config
    apiFetch('/admin/config').then((cfg: any) => {
      const disps = (cfg.dispositions || [])
        .filter((d: any) => d.is_active)
        .map((d: any) => {
          try { return JSON.parse(d.config_value); } catch { return null; }
        })
        .filter(Boolean);
      setDispositionCodes(disps);
    }).catch((err) => { console.warn('[IncidentsPage] fetch disposition codes failed:', err); });
    // Fetch clients list for client selector
    apiFetch<any[]>('/admin/clients')
      .then((data) => setClientsList((Array.isArray(data) ? data : []).filter((c: any) => c.status === 'active').map((c: any) => ({ id: String(c.id), name: c.name }))))
      .catch((err) => { console.warn('[IncidentsPage] fetch clients list failed:', err); });
  }, [fetchIncidents]);

  // Live sync — auto-refresh when any device modifies incidents (silent to avoid unmounting UI)
  const silentRefreshIncidents = useCallback(() => fetchIncidents({ silent: true }), [fetchIncidents]);
  useLiveSync('incidents', silentRefreshIncidents);

  // Keep selectedIncident in sync after data refresh
  useEffect(() => {
    if (selectedIncident) {
      const updated = incidents.find((i) => i.id === selectedIncident.id);
      if (updated) {
        setSelectedIncident(updated);
      } else {
        setSelectedIncident(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incidents]);

  // Fetch full incident detail (linked persons, vehicles, evidence, offenses, officers, links) when selected
  const fetchIncidentDetail = useCallback(async (incidentId: string) => {
    try {
      const detail = await apiFetch<any>(`/incidents/${incidentId}`);
      setDetailPersons(detail.linked_persons || []);
      setDetailVehicles(detail.linked_vehicles || []);
      setDetailEvidence(detail.evidence || []);
      setSelectedIncident((prev) => prev ? { ...prev, call_type: detail.call_type, call_created_at: detail.call_created_at } as any : prev);
    } catch {
      setDetailPersons([]);
      setDetailVehicles([]);
      setDetailEvidence([]);
    }
    // Fetch Spillman Flex extended data (offenses, officers, cross-references)
    try {
      const [offenses, officers, links] = await Promise.all([
        apiFetch<any[]>(`/incidents/${incidentId}/offenses`).catch(() => []),
        apiFetch<any[]>(`/incidents/${incidentId}/officers`).catch(() => []),
        apiFetch<any[]>(`/incidents/${incidentId}/links`).catch(() => []),
      ]);
      setDetailOffenses(offenses || []);
      setDetailOfficers(officers || []);
      setDetailLinks(links || []);
    } catch {
      setDetailOffenses([]);
      setDetailOfficers([]);
      setDetailLinks([]);
    }
  }, []);

  // Fetch supplements for the selected incident
  const fetchSupplements = useCallback(async (incidentId: string) => {
    setSupplementsLoading(true);
    setSupplementsError(null);
    try {
      const res = await apiFetch<any>(`/incidents/${incidentId}/supplements`);
      setDetailSupplements(Array.isArray(res) ? res : res.data || []);
    } catch (err: any) {
      setSupplementsError(err?.message || 'Failed to load supplements');
      setDetailSupplements([]);
    } finally {
      setSupplementsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedIncident) {
      fetchIncidentDetail(selectedIncident.id);
      fetchSupplements(selectedIncident.id);
      setExpandedCustody(new Set());
    } else {
      setDetailPersons([]);
      setDetailVehicles([]);
      setDetailEvidence([]);
      setDetailSupplements([]);
      setDetailOffenses([]);
      setDetailOfficers([]);
      setDetailLinks([]);
    }
  }, [selectedIncident?.id, fetchIncidentDetail, fetchSupplements]);

  const handleUnlinkPerson = async (personId: string | number) => {
    if (!selectedIncident) return;
    try {
      await apiFetch(`/incidents/${selectedIncident.id}/persons/${personId}`, { method: 'DELETE' });
      fetchIncidentDetail(selectedIncident.id);
    } catch (err: any) {
      addToast(err?.message || 'Failed to unlink person', 'error');
    }
  };

  const handleUnlinkVehicle = async (vehicleId: string | number) => {
    if (!selectedIncident) return;
    try {
      await apiFetch(`/incidents/${selectedIncident.id}/vehicles/${vehicleId}`, { method: 'DELETE' });
      fetchIncidentDetail(selectedIncident.id);
    } catch (err: any) {
      addToast(err?.message || 'Failed to unlink vehicle', 'error');
    }
  };

  // ============================================================
  // CRUD helpers
  // ============================================================

  const handleCreate = async (data: IncidentFormData) => {
    try {
      setIsSubmitting(true);
      await apiFetch('/incidents', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      setShowFormModal(false);
      await fetchIncidents({ silent: true });
    } catch (err: any) {
      addToast(err.message ?? 'Failed to create incident', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (data: IncidentFormData) => {
    if (!editingIncident) return;
    try {
      setIsSubmitting(true);
      await apiFetch(`/incidents/${editingIncident.id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      setShowFormModal(false);
      setEditingIncident(undefined);
      await fetchIncidents({ silent: true });
    } catch (err: any) {
      addToast(err.message ?? 'Failed to update incident', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedIncident) return;
    const narrative = narrativeRef.current?.value ?? selectedIncident.narrative;
    try {
      setIsSubmitting(true);
      await apiFetch(`/incidents/${selectedIncident.id}`, {
        method: 'PUT',
        body: JSON.stringify({ narrative }),
      });
      setIsEditing(false);
      await fetchIncidents({ silent: true });
    } catch (err: any) {
      addToast(err.message ?? 'Failed to save draft', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitForReview = async () => {
    if (!selectedIncident) return;
    // Save narrative first if editing
    if (isEditing && narrativeRef.current) {
      try {
        await apiFetch(`/incidents/${selectedIncident.id}`, {
          method: 'PUT',
          body: JSON.stringify({ narrative: narrativeRef.current.value }),
        });
      } catch (err: any) {
        addToast(err.message ?? 'Failed to save before submitting', 'error');
        return;
      }
    }
    try {
      setIsSubmitting(true);
      await apiFetch(`/incidents/${selectedIncident.id}/submit`, {
        method: 'PUT',
      });
      setIsEditing(false);
      await fetchIncidents({ silent: true });
    } catch (err: any) {
      addToast(err.message ?? 'Failed to submit for review', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async () => {
    if (!selectedIncident) return;
    try {
      setIsSubmitting(true);
      await apiFetch(`/incidents/${selectedIncident.id}/approve`, {
        method: 'PUT',
      });
      await fetchIncidents({ silent: true });
    } catch (err: any) {
      addToast(err.message ?? 'Failed to approve incident', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReturn = async () => {
    if (!selectedIncident) return;
    const comments = window.prompt('Return comments (optional):');
    if (comments === null) return; // cancelled
    try {
      setIsSubmitting(true);
      await apiFetch(`/incidents/${selectedIncident.id}/return`, {
        method: 'PUT',
        body: JSON.stringify({ comments }),
      });
      await fetchIncidents({ silent: true });
    } catch (err: any) {
      addToast(err.message ?? 'Failed to return incident', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setIsDeleting(true);
      await apiFetch(`/incidents/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      if (selectedIncident?.id === deleteTarget.id) {
        setSelectedIncident(null);
        setIsEditing(false);
      }
      setDeleteTarget(null);
      await fetchIncidents({ silent: true });
    } catch (err: any) {
      addToast(err.message ?? 'Failed to delete incident', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  // ============================================================
  // Archive / Unarchive
  // ============================================================

  const handleArchiveIncident = async (incident: Incident) => {
    try {
      await apiFetch(`/incidents/${incident.id}/archive`, { method: 'POST' });
      addToast(`Archived ${incident.incident_number}`, 'success');
      setSelectedIncident(null);
      await fetchIncidents({ silent: true });
    } catch (err: any) {
      addToast(err?.message || 'Failed to archive incident', 'error');
    }
  };

  const handleUnarchiveIncident = async (incident: Incident) => {
    try {
      await apiFetch(`/incidents/${incident.id}/unarchive`, { method: 'POST' });
      addToast(`Unarchived ${incident.incident_number}`, 'success');
      setSelectedIncident(null);
      await fetchIncidents({ silent: true });
    } catch (err: any) {
      addToast(err?.message || 'Failed to unarchive incident', 'error');
    }
  };

  // ============================================================
  // Supplement CRUD
  // ============================================================

  const handleCreateSupplement = async (data: SupplementFormData) => {
    if (!selectedIncident) return;
    setSupplementSubmitting(true);
    try {
      await apiFetch(`/incidents/${selectedIncident.id}/supplements`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      setShowSupplementModal(false);
      addToast('Supplement created successfully', 'success');
      fetchSupplements(selectedIncident.id);
    } catch (err: any) {
      addToast(err?.message || 'Failed to create supplement', 'error');
    } finally {
      setSupplementSubmitting(false);
    }
  };

  const handleSubmitSupplement = async (supId: string) => {
    if (!selectedIncident) return;
    try {
      await apiFetch(`/incidents/${selectedIncident.id}/supplements/${supId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'submitted' }),
      });
      addToast('Supplement submitted for review', 'success');
      fetchSupplements(selectedIncident.id);
    } catch (err: any) {
      addToast(err?.message || 'Failed to submit supplement', 'error');
    }
  };

  const handleApproveSupplement = async (supId: string) => {
    if (!selectedIncident) return;
    try {
      await apiFetch(`/incidents/${selectedIncident.id}/supplements/${supId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'approved' }),
      });
      addToast('Supplement approved', 'success');
      fetchSupplements(selectedIncident.id);
    } catch (err: any) {
      addToast(err?.message || 'Failed to approve supplement', 'error');
    }
  };

  const handleDeleteSupplement = async (supId: string) => {
    if (!selectedIncident) return;
    try {
      await apiFetch(`/incidents/${selectedIncident.id}/supplements/${supId}`, {
        method: 'DELETE',
      });
      addToast('Supplement deleted', 'success');
      fetchSupplements(selectedIncident.id);
    } catch (err: any) {
      addToast(err?.message || 'Failed to delete supplement', 'error');
    }
  };

  // ============================================================
  // Sort
  // ============================================================

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  // SortIcon is now defined outside the component to prevent recreation on every render

  // ============================================================
  // Filter + sort
  // ============================================================

  const UOF_TYPES = ['use_of_force', 'assault', 'battery'];
  const filtered = incidents
    .filter((inc) => {
      if (uofFilter && !UOF_TYPES.includes(inc.type)) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        inc.incident_number.toLowerCase().includes(q) ||
        inc.title.toLowerCase().includes(q) ||
        inc.location.toLowerCase().includes(q) ||
        inc.officer_name.toLowerCase().includes(q) ||
        inc.type.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const aVal = a[sortKey] ?? '';
      const bVal = b[sortKey] ?? '';
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortAsc ? cmp : -cmp;
    });

  // ============================================================
  // Stats
  // ============================================================

  const incidentStats = {
    total: incidents.length,
    draft: incidents.filter(i => i.status === 'draft').length,
    submitted: incidents.filter(i => i.status === 'submitted').length,
    under_review: incidents.filter(i => i.status === 'under_review').length,
    approved: incidents.filter(i => i.status === 'approved').length,
    returned: incidents.filter(i => i.status === 'returned').length,
  };

  // ============================================================
  // Render
  // ============================================================

  // Build the table panel (left side)
  const tablePanel = (
    <div className="flex flex-col h-full panel-beveled bg-surface-base">
      {/* Header */}
      <PanelTitleBar title={showArchived ? `INCIDENT ARCHIVES (${filtered.length})` : `INCIDENT REPORTS (${filtered.length})`} icon={showArchived ? Archive : FileText}>
        <RmpgLogo height={16} iconOnly />
        <span className="toolbar-separator" />
        <ExportButton
          exportUrl={`/incidents/export?format=csv&archived=${showArchived}`}
          exportFilename="incidents_export.csv"
        />
        <PrintButton />
        <button type="button"
          onClick={() => setShowArchived(!showArchived)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors border ${
            showArchived
              ? 'bg-amber-900/40 text-amber-400 border-amber-700/50 hover:bg-amber-900/60'
              : 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600 hover:text-rmpg-200 hover:bg-rmpg-700'
          }`}
        >
          <Archive className="w-3 h-3" />
          {showArchived ? 'Archives' : 'Archives'}
        </button>
        {!showArchived && (
          <>
            <button type="button"
              onClick={() => setUofFilter(!uofFilter)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors border ${
                uofFilter
                  ? 'bg-red-900/40 text-red-400 border-red-700/50 hover:bg-red-900/60'
                  : 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600 hover:text-rmpg-200 hover:bg-rmpg-700'
              }`}
            >
              <Shield className="w-3 h-3" />
              UoF
            </button>
            <button type="button"
              className="toolbar-btn"
              style={{ color: '#f87171', borderColor: '#991b1b' }}
              onClick={() => {
                setEditingIncident(undefined);
                setFormDefaultType('use_of_force');
                setShowFormModal(true);
              }}
            >
              <Shield className="w-3.5 h-3.5" />
              New UoF Report
            </button>
            <button type="button"
              className="toolbar-btn toolbar-btn-primary print:hidden"
              onClick={() => {
                setEditingIncident(undefined);
                setFormDefaultType('');
                setShowFormModal(true);
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              New Incident
            </button>
          </>
        )}
      </PanelTitleBar>
      {showArchived && (
        <div className="px-4 py-1.5 bg-amber-900/20 border-b border-amber-700/40 flex items-center gap-2 flex-shrink-0">
          <Archive className="w-3 h-3 text-amber-400" />
          <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Showing archived incidents (read-only)</span>
          <button type="button" onClick={() => setShowArchived(false)} className="ml-auto text-[10px] text-amber-400 hover:text-amber-300 underline">Exit Archives</button>
        </div>
      )}
      <div className="px-4 py-2 border-b border-rmpg-600 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-500 pointer-events-none" />
          <input
            type="text"
            className={`input-dark pl-9 w-full focus:ring-1 focus:ring-brand-500/50 focus:border-brand-600 transition-shadow ${isMobile ? 'min-h-[44px] text-sm' : ''}`}
            placeholder={showArchived ? "Search archived incidents..." : "Search incidents..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-white transition-colors" aria-label="Clear search">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Quick Stats Bar */}
      {!showArchived && !loading && (
        <div className={`px-4 py-1.5 border-b border-rmpg-700/50 flex ${isMobile ? 'flex-wrap gap-2' : 'items-center gap-4'} text-[10px] font-mono flex-shrink-0`} style={{ background: '#050505' }}>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-rmpg-400">Draft:</span>
            <span className="text-amber-400 font-bold">{incidentStats.draft}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-rmpg-400">Submitted:</span>
            <span className="text-blue-400 font-bold">{incidentStats.submitted}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-purple-500" />
            <span className="text-rmpg-400">Review:</span>
            <span className="text-purple-400 font-bold">{incidentStats.under_review}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-rmpg-400">Approved:</span>
            <span className="text-green-400 font-bold">{incidentStats.approved}</span>
          </div>
          {incidentStats.returned > 0 && (
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-rmpg-400">Returned:</span>
              <span className="text-red-400 font-bold">{incidentStats.returned}</span>
            </div>
          )}
          <span className="ml-auto text-rmpg-500 tabular-nums">
            Showing {filtered.length} of {incidents.length}
          </span>
        </div>
      )}

      {/* Table / Loading / Error */}
      <div className="flex-1 overflow-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent" style={{ overscrollBehavior: 'contain' }}>
        {loading ? (
          <table className="table-dark">
            <thead className="sticky top-0 z-10">
              <tr>
                <th>IR #</th><th>Type</th><th>Priority</th><th>Status</th>{!isMobile && <th>Location</th>}{!isMobile && <th>Officer</th>}<th>Date</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => <TableRowSkeleton key={i} cols={isMobile ? 5 : 7} />)}
            </tbody>
          </table>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <AlertTriangle className="w-6 h-6 text-red-500/60" />
            <p className="text-xs text-red-400">{error}</p>
            <button type="button" onClick={() => fetchIncidents()} className="toolbar-btn text-[10px]">
              <RotateCcw className="w-3 h-3" /> Retry
            </button>
          </div>
        ) : (
          <table className="table-dark">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="cursor-pointer select-none" onClick={() => handleSort('incident_number')}>
                  <div className="flex items-center gap-1">
                    IR # <SortIcon colKey="incident_number" sortKey={sortKey} sortAsc={sortAsc} />
                  </div>
                </th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('type')}>
                  <div className="flex items-center gap-1">
                    Type <SortIcon colKey="type" sortKey={sortKey} sortAsc={sortAsc} />
                  </div>
                </th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('priority')}>
                  <div className="flex items-center gap-1">
                    Priority <SortIcon colKey="priority" sortKey={sortKey} sortAsc={sortAsc} />
                  </div>
                </th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('status')}>
                  <div className="flex items-center gap-1">
                    Status <SortIcon colKey="status" sortKey={sortKey} sortAsc={sortAsc} />
                  </div>
                </th>
                {!isMobile && <th className="cursor-pointer select-none" onClick={() => handleSort('location')}>
                  <div className="flex items-center gap-1">
                    Location <SortIcon colKey="location" sortKey={sortKey} sortAsc={sortAsc} />
                  </div>
                </th>}
                {!isMobile && <th className="cursor-pointer select-none" onClick={() => handleSort('officer_name')}>
                  <div className="flex items-center gap-1">
                    Officer <SortIcon colKey="officer_name" sortKey={sortKey} sortAsc={sortAsc} />
                  </div>
                </th>}
                <th className="cursor-pointer select-none" onClick={() => handleSort('occurred_at')}>
                  <div className="flex items-center gap-1">
                    Date <SortIcon colKey="occurred_at" sortKey={sortKey} sortAsc={sortAsc} />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inc) => (
                <tr
                  key={inc.id}
                  onClick={() => {
                    setSelectedIncident(inc);
                    setIsEditing(false);
                  }}
                  className={`cursor-pointer ${isMobile ? 'min-h-[48px]' : ''} ${
                    selectedIncident?.id === inc.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : ''
                  }`}
                >
                  <td className="font-bold text-white text-xs font-mono">{inc.incident_number}</td>
                  <td className="text-xs text-brand-400">
                    <span className="inline-flex items-center gap-1">
                      {(() => { const Icon = INCIDENT_TYPE_ICONS[inc.type] || FileText; return <Icon className="w-3 h-3 flex-shrink-0" />; })()}
                      {formatIncidentType(inc.type)}
                    </span>
                  </td>
                  <td>
                    <StatusBadge status={inc.priority} type="priority" size="sm" title={humanizePriority(inc.priority)} />
                  </td>
                  <td>
                    <StatusBadge status={inc.status} type="incident_status" size="sm" title={getStatusTooltip(inc.status, 'incident')} />
                  </td>
                  {!isMobile && <td className="text-xs text-rmpg-300 max-w-[200px] truncate">{formatAddressDisplay(inc.location)}</td>}
                  {!isMobile && <td className="text-xs text-rmpg-200">{inc.officer_name}</td>}
                  <td className="text-xs text-rmpg-300 font-mono">{formatDate(inc.occurred_at)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={isMobile ? 5 : 7} className="text-center py-12">
                    <FileText className="w-6 h-6 mx-auto mb-2 text-rmpg-600" />
                    <span className="text-[10px] text-rmpg-500 font-mono uppercase tracking-wider">No incidents found</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  // Build incident data object for PDF generation (used by both download and preview)
  // Async: fetches attachment images for embedding in the PDF
  const buildIncidentPdfData = async () => {
    // Fetch attachment images in parallel with building the data object
    let attachmentImages: any[] = [];
    try {
      attachmentImages = await fetchEntityImages('incident', selectedIncident!.id);
    } catch {
      // Graceful degradation — proceed without images
    }

    const inc = selectedIncident as any;
    const pdfData = {
      // Core fields
      incident_number: selectedIncident!.incident_number,
      incident_type: selectedIncident!.type,
      priority: selectedIncident!.priority,
      status: selectedIncident!.status,
      location: selectedIncident!.location,
      officer_name: selectedIncident!.officer_name,
      narrative: selectedIncident!.narrative,
      // Officer / property / client metadata
      badge_number: inc?.badge_number,
      property_name: inc?.property_name,
      client_name: inc?.client_name,
      call_number: inc?.call_number,
      // District / zone
      section_id: inc?.section_id,
      zone_id: inc?.zone_id,
      beat_id: inc?.beat_id,
      disposition: inc?.disposition,
      zone_beat: inc?.zone_beat,
      dispatch_code: inc?.dispatch_code,
      source: inc?.source,
      // Dates / times
      occurred_date: inc?.occurred_date,
      occurred_time: inc?.occurred_time,
      end_date: inc?.end_date,
      end_time: inc?.end_time,
      // Scene details
      weather_conditions: inc?.weather_conditions,
      lighting_conditions: inc?.lighting_conditions,
      scene_safety: inc?.scene_safety,
      injuries: inc?.injuries,
      injury_description: inc?.injury_description,
      damage_estimate: inc?.damage_estimate,
      damage_description: inc?.damage_description,
      weapons_involved: inc?.weapons_involved,
      direction_of_travel: inc?.direction_of_travel,
      // Incident-level flags (stored on incident)
      alcohol_involved: inc?.alcohol_involved,
      drugs_involved: inc?.drugs_involved,
      domestic_violence: inc?.domestic_violence,
      // Call-level flags (joined from linked call)
      injuries_reported: inc?.injuries_reported,
      mental_health_crisis: inc?.mental_health_crisis,
      juvenile_involved: inc?.juvenile_involved,
      felony_in_progress: inc?.felony_in_progress,
      officer_safety_caution: inc?.officer_safety_caution,
      gang_related: inc?.gang_related,
      hazmat: inc?.hazmat,
      body_camera_active: inc?.body_camera_active,
      evidence_collected: inc?.evidence_collected,
      photos_taken: inc?.photos_taken,
      supervisor_notified: inc?.supervisor_notified,
      le_notified: inc?.le_notified,
      trespass_issued: inc?.trespass_issued,
      vehicle_pursuit: inc?.vehicle_pursuit,
      foot_pursuit: inc?.foot_pursuit,
      k9_requested: inc?.k9_requested,
      ems_requested: inc?.ems_requested,
      fire_requested: inc?.fire_requested,
      // LE coordination
      responding_le_agency: inc?.responding_le_agency,
      le_case_number: inc?.le_case_number,
      // PSO / Process Service fields
      pso_service_type: inc?.pso_service_type,
      pso_attempt_number: inc?.pso_attempt_number,
      pso_requestor_name: inc?.pso_requestor_name,
      pso_requestor_phone: inc?.pso_requestor_phone,
      pso_requestor_email: inc?.pso_requestor_email,
      pso_billing_code: inc?.pso_billing_code,
      pso_authorization: inc?.pso_authorization,
      contract_id: inc?.contract_id,
      process_service_type: inc?.process_service_type,
      process_served_to: inc?.process_served_to,
      process_served_address: inc?.process_served_address,
      process_attempts: inc?.process_attempts,
      process_served_at: inc?.process_served_at,
      process_service_result: inc?.process_service_result,
      // Type-specific fields
      road_conditions: inc?.road_conditions,
      traffic_control: inc?.traffic_control,
      vehicle_1_info: inc?.vehicle_1_info,
      vehicle_2_info: inc?.vehicle_2_info,
      diagram_notes: inc?.diagram_notes,
      patient_status: inc?.patient_status,
      ems_transport: inc?.ems_transport,
      patient_vitals: inc?.patient_vitals,
      treatment_rendered: inc?.treatment_rendered,
      trespass_warning_issued: inc?.trespass_warning_issued,
      trespass_effective_date: inc?.trespass_effective_date,
      trespass_expiry_date: inc?.trespass_expiry_date,
      property_boundaries: inc?.property_boundaries,
      force_type: inc?.force_type,
      force_justification: inc?.force_justification,
      subject_injuries: inc?.subject_injuries,
      officer_injuries: inc?.officer_injuries,
      de_escalation_attempts: inc?.de_escalation_attempts,
      // Linked entities
      linked_persons: detailPersons.map((p) => ({
        first_name: p.first_name,
        last_name: p.last_name,
        role: p.role,
        dob: p.dob,
      })),
      linked_vehicles: detailVehicles.map((v) => ({
        plate_number: v.plate_number,
        state: v.state,
        year: v.year ? String(v.year) : undefined,
        color: v.color,
        make: v.make,
        model: v.model,
        role: v.role,
      })),
      evidence: detailEvidence.map((e: any) => ({
        evidence_number: e.evidence_number,
        evidence_type: e.evidence_type,
        description: e.description,
        storage_location: e.storage_location,
      })),
      attachment_images: attachmentImages.length > 0 ? attachmentImages : undefined,
      // Geo coordinates
      latitude: inc?.latitude,
      longitude: inc?.longitude,
      // Linked call details
      call_created_at: inc?.call_created_at,
      call_type: inc?.call_type,
      caller_name: inc?.caller_name,
      caller_phone: inc?.caller_phone,
      // Supplement reports (attached to this incident)
      supplements: detailSupplements.map((sup: any) => ({
        report_number: sup.report_number || '',
        report_type: sup.report_type || sup.type || '',
        subject: sup.subject || '',
        narrative: sup.narrative || '',
        author_name: sup.author_name || '',
        status: sup.status || '',
        created_at: sup.created_at || '',
      })),
    } as any;

    // Fetch officer's digital signature for PDF embedding
    try {
      const sigRes = await apiFetch<{ signature: string | null }>('/auth/signature');
      if (sigRes?.signature) pdfData._officerSignature = sigRes.signature;
    } catch { /* proceed without signature */ }

    // Fetch call notes from dispatch (for pre-narrative details)
    const callId = (selectedIncident as any)?.call_id;
    if (callId) {
      try {
        const callDetail = await apiFetch<any>(`/dispatch/calls/${callId}`);
        if (callDetail) {
          if (callDetail.caller_name) pdfData.caller_name = callDetail.caller_name;
          if (callDetail.caller_phone) pdfData.caller_phone = callDetail.caller_phone;
          // Build call notes from dispatch notes
          if (callDetail.notes?.length > 0) {
            pdfData.call_notes = callDetail.notes.map((n: any) =>
              `[${n.timestamp ? new Date(n.timestamp).toLocaleString() : ''}] ${n.author || 'System'}: ${n.text || ''}`
            ).join('\n');
          }
          // Inherit lat/lng from call if incident doesn't have them
          if (pdfData.latitude == null && callDetail.latitude != null) {
            pdfData.latitude = callDetail.latitude;
            pdfData.longitude = callDetail.longitude;
          }
        }
      } catch { /* call detail optional */ }

      // Fetch GPS breadcrumb trail (via linked call_id)
      try {
        const trail = await apiFetch<{
          points: any[];
          stats: { total_points: number; total_distance_miles: number; duration_minutes: number; avg_speed_mph: number; max_speed_mph: number; source_breakdown?: Record<string, number> };
        }>(`/dispatch/gps/call-trail/${callId}`);
        if (trail?.points?.length > 0) {
          pdfData.breadcrumb_trail = trail;
        }
      } catch { /* GPS data optional — proceed without */ }
    }

    return pdfData;
  };

  // Build the detail panel (right side)
  const inc = selectedIncident as any;
  const detailPanel = selectedIncident ? (
    <div ref={incidentDetailRef} className={`flex flex-col h-full overflow-hidden animate-slide-in-right${isEditing ? ' edit-mode-active' : ''}`}>
      {/* Detail Header */}
      <PanelTitleBar title={selectedIncident.incident_number} icon={FileText} className="flex-shrink-0" titleClassName="text-green-400 font-mono">
        <StatusBadge status={selectedIncident.priority} type="priority" size="sm" title={humanizePriority(selectedIncident.priority)} />
        <StatusBadge status={selectedIncident.status} type="incident_status" size="sm" title={getStatusTooltip(selectedIncident.status, 'incident')} />
        <button type="button"
          onClick={() => openIncidentWindow(selectedIncident.id)}
          className="toolbar-btn"
          title="Open in new window"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
        <ReportTypeSelector
            incidentType={selectedIncident.type}
            onSelect={async (reportType) => {
              const pdfData = await buildIncidentPdfData();
              await downloadPdfReport(reportType, pdfData);
            }}
            onPreview={async (reportType) => {
              try {
                if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
                const pdfData = await buildIncidentPdfData();
                const blobUrl = await generatePdfReportBlobUrl(reportType, pdfData);
                setPdfBlobUrl(blobUrl);
                setPdfViewerTitle(`${selectedIncident.incident_number} — ${reportType.replace(/_/g, ' ').toUpperCase()}`);
                setPdfViewerOpen(true);
              } catch (err) {
                console.error('[IncidentsPage] PDF preview failed:', err);
              }
            }}
            onSignAndExport={async (reportType, signature) => {
              const pdfData = await buildIncidentPdfData();
              pdfData._officerSignature = signature;
              await downloadPdfReport(reportType, pdfData);
            }}
          />
        <button type="button"
          onClick={() => {
            setSelectedIncident(null);
            setIsEditing(false);
          }}
          className="p-1 hover:bg-rmpg-700 text-rmpg-300"
        >
          <X className="w-4 h-4" />
        </button>
      </PanelTitleBar>

      {/* Enhancement 32: Approval workflow progress bar */}
      {(() => {
        const steps = ['draft', 'submitted', 'under_review', 'approved'] as const;
        const labels = ['Draft', 'Submitted', 'Review', 'Approved'];
        const currentIdx = steps.indexOf(selectedIncident.status as any);
        const idx = currentIdx >= 0 ? currentIdx : selectedIncident.status === 'returned' ? 1 : 0;
        return (
          <div className="flex items-center gap-0 px-4 py-2 border-b border-[#1e3048]" style={{ background: '#050505' }}>
            {labels.map((label, i) => (
              <div key={label} className="flex items-center flex-1">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${i <= idx ? 'bg-green-500' : 'bg-rmpg-600'}`} style={i <= idx ? { boxShadow: '0 0 4px #22c55e' } : {}} />
                <span className={`text-[8px] font-mono uppercase ml-1 ${i <= idx ? 'text-green-400 font-bold' : 'text-rmpg-500'}`}>{label}</span>
                {i < labels.length - 1 && <div className={`flex-1 h-px mx-1 ${i < idx ? 'bg-green-700' : 'bg-rmpg-700'}`} />}
              </div>
            ))}
          </div>
        );
      })()}

      {/* Detail Body — Collapsible Sections */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent p-4">
        {/* Returned Warning */}
        {selectedIncident.status === 'returned' && selectedIncident.review_notes && (
          <div className="p-3 bg-red-900/20 border border-red-700/40 mb-3">
            <p className="text-xs font-bold text-red-400 uppercase mb-1">
              Returned by {selectedIncident.reviewer_name}
            </p>
            <p className="text-sm text-red-300">{selectedIncident.review_notes}</p>
          </div>
        )}

        {/* Flags (always visible, no collapse) */}
        {(inc.alcohol_involved || inc.drugs_involved || inc.domestic_violence || inc.felony_in_progress ||
          inc.officer_safety_caution || inc.mental_health_crisis || inc.injuries_reported || inc.juvenile_involved ||
          inc.gang_related || inc.hazmat || inc.body_camera_active || inc.evidence_collected || inc.photos_taken ||
          inc.vehicle_pursuit || inc.foot_pursuit || inc.le_notified || inc.supervisor_notified ||
          inc.k9_requested || inc.ems_requested || inc.fire_requested || inc.trespass_issued) && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {inc.alcohol_involved && <span className="px-2 py-0.5 bg-amber-900/40 text-amber-300 text-[10px] uppercase font-bold border border-amber-700/40">Alcohol</span>}
            {inc.drugs_involved && <span className="px-2 py-0.5 bg-purple-900/40 text-purple-300 text-[10px] uppercase font-bold border border-purple-700/40">Drugs</span>}
            {inc.domestic_violence && <span className="px-2 py-0.5 bg-red-900/40 text-red-300 text-[10px] uppercase font-bold border border-red-700/40">DV</span>}
            {inc.felony_in_progress && <span className="px-2 py-0.5 bg-red-900/40 text-red-300 text-[10px] uppercase font-bold border border-red-700/40">Felony IP</span>}
            {inc.officer_safety_caution && <span className="px-2 py-0.5 bg-red-900/40 text-red-300 text-[10px] uppercase font-bold border border-red-700/40">Ofc Safety</span>}
            {inc.mental_health_crisis && <span className="px-2 py-0.5 bg-blue-900/40 text-blue-300 text-[10px] uppercase font-bold border border-blue-700/40">Mental Health</span>}
            {inc.injuries_reported && <span className="px-2 py-0.5 bg-orange-900/40 text-orange-300 text-[10px] uppercase font-bold border border-orange-700/40">Injuries</span>}
            {inc.juvenile_involved && <span className="px-2 py-0.5 bg-cyan-900/40 text-cyan-300 text-[10px] uppercase font-bold border border-cyan-700/40">Juvenile</span>}
            {inc.gang_related && <span className="px-2 py-0.5 bg-red-900/40 text-red-300 text-[10px] uppercase font-bold border border-red-700/40">Gang</span>}
            {inc.hazmat && <span className="px-2 py-0.5 bg-yellow-900/40 text-yellow-300 text-[10px] uppercase font-bold border border-yellow-700/40">HAZMAT</span>}
            {inc.body_camera_active && <span className="px-2 py-0.5 bg-green-900/40 text-green-300 text-[10px] uppercase font-bold border border-green-700/40">BWC</span>}
            {inc.evidence_collected && <span className="px-2 py-0.5 bg-green-900/40 text-green-300 text-[10px] uppercase font-bold border border-green-700/40">Evidence</span>}
            {inc.photos_taken && <span className="px-2 py-0.5 bg-green-900/40 text-green-300 text-[10px] uppercase font-bold border border-green-700/40">Photos</span>}
            {inc.trespass_issued && <span className="px-2 py-0.5 bg-amber-900/40 text-amber-300 text-[10px] uppercase font-bold border border-amber-700/40">Trespass</span>}
            {inc.vehicle_pursuit && <span className="px-2 py-0.5 bg-red-900/40 text-red-300 text-[10px] uppercase font-bold border border-red-700/40">Veh Pursuit</span>}
            {inc.foot_pursuit && <span className="px-2 py-0.5 bg-red-900/40 text-red-300 text-[10px] uppercase font-bold border border-red-700/40">Foot Pursuit</span>}
            {inc.k9_requested && <span className="px-2 py-0.5 bg-blue-900/40 text-blue-300 text-[10px] uppercase font-bold border border-blue-700/40">K9</span>}
            {inc.ems_requested && <span className="px-2 py-0.5 bg-blue-900/40 text-blue-300 text-[10px] uppercase font-bold border border-blue-700/40">EMS</span>}
            {inc.fire_requested && <span className="px-2 py-0.5 bg-orange-900/40 text-orange-300 text-[10px] uppercase font-bold border border-orange-700/40">Fire</span>}
            {inc.le_notified && <span className="px-2 py-0.5 bg-blue-900/40 text-blue-300 text-[10px] uppercase font-bold border border-blue-700/40">LE Notified</span>}
            {inc.supervisor_notified && <span className="px-2 py-0.5 bg-blue-900/40 text-blue-300 text-[10px] uppercase font-bold border border-blue-700/40">Supvr</span>}
          </div>
        )}

        {/* Source Call */}
        {selectedIncident.call_id && inc.call_number && (
          <div className="mb-3 px-3 py-2 bg-surface-sunken border border-rmpg-700">
            <label className="field-label" style={{ fontSize: '10px', letterSpacing: '0.05em' }}>SOURCE CALL</label>
            <div className="flex items-center gap-3 mt-0.5">
              <button type="button"
                onClick={() => navigate('/dispatch')}
                className="font-mono text-green-400 text-sm hover:text-green-300 hover:underline transition-colors"
              >
                {inc.call_number}
              </button>
              {inc.call_type && (
                <span className="text-xs text-rmpg-300">{inc.call_type}</span>
              )}
              {inc.call_created_at && (
                <span className="text-xs text-rmpg-400 font-mono">
                  {formatDateTime(inc.call_created_at)}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Incident Info */}
        <CollapsibleSection title="Incident Info" icon={FileText} defaultOpen>
          <div className="mb-2">
            <label className="field-label">Title:</label>
            <p className="text-sm text-white font-medium">{selectedIncident.title}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="field-label">Type:</label>
              <p className="text-sm text-brand-400">{formatIncidentType(selectedIncident.type)}</p>
            </div>
            <div>
              <label className="field-label">Linked Call:</label>
              {selectedIncident.call_number ? (
                <button type="button"
                  onClick={() => navigate('/dispatch')}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono font-bold text-cyan-400 bg-cyan-900/20 border border-cyan-700/40 hover:bg-cyan-900/40 transition-colors"
                  title="Go to dispatch"
                >
                  <ExternalLink className="w-3 h-3" />
                  {selectedIncident.call_number}
                </button>
              ) : (
                <p className="text-sm text-brand-300">None</p>
              )}
            </div>
            <div>
              <label className="field-label">Location:</label>
              <p className="text-sm text-rmpg-200">{formatAddressDisplay(selectedIncident.location)}</p>
              {inc.property_name && (
                <p className="text-[10px] text-rmpg-400 mt-0.5">{inc.property_name}</p>
              )}
              {selectedIncident.client_name && (
                <p className="text-[10px] text-brand-400 mt-0.5 flex items-center gap-1">
                  <Building2 className="w-3 h-3" />
                  {selectedIncident.client_name}
                </p>
              )}
            </div>
            <div>
              <label className="field-label">Officer:</label>
              <p className="text-sm text-rmpg-200">{selectedIncident.officer_name}{inc?.badge_number ? ` (#${inc.badge_number})` : ''}</p>
            </div>
            <div>
              <label className="field-label">Occurred:</label>
              <p className="text-sm text-rmpg-200">
                {inc.occurred_date
                  ? `${inc.occurred_date}${inc.occurred_time ? ' ' + inc.occurred_time : ''}`
                  : formatDateTime(selectedIncident.occurred_at)}
              </p>
            </div>
            <div>
              <label className="field-label">Created:</label>
              <p className="text-sm text-rmpg-300">{formatDateTime(selectedIncident.created_at)}</p>
            </div>
            {/* Enhancement 35: Last edited timestamp */}
            {selectedIncident.updated_at && selectedIncident.updated_at !== selectedIncident.created_at && (
              <div>
                <label className="field-label">Last Edited:</label>
                <p className="text-sm text-rmpg-300">{timeAgo(selectedIncident.updated_at)}</p>
              </div>
            )}
            {(inc.dispatch_code || inc.section_id || inc.zone_id || inc.beat_id) && (
              <div>
                <label className="field-label">District:</label>
                <div className="flex items-center gap-2 mt-0.5">
                  {inc.dispatch_code && (
                    <span className="text-[10px] font-bold font-mono text-amber-300 bg-amber-900/30 border border-amber-700/40 px-1.5 py-0.5 tracking-wide">
                      {inc.dispatch_code}
                    </span>
                  )}
                  <span className="text-sm text-rmpg-200">
                    {[inc.section_id, inc.zone_id, inc.beat_id].filter(Boolean).join(' / ')}
                  </span>
                </div>
              </div>
            )}
            {inc.disposition && (
              <div>
                <label className="field-label">Disposition:</label>
                <p className="text-sm text-rmpg-200">
                  <span className="inline-block px-1.5 py-0.5 bg-brand-900/40 text-brand-300 text-[11px] uppercase font-bold border border-brand-600/40 mr-1">
                    {(inc.disposition || '').replace(/_/g, ' ').toUpperCase()}
                  </span>
                  {(() => {
                    const match = dispositionCodes.find((d) => d.code === inc.disposition);
                    return match ? <span className="text-rmpg-300">{match.description}</span> : null;
                  })()}
                </p>
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* Scene Details */}
        {(inc.weather_conditions || inc.lighting_conditions || inc.injuries || inc.damage_estimate || inc.weapons_involved) && (
          <CollapsibleSection title="Scene Details" icon={MapPin} defaultOpen>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {inc.weather_conditions && (
                <div>
                  <label className="field-label">Weather:</label>
                  <p className="text-xs text-rmpg-200">{inc.weather_conditions}</p>
                </div>
              )}
              {inc.lighting_conditions && (
                <div>
                  <label className="field-label">Lighting:</label>
                  <p className="text-xs text-rmpg-200">{inc.lighting_conditions}</p>
                </div>
              )}
              {inc.injuries && inc.injuries !== 'none' && (
                <div>
                  <label className="field-label">Injuries:</label>
                  <p className="text-xs text-red-400">{inc.injuries}{inc.injury_description ? ` — ${inc.injury_description}` : ''}</p>
                </div>
              )}
              {inc.damage_estimate && (
                <div>
                  <label className="field-label">Damage Estimate:</label>
                  <p className="text-xs text-amber-400">${inc.damage_estimate}{inc.damage_description ? ` — ${inc.damage_description}` : ''}</p>
                </div>
              )}
              {inc.weapons_involved && (
                <div>
                  <label className="field-label">Weapons:</label>
                  <p className="text-xs text-red-400">{inc.weapons_involved}</p>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* LE Coordination */}
        {(inc.responding_le_agency || inc.le_case_number) && (
          <CollapsibleSection title="LE Coordination" icon={Shield} defaultOpen={false}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {inc.responding_le_agency && (
                <div>
                  <label className="field-label">Responding Agency:</label>
                  <p className="text-xs text-rmpg-200">{inc.responding_le_agency}</p>
                </div>
              )}
              {inc.le_case_number && (
                <div>
                  <label className="field-label">LE Case #:</label>
                  <p className="text-xs text-rmpg-200 font-mono">{inc.le_case_number}</p>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Process Service Details (from linked call) */}
        {(inc.process_service_type || inc.process_served_to || inc.process_attempts || inc.pso_service_type === 'process_service') && (
          <CollapsibleSection title="Process Service Details" icon={FileText} defaultOpen>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {inc.process_service_type && (
                <div>
                  <label className="field-label">Document Type:</label>
                  <p className="text-xs text-rmpg-200">{(inc.process_service_type || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</p>
                </div>
              )}
              {inc.process_served_to && (
                <div>
                  <label className="field-label">Serve To:</label>
                  <p className="text-xs text-rmpg-200">{inc.process_served_to}</p>
                </div>
              )}
              <div>
                <label className="field-label">Attempts:</label>
                <p className="text-xs text-rmpg-200 font-mono">{inc.process_attempts || 0}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
              {inc.process_served_address && (
                <div>
                  <label className="field-label">Service Address:</label>
                  <p className="text-xs text-rmpg-200">{formatAddressDisplay(inc.process_served_address)}</p>
                </div>
              )}
              {inc.process_served_at && (
                <div>
                  <label className="field-label">Served At:</label>
                  <p className="text-xs text-rmpg-200">{inc.process_served_at}</p>
                </div>
              )}
              {inc.process_service_result && (
                <div>
                  <label className="field-label">Result:</label>
                  <span className={`inline-block px-1.5 py-0.5 text-[10px] uppercase font-bold border ${
                    inc.process_service_result === 'served'
                      ? 'bg-green-900/40 text-green-400 border-green-600/40'
                      : inc.process_service_result === 'unable_to_serve'
                      ? 'bg-red-900/40 text-red-400 border-red-600/40'
                      : 'bg-amber-900/40 text-amber-400 border-amber-600/40'
                  }`}>
                    {(inc.process_service_result || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                  </span>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Narrative */}
        <CollapsibleSection title="Narrative" icon={FileText} defaultOpen>
          {isEditing ? (
            <>
              <textarea
                ref={narrativeRef}
                className="textarea-dark mt-1"
                rows={8}
                defaultValue={selectedIncident.narrative}
              />
              <NarrativeAssist
                notes={narrativeRef.current?.value || selectedIncident.narrative || ''}
                incidentType={selectedIncident.type}
                locationAddress={selectedIncident.location || ''}
                onAccept={(narrative) => {
                  if (narrativeRef.current) narrativeRef.current.value = narrative;
                }}
              />
            </>
          ) : (
            <>
              <p className="text-sm text-rmpg-200 leading-relaxed whitespace-pre-wrap">
                {selectedIncident.narrative || <span className="text-rmpg-500 italic">No narrative</span>}
              </p>
              {/* Enhancement 34: Narrative word count */}
              {selectedIncident.narrative && (
                <div className="text-[9px] text-rmpg-500 font-mono mt-1 text-right">
                  {selectedIncident.narrative.trim().split(/\s+/).filter(Boolean).length} words
                </div>
              )}
            </>
          )}
        </CollapsibleSection>

        {/* Persons Involved */}
        <CollapsibleSection
          title="Persons Involved"
          icon={UserPlus}
          count={detailPersons.length}
          defaultOpen
          actions={
            (isAdmin || isGodMode || ['draft', 'returned', 'submitted', 'approved'].includes(selectedIncident.status)) ? (
              <button type="button" onClick={() => setShowLinkPersonModal(true)} className="toolbar-btn toolbar-btn-primary print:hidden">
                <Plus className="w-3 h-3" /> Link
              </button>
            ) : undefined
          }
        >
          {detailPersons.length > 0 ? (
            <div className="space-y-1.5">
              {detailPersons.map((lp) => {
                let flags: string[] = [];
                try { flags = JSON.parse(lp.flags || '[]'); } catch { /* ignore */ }
                return (
                  <div key={lp.id} className="flex items-center justify-between px-3 py-1.5 bg-surface-sunken border border-rmpg-700 group">
                    <div className="flex items-center gap-3">
                      <span className="px-1.5 py-0.5 bg-brand-900/40 text-brand-300 text-[10px] uppercase font-bold border border-brand-600/40">
                        {lp.role.replace(/_/g, ' ')}
                      </span>
                      <span className="text-sm text-white font-medium">{lp.last_name}, {lp.first_name}</span>
                      <WarrantBadge flags={lp.flags || '[]'} size="sm" />
                      {lp.dob && <span className="text-[11px] text-rmpg-400">DOB: {lp.dob}</span>}
                      {flags.map((f, i) => {
                        const flagText = typeof f === 'object' && f !== null ? (f as any).type || JSON.stringify(f) : String(f);
                        return (
                          <span key={`${flagText}-${i}`} className="px-1 py-0.5 bg-red-900/40 text-red-400 text-[10px] uppercase font-bold">
                            {flagText}
                          </span>
                        );
                      })}
                    </div>
                    {(isAdmin || isGodMode || ['draft', 'returned', 'submitted', 'approved'].includes(selectedIncident.status)) && (
                      <button type="button"
                        onClick={() => handleUnlinkPerson(lp.person_id)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-900/30 text-rmpg-400 hover:text-red-400 transition-all"
                        title="Unlink person"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-rmpg-500">No persons linked</p>
          )}
        </CollapsibleSection>

        {/* Vehicles Involved */}
        <CollapsibleSection
          title="Vehicles Involved"
          icon={Car}
          count={detailVehicles.length}
          defaultOpen
          actions={
            (isAdmin || isGodMode || ['draft', 'returned', 'submitted', 'approved'].includes(selectedIncident.status)) ? (
              <button type="button" onClick={() => setShowLinkVehicleModal(true)} className="toolbar-btn toolbar-btn-primary print:hidden">
                <Plus className="w-3 h-3" /> Link
              </button>
            ) : undefined
          }
        >
          {detailVehicles.length > 0 ? (
            <div className="space-y-1.5">
              {detailVehicles.map((lv) => (
                <div key={lv.id} className="flex items-center justify-between px-3 py-1.5 bg-surface-sunken border border-rmpg-700 group">
                  <div className="flex items-center gap-3">
                    <span className="px-1.5 py-0.5 bg-amber-900/40 text-amber-300 text-[10px] uppercase font-bold border border-amber-600/40">
                      {lv.role.replace(/_/g, ' ')}
                    </span>
                    <span className="text-sm text-white font-medium">
                      {lv.plate_number || 'No Plate'}{lv.state ? ` (${lv.state})` : ''}
                    </span>
                    <span className="text-[11px] text-rmpg-300">
                      {[lv.year, lv.color, lv.make, lv.model].filter(Boolean).join(' ')}
                    </span>
                    {lv.owner_first_name && (
                      <span className="text-[11px] text-rmpg-400">Owner: {lv.owner_first_name} {lv.owner_last_name}</span>
                    )}
                  </div>
                  {(isAdmin || isGodMode || ['draft', 'returned', 'submitted', 'approved'].includes(selectedIncident.status)) && (
                    <button type="button"
                      onClick={() => handleUnlinkVehicle(lv.vehicle_id)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-900/30 text-rmpg-400 hover:text-red-400 transition-all"
                      title="Unlink vehicle"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-rmpg-500">No vehicles linked</p>
          )}
        </CollapsibleSection>

        {/* ═══ Offenses (Spillman Flex) ═══ */}
        <CollapsibleSection
          title="Offenses / Charges"
          icon={AlertTriangle}
          count={detailOffenses.length}
          defaultOpen
          actions={
            (isAdmin || isGodMode || ['draft', 'returned', 'submitted', 'approved'].includes(selectedIncident.status)) ? (
              <button type="button" onClick={() => setShowAddOffenseModal(true)} className="toolbar-btn toolbar-btn-primary print:hidden">
                <Plus className="w-3 h-3" /> Add Offense
              </button>
            ) : undefined
          }
        >
          {detailOffenses.length > 0 ? (
            <div className="space-y-1.5">
              {detailOffenses.map((offense: any) => (
                <div key={offense.id} className="flex items-start gap-2 px-2 py-1.5 rounded-sm" style={{ background: '#0a0a0a', border: '1px solid #1e3048' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold" style={{ color: offense.offense_level === 'felony' ? '#ef4444' : offense.offense_level === 'misdemeanor' ? '#f59e0b' : '#666666' }}>
                        {offense.offense_code}
                      </span>
                      <span className="text-xs text-white font-medium truncate">{offense.description}</span>
                      <span className={`text-[8px] font-bold px-1 py-0.5 rounded-sm ${offense.offense_level === 'felony' ? 'bg-red-900/50 text-red-400 border border-red-700/50' : offense.offense_level === 'misdemeanor' ? 'bg-amber-900/50 text-amber-400 border border-amber-700/50' : 'bg-[#141e2b] text-gray-400 border border-gray-700'}`}>
                        {(offense.offense_level || 'other').toUpperCase()}
                      </span>
                      {offense.attempted_completed === 'attempted' && <span className="text-[8px] text-purple-400 bg-purple-900/30 px-1 py-0.5 rounded-sm border border-purple-700/30">ATTEMPTED</span>}
                      {offense.counts > 1 && <span className="text-[8px] text-blue-400">×{offense.counts}</span>}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-rmpg-400">
                      {offense.statute_number && <span className="font-mono">§{offense.statute_number}</span>}
                      {offense.ucr_code && <span>UCR: {offense.ucr_code}</span>}
                      {offense.suspect_first && <span className="text-red-300">Suspect: {offense.suspect_first} {offense.suspect_last}</span>}
                      {offense.victim_first && <span className="text-blue-300">Victim: {offense.victim_first} {offense.victim_last}</span>}
                      {offense.disposition && <span className="text-green-400">Disp: {offense.disposition}</span>}
                    </div>
                  </div>
                  {(isAdmin || isGodMode) && (
                    <button type="button" onClick={async () => {
                      if (!confirm('Remove this offense?')) return;
                      await apiFetch(`/incidents/${selectedIncident.id}/offenses/${offense.id}`, { method: 'DELETE' });
                      fetchIncidentDetail(selectedIncident.id);
                    }} className="p-0.5 text-rmpg-500 hover:text-red-400 print:hidden"><Trash2 className="w-3 h-3" /></button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-rmpg-500">No offenses recorded</p>
          )}
        </CollapsibleSection>

        {/* ═══ Responding Officers (Spillman Flex) ═══ */}
        <CollapsibleSection
          title="Responding Officers"
          icon={Shield}
          count={detailOfficers.length}
          defaultOpen
          actions={
            (isAdmin || isGodMode || ['draft', 'returned', 'submitted', 'approved'].includes(selectedIncident.status)) ? (
              <button type="button" onClick={() => setShowAddOfficerModal(true)} className="toolbar-btn toolbar-btn-primary print:hidden">
                <Plus className="w-3 h-3" /> Add Officer
              </button>
            ) : undefined
          }
        >
          {detailOfficers.length > 0 ? (
            <div className="space-y-1">
              {detailOfficers.map((officer: any) => (
                <div key={officer.id} className="flex items-center gap-2 px-2 py-1.5 rounded-sm" style={{ background: '#0a0a0a', border: '1px solid #1e3048' }}>
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-sm uppercase ${
                    officer.role === 'primary' ? 'bg-blue-900/60 text-blue-300 border border-blue-700/50' :
                    officer.role === 'supervisor' ? 'bg-purple-900/60 text-purple-300 border border-purple-700/50' :
                    officer.role === 'investigator' ? 'bg-amber-900/60 text-amber-300 border border-amber-700/50' :
                    'bg-[#141e2b] text-gray-400 border border-gray-700'
                  }`}>{officer.role}</span>
                  <span className="text-xs text-white font-medium">{officer.first_name} {officer.last_name}</span>
                  {officer.badge_number && <span className="text-[10px] font-mono text-rmpg-400">#{officer.badge_number}</span>}
                  {officer.call_sign && <span className="text-[10px] text-cyan-400">{officer.call_sign}</span>}
                  {officer.rank && <span className="text-[10px] text-rmpg-500">{officer.rank}</span>}
                  {officer.arrived_at && <span className="text-[9px] text-green-400 ml-auto">Arr: {new Date(officer.arrived_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>}
                  {officer.departed_at && <span className="text-[9px] text-rmpg-400">Dep: {new Date(officer.departed_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</span>}
                  {officer.action_taken && <span className="text-[9px] text-rmpg-400 truncate max-w-[120px]" title={officer.action_taken}>{officer.action_taken}</span>}
                  {(isAdmin || isGodMode) && (
                    <button type="button" onClick={async () => {
                      if (!confirm('Remove this officer?')) return;
                      await apiFetch(`/incidents/${selectedIncident.id}/officers/${officer.id}`, { method: 'DELETE' });
                      fetchIncidentDetail(selectedIncident.id);
                    }} className="p-0.5 text-rmpg-500 hover:text-red-400 print:hidden"><Trash2 className="w-3 h-3" /></button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-rmpg-500">No responding officers recorded</p>
          )}
        </CollapsibleSection>

        {/* ═══ Cross-References (Spillman Flex) ═══ */}
        <CollapsibleSection
          title="Cross-References"
          icon={Link}
          count={detailLinks.length}
          defaultOpen={false}
          actions={
            (isAdmin || isGodMode || ['draft', 'returned', 'submitted', 'approved'].includes(selectedIncident.status)) ? (
              <button type="button" onClick={() => setShowAddLinkModal(true)} className="toolbar-btn toolbar-btn-primary print:hidden">
                <Plus className="w-3 h-3" /> Link Record
              </button>
            ) : undefined
          }
        >
          {detailLinks.length > 0 ? (
            <div className="space-y-1">
              {detailLinks.map((link: any) => {
                const typeColors: Record<string, string> = { incident: '#888888', call: '#22c55e', case: '#a855f7', warrant: '#ef4444', citation: '#f59e0b', arrest: '#ec4899' };
                const typeLabels: Record<string, string> = { incident: 'Incident', call: 'CFS', case: 'Case', warrant: 'Warrant', citation: 'Citation', arrest: 'Arrest' };
                return (
                  <div key={link.id} className="flex items-center gap-2 px-2 py-1.5 rounded-sm" style={{ background: '#0a0a0a', border: '1px solid #1e3048' }}>
                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-sm uppercase" style={{ color: typeColors[link.linked_type] || '#666666', background: (typeColors[link.linked_type] || '#666666') + '20', border: `1px solid ${typeColors[link.linked_type] || '#666666'}40` }}>
                      {typeLabels[link.linked_type] || link.linked_type}
                    </span>
                    {link.detail ? (
                      <span className="text-xs text-white font-mono">
                        {link.detail.incident_number || link.detail.call_number || link.detail.case_number || link.detail.warrant_number || link.detail.citation_number || `#${link.linked_id}`}
                      </span>
                    ) : (
                      <span className="text-xs text-rmpg-400">#{link.linked_id}</span>
                    )}
                    {link.detail?.incident_type && <span className="text-[10px] text-rmpg-400">{link.detail.incident_type}</span>}
                    {link.detail?.status && <span className="text-[10px] text-rmpg-500 capitalize">{link.detail.status}</span>}
                    {link.link_reason && <span className="text-[9px] text-rmpg-400 italic ml-auto truncate max-w-[150px]">{link.link_reason}</span>}
                    {(isAdmin || isGodMode) && (
                      <button type="button" onClick={async () => {
                        if (!confirm('Remove this link?')) return;
                        await apiFetch(`/incidents/${selectedIncident.id}/links/${link.id}`, { method: 'DELETE' });
                        fetchIncidentDetail(selectedIncident.id);
                      }} className="p-0.5 text-rmpg-500 hover:text-red-400 print:hidden"><Trash2 className="w-3 h-3" /></button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-rmpg-500">No cross-references linked</p>
          )}
        </CollapsibleSection>

        {/* Evidence */}
        <CollapsibleSection
          title="Evidence"
          icon={Package}
          count={detailEvidence.length}
          defaultOpen
          actions={
            (isAdmin || isGodMode || ['draft', 'returned', 'submitted', 'approved'].includes(selectedIncident.status)) ? (
              <button type="button" onClick={() => setShowEvidenceModal(true)} className="toolbar-btn toolbar-btn-primary print:hidden">
                <Plus className="w-3 h-3" /> Add
              </button>
            ) : undefined
          }
        >
          {detailEvidence.length > 0 ? (
            <div className="space-y-1.5">
              {detailEvidence.map((ev: any) => {
                const custodyChain: any[] = (() => {
                  if (!ev.chain_of_custody) return [];
                  if (Array.isArray(ev.chain_of_custody)) return ev.chain_of_custody;
                  try { return JSON.parse(ev.chain_of_custody); } catch { return []; }
                })();
                const isExpanded = expandedCustody.has(String(ev.id));
                return (
                  <div key={ev.id} className="px-3 py-1.5 bg-surface-sunken border border-rmpg-700">
                    <div className="flex items-center gap-3">
                      <span className="px-1.5 py-0.5 bg-purple-900/40 text-purple-300 text-[10px] uppercase font-bold border border-purple-600/40">
                        {ev.evidence_type || 'physical'}
                      </span>
                      <span className="text-xs text-white font-mono font-bold">{ev.evidence_number}</span>
                      <span className="text-xs text-rmpg-300 flex-1 truncate">{ev.description}</span>
                      <button type="button"
                        className="toolbar-btn"
                        style={{ fontSize: '10px', padding: '2px 6px' }}
                        onClick={() => {
                          setCustodyTransfer({
                            evidenceId: String(ev.id),
                            evidenceNumber: ev.evidence_number || '',
                            currentLocation: ev.storage_location || '',
                          });
                          setCustodyAction('transfer');
                          setCustodyToLocation('');
                          setCustodyNotes('');
                        }}
                      >
                        Transfer Custody
                      </button>
                    </div>
                    {ev.storage_location && (
                      <p className="text-[11px] text-rmpg-400 mt-0.5 ml-[calc(1.5rem+0.75rem)]">
                        Storage: {ev.storage_location}
                      </p>
                    )}
                    {/* Chain of Custody */}
                    {custodyChain.length > 0 && (
                      <div className="mt-1.5">
                        <button type="button"
                          onClick={() => setExpandedCustody((prev) => {
                            const next = new Set(prev);
                            if (next.has(String(ev.id))) next.delete(String(ev.id));
                            else next.add(String(ev.id));
                            return next;
                          })}
                          className="flex items-center gap-1 text-[10px] text-rmpg-400 hover:text-rmpg-200 uppercase tracking-wider font-bold transition-colors"
                        >
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          Chain of Custody ({custodyChain.length})
                        </button>
                        {isExpanded && (
                          <div className="mt-1 ml-3 border-l border-rmpg-600 pl-3 space-y-1.5">
                            {custodyChain.map((entry: any) => (
                              <div key={`${entry.timestamp}-${entry.action}`} className="flex flex-col gap-0.5">
                                <span className="font-mono text-green-400" style={{ fontSize: '9px' }}>
                                  {entry.timestamp ? formatDateTime(entry.timestamp) : 'N/A'}
                                </span>
                                <span className="text-xs text-rmpg-200">
                                  {entry.action || 'Unknown action'}
                                  {(entry.from_person || entry.to_person) && (
                                    <span className="text-rmpg-400">
                                      {' '}{entry.from_person || '?'} &rarr; {entry.to_person || '?'}
                                    </span>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-rmpg-500">No evidence recorded</p>
          )}
        </CollapsibleSection>

        {/* Supplements */}
        <CollapsibleSection
          title="Supplements"
          icon={FileText}
          count={detailSupplements.length}
          defaultOpen={false}
          actions={
            <button type="button"
              className="toolbar-btn toolbar-btn-primary print:hidden"
              onClick={() => setShowSupplementModal(true)}
            >
              <Plus className="w-3 h-3" /> New Supplement
            </button>
          }
        >
          {supplementsLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-rmpg-400" role="status" aria-label="Loading" />
              <span className="text-xs text-rmpg-400">Loading supplements...</span>
            </div>
          ) : supplementsError ? (
            <p className="text-xs text-rmpg-500">{supplementsError}</p>
          ) : detailSupplements.length > 0 ? (
            <div className="space-y-2">
              {/* Summary row */}
              <div className="flex items-center gap-4 text-[10px] text-rmpg-400 pb-1 border-b border-rmpg-700/50">
                <span>Total: <strong className="text-white">{detailSupplements.length}</strong></span>
                <span>Draft: <strong className="text-amber-400">{detailSupplements.filter((s: any) => s.status === 'draft').length}</strong></span>
                <span>Submitted: <strong className="text-blue-400">{detailSupplements.filter((s: any) => s.status === 'submitted').length}</strong></span>
                <span>Approved: <strong className="text-green-400">{detailSupplements.filter((s: any) => s.status === 'approved').length}</strong></span>
              </div>
              {detailSupplements.map((sup: any) => {
                const statusColors: Record<string, string> = {
                  draft: 'border-l-amber-500',
                  submitted: 'border-l-blue-500',
                  approved: 'border-l-green-500',
                };
                const typeIcons: Record<string, string> = {
                  supplemental: 'SUP',
                  follow_up: 'F/U',
                  witness_statement: 'WIT',
                  forensic: 'FOR',
                  supervisor_review: 'SVR',
                };
                return (
                  <div key={sup.id || sup.report_number} className={`px-3 py-2.5 bg-surface-sunken border border-rmpg-700 border-l-2 ${statusColors[sup.status] || 'border-l-rmpg-600'}`}>
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 flex-shrink-0 flex items-center justify-center bg-rmpg-800 border border-rmpg-600 text-[8px] font-bold text-rmpg-300">
                        {typeIcons[(sup.report_type || sup.type)] || 'SUP'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-white font-mono font-bold">{sup.report_number || 'N/A'}</span>
                          {(sup.report_type || sup.type) && (
                            <span className="px-1.5 py-0.5 bg-brand-900/40 text-brand-300 text-[9px] uppercase font-bold border border-brand-600/40">
                              {(sup.report_type || sup.type || '').replace(/_/g, ' ')}
                            </span>
                          )}
                          {sup.status && (
                            <StatusBadge status={sup.status} type="incident_status" size="sm" />
                          )}
                        </div>
                        {sup.subject && (
                          <div className="mt-0.5 text-[11px] text-rmpg-200 font-medium">{sup.subject}</div>
                        )}
                      </div>
                      <div className="flex flex-col items-end text-right">
                        <span className="text-[10px] text-rmpg-300">{sup.author_name || ''}</span>
                        {sup.created_at && (
                          <span className="text-[9px] text-rmpg-500 font-mono">{formatDate(sup.created_at)}</span>
                        )}
                      </div>
                    </div>
                    {sup.narrative && (
                      <details className="mt-1.5 ml-9">
                        <summary className="text-[10px] text-brand-400 cursor-pointer hover:text-brand-300 select-none">
                          View narrative ({sup.narrative.length} chars)
                        </summary>
                        <div className="mt-1.5 p-2 bg-surface-deep border border-rmpg-700 text-[11px] text-rmpg-300 leading-relaxed whitespace-pre-wrap max-h-48 overflow-auto scrollbar-thin scrollbar-thumb-[#1e3048] scrollbar-track-transparent">
                          {sup.narrative}
                        </div>
                      </details>
                    )}
                    <div className="flex items-center gap-2 mt-2 ml-9">
                      {(sup.status === 'draft' || isAdmin || isGodMode) && (
                        <>
                          <button type="button" onClick={() => handleSubmitSupplement(String(sup.id))} className="toolbar-btn text-[9px]" style={{ padding: '2px 8px' }}>
                            <ChevronRight className="w-2.5 h-2.5 inline -ml-0.5 mr-0.5" />Submit for Review
                          </button>
                          <button type="button" onClick={() => handleDeleteSupplement(String(sup.id))} className="toolbar-btn toolbar-btn-danger text-[9px]" style={{ padding: '2px 8px' }}>Delete Draft</button>
                        </>
                      )}
                      {(sup.status === 'submitted' || isAdmin || isGodMode) && (
                        <button type="button" onClick={() => handleApproveSupplement(String(sup.id))} className="toolbar-btn toolbar-btn-success text-[9px]" style={{ padding: '2px 8px' }}>
                          <Shield className="w-2.5 h-2.5 inline -ml-0.5 mr-0.5" />Approve
                        </button>
                      )}
                      {sup.approved_by_name && (
                        <span className="text-[9px] text-green-400/70 ml-auto flex items-center gap-1">
                          <Shield className="w-2.5 h-2.5" />
                          Approved by {sup.approved_by_name}
                          {sup.approved_at && <span className="text-rmpg-500">({formatDate(sup.approved_at)})</span>}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-rmpg-500">No supplemental reports</p>
          )}
        </CollapsibleSection>

        {/* File Attachments */}
        <CollapsibleSection title="Attachments" defaultOpen={false}>
          <FileAttachments
            entityType="incident"
            entityId={selectedIncident.id}
            readOnly={!isGodMode && !isAdmin && !['draft', 'returned', 'submitted', 'approved'].includes(selectedIncident.status)}
          />
        </CollapsibleSection>
      </div>

      {/* Sticky Action Bar */}
      <div
        className="flex-shrink-0 px-4 py-2.5 border-t border-rmpg-600 flex items-center gap-2"
        style={{ background: 'linear-gradient(180deg, #141e2b 0%, #0d1520 100%)' }}
      >
        {!isEditing ? (
          <>
            {(isAdmin || ['draft', 'returned', 'submitted', 'approved'].includes(selectedIncident.status)) && (
              <>
                <button type="button"
                  onClick={() => {
                    setEditingIncident(selectedIncident);
                    setShowFormModal(true);
                  }}
                  className="toolbar-btn"
                >
                  Edit Report
                </button>
                <button type="button" onClick={() => setIsEditing(true)} className="toolbar-btn">
                  Edit Narrative
                </button>
              </>
            )}
            {(isAdmin || selectedIncident.status === 'draft') && (
              <button type="button"
                onClick={() => setDeleteTarget(selectedIncident)}
                className="toolbar-btn toolbar-btn-danger"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
            {(isAdmin || isGodMode || selectedIncident.status === 'submitted' || selectedIncident.status === 'under_review') && (
              <>
                <button type="button"
                  className="toolbar-btn toolbar-btn-success"
                  onClick={handleApprove}
                  disabled={isSubmitting}
                >
                  <CheckCircle className="w-3.5 h-3.5" /> Approve
                </button>
                <button type="button"
                  className="toolbar-btn toolbar-btn-danger"
                  onClick={handleReturn}
                  disabled={isSubmitting}
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Return
                </button>
              </>
            )}
            {/* Archive / Unarchive */}
            {!showArchived && (isAdmin || isGodMode || ['approved', 'closed'].includes(selectedIncident.status)) && (
              <button type="button"
                onClick={() => handleArchiveIncident(selectedIncident)}
                className="toolbar-btn"
                title="Archive this incident"
              >
                <Archive className="w-3.5 h-3.5" /> Archive
              </button>
            )}
            {showArchived && (
              <button type="button"
                onClick={() => handleUnarchiveIncident(selectedIncident)}
                className="toolbar-btn toolbar-btn-primary print:hidden"
                title="Unarchive this incident"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Unarchive
              </button>
            )}
          </>
        ) : (
          <>
            <button type="button"
              className="toolbar-btn toolbar-btn-primary print:hidden"
              onClick={handleSaveDraft}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" role="status" aria-label="Loading" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {selectedIncident && ['submitted', 'approved'].includes(selectedIncident.status) ? 'Save Changes' : 'Save Draft'}
            </button>
            {selectedIncident && (isAdmin || isGodMode || ['draft', 'returned'].includes(selectedIncident.status)) && (
              <button type="button"
                className="toolbar-btn toolbar-btn-success"
                onClick={handleSubmitForReview}
                disabled={isSubmitting}
              >
                Submit for Review
              </button>
            )}
            <button type="button" onClick={() => setIsEditing(false)} className="toolbar-btn">
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  ) : null;

  // Set document title
  useEffect(() => { document.title = 'Incident Reports \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowFormModal(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <SplitPanel
        left={tablePanel}
        right={detailPanel}
        initialRatio={0.55}
        persistKey="incidents-split"
        rightVisible={!!selectedIncident}
        className="flex-1"
      />

      {/* Create / Edit Modal */}
      <IncidentFormModal
        isOpen={showFormModal}
        onClose={() => {
          setShowFormModal(false);
          setEditingIncident(undefined);
          setFormDefaultType('');
        }}
        onSubmit={editingIncident ? handleUpdate : handleCreate}
        isSubmitting={isSubmitting}
        editingIncident={editingIncident}
        dispositionCodes={dispositionCodes}
        clients={clientsList}
        defaultType={formDefaultType}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Incident"
        message={`Are you sure you want to delete ${deleteTarget?.incident_number ?? 'this incident'}? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={isDeleting}
      />

      {/* Link Person Modal */}
      {selectedIncident && (
        <LinkPersonModal
          isOpen={showLinkPersonModal}
          onClose={() => setShowLinkPersonModal(false)}
          incidentId={selectedIncident.id}
          onLinked={() => fetchIncidentDetail(selectedIncident.id)}
        />
      )}

      {/* Link Vehicle Modal */}
      {selectedIncident && (
        <LinkVehicleModal
          isOpen={showLinkVehicleModal}
          onClose={() => setShowLinkVehicleModal(false)}
          incidentId={selectedIncident.id}
          onLinked={() => fetchIncidentDetail(selectedIncident.id)}
        />
      )}

      {/* Evidence Form Modal */}
      {selectedIncident && (
        <EvidenceFormModal
          isOpen={showEvidenceModal}
          onClose={() => setShowEvidenceModal(false)}
          incidentId={selectedIncident.id}
          onCreated={() => fetchIncidentDetail(selectedIncident.id)}
        />
      )}

      {/* Supplement Form Modal */}
      {selectedIncident && (
        <SupplementFormModal
          isOpen={showSupplementModal}
          onClose={() => setShowSupplementModal(false)}
          onSubmit={handleCreateSupplement}
          isSubmitting={supplementSubmitting}
          incidentNumber={selectedIncident.incident_number}
        />
      )}

      {/* Floating Save Bar (visible when editing narrative) */}
      <FloatingSaveBar
        visible={isEditing}
        onSave={handleSaveDraft}
        onCancel={() => setIsEditing(false)}
        isSaving={isSubmitting}
        saveLabel={selectedIncident && ['submitted', 'approved'].includes(selectedIncident.status) ? 'Save Changes' : 'Save Draft'}
        extraActions={
          selectedIncident && (isAdmin || isGodMode || ['draft', 'returned'].includes(selectedIncident.status)) ? (
            <button type="button"
              className="toolbar-btn toolbar-btn-success"
              onClick={handleSubmitForReview}
              disabled={isSubmitting}
              style={{ padding: '4px 12px' }}
            >
              Submit for Review
            </button>
          ) : undefined
        }
      />

      {/* PDF Preview Viewer */}
      <DocumentViewer
        isOpen={pdfViewerOpen}
        onClose={() => {
          setPdfViewerOpen(false);
          if (pdfBlobUrl) {
            URL.revokeObjectURL(pdfBlobUrl);
            setPdfBlobUrl('');
          }
        }}
        src={pdfBlobUrl}
        title={pdfViewerTitle}
        type="pdf"
      />

      {/* Custody Transfer Modal */}
      {custodyTransfer && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => setCustodyTransfer(null)}>
          <div
            className="bg-surface-raised border border-rmpg-600 shadow-xl w-[400px] max-w-[95vw]"
            style={{ borderRadius: 2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2.5 border-b border-rmpg-600 flex items-center justify-between">
              <h3 className="text-xs font-bold text-rmpg-100 uppercase tracking-wider">
                Custody Action — {custodyTransfer.evidenceNumber}
              </h3>
              <button type="button" onClick={() => setCustodyTransfer(null)} className="text-rmpg-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Action</label>
                <select
                  value={custodyAction}
                  onChange={(e) => setCustodyAction(e.target.value)}
                  className={`w-full px-2 ${isMobile ? 'py-2.5 text-sm min-h-[44px]' : 'py-1.5 text-xs'} bg-surface-sunken border border-rmpg-600 text-white`}
                  style={{ borderRadius: 2 }}
                >
                  <option value="transfer">Transfer</option>
                  <option value="check_in">Check In</option>
                  <option value="check_out">Check Out</option>
                  <option value="lab_submit">Submit to Lab</option>
                  <option value="release">Release</option>
                  <option value="dispose">Dispose</option>
                </select>
              </div>
              {custodyTransfer.currentLocation && (
                <div>
                  <label className="block text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">From Location</label>
                  <input
                    value={custodyTransfer.currentLocation}
                    readOnly
                    className={`w-full px-2 ${isMobile ? 'py-2.5 text-sm min-h-[44px]' : 'py-1.5 text-xs'} bg-surface-sunken border border-rmpg-700 text-rmpg-400`}
                    style={{ borderRadius: 2 }}
                  />
                </div>
              )}
              <div>
                <label className="block text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">To Location</label>
                <input
                  value={custodyToLocation}
                  onChange={(e) => setCustodyToLocation(e.target.value)}
                  placeholder="Evidence room, lab, officer name..."
                  className={`w-full px-2 ${isMobile ? 'py-2.5 text-sm min-h-[44px]' : 'py-1.5 text-xs'} bg-surface-sunken border border-rmpg-600 text-white placeholder-rmpg-500`}
                  style={{ borderRadius: 2 }}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-rmpg-400 uppercase tracking-wider mb-1">Notes</label>
                <textarea
                  value={custodyNotes}
                  onChange={(e) => setCustodyNotes(e.target.value)}
                  placeholder="Optional notes..."
                  rows={isMobile ? 3 : 2}
                  className={`w-full px-2 ${isMobile ? 'py-2.5 text-sm min-h-[80px]' : 'py-1.5 text-xs'} bg-surface-sunken border border-rmpg-600 text-white placeholder-rmpg-500 resize-none`}
                  style={{ borderRadius: 2 }}
                />
              </div>
            </div>
            <div className={`px-4 py-2.5 border-t border-rmpg-600 flex ${isMobile ? 'flex-col' : 'justify-end'} gap-2`}>
              <button type="button"
                onClick={() => setCustodyTransfer(null)}
                className={`toolbar-btn ${isMobile ? 'w-full min-h-[48px] text-sm justify-center' : 'px-3 py-1.5 text-[11px]'}`}
              >
                Cancel
              </button>
              <button type="button"
                onClick={handleCustodyTransfer}
                disabled={custodySubmitting}
                className={`toolbar-btn toolbar-btn-primary ${isMobile ? 'w-full min-h-[48px] text-sm justify-center' : 'px-3 py-1.5 text-[11px]'} flex items-center gap-1`}
              >
                {custodySubmitting ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <CheckCircle className="w-3 h-3" />}
                Record Action
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Add Offense Modal ═══ */}
      {showAddOffenseModal && selectedIncident && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => setShowAddOffenseModal(false)}>
          <form
            className="bg-surface-raised border border-rmpg-600 shadow-xl w-[500px] max-w-[95vw]"
            style={{ borderRadius: 2 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const data: Record<string, any> = {};
              fd.forEach((v, k) => { if (v) data[k] = v; });
              try {
                await apiFetch(`/incidents/${selectedIncident.id}/offenses`, { method: 'POST', body: JSON.stringify(data) });
                setShowAddOffenseModal(false);
                fetchIncidentDetail(selectedIncident.id);
              } catch { /* error */ }
            }}
          >
            <div className="px-4 py-2.5 border-b border-rmpg-600 flex items-center justify-between">
              <h3 className="text-xs font-bold text-rmpg-100 uppercase tracking-wider">Add Offense / Charge</h3>
              <button type="button" onClick={() => setShowAddOffenseModal(false)} className="text-rmpg-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">Offense Code *</label><input name="offense_code" required className="input-dark w-full text-xs" placeholder="e.g., 76-5-102" /></div>
                <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">Offense Level</label>
                  <select name="offense_level" className="input-dark w-full text-xs"><option value="misdemeanor">Misdemeanor</option><option value="felony">Felony</option><option value="infraction">Infraction</option><option value="other">Other</option></select>
                </div>
              </div>
              <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">Description *</label><input name="description" required className="input-dark w-full text-xs" placeholder="e.g., Assault — Class A Misdemeanor" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">UCR Code</label><input name="ucr_code" className="input-dark w-full text-xs" placeholder="e.g., 13A" /></div>
                <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">NIBRS Code</label><input name="nibrs_code" className="input-dark w-full text-xs" placeholder="e.g., 13A" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">Attempted/Completed</label>
                  <select name="attempted_completed" className="input-dark w-full text-xs"><option value="completed">Completed</option><option value="attempted">Attempted</option></select>
                </div>
                <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">Counts</label><input name="counts" type="number" min="1" defaultValue="1" className="input-dark w-full text-xs" /></div>
              </div>
              <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">Weapon / Force Used</label><input name="weapon_force" className="input-dark w-full text-xs" placeholder="e.g., Handgun, Knife, Personal weapons" /></div>
              <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">Notes</label><textarea name="notes" className="input-dark w-full text-xs" rows={2} /></div>
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-rmpg-600">
              <button type="button" onClick={() => setShowAddOffenseModal(false)} className="toolbar-btn">Cancel</button>
              <button type="submit" className="toolbar-btn toolbar-btn-primary flex items-center gap-1"><Plus className="w-3 h-3" /> Add Offense</button>
            </div>
          </form>
        </div>
      )}

      {/* ═══ Add Officer Modal ═══ */}
      {showAddOfficerModal && selectedIncident && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => setShowAddOfficerModal(false)}>
          <form
            className="bg-surface-raised border border-rmpg-600 shadow-xl w-[450px] max-w-[95vw]"
            style={{ borderRadius: 2 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const data: Record<string, any> = {};
              fd.forEach((v, k) => { if (v) data[k] = v; });
              try {
                await apiFetch(`/incidents/${selectedIncident.id}/officers`, { method: 'POST', body: JSON.stringify(data) });
                setShowAddOfficerModal(false);
                fetchIncidentDetail(selectedIncident.id);
              } catch { /* error */ }
            }}
          >
            <div className="px-4 py-2.5 border-b border-rmpg-600 flex items-center justify-between">
              <h3 className="text-xs font-bold text-rmpg-100 uppercase tracking-wider">Add Responding Officer</h3>
              <button type="button" onClick={() => setShowAddOfficerModal(false)} className="text-rmpg-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">Officer *</label>
                <select name="officer_id" required className="input-dark w-full text-xs">
                  <option value="">Select officer...</option>
                  {incidents.length > 0 && (() => {
                    // Use personnel from any loaded data
                    return null;
                  })()}
                </select>
                <p className="text-[9px] text-rmpg-500 mt-0.5">Enter officer user ID if dropdown is empty</p>
                <input name="officer_id" type="number" className="input-dark w-full text-xs mt-1" placeholder="Officer User ID" />
              </div>
              <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">Role</label>
                <select name="role" className="input-dark w-full text-xs">
                  <option value="responding">Responding</option>
                  <option value="primary">Primary</option>
                  <option value="backup">Backup</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="investigator">Investigator</option>
                  <option value="evidence_tech">Evidence Tech</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">Arrived At</label><input name="arrived_at" type="datetime-local" className="input-dark w-full text-xs" /></div>
                <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">Departed At</label><input name="departed_at" type="datetime-local" className="input-dark w-full text-xs" /></div>
              </div>
              <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">Action Taken</label><input name="action_taken" className="input-dark w-full text-xs" placeholder="e.g., Perimeter security, witness interview" /></div>
              <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">Notes</label><textarea name="notes" className="input-dark w-full text-xs" rows={2} /></div>
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-rmpg-600">
              <button type="button" onClick={() => setShowAddOfficerModal(false)} className="toolbar-btn">Cancel</button>
              <button type="submit" className="toolbar-btn toolbar-btn-primary flex items-center gap-1"><Plus className="w-3 h-3" /> Add Officer</button>
            </div>
          </form>
        </div>
      )}

      {/* ═══ Add Cross-Reference Link Modal ═══ */}
      {showAddLinkModal && selectedIncident && (
        <div className="fixed inset-0 z-50 print:hidden flex items-center justify-center bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => setShowAddLinkModal(false)}>
          <form
            className="bg-surface-raised border border-rmpg-600 shadow-xl w-[400px] max-w-[95vw]"
            style={{ borderRadius: 2 }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const data: Record<string, any> = {};
              fd.forEach((v, k) => { if (v) data[k] = v; });
              try {
                await apiFetch(`/incidents/${selectedIncident.id}/links`, { method: 'POST', body: JSON.stringify(data) });
                setShowAddLinkModal(false);
                fetchIncidentDetail(selectedIncident.id);
              } catch { /* error */ }
            }}
          >
            <div className="px-4 py-2.5 border-b border-rmpg-600 flex items-center justify-between">
              <h3 className="text-xs font-bold text-rmpg-100 uppercase tracking-wider">Link Record</h3>
              <button type="button" onClick={() => setShowAddLinkModal(false)} className="text-rmpg-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">Record Type *</label>
                <select name="linked_type" required className="input-dark w-full text-xs">
                  <option value="">Select type...</option>
                  <option value="incident">Incident Report</option>
                  <option value="call">Call for Service</option>
                  <option value="case">Case</option>
                  <option value="warrant">Warrant</option>
                  <option value="citation">Citation</option>
                  <option value="arrest">Arrest Record</option>
                </select>
              </div>
              <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">Record ID *</label>
                <input name="linked_id" type="number" required className="input-dark w-full text-xs" placeholder="Enter the record ID number" />
              </div>
              <div><label className="block text-[10px] font-bold text-rmpg-400 uppercase mb-1">Link Reason</label>
                <input name="link_reason" className="input-dark w-full text-xs" placeholder="e.g., Related incident, follow-up, same suspect" />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-rmpg-600">
              <button type="button" onClick={() => setShowAddLinkModal(false)} className="toolbar-btn">Cancel</button>
              <button type="submit" className="toolbar-btn toolbar-btn-primary flex items-center gap-1"><Link className="w-3 h-3" /> Link Record</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

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

// ============================================================
// Backend -> Frontend mapping
// ============================================================

function mapDbIncident(row: any): Incident & Record<string, any> {
  return {
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
    // New extended fields
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
    alcohol_involved: row.alcohol_involved === 1 || row.alcohol_involved === true,
    drugs_involved: row.drugs_involved === 1 || row.drugs_involved === true,
    domestic_violence: row.domestic_violence === 1 || row.domestic_violence === true,
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

export default function IncidentsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
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
      await apiFetch(`/api/records/evidence/${custodyTransfer.evidenceId}/chain-action`, {
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
        const evData = await apiFetch<any>(`/api/records/evidence?incident_id=${selectedIncident.id}`);
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
      const token = localStorage.getItem('rmpg_token');
      try {
        fetch(`/api/incidents/${selectedIncidentRef.current.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ narrative }),
          keepalive: true,
        });
      } catch { /* best-effort */ }
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
    }).catch(() => {});
    // Fetch clients list for client selector
    apiFetch<any[]>('/admin/clients')
      .then((data) => setClientsList((Array.isArray(data) ? data : []).filter((c: any) => c.status === 'active').map((c: any) => ({ id: String(c.id), name: c.name }))))
      .catch(() => {});
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

  // Fetch full incident detail (linked persons, vehicles, evidence) when selected
  const fetchIncidentDetail = useCallback(async (incidentId: string) => {
    try {
      const detail = await apiFetch<any>(`/incidents/${incidentId}`);
      setDetailPersons(detail.linked_persons || []);
      setDetailVehicles(detail.linked_vehicles || []);
      setDetailEvidence(detail.evidence || []);
      // Update call_type / call_created_at from detail if available
      setSelectedIncident((prev) => prev ? { ...prev, call_type: detail.call_type, call_created_at: detail.call_created_at } as any : prev);
    } catch {
      setDetailPersons([]);
      setDetailVehicles([]);
      setDetailEvidence([]);
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
        <button
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
            <button
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
            <button
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
            <button
              className="toolbar-btn toolbar-btn-primary"
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
          <button onClick={() => setShowArchived(false)} className="ml-auto text-[10px] text-amber-400 hover:text-amber-300 underline">Exit Archives</button>
        </div>
      )}
      <div className="px-4 py-2 border-b border-rmpg-600 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-rmpg-300" />
          <input
            type="text"
            className={`input-dark pl-9 ${isMobile ? 'min-h-[44px] text-sm' : ''}`}
            placeholder={showArchived ? "Search archived incidents..." : "Search incidents..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Quick Stats Bar */}
      {!showArchived && !loading && (
        <div className={`px-4 py-1.5 border-b border-rmpg-700/50 flex ${isMobile ? 'flex-wrap gap-2' : 'items-center gap-4'} text-[10px] font-mono flex-shrink-0`} style={{ background: '#0d1520' }}>
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
          <span className="ml-auto text-rmpg-500">
            Showing {filtered.length} of {incidents.length}
          </span>
        </div>
      )}

      {/* Table / Loading / Error */}
      <div className="flex-1 overflow-auto">
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
            <p className="text-sm text-red-400">{error}</p>
            <button onClick={() => fetchIncidents()} className="toolbar-btn">
              Retry
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
                  <td className="text-xs text-brand-400">{formatIncidentType(inc.type)}</td>
                  <td>
                    <StatusBadge status={inc.priority} type="priority" size="sm" />
                  </td>
                  <td>
                    <StatusBadge status={inc.status} type="incident_status" size="sm" />
                  </td>
                  {!isMobile && <td className="text-xs text-rmpg-300 max-w-[200px] truncate">{inc.location}</td>}
                  {!isMobile && <td className="text-xs text-rmpg-200">{inc.officer_name}</td>}
                  <td className="text-xs text-rmpg-300 font-mono">{formatDate(inc.occurred_at)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={isMobile ? 5 : 7} className="text-center text-rmpg-400 py-12">
                    No incidents found
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
      // Process Service fields (from linked call)
      pso_service_type: inc?.pso_service_type,
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
    } as any;

    // Fetch officer's digital signature for PDF embedding
    try {
      const sigRes = await apiFetch<{ signature: string | null }>('/auth/signature');
      if (sigRes?.signature) pdfData._officerSignature = sigRes.signature;
    } catch { /* proceed without signature */ }

    // Fetch GPS breadcrumb trail (via linked call_id)
    const callId = (selectedIncident as any)?.call_id;
    if (callId) {
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
        <StatusBadge status={selectedIncident.priority} type="priority" size="sm" />
        <StatusBadge status={selectedIncident.status} type="incident_status" size="sm" />
        <button
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
        <button
          onClick={() => {
            setSelectedIncident(null);
            setIsEditing(false);
          }}
          className="p-1 hover:bg-rmpg-700 text-rmpg-300"
        >
          <X className="w-4 h-4" />
        </button>
      </PanelTitleBar>

      {/* Detail Body — Collapsible Sections */}
      <div className="flex-1 overflow-y-auto p-4">
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
        {(inc.alcohol_involved || inc.drugs_involved || inc.domestic_violence) && (
          <div className="flex items-center gap-2 mb-3">
            {inc.alcohol_involved && (
              <span className="px-2 py-0.5 bg-amber-900/40 text-amber-300 text-[10px] uppercase font-bold border border-amber-700/40">Alcohol</span>
            )}
            {inc.drugs_involved && (
              <span className="px-2 py-0.5 bg-purple-900/40 text-purple-300 text-[10px] uppercase font-bold border border-purple-700/40">Drugs</span>
            )}
            {inc.domestic_violence && (
              <span className="px-2 py-0.5 bg-red-900/40 text-red-300 text-[10px] uppercase font-bold border border-red-700/40">Domestic Violence</span>
            )}
          </div>
        )}

        {/* Source Call */}
        {selectedIncident.call_id && inc.call_number && (
          <div className="mb-3 px-3 py-2 bg-surface-sunken border border-rmpg-700">
            <label className="field-label" style={{ fontSize: '10px', letterSpacing: '0.05em' }}>SOURCE CALL</label>
            <div className="flex items-center gap-3 mt-0.5">
              <button
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
                <button
                  onClick={() => navigate('/dispatch')}
                  className="text-sm text-brand-300 hover:text-brand-200 hover:underline transition-colors font-mono"
                >
                  {selectedIncident.call_number}
                </button>
              ) : (
                <p className="text-sm text-brand-300">None</p>
              )}
            </div>
            <div>
              <label className="field-label">Location:</label>
              <p className="text-sm text-rmpg-200">{selectedIncident.location}</p>
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
              <p className="text-sm text-rmpg-200">{selectedIncident.officer_name}</p>
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
                    {inc.disposition}
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
                  <p className="text-xs text-rmpg-200">{(inc.process_service_type || '').replace(/_/g, ' ')}</p>
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
                  <p className="text-xs text-rmpg-200">{inc.process_served_address}</p>
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
                    {(inc.process_service_result || '').replace(/_/g, ' ')}
                  </span>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* Narrative */}
        <CollapsibleSection title="Narrative" icon={FileText} defaultOpen>
          {isEditing ? (
            <textarea
              ref={narrativeRef}
              className="textarea-dark mt-1"
              rows={8}
              defaultValue={selectedIncident.narrative}
            />
          ) : (
            <p className="text-sm text-rmpg-200 leading-relaxed whitespace-pre-wrap">
              {selectedIncident.narrative || <span className="text-rmpg-500 italic">No narrative</span>}
            </p>
          )}
        </CollapsibleSection>

        {/* Persons Involved */}
        <CollapsibleSection
          title="Persons Involved"
          icon={UserPlus}
          count={detailPersons.length}
          defaultOpen
          actions={
            ['draft', 'returned', 'submitted', 'approved'].includes(selectedIncident.status) ? (
              <button onClick={() => setShowLinkPersonModal(true)} className="toolbar-btn toolbar-btn-primary">
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
                      {lp.dob && <span className="text-[11px] text-rmpg-400">DOB: {lp.dob}</span>}
                      {flags.map((f, i) => (
                        <span key={i} className="px-1 py-0.5 bg-red-900/40 text-red-400 text-[10px] uppercase font-bold">
                          {f}
                        </span>
                      ))}
                    </div>
                    {['draft', 'returned', 'submitted', 'approved'].includes(selectedIncident.status) && (
                      <button
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
            ['draft', 'returned', 'submitted', 'approved'].includes(selectedIncident.status) ? (
              <button onClick={() => setShowLinkVehicleModal(true)} className="toolbar-btn toolbar-btn-primary">
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
                  {['draft', 'returned', 'submitted', 'approved'].includes(selectedIncident.status) && (
                    <button
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

        {/* Evidence */}
        <CollapsibleSection
          title="Evidence"
          icon={Package}
          count={detailEvidence.length}
          defaultOpen
          actions={
            ['draft', 'returned', 'submitted', 'approved'].includes(selectedIncident.status) ? (
              <button onClick={() => setShowEvidenceModal(true)} className="toolbar-btn toolbar-btn-primary">
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
                      <button
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
                        <button
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
                            {custodyChain.map((entry: any, idx: number) => (
                              <div key={idx} className="flex flex-col gap-0.5">
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
            <button
              className="toolbar-btn toolbar-btn-primary"
              onClick={() => setShowSupplementModal(true)}
            >
              <Plus className="w-3 h-3" /> New Supplement
            </button>
          }
        >
          {supplementsLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-rmpg-400" />
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
                        <div className="mt-1.5 p-2 bg-surface-deep border border-rmpg-700 text-[11px] text-rmpg-300 leading-relaxed whitespace-pre-wrap max-h-48 overflow-auto">
                          {sup.narrative}
                        </div>
                      </details>
                    )}
                    <div className="flex items-center gap-2 mt-2 ml-9">
                      {sup.status === 'draft' && (
                        <>
                          <button onClick={() => handleSubmitSupplement(String(sup.id))} className="toolbar-btn text-[9px]" style={{ padding: '2px 8px' }}>
                            <ChevronRight className="w-2.5 h-2.5 inline -ml-0.5 mr-0.5" />Submit for Review
                          </button>
                          <button onClick={() => handleDeleteSupplement(String(sup.id))} className="toolbar-btn toolbar-btn-danger text-[9px]" style={{ padding: '2px 8px' }}>Delete Draft</button>
                        </>
                      )}
                      {sup.status === 'submitted' && (
                        <button onClick={() => handleApproveSupplement(String(sup.id))} className="toolbar-btn toolbar-btn-success text-[9px]" style={{ padding: '2px 8px' }}>
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
            readOnly={!isAdmin && !['draft', 'returned', 'submitted', 'approved'].includes(selectedIncident.status)}
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
                <button
                  onClick={() => {
                    setEditingIncident(selectedIncident);
                    setShowFormModal(true);
                  }}
                  className="toolbar-btn"
                >
                  Edit Report
                </button>
                <button onClick={() => setIsEditing(true)} className="toolbar-btn">
                  Edit Narrative
                </button>
              </>
            )}
            {(isAdmin || selectedIncident.status === 'draft') && (
              <button
                onClick={() => setDeleteTarget(selectedIncident)}
                className="toolbar-btn toolbar-btn-danger"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            )}
            {(selectedIncident.status === 'submitted' || selectedIncident.status === 'under_review') && (
              <>
                <button
                  className="toolbar-btn toolbar-btn-success"
                  onClick={handleApprove}
                  disabled={isSubmitting}
                >
                  <CheckCircle className="w-3.5 h-3.5" /> Approve
                </button>
                <button
                  className="toolbar-btn toolbar-btn-danger"
                  onClick={handleReturn}
                  disabled={isSubmitting}
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Return
                </button>
              </>
            )}
            {/* Archive / Unarchive */}
            {!showArchived && ['approved', 'closed'].includes(selectedIncident.status) && (
              <button
                onClick={() => handleArchiveIncident(selectedIncident)}
                className="toolbar-btn"
                title="Archive this incident"
              >
                <Archive className="w-3.5 h-3.5" /> Archive
              </button>
            )}
            {showArchived && (
              <button
                onClick={() => handleUnarchiveIncident(selectedIncident)}
                className="toolbar-btn toolbar-btn-primary"
                title="Unarchive this incident"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Unarchive
              </button>
            )}
          </>
        ) : (
          <>
            <button
              className="toolbar-btn toolbar-btn-primary"
              onClick={handleSaveDraft}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              {selectedIncident && ['submitted', 'approved'].includes(selectedIncident.status) ? 'Save Changes' : 'Save Draft'}
            </button>
            {selectedIncident && ['draft', 'returned'].includes(selectedIncident.status) && (
              <button
                className="toolbar-btn toolbar-btn-success"
                onClick={handleSubmitForReview}
                disabled={isSubmitting}
              >
                Submit for Review
              </button>
            )}
            <button onClick={() => setIsEditing(false)} className="toolbar-btn">
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  ) : null;

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
          selectedIncident && ['draft', 'returned'].includes(selectedIncident.status) ? (
            <button
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setCustodyTransfer(null)}>
          <div
            className="bg-surface-raised border border-rmpg-600 shadow-xl w-[400px] max-w-[95vw]"
            style={{ borderRadius: 2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2.5 border-b border-rmpg-600 flex items-center justify-between">
              <h3 className="text-xs font-bold text-rmpg-100 uppercase tracking-wider">
                Custody Action — {custodyTransfer.evidenceNumber}
              </h3>
              <button onClick={() => setCustodyTransfer(null)} className="text-rmpg-400 hover:text-white">
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
              <button
                onClick={() => setCustodyTransfer(null)}
                className={`toolbar-btn ${isMobile ? 'w-full min-h-[48px] text-sm justify-center' : 'px-3 py-1.5 text-[11px]'}`}
              >
                Cancel
              </button>
              <button
                onClick={handleCustodyTransfer}
                disabled={custodySubmitting}
                className={`toolbar-btn toolbar-btn-primary ${isMobile ? 'w-full min-h-[48px] text-sm justify-center' : 'px-3 py-1.5 text-[11px]'} flex items-center gap-1`}
              >
                {custodySubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                Record Action
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

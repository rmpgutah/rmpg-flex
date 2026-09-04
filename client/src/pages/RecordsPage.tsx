import React, { useState, useEffect, useCallback, useRef } from 'react';
import { withOneRetry } from '../utils/retryTransient';
import { useSearchParams } from 'react-router';
import {
  Database,
  UserCircle,
  Car,
  Building2,
  Package,
  Plus,
  Shield,
  Loader2,
  AlertTriangle,
  Archive,
  FlaskConical,
  Warehouse,
  DollarSign,
  X,
  Users,
  Briefcase,
  ScanLine,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { parseTimestamp } from '../utils/dateUtils';
import { recordTypeLabel } from '../utils/recordTypeLabel';
import { usePersistedTab } from '../hooks/usePersistedState';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import ConfirmDialog from '../components/ConfirmDialog';
import PanelTitleBar from '../components/PanelTitleBar';
import SplitPanel from '../components/SplitPanel';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import PrintRecordButton from '../components/PrintRecordButton';
import ExportButton, { downloadExport } from '../components/ExportButton';
import LinkRecordModal from '../components/LinkRecordModal';
import PersonDuplicatesModal from '../components/PersonDuplicatesModal';
import type { Person, Vehicle, Property, RecordEntityType } from '../types';
import { downloadTextFile, recordsIndexToCsv } from '../utils/rmsListExport';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import { AssessorBackfillButton } from '../components/AssessorBackfillButton';
import { AssessorReviewQueueBanner } from '../components/AssessorReviewQueueBanner';
import DlScanImportModal from '../components/DlScanImportModal';
import ErrorBoundary from '../components/ErrorBoundary';

// Tab hooks + components
import { usePersonsTab, PersonsTabList, PersonsTabDetail, mapDbPerson } from './records/PersonsTab';
import { useVehiclesTab, VehiclesTabList, VehiclesTabDetail, mapDbVehicle } from './records/VehiclesTab';
import { usePropertiesTab, PropertiesTabList, PropertiesTabDetail, mapDbProperty } from './records/PropertiesTab';
import { useEvidenceTab, EvidenceTabList, EvidenceTabDetail } from './records/EvidenceTab';
import { useBusinessTab, BusinessTabList, BusinessTabDetail } from './records/BusinessTab';
import SpillmanRecordTabs from './records/spillman/SpillmanRecordTabs';
import SpillmanMenuBar from './records/spillman/SpillmanMenuBar';
import SpillmanFormTabs from './records/spillman/SpillmanFormTabs';
import { RECORD_FORM_SECTIONS } from './records/spillman/recordFormSections';

// ============================================================
// Constants
// ============================================================

type TabId = 'persons' | 'vehicles' | 'properties' | 'businesses' | 'evidence';

// ============================================================
const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = parseTimestamp(date).getTime();
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

// Component
// ============================================================

export default function RecordsPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { user } = useAuth();
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';
  const [urlParams, setUrlParams] = useSearchParams();
  const [activeTab, setActiveTab] = usePersistedTab('rmpg_records_tab', 'persons' as TabId, ['persons', 'vehicles', 'properties', 'businesses', 'evidence'] as const);
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);

  // ── Cross-module URL deep-link contract ──
  // Accepts: ?tab=<persons|vehicles|properties|businesses|evidence>
  //          &record_id=<id> (generic alias when tab= is also set)
  //          &type=<persons|vehicles|properties|businesses|evidence> (alias for tab=)
  //          &person_id= | &vehicle_id= | &property_id= | &business_id= | &evidence_id=
  //          (legacy camelCase: personId, vehicleId, propertyId, businessId, evidenceId
  //           and `id` when paired with a `tab`)
  //          Desktop Launcher v2 (Task 14): dragging a person row onto the
  //          Records desktop icon opens a window at `/records?personId=<id>`
  //          (DesktopIconGrid.tsx's onDrop handler) — this already-existing
  //          `personId` legacy alias is what picks it up and auto-selects the
  //          person below once the list hydrates (or via the direct-fetch
  //          fallback for an archived/paged-out id). No new plumbing needed;
  //          don't remove `personId` support thinking it's unused legacy code.
  //          &q=<search box pre-fill>
  // On mount: pick the tab and remember the target id; once the hydrated list
  // contains it we auto-select that record and strip the params so a refresh
  // doesn't re-trigger. Pending id sits in pendingIdRef across re-renders.
  const pendingIdRef = useRef<{ tab: TabId; id: string } | null>(null);
  useEffect(() => {
    const tab = urlParams.get('tab') || urlParams.get('type');
    const q = urlParams.get('q');
    const validTab = tab && (['persons', 'vehicles', 'properties', 'businesses', 'evidence'] as const).includes(tab as TabId)
      ? (tab as TabId) : null;
    const recordId = urlParams.get('record_id');
    // Infer target tab from whichever *_id is present, even if tab= is omitted.
    const idByTab: Record<TabId, string | null> = {
      persons:    urlParams.get('person_id')   || urlParams.get('personId')   || (validTab === 'persons'    ? (recordId || urlParams.get('id')) : null),
      vehicles:   urlParams.get('vehicle_id')  || urlParams.get('vehicleId')  || (validTab === 'vehicles'   ? (recordId || urlParams.get('id')) : null),
      properties: urlParams.get('property_id') || urlParams.get('propertyId') || (validTab === 'properties' ? (recordId || urlParams.get('id')) : null),
      businesses: urlParams.get('business_id') || urlParams.get('businessId') || (validTab === 'businesses' ? (recordId || urlParams.get('id')) : null),
      evidence:   urlParams.get('evidence_id') || urlParams.get('evidenceId') || (validTab === 'evidence'   ? (recordId || urlParams.get('id')) : null),
    };
    // Pick the tab to land on: explicit tab=/type=, else the first *_id that's set.
    const tabsOrder: TabId[] = ['persons', 'vehicles', 'properties', 'businesses', 'evidence'];
    const inferredTab: TabId | null = validTab ?? tabsOrder.find((t) => idByTab[t]) ?? null;
    if (inferredTab) {
      setActiveTab(inferredTab);
      const targetId = idByTab[inferredTab];
      if (targetId) pendingIdRef.current = { tab: inferredTab, id: String(targetId) };
    }
    if (q) setSearchQuery(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount

  // Data state
  const [persons, setPersons] = useState<Person[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);

  // Loading / error
  const [loadingPersons, setLoadingPersons] = useState(false);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [loadingProperties, setLoadingProperties] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Retry fn for the current error — held in a ref so the banner can re-run the
  // exact list fetch that failed without threading a callback through state.
  // reportError(msg, retry) registers both; clearError wipes both.
  const errorRetryRef = useRef<(() => void) | null>(null);
  const clearError = useCallback(() => { errorRetryRef.current = null; setError(null); }, []);
  const reportError = useCallback((message: string, retry?: () => void) => {
    errorRetryRef.current = retry ?? null;
    setError(message);
  }, []);

  // Truncation warnings — set when server returns fewer records than total
  const [personsTruncated, setPersonsTruncated] = useState<{ returned: number; total: number } | null>(null);
  const [vehiclesTruncated, setVehiclesTruncated] = useState<{ returned: number; total: number } | null>(null);
  const [evidenceTruncated, setEvidenceTruncated] = useState<{ returned: number; total: number } | null>(null);

  // Evidence data
  const [evidence, setEvidence] = useState<any[]>([]);
  const [loadingEvidence, setLoadingEvidence] = useState(false);

  // Clients (for properties)
  const [clients, setClients] = useState<{ id: string; name: string; status: string }[]>([]);

  // Link modal state
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkSource, setLinkSource] = useState<{ type: RecordEntityType; id: string } | null>(null);
  const [linkRefreshKey, setLinkRefreshKey] = useState(0);

  // DL barcode scan-to-import
  const [showDlScan, setShowDlScan] = useState(false);

  // "New" record triggers
  const [newPersonTrigger, setNewPersonTrigger] = useState(0);
  const [newVehicleTrigger, setNewVehicleTrigger] = useState(0);
  const [newPropertyTrigger, setNewPropertyTrigger] = useState(0);
  const [newEvidenceTrigger, setNewEvidenceTrigger] = useState(0);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'person' | 'vehicle' | 'property' | 'business' | 'evidence'; id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Fetchers ─────────────────────────────────────────

  const fetchPersons = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoadingPersons(true); clearError(); }
    try {
      const res = await withOneRetry(() => apiFetch<{ data: Record<string, unknown>[]; pagination: { returned?: number; total?: number } }>(`/records/persons?limit=100000&archived=${showArchived}`));
      setPersons((Array.isArray(res?.data) ? res.data : []).map(mapDbPerson));
      const pg = res?.pagination as { returned?: number; total?: number } | undefined;
      if (pg && typeof pg.returned === 'number' && typeof pg.total === 'number' && pg.returned < pg.total) {
        setPersonsTruncated({ returned: pg.returned, total: pg.total });
      } else {
        setPersonsTruncated(null);
      }
    } catch (err) {
      if (!options?.silent) reportError(err instanceof Error ? err.message : 'Failed to load persons', () => { void fetchPersons(); });
    } finally {
      if (!options?.silent) setLoadingPersons(false);
    }
  }, [showArchived, clearError, reportError]);

  const fetchVehicles = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoadingVehicles(true); clearError(); }
    try {
      const res = await withOneRetry(() => apiFetch<{ data: Record<string, unknown>[]; pagination: { returned?: number; total?: number } }>(`/records/vehicles?limit=100000&archived=${showArchived}`));
      setVehicles((Array.isArray(res?.data) ? res.data : []).map(mapDbVehicle));
      const pg = res?.pagination as { returned?: number; total?: number } | undefined;
      if (pg && typeof pg.returned === 'number' && typeof pg.total === 'number' && pg.returned < pg.total) {
        setVehiclesTruncated({ returned: pg.returned, total: pg.total });
      } else {
        setVehiclesTruncated(null);
      }
    } catch (err) {
      if (!options?.silent) reportError(err instanceof Error ? err.message : 'Failed to load vehicles', () => { void fetchVehicles(); });
    } finally {
      if (!options?.silent) setLoadingVehicles(false);
    }
  }, [showArchived, clearError, reportError]);

  const fetchProperties = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoadingProperties(true); clearError(); }
    try {
      const res = await withOneRetry(() => apiFetch<Record<string, unknown>[]>(`/records/properties?archived=${showArchived}`));
      setProperties((Array.isArray(res) ? res : []).map(mapDbProperty));
    } catch (err) {
      if (!options?.silent) reportError(err instanceof Error ? err.message : 'Failed to load properties', () => { void fetchProperties(); });
    } finally {
      if (!options?.silent) setLoadingProperties(false);
    }
  }, [showArchived, clearError, reportError]);

  const fetchEvidence = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoadingEvidence(true);
    try {
      const res = await apiFetch<{ data: any[]; pagination: { returned?: number; total?: number } }>(`/records/evidence?limit=100000&archived=${showArchived}`);
      setEvidence(res?.data || []);
      const pg = res?.pagination as { returned?: number; total?: number } | undefined;
      if (pg && typeof pg.returned === 'number' && typeof pg.total === 'number' && pg.returned < pg.total) {
        setEvidenceTruncated({ returned: pg.returned, total: pg.total });
      } else {
        setEvidenceTruncated(null);
      }
    } catch {
      setEvidence([]);
      setEvidenceTruncated(null);
    } finally {
      if (!options?.silent) setLoadingEvidence(false);
    }
  }, [showArchived]);

  const fetchClients = useCallback(async () => {
    try {
      const res = await apiFetch<{ id: string; name: string; status: string }[]>('/records/clients');
      setClients(Array.isArray(res) ? res : []);
    } catch {
      setClients([]);
    }
  }, []);

  // Load all on mount
  useEffect(() => {
    fetchPersons();
    fetchVehicles();
    fetchProperties();
    fetchEvidence();
    fetchClients();
  }, [fetchPersons, fetchVehicles, fetchProperties, fetchEvidence, fetchClients]);

  // Live sync
  const silentRefreshAll = useCallback(() => {
    fetchPersons({ silent: true }); fetchVehicles({ silent: true }); fetchProperties({ silent: true }); fetchEvidence({ silent: true });
  }, [fetchPersons, fetchVehicles, fetchProperties, fetchEvidence]);
  useLiveSync('records', silentRefreshAll);

  // ── Link helpers ──────────────────────────────────────

  const openLinkModal = (type: RecordEntityType, id: string) => {
    setLinkSource({ type, id });
    setLinkModalOpen(true);
  };

  const handleLinked = () => {
    setLinkRefreshKey(prev => prev + 1);
  };

  // ── Delete ───────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const endpointMap: Record<string, string> = {
        person: `/records/persons/${deleteTarget.id}`,
        vehicle: `/records/vehicles/${deleteTarget.id}`,
        property: `/records/properties/${deleteTarget.id}`,
        business: `/records/businesses/${deleteTarget.id}`,
        evidence: `/records/evidence/${deleteTarget.id}`,
      };
      await apiFetch(endpointMap[deleteTarget.type], { method: 'DELETE' });
      setDeleteTarget(null);
      if (deleteTarget.type === 'person') {
        await fetchPersons({ silent: true });
      } else if (deleteTarget.type === 'vehicle') {
        await fetchVehicles({ silent: true });
      } else if (deleteTarget.type === 'property') {
        await fetchProperties({ silent: true });
      } else if (deleteTarget.type === 'business') {
        await businessState.fetchBusinesses();
      } else if (deleteTarget.type === 'evidence') {
        await fetchEvidence({ silent: true });
      }
      addToast('Record deleted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete record', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // ── Archive / Unarchive ──────────────────────────────

  const handleArchiveRecord = async (type: string, id: string) => {
    try {
      await apiFetch(`/records/${type}/${id}/archive`, { method: 'POST' });
      if (type === 'persons') { await fetchPersons(); }
      else if (type === 'vehicles') { await fetchVehicles(); }
      else if (type === 'properties') { await fetchProperties(); }
      else if (type === 'businesses') { await businessState.fetchBusinesses(); }
      else if (type === 'evidence') { await fetchEvidence(); }
      addToast('Record archived', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to archive record', 'error');
    }
  };

  const handleUnarchiveRecord = async (type: string, id: string) => {
    try {
      await apiFetch(`/records/${type}/${id}/unarchive`, { method: 'POST' });
      if (type === 'persons') { await fetchPersons(); }
      else if (type === 'vehicles') { await fetchVehicles(); }
      else if (type === 'properties') { await fetchProperties(); }
      else if (type === 'businesses') { await businessState.fetchBusinesses(); }
      else if (type === 'evidence') { await fetchEvidence(); }
      addToast('Record unarchived', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to unarchive record', 'error');
    }
  };

  // ════════════════════════════════════════════════════
  // ALL FOUR HOOKS — called unconditionally (React rules)
  // ════════════════════════════════════════════════════

  const personsState = usePersonsTab({
    searchQuery, setSearchQuery, showArchived, setError,
    persons, setPersons, loadingPersons, setLoadingPersons,
    deleteTarget, setDeleteTarget, linkRefreshKey,
    openLinkModal, handleArchiveRecord, handleUnarchiveRecord,
    fetchPersons, openNewTrigger: newPersonTrigger,
  });

  const vehiclesState = useVehiclesTab({
    searchQuery, setSearchQuery, showArchived, setError,
    vehicles, setVehicles, loadingVehicles, setLoadingVehicles,
    setDeleteTarget, linkRefreshKey,
    openLinkModal, handleArchiveRecord, handleUnarchiveRecord,
    fetchVehicles, openNewTrigger: newVehicleTrigger,
  });

  const propertiesState = usePropertiesTab({
    searchQuery, setSearchQuery, showArchived, setError,
    properties, setProperties, loadingProperties, setLoadingProperties,
    setDeleteTarget, linkRefreshKey,
    openLinkModal, handleArchiveRecord, handleUnarchiveRecord,
    fetchProperties, clients, openNewTrigger: newPropertyTrigger,
  });

  const evidenceState = useEvidenceTab({
    searchQuery, setSearchQuery, showArchived, setError,
    evidence, setEvidence, loadingEvidence, setLoadingEvidence,
    setDeleteTarget, linkRefreshKey,
    openLinkModal, handleArchiveRecord, handleUnarchiveRecord,
    fetchEvidence, openNewTrigger: newEvidenceTrigger,
  });

  const businessState = useBusinessTab({
    searchQuery, setSearchQuery, showArchived, setError, reportError,
    setDeleteTarget, linkRefreshKey,
    openLinkModal, handleArchiveRecord, handleUnarchiveRecord,
  });

  // ── Deep-link auto-select ──────────────────────────────
  // Once the active tab's list hydrates, find pendingIdRef and select that
  // record. Falls back to a direct fetch by id if the list doesn't contain
  // it (archived, paged-out, or fresh from a sibling page). Strips the
  // params on success so a refresh doesn't re-trigger; surfaces a toast
  // when the id truly misses everywhere.
  useEffect(() => {
    const pending = pendingIdRef.current;
    if (!pending || pending.tab !== activeTab) return;
    const stripParams = () => {
      const next = new URLSearchParams(urlParams);
      ['person_id', 'personId', 'vehicle_id', 'vehicleId', 'property_id', 'propertyId',
       'business_id', 'businessId', 'evidence_id', 'evidenceId', 'id', 'record_id', 'type'].forEach((k) => next.delete(k));
      setUrlParams(next, { replace: true });
    };
    const handleMissing = (label: string) => {
      pendingIdRef.current = null;
      addToast(`${label} not in the current view (try unarchiving or clearing filters)`, 'warning');
      stripParams();
    };

    if (pending.tab === 'persons') {
      if (loadingPersons) return;
      const hit = persons.find(p => String(p.id) === pending.id);
      if (hit) {
        pendingIdRef.current = null;
        personsState.setSelectedPerson(hit);
        stripParams();
        return;
      }
      // Direct-fetch fallback for archived/foreign/paged-out records.
      // Claim the slot immediately so this effect doesn't loop while
      // the fetch is in flight.
      pendingIdRef.current = null;
      (async () => {
        try {
          const full = await apiFetch<Record<string, unknown>>(`/records/persons/${pending.id}`);
          if (full && (full as any).id) {
            personsState.setSelectedPerson(mapDbPerson(full));
            stripParams();
            return;
          }
          handleMissing(`Person ${pending.id}`);
        } catch {
          handleMissing(`Person ${pending.id}`);
        }
      })();
    } else if (pending.tab === 'vehicles') {
      if (loadingVehicles) return;
      const hit = vehicles.find(v => String(v.id) === pending.id);
      if (hit) {
        pendingIdRef.current = null;
        vehiclesState.setSelectedVehicle(hit);
        stripParams();
        return;
      }
      handleMissing(`Vehicle ${pending.id}`);
    } else if (pending.tab === 'properties') {
      if (loadingProperties) return;
      const hit = properties.find(p => String(p.id) === pending.id);
      if (hit) {
        pendingIdRef.current = null;
        propertiesState.setSelectedProperty(hit);
        stripParams();
        return;
      }
      pendingIdRef.current = null;
      (async () => {
        try {
          const full = await apiFetch<Record<string, unknown>>(`/records/properties/${pending.id}`);
          if (full && (full as any).id) {
            propertiesState.setSelectedProperty(mapDbProperty(full));
            stripParams();
            return;
          }
          handleMissing(`Property ${pending.id}`);
        } catch {
          handleMissing(`Property ${pending.id}`);
        }
      })();
    } else if (pending.tab === 'businesses') {
      if (businessState.loading) return;
      const hit = businessState.businesses.find(b => String(b.id) === pending.id);
      if (hit) {
        pendingIdRef.current = null;
        businessState.setSelectedBusiness(hit);
        stripParams();
        return;
      }
      handleMissing(`Business ${pending.id}`);
    } else if (pending.tab === 'evidence') {
      if (loadingEvidence) return;
      const hit = evidence.find((e: any) => String(e.id) === pending.id);
      if (hit) {
        pendingIdRef.current = null;
        evidenceState.setSelectedEvidence(hit);
        stripParams();
        return;
      }
      handleMissing(`Evidence ${pending.id}`);
    }
  }, [
    activeTab,
    persons, loadingPersons, personsState,
    vehicles, loadingVehicles, vehiclesState,
    properties, loadingProperties, propertiesState,
    businessState,
    evidence, loadingEvidence, evidenceState,
    urlParams, setUrlParams, addToast,
  ]);

  // ── Derived ──────────────────────────────────────────

  const tabs: { id: TabId; label: string; icon: React.ElementType; count: number }[] = [
    { id: 'persons', label: 'Individuals', icon: UserCircle, count: persons.length },
    { id: 'vehicles', label: 'Vehicles', icon: Car, count: vehicles.length },
    { id: 'properties', label: 'Properties', icon: Building2, count: properties.length },
    { id: 'businesses', label: 'Business', icon: Briefcase, count: businessState.businesses.length },
    { id: 'evidence', label: 'Evidence', icon: Package, count: evidence.length },
  ];

  // Evidence summary stats
  const evidenceInStorage = evidence.filter(e => !e.disposal_method).length;
  const evidenceLabSubmitted = evidence.filter(e => e.lab_submitted).length;
  const evidenceTotalValue = evidence.reduce((sum: number, e: any) => sum + (Number(e.estimated_value) || 0), 0);

  // Determine if any selection exists for the right panel
  const hasSelection =
    (activeTab === 'persons' && personsState.selectedPerson !== null) ||
    (activeTab === 'vehicles' && vehiclesState.selectedVehicle !== null) ||
    (activeTab === 'properties' && propertiesState.selectedProperty !== null) ||
    (activeTab === 'businesses' && businessState.selectedBusiness !== null) ||
    (activeTab === 'evidence' && evidenceState.selectedEvidence !== null);

  // Selected record label for right PanelTitleBar
  const selectedLabel = (() => {
    if (activeTab === 'persons' && personsState.selectedPerson) {
      const p = personsState.selectedPerson;
      return `${p.last_name || ''}, ${p.first_name || ''}${p.middle_name ? ` ${p.middle_name[0]}.` : ''}`;
    }
    if (activeTab === 'vehicles' && vehiclesState.selectedVehicle) {
      return vehiclesState.selectedVehicle.license_plate;
    }
    if (activeTab === 'properties' && propertiesState.selectedProperty) {
      return propertiesState.selectedProperty.name;
    }
    if (activeTab === 'businesses' && businessState.selectedBusiness) {
      return businessState.selectedBusiness.name;
    }
    if (activeTab === 'evidence' && evidenceState.selectedEvidence) {
      return evidenceState.selectedEvidence.evidence_number;
    }
    return 'DETAIL';
  })();

  // Close the active selection (for right PanelTitleBar close button)
  const closeSelection = () => {
    if (activeTab === 'persons') personsState.setSelectedPerson(null);
    else if (activeTab === 'vehicles') vehiclesState.setSelectedVehicle(null);
    else if (activeTab === 'properties') propertiesState.setSelectedProperty(null);
    else if (activeTab === 'businesses') businessState.setSelectedBusiness(null);
    else if (activeTab === 'evidence') evidenceState.setSelectedEvidence(null);
  };

  // Get PrintRecordButton data for the selected record
  const selectedRecordForPrint = (() => {
    if (activeTab === 'persons' && personsState.selectedPerson) {
      const p = personsState.selectedPerson;
      return { recordType: 'person' as const, recordData: p, identifier: p.id, entityType: 'person' as const, entityId: p.id };
    }
    if (activeTab === 'vehicles' && vehiclesState.selectedVehicle) {
      const v = vehiclesState.selectedVehicle;
      return { recordType: 'vehicle' as const, recordData: v, identifier: v.license_plate, entityType: 'vehicle' as const, entityId: v.id };
    }
    if (activeTab === 'properties' && propertiesState.selectedProperty) {
      const p = propertiesState.selectedProperty;
      return { recordType: 'property' as const, recordData: p, identifier: p.name, entityType: 'property' as const, entityId: p.id };
    }
    if (activeTab === 'businesses' && businessState.selectedBusiness) {
      const b = businessState.selectedBusiness;
      return { recordType: 'business' as const, recordData: b, identifier: b.name, entityType: 'business' as const, entityId: b.id };
    }
    if (activeTab === 'evidence' && evidenceState.selectedEvidence) {
      const e = evidenceState.selectedEvidence;
      return { recordType: 'evidence' as const, recordData: e, identifier: e.evidence_number, entityType: 'evidence' as const, entityId: e.id };
    }
    return null;
  })();

  // ════════════════════════════════════════════════════
  // LEFT PANEL — PanelTitleBar + Tabs + Stats + List
  // ════════════════════════════════════════════════════

  const leftPanel = (
    <div className="h-full flex flex-col">
      {/* Panel Title Bar — RECORDS MANAGEMENT */}
      <PanelTitleBar title={showArchived ? 'RECORDS MGMT — ARCHIVES' : 'RECORDS MANAGEMENT'} icon={showArchived ? Archive : Database}>
        <RmpgLogo height={16} iconOnly />
        <span className="toolbar-separator" />
        <button
          type="button"
          className="toolbar-btn"
          onClick={() => {
            const rows =
              activeTab === 'persons' ? persons.map((p) => ({ type: 'person', number: String(p.id), status: showArchived ? 'archived' : 'active' }))
              : activeTab === 'vehicles' ? vehicles.map((v) => ({ type: 'vehicle', number: v.license_plate, status: v.stolen_status ?? '' }))
              : activeTab === 'properties' ? properties.map((p) => ({ type: 'property', number: String(p.id), status: showArchived ? 'archived' : 'active' }))
              : activeTab === 'evidence' ? evidence.map((e: { evidence_number?: string; status?: string; id?: string }) => ({ type: 'evidence', number: e.evidence_number ?? String(e.id ?? ''), status: e.status ?? '' }))
              : businessState.businesses.map((b: { id?: string; status?: string }) => ({ type: 'business', number: String(b.id ?? ''), status: b.status ?? '' }));
            downloadTextFile('records-index.csv', recordsIndexToCsv(rows));
          }}
        >CSV</button>
        <PrintButton />
        {activeTab === 'persons' && (
          <>
            <ExportButton exportUrl={`/records/persons/export?format=csv&archived=${showArchived}`} exportFilename="persons_export.csv" />
            <button type="button" className="toolbar-btn print:hidden text-amber-400" onClick={() => setShowDuplicatesModal(true)}>
              <Users className="w-3.5 h-3.5" />
              Duplicates
            </button>
            {!showArchived && (
              <button type="button" className="toolbar-btn print:hidden text-brand-400" title="Scan a driver's license barcode to import" onClick={() => setShowDlScan(true)}>
                <ScanLine className="w-3.5 h-3.5" />
                Scan ID
              </button>
            )}
            {!showArchived && isAdminOrManager && (
              <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={() => setNewPersonTrigger(t => t + 1)}>
                <Plus className="w-3.5 h-3.5" />
                New Person
              </button>
            )}
          </>
        )}
        {activeTab === 'vehicles' && (
          <>
            <ExportButton exportUrl={`/records/vehicles/export?format=csv&archived=${showArchived}`} exportFilename="vehicles_export.csv" />
            {!showArchived && isAdminOrManager && (
              <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={() => setNewVehicleTrigger(t => t + 1)}>
                <Plus className="w-3.5 h-3.5" />
                New Vehicle
              </button>
            )}
          </>
        )}
        {activeTab === 'properties' && (
          <>
            <AssessorBackfillButton isAdminOrManager={isAdminOrManager} />
            {!showArchived && isAdminOrManager && (
              <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={() => setNewPropertyTrigger(t => t + 1)}>
                <Plus className="w-3.5 h-3.5" />
                New Property
              </button>
            )}
          </>
        )}
        {activeTab === 'businesses' && (
          <>
            <AssessorBackfillButton isAdminOrManager={isAdminOrManager} />
            {!showArchived && isAdminOrManager && (
              <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={() => businessState.setShowFormModal(true)}>
                <Plus className="w-3.5 h-3.5" /> New Business
              </button>
            )}
          </>
        )}
        {activeTab === 'evidence' && (
          <>
            <ExportButton exportUrl={`/records/evidence/export?format=csv&archived=${showArchived}`} exportFilename="evidence_export.csv" />
            {!showArchived && isAdminOrManager && (
              <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={() => setNewEvidenceTrigger(t => t + 1)}>
                <Plus className="w-3.5 h-3.5" />
                New Evidence
              </button>
            )}
          </>
        )}
      </PanelTitleBar>

      <SpillmanMenuBar
        onNew={isAdminOrManager && !showArchived ? () => {
          if (activeTab === 'persons') setNewPersonTrigger(t => t + 1);
          else if (activeTab === 'vehicles') setNewVehicleTrigger(t => t + 1);
          else if (activeTab === 'properties') setNewPropertyTrigger(t => t + 1);
          else if (activeTab === 'businesses') businessState.setShowFormModal(true);
          else if (activeTab === 'evidence') setNewEvidenceTrigger(t => t + 1);
        } : undefined}
        onFind={() => {
          const el = document.querySelector<HTMLInputElement>('.records-page input[type="search"], .records-page input[type="text"]');
          el?.focus();
        }}
        onPrint={() => window.print()}
        onDuplicates={() => setShowDuplicatesModal(true)}
        onRefresh={() => { fetchPersons(); fetchVehicles(); fetchProperties(); fetchEvidence(); }}
        onToggleArchive={() => setShowArchived(v => !v)}
        onClose={closeSelection}
        onShortcuts={() => addToast('Shortcuts: type to search records · Esc closes the open panel', 'info')}
        onExport={() => {
          const exportConfigs: Record<string, { url: string; filename: string }> = {
            persons:    { url: `/records/persons/export?format=csv&archived=${showArchived}`,    filename: 'persons_export.csv' },
            vehicles:   { url: `/records/vehicles/export?format=csv&archived=${showArchived}`,   filename: 'vehicles_export.csv' },
            properties: { url: `/records/properties/export?format=csv&archived=${showArchived}`, filename: 'properties_export.csv' },
            evidence:   { url: `/records/evidence/export?format=csv&archived=${showArchived}`,   filename: 'evidence_export.csv' },
          };
          const cfg = exportConfigs[activeTab];
          if (cfg) {
            downloadExport(cfg.url, cfg.filename).catch((err) => {
              console.error('[RecordsPage] menu export failed:', err);
              addToast('Export failed — check your connection and try again', 'error');
            });
          } else {
            addToast('Export is not available for this record type', 'info');
          }
        }}
      />

      {/* Tab Row — Spillman silver record-type tabs + archive toggle */}
      <div className="flex items-stretch border-b border-rmpg-600">
        <SpillmanRecordTabs
          tabs={tabs.map(t => ({ id: t.id, label: t.label, count: t.count }))}
          activeTab={activeTab}
          onSelect={(id) => setActiveTab(id)}
        />
        <button
          type="button"
          onClick={() => setShowArchived(!showArchived)}
          className={`ml-auto flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors border whitespace-nowrap ${
            showArchived
              ? 'bg-amber-900/40 text-amber-400 border-amber-700/50 hover:bg-amber-900/60'
              : 'bg-rmpg-700/50 text-rmpg-500 border-rmpg-600 hover:text-rmpg-300 hover:bg-rmpg-700'
          }`}
        >
          <Archive className="w-2.5 h-2.5" />
          {showArchived ? 'Archives' : 'Archive'}
        </button>
      </div>

      {/* Compact Stats Strip */}
      <div className={`records-stats ${isMobile ? 'px-2 overflow-x-auto' : 'px-3'} py-1.5 border-b border-rmpg-600 flex items-center gap-4 text-[9px] font-mono uppercase tracking-wider`}>
        <div className="flex items-center gap-1">
          <UserCircle className="w-2.5 h-2.5 text-brand-400" />
          <span className="text-rmpg-400">P:</span>
          <span className="text-rmpg-100 font-bold">{persons.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <Car className="w-2.5 h-2.5 text-rmpg-400" />
          <span className="text-rmpg-400">V:</span>
          <span className="text-rmpg-100 font-bold">{vehicles.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <Building2 className="w-2.5 h-2.5 text-green-400" />
          <span className="text-rmpg-400">Pr:</span>
          <span className="text-rmpg-100 font-bold">{properties.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <Package className="w-2.5 h-2.5 text-purple-400" />
          <span className="text-rmpg-400">Ev:</span>
          <span className="text-rmpg-100 font-bold">{evidence.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <Shield className="w-2.5 h-2.5 text-red-400" />
          <span className="text-rmpg-400">Stl:</span>
          <span className="text-red-400 font-bold">{vehicles.filter(v => v.stolen_status && v.stolen_status !== 'None' && v.stolen_status !== 'Recovered').length}</span>
        </div>
        {activeTab === 'evidence' && (
          <>
            <div className="w-px h-2.5 bg-rmpg-600" />
            <div className="flex items-center gap-1">
              <Warehouse className="w-2.5 h-2.5 text-rmpg-400" />
              <span className="text-rmpg-300 font-bold">{evidenceInStorage}</span>
            </div>
            <div className="flex items-center gap-1">
              <FlaskConical className="w-2.5 h-2.5 text-purple-400" />
              <span className="text-purple-400 font-bold">{evidenceLabSubmitted}</span>
            </div>
            {evidenceTotalValue > 0 && (
              <div className="flex items-center gap-1">
                <DollarSign className="w-2.5 h-2.5 text-green-400" />
                <span className="text-green-400 font-bold">${evidenceTotalValue.toLocaleString()}</span>
              </div>
            )}
          </>
        )}
        {persons.some(p => p.flags.some(f => !/_IMPORTED$/i.test(typeof f === 'object' ? (f as any).type ?? '' : f))) && (
          <div className="flex items-center gap-1 ml-auto">
            <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
            <span className="text-amber-400 font-bold">
              {persons.filter(p => p.flags.some(f => !/_IMPORTED$/i.test(typeof f === 'object' ? (f as any).type ?? '' : f))).length}
            </span>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 bg-red-900/40 border-b border-red-700/50 text-red-300 text-xs flex items-center gap-2" role="alert">
          <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          {errorRetryRef.current && (
            <button
              type="button"
              onClick={() => { const r = errorRetryRef.current; clearError(); r?.(); }}
              className="toolbar-btn"
            >
              Retry
            </button>
          )}
          <button type="button" onClick={clearError} className="text-red-400 hover:text-red-300 transition-colors underline" aria-label="Dismiss error">dismiss</button>
        </div>
      )}

      {/* Archive Banner */}
      {showArchived && (
        <div className="px-3 py-1.5 bg-amber-900/20 border-b border-amber-700/40 flex items-center gap-2">
          <Archive className="w-3 h-3 text-amber-400" />
          <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Archives Mode</span>
          <span className="text-[10px] text-amber-400/70">Read-only</span>
          <button type="button" onClick={() => setShowArchived(false)} className="ml-auto text-[9px] text-amber-400 hover:text-amber-300 underline">
            Exit
          </button>
        </div>
      )}

      {/* Salt Lake County Assessor backfill — ambiguous-match review queue.
          Self-renders nothing when the queue is empty. */}
      <div className="px-3 pt-2">
        <AssessorReviewQueueBanner />
      </div>

      {/* Active TabList Content — per-tab loading/no-data/no-results distinct states */}
      <div className="flex-1 overflow-hidden" role="tabpanel" aria-label={`${activeTab} records`} style={{ overscrollBehavior: 'contain' }}>
        {activeTab === 'persons' && loadingPersons && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-6 h-6 text-brand-400 animate-spin" role="status" aria-label="Loading persons" />
            <span className="text-[10px] text-rmpg-500 font-mono uppercase tracking-wider animate-pulse">Loading persons...</span>
          </div>
        )}
        {activeTab === 'vehicles' && loadingVehicles && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-6 h-6 text-brand-400 animate-spin" role="status" aria-label="Loading vehicles" />
            <span className="text-[10px] text-rmpg-500 font-mono uppercase tracking-wider animate-pulse">Loading vehicles...</span>
          </div>
        )}
        {activeTab === 'properties' && loadingProperties && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-6 h-6 text-brand-400 animate-spin" role="status" aria-label="Loading properties" />
            <span className="text-[10px] text-rmpg-500 font-mono uppercase tracking-wider animate-pulse">Loading properties...</span>
          </div>
        )}
        {activeTab === 'evidence' && loadingEvidence && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-6 h-6 text-brand-400 animate-spin" role="status" aria-label="Loading evidence" />
            <span className="text-[10px] text-rmpg-500 font-mono uppercase tracking-wider animate-pulse">Loading evidence...</span>
          </div>
        )}
        {activeTab === 'businesses' && businessState.loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-6 h-6 text-brand-400 animate-spin" role="status" aria-label="Loading businesses" />
            <span className="text-[10px] text-rmpg-500 font-mono uppercase tracking-wider animate-pulse">Loading businesses...</span>
          </div>
        )}
        {activeTab === 'persons' && !loadingPersons && <PersonsTabList state={personsState} />}
        {activeTab === 'vehicles' && !loadingVehicles && <VehiclesTabList state={vehiclesState} />}
        {activeTab === 'properties' && !loadingProperties && <PropertiesTabList state={propertiesState} />}
        {activeTab === 'businesses' && !businessState.loading && <BusinessTabList state={businessState} />}
        {activeTab === 'evidence' && !loadingEvidence && <EvidenceTabList state={evidenceState} />}
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════
  // RIGHT PANEL — PanelTitleBar + Detail
  // ════════════════════════════════════════════════════

  const rightPanel = (
    <div className="h-full flex flex-col">
      {/* Panel Title Bar — Selected Record */}
      <PanelTitleBar
        title={selectedLabel}
        icon={
          activeTab === 'persons' ? UserCircle :
          activeTab === 'vehicles' ? Car :
          activeTab === 'properties' ? Building2 :
          activeTab === 'businesses' ? Briefcase :
          Package
        }
      >
        {selectedRecordForPrint && (
          <PrintRecordButton
            recordType={selectedRecordForPrint.recordType}
            recordData={selectedRecordForPrint.recordData}
            identifier={selectedRecordForPrint.identifier}
            entityType={selectedRecordForPrint.entityType}
            entityId={selectedRecordForPrint.entityId}
            iconOnly
            title="Print record"
          />
        )}
        <button type="button" onClick={closeSelection} className="toolbar-btn" title="Close detail" aria-label="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </PanelTitleBar>

      {hasSelection && RECORD_FORM_SECTIONS[activeTab as keyof typeof RECORD_FORM_SECTIONS]?.length > 0 && (
        <SpillmanFormTabs
          key={`${activeTab}-${personsState.selectedPerson?.id ?? vehiclesState.selectedVehicle?.id ?? propertiesState.selectedProperty?.id ?? businessState.selectedBusiness?.id ?? evidenceState.selectedEvidence?.id ?? 'none'}`}
          sections={RECORD_FORM_SECTIONS[activeTab as keyof typeof RECORD_FORM_SECTIONS]}
        />
      )}

      {/* Active TabDetail Content */}
      <div className="records-detail flex-1 overflow-hidden scrollbar-dark">
        {activeTab === 'persons' && <PersonsTabDetail state={personsState} />}
        {activeTab === 'vehicles' && <VehiclesTabDetail state={vehiclesState} />}
        {activeTab === 'properties' && <PropertiesTabDetail state={propertiesState} />}
        {activeTab === 'businesses' && <BusinessTabDetail state={businessState} />}
        {activeTab === 'evidence' && <EvidenceTabDetail state={evidenceState} />}
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════
  // RENDER — SplitPanel
  // ════════════════════════════════════════════════════

  // Set document title
  useEffect(() => { document.title = 'Records Management \u2014 RMPG Flex'; }, []);

  // Esc smart-cascade — closes the smallest-open-first overlay so a single
  // tap doesn't blow away the open record while a nested modal is showing.
  // Order: delete-confirm → duplicates modal → business form modal →
  // link-record modal → selected record (closes the right detail panel).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (deleteTarget !== null) { e.stopPropagation(); setDeleteTarget(null); return; }
      if (showDuplicatesModal) { e.stopPropagation(); setShowDuplicatesModal(false); return; }
      if (businessState.showFormModal) { e.stopPropagation(); businessState.setShowFormModal(false); return; }
      if (linkModalOpen) { e.stopPropagation(); setLinkModalOpen(false); setLinkSource(null); return; }
      if (hasSelection) { e.stopPropagation(); closeSelection(); return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [deleteTarget, showDuplicatesModal, businessState, linkModalOpen, hasSelection, closeSelection]); // eslint-disable-line react-hooks/exhaustive-deps

  // "N" keyboard shortcut → opens the active tab's New record flow.
  // Typing-suppressed (skipped while focus is in any input/textarea/
  // contenteditable). Skipped while any modal/overlay is open so it
  // doesn't fight focus traps. Gated to admin/manager (create role gate).
  // Same contract used across MDT / Patrol / Field Interviews / Cases / Court Tracker.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return;
      }
      // Don't open New on top of an already-open modal/picker.
      if (deleteTarget !== null || showDuplicatesModal || linkModalOpen || businessState.showFormModal) return;
      if (showArchived) return; // archives mode is read-only
      if (!isAdminOrManager) return; // create gated to admin/manager
      e.preventDefault();
      if (activeTab === 'persons') setNewPersonTrigger(n => n + 1);
      else if (activeTab === 'vehicles') setNewVehicleTrigger(n => n + 1);
      else if (activeTab === 'properties') setNewPropertyTrigger(n => n + 1);
      else if (activeTab === 'businesses') businessState.setShowFormModal(true);
      else if (activeTab === 'evidence') setNewEvidenceTrigger(n => n + 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTab, deleteTarget, showDuplicatesModal, linkModalOpen, businessState, showArchived, isAdminOrManager]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="records-page flex flex-col h-full animate-fade-in">
      <SplitPanel
        left={leftPanel}
        right={rightPanel}
        initialRatio={0.4}
        persistKey="records-split"
        rightVisible={hasSelection}
        leftLabel="Records"
        rightLabel="Detail"
      />

      {/* Link Record Modal */}
      {linkSource && (
        <LinkRecordModal
          isOpen={linkModalOpen}
          onClose={() => { setLinkModalOpen(false); setLinkSource(null); }}
          sourceType={linkSource.type}
          sourceId={linkSource.id}
          onLinked={handleLinked}
        />
      )}

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={`Delete ${recordTypeLabel(deleteTarget?.type)}`}
        message={`Are you sure you want to delete "${deleteTarget?.label}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        isLoading={deleting}
      />

      <PersonDuplicatesModal
        isOpen={showDuplicatesModal}
        onClose={() => setShowDuplicatesModal(false)}
        onMergeComplete={() => fetchPersons({ silent: true })}
      />

      <DlScanImportModal
        isOpen={showDlScan}
        onClose={() => setShowDlScan(false)}
        onImported={(person, created) => {
          setShowDlScan(false);
          addToast(
            created
              ? `Person record created for ${person.first_name} ${person.last_name}`
              : `Matched existing record for ${person.first_name} ${person.last_name}`,
            'success',
          );
          // Reload persons list and select the imported/matched person
          fetchPersons({ silent: true }).then(() => {
            personsState.setSelectedPerson(person);
            if (activeTab !== 'persons') setActiveTab('persons');
          });
        }}
      />
    </div>
  );
}

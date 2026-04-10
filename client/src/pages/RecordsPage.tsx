import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
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
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { usePersistedTab } from '../hooks/usePersistedState';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import ConfirmDialog from '../components/ConfirmDialog';
import PanelTitleBar from '../components/PanelTitleBar';
import SplitPanel from '../components/SplitPanel';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import PrintRecordButton from '../components/PrintRecordButton';
import ExportButton from '../components/ExportButton';
import LinkRecordModal from '../components/LinkRecordModal';
import PersonDuplicatesModal from '../components/PersonDuplicatesModal';
import type { Person, Vehicle, Property, RecordEntityType } from '../types';
import { useToast } from '../components/ToastProvider';

// Tab hooks + components
import { usePersonsTab, PersonsTabList, PersonsTabDetail, mapDbPerson } from './records/PersonsTab';
import { useVehiclesTab, VehiclesTabList, VehiclesTabDetail, mapDbVehicle } from './records/VehiclesTab';
import { usePropertiesTab, PropertiesTabList, PropertiesTabDetail, mapDbProperty } from './records/PropertiesTab';
import { useEvidenceTab, EvidenceTabList, EvidenceTabDetail } from './records/EvidenceTab';

// ============================================================
// Constants
// ============================================================

type TabId = 'persons' | 'vehicles' | 'properties' | 'evidence';

// ============================================================
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

// Component
// ============================================================

export default function RecordsPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const [urlParams] = useSearchParams();
  const [activeTab, setActiveTab] = usePersistedTab('rmpg_records_tab', 'persons' as TabId, ['persons', 'vehicles', 'properties', 'evidence'] as const);
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false);

  // Handle cross-module navigation params (?tab=persons&personId=X)
  useEffect(() => {
    const tab = urlParams.get('tab');
    const personId = urlParams.get('personId');
    if (tab && ['persons', 'vehicles', 'properties', 'evidence'].includes(tab)) {
      setActiveTab(tab as TabId);
    }
    if (personId && tab === 'persons') {
      setSearchQuery(personId);
    }
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

  // Evidence data
  const [evidence, setEvidence] = useState<any[]>([]);
  const [loadingEvidence, setLoadingEvidence] = useState(false);

  // Clients (for properties)
  const [clients, setClients] = useState<{ id: string; name: string; status: string }[]>([]);

  // Link modal state
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkSource, setLinkSource] = useState<{ type: RecordEntityType; id: string } | null>(null);
  const [linkRefreshKey, setLinkRefreshKey] = useState(0);

  // "New" record triggers
  const [newPersonTrigger, setNewPersonTrigger] = useState(0);
  const [newVehicleTrigger, setNewVehicleTrigger] = useState(0);
  const [newPropertyTrigger, setNewPropertyTrigger] = useState(0);
  const [newEvidenceTrigger, setNewEvidenceTrigger] = useState(0);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'person' | 'vehicle' | 'property' | 'evidence'; id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Fetchers ─────────────────────────────────────────

  const fetchPersons = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoadingPersons(true); setError(null); }
    try {
      const res = await apiFetch<{ data: Record<string, unknown>[]; pagination: unknown }>(`/records/persons?limit=100&archived=${showArchived}`);
      setPersons((Array.isArray(res?.data) ? res.data : []).map(mapDbPerson));
    } catch (err) {
      if (!options?.silent) setError(err instanceof Error ? err.message : 'Failed to load persons');
    } finally {
      if (!options?.silent) setLoadingPersons(false);
    }
  }, [showArchived]);

  const fetchVehicles = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoadingVehicles(true); setError(null); }
    try {
      const res = await apiFetch<{ data: Record<string, unknown>[]; pagination: unknown }>(`/records/vehicles?limit=100&archived=${showArchived}`);
      setVehicles((Array.isArray(res?.data) ? res.data : []).map(mapDbVehicle));
    } catch (err) {
      if (!options?.silent) setError(err instanceof Error ? err.message : 'Failed to load vehicles');
    } finally {
      if (!options?.silent) setLoadingVehicles(false);
    }
  }, [showArchived]);

  const fetchProperties = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) { setLoadingProperties(true); setError(null); }
    try {
      const res = await apiFetch<Record<string, unknown>[]>(`/records/properties?archived=${showArchived}`);
      setProperties((Array.isArray(res) ? res : []).map(mapDbProperty));
    } catch (err) {
      if (!options?.silent) setError(err instanceof Error ? err.message : 'Failed to load properties');
    } finally {
      if (!options?.silent) setLoadingProperties(false);
    }
  }, [showArchived]);

  const fetchEvidence = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoadingEvidence(true);
    try {
      const res = await apiFetch<{ data: any[]; pagination: any }>(`/records/evidence?limit=200&archived=${showArchived}`);
      setEvidence(res?.data || []);
    } catch {
      setEvidence([]);
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

  const handleArchiveRecord = async (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => {
    try {
      await apiFetch(`/records/${type}/${id}/archive`, { method: 'POST' });
      if (type === 'persons') { await fetchPersons(); }
      else if (type === 'vehicles') { await fetchVehicles(); }
      else if (type === 'properties') { await fetchProperties(); }
      else if (type === 'evidence') { await fetchEvidence(); }
      addToast('Record archived', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to archive record', 'error');
    }
  };

  const handleUnarchiveRecord = async (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => {
    try {
      await apiFetch(`/records/${type}/${id}/unarchive`, { method: 'POST' });
      if (type === 'persons') { await fetchPersons(); }
      else if (type === 'vehicles') { await fetchVehicles(); }
      else if (type === 'properties') { await fetchProperties(); }
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

  // ── Derived ──────────────────────────────────────────

  const isLoading = loadingPersons || loadingVehicles || loadingProperties || loadingEvidence;

  const tabs: { id: TabId; label: string; icon: React.ElementType; count: number }[] = [
    { id: 'persons', label: 'Persons', icon: UserCircle, count: persons.length },
    { id: 'vehicles', label: 'Vehicles', icon: Car, count: vehicles.length },
    { id: 'properties', label: 'Properties', icon: Building2, count: properties.length },
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
        <PrintButton />
        {activeTab === 'persons' && (
          <>
            <ExportButton exportUrl={`/records/persons/export?format=csv&archived=${showArchived}`} exportFilename="persons_export.csv" />
            <button type="button" className="toolbar-btn print:hidden text-amber-400" onClick={() => setShowDuplicatesModal(true)}>
              <Users className="w-3.5 h-3.5" />
              Duplicates
            </button>
            {!showArchived && (
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
            {!showArchived && (
              <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={() => setNewVehicleTrigger(t => t + 1)}>
                <Plus className="w-3.5 h-3.5" />
                New Vehicle
              </button>
            )}
          </>
        )}
        {activeTab === 'properties' && (
          <>
            {!showArchived && (
              <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={() => setNewPropertyTrigger(t => t + 1)}>
                <Plus className="w-3.5 h-3.5" />
                New Property
              </button>
            )}
          </>
        )}
        {activeTab === 'evidence' && (
          <>
            <ExportButton exportUrl={`/records/evidence/export?format=csv&archived=${showArchived}`} exportFilename="evidence_export.csv" />
            {!showArchived && (
              <button type="button" className="toolbar-btn toolbar-btn-primary print:hidden" onClick={() => setNewEvidenceTrigger(t => t + 1)}>
                <Plus className="w-3.5 h-3.5" />
                New Evidence
              </button>
            )}
          </>
        )}
      </PanelTitleBar>

      {/* Tab Row */}
      <div className={`${isMobile ? 'px-2' : 'px-3'} py-1.5 border-b border-rmpg-600 flex items-center gap-1 ${isMobile ? 'overflow-x-auto' : ''}`} role="tablist" aria-label="Record type tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button type="button"
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all duration-150 whitespace-nowrap relative
                ${activeTab === tab.id
                  ? 'bg-rmpg-700 text-white border border-rmpg-600 border-b-rmpg-700 shadow-sm'
                  : 'text-rmpg-400 hover:text-white hover:bg-rmpg-700/50 border border-transparent'
                }
              `}
            >
              <Icon className={`w-3.5 h-3.5 ${activeTab === tab.id ? 'text-brand-400' : ''}`} />
              {tab.label}
              <span className={`text-[9px] font-mono tabular-nums ${activeTab === tab.id ? 'text-brand-400' : 'text-rmpg-500'}`}>({tab.count})</span>
              {activeTab === tab.id && <span className="absolute bottom-0 left-1 right-1 h-[2px] bg-brand-500" />}
            </button>
          );
        })}
        {/* Archive Toggle */}
        <button type="button"
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
      <div className={`${isMobile ? 'px-2 overflow-x-auto' : 'px-3'} py-1.5 border-b border-rmpg-600 flex items-center gap-4 text-[9px] font-mono uppercase tracking-wider`} style={{ background: '#050505' }}>
        <div className="flex items-center gap-1">
          <UserCircle className="w-2.5 h-2.5 text-brand-400" />
          <span className="text-rmpg-400">P:</span>
          <span className="text-white font-bold">{persons.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <Car className="w-2.5 h-2.5 text-gray-400" />
          <span className="text-rmpg-400">V:</span>
          <span className="text-white font-bold">{vehicles.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <Building2 className="w-2.5 h-2.5 text-green-400" />
          <span className="text-rmpg-400">Pr:</span>
          <span className="text-white font-bold">{properties.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <Package className="w-2.5 h-2.5 text-purple-400" />
          <span className="text-rmpg-400">Ev:</span>
          <span className="text-white font-bold">{evidence.length}</span>
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
              <Warehouse className="w-2.5 h-2.5 text-cyan-400" />
              <span className="text-cyan-400 font-bold">{evidenceInStorage}</span>
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
        {persons.some(p => p.flags.length > 0) && (
          <div className="flex items-center gap-1 ml-auto">
            <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
            <span className="text-amber-400 font-bold">{persons.filter(p => p.flags.length > 0).length}</span>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 bg-red-900/40 border-b border-red-700/50 text-red-300 text-xs flex items-center gap-2" role="alert">
          <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-300 transition-colors underline" aria-label="Dismiss error">dismiss</button>
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

      {/* Active TabList Content */}
      <div className="flex-1 overflow-hidden" role="tabpanel" aria-label={`${activeTab} records`} style={{ overscrollBehavior: 'contain' }}>
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-6 h-6 text-brand-400 animate-spin" role="status" aria-label="Loading records" />
            <span className="text-[10px] text-rmpg-500 font-mono uppercase tracking-wider animate-pulse">Loading records...</span>
          </div>
        )}
        {activeTab === 'persons' && !loadingPersons && <PersonsTabList state={personsState} />}
        {activeTab === 'vehicles' && !loadingVehicles && <VehiclesTabList state={vehiclesState} />}
        {activeTab === 'properties' && !loadingProperties && <PropertiesTabList state={propertiesState} />}
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

      {/* Active TabDetail Content */}
      <div className="flex-1 overflow-hidden scrollbar-dark">
        {activeTab === 'persons' && <PersonsTabDetail state={personsState} />}
        {activeTab === 'vehicles' && <VehiclesTabDetail state={vehiclesState} />}
        {activeTab === 'properties' && <PropertiesTabDetail state={propertiesState} />}
        {activeTab === 'evidence' && <EvidenceTabDetail state={evidenceState} />}
      </div>
    </div>
  );

  // ════════════════════════════════════════════════════
  // RENDER — SplitPanel
  // ════════════════════════════════════════════════════

  // Set document title
  useEffect(() => { document.title = 'Records Management \u2014 RMPG Flex'; }, []);

  // Keyboard shortcut: Escape to close modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setLinkModalOpen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="flex flex-col h-full animate-fade-in">
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
        title={`Delete ${deleteTarget?.type ? deleteTarget.type.charAt(0).toUpperCase() + deleteTarget.type.slice(1) : 'Record'}`}
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
    </div>
  );
}

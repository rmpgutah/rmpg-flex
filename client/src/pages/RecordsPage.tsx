import React, { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { usePersistedTab } from '../hooks/usePersistedState';
import { useLiveSync } from '../hooks/useLiveSync';
import ConfirmDialog from '../components/ConfirmDialog';
import PanelTitleBar from '../components/PanelTitleBar';
import RmpgLogo from '../components/RmpgLogo';
import PrintButton from '../components/PrintButton';
import ExportButton from '../components/ExportButton';
import LinkRecordModal from '../components/LinkRecordModal';
import type { Person, Vehicle, Property, RecordEntityType } from '../types';

// Tab components
import PersonsTab, { mapDbPerson } from './records/PersonsTab';
import VehiclesTab, { mapDbVehicle } from './records/VehiclesTab';
import { mapDbProperty } from './records/PropertiesTab';
import PropertiesTab from './records/PropertiesTab';
import EvidenceTab from './records/EvidenceTab';

// ============================================================
// Constants
// ============================================================

type TabId = 'persons' | 'vehicles' | 'properties' | 'evidence';

// ============================================================
// Component
// ============================================================

export default function RecordsPage() {
  const [activeTab, setActiveTab] = usePersistedTab('rmpg_records_tab', 'persons' as TabId, ['persons', 'vehicles', 'properties', 'evidence'] as const);
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

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

  // "New" record triggers — increment to open new-record modal in child tab
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
      setEvidence(res.data || []);
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
  }, [fetchPersons, fetchVehicles, fetchProperties, fetchEvidence]);

  // Live sync — auto-refresh when any other device modifies records (silent to avoid unmounting UI)
  const refreshAll = useCallback(() => {
    fetchPersons(); fetchVehicles(); fetchProperties(); fetchEvidence();
  }, [fetchPersons, fetchVehicles, fetchProperties, fetchEvidence]);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete record');
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive record');
    }
  };

  const handleUnarchiveRecord = async (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => {
    try {
      await apiFetch(`/records/${type}/${id}/unarchive`, { method: 'POST' });
      if (type === 'persons') { await fetchPersons(); }
      else if (type === 'vehicles') { await fetchVehicles(); }
      else if (type === 'properties') { await fetchProperties(); }
      else if (type === 'evidence') { await fetchEvidence(); }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unarchive record');
    }
  };

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

  // ── Render ───────────────────────────────────────────

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <PanelTitleBar title={showArchived ? 'RECORDS MANAGEMENT — ARCHIVES' : 'RECORDS MANAGEMENT'} icon={showArchived ? Archive : Database}>
        <RmpgLogo height={16} iconOnly />
        <span className="toolbar-separator" />
        <PrintButton />
        {activeTab === 'persons' && (
          <>
            <ExportButton exportUrl={`/records/persons/export?format=csv&archived=${showArchived}`} exportFilename="persons_export.csv" />
            {!showArchived && (
              <button className="toolbar-btn toolbar-btn-primary" onClick={() => setNewPersonTrigger(t => t + 1)}>
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
              <button className="toolbar-btn toolbar-btn-primary" onClick={() => setNewVehicleTrigger(t => t + 1)}>
                <Plus className="w-3.5 h-3.5" />
                New Vehicle
              </button>
            )}
          </>
        )}
        {activeTab === 'properties' && (
          <>
            {!showArchived && (
              <button className="toolbar-btn toolbar-btn-primary" onClick={() => setNewPropertyTrigger(t => t + 1)}>
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
              <button className="toolbar-btn toolbar-btn-primary" onClick={() => setNewEvidenceTrigger(t => t + 1)}>
                <Plus className="w-3.5 h-3.5" />
                New Evidence
              </button>
            )}
          </>
        )}
      </PanelTitleBar>

      {/* Stats Bar */}
      <div className="px-6 py-2 border-b border-rmpg-600 flex items-center gap-6 text-[10px] font-mono uppercase tracking-wider">
        <div className="flex items-center gap-1.5">
          <UserCircle className="w-3 h-3 text-brand-400" />
          <span className="text-rmpg-300">Persons:</span>
          <span className="text-white font-bold">{persons.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Car className="w-3 h-3 text-blue-400" />
          <span className="text-rmpg-300">Vehicles:</span>
          <span className="text-white font-bold">{vehicles.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Building2 className="w-3 h-3 text-green-400" />
          <span className="text-rmpg-300">Properties:</span>
          <span className="text-white font-bold">{properties.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Package className="w-3 h-3 text-purple-400" />
          <span className="text-rmpg-300">Evidence:</span>
          <span className="text-white font-bold">{evidence.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Shield className="w-3 h-3 text-red-400" />
          <span className="text-rmpg-300">Stolen Veh:</span>
          <span className="text-red-400 font-bold">{vehicles.filter(v => v.stolen_status && v.stolen_status !== 'None' && v.stolen_status !== 'Recovered').length}</span>
        </div>
        {activeTab === 'evidence' && (
          <>
            <div className="w-px h-3 bg-rmpg-600" />
            <div className="flex items-center gap-1.5">
              <Warehouse className="w-3 h-3 text-cyan-400" />
              <span className="text-rmpg-300">In Storage:</span>
              <span className="text-cyan-400 font-bold">{evidenceInStorage}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <FlaskConical className="w-3 h-3 text-purple-400" />
              <span className="text-rmpg-300">Lab:</span>
              <span className="text-purple-400 font-bold">{evidenceLabSubmitted}</span>
            </div>
            {evidenceTotalValue > 0 && (
              <div className="flex items-center gap-1.5">
                <DollarSign className="w-3 h-3 text-green-400" />
                <span className="text-rmpg-300">Value:</span>
                <span className="text-green-400 font-bold">${evidenceTotalValue.toLocaleString()}</span>
              </div>
            )}
          </>
        )}
        {persons.some(p => p.flags.length > 0) && (
          <div className="flex items-center gap-1.5 ml-auto">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            <span className="text-amber-400 font-bold">{persons.filter(p => p.flags.length > 0).length} flagged</span>
          </div>
        )}
      </div>

      <div className="px-6 py-3 border-b border-rmpg-600">
        {/* Error banner */}
        {error && (
          <div className="mb-3 px-3 py-2 bg-red-900/40 border border-red-700/50 text-red-300 text-xs">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline text-red-400 hover:text-red-300">dismiss</button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 items-center">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); }}
                className={`
                  flex items-center gap-2 px-4 py-2 text-xs font-medium transition-colors
                  ${activeTab === tab.id
                    ? 'bg-rmpg-700 text-white border border-rmpg-600 border-b-rmpg-700'
                    : 'text-rmpg-300 hover:text-white hover:bg-rmpg-700/50'
                  }
                `}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                <span className="text-[10px] text-rmpg-400">({tab.count})</span>
              </button>
            );
          })}

          {/* Archive Toggle */}
          <div className="ml-auto">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors border ${
                showArchived
                  ? 'bg-amber-900/40 text-amber-400 border-amber-700/50 hover:bg-amber-900/60'
                  : 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600 hover:text-rmpg-200 hover:bg-rmpg-700'
              }`}
            >
              <Archive className="w-3 h-3" />
              {showArchived ? 'Viewing Archives' : 'Show Archives'}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Archive Banner */}
        {showArchived && (
          <div className="px-4 py-2 bg-amber-900/20 border-b border-amber-700/40 flex items-center gap-2">
            <Archive className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs text-amber-400 font-bold uppercase tracking-wider">Archives Mode</span>
            <span className="text-xs text-amber-400/70">Showing archived records (read-only)</span>
            <button
              onClick={() => setShowArchived(false)}
              className="ml-auto text-[10px] text-amber-400 hover:text-amber-300 underline"
            >
              Exit Archives
            </button>
          </div>
        )}

        <div className="flex-1 overflow-hidden flex">
          {/* Loading spinner */}
          {isLoading && (
            <div className="flex items-center justify-center py-16 flex-1">
              <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
              <span className="ml-2 text-sm text-rmpg-300">Loading records...</span>
            </div>
          )}

          {/* ===== PERSONS TAB ===== */}
          {activeTab === 'persons' && !loadingPersons && (
            <PersonsTab
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              showArchived={showArchived}
              setError={setError}
              persons={persons}
              setPersons={setPersons}
              loadingPersons={loadingPersons}
              setLoadingPersons={setLoadingPersons}
              deleteTarget={deleteTarget}
              setDeleteTarget={setDeleteTarget}
              linkRefreshKey={linkRefreshKey}
              openLinkModal={openLinkModal}
              handleArchiveRecord={handleArchiveRecord}
              handleUnarchiveRecord={handleUnarchiveRecord}
              fetchPersons={fetchPersons}
              openNewTrigger={newPersonTrigger}
            />
          )}

          {/* ===== VEHICLES TAB ===== */}
          {activeTab === 'vehicles' && !loadingVehicles && (
            <VehiclesTab
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              showArchived={showArchived}
              setError={setError}
              vehicles={vehicles}
              setVehicles={setVehicles}
              loadingVehicles={loadingVehicles}
              setLoadingVehicles={setLoadingVehicles}
              setDeleteTarget={setDeleteTarget}
              linkRefreshKey={linkRefreshKey}
              openLinkModal={openLinkModal}
              handleArchiveRecord={handleArchiveRecord}
              handleUnarchiveRecord={handleUnarchiveRecord}
              fetchVehicles={fetchVehicles}
              openNewTrigger={newVehicleTrigger}
            />
          )}

          {/* ===== PROPERTIES TAB ===== */}
          {activeTab === 'properties' && !loadingProperties && (
            <PropertiesTab
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              showArchived={showArchived}
              setError={setError}
              properties={properties}
              setProperties={setProperties}
              loadingProperties={loadingProperties}
              setLoadingProperties={setLoadingProperties}
              setDeleteTarget={setDeleteTarget}
              linkRefreshKey={linkRefreshKey}
              openLinkModal={openLinkModal}
              handleArchiveRecord={handleArchiveRecord}
              handleUnarchiveRecord={handleUnarchiveRecord}
              fetchProperties={fetchProperties}
              clients={clients}
              openNewTrigger={newPropertyTrigger}
            />
          )}

          {/* ===== EVIDENCE TAB ===== */}
          {activeTab === 'evidence' && !loadingEvidence && (
            <EvidenceTab
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              showArchived={showArchived}
              setError={setError}
              evidence={evidence}
              setEvidence={setEvidence}
              loadingEvidence={loadingEvidence}
              setLoadingEvidence={setLoadingEvidence}
              setDeleteTarget={setDeleteTarget}
              linkRefreshKey={linkRefreshKey}
              openLinkModal={openLinkModal}
              handleArchiveRecord={handleArchiveRecord}
              handleUnarchiveRecord={handleUnarchiveRecord}
              fetchEvidence={fetchEvidence}
              openNewTrigger={newEvidenceTrigger}
            />
          )}
        </div>
      </div>

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
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import {
  Search,
  Car,
  Shield,
  MapPin,
  Loader2,
  Trash2,
  Pencil,
  FileText,
  ExternalLink,
  X,
  Phone,
  AlertTriangle,
  Hash,
  Calendar,
  Archive,
  RotateCcw,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { openRecordWindow } from '../../utils/windowManager';
import VehicleFormModal from '../../components/VehicleFormModal';
import FileAttachments from '../../components/FileAttachments';
import StatusBadge from '../../components/StatusBadge';
import AlertBanner from '../../components/AlertBanner';
import LinkedRecordsSection from '../../components/LinkedRecordsSection';
import CollapsibleSection from '../../components/CollapsibleSection';
import type { Vehicle, RecordAlert, RecordEntityType } from '../../types';
import type { VehicleFormData } from '../../components/VehicleFormModal';

// ── DB Mapper ──────────────────────────────────────

function parseFlags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function mapDbVehicle(row: Record<string, unknown>): Vehicle {
  const ownerParts: string[] = [];
  if (row.owner_first_name) ownerParts.push(String(row.owner_first_name));
  if (row.owner_last_name) ownerParts.push(String(row.owner_last_name));

  return {
    id: String(row.id ?? ''),
    license_plate: String(row.plate_number ?? ''),
    plate_state: String(row.state ?? ''),
    make: String(row.make ?? ''),
    model: String(row.model ?? ''),
    year: Number(row.year) || 0,
    color: String(row.color ?? ''),
    secondary_color: row.secondary_color ? String(row.secondary_color) : undefined,
    body_style: row.body_style ? String(row.body_style) : undefined,
    doors: row.doors ? Number(row.doors) : undefined,
    vin: row.vin ? String(row.vin) : undefined,
    owner_name: ownerParts.length > 0 ? ownerParts.join(' ') : undefined,
    owner_id: row.owner_person_id ? String(row.owner_person_id) : undefined,
    insurance_company: row.insurance_company ? String(row.insurance_company) : undefined,
    insurance_policy: row.insurance_policy ? String(row.insurance_policy) : undefined,
    registration_expiry: row.registration_expiry ? String(row.registration_expiry) : undefined,
    damage_description: row.damage_description ? String(row.damage_description) : undefined,
    distinguishing_features: row.distinguishing_features ? String(row.distinguishing_features) : undefined,
    trim: row.trim ? String(row.trim) : undefined,
    engine_type: row.engine_type ? String(row.engine_type) : undefined,
    fuel_type: row.fuel_type ? String(row.fuel_type) : undefined,
    transmission: row.transmission ? String(row.transmission) : undefined,
    drive_type: row.drive_type ? String(row.drive_type) : undefined,
    tow_status: row.tow_status ? String(row.tow_status) : undefined,
    tow_company: row.tow_company ? String(row.tow_company) : undefined,
    tow_date: row.tow_date ? String(row.tow_date) : undefined,
    plate_type: row.plate_type ? String(row.plate_type) : undefined,
    commercial_vehicle: row.commercial_vehicle === 1 || row.commercial_vehicle === true,
    hazmat: row.hazmat === 1 || row.hazmat === true,
    odometer: row.odometer ? String(row.odometer) : undefined,
    owner_address: row.owner_address ? String(row.owner_address) : undefined,
    owner_phone: row.owner_phone ? String(row.owner_phone) : undefined,
    lien_holder: row.lien_holder ? String(row.lien_holder) : undefined,
    stolen_status: row.stolen_status ? String(row.stolen_status) : undefined,
    stolen_date: row.stolen_date ? String(row.stolen_date) : undefined,
    recovery_date: row.recovery_date ? String(row.recovery_date) : undefined,
    flags: parseFlags(row.flags),
    notes: row.notes ? String(row.notes) : undefined,
    incident_ids: [],
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

// ── Constants ──────────────────────────────────────

const FLAG_COLORS: Record<string, string> = {
  'Trespass Warning': 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  'Known Offender': 'bg-red-900/50 text-red-400 border-red-700/50',
  'Warrant': 'bg-red-900/50 text-red-300 border-red-600/50',
  'Mental Health': 'bg-purple-900/50 text-purple-400 border-purple-700/50',
  'BOLO': 'bg-red-900/50 text-red-400 border-red-700/50',
  'Parking Violation': 'bg-amber-900/50 text-amber-400 border-amber-700/50',
};

// ── Helpers ──────────────────────────────────────

function renderInfoRow(label: string, value?: string | null, icon?: React.ElementType) {
  if (!value) return null;
  const Icon = icon;
  return (
    <div className="flex items-start gap-2 text-xs group">
      {Icon && <Icon className="w-3 h-3 text-rmpg-400 mt-0.5 flex-shrink-0" />}
      <span className="text-rmpg-400 min-w-[80px] select-none">{label}:</span>
      <span className="text-rmpg-200 group-hover:text-white transition-colors">{value}</span>
    </div>
  );
}

// ── Props ──────────────────────────────────────────

export interface VehiclesTabProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  showArchived: boolean;
  setError: (err: string | null) => void;
  vehicles: Vehicle[];
  setVehicles: React.Dispatch<React.SetStateAction<Vehicle[]>>;
  loadingVehicles: boolean;
  setLoadingVehicles: React.Dispatch<React.SetStateAction<boolean>>;
  setDeleteTarget: React.Dispatch<React.SetStateAction<{ type: 'person' | 'vehicle' | 'property' | 'evidence'; id: string; label: string } | null>>;
  linkRefreshKey: number;
  openLinkModal: (type: RecordEntityType, id: string) => void;
  handleArchiveRecord: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  handleUnarchiveRecord: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  fetchVehicles: () => Promise<void>;
  /** Increment to open the "New Vehicle" modal from parent */
  openNewTrigger?: number;
}

// ── Hook Return ────────────────────────────────────

export interface VehiclesTabState {
  selectedVehicle: Vehicle | null;
  setSelectedVehicle: React.Dispatch<React.SetStateAction<Vehicle | null>>;
  vehicleModalOpen: boolean;
  editingVehicle: Vehicle | undefined;
  vehicleSubmitting: boolean;
  vehicleSubmitError: string | null;
  openNewVehicle: () => void;
  openEditVehicle: (v: Vehicle) => void;
  handleVehicleSubmit: (data: VehicleFormData) => Promise<void>;
  closeModal: () => void;
  vehicleAlerts: RecordAlert[];
  vehicleIncidents: any[];
  loadingVehicleIncidents: boolean;
  filteredVehicles: Vehicle[];
  handleArchive: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  handleUnarchive: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  showArchived: boolean;
  setDeleteTarget: VehiclesTabProps['setDeleteTarget'];
  linkRefreshKey: number;
  openLinkModal: (type: RecordEntityType, id: string) => void;
}

// ════════════════════════════════════════════════════
// HOOK — useVehiclesTab
// ════════════════════════════════════════════════════

export function useVehiclesTab(props: VehiclesTabProps): VehiclesTabState {
  const {
    searchQuery, setSearchQuery, showArchived, setError,
    vehicles, setDeleteTarget, linkRefreshKey,
    openLinkModal, handleArchiveRecord, handleUnarchiveRecord,
    fetchVehicles, openNewTrigger,
  } = props;

  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | undefined>(undefined);
  const [vehicleSubmitting, setVehicleSubmitting] = useState(false);
  const [vehicleSubmitError, setVehicleSubmitError] = useState<string | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [vehicleAlerts, setVehicleAlerts] = useState<RecordAlert[]>([]);
  const [vehicleIncidents, setVehicleIncidents] = useState<any[]>([]);
  const [loadingVehicleIncidents, setLoadingVehicleIncidents] = useState(false);

  useEffect(() => {
    if (openNewTrigger && openNewTrigger > 0) {
      setEditingVehicle(undefined);
      setVehicleModalOpen(true);
    }
  }, [openNewTrigger]);

  useEffect(() => {
    if (selectedVehicle && !vehicles.find(v => v.id === selectedVehicle.id)) {
      setSelectedVehicle(null);
    }
  }, [vehicles, selectedVehicle]);

  useEffect(() => {
    if (!selectedVehicle) { setVehicleAlerts([]); return; }
    const alerts: RecordAlert[] = [];
    const flagsLower = selectedVehicle.flags.map(f => (typeof f === 'object' ? f.type : f).toLowerCase());
    if (flagsLower.some(f => f.includes('stolen'))) {
      alerts.push({ type: 'flag', priority: 'critical', title: 'STOLEN VEHICLE', description: 'Vehicle reported stolen — do not approach alone' });
    }
    if (flagsLower.some(f => f.includes('suspicious'))) {
      alerts.push({ type: 'flag', priority: 'high', title: 'SUSPICIOUS VEHICLE', description: 'Flagged as suspicious — review notes' });
    }
    if (flagsLower.some(f => f.includes('bolo'))) {
      alerts.push({ type: 'bolo', priority: 'critical', title: 'BOLO MATCH', description: 'Vehicle matches an active BOLO' });
    }
    setVehicleAlerts(alerts);
  }, [selectedVehicle]);

  useEffect(() => {
    if (selectedVehicle) {
      setLoadingVehicleIncidents(true);
      apiFetch<any[]>(`/records/vehicles/${selectedVehicle.id}/incidents`)
        .then(setVehicleIncidents)
        .catch(() => setVehicleIncidents([]))
        .finally(() => setLoadingVehicleIncidents(false));
    } else {
      setVehicleIncidents([]);
    }
  }, [selectedVehicle?.id]);

  const handleVehicleSubmit = async (data: VehicleFormData) => {
    setVehicleSubmitting(true);
    setVehicleSubmitError(null);
    try {
      const payload = { ...data, year: data.year ? parseInt(data.year, 10) : null };
      if (editingVehicle) {
        await apiFetch(`/records/vehicles/${editingVehicle.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/records/vehicles', { method: 'POST', body: JSON.stringify(payload) });
      }
      setVehicleModalOpen(false);
      setEditingVehicle(undefined);
      await fetchVehicles();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save vehicle';
      setVehicleSubmitError(msg);
      setError(msg);
    } finally {
      setVehicleSubmitting(false);
    }
  };

  const openEditVehicle = (v: Vehicle) => { setEditingVehicle(v); setVehicleSubmitError(null); setVehicleModalOpen(true); };
  const openNewVehicle = () => { setEditingVehicle(undefined); setVehicleSubmitError(null); setVehicleModalOpen(true); };
  const closeModal = () => { setVehicleModalOpen(false); setEditingVehicle(undefined); setVehicleSubmitError(null); };

  const handleArchive = async (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => {
    setSelectedVehicle(null);
    await handleArchiveRecord(type, id);
  };
  const handleUnarchive = async (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => {
    setSelectedVehicle(null);
    await handleUnarchiveRecord(type, id);
  };

  const filteredVehicles = vehicles.filter((v) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      v.license_plate.toLowerCase().includes(q) ||
      v.make.toLowerCase().includes(q) ||
      v.model.toLowerCase().includes(q) ||
      v.color.toLowerCase().includes(q) ||
      (v.owner_name || '').toLowerCase().includes(q) ||
      (v.vin || '').toLowerCase().includes(q)
    );
  });

  return {
    selectedVehicle, setSelectedVehicle,
    vehicleModalOpen, editingVehicle, vehicleSubmitting, vehicleSubmitError,
    openNewVehicle, openEditVehicle, handleVehicleSubmit, closeModal,
    vehicleAlerts, vehicleIncidents, loadingVehicleIncidents,
    filteredVehicles, handleArchive, handleUnarchive,
    searchQuery, setSearchQuery, showArchived,
    setDeleteTarget, linkRefreshKey, openLinkModal,
  };
}

// ════════════════════════════════════════════════════
// Feature 22: Plate Lookup Panel
// ════════════════════════════════════════════════════

function PlateLookupPanel({ onAutoFill }: { onAutoFill?: (data: Partial<Vehicle>) => void }) {
  const [plate, setPlate] = useState('');
  const [plateState, setPlateState] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Feature 32: BOLO matches
  const [boloMatches, setBoloMatches] = useState<any[]>([]);
  // Multi-source plate check results
  const [plateCheckResults, setPlateCheckResults] = useState<any[]>([]);
  const [plateCheckSources, setPlateCheckSources] = useState<string[]>([]);

  const handleLookup = async () => {
    if (plate.trim().length < 2) return;
    setLoading(true);
    try {
      const [vehicleRes, boloRes, plateCheckRes] = await Promise.all([
        apiFetch<any[]>(`/records/vehicles/plate-lookup?plate=${encodeURIComponent(plate.trim())}${plateState ? `&state=${encodeURIComponent(plateState)}` : ''}`),
        apiFetch<any>(`/records/vehicles/bolo-check?plate=${encodeURIComponent(plate.trim())}`),
        apiFetch<any>('/records/plate-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plate: plate.trim(), state: plateState || undefined }),
        }).catch(() => null),
      ]);
      setResults(Array.isArray(vehicleRes) ? vehicleRes : []);
      setBoloMatches(boloRes?.matches || []);
      setPlateCheckResults(plateCheckRes?.results || []);
      setPlateCheckSources(plateCheckRes?.sources || []);
    } catch {
      setResults([]);
      setBoloMatches([]);
      setPlateCheckResults([]);
      setPlateCheckSources([]);
    } finally {
      setLoading(false);
    }
  };

  const handleAutoFillFromResult = (v: any) => {
    if (!onAutoFill) return;
    onAutoFill({
      license_plate: v.plate_number || v.license_plate || '',
      plate_state: v.state || v.plate_state || '',
      make: v.make || '',
      model: v.model || '',
      year: v.year || 0,
      color: v.color || '',
      vin: v.vin || '',
      owner_name: v.registered_owner || (v.owner_first_name ? `${v.owner_first_name} ${v.owner_last_name || ''}`.trim() : ''),
      body_style: v.vehicle_type || v.body_style || '',
      notes: v.source ? `Auto-filled from ${v.source}` : '',
    } as Partial<Vehicle>);
  };

  // Merge all results for display, dedup by plate+source
  const allDisplayResults = [...results.map(r => ({ ...r, source: 'local' })), ...plateCheckResults.filter(pc => pc.source !== 'local_vehicles')];

  return (
    <div className="border-b border-rmpg-600">
      <button type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-1.5 flex items-center gap-2 text-[10px] text-rmpg-400 hover:text-rmpg-200 hover:bg-rmpg-700/30 transition-colors"
      >
        <Shield className="w-3 h-3" />
        <span className="font-bold">Plate Check / BOLO Check</span>
        {plateCheckSources.length > 0 && (
          <span className="text-[8px] px-1 py-0.5 bg-green-900/30 text-green-400 rounded-sm">{plateCheckSources.length} sources</span>
        )}
        <span className="ml-auto">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-2">
          <div className="flex gap-1.5">
            <input
              type="text"
              className="input-dark flex-1 text-[10px] min-h-[36px]"
              placeholder="Plate number..."
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLookup(); }}
            />
            <input
              type="text"
              className="input-dark text-[10px] min-h-[36px]"
              style={{ width: 40 }}
              placeholder="ST"
              maxLength={2}
              value={plateState}
              onChange={(e) => setPlateState(e.target.value.toUpperCase())}
            />
            <button type="button" onClick={handleLookup} className="toolbar-btn text-[9px]" disabled={loading || plate.trim().length < 2}>
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Search'}
            </button>
          </div>
          {/* BOLO Warning */}
          {boloMatches.length > 0 && (
            <div className="p-2 bg-red-950/40 border border-red-700/50 text-[10px]">
              <div className="flex items-center gap-1.5 text-red-400 font-bold mb-1">
                <AlertTriangle className="w-3.5 h-3.5" /> BOLO MATCH ({boloMatches.length})
              </div>
              {boloMatches.map((b: any) => (
                <div key={b.id} className="text-red-300 text-[9px] mt-0.5">
                  {b.bolo_number}: {b.vehicle_description} — {b.suspect_name || 'Unknown'}
                </div>
              ))}
            </div>
          )}
          {/* Multi-source Results */}
          {allDisplayResults.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {allDisplayResults.map((v: any, idx: number) => (
                <div key={`${v.source}-${v.id || idx}`} className="text-[10px] p-1.5 bg-surface-sunken border border-rmpg-600 rounded-sm">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-green-400 font-mono">{v.plate_number || v.license_plate} {v.state || v.plate_state}</div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[8px] px-1 py-0.5 bg-[#1a2636] text-rmpg-400 rounded-sm">{v.source}</span>
                      {onAutoFill && (
                        <button
                          type="button"
                          onClick={() => handleAutoFillFromResult(v)}
                          className="text-[8px] px-1.5 py-0.5 bg-brand-600/30 hover:bg-brand-600/50 text-brand-300 rounded-sm transition-colors"
                          title="Auto-fill new vehicle form with this data"
                        >
                          Auto-Fill
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="text-rmpg-300">{v.year} {v.make} {v.model} {v.color}</div>
                  {(v.registered_owner || v.owner_first_name) && (
                    <div className="text-rmpg-400">Owner: {v.registered_owner || `${v.owner_first_name} ${v.owner_last_name || ''}`}</div>
                  )}
                  {v.vin && <div className="text-rmpg-500 font-mono text-[9px]">VIN: {v.vin}</div>}
                </div>
              ))}
            </div>
          )}
          {allDisplayResults.length === 0 && plate.trim().length >= 2 && !loading && (
            <div className="text-[9px] text-rmpg-500">No records found across any source</div>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════
// LIST — VehiclesTabList (left panel content)
// ════════════════════════════════════════════════════

export function VehiclesTabList({ state }: { state: VehiclesTabState }) {
  const {
    filteredVehicles, selectedVehicle, setSelectedVehicle,
    searchQuery, setSearchQuery, showArchived,
    openEditVehicle, setDeleteTarget, handleArchive, handleUnarchive,
    vehicleModalOpen, editingVehicle, vehicleSubmitting, vehicleSubmitError, handleVehicleSubmit, closeModal,
  } = state;

  return (
    <div className="h-full flex flex-col">
      {/* Search */}
      <div className="p-3 border-b border-rmpg-600" role="search">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400 pointer-events-none" />
          <input
            type="text"
            className="input-dark pl-9 w-full text-[11px] min-h-[36px] focus:ring-1 focus:ring-brand-500/50 focus:border-brand-600 transition-shadow"
            placeholder="Search by plate, make, model, VIN, owner..." aria-label="Search by plate, make, model, VIN, owner..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-400 hover:text-white transition-colors" aria-label="Clear search">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Feature 22: Plate Lookup / Plate Check Section */}
      <PlateLookupPanel onAutoFill={(data) => {
        // Open the vehicle form modal pre-filled with plate check data
        openEditVehicle({
          id: '', license_plate: data.license_plate || '', plate_state: data.plate_state || 'UT',
          make: data.make || '', model: data.model || '', year: data.year || 0,
          color: data.color || '', vin: data.vin || '',
          notes: data.notes || '',
          secondary_color: '', body_style: (data as any).vehicle_type || '',
          incident_ids: [], flags: [], created_at: '', updated_at: '',
        } as Vehicle);
      }} />

      {/* Vehicle List */}
      <div className="flex-1 overflow-auto scrollbar-dark" role="list" aria-label="Vehicle records">
        {filteredVehicles.length === 0 && (
          <div className="text-center py-16">
            <Car className="w-10 h-10 text-rmpg-600 mx-auto mb-3" />
            <p className="text-sm text-rmpg-400 font-medium">{searchQuery ? 'No vehicles match your search.' : 'No vehicle records found.'}</p>
            <p className="text-[10px] text-rmpg-600 mt-1">
              {searchQuery ? 'Try adjusting your search terms.' : 'Click "New Vehicle" to add a record.'}
            </p>
          </div>
        )}
        {filteredVehicles.map((v, idx) => (
          <div
            key={v.id}
            role="listitem"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedVehicle(selectedVehicle?.id === v.id ? null : v); } }}
            onClick={() => setSelectedVehicle(selectedVehicle?.id === v.id ? null : v)}
            className={`
              px-4 py-3 border-b border-rmpg-700/50 cursor-pointer transition-all duration-150
              ${selectedVehicle?.id === v.id
                ? 'bg-brand-900/20 border-l-2 border-l-brand-500'
                : `hover:bg-rmpg-700/30 border-l-2 border-l-transparent ${idx % 2 === 1 ? 'bg-rmpg-800/20' : ''}`
              }
            `}
            aria-selected={selectedVehicle?.id === v.id}
          >
            <div className="flex items-center gap-3">
              <div className={`flex-shrink-0 w-9 h-9 rounded-sm flex items-center justify-center text-[10px] font-bold font-mono border ${
                v.stolen_status && v.stolen_status !== 'None' && v.stolen_status !== 'Recovered'
                  ? 'bg-red-900/40 text-red-400 border-red-700/50'
                  : 'bg-rmpg-700 text-rmpg-300 border-rmpg-600'
              }`}>
                {v.license_plate.slice(0, 4) || '----'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white font-mono">{v.license_plate}</span>
                  <span className="text-[10px] text-rmpg-400">{v.plate_state}</span>
                  {v.stolen_status && v.stolen_status !== 'None' && v.stolen_status !== 'Recovered' && (
                    <span className="px-1 py-0.5 text-[8px] font-bold bg-red-900/60 text-red-400 border border-red-700/50 animate-pulse">STOLEN</span>
                  )}
                  {v.tow_status && v.tow_status !== 'None' && (
                    <span className="px-1 py-0.5 text-[8px] font-bold bg-amber-900/40 text-amber-400 border border-amber-700/50">{v.tow_status.toUpperCase()}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[10px] text-rmpg-400">
                  <span>{v.year || '-'} {v.make} {v.model}</span>
                  <span>{v.color}{v.secondary_color ? `/${v.secondary_color}` : ''}</span>
                  {v.body_style && <span className="text-rmpg-500">{v.body_style}</span>}
                </div>
                {(v.owner_name || v.vin) && (
                  <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-500">
                    {v.owner_name && <span>Owner: {v.owner_name}</span>}
                    {v.vin && <span className="font-mono">VIN: ...{v.vin.slice(-6)}</span>}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                {v.flags.length > 0 && (
                  <div className="flex gap-1">
                    {v.flags.slice(0, 2).map((flag, i) => {
                      const label = typeof flag === 'object' ? (flag.type || 'FLAG') : flag;
                      return (
                        <span key={`${label}-${i}`} className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold border ${FLAG_COLORS[label] || 'bg-rmpg-700 text-rmpg-300 border-rmpg-600'}`}>
                          {label}
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  {!showArchived && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); openEditVehicle(v); }} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-brand-400 transition-colors" title="Edit">
                      <Pencil className="w-3 h-3" />
                    </button>
                  )}
                  <button type="button" onClick={(e) => { e.stopPropagation(); openRecordWindow('vehicle', v.id); }} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-brand-400 transition-colors" title="Open in Window">
                    <ExternalLink className="w-3 h-3" />
                  </button>
                  {!showArchived && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'vehicle', id: v.id, label: `${v.license_plate} ${v.make} ${v.model}` }); }} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-red-400 transition-colors" title="Delete">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                  {!showArchived && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleArchive('vehicles', v.id); }} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-amber-400 transition-colors" title="Archive">
                      <Archive className="w-3 h-3" />
                    </button>
                  )}
                  {showArchived && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleUnarchive('vehicles', v.id); }} className="p-0.5 hover:bg-rmpg-700 text-rmpg-500 hover:text-green-400 transition-colors" title="Unarchive">
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Vehicle Form Modal */}
      <VehicleFormModal
        isOpen={vehicleModalOpen}
        onClose={closeModal}
        onSubmit={handleVehicleSubmit}
        isSubmitting={vehicleSubmitting}
        editingVehicle={editingVehicle}
        submitError={vehicleSubmitError}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════
// DETAIL — VehiclesTabDetail (right panel content)
// ════════════════════════════════════════════════════

export function VehiclesTabDetail({ state }: { state: VehiclesTabState }) {
  const {
    selectedVehicle, vehicleAlerts, vehicleIncidents, loadingVehicleIncidents,
    linkRefreshKey, openLinkModal,
  } = state;

  // ── Feature 41: Vehicle History Report ──
  const [vehicleHistory, setVehicleHistory] = React.useState<any>(null);
  const handleLoadHistory = async (vId: string) => {
    try {
      const data = await apiFetch<any>(`/records/vehicles/${vId}/history`);
      setVehicleHistory(data?.data || data);
    } catch { /* ignore */ }
  };

  // ── Feature 44: Stolen Vehicle Check ──
  const [stolenCheckResult, setStolenCheckResult] = React.useState<any>(null);
  const handleStolenCheck = async () => {
    if (!selectedVehicle) return;
    try {
      const data = await apiFetch<any>('/records/vehicles/stolen-check', {
        method: 'POST',
        body: JSON.stringify({ plate_number: selectedVehicle.license_plate, vin: selectedVehicle.vin }),
      });
      setStolenCheckResult(data?.data || data);
    } catch { /* ignore */ }
  };

  if (!selectedVehicle) return null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Alert Banner + Status badges */}
      <div className="px-4 pt-3 pb-2 border-b border-rmpg-600 bg-surface-sunken flex-shrink-0">
        <AlertBanner alerts={vehicleAlerts} />
        {/* Vehicle sub-header */}
        <div className="flex items-center gap-3 text-[10px] text-rmpg-400">
          <span>{selectedVehicle.year || '-'} {selectedVehicle.make} {selectedVehicle.model}</span>
          <span>{selectedVehicle.color}{selectedVehicle.secondary_color ? ` / ${selectedVehicle.secondary_color}` : ''}</span>
          {selectedVehicle.body_style && <span>{selectedVehicle.body_style}</span>}
          <span>({selectedVehicle.plate_state})</span>
        </div>
        {/* Feature 41+44 Action Buttons */}
        <div className="flex gap-1 mt-1">
          <button type="button" onClick={() => handleLoadHistory(selectedVehicle.id)} className="text-[9px] px-2 py-0.5 bg-blue-900/30 border border-blue-700/50 text-blue-400 hover:bg-blue-900/50">
            <FileText style={{ width: 10, height: 10, display: 'inline' }} /> History Report
          </button>
          <button type="button" onClick={handleStolenCheck} className="text-[9px] px-2 py-0.5 bg-red-900/30 border border-red-700/50 text-red-400 hover:bg-red-900/50">
            <Shield style={{ width: 10, height: 10, display: 'inline' }} /> Stolen Check
          </button>
        </div>
        {/* Feature 44: Stolen Check Result */}
        {stolenCheckResult && (
          <div className={`mt-1 p-1.5 text-[10px] border ${stolenCheckResult.status === 'HIT' ? 'bg-red-900/30 border-red-700/50 text-red-300' : 'bg-green-900/30 border-green-700/50 text-green-300'}`}>
            <span className="font-bold">{stolenCheckResult.status}</span> — {stolenCheckResult.message}
            <button type="button" onClick={() => setStolenCheckResult(null)} className="ml-2 text-rmpg-500">x</button>
          </div>
        )}
        {/* Feature 41: History Panel */}
        {vehicleHistory && (
          <div className="mt-1 p-1.5 text-[10px] bg-blue-900/10 border border-blue-700/30">
            <div className="flex justify-between">
              <span className="text-blue-400 font-bold">Vehicle History ({vehicleHistory.total_records} records)</span>
              <button type="button" onClick={() => setVehicleHistory(null)} className="text-rmpg-500">x</button>
            </div>
            {vehicleHistory.incidents?.length > 0 && <div className="text-rmpg-400 mt-0.5">{vehicleHistory.incidents.length} incidents</div>}
            {vehicleHistory.citations?.length > 0 && <div className="text-rmpg-400">{vehicleHistory.citations.length} citations</div>}
            {vehicleHistory.tows?.length > 0 && <div className="text-rmpg-400">{vehicleHistory.tows.length} tows</div>}
          </div>
        )}
        {/* Flags */}
        {selectedVehicle.flags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1">
            {selectedVehicle.flags.map((flag, i) => {
              const label = typeof flag === 'object' ? (flag.type || 'FLAG') : flag;
              return (
                <span key={`${label}-${i}`} className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold border ${FLAG_COLORS[label] || 'bg-rmpg-700 text-rmpg-300 border-rmpg-600'}`}>
                  {label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Scrollable Detail Sections */}
      <div className="flex-1 overflow-auto p-2 space-y-1">

        {/* ── Vehicle Details ─────────────────────── */}
        <CollapsibleSection title="Vehicle Details" icon={Car} defaultOpen>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            {renderInfoRow('Plate', selectedVehicle.license_plate)}
            {renderInfoRow('State', selectedVehicle.plate_state)}
            {renderInfoRow('Plate Type', selectedVehicle.plate_type)}
            {renderInfoRow('Year', selectedVehicle.year ? String(selectedVehicle.year) : null)}
            {renderInfoRow('Make', selectedVehicle.make)}
            {renderInfoRow('Model', selectedVehicle.model)}
            {renderInfoRow('Trim', selectedVehicle.trim)}
            {renderInfoRow('Color', `${selectedVehicle.color}${selectedVehicle.secondary_color ? ` / ${selectedVehicle.secondary_color}` : ''}`)}
            {renderInfoRow('Body Style', selectedVehicle.body_style)}
            {renderInfoRow('Doors', selectedVehicle.doors ? String(selectedVehicle.doors) : null)}
            {renderInfoRow('Owner', selectedVehicle.owner_name)}
          </div>
          {selectedVehicle.vin && (
            <div className="mt-2 text-xs"><span className="text-rmpg-400">VIN:</span> <span className="text-rmpg-200 font-mono ml-1">{selectedVehicle.vin}</span></div>
          )}
          {(selectedVehicle.commercial_vehicle || selectedVehicle.hazmat) && (
            <div className="flex gap-2 mt-2">
              {selectedVehicle.commercial_vehicle && <span className="px-2 py-0.5 text-[10px] font-bold bg-blue-900/50 text-blue-400 border border-blue-700/50">COMMERCIAL</span>}
              {selectedVehicle.hazmat && <span className="px-2 py-0.5 text-[10px] font-bold bg-red-900/50 text-red-400 border border-red-700/50">HAZMAT</span>}
            </div>
          )}
        </CollapsibleSection>

        {/* ── Mechanical (conditional) ─────────── */}
        {(selectedVehicle.engine_type || selectedVehicle.fuel_type || selectedVehicle.transmission || selectedVehicle.drive_type || selectedVehicle.odometer) && (
          <CollapsibleSection title="Mechanical" icon={Hash} defaultOpen={false}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {renderInfoRow('Engine', selectedVehicle.engine_type)}
              {renderInfoRow('Fuel', selectedVehicle.fuel_type)}
              {renderInfoRow('Transmission', selectedVehicle.transmission)}
              {renderInfoRow('Drive', selectedVehicle.drive_type)}
              {renderInfoRow('Odometer', selectedVehicle.odometer)}
            </div>
          </CollapsibleSection>
        )}

        {/* ── Registration & Insurance ────────── */}
        <CollapsibleSection title="Registration & Insurance" icon={Shield} defaultOpen>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {renderInfoRow('Reg. Expiry', selectedVehicle.registration_expiry, Calendar)}
            {renderInfoRow('Insurance', selectedVehicle.insurance_company)}
            {renderInfoRow('Policy #', selectedVehicle.insurance_policy, Hash)}
            {renderInfoRow('Lien Holder', selectedVehicle.lien_holder)}
            {renderInfoRow('Owner Address', selectedVehicle.owner_address, MapPin)}
            {renderInfoRow('Owner Phone', selectedVehicle.owner_phone, Phone)}
          </div>
        </CollapsibleSection>

        {/* ── Stolen / Tow Status (conditional) ── */}
        {(selectedVehicle.stolen_status || selectedVehicle.tow_status) && (
          <CollapsibleSection title="Stolen / Tow Status" icon={AlertTriangle}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {renderInfoRow('Stolen Status', selectedVehicle.stolen_status)}
              {renderInfoRow('Stolen Date', selectedVehicle.stolen_date, Calendar)}
              {renderInfoRow('Recovery Date', selectedVehicle.recovery_date, Calendar)}
              {renderInfoRow('Tow Status', selectedVehicle.tow_status)}
              {renderInfoRow('Tow Company', selectedVehicle.tow_company)}
              {renderInfoRow('Tow Date', selectedVehicle.tow_date, Calendar)}
            </div>
          </CollapsibleSection>
        )}

        {/* ── Damage & Features (conditional) ──── */}
        {(selectedVehicle.damage_description || selectedVehicle.distinguishing_features) && (
          <CollapsibleSection title="Damage & Features" icon={AlertTriangle}>
            {selectedVehicle.damage_description && (
              <div className="mb-2">
                <label className="text-[10px] text-red-400 uppercase font-semibold">Damage:</label>
                <p className="text-xs text-red-300/80 mt-0.5">{selectedVehicle.damage_description}</p>
              </div>
            )}
            {selectedVehicle.distinguishing_features && (
              <div>
                <label className="text-[10px] text-amber-400 uppercase font-semibold">Distinguishing Features:</label>
                <p className="text-xs text-amber-300/80 mt-0.5">{selectedVehicle.distinguishing_features}</p>
              </div>
            )}
          </CollapsibleSection>
        )}

        {/* ── Notes (conditional) ──────────────── */}
        {selectedVehicle.notes && (
          <CollapsibleSection title="Notes" icon={FileText} defaultOpen={false}>
            <p className="text-xs text-rmpg-200 leading-relaxed">{selectedVehicle.notes}</p>
          </CollapsibleSection>
        )}

        {/* ── Incident History ─────────────────── */}
        <CollapsibleSection title={`Incident History (${vehicleIncidents.length})`} icon={FileText}>
          {loadingVehicleIncidents ? (
            <div className="flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin text-brand-400" role="status" aria-label="Loading" /><span className="text-[11px] text-rmpg-400">Loading...</span></div>
          ) : vehicleIncidents.length > 0 ? (
            <div className="space-y-1">
              {vehicleIncidents.map((inc: any) => (
                <div key={inc.id} className="flex items-center gap-2 text-xs px-2 py-1.5 bg-surface-raised border border-rmpg-700">
                  <span className="text-white font-mono font-bold">{inc.incident_number}</span>
                  <span className="px-1 py-0.5 bg-amber-900/40 text-amber-300 text-[10px] uppercase font-bold">
                    {(inc.role || '').replace(/_/g, ' ')}
                  </span>
                  <span className="text-rmpg-300">{(inc.incident_type || '').replace(/_/g, ' ')}</span>
                  <StatusBadge status={inc.status} type="incident_status" size="sm" />
                  <span className="text-rmpg-400 ml-auto">{inc.created_at ? new Date(inc.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : ''}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-rmpg-500">No incidents linked</p>
          )}
        </CollapsibleSection>

        {/* ── Linked Records ───────────────────── */}
        <LinkedRecordsSection
          key={`vehicle-links-${selectedVehicle.id}-${linkRefreshKey}`}
          entityType="vehicle"
          entityId={selectedVehicle.id}
          onOpenLinkModal={() => openLinkModal('vehicle', selectedVehicle.id)}
        />

        {/* ── File Attachments ─────────────────── */}
        <div className="panel-beveled p-3 bg-surface-base">
          <FileAttachments entityType="vehicle" entityId={selectedVehicle.id} />
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════
// Legacy default export
// ════════════════════════════════════════════════════

export default function VehiclesTab(props: VehiclesTabProps) {
  const state = useVehiclesTab(props);

  // Set document title
  useEffect(() => { document.title = 'Records - Vehicles \u2014 RMPG Flex'; }, []);

  if (props.loadingVehicles) return null;

  return (
    <>
      <div className={`${state.selectedVehicle ? 'w-[40%]' : 'w-full'} border-r border-rmpg-600 flex flex-col overflow-hidden transition-all`}>
        <VehiclesTabList state={state} />
      </div>
      {state.selectedVehicle && (
        <div className="w-[60%] flex flex-col overflow-hidden">
          <VehiclesTabDetail state={state} />
        </div>
      )}
    </>
  );
}

export { parseFlags, FLAG_COLORS };

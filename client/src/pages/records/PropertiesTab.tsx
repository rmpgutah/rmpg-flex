import React, { useState, useEffect } from 'react';
import {
  Search, Building2, Shield, MapPin, FileWarning, Trash2, Pencil, X, Phone,
  AlertTriangle, Calendar, Archive, RotateCcw, Globe, Users, Key, FileText, Wrench,
  Camera, ArrowUpDown, Filter,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import PropertyFormModal from '../../components/PropertyFormModal';
import FileAttachments from '../../components/FileAttachments';
import LinkedRecordsSection from '../../components/LinkedRecordsSection';
import CollapsibleSection from '../../components/CollapsibleSection';
import type { Property, RecordEntityType } from '../../types';
import type { PropertyFormData } from '../../components/PropertyFormModal';

// ── DB Mapper ──────────────────────────────────────

export function mapDbProperty(row: Record<string, unknown>): Property {
  return {
    id: String(row.id ?? ''),
    client_id: String(row.client_id ?? ''),
    client_name: row.client_name ? String(row.client_name) : undefined,
    name: String(row.name ?? ''),
    address: String(row.address ?? ''),
    city: row.city ? String(row.city) : '',
    state: row.state ? String(row.state) : '',
    zip: row.zip ? String(row.zip) : '',
    latitude: row.latitude != null ? Number(row.latitude) : undefined,
    longitude: row.longitude != null ? Number(row.longitude) : undefined,
    property_type: row.property_type ? String(row.property_type) : undefined,
    gate_code: row.gate_code ? String(row.gate_code) : undefined,
    alarm_code: row.alarm_code ? String(row.alarm_code) : undefined,
    emergency_contact: row.emergency_contact ? String(row.emergency_contact) : undefined,
    post_orders: row.post_orders ? String(row.post_orders) : undefined,
    hazard_notes: row.hazard_notes ? String(row.hazard_notes) : undefined,
    access_instructions: row.access_instructions ? String(row.access_instructions) : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    is_active: row.is_active !== 0 && row.is_active !== false,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    // Building details
    business_type: row.business_type ? String(row.business_type) : undefined,
    structure_type: row.structure_type ? String(row.structure_type) : undefined,
    occupancy_status: row.occupancy_status ? String(row.occupancy_status) : undefined,
    year_built: row.year_built ? String(row.year_built) : undefined,
    square_footage: row.square_footage ? String(row.square_footage) : undefined,
    number_of_stories: row.number_of_stories ? String(row.number_of_stories) : undefined,
    // Security
    security_features: row.security_features ? String(row.security_features) : undefined,
    alarm_company: row.alarm_company ? String(row.alarm_company) : undefined,
    alarm_account: row.alarm_account ? String(row.alarm_account) : undefined,
    camera_system: row.camera_system ? String(row.camera_system) : undefined,
    roof_access: row.roof_access ? String(row.roof_access) : undefined,
    // Key holder
    key_holder_name: row.key_holder_name ? String(row.key_holder_name) : undefined,
    key_holder_phone: row.key_holder_phone ? String(row.key_holder_phone) : undefined,
    key_holder_relationship: row.key_holder_relationship ? String(row.key_holder_relationship) : undefined,
    // Owner
    owner_name: row.owner_name ? String(row.owner_name) : undefined,
    owner_phone: row.owner_phone ? String(row.owner_phone) : undefined,
    // Inspection
    last_inspection_date: row.last_inspection_date ? String(row.last_inspection_date) : undefined,
    inspection_status: row.inspection_status ? String(row.inspection_status) : undefined,
    // Site details
    parking_info: row.parking_info ? String(row.parking_info) : undefined,
    utility_shutoffs: row.utility_shutoffs ? String(row.utility_shutoffs) : undefined,
    known_hazards: row.known_hazards ? String(row.known_hazards) : undefined,
  };
}

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

function safeDateTimeDisplay(value?: string | null): string | null {
  const formatted = safeDateTimeStr(value, '');
  return formatted || null;
}

// ── Props ──────────────────────────────────────────

export interface PropertiesTabProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  showArchived: boolean;
  setError: (err: string | null) => void;
  properties: Property[];
  setProperties: React.Dispatch<React.SetStateAction<Property[]>>;
  loadingProperties: boolean;
  setLoadingProperties: React.Dispatch<React.SetStateAction<boolean>>;
  setDeleteTarget: React.Dispatch<React.SetStateAction<{ type: 'person' | 'vehicle' | 'property' | 'evidence'; id: string; label: string } | null>>;
  linkRefreshKey: number;
  openLinkModal: (type: RecordEntityType, id: string) => void;
  handleArchiveRecord: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  handleUnarchiveRecord: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  fetchProperties: () => Promise<void>;
  clients: { id: string; name: string; status: string }[];
  /** Increment to open the "New Property" modal from parent */
  openNewTrigger?: number;
}

// ── Hook Return ────────────────────────────────────

export interface PropertiesTabState {
  selectedProperty: Property | null;
  setSelectedProperty: React.Dispatch<React.SetStateAction<Property | null>>;
  propertyModalOpen: boolean;
  editingProperty: Property | undefined;
  propertySubmitting: boolean;
  openNewProperty: () => void;
  openEditProperty: (p: Property) => void;
  handlePropertySubmit: (data: PropertyFormData) => Promise<void>;
  closeModal: () => void;
  filteredProperties: Property[];
  handleArchive: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  handleUnarchive: (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => Promise<void>;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  showArchived: boolean;
  setDeleteTarget: PropertiesTabProps['setDeleteTarget'];
  linkRefreshKey: number;
  openLinkModal: (type: RecordEntityType, id: string) => void;
  clients: { id: string; name: string; status: string }[];
  properties: Property[];
  propertySubmitError: string | null;
}

// ════════════════════════════════════════════════════
// HOOK — usePropertiesTab
// ════════════════════════════════════════════════════

export function usePropertiesTab(props: PropertiesTabProps): PropertiesTabState {
  const {
    searchQuery, setSearchQuery, showArchived, setError,
    properties, setDeleteTarget, linkRefreshKey,
    openLinkModal, handleArchiveRecord, handleUnarchiveRecord,
    fetchProperties, clients, openNewTrigger,
  } = props;

  const [propertyModalOpen, setPropertyModalOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | undefined>(undefined);
  const [propertySubmitting, setPropertySubmitting] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [propertySubmitError, setPropertySubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (openNewTrigger && openNewTrigger > 0) {
      setEditingProperty(undefined);
      setPropertyModalOpen(true);
    }
  }, [openNewTrigger]);

  useEffect(() => {
    if (selectedProperty && !properties.find(p => p.id === selectedProperty.id)) {
      setSelectedProperty(null);
    }
  }, [properties, selectedProperty]);

  const handlePropertySubmit = async (data: PropertyFormData) => {
    setPropertySubmitting(true);
    try {
      const payload = {
        ...data,
        is_active: data.is_active,
        latitude: data.latitude ? parseFloat(data.latitude) : null,
        longitude: data.longitude ? parseFloat(data.longitude) : null,
        client_id: data.client_id || null,
      };
      if (editingProperty) {
        await apiFetch(`/records/properties/${editingProperty.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await apiFetch('/records/properties', { method: 'POST', body: JSON.stringify(payload) });
      }
      setPropertyModalOpen(false);
      setEditingProperty(undefined);
      await fetchProperties();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save property';
      setPropertySubmitError(msg);
      setError(msg);
    } finally {
      setPropertySubmitting(false);
    }
  };

  const openEditProperty = (p: Property) => { setPropertySubmitError(null); setEditingProperty(p); setPropertyModalOpen(true); };
  const openNewProperty = () => { setPropertySubmitError(null); setEditingProperty(undefined); setPropertyModalOpen(true); };
  const closeModal = () => { setPropertySubmitError(null); setPropertyModalOpen(false); setEditingProperty(undefined); };

  const handleArchive = async (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => {
    setSelectedProperty(null);
    await handleArchiveRecord(type, id);
  };
  const handleUnarchive = async (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => {
    setSelectedProperty(null);
    await handleUnarchiveRecord(type, id);
  };

  const filteredProperties = properties.filter((p) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.address.toLowerCase().includes(q) ||
      (p.client_name || '').toLowerCase().includes(q)
    );
  });

  return {
    selectedProperty, setSelectedProperty,
    propertyModalOpen, editingProperty, propertySubmitting,
    openNewProperty, openEditProperty, handlePropertySubmit, closeModal,
    filteredProperties, handleArchive, handleUnarchive,
    searchQuery, setSearchQuery, showArchived,
    setDeleteTarget, linkRefreshKey, openLinkModal,
    clients, properties, propertySubmitError,
  };
}

// ════════════════════════════════════════════════════
// LIST — PropertiesTabList (left panel content)
// ════════════════════════════════════════════════════

export function PropertiesTabList({ state }: { state: PropertiesTabState }) {
  const {
    filteredProperties, selectedProperty, setSelectedProperty, properties,
    searchQuery, setSearchQuery, showArchived,
    openEditProperty, setDeleteTarget, handleArchive, handleUnarchive,
    propertyModalOpen, editingProperty, propertySubmitting, handlePropertySubmit, closeModal, clients,
    propertySubmitError,
  } = state;

  const [sortBy, setSortBy] = useState<'name' | 'client' | 'newest'>('name');
  const [filterType, setFilterType] = useState<string | null>(null);

  const displayProperties = React.useMemo(() => {
    let list = [...filteredProperties];
    if (filterType) {
      list = list.filter(p => {
        if (filterType === 'active') return p.is_active;
        if (filterType === 'inactive') return !p.is_active;
        if (filterType === 'hazard') return !!p.hazard_notes;
        if (filterType === 'residential') return p.property_type === 'residential';
        if (filterType === 'commercial') return p.property_type === 'commercial';
        return true;
      });
    }
    if (sortBy === 'name') list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else if (sortBy === 'client') list.sort((a, b) => (a.client_name || '').localeCompare(b.client_name || ''));
    else if (sortBy === 'newest') list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return list;
  }, [filteredProperties, sortBy, filterType]);

  return (
    <div className="h-full flex flex-col">
      {/* Summary Bar + Search */}
      <div className="px-4 py-2 border-b border-rmpg-600 flex items-center gap-4 text-[10px]">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-rmpg-300">Active:</span>
          <span className="text-green-400 font-bold">{properties.filter(p => p.is_active).length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-rmpg-500" />
          <span className="text-rmpg-300">Inactive:</span>
          <span className="text-rmpg-400 font-bold">{properties.filter(p => !p.is_active).length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 text-red-400" />
          <span className="text-rmpg-300">Hazards:</span>
          <span className="text-red-400 font-bold">{properties.filter(p => p.hazard_notes).length}</span>
        </div>
        <div className="ml-auto relative w-64" role="search">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-400 pointer-events-none" />
          <input
            type="text"
            className="input-dark pl-8 w-full text-[11px] py-1 min-h-[36px] focus:ring-1 focus:ring-brand-500/50 focus:border-brand-600 transition-shadow"
            placeholder="Search properties..." aria-label="Search properties..."
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

      {/* Sort + Filter */}
      <div className="px-3 py-1 border-b border-rmpg-700/30 flex items-center gap-1.5 text-[9px] flex-wrap">
        <ArrowUpDown className="w-3 h-3 text-rmpg-500" />
        {(['name', 'client', 'newest'] as const).map(s => (
          <button key={s} type="button" onClick={() => setSortBy(s)}
            className={`px-1.5 py-0.5 font-medium border transition-all ${sortBy === s ? 'bg-brand-900/30 border-brand-500/50 text-brand-400' : 'bg-transparent border-transparent text-rmpg-500 hover:text-rmpg-300'}`}>
            {s === 'name' ? 'Name' : s === 'client' ? 'Client' : 'Newest'}
          </button>
        ))}
        <span className="w-px h-3 bg-rmpg-700 mx-1" />
        <Filter className="w-3 h-3 text-rmpg-500" />
        {[{ key: null, label: 'All' }, { key: 'active', label: 'Active' }, { key: 'inactive', label: 'Inactive' }, { key: 'hazard', label: 'Hazard' }, { key: 'residential', label: 'Residential' }, { key: 'commercial', label: 'Commercial' }].map(f => (
          <button key={f.key || 'all'} type="button" onClick={() => setFilterType(f.key)}
            className={`px-2 py-0.5 font-medium border transition-all ${filterType === f.key ? 'bg-brand-900/30 border-brand-500/50 text-brand-400' : 'bg-transparent border-rmpg-700/50 text-rmpg-500 hover:text-rmpg-300'}`}>
            {f.label}
          </button>
        ))}
        {filterType && <span className="text-rmpg-500 ml-1">({displayProperties.length})</span>}
      </div>

      {/* Property List */}
      <div className="flex-1 overflow-auto scrollbar-dark" role="list" aria-label="Property records">
        {displayProperties.length === 0 && (
          <div className="text-center py-16">
            <Building2 className="w-10 h-10 text-rmpg-600 mx-auto mb-3" />
            <p className="text-sm text-rmpg-400 font-medium">{searchQuery ? 'No properties match.' : 'No properties found.'}</p>
            <p className="text-[10px] text-rmpg-600 mt-1">
              {searchQuery ? 'Try broadening your search.' : 'Click "New Property" to add a record.'}
            </p>
          </div>
        )}
        {displayProperties.map((prop, idx) => (
          <div
            key={prop.id}
            role="listitem"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedProperty(selectedProperty?.id === prop.id ? null : prop); } }}
            onClick={() => setSelectedProperty(selectedProperty?.id === prop.id ? null : prop)}
            className={`
              px-4 py-3 border-b border-rmpg-700/50 cursor-pointer transition-all duration-150
              ${selectedProperty?.id === prop.id
                ? 'bg-brand-900/20 border-l-2 border-l-brand-500'
                : `hover:bg-rmpg-700/30 border-l-2 ${prop.hazard_notes ? 'border-l-red-600' : 'border-l-transparent'} ${idx % 2 === 1 ? 'bg-rmpg-800/20' : ''}`
              }
            `}
            aria-selected={selectedProperty?.id === prop.id}
          >
            <div className="flex items-start gap-3">
              <div className={`flex-shrink-0 w-9 h-9 rounded-sm flex items-center justify-center border ${
                prop.is_active ? 'bg-brand-900/30 text-brand-400 border-brand-700/50' : 'bg-rmpg-800 text-rmpg-500 border-rmpg-600'
              }`}>
                <Building2 className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-bold text-white truncate">{prop.name}</h4>
                  {prop.hazard_notes && <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />}
                  <span className={`ml-auto px-1.5 py-0.5 text-[8px] font-bold border flex-shrink-0 ${
                    prop.is_active
                      ? 'bg-green-900/50 text-green-400 border-green-700/50'
                      : 'bg-rmpg-700 text-rmpg-400 border-rmpg-600'
                  }`}>
                    {prop.is_active ? 'ACTIVE' : 'INACTIVE'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-rmpg-300 truncate">
                  <MapPin className="w-2.5 h-2.5 text-rmpg-400 flex-shrink-0" />
                  {prop.address}{prop.city ? `, ${prop.city}` : ''}{prop.state ? `, ${prop.state}` : ''} {prop.zip}
                </div>
                {prop.client_name && (
                  <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-rmpg-500">
                    <Users className="w-2.5 h-2.5" />
                    {prop.client_name}
                  </div>
                )}
                {prop.property_type && (
                  <span className="inline-block mt-1 px-1.5 py-0.5 text-[8px] font-bold uppercase bg-rmpg-700 text-rmpg-300 border border-rmpg-600">
                    {prop.property_type}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Property Form Modal */}
      <PropertyFormModal
        isOpen={propertyModalOpen}
        onClose={closeModal}
        onSubmit={handlePropertySubmit}
        isSubmitting={propertySubmitting}
        editingProperty={editingProperty}
        clients={clients}
        submitError={propertySubmitError}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════
// DETAIL — PropertiesTabDetail (right panel content)
// ════════════════════════════════════════════════════

export function PropertiesTabDetail({ state }: { state: PropertiesTabState }) {
  const { user } = useAuth();
  const {
    selectedProperty, showArchived,
    openEditProperty, setDeleteTarget, handleArchive, handleUnarchive,
    linkRefreshKey, openLinkModal,
  } = state;

  if (!selectedProperty) return null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Status header */}
      <div className="px-4 pt-3 pb-2 border-b border-rmpg-600 bg-surface-sunken flex-shrink-0">
        <div className="flex items-center gap-1.5 text-[10px] text-rmpg-300">
          <MapPin className="w-3 h-3 text-rmpg-400" />
          {selectedProperty.address}{selectedProperty.city ? `, ${selectedProperty.city}` : ''}{selectedProperty.state ? `, ${selectedProperty.state}` : ''} {selectedProperty.zip}
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <span className={`px-2 py-0.5 text-[9px] font-bold uppercase border ${
            selectedProperty.is_active
              ? 'bg-green-900/50 text-green-400 border-green-700/50'
              : 'bg-rmpg-700 text-rmpg-400 border-rmpg-600'
          }`}>
            {selectedProperty.is_active ? 'ACTIVE' : 'INACTIVE'}
          </span>
          {selectedProperty.property_type && (
            <span className="px-2 py-0.5 text-[9px] font-bold uppercase bg-rmpg-700 text-rmpg-300 border border-rmpg-600">
              {selectedProperty.property_type}
            </span>
          )}
          {selectedProperty.hazard_notes && <AlertTriangle className="w-3.5 h-3.5 text-red-400" />}
          {/* Inline action buttons for properties (edit/delete/archive in detail header) */}
          <div className="ml-auto flex items-center gap-1">
            {(!showArchived || user?.role === 'admin') && (
              <>
                <button type="button" onClick={() => openEditProperty(selectedProperty)} className="p-1 hover:bg-rmpg-700 text-rmpg-400 hover:text-white transition-colors" title="Edit">
                  <Pencil className="w-3 h-3" />
                </button>
                <button type="button" onClick={() => setDeleteTarget({ type: 'property', id: selectedProperty.id, label: selectedProperty.name })} className="p-1 hover:bg-rmpg-700 text-rmpg-400 hover:text-red-400 transition-colors" title="Delete">
                  <Trash2 className="w-3 h-3" />
                </button>
                <button type="button" onClick={() => handleArchive('properties', selectedProperty.id)} className="p-1 hover:bg-rmpg-700 text-rmpg-400 hover:text-amber-400 transition-colors" title="Archive">
                  <Archive className="w-3 h-3" />
                </button>
              </>
            )}
            {showArchived && (
              <button type="button" onClick={() => handleUnarchive('properties', selectedProperty.id)} className="p-1 hover:bg-rmpg-700 text-rmpg-400 hover:text-green-400 transition-colors" title="Unarchive">
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable Detail Sections */}
      <div className="flex-1 overflow-auto p-2 space-y-1">

        {/* ── Client ──────────────────────────── */}
        {selectedProperty.client_name && (
          <CollapsibleSection title="Client" icon={Users} defaultOpen>
            <p className="text-sm text-white font-semibold">{selectedProperty.client_name}</p>
          </CollapsibleSection>
        )}

        {/* ── Property Details ────────────────── */}
        <CollapsibleSection title="Property Details" icon={Building2} defaultOpen>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {renderInfoRow('Property Type', selectedProperty.property_type)}
            {renderInfoRow('Business Type', selectedProperty.business_type)}
            {renderInfoRow('Structure Type', selectedProperty.structure_type)}
            {renderInfoRow('Occupancy', selectedProperty.occupancy_status)}
            {renderInfoRow('Year Built', selectedProperty.year_built)}
            {renderInfoRow('Sq. Footage', selectedProperty.square_footage)}
            {renderInfoRow('Stories', selectedProperty.number_of_stories)}
            {selectedProperty.latitude != null && selectedProperty.longitude != null && (
              renderInfoRow('Coordinates', `${selectedProperty.latitude.toFixed(5)}, ${selectedProperty.longitude.toFixed(5)}`, Globe)
            )}
          </div>
        </CollapsibleSection>

        {/* ── Security & Access ────────────────── */}
        <CollapsibleSection title="Security & Access" icon={Shield} defaultOpen>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {renderInfoRow('Gate Code', selectedProperty.gate_code, Shield)}
            {renderInfoRow('Alarm Code', selectedProperty.alarm_code, Shield)}
            {renderInfoRow('Alarm Company', selectedProperty.alarm_company)}
            {renderInfoRow('Alarm Account', selectedProperty.alarm_account)}
            {renderInfoRow('Camera System', selectedProperty.camera_system, Camera)}
            {renderInfoRow('Security Features', selectedProperty.security_features)}
            {renderInfoRow('Roof Access', selectedProperty.roof_access)}
            {renderInfoRow('Emergency Contact', selectedProperty.emergency_contact, Phone)}
          </div>
        </CollapsibleSection>

        {/* ── Key Holder & Owner (conditional) ──── */}
        {(selectedProperty.key_holder_name || selectedProperty.owner_name) && (
          <CollapsibleSection title="Key Holder & Owner" icon={Key}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {renderInfoRow('Key Holder', selectedProperty.key_holder_name)}
              {renderInfoRow('KH Phone', selectedProperty.key_holder_phone, Phone)}
              {renderInfoRow('KH Relationship', selectedProperty.key_holder_relationship)}
              {renderInfoRow('Owner Name', selectedProperty.owner_name)}
              {renderInfoRow('Owner Phone', selectedProperty.owner_phone, Phone)}
            </div>
          </CollapsibleSection>
        )}

        {/* ── Inspection (conditional) ──────────── */}
        {(selectedProperty.last_inspection_date || selectedProperty.inspection_status) && (
          <CollapsibleSection title="Inspection" icon={Wrench}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {renderInfoRow('Last Inspection', selectedProperty.last_inspection_date, Calendar)}
              {renderInfoRow('Status', selectedProperty.inspection_status)}
            </div>
          </CollapsibleSection>
        )}

        {/* ── Post Orders (conditional) ────────── */}
        {selectedProperty.post_orders && (
          <CollapsibleSection title="Post Orders" icon={Shield} defaultOpen>
            <p className="text-xs text-rmpg-200 leading-relaxed whitespace-pre-wrap">{selectedProperty.post_orders}</p>
          </CollapsibleSection>
        )}

        {/* ── Hazard Notes (conditional) ─────── */}
        {(selectedProperty.hazard_notes || selectedProperty.known_hazards) && (
          <CollapsibleSection title="Hazard Notes" icon={FileWarning}>
            {selectedProperty.hazard_notes && <p className="text-xs text-red-300/80 leading-relaxed whitespace-pre-wrap">{selectedProperty.hazard_notes}</p>}
            {selectedProperty.known_hazards && (
              <div className="mt-1.5"><span className="text-[10px] text-red-400 uppercase font-semibold">Known Hazards:</span> <span className="text-xs text-red-300/80 ml-1">{selectedProperty.known_hazards}</span></div>
            )}
          </CollapsibleSection>
        )}

        {/* ── Site Details (conditional) ─────── */}
        {(selectedProperty.parking_info || selectedProperty.utility_shutoffs) && (
          <CollapsibleSection title="Site Details" icon={FileText}>
            <div className="grid grid-cols-1 gap-2">
              {selectedProperty.parking_info && (
                <div><span className="text-[10px] text-rmpg-400 uppercase font-semibold">Parking:</span> <span className="text-xs text-rmpg-200 ml-1">{selectedProperty.parking_info}</span></div>
              )}
              {selectedProperty.utility_shutoffs && (
                <div><span className="text-[10px] text-rmpg-400 uppercase font-semibold">Utility Shutoffs:</span> <span className="text-xs text-rmpg-200 ml-1">{selectedProperty.utility_shutoffs}</span></div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {/* ── Access Instructions (conditional) ── */}
        {selectedProperty.access_instructions && (
          <CollapsibleSection title="Access Instructions" icon={MapPin}>
            <p className="text-xs text-gray-300/80 leading-relaxed whitespace-pre-wrap">{selectedProperty.access_instructions}</p>
          </CollapsibleSection>
        )}

        {/* ── Notes (conditional) ──────────────── */}
        {selectedProperty.notes && (
          <CollapsibleSection title="Notes" icon={FileText} defaultOpen={false}>
            <p className="text-xs text-rmpg-200 leading-relaxed whitespace-pre-wrap">{selectedProperty.notes}</p>
          </CollapsibleSection>
        )}

        {selectedProperty.notes && (
          <CollapsibleSection title="Notes" icon={FileWarning}>
            <p className="text-xs text-rmpg-200 leading-relaxed whitespace-pre-wrap">{selectedProperty.notes}</p>
          </CollapsibleSection>
        )}

        {/* ── Record Info ─────────────────────── */}
        <CollapsibleSection title="Record Info" icon={Calendar} defaultOpen={false}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {renderInfoRow('Created', safeDateTimeDisplay(selectedProperty.created_at), Calendar)}
            {renderInfoRow('Updated', safeDateTimeDisplay(selectedProperty.updated_at), Calendar)}
          </div>
        </CollapsibleSection>

        {/* ── Linked Records ───────────────────── */}
        <LinkedRecordsSection
          key={`property-links-${selectedProperty.id}-${linkRefreshKey}`}
          entityType="property"
          entityId={selectedProperty.id}
          onOpenLinkModal={() => openLinkModal('property', selectedProperty.id)}
        />

        {/* ── File Attachments ─────────────────── */}
        <div className="panel-beveled p-3 bg-surface-base">
          <FileAttachments entityType="property" entityId={selectedProperty.id} />
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════
// Legacy default export
// ════════════════════════════════════════════════════

export default function PropertiesTab(props: PropertiesTabProps) {
  const state = usePropertiesTab(props);

  // Set document title
  useEffect(() => { document.title = 'Records - Properties \u2014 RMPG Flex'; }, []);

  if (props.loadingProperties) return null;

  return (
    <>
      <div className={`${state.selectedProperty ? 'w-[40%]' : 'w-full'} border-r border-rmpg-600 flex flex-col overflow-hidden transition-all`}>
        <PropertiesTabList state={state} />
      </div>
      {state.selectedProperty && (
        <div className="w-[60%] flex flex-col overflow-hidden">
          <PropertiesTabDetail state={state} />
        </div>
      )}
    </>
  );
}
import { safeDateTimeStr } from '../../utils/dateUtils';

import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Building2,
  Shield,
  MapPin,
  FileWarning,
  Trash2,
  Pencil,
  X,
  Phone,
  AlertTriangle,
  Calendar,
  Archive,
  RotateCcw,
  Globe,
  Users,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import PropertyFormModal from '../../components/PropertyFormModal';
import FileAttachments from '../../components/FileAttachments';
import PrintRecordButton from '../../components/PrintRecordButton';
import LinkedRecordsSection from '../../components/LinkedRecordsSection';
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
    is_active: row.is_active !== 0 && row.is_active !== false,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
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

// ── Component ──────────────────────────────────────

export default function PropertiesTab({
  searchQuery,
  setSearchQuery,
  showArchived,
  setError,
  properties,
  loadingProperties,
  setDeleteTarget,
  linkRefreshKey,
  openLinkModal,
  handleArchiveRecord,
  handleUnarchiveRecord,
  fetchProperties,
  clients,
  openNewTrigger,
}: PropertiesTabProps) {
  // Modal state
  const [propertyModalOpen, setPropertyModalOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | undefined>(undefined);
  const [propertySubmitting, setPropertySubmitting] = useState(false);

  // Open "New Property" modal when trigger changes from parent
  useEffect(() => {
    if (openNewTrigger && openNewTrigger > 0) {
      setEditingProperty(undefined);
      setPropertyModalOpen(true);
    }
  }, [openNewTrigger]);

  // Selected record for detail panel
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const propertyDetailRef = useRef<HTMLDivElement>(null);

  // Clear selection if the property was removed from the list (e.g. deleted/archived)
  useEffect(() => {
    if (selectedProperty && !properties.find(p => p.id === selectedProperty.id)) {
      setSelectedProperty(null);
    }
  }, [properties, selectedProperty]);

  // ── Property CRUD ────────────────────────────────

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
        await apiFetch(`/records/properties/${editingProperty.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/records/properties', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setPropertyModalOpen(false);
      setEditingProperty(undefined);
      await fetchProperties();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save property');
    } finally {
      setPropertySubmitting(false);
    }
  };

  const openEditProperty = (property: Property) => {
    setEditingProperty(property);
    setPropertyModalOpen(true);
  };

  const openNewProperty = () => {
    setEditingProperty(undefined);
    setPropertyModalOpen(true);
  };

  // Wrap archive/unarchive to also clear selection
  const handleArchive = async (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => {
    setSelectedProperty(null);
    await handleArchiveRecord(type, id);
  };

  const handleUnarchive = async (type: 'persons' | 'vehicles' | 'properties' | 'evidence', id: string) => {
    setSelectedProperty(null);
    await handleUnarchiveRecord(type, id);
  };

  // ── Filtering ────────────────────────────────────

  const filteredProperties = properties.filter((p) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.address.toLowerCase().includes(q) ||
      (p.client_name || '').toLowerCase().includes(q)
    );
  });

  // ── Helpers ──────────────────────────────────────

  const renderInfoRow = (label: string, value?: string | null, icon?: React.ElementType) => {
    if (!value) return null;
    const Icon = icon;
    return (
      <div className="flex items-start gap-2 text-xs">
        {Icon && <Icon className="w-3 h-3 text-rmpg-400 mt-0.5 flex-shrink-0" />}
        <span className="text-rmpg-400 min-w-[80px]">{label}:</span>
        <span className="text-rmpg-200">{value}</span>
      </div>
    );
  };

  // ── Render ───────────────────────────────────────

  if (loadingProperties) return null;

  return (
    <>
      {/* Left: Property List */}
      <div className={`${selectedProperty ? 'w-[40%]' : 'w-full'} border-r border-rmpg-600 flex flex-col overflow-hidden transition-all`}>
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
          <div className="ml-auto relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-400" />
            <input
              type="text"
              className="input-dark pl-8 w-full text-[11px] py-1"
              placeholder="Search properties..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Property List */}
        <div className="flex-1 overflow-auto">
          {filteredProperties.length === 0 && (
            <div className="text-center py-12">
              <Building2 className="w-8 h-8 text-rmpg-500 mx-auto mb-2" />
              <p className="text-sm text-rmpg-400">{searchQuery ? 'No properties match.' : 'No properties found.'}</p>
            </div>
          )}
          {filteredProperties.map((prop) => (
            <div
              key={prop.id}
              onClick={() => setSelectedProperty(selectedProperty?.id === prop.id ? null : prop)}
              className={`
                px-4 py-3 border-b border-rmpg-700/50 cursor-pointer transition-colors
                ${selectedProperty?.id === prop.id
                  ? 'bg-brand-900/20 border-l-2 border-l-brand-500'
                  : `hover:bg-rmpg-700/30 border-l-2 ${prop.hazard_notes ? 'border-l-red-600' : 'border-l-transparent'}`
                }
              `}
            >
              <div className="flex items-start gap-3">
                <div className={`flex-shrink-0 w-9 h-9 rounded flex items-center justify-center border ${
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
      </div>

      {/* Right: Property Detail Panel */}
      {selectedProperty && (
        <div ref={propertyDetailRef} className="w-[60%] flex flex-col overflow-hidden">
          {/* Detail Header */}
          <div className="px-4 py-3 border-b border-rmpg-600 flex items-start justify-between bg-surface-sunken">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-brand-400" />
                {selectedProperty.name}
                {selectedProperty.hazard_notes && <AlertTriangle className="w-4 h-4 text-red-400" />}
              </h2>
              <div className="flex items-center gap-1.5 mt-0.5 text-xs text-rmpg-300">
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
              </div>
            </div>
            <div className="flex items-center gap-1">
              <PrintRecordButton recordType="property" recordData={selectedProperty} identifier={selectedProperty?.name} entityType="property" entityId={selectedProperty?.id} iconOnly title="Print property record" />
              {!showArchived && (
                <>
                  <button
                    onClick={() => openEditProperty(selectedProperty)}
                    className="p-1.5 hover:bg-rmpg-700 text-rmpg-400 hover:text-white transition-colors"
                    title="Edit Property"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget({ type: 'property', id: selectedProperty.id, label: selectedProperty.name })}
                    className="p-1.5 hover:bg-rmpg-700 text-rmpg-400 hover:text-red-400 transition-colors"
                    title="Delete Property"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleArchive('properties', selectedProperty.id)}
                    className="p-1.5 hover:bg-rmpg-700 text-rmpg-400 hover:text-amber-400 transition-colors"
                    title="Archive Property"
                  >
                    <Archive className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
              {showArchived && (
                <button
                  onClick={() => handleUnarchive('properties', selectedProperty.id)}
                  className="p-1.5 hover:bg-rmpg-700 text-rmpg-400 hover:text-green-400 transition-colors"
                  title="Unarchive Property"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => setSelectedProperty(null)} className="p-1.5 hover:bg-rmpg-700 text-rmpg-400 hover:text-white transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Detail Content */}
          <div className="flex-1 overflow-auto p-4 space-y-3">
            {/* Client Info */}
            {selectedProperty.client_name && (
              <div className="panel-beveled p-3 bg-surface-base">
                <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
                  <Users className="w-3 h-3" /> Client
                </h3>
                <p className="text-sm text-white font-semibold">{selectedProperty.client_name}</p>
              </div>
            )}

            {/* Property Details */}
            <div className="panel-beveled p-3 bg-surface-base">
              <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
                <Building2 className="w-3 h-3" /> Property Details
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {renderInfoRow('Gate Code', selectedProperty.gate_code, Shield)}
                {renderInfoRow('Alarm Code', selectedProperty.alarm_code, Shield)}
                {renderInfoRow('Emergency Contact', selectedProperty.emergency_contact, Phone)}
                {renderInfoRow('Property Type', selectedProperty.property_type)}
                {selectedProperty.latitude && selectedProperty.longitude && (
                  renderInfoRow('Coordinates', `${selectedProperty.latitude.toFixed(5)}, ${selectedProperty.longitude.toFixed(5)}`, Globe)
                )}
              </div>
            </div>

            {/* Post Orders */}
            {selectedProperty.post_orders && (
              <div className="panel-beveled p-3 bg-surface-base">
                <h3 className="text-[10px] text-brand-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
                  <Shield className="w-3 h-3" /> Post Orders
                </h3>
                <p className="text-xs text-rmpg-200 leading-relaxed whitespace-pre-wrap">{selectedProperty.post_orders}</p>
              </div>
            )}

            {/* Hazard Notes */}
            {selectedProperty.hazard_notes && (
              <div className="panel-beveled p-3 border-l-2 border-l-red-600 bg-surface-base">
                <h3 className="text-[10px] text-red-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
                  <FileWarning className="w-3 h-3" /> Hazard Notes
                </h3>
                <p className="text-xs text-red-300/80 leading-relaxed whitespace-pre-wrap">{selectedProperty.hazard_notes}</p>
              </div>
            )}

            {/* Access Instructions */}
            {selectedProperty.access_instructions && (
              <div className="panel-beveled p-3 bg-surface-base">
                <h3 className="text-[10px] text-blue-400 uppercase font-bold tracking-wider mb-2 flex items-center gap-1.5">
                  <MapPin className="w-3 h-3" /> Access Instructions
                </h3>
                <p className="text-xs text-blue-300/80 leading-relaxed whitespace-pre-wrap">{selectedProperty.access_instructions}</p>
              </div>
            )}

            {/* Record Info */}
            <div className="panel-beveled p-3 bg-surface-base">
              <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider mb-2">Record Info</h3>
              <div className="grid grid-cols-2 gap-2">
                {renderInfoRow('Created', selectedProperty.created_at ? new Date(selectedProperty.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : null, Calendar)}
                {renderInfoRow('Updated', selectedProperty.updated_at ? new Date(selectedProperty.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : null, Calendar)}
              </div>
            </div>

            {/* Linked Records */}
            <LinkedRecordsSection
              key={`property-links-${selectedProperty.id}-${linkRefreshKey}`}
              entityType="property"
              entityId={selectedProperty.id}
              onOpenLinkModal={() => openLinkModal('property', selectedProperty.id)}
            />

            {/* File Attachments */}
            <div className="panel-beveled p-3 bg-surface-base">
              <FileAttachments entityType="property" entityId={selectedProperty.id} />
            </div>
          </div>
        </div>
      )}

      {/* Property Form Modal */}
      <PropertyFormModal
        isOpen={propertyModalOpen}
        onClose={() => { setPropertyModalOpen(false); setEditingProperty(undefined); }}
        onSubmit={handlePropertySubmit}
        isSubmitting={propertySubmitting}
        editingProperty={editingProperty}
        clients={clients}
      />
    </>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { Car, Search, Loader2, PlusCircle } from 'lucide-react';
import FormModal from './FormModal';
import VehicleFormModal, { type VehicleFormData } from './VehicleFormModal';
import { apiFetch } from '../hooks/useApi';
import type { VehicleRole } from '../types';

interface LinkVehicleModalProps {
  isOpen: boolean;
  onClose: () => void;
  incidentId: string;
  onLinked: () => void;
}

interface VehicleResult {
  id: number;
  plate_number?: string;
  state?: string;
  make?: string;
  model?: string;
  year?: number;
  color?: string;
  vin?: string;
  owner_first_name?: string;
  owner_last_name?: string;
}

const VEHICLE_ROLES: { value: VehicleRole; label: string }[] = [
  { value: 'suspect_vehicle', label: 'Suspect Vehicle' },
  { value: 'victim_vehicle', label: 'Victim Vehicle' },
  { value: 'witness_vehicle', label: 'Witness Vehicle' },
  { value: 'involved', label: 'Involved' },
  { value: 'evidence', label: 'Evidence' },
  { value: 'other', label: 'Other' },
];

export default function LinkVehicleModal({ isOpen, onClose, incidentId, onLinked }: LinkVehicleModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<VehicleResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleResult | null>(null);
  const [role, setRole] = useState<VehicleRole>('involved');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showCreateVehicle, setShowCreateVehicle] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const resetForm = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedVehicle(null);
    setRole('involved');
    setNotes('');
    setError('');
    setShowCreateVehicle(false);
  }, []);

  useEffect(() => {
    if (!isOpen) resetForm();
  }, [isOpen, resetForm]);

  const handleSearch = useCallback(async () => {
    if (searchQuery.length < 2) return;
    setIsSearching(true);
    setError('');
    try {
      const results = await apiFetch<VehicleResult[]>(`/records/vehicles/search?q=${encodeURIComponent(searchQuery)}`);
      setSearchResults(results);
    } catch {
      setError('Failed to search vehicles');
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (searchQuery.length >= 2) handleSearch();
      else setSearchResults([]);
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, handleSearch]);

  const handleCreateVehicle = async (data: VehicleFormData) => {
    setIsCreating(true);
    setError('');
    try {
      const result = await apiFetch<{ id: number }>('/records/vehicles', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      // Auto-select the newly created vehicle
      const newVehicle: VehicleResult = {
        id: result.id,
        plate_number: data.plate_number || undefined,
        state: data.state || undefined,
        make: data.make || undefined,
        model: data.model || undefined,
        year: data.year ? Number(data.year) : undefined,
        color: data.color || undefined,
        vin: data.vin || undefined,
      };
      setSelectedVehicle(newVehicle);
      setShowCreateVehicle(false);
    } catch (err: any) {
      setError(err?.message || 'Failed to create vehicle');
    } finally {
      setIsCreating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVehicle) {
      setError('Please select a vehicle');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      await apiFetch(`/incidents/${incidentId}/vehicles`, {
        method: 'POST',
        body: JSON.stringify({ vehicle_id: selectedVehicle.id, role, notes: notes || undefined }),
      });
      onLinked();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to link vehicle');
    } finally {
      setIsSubmitting(false);
    }
  };

  const vehicleLabel = (v: VehicleResult) => {
    const parts: string[] = [];
    if (v.year) parts.push(String(v.year));
    if (v.color) parts.push(v.color);
    if (v.make) parts.push(v.make);
    if (v.model) parts.push(v.model);
    return parts.join(' ') || 'Unknown Vehicle';
  };

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title="Link Vehicle to Incident"
      icon={Car}
      submitLabel="Link Vehicle"
      isSubmitting={isSubmitting}
      maxWidth="max-w-lg"
    >
      {error && (
        <div className="px-3 py-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Search */}
      <div>
        <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Search Vehicle</label>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400" />
          <input
            type="text"
            className="input-dark pl-8"
            placeholder="Search by plate, make, model, VIN..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSelectedVehicle(null); }}
            autoFocus
          />
          {isSearching && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-brand-400" />}
        </div>

        {/* Results dropdown */}
        {searchResults.length > 0 && !selectedVehicle && (
          <div className="mt-1 max-h-48 overflow-y-auto border border-rmpg-600 bg-surface-sunken divide-y divide-gray-700">
            {searchResults.map((vehicle) => (
              <button
                key={vehicle.id}
                type="button"
                onClick={() => { setSelectedVehicle(vehicle); setSearchResults([]); }}
                className="w-full text-left px-3 py-2 hover:bg-rmpg-800 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white font-medium">
                    {vehicle.plate_number ? `${vehicle.plate_number}${vehicle.state ? ` (${vehicle.state})` : ''}` : 'No Plate'}
                  </span>
                  {vehicle.color && (
                    <span className="text-[10px] text-rmpg-300 uppercase">{vehicle.color}</span>
                  )}
                </div>
                <div className="text-[11px] text-rmpg-400 mt-0.5">
                  {vehicleLabel(vehicle)}
                  {vehicle.owner_first_name && (
                    <span className="ml-2">• Owner: {vehicle.owner_first_name} {vehicle.owner_last_name}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && !selectedVehicle && (
          <div className="mt-1 flex items-center gap-2">
            <p className="text-xs text-rmpg-400">No vehicles found</p>
            <button
              type="button"
              onClick={() => setShowCreateVehicle(true)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase text-brand-400 bg-brand-900/30 border border-brand-700/40 hover:bg-brand-900/50 transition-colors"
            >
              <PlusCircle className="w-3 h-3" />
              Create New Vehicle
            </button>
          </div>
        )}
      </div>

      {/* Selected vehicle display */}
      {selectedVehicle && (
        <div className="px-3 py-2 bg-brand-900/20 border border-brand-700/40 flex items-center justify-between">
          <div>
            <span className="text-sm text-white font-medium">
              {selectedVehicle.plate_number || 'No Plate'}{selectedVehicle.state ? ` (${selectedVehicle.state})` : ''}
            </span>
            <div className="text-[11px] text-rmpg-400 mt-0.5">
              {vehicleLabel(selectedVehicle)}
              {selectedVehicle.vin && <span className="ml-2">VIN: {selectedVehicle.vin}</span>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setSelectedVehicle(null); setSearchQuery(''); }}
            className="text-xs text-rmpg-300 hover:text-white"
          >
            Change
          </button>
        </div>
      )}

      {/* Role */}
      <div>
        <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Role</label>
        <select className="select-dark" value={role} onChange={(e) => setRole(e.target.value as VehicleRole)}>
          {VEHICLE_ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      {/* Notes */}
      <div>
        <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Notes (Optional)</label>
        <textarea
          className="textarea-dark"
          rows={2}
          placeholder="Additional details about this vehicle's involvement..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {/* Create Vehicle Modal */}
      <VehicleFormModal
        isOpen={showCreateVehicle}
        onClose={() => setShowCreateVehicle(false)}
        onSubmit={handleCreateVehicle}
        isSubmitting={isCreating}
      />
    </FormModal>
  );
}

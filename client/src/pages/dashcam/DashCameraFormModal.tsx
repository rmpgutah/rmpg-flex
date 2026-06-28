// ============================================================
// RMPG Flex — Dash Camera Form Modal
// Create / edit dash cameras linked to fleet vehicles.
// ============================================================

import React, { useState, useEffect } from 'react';
import { Camera } from 'lucide-react';
import FormModal from '../../components/FormModal';
import { useFormDirty } from '../../hooks/useFormDirty';
import type { DashCameraStatus } from '../../types';

export interface DashCameraFormData {
  vehicle_id: string;
  camera_id: string;
  make: string;
  model: string;
  firmware_version: string;
  storage_capacity_gb: string;
  channel_count: string;
  status: DashCameraStatus;
  condition: string;
  installed_at: string;
  removed_at: string;
  notes: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: DashCameraFormData) => void;
  isSubmitting: boolean;
  vehicles: { id: string; label: string }[];
  initialData?: Partial<DashCameraFormData> & { id?: number };
  mode?: 'create' | 'edit';
}

const STATUSES: { value: DashCameraStatus; label: string }[] = [
  { value: 'installed', label: 'Installed' },
  { value: 'available', label: 'Available' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'lost', label: 'Lost' },
];

const CONDITIONS = [
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
];

const EMPTY: DashCameraFormData = {
  vehicle_id: '',
  camera_id: '',
  make: '',
  model: '',
  firmware_version: '',
  storage_capacity_gb: '32',
  channel_count: '2',
  status: 'installed',
  condition: 'good',
  installed_at: '',
  removed_at: '',
  notes: '',
};

export default function DashCameraFormModal({
  isOpen, onClose, onSubmit, isSubmitting, vehicles, initialData, mode = 'create',
}: Props) {
  const [form, setForm] = useState<DashCameraFormData>(EMPTY);
  const { isDirty, snapshot } = useFormDirty(form, isOpen);

  useEffect(() => {
    if (isOpen && initialData) {
      const initial = {
        ...EMPTY, ...initialData,
        storage_capacity_gb: String(initialData.storage_capacity_gb || '32'),
        channel_count: String(initialData.channel_count || '2'),
      };
      setForm(initial);
      snapshot(initial);
    } else if (isOpen) {
      setForm(EMPTY);
      snapshot(EMPTY);
    }
  }, [isOpen, initialData]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(form);
  };

  const handleClose = () => { setForm(EMPTY); onClose(); };
  const set = (key: keyof DashCameraFormData, val: string) => setForm(p => ({ ...p, [key]: val }));

  return (
    <FormModal
      isOpen={isOpen}
      onClose={handleClose}
      onSubmit={handleSubmit}
      title={mode === 'edit' ? 'Edit Dash Camera' : 'Install Dash Camera'}
      icon={Camera}
      submitLabel={mode === 'edit' ? 'Update' : 'Install Camera'}
      isSubmitting={isSubmitting}
      isDirty={isDirty}
    >
      {/* Assignment */}
      <div className="panel-inset p-3 space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label">Vehicle <span className="text-red-400">*</span></label>
            <select required value={form.vehicle_id} onChange={e => set('vehicle_id', e.target.value)} className="select-dark">
              <option value="">Select vehicle...</option>
              {vehicles.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Camera ID / Serial <span className="text-red-400">*</span></label>
            <input type="text" required value={form.camera_id} onChange={e => set('camera_id', e.target.value)} placeholder="e.g. DC-001" className="input-dark" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="field-label">Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)} className="select-dark">
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Condition</label>
            <select value={form.condition} onChange={e => set('condition', e.target.value)} className="select-dark">
              {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Channels</label>
            <select value={form.channel_count} onChange={e => set('channel_count', e.target.value)} className="select-dark">
              <option value="1">1 (Front)</option>
              <option value="2">2 (Front + Rear)</option>
              <option value="3">3 (Front + Rear + Cabin)</option>
              <option value="4">4 Channel</option>
            </select>
          </div>
        </div>
      </div>

      {/* Device Details */}
      <div className="flex items-center gap-2 mt-4 mb-3">
        <span className="field-label text-brand-400 whitespace-nowrap">Device Details</span>
        <div className="flex-1 h-px bg-rmpg-700" />
      </div>
      <div className="panel-inset p-3 space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label">Make</label>
            <input type="text" value={form.make} onChange={e => set('make', e.target.value)} placeholder="e.g. Vantrue" className="input-dark" />
          </div>
          <div>
            <label className="field-label">Model</label>
            <input type="text" value={form.model} onChange={e => set('model', e.target.value)} placeholder="e.g. N4 Pro" className="input-dark" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label">Firmware Version</label>
            <input type="text" value={form.firmware_version} onChange={e => set('firmware_version', e.target.value)} placeholder="e.g. v2.1.0" className="input-dark" />
          </div>
          <div>
            <label className="field-label">Storage Capacity (GB)</label>
            <input type="number" value={form.storage_capacity_gb} onChange={e => set('storage_capacity_gb', e.target.value)} min={1} className="input-dark" />
          </div>
        </div>
      </div>

      {/* Dates */}
      <div className="flex items-center gap-2 mt-4 mb-3">
        <span className="field-label text-brand-400 whitespace-nowrap">Dates</span>
        <div className="flex-1 h-px bg-rmpg-700" />
      </div>
      <div className="panel-inset p-3 space-y-3">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label">Installed Date</label>
            <input type="date" value={form.installed_at} onChange={e => set('installed_at', e.target.value)} className="input-dark" />
          </div>
          <div>
            <label className="field-label">Removed Date</label>
            <input type="date" value={form.removed_at} onChange={e => set('removed_at', e.target.value)} className="input-dark" />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="flex items-center gap-2 mt-4 mb-3">
        <span className="field-label text-brand-400 whitespace-nowrap">Notes</span>
        <div className="flex-1 h-px bg-rmpg-700" />
      </div>
      <div className="panel-inset p-3">
        <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Additional notes..." className="textarea-dark" />
      </div>
    </FormModal>
  );
}

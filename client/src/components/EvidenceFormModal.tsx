import React, { useState, useEffect } from 'react';
import { Package } from 'lucide-react';
import FormModal from './FormModal';
import { apiFetch } from '../hooks/useApi';
import type { Evidence } from '../types';
import { localToday } from '../utils/dateUtils';

interface EvidenceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  incidentId?: string;
  onCreated: () => void;
  editingEvidence?: Evidence | null;
}

const EVIDENCE_TYPES = [
  'physical', 'documentary', 'digital', 'photographic', 'video',
  'biological', 'trace', 'testimonial', 'other',
];

const EVIDENCE_CATEGORIES = [
  'Weapon', 'Contraband', 'Currency', 'Document', 'Electronic Device',
  'Clothing', 'Biological Sample', 'Tool/Instrument', 'Vehicle Part',
  'Personal Property', 'Surveillance Media', 'Other',
];

const PACKAGING_TYPES = [
  'Evidence Bag', 'Paper Bag', 'Envelope', 'Box', 'Container',
  'Tube', 'Jar', 'Sealed Pouch', 'None', 'Other',
];

const DISPOSAL_METHODS = [
  'Returned to Owner', 'Destroyed', 'Auctioned', 'Forfeited',
  'Released to Court', 'Transferred', 'Other',
];

interface EvidenceFormData {
  evidence_type: string;
  category: string;
  description: string;
  storage_location: string;
  collected_date: string;
  packaging_type: string;
  serial_number: string;
  brand: string;
  model: string;
  estimated_value: string;
  dimensions: string;
  weight: string;
  photo_taken: boolean;
  lab_submitted: boolean;
  lab_case_number: string;
  lab_name: string;
  disposal_method: string;
  disposal_date: string;
  disposal_authorized_by: string;
  notes: string;
}

const EMPTY_FORM: EvidenceFormData = {
  evidence_type: 'physical',
  category: '',
  description: '',
  storage_location: '',
  collected_date: localToday(),
  packaging_type: '',
  serial_number: '',
  brand: '',
  model: '',
  estimated_value: '',
  dimensions: '',
  weight: '',
  photo_taken: false,
  lab_submitted: false,
  lab_case_number: '',
  lab_name: '',
  disposal_method: '',
  disposal_date: '',
  disposal_authorized_by: '',
  notes: '',
};

export default function EvidenceFormModal({ isOpen, onClose, incidentId, onCreated, editingEvidence }: EvidenceFormModalProps) {
  const [form, setForm] = useState<EvidenceFormData>({ ...EMPTY_FORM });
  const [activeTab, setActiveTab] = useState<'basic' | 'details' | 'lab'>('basic');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setForm({ ...EMPTY_FORM });
      setActiveTab('basic');
      setError('');
    } else if (editingEvidence) {
      setForm({
        evidence_type: editingEvidence.type || 'physical',
        category: editingEvidence.category || '',
        description: editingEvidence.description || '',
        storage_location: editingEvidence.storage_location || '',
        collected_date: editingEvidence.collected_date || '',
        packaging_type: editingEvidence.packaging_type || '',
        serial_number: editingEvidence.serial_number || '',
        brand: editingEvidence.brand || '',
        model: editingEvidence.model || '',
        estimated_value: editingEvidence.estimated_value != null ? String(editingEvidence.estimated_value) : '',
        dimensions: editingEvidence.dimensions || '',
        weight: editingEvidence.weight || '',
        photo_taken: !!editingEvidence.photo_taken,
        lab_submitted: !!editingEvidence.lab_submitted,
        lab_case_number: editingEvidence.lab_case_number || '',
        lab_name: editingEvidence.lab_name || '',
        disposal_method: editingEvidence.disposal_method || '',
        disposal_date: editingEvidence.disposal_date || '',
        disposal_authorized_by: editingEvidence.disposal_authorized_by || '',
        notes: editingEvidence.notes || '',
      });
    }
  }, [isOpen, editingEvidence]);

  const updateField = (field: keyof EvidenceFormData, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.description.trim()) {
      setError('Description is required');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      const body: Record<string, any> = {
        description: form.description.trim(),
        evidence_type: form.evidence_type,
        storage_location: form.storage_location.trim() || undefined,
        collected_date: form.collected_date || undefined,
        category: form.category || undefined,
        packaging_type: form.packaging_type || undefined,
        serial_number: form.serial_number.trim() || undefined,
        brand: form.brand.trim() || undefined,
        model: form.model.trim() || undefined,
        estimated_value: form.estimated_value ? parseFloat(form.estimated_value) : undefined,
        dimensions: form.dimensions.trim() || undefined,
        weight: form.weight.trim() || undefined,
        photo_taken: form.photo_taken,
        lab_submitted: form.lab_submitted,
        lab_case_number: form.lab_case_number.trim() || undefined,
        lab_name: form.lab_name.trim() || undefined,
        disposal_method: form.disposal_method || undefined,
        disposal_date: form.disposal_date || undefined,
        disposal_authorized_by: form.disposal_authorized_by.trim() || undefined,
        notes: form.notes.trim() || undefined,
      };

      if (editingEvidence) {
        await apiFetch(`/records/evidence/${editingEvidence.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      } else if (incidentId) {
        await apiFetch(`/incidents/${incidentId}/evidence`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      } else {
        // Standalone evidence creation (no incident)
        await apiFetch('/records/evidence', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to save evidence');
    } finally {
      setIsSubmitting(false);
    }
  };

  const tabs = [
    { id: 'basic' as const, label: 'Basic Info' },
    { id: 'details' as const, label: 'Item Details' },
    { id: 'lab' as const, label: 'Lab / Disposal' },
  ];

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      onSubmit={handleSubmit}
      title={editingEvidence ? 'Edit Evidence' : 'Add Evidence'}
      icon={Package}
      submitLabel={editingEvidence ? 'Save Changes' : 'Add Evidence'}
      isSubmitting={isSubmitting}
      maxWidth="max-w-2xl"
    >
      {error && (
        <div className="px-3 py-2 bg-red-900/30 border border-red-700 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-rmpg-600 -mx-1 px-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-gray-700 text-white border border-rmpg-600 border-b-gray-700'
                : 'text-rmpg-300 hover:text-white hover:bg-rmpg-700/50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Basic Info Tab */}
      {activeTab === 'basic' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">
                Evidence Type <span className="text-red-400">*</span>
              </label>
              <select className="select-dark text-xs" value={form.evidence_type} onChange={(e) => updateField('evidence_type', e.target.value)}>
                {EVIDENCE_TYPES.map((t) => (
                  <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Category</label>
              <select className="select-dark text-xs" value={form.category} onChange={(e) => updateField('category', e.target.value)}>
                <option value="">-- Select --</option>
                {EVIDENCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">
              Description <span className="text-red-400">*</span>
            </label>
            <textarea
              className="textarea-dark text-xs"
              rows={3}
              placeholder="Describe the evidence item in detail..."
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Date Collected</label>
              <input type="date" className="input-dark text-xs" value={form.collected_date} onChange={(e) => updateField('collected_date', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Storage Location</label>
              <input type="text" className="input-dark text-xs" placeholder="e.g., Evidence Locker A-12" value={form.storage_location} onChange={(e) => updateField('storage_location', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Packaging Type</label>
            <select className="select-dark text-xs" value={form.packaging_type} onChange={(e) => updateField('packaging_type', e.target.value)}>
              <option value="">-- Select --</option>
              {PACKAGING_TYPES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-xs text-rmpg-300 cursor-pointer">
              <input type="checkbox" checked={form.photo_taken} onChange={(e) => updateField('photo_taken', e.target.checked)} className="accent-brand-500" />
              Photo Taken
            </label>
          </div>

          <div>
            <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Notes</label>
            <textarea className="textarea-dark text-xs" rows={2} placeholder="Additional notes..." value={form.notes} onChange={(e) => updateField('notes', e.target.value)} />
          </div>
        </div>
      )}

      {/* Item Details Tab */}
      {activeTab === 'details' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Serial Number</label>
              <input type="text" className="input-dark text-xs" placeholder="S/N" value={form.serial_number} onChange={(e) => updateField('serial_number', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Brand</label>
              <input type="text" className="input-dark text-xs" placeholder="Brand / Manufacturer" value={form.brand} onChange={(e) => updateField('brand', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Model</label>
              <input type="text" className="input-dark text-xs" placeholder="Model" value={form.model} onChange={(e) => updateField('model', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Estimated Value ($)</label>
              <input type="number" min="0" step="0.01" className="input-dark text-xs" placeholder="0.00" value={form.estimated_value} onChange={(e) => updateField('estimated_value', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Dimensions</label>
              <input type="text" className="input-dark text-xs" placeholder='e.g., 12" x 6" x 3"' value={form.dimensions} onChange={(e) => updateField('dimensions', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Weight</label>
              <input type="text" className="input-dark text-xs" placeholder="e.g., 2.5 lbs" value={form.weight} onChange={(e) => updateField('weight', e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {/* Lab / Disposal Tab */}
      {activeTab === 'lab' && (
        <div className="space-y-3">
          <div className="panel-beveled p-3">
            <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-2 block">Lab Submission</label>
            <div className="flex items-center gap-4 mb-2">
              <label className="flex items-center gap-2 text-xs text-rmpg-300 cursor-pointer">
                <input type="checkbox" checked={form.lab_submitted} onChange={(e) => updateField('lab_submitted', e.target.checked)} className="accent-brand-500" />
                Submitted to Lab
              </label>
            </div>
            {form.lab_submitted && (
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Lab Name</label>
                  <input type="text" className="input-dark text-xs" placeholder="Lab name" value={form.lab_name} onChange={(e) => updateField('lab_name', e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Lab Case #</label>
                  <input type="text" className="input-dark text-xs" placeholder="Lab case number" value={form.lab_case_number} onChange={(e) => updateField('lab_case_number', e.target.value)} />
                </div>
              </div>
            )}
          </div>

          <div className="panel-beveled p-3">
            <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-2 block">Disposal Information</label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Disposal Method</label>
                <select className="select-dark text-xs" value={form.disposal_method} onChange={(e) => updateField('disposal_method', e.target.value)}>
                  <option value="">-- None --</option>
                  {DISPOSAL_METHODS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Disposal Date</label>
                <input type="date" className="input-dark text-xs" value={form.disposal_date} onChange={(e) => updateField('disposal_date', e.target.value)} />
              </div>
            </div>
            {form.disposal_method && (
              <div className="mt-2">
                <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Authorized By</label>
                <input type="text" className="input-dark text-xs" placeholder="Name of authorizing person" value={form.disposal_authorized_by} onChange={(e) => updateField('disposal_authorized_by', e.target.value)} />
              </div>
            )}
          </div>
        </div>
      )}
    </FormModal>
  );
}

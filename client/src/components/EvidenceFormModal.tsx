import React, { useState, useEffect } from 'react';
import { Package, Microscope, Hash, Shield } from 'lucide-react';
import FormModal from './FormModal';
import { useFormDirty } from '../hooks/useFormDirty';
import { apiFetch } from '../hooks/useApi';
import type { Evidence } from '../types';
import { localToday } from '../utils/dateUtils';
import { useFormValidation } from '../hooks/useFormValidation';

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

const CONDITION_OPTIONS = [
  'Excellent', 'Good', 'Fair', 'Poor', 'Damaged', 'Destroyed',
  'Contaminated', 'Unknown',
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
  location_found: string;
  condition: string;
  quantity: string;
  is_biological: boolean;
  narcotics_flag: boolean;
  temperature_sensitive: boolean;
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
  location_found: '',
  condition: '',
  quantity: '1',
  is_biological: false,
  narcotics_flag: false,
  temperature_sensitive: false,
};

export default function EvidenceFormModal({ isOpen, onClose, incidentId, onCreated, editingEvidence }: EvidenceFormModalProps) {
  const [form, setForm] = useState<EvidenceFormData>({ ...EMPTY_FORM });
  const { isDirty, snapshot } = useFormDirty(form, isOpen);
  const [activeTab, setActiveTab] = useState<'basic' | 'details' | 'lab' | 'digital'>('basic');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const { errors: formErrors, validate: validateForm, clearAllErrors } = useFormValidation();

  useEffect(() => {
    if (!isOpen) {
      setForm({ ...EMPTY_FORM });
      setActiveTab('basic');
      setError('');
      clearAllErrors();
    } else if (editingEvidence) {
      const initial: EvidenceFormData = {
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
        location_found: editingEvidence.location_found || '',
        condition: editingEvidence.condition || '',
        quantity: editingEvidence.quantity != null ? String(editingEvidence.quantity) : '1',
        is_biological: !!(editingEvidence as any).is_biological,
        narcotics_flag: !!(editingEvidence as any).narcotics_flag,
        temperature_sensitive: !!(editingEvidence as any).temperature_sensitive,
      };
      setForm(initial);
      snapshot(initial);
    } else {
      snapshot(EMPTY_FORM);
    }
  }, [isOpen, editingEvidence]);

  const updateField = (field: keyof EvidenceFormData, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const isValid = validateForm(form, {
      description: { required: true, minLength: 3 },
      storage_location: { required: true },
    });
    if (!isValid) {
      // Switch to basic tab if errors are there
      if (formErrors.description || formErrors.storage_location) setActiveTab('basic');
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
        location_found: form.location_found.trim() || undefined,
        condition: form.condition || undefined,
        quantity: form.quantity ? parseInt(form.quantity, 10) : 1,
        is_biological: form.is_biological,
        narcotics_flag: form.narcotics_flag,
        temperature_sensitive: form.temperature_sensitive,
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
    { id: 'digital' as const, label: 'Digital Forensics' },
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
      isDirty={isDirty}
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
                ? 'bg-rmpg-700 text-white border border-rmpg-600 border-b-rmpg-700'
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              className={`textarea-dark text-xs ${formErrors.description ? '!border-red-500' : ''}`}
              rows={3}
              placeholder="Describe the evidence item in detail..."
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              autoFocus
            />
            {formErrors.description && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.description}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Date Collected</label>
              <input type="date" className="input-dark text-xs" value={form.collected_date} onChange={(e) => updateField('collected_date', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Storage Location *</label>
              <input type="text" className={`input-dark text-xs ${formErrors.storage_location ? '!border-red-500' : ''}`} placeholder="e.g., Evidence Locker A-12" value={form.storage_location} onChange={(e) => updateField('storage_location', e.target.value)} />
              {formErrors.storage_location && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.storage_location}</p>}
            </div>
          </div>

          <div>
            <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Location Found</label>
            <input type="text" className="input-dark text-xs" placeholder="Where the evidence was discovered / collected" value={form.location_found} onChange={(e) => updateField('location_found', e.target.value)} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Packaging Type</label>
              <select className="select-dark text-xs" value={form.packaging_type} onChange={(e) => updateField('packaging_type', e.target.value)}>
                <option value="">-- Select --</option>
                {PACKAGING_TYPES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Condition</label>
              <select className="select-dark text-xs" value={form.condition} onChange={(e) => updateField('condition', e.target.value)}>
                <option value="">-- Select --</option>
                {CONDITION_OPTIONS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Quantity</label>
              <input type="number" min="1" className="input-dark text-xs" placeholder="1" value={form.quantity} onChange={(e) => updateField('quantity', e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-xs text-rmpg-300 cursor-pointer">
              <input type="checkbox" checked={form.photo_taken} onChange={(e) => updateField('photo_taken', e.target.checked)} className="accent-brand-500" />
              Photo Taken
            </label>
            <label className="flex items-center gap-2 text-xs text-red-400 cursor-pointer">
              <input type="checkbox" checked={form.is_biological} onChange={(e) => updateField('is_biological', e.target.checked)} className="accent-red-500" />
              Biological / Biohazard
            </label>
            <label className="flex items-center gap-2 text-xs text-amber-400 cursor-pointer">
              <input type="checkbox" checked={form.narcotics_flag} onChange={(e) => updateField('narcotics_flag', e.target.checked)} className="accent-amber-500" />
              Controlled Substance
            </label>
            <label className="flex items-center gap-2 text-xs text-rmpg-300 cursor-pointer">
              <input type="checkbox" checked={form.temperature_sensitive} onChange={(e) => updateField('temperature_sensitive', e.target.checked)} className="accent-[#d4a017]" />
              Temperature Sensitive
            </label>
          </div>

          <div>
            <label className="block text-xs text-rmpg-300 font-bold uppercase tracking-wider mb-1">Notes</label>
            <textarea className="textarea-dark text-xs" rows={2} placeholder="Additional notes..." value={form.notes} onChange={(e) => updateField('notes', e.target.value)} maxLength={3000} />
            <div className="text-[9px] text-rmpg-500 text-right mt-0.5">{form.notes.length}/3000</div>
          </div>
        </div>
      )}

      {/* Item Details Tab */}
      {activeTab === 'details' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

      {/* Digital Forensics Tab */}
      {activeTab === 'digital' && (
        <div className="space-y-3">
          <div className="panel-beveled p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Microscope className="w-3.5 h-3.5 text-brand-400" />
              <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">IPED Digital Forensics</label>
            </div>

            {editingEvidence ? (
              <>
                {/* Hash summary for existing evidence */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-surface-sunken p-2 rounded-sm">
                    <Hash className="w-3 h-3 mx-auto mb-1 text-rmpg-400" />
                    <div className="text-sm font-bold text-rmpg-100">{(editingEvidence as any).hash_count || 0}</div>
                    <div className="text-[9px] text-rmpg-500 uppercase">Hashes</div>
                  </div>
                  <div className="bg-surface-sunken p-2 rounded-sm">
                    <Shield className="w-3 h-3 mx-auto mb-1 text-rmpg-400" />
                    <div className="text-sm font-bold text-rmpg-100">{(editingEvidence as any).flagged_hash_count || 0}</div>
                    <div className="text-[9px] text-rmpg-500 uppercase">Flagged</div>
                  </div>
                  <div className="bg-surface-sunken p-2 rounded-sm">
                    <Microscope className="w-3 h-3 mx-auto mb-1 text-rmpg-400" />
                    <div className="text-sm font-bold text-rmpg-100">{(editingEvidence as any).iped_processed ? 'Yes' : 'No'}</div>
                    <div className="text-[9px] text-rmpg-500 uppercase">IPED Processed</div>
                  </div>
                </div>

                <div className="text-[9px] text-rmpg-500 bg-surface-sunken p-2 rounded-sm leading-relaxed">
                  Hash computation and IPED processing are available in the evidence detail view.
                  Open this evidence record and use the "Digital Forensics" section to compute hashes
                  or run IPED analysis on attached files.
                </div>
              </>
            ) : (
              <div className="text-[9px] text-rmpg-500 bg-surface-sunken p-2 rounded-sm leading-relaxed">
                Digital forensics features (hash computation, IPED processing, hash set matching)
                become available after the evidence record is created and files are attached.
                Save this evidence record first, then use the detail view to run forensic analysis.
              </div>
            )}
          </div>

          <div className="panel-beveled p-3 space-y-2">
            <label className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider block">Capabilities</label>
            <div className="space-y-1 text-[10px]">
              <div className="flex items-center gap-2 text-rmpg-300">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                <span><strong>Tier 1 (Built-in):</strong> MD5, SHA-1, SHA-256, SHA-512, content fingerprint</span>
              </div>
              <div className="flex items-center gap-2 text-rmpg-300">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                <span><strong>Tier 2 (IPED):</strong> PhotoDNA, disk image processing, file carving, OCR, face recognition</span>
              </div>
              <div className="flex items-center gap-2 text-rmpg-300">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                <span><strong>Hash Sets:</strong> NSRL, ProjectVIC, custom CSV — automatic known-file flagging</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </FormModal>
  );
}

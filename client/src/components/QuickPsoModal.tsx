import React, { useState, useEffect, useRef, useId } from 'react';
import { X, Shield, Loader2, ArrowRight, History } from 'lucide-react';
import type { CallForService, CallPriority, CallSource } from '../types';
import { PRIORITY_OPTIONS, PSO_SERVICE_TYPES, PROCESS_SERVICE_DOC_TYPES } from './NewCallModal';
import AddressAutocomplete, { type ParsedAddress } from './AddressAutocomplete';
import { useDistrictIdentify } from '../hooks/useDistrictLookup';
import { useFormDraft } from '../hooks/useFormDraft';

import RichTextArea from './RichTextArea';
import { formatPhoneInput } from '../utils/formatters';
import { composeAddressUnit } from '../utils/addressUnit';
interface QuickPsoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (call: Partial<CallForService> & Record<string, any>) => void | Promise<void>;
  onExpandToFullForm: (data: Record<string, any>) => void;
  clients?: { id: string; name: string; contact_name?: string; contact_phone?: string; address?: string }[];
}

const DEFAULT_PSO_DATA = {
  incident_type: 'pso_client_request' as const,
  source: 'phone' as CallSource,
  priority: 'P3' as CallPriority,
  pso_service_type: '',
  client_id: '',
  location: '',
  latitude: null as number | null,
  longitude: null as number | null,
  sector_id: '',
  zone_id: '',
  beat_id: '',
  pso_requestor_name: '',
  pso_requestor_phone: '',
  contract_id: '',
  description: '',
  process_service_type: '',
  process_served_to: '',
  process_served_address: '',
};

export default function QuickPsoModal({ isOpen, onClose, onSubmit, onExpandToFullForm, clients = [] }: QuickPsoModalProps) {
  const { form: formData, setForm: setFormData, wasRestored, clearDraft, signalSaved } = useFormDraft({
    storageKey: 'rmpg_quick_pso_draft',
    defaultValue: DEFAULT_PSO_DATA,
    isActive: isOpen,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [locationUnit, setLocationUnit] = useState('');
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLSelectElement>(null);
  const { identify: identifyDistrict } = useDistrictIdentify();

  // Focus first input each time the modal opens. Form contents are NOT reset
  // here — useFormDraft owns persistence, so an in-progress PSO request
  // survives a Cancel/re-open (or a lost connection / device switch, via its
  // D1 mirror) instead of being silently discarded.
  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(() => firstInputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Escape to close + focus trap
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
        return;
      }
      // Focus trap
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'input, select, textarea, button, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const update = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const composedLocation = composeAddressUnit(formData.location, locationUnit);
      await onSubmit({
        ...formData,
        location: composedLocation,
        location_address: composedLocation,
        status: 'pending',
        assigned_units: [],
        notes: [],
      } as any);
      // Only clear the draft AFTER the save is confirmed successful — never
      // in the catch block, so a failed submit keeps the draft for retry.
      clearDraft();
    } catch {
      // Error handled by parent — keep form data (and its draft) for retry
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExpand = () => {
    // Handing off to the full NewCallModal, which owns its own draft — mark
    // this draft saved (not cleared/reset) so the in-progress data isn't
    // lost if the user backs out of the full form without submitting.
    signalSaved();
    onExpandToFullForm({ ...formData });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={isSubmitting ? undefined : onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-surface-base border border-purple-700/50 shadow-md animate-fade-in">
        {/* Header — purple PSO theme */}
        <div
          className="flex items-center justify-between px-4 py-2 border-b border-purple-700/50"
          style={{ background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)' }}
        >
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-purple-300" />
            <h2 id={titleId} className="text-xs font-bold text-purple-100 uppercase tracking-wider">
              Quick PSO Client Request
            </h2>
          </div>
          <button type="button"
            onClick={onClose}
            className="p-1 hover:bg-purple-800/40 text-purple-300 hover:text-rmpg-100 transition-colors"
            aria-label="Close modal">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Draft restored banner */}
        {wasRestored && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-900/30 border-b border-amber-700/30">
            <History className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Restored pending draft</span>
            <button type="button" onClick={() => clearDraft()} className="ml-auto text-[9px] text-rmpg-400 hover:text-rmpg-100 transition-colors uppercase tracking-wider font-bold">
              Discard
            </button>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          {/* Client / Requestor dropdown — auto-fills name, phone, address */}
          {clients.length > 0 && (
            <div>
              <label htmlFor="ff-quickpsomodal-0" className="block text-xs font-semibold text-brand-gold-500 uppercase mb-1">Client / Requestor</label>
              <select id="ff-quickpsomodal-0"
                className="select-dark w-full"
                value={formData.client_id || ''}
                onChange={(e) => {
                  const selectedId = e.target.value;
                  const client = clients.find((c) => c.id === selectedId);
                  if (client) {
                    setFormData((prev) => ({
                      ...prev,
                      client_id: client.id,
                      pso_requestor_name: client.contact_name || prev.pso_requestor_name,
                      pso_requestor_phone: client.contact_phone || prev.pso_requestor_phone,
                      location: client.address || prev.location,
                    }));
                    try {
                      const recent = JSON.parse(localStorage.getItem('rmpg_recent_pso_clients') || '[]') as string[];
                      const updated = [selectedId, ...recent.filter((id: string) => id !== selectedId)].slice(0, 5);
                      localStorage.setItem('rmpg_recent_pso_clients', JSON.stringify(updated));
                    } catch { /* localStorage unavailable */ }
                  } else {
                    update('client_id', '');
                  }
                }}
                style={{ borderColor: 'var(--sev-special)' }}
              >
                <option value="">-- Select Client --</option>
                {(() => {
                  let recentIds: string[] = [];
                  try { recentIds = JSON.parse(localStorage.getItem('rmpg_recent_pso_clients') || '[]'); } catch { /* ignore */ }
                  const recentClients = recentIds.map((id: string) => clients.find((c) => c.id === id)).filter(Boolean) as typeof clients;
                  const otherClients = clients.filter((c) => !recentIds.includes(c.id));
                  return (
                    <>
                      {recentClients.length > 0 && (
                        <optgroup label="Recent">
                          {recentClients.map((c) => (
                            <option key={`recent-${c.id}`} value={c.id}>{c.name}{c.contact_name ? ` (${c.contact_name})` : ''}</option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label={recentClients.length > 0 ? 'All Clients' : 'Clients'}>
                        {otherClients.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}{c.contact_name ? ` (${c.contact_name})` : ''}</option>
                        ))}
                      </optgroup>
                    </>
                  );
                })()}
              </select>
            </div>
          )}

          {/* Service Type */}
          <div>
            <label htmlFor="ff-quickpsomodal-1" className="block text-xs font-semibold text-purple-300 uppercase mb-1">Service Type</label>
            <select id="ff-quickpsomodal-1"
              ref={firstInputRef}
              className="select-dark"
              value={formData.pso_service_type}
              onChange={(e) => update('pso_service_type', e.target.value)}
              style={{ borderColor: 'var(--sev-special)' }}
            >
              {PSO_SERVICE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Location */}
          <div className="flex gap-3">
            <div className="flex-1">
            <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Location / Address *</label>
            <AddressAutocomplete
              className="input-dark"
              placeholder="123 Main St, Salt Lake City, UT"
              value={formData.location}
              onChange={(val) => update('location', val)}
              onSelect={async (addr: ParsedAddress) => {
                update('location', addr.formatted);
                if (addr.latitude != null) {
                  setFormData((prev) => ({ ...prev, latitude: addr.latitude as any, longitude: addr.longitude as any }));
                  const district = await identifyDistrict(addr.latitude!, addr.longitude!);
                  if (district) {
                    setFormData((prev) => ({
                      ...prev,
                      sector_id: district.sector_id || prev.sector_id,
                      zone_id: district.zone_id || prev.zone_id,
                      beat_id: district.beat_id || prev.beat_id,
                    }));
                  }
                }
              }}
              required
            />
            </div>
            <div className="w-28">
              <label htmlFor="ff-quickpsomodal-locunit" className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Apt / Unit</label>
              <input id="ff-quickpsomodal-locunit" type="text" className="input-dark" value={locationUnit} onChange={(e) => setLocationUnit(e.target.value)} placeholder="Apt 4B" />
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Priority</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {PRIORITY_OPTIONS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => update('priority', p.value)}
                  className={`
                    p-1.5 border-2 text-center transition-all
                    ${formData.priority === p.value
                      ? p.color
                      : 'border-rmpg-600 text-rmpg-400 hover:border-rmpg-400'
                    }
                  `}
                >
                  <div className="font-bold text-xs">{p.label}</div>
                  <div className="text-[9px]">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Requestor Name + Phone (side by side) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="ff-quickpsomodal-2" className="block text-xs font-semibold text-purple-300 uppercase mb-1">Requestor Name</label>
              <input id="ff-quickpsomodal-2"
                type="text"
                className="input-dark"
                placeholder="Client contact"
                value={formData.pso_requestor_name}
                onChange={(e) => update('pso_requestor_name', e.target.value)}
                style={{ borderColor: 'var(--sev-special)' }}
              />
            </div>
            <div>
              <label htmlFor="ff-quickpsomodal-3" className="block text-xs font-semibold text-purple-300 uppercase mb-1">Requestor Phone</label>
              <input id="ff-quickpsomodal-3"
                type="text"
                className="input-dark"
                placeholder="(801) 555-0100"
                value={formData.pso_requestor_phone}
                onChange={(e) => update('pso_requestor_phone', formatPhoneInput(e.target.value))}
                style={{ borderColor: 'var(--sev-special)' }}
              />
            </div>
          </div>

          {/* Contract ID */}
          <div>
            <label htmlFor="ff-quickpsomodal-4" className="block text-xs font-semibold text-purple-300 uppercase mb-1">Contract ID</label>
            <input id="ff-quickpsomodal-4"
              type="text"
              className="input-dark"
              placeholder="PSO contract #"
              value={formData.contract_id}
              onChange={(e) => update('contract_id', e.target.value)}
              style={{ borderColor: 'var(--sev-special)' }}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Description</label>
            <RichTextArea
              className="input-dark w-full"
              rows={2}
              placeholder="Brief description of request..."
              value={formData.description}
              onChange={(e) => update('description', e.target.value)}
            />
          </div>

          {/* Process Service sub-section (conditional) */}
          {formData.pso_service_type === 'process_service' && (
            <div className="panel-inset border border-amber-700/30 p-3">
              <div className="text-[9px] font-bold text-amber-400 uppercase tracking-wider mb-2">Process Service Details</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <label htmlFor="ff-quickpsomodal-5" className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Document Type</label>
                  <select id="ff-quickpsomodal-5"
                    className="select-dark"
                    value={formData.process_service_type}
                    onChange={(e) => update('process_service_type', e.target.value)}
                  >
                    {PROCESS_SERVICE_DOC_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ff-quickpsomodal-6" className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Serve To (Name)</label>
                  <input id="ff-quickpsomodal-6"
                    type="text"
                    className="input-dark"
                    placeholder="Person to be served"
                    value={formData.process_served_to}
                    onChange={(e) => update('process_served_to', e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="ff-quickpsomodal-7" className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">Service Address</label>
                <input id="ff-quickpsomodal-7"
                  type="text"
                  className="input-dark w-full"
                  placeholder="Address for service"
                  value={formData.process_served_address}
                  onChange={(e) => update('process_served_address', e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-rmpg-600">
            <button
              type="button"
              onClick={handleExpand}
              className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
              title="Open full form with current data"
            >
              Full Form <ArrowRight className="w-3 h-3" />
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="toolbar-btn"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !formData.location}
                className="toolbar-btn"
                style={{
                  background: isSubmitting ? 'var(--rmpg-700)' : 'linear-gradient(180deg, var(--sev-special) 0%, var(--sev-special) 100%)',
                  borderColor: 'var(--sev-special)',
                  borderBottomColor: 'var(--surface-overlay)',
                  borderRightColor: 'var(--surface-overlay)',
                  color: 'white',
                  opacity: !formData.location ? 0.5 : 1,
                }}
              >
                {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                Create PSO Call
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
